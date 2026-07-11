/**
 * @file usage-tab.js
 * @description Admin dashboard "Usage" tab — the unified operator-wide view of node LLM usage. It
 *   renders TWO clearly-labeled, never-summed sections, each a different system counting different
 *   call paths:
 *     1. "Agent LLM ledger" (GET /v1/admin/ledger) — priced agent LLM calls: totals, per-day cost
 *        chart, a per-user "top spenders" table (click a user to drill the per-agent table), a
 *        per-model table, and a per-agent table.
 *     2. "AI apps spend" (GET /v1/admin/ai-usage) — AI-apps token/cost: node totals, a per-app
 *        stacked daily bar (cost⇄tokens toggle), a by-app table, and a per-user top-spenders table.
 *   Both share one time-range control. The two figures are NEVER combined into a grand total.
 * @structure
 *   - getDateRange(period) — preset key → { from, to } date strings
 *   - UsageTab (default)   — fetches both aggregates and renders the two sections
 * @usage  Registered in views/admin.js NAV_GROUPS (replaces the old ai-usage entry); rendered with
 *   the shared admin tab props.
 * @version-history
 *   v1.0.0 — 2026-07-11 — Initial: unified operator usage tab (agent LLM ledger + AI apps spend),
 *     with per-user drill-down on the ledger's top-spenders table.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, StatsGrid, DataTable, Spinner, Empty } from './shared.js';
import { UsageChart, colorForIndex } from '/components/UsageChart.js';
import * as api from '/js/services/admin.js';

const usd = (n) => { const v = Number(n) || 0; return '$' + (v < 1 ? v.toFixed(4) : v.toFixed(2)); };
function fmtCompact(n) {
  const v = Number(n) || 0;
  if (v < 1000) return String(Math.round(v));
  if (v < 1_000_000) return (v / 1000).toFixed(v < 10_000 ? 1 : 0) + 'k';
  return (v / 1_000_000).toFixed(1) + 'M';
}

/** Preset key → inclusive { from, to } date strings (UTC). 'all' reaches back far enough for everything. */
function getDateRange(period) {
  const today = new Date();
  const fmt = (d) => d.toISOString().split('T')[0];
  const to = fmt(today);
  const back = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return fmt(d); };
  switch (period) {
    case '7d':  return { from: back(6), to };
    case '30d': return { from: back(29), to };
    case '90d': return { from: back(89), to };
    case 'all': return { from: '2000-01-01', to };
    default:    return { from: back(29), to };
  }
}

