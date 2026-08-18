/**
 * @file usage-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile "Usage" tab — what this owner actually used, and what it cost. One report at
 *   a time over one time window, read from GET /v1/usage/summary (the precomputed serving layer, so
 *   the answer costs the same whatever the history has grown to).
 *
 *   WHY REPORTS RATHER THAN ONE BIG PAGE. The nine questions here have different shapes: spend is a
 *   currency ranked by cost, tool use is a count with a failure rate beside it, and app opens are
 *   neither. Stacking all of them would make every one of them harder to read, so the page shows one
 *   at a time and the chip row says what else can be asked.
 *
 *   MONEY AND ACTIVITY ARE NEVER SUMMED. The stat row changes with the report: a spend report leads
 *   with cost, an activity report leads with calls and shows how many were refused. A single grand
 *   total across both would be a number with no meaning.
 *   IT BORROWS NOTHING AND INVENTS NOTHING. Stats are the canonical `.stat-grid`/`.stat-card`, the
 *   time window is the canonical `.seg`/`.seg-btn`, and only the wrapping report bar has classes of
 *   its own — eight long labels do not fit a joined segmented control on a phone. Its own classes
 *   are `pf-ureport-*` rather than `pf-usage-*`, which already belongs to the Home quota card: the
 *   first version reused that name, inherited its `background: var(--bg-surface)` over the selected
 *   button's white text, and rendered the chosen report invisible.
 * @structure
 *   - REPORTS         — button definitions: id, label key, and which stats it leads with
 *   - getRange(period) — preset key → { from, to }
 *   - UsageTab (default) — fetch + render
 * @usage Registered in views/profile.js as the `usage` tab; menu entry in landing-page.cards.js.
 * @version-history
 *   v1.1.0 — 2026-08-15 — House styles: .stat-grid/.stat-card and .seg/.seg-btn instead of a local
 *     clone; own classes renamed off the colliding pf-usage-* prefix.
 *   v1.0.0 — 2026-08-14 — Initial: the owner-facing usage reports.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Spinner } from './shared.js';
import { DataTable } from '/components/DataTable.js';
import { UsageChart, colorForIndex } from '/components/UsageChart.js';
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

/** Money reports lead with cost; activity reports lead with calls. `kind` decides both. */
const REPORTS = [
  { id: 'day', kind: 'spend', label: 'profile.usage.reportDay' },
  { id: 'model', kind: 'spend', label: 'profile.usage.reportModel' },
  { id: 'app', kind: 'spend', label: 'profile.usage.reportApp' },
  { id: 'agent', kind: 'spend', label: 'profile.usage.reportAgent' },
  { id: 'tool', kind: 'activity', label: 'profile.usage.reportTool' },
  { id: 'surface', kind: 'activity', label: 'profile.usage.reportSurface' },
  { id: 'apps-used', kind: 'activity', label: 'profile.usage.reportAppsUsed' },
  { id: 'sold', kind: 'activity', label: 'profile.usage.reportSold' },
];

const PERIODS = ['7d', '30d', '90d'];

function getRange(period) {
  const today = new Date();
  const fmt = (d) => d.toISOString().split('T')[0];
  const back = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return fmt(d); };
  const days = period === '7d' ? 6 : period === '90d' ? 89 : 29;
  return { from: back(days), to: fmt(today) };
}

/** Small amounts need four decimals to be a number at all; large ones do not. */
function usd(n) {
  const v = Number(n) || 0;
  return '$' + (v < 1 ? v.toFixed(4) : v.toFixed(2));
}

function compact(n) {
  const v = Number(n) || 0;
  if (v < 1000) return String(Math.round(v));
  if (v < 1_000_000) return (v / 1000).toFixed(v < 10_000 ? 1 : 0) + 'k';
  return (v / 1_000_000).toFixed(1) + 'M';
}

function ms(n) {
  const v = Number(n) || 0;
  return v >= 1000 ? (v / 1000).toFixed(1) + ' s' : Math.round(v) + ' ms';
}

