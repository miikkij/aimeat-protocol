/**
 * @file usage-tab.calls.js
 * @description Admin Usage tab, section 3 — the CALL stream. The other two sections count LLM
 *   spend; this one counts what was actually invoked on the node: which surface carried the work,
 *   which tools get called, which apps are alive, and how much of it was REFUSED.
 *
 *   REFUSALS ARE THE POINT. Before the usage-telemetry layer, a call the node declined left no
 *   record anywhere, so demand that was not served was the one thing an operator could never see.
 *   It gets its own column beside errors on every table here, because a refusal is the system
 *   working and an error is it failing, and one number covering both is useless for either.
 *
 *   IT IS A SEPARATE FILE, NOT MORE OF usage-tab.js. That file is at the size where a fourth
 *   concern makes it unreadable; the split is a pure extraction with its own heading.
 * @structure
 *   - CallsSection({ data }) — three tables over GET /v1/admin/usage/summary reports
 * @usage  Imported by views/admin/usage-tab.js and rendered under the shared time range.
 * @version-history
 *   v1.1.0 — 2026-08-15 — Drop the local per-surface collapsing: the read service no longer groups
 *     by outcome, so one surface is one row before it gets here.
 *   v1.0.0 — 2026-08-14 — Initial: the call stream reaches the operator dashboard.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, StatsGrid, DataTable, Empty } from './shared.js';

function ms(n) {
  const v = Number(n) || 0;
  return v >= 1000 ? (v / 1000).toFixed(1) + ' s' : Math.round(v) + ' ms';
}

/** A percentage that stays honest at small n: 0 calls is a dash, not 0 %. */
function rate(part, whole) {
  const w = Number(whole) || 0;
  if (w === 0) return '—';
  return Math.round(((Number(part) || 0) / w) * 100) + '%';
}

/**
 * @param {object} props
 * @param {{surface: object|null, tool: object|null, apps: object|null}} props.data
 *   Three already-fetched report payloads from GET /v1/admin/usage/summary.
 */
export function CallsSection({ data }) {
  const heading = html`<h2 class="adm-section-purple">${t('dashboard.callsSection')}</h2>`;
  const surface = data?.surface;
  const tool = data?.tool;
  const apps = data?.apps;

  const totals = surface?.totals;
  if (!totals || (totals.calls || 0) === 0) {
    return html`<div>${heading}<${Empty} text=${t('dashboard.callsEmpty')} /></div>`;
  }

  const statItems = [
    { label: t('dashboard.callsTotal'), value: num(totals.calls || 0), tone: 'blue' },
    { label: t('dashboard.callsRefused'), value: num(totals.refusals || 0), tone: 'purple' },
    { label: t('dashboard.callsFailed'), value: num(totals.errors || 0), tone: 'red' },
    { label: t('dashboard.callsSlowest'), value: ms(totals.duration_ms_max), tone: 'cyan' },
  ];

  // One row per surface already: the read service treats `outcome` as a qualifier rather than a
  // grouping key, because `refusals` and `errors` are metrics on every row. Before that it split one
  // surface into an ok row and an error row that both read "mcp".
  const surfaceRows = (surface.groups || []).map(g => [
    g.key,
    { text: num(g.calls || 0), mono: true },
    { text: num(g.refusals || 0), mono: true },
    { text: num(g.errors || 0), mono: true },
    { text: rate((g.errors || 0) + (g.refusals || 0), g.calls), mono: true },
    { text: ms(g.duration_ms_max), mono: true },
  ]);

  const toolRows = (tool?.groups || []).slice(0, 50).map(g => [
    { text: g.key, mono: true },
    g.dims?.surface || '',
    { text: num(g.calls || 0), mono: true },
    { text: num(g.refusals || 0), mono: true },
    { text: num(g.errors || 0), mono: true },
    { text: ms(g.duration_ms_avg), mono: true },
  ]);

  // A row with no app id is not an app open — it is a call that happened to be counted in the same
  // cut. Showing it here would put a row in an "apps opened" table that names no app.
  const appRows = (apps?.groups || []).filter(g => !!g.dims?.appId).slice(0, 50).map(g => [
    { text: g.key, mono: true },
    { text: num(g.calls || 0), mono: true },
    { text: num(g.actors_seen_approx || 0), mono: true },
  ]);

  return html`
    <div>
      ${heading}
      <p class="adm-text-sm">${t('dashboard.callsIntro')}</p>
      <${StatsGrid} items=${statItems} />

      <h3 class="adm-mt-lg adm-text-sm adm-section-cyan">${t('dashboard.callsBySurface')}</h3>
      <${DataTable}
        headers=${[
          t('dashboard.callsColSurface'), t('dashboard.callsTotal'), t('dashboard.callsRefused'),
          t('dashboard.callsFailed'), t('dashboard.callsColNotServed'), t('dashboard.callsSlowest'),
        ]}
        rows=${surfaceRows} scroll=${true} />

      <h3 class="adm-mt-lg adm-text-sm adm-section-purple">${t('dashboard.callsByTool')}</h3>
      <${DataTable}
        headers=${[
          t('dashboard.callsColTool'), t('dashboard.callsColSurface'), t('dashboard.callsTotal'),
          t('dashboard.callsRefused'), t('dashboard.callsFailed'), t('dashboard.callsColAvgTime'),
        ]}
        rows=${toolRows} scroll=${true} />

      <h3 class="adm-mt-lg adm-text-sm adm-section-cyan">${t('dashboard.callsByApp')}</h3>
      <${DataTable}
        headers=${[t('dashboard.callsColApp'), t('dashboard.callsColOpens'), t('dashboard.callsColUsers')]}
        rows=${appRows} scroll=${true} />
      <p class="adm-text-sm">${t('dashboard.callsUsersNote')}</p>
    </div>`;
}