export default function UsageTab() {
  const [period, setPeriod] = useState('30d');
  const [metric, setMetric] = useState('cost');
  const [ledger, setLedger] = useState(null);
  const [aiUsage, setAiUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState(null);

  const load = useCallback(async (p) => {
    setLoading(true);
    try {
      const range = getDateRange(p);
      const [lr, ar] = await Promise.all([
        api.getLedger(range.from, range.to).catch(() => null),
        api.getAiUsage(range.from, range.to).catch(() => null),
      ]);
      if (lr && lr.data) setLedger(lr.data);
      if (ar && ar.data) setAiUsage(ar.data);
    } catch { /* keep previous data */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(period); }, [period]);

  // Silent background refresh on live updates (no spinner flash).
  useEffect(() => {
    const handler = () => { load(period); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [period]);

  const presets = [
    { key: '7d',  label: t('dashboard.period7Days')  || '7 days' },
    { key: '30d', label: t('dashboard.period30Days') || '30 days' },
    { key: '90d', label: t('dashboard.period90Days') || '90 days' },
    { key: 'all', label: t('dashboard.periodAll')    || 'All' },
  ];

  const timeRange = html`
    <div class="adm-time-range">
      <span class="adm-time-range-label">${t('dashboard.periodLabel') || 'Period'}:</span>
      ${presets.map((p) => html`
        <button class="adm-time-btn ${period === p.key ? 'active' : ''}" onClick=${() => setPeriod(p.key)}>${p.label}</button>
      `)}
      <span class="adm-time-custom">
        <button class="adm-time-btn ${metric === 'cost' ? 'active' : ''}" onClick=${() => setMetric('cost')}>${t('dashboard.aiMetricCost') || 'Cost'}</button>
        <button class="adm-time-btn ${metric === 'tokens' ? 'active' : ''}" onClick=${() => setMetric('tokens')}>${t('dashboard.aiMetricTokens') || 'Tokens'}</button>
      </span>
    </div>`;

  if (!ledger && !aiUsage) {
    return html`<div>${timeRange}${loading ? html`<${Spinner} />` : html`<${Empty} text=${t('dashboard.aiUsageEmpty') || 'No AI usage yet.'} />`}</div>`;
  }

  return html`
    <div>
      ${timeRange}
      ${renderLedgerSection(ledger, metric, selectedUser, setSelectedUser)}
      <hr class="adm-mt-lg" />
      ${renderAiAppsSection(aiUsage, metric)}
    </div>`;
}

/* ── Section 1: Agent LLM ledger (priced agent LLM calls) ── */
function renderLedgerSection(data, metric, selectedUser, setSelectedUser) {
  const heading = html`<h2 class="adm-section-cyan">${t('dashboard.ledgerSection') || 'Agent LLM ledger'}</h2>`;
  if (!data || !data.totals || (data.totals.calls || 0) === 0) {
    return html`<div>${heading}<${Empty} text=${t('dashboard.ledgerEmpty') || 'No agent LLM usage yet.'} /></div>`;
  }

  const totals = data.totals || {};
  const days = Array.isArray(data.days) ? data.days : [];
  const perUser = Array.isArray(data.per_user) ? data.per_user : [];
  const perModel = Array.isArray(data.per_model) ? data.per_model : [];
  const perAgent = Array.isArray(data.per_agent) ? data.per_agent : [];
  const isTokens = metric === 'tokens';

  const statItems = [
    { label: t('dashboard.ledgerTotalCost') || 'Total cost', value: usd(totals.cost_usd), tone: 'green' },
    { label: t('dashboard.ledgerTotalTokens') || 'Tokens', value: totals.total_tokens || 0, tone: 'cyan' },
    { label: t('dashboard.ledgerTotalCalls') || 'LLM calls', value: totals.calls || 0, tone: 'blue' },
    { label: t('dashboard.ledgerUnpriced') || 'Unpriced calls', value: totals.unpriced_calls || 0, tone: 'amber' },
  ];

  const labels = days.map((d) => d.date.slice(5));
  const datasets = [{
    label: isTokens ? (t('dashboard.ledgerTotalTokens') || 'Tokens') : (t('dashboard.ledgerTotalCost') || 'Cost'),
    data: days.map((d) => (isTokens ? d.total_tokens : d.cost_usd) || 0),
    backgroundColor: colorForIndex(0),
  }];
  const yFormat = isTokens ? (v) => fmtCompact(v) : usd;

  // Per-user "top spenders" — the owner cell is a clickable toggle that drills the per-agent table.
  const userRows = perUser.map((u) => {
    const on = selectedUser === u.owner_ghii;
    return [
      html`<button class=${'adm-time-btn ' + (on ? 'active' : '')}
        onClick=${() => setSelectedUser(on ? null : u.owner_ghii)}>${u.owner_ghii}</button>`,
      { text: num(u.agents || 0), mono: true },
      { text: usd(u.cost_usd), mono: true },
      { text: num(u.total_tokens || 0), mono: true },
      { text: num(u.calls || 0), mono: true },
      { text: num(u.unpriced_calls || 0), mono: true },
    ];
  });

  const modelRows = perModel.map((m) => [
    { text: m.model, mono: true },
    { text: usd(m.cost_usd), mono: true },
    { text: num(m.total_tokens || 0), mono: true },
    { text: num(m.calls || 0), mono: true },
    { text: num(m.unpriced_calls || 0), mono: true },
  ]);

  const shownAgents = selectedUser ? perAgent.filter((a) => a.owner_ghii === selectedUser) : perAgent;
  const agentRows = shownAgents.map((a) => [
    { text: a.agent_gaii, mono: true },
    { text: a.owner_ghii, mono: true },
    { text: usd(a.cost_usd), mono: true },
    { text: num(a.total_tokens || 0), mono: true },
    { text: num(a.calls || 0), mono: true },
    { text: num(a.unpriced_calls || 0), mono: true },
  ]);

  return html`
    <div>
      ${heading}
      <${StatsGrid} items=${statItems} />
      ${datasets[0].data.some((v) => v > 0)
        ? html`<div class="adm-card"><h2>${t('dashboard.ledgerPerDay') || 'Cost over time'}</h2>
            <${UsageChart} labels=${labels} datasets=${datasets} height=${240} yFormat=${yFormat} /></div>`
        : null}
      <h3 class="adm-mt-lg adm-text-sm adm-section-purple">${t('dashboard.ledgerTopSpenders') || 'Top spenders'}</h3>
      <${DataTable}
        headers=${[
          t('dashboard.ledgerColUser') || 'Owner',
          t('dashboard.ledgerColAgents') || 'Agents',
          t('dashboard.ledgerColCost') || 'Cost',
          t('dashboard.ledgerColTokens') || 'Tokens',
          t('dashboard.ledgerColCalls') || 'Calls',
          t('dashboard.ledgerColUnpriced') || 'Unpriced',
        ]}
        rows=${userRows} scroll=${true} />
      <h3 class="adm-mt-lg adm-text-sm adm-section-cyan">${t('dashboard.ledgerByModel') || 'By model'}</h3>
      <${DataTable}
        headers=${[
          t('dashboard.ledgerColModel') || 'Model',
          t('dashboard.ledgerColCost') || 'Cost',
          t('dashboard.ledgerColTokens') || 'Tokens',
          t('dashboard.ledgerColCalls') || 'Calls',
          t('dashboard.ledgerColUnpriced') || 'Unpriced',
        ]}
        rows=${modelRows} scroll=${true} />
      <h3 class="adm-mt-lg adm-text-sm adm-section-purple">
        ${t('dashboard.ledgerByAgent') || 'By agent'}
        ${selectedUser ? html` — <span class="adm-text-sm">${t('dashboard.ledgerFilteredNote') || 'Showing agents for'} ${selectedUser}</span>
          <button class="adm-time-btn" onClick=${() => setSelectedUser(null)}>${t('dashboard.ledgerAllUsers') || 'All users'}</button>` : null}
      </h3>
      <${DataTable}
        headers=${[
          t('dashboard.ledgerColAgent') || 'Agent',
          t('dashboard.ledgerColUser') || 'Owner',
          t('dashboard.ledgerColCost') || 'Cost',
          t('dashboard.ledgerColTokens') || 'Tokens',
          t('dashboard.ledgerColCalls') || 'Calls',
          t('dashboard.ledgerColUnpriced') || 'Unpriced',
        ]}
        rows=${agentRows} scroll=${true} />
    </div>`;
}

/* ── Section 2: AI apps spend (per-app token/cost; distinct system, never summed with the ledger) ── */
function renderAiAppsSection(data, metric) {
  const heading = html`<h2 class="adm-section-purple">${t('dashboard.ledgerAiAppsSection') || 'AI apps spend'}</h2>`;
  if (!data) {
    return html`<div>${heading}<${Empty} text=${t('dashboard.aiUsageEmpty') || 'No AI usage yet.'} /></div>`;
  }

  const days = Array.isArray(data.days) ? data.days : [];
  const apps = data.apps || [];
  const totals = data.totals || { cost_usd: 0, tokens: 0, calls: 0 };
  const isTokens = metric === 'tokens';

  const labels = days.map((d) => d.date.slice(5));
  const datasets = apps.map((app, i) => ({
    label: app,
    data: days.map((d) => {
      const m = (d.per_app && d.per_app[app]) || {};
      return (isTokens ? m.tokens : m.cost_usd) || 0;
    }),
    backgroundColor: colorForIndex(i),
  }));
  const yFormat = isTokens ? (v) => fmtCompact(v) : usd;

  const totalCost = totals.cost_usd || 0;
  const appRows = apps.map((app) => {
    const m = (data.per_app && data.per_app[app]) || { cost_usd: 0, tokens: 0, calls: 0 };
    const share = totalCost > 0 ? Math.round((m.cost_usd / totalCost) * 100) : 0;
    return [app, { text: usd(m.cost_usd), mono: true }, { text: num(m.tokens || 0), mono: true }, { text: num(m.calls || 0), mono: true }, { text: share + '%', mono: true }];
  });
  const userRows = (data.per_user || []).map((u) => [
    { text: u.owner_gaii, mono: true },
    { text: usd(u.cost_usd), mono: true },
    { text: num(u.tokens || 0), mono: true },
    { text: num(u.calls || 0), mono: true },
  ]);

  const statItems = [
    { label: t('dashboard.aiTotalSpend') || 'Total spend', value: usd(totals.cost_usd), tone: 'green' },
    { label: t('dashboard.aiTotalTokens') || 'Tokens', value: totals.tokens || 0, tone: 'cyan' },
    { label: t('dashboard.aiTotalCalls') || 'Calls', value: totals.calls || 0, tone: 'blue' },
    { label: t('dashboard.aiActiveApps') || 'Apps', value: apps.length, tone: 'purple' },
  ];

  return html`
    <div>
      ${heading}
      <${StatsGrid} items=${statItems} />
      ${datasets.length > 0
        ? html`<div class="adm-card"><h2>${t('dashboard.aiPerAppOverTime') || 'Per-app spend over time'}</h2>
            <${UsageChart} stacked labels=${labels} datasets=${datasets} height=${260} yFormat=${yFormat} /></div>`
        : html`<${Empty} text=${t('dashboard.aiUsageEmpty') || 'No AI usage yet.'} />`}
      <h3 class="adm-mt-lg adm-text-sm adm-section-cyan">${t('dashboard.aiByApp') || 'By app'}</h3>
      <${DataTable}
        headers=${[t('dashboard.aiApp') || 'App', t('dashboard.aiTotalSpend') || 'Spend', t('dashboard.aiTotalTokens') || 'Tokens', t('dashboard.aiTotalCalls') || 'Calls', t('dashboard.aiShare') || 'Share']}
        rows=${appRows} scroll=${true} />
      <h3 class="adm-mt-lg adm-text-sm adm-section-purple">${t('dashboard.aiByUser') || 'Top spenders'}</h3>
      <${DataTable}
        headers=${[t('dashboard.aiUser') || 'User', t('dashboard.aiTotalSpend') || 'Spend', t('dashboard.aiTotalTokens') || 'Tokens', t('dashboard.aiTotalCalls') || 'Calls']}
        rows=${userRows} scroll=${true} />
    </div>`;
}