export default function UsageTab() {
  const [report, setReport] = useState('day');
  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const { from, to } = getRange(period);
    try {
      const res = await apiGet(`/v1/usage/summary?report=${encodeURIComponent(report)}&from=${from}&to=${to}`);
      // apiGet returns the whole AIMEAT envelope; the report lives under `data`. Reading the
      // envelope directly renders a page of zeroes with no error, which is what the browser check
      // caught and no unit test would have.
      setData(res?.data ?? null);
    } catch (err) {
      swallowed('usage-tab: report load failed', err);
      setError(err?.message || t('profile.usage.loadFailed'));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [report, period]);

  useEffect(() => { load(); }, [load]);

  // Every profile tab showing server data re-fetches on the live-update event.
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  const current = REPORTS.find(r => r.id === report) ?? REPORTS[0];
  const totals = data?.totals;
  const groups = data?.groups ?? [];
  const series = data?.series ?? [];

  const chart = series.length > 1 ? html`
    <div class="pf-ureport-chart">
      <${UsageChart}
        type="bar"
        labels=${series.map(s => s.bucket)}
        datasets=${[{
          label: current.kind === 'spend' ? t('profile.usage.statCost') : t('profile.usage.statCalls'),
          data: series.map(s => (current.kind === 'spend' ? s.cost_usd : s.calls)),
          // The shared data-series palette rather than a colour typed here: Chart.js needs a
          // concrete string, and colorForIndex is where this project keeps them.
          backgroundColor: colorForIndex(0),
        }]}
        height=${200}
        legend=${false}
      />
    </div>` : null;

  const statCards = current.kind === 'spend'
    ? [
        { label: t('profile.usage.statCost'), value: usd(totals?.cost_usd) },
        { label: t('profile.usage.statTokens'), value: compact(totals?.total_tokens) },
        { label: t('profile.usage.statCalls'), value: compact(totals?.calls) },
        { label: t('profile.usage.statUnpriced'), value: compact(totals?.unpriced_calls) },
      ]
    : [
        { label: t('profile.usage.statCalls'), value: compact(totals?.calls) },
        { label: t('profile.usage.statRefused'), value: compact(totals?.refusals) },
        { label: t('profile.usage.statErrors'), value: compact(totals?.errors) },
        { label: t('profile.usage.statSlowest'), value: ms(totals?.duration_ms_max) },
      ];

  const headers = current.kind === 'spend'
    ? [t('profile.usage.colName'), t('profile.usage.statCost'), t('profile.usage.statTokens'), t('profile.usage.statCalls')]
    : [t('profile.usage.colName'), t('profile.usage.statCalls'), t('profile.usage.statRefused'), t('profile.usage.statErrors'), t('profile.usage.colAvgTime')];

  const rows = groups.map(g => (current.kind === 'spend'
    ? [g.key, usd(g.cost_usd), compact(g.total_tokens), compact(g.calls)]
    : [g.key, compact(g.calls), compact(g.refusals), compact(g.errors), ms(g.duration_ms_avg)]));

  return html`
    <div class="pf-ureport">
      <h2 class="section-title">${t('profile.usage.title')}</h2>
      <p class="section-desc">${t('profile.usage.intro')}</p>

      <div class="pf-ureport-controls">
        <div class="pf-ureport-bar" role="group" aria-label=${t('profile.usage.reportGroupLabel')}>
          ${REPORTS.map(r => html`
            <button type="button"
              class=${`pf-ureport-btn${r.id === report ? ' active' : ''}`}
              aria-pressed=${r.id === report}
              onClick=${() => setReport(r.id)}>${t(r.label)}</button>`)}
        </div>
        <div class="seg" role="group" aria-label=${t('profile.usage.periodGroupLabel')}>
          ${PERIODS.map(p => html`
            <button type="button"
              class=${`seg-btn${p === period ? ' active' : ''}`}
              aria-pressed=${p === period}
              onClick=${() => setPeriod(p)}>${t(`profile.usage.period${p}`)}</button>`)}
        </div>
      </div>

      ${error ? html`<p class="pf-ureport-error">${error}</p>` : null}
      ${loading && !data ? html`<${Spinner} text=${t('profile.usage.loading')} />` : null}

      ${data ? html`
        <div class="stat-grid">
          ${statCards.map(c => html`
            <div class="stat-card">
              <div class="stat-card-value">${c.value}</div>
              <div class="stat-card-label">${c.label}</div>
            </div>`)}
        </div>
        ${chart}
        ${rows.length
          ? html`<${DataTable} headers=${headers} rows=${rows} scroll=${true} />`
          // An empty report is a fact about this account, not a broken page — so it says which
          // question was asked and over what window, rather than showing a bare dash.
          : html`<p class="pf-ureport-empty">${t('profile.usage.emptyFor')
              .replace('{report}', t(current.label))
              .replace('{days}', t(`profile.usage.period${period}`))}</p>`}
      ` : null}
    </div>`;
}
