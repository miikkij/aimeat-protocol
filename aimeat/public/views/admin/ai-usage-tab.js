/**
 * @file ai-usage-tab.js
 * @description Admin dashboard "AI Apps Usage" tab — operator-wide view of AI spend across every
 *   owner. Shows node totals (spend / tokens / calls), a per-app stacked daily bar (cost⇄tokens
 *   toggle), and two breakdown tables: per-app grand totals and per-user top spenders. Backed by
 *   the operator-only GET /v1/admin/ai-usage aggregate; self-manages its own time range + fetch.
 * @structure
 *   - getDateRange(period) — preset key → { from, to } date strings
 *   - AiUsageTab (default)  — the tab component
 * @usage  Registered in views/admin.js NAV_GROUPS; rendered with the shared admin tab props.
 * @version-history
 *   v1.0.0 — 2026-07-05 — Initial: operator AI-spend dashboard (totals + stacked bar + breakdowns).
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

export default function AiUsageTab() {
  const [period, setPeriod] = useState('30d');
  const [metric, setMetric] = useState('cost');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p) => {
    setLoading(true);
    try {
      const range = getDateRange(p);
      const resp = await api.getAiUsage(range.from, range.to);
      if (resp && resp.data) setData(resp.data);
    } catch { /* keep previous data */ }
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

  if (!data) return html`<div>${timeRange}${loading ? html`<${Spinner} />` : html`<${Empty} text=${t('dashboard.aiUsageEmpty') || 'No AI usage yet.'} />`}</div>`;

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
      ${timeRange}
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
