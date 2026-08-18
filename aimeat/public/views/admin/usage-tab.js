/**
 * @file usage-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v1.1.0 — 2026-08-14 — Third section: the CALL stream (surfaces, tools, apps, refusals) from
 *     GET /v1/admin/usage/summary. It counts invocations, never spend, so it is never summed with
 *     the two above. Body in usage-tab.calls.js.
 *   v1.0.0 — 2026-07-11 — Initial: unified operator usage tab (agent LLM ledger + AI apps spend),
 *     with per-user drill-down on the ledger's top-spenders table.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, StatsGrid, DataTable, Spinner, Empty, Badge } from './shared.js';
import { UsageChart, colorForIndex } from '/components/UsageChart.js';
import * as api from '/js/services/admin.js';
import { swallowed } from '/js/swallowed.js';
import { CallsSection } from './usage-tab.calls.js';

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
  const [house, setHouse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState(null);
  const [calls, setCalls] = useState(null);

  const load = useCallback(async (p) => {
    setLoading(true);
    try {
      const range = getDateRange(p);
      const quiet = (err) => { swallowed('usage-tab: UsageTab', err); return null; };
      // Five reads in parallel rather than in sequence: they are independent, and the tab is only as
      // fast as its slowest one either way.
      const [lr, ar, cs, ct, ca, hs] = await Promise.all([
        api.getLedger(range.from, range.to).catch(quiet),
        api.getAiUsage(range.from, range.to).catch(quiet),
        api.getUsageSummary('surface', range.from, range.to).catch(quiet),
        api.getUsageSummary('tool', range.from, range.to).catch(quiet),
        api.getUsageSummary('apps-used', range.from, range.to).catch(quiet),
        api.getUsageHouse(range.from, range.to).catch(quiet),
      ]);
      if (lr && lr.data) setLedger(lr.data);
      if (ar && ar.data) setAiUsage(ar.data);
      if (hs && hs.data) setHouse(hs.data);
      setCalls({ surface: cs?.data ?? null, tool: ct?.data ?? null, apps: ca?.data ?? null });
    } catch (err) { swallowed('usage-tab: UsageTab', err); }
    setLoading(false);
  }, []);

  useEffect(() => { load(period); }, [period, load]);

  // Silent background refresh on live updates (no spinner flash).
  useEffect(() => {
    const handler = () => { load(period); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [period, load]);

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

  if (!ledger && !aiUsage && !calls && !house) {
    return html`<div>${timeRange}${loading ? html`<${Spinner} />` : html`<${Empty} text=${t('dashboard.aiUsageEmpty') || 'No AI usage yet.'} />`}</div>`;
  }

  return html`
    <div>
      ${timeRange}
      ${renderHouseSection(house)}
      <hr class="adm-mt-lg" />
      ${renderLedgerSection(ledger, metric, selectedUser, setSelectedUser)}
      <hr class="adm-mt-lg" />
      ${renderAiAppsSection(aiUsage, metric)}
      <hr class="adm-mt-lg" />
      <${CallsSection} data=${calls} />
    </div>`;
}

/* ── Section 0: the house's money ──
 *
 * Whose key paid, what the house grants, and what is NOT counted anywhere on this page. The last
 * one is the reason this section exists: the chat agent spends a process-wide key outside the
 * metered path, so every figure below it would otherwise read as the whole bill.
 */
function renderHouseSection(data) {
  const heading = html`<h2 class="adm-section-cyan">${t('dashboard.houseSection')}</h2>`;
  if (!data) return html`<div>${heading}<${Empty} text=${t('dashboard.houseUnavailable')} /></div>`;

  const node = (data.by_key_scope && data.by_key_scope.node) || {};
  const own = (data.by_key_scope && data.by_key_scope.own) || {};
  const chat = data.chat_agent || {};

  const statItems = [
    { label: t('dashboard.houseSpend'), value: usd(node.cost_usd), tone: 'amber' },
    { label: t('dashboard.housePeople'), value: num(node.people || 0), tone: 'blue' },
    { label: t('dashboard.houseOwnKeySpend'), value: usd(own.cost_usd), tone: 'green' },
    { label: t('dashboard.houseGrant'), value: usd(data.free_allowance_usd), tone: 'cyan' },
  ];

  const spenderRows = (data.top_house_spenders || []).map((u) => [
    u.owner_ghii,
    { text: usd(u.cost_usd), mono: true },
    { text: num(u.calls || 0), mono: true },
  ]);

  return html`
    <div>
      ${heading}
      <p class="adm-text-dim adm-text-xs adm-mb-sm">${t('dashboard.houseExplain')}</p>
      <${StatsGrid} items=${statItems} />

      <div class="adm-hrow">
        <span class="adm-hmetric">${t('dashboard.houseKey')}</span>
        <span>${data.house_key_configured
          ? html`<${Badge} type="healthy" /> ${t('dashboard.houseKeySet')}`
          : html`<${Badge} type="idle" /> ${t('dashboard.houseKeyUnset')}`}</span>
      </div>
      <div class="adm-hrow">
        <span class="adm-hmetric">${t('dashboard.houseFallback')}</span>
        <span><code>${data.free_fallback_model || t('dashboard.houseFallbackNone')}</code></span>
      </div>
      <div class="adm-hrow">
        <span class="adm-hmetric">${t('dashboard.houseChat')}</span>
        <span>
          ${chat.enabled
            ? html`<${Badge} type="healthy" /> ${chat.model ? html`<code>${chat.model}</code>` : t('dashboard.houseChatNoModel')}`
            : html`<${Badge} type="idle" /> ${t('dashboard.houseChatOff')}`}
          ${chat.enabled && html`<span class="adm-text-dim adm-text-xs"> ${t('dashboard.houseChatUnmetered')}</span>`}
        </span>
      </div>

      ${spenderRows.length > 0 && html`
        <h3 class="adm-mt-md adm-text-base">${t('dashboard.houseTopSpenders')}</h3>
        <${DataTable}
          columns=${[t('dashboard.ledgerUser') || 'Owner', t('dashboard.ledgerTotalCost') || 'Cost', t('dashboard.ledgerTotalCalls') || 'Calls']}
          rows=${spenderRows} />`}
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

  // Stacked per-day series by model (like the AI-apps per-app chart), ordered by the top-level
  // per_model (cost desc) so the legend/series order is stable.
  const labels = days.map((d) => d.date.slice(5));
  const models = perModel.map((m) => m.model);
  const datasets = models.map((model, i) => ({
    label: model,
    data: days.map((d) => {
      const dm = (d.per_model && d.per_model[model]) || {};
      return (isTokens ? dm.total_tokens : dm.cost_usd) || 0;
    }),
    backgroundColor: colorForIndex(i),
  }));
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
    { text: (m.providers && m.providers.length) ? m.providers.join(', ') : '—', mono: true },
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
      ${datasets.some((ds) => ds.data.some((v) => v > 0))
        ? html`<div class="adm-card"><h2>${t('dashboard.ledgerPerDay') || 'Cost over time'}</h2>
            <${UsageChart} stacked labels=${labels} datasets=${datasets} height=${240} yFormat=${yFormat} /></div>`
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
          t('dashboard.ledgerColProvider') || 'Provider',
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
