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
 *   IT BORROWS NOTHING AND INVENTS NOTHING. Stats are the figure strip (FigureStrip), the report
 *   bar and the time window are tab rows (Tabs), the table is the List; the page writes no class.
 *   The report bar wraps — eight long labels do not fit a joined segmented control on a phone.
 *   (History: its own classes were once `pf-ureport-*`, because a first version reused the Home
 *   quota card's `pf-usage-*`, inherited its background over the selected button's white text,
 *   and rendered the chosen report invisible.)
 * @structure
 *   - REPORTS         — button definitions: id, label key, and which stats it leads with
 *   - getRange(period) — preset key → { from, to }
 *   - UsageTab (default) — fetch + render
 *   HOW IT EXPLAINS ITSELF (.claude/rules/page-guidance.md): the title's question mark is
 *   concept.usage (the two kinds of report, what is counted and what is not), and the page's start
 *   (PageStart id "usage") gives the prompt that has one's own AI read the same reports.
 * @usage Registered in views/profile.js as the `usage` tab; menu entry in landing-page.cards.js.
 * @version-history
 *   v1.13.0 -- 2026-11-27 -- The report is a Select (eight tab buttons stood beside the period's
 *     three); money is js/format.js money (two decimals, four under a cent: "$0.0000" became
 *     "0,00 $"); a day report's rows and chart show the reader's date under the head "Day".
 *   v1.12.0 -- 2026-11-27 -- The figures stand under the head (SettingsPage strip), before the report
 *     bar: where things stand comes before the controls that choose a report. With nothing recorded
 *     for the chosen report and window the strip is not drawn and the table's one empty line, now
 *     saying what fills it, is the page. Unpriced, Refused and Failed take the notice tone when they
 *     are above zero, and in an activity report the rows with a refusal or a failure come first. The
 *     page stays one report at a time with no numbered sections (see WHY REPORTS above); no control
 *     was removed.
 *   v1.11.0 -- 2026-11-25 -- The report on tools has the column Largest answer (answer_chars_max of
 *     each tool, in characters), and its column head opens the explanation usage.answerSize. Only
 *     that report has it: the node measures the answer of an MCP tool call and of nothing else.
 *   v1.10.0 -- 2026-11-08 -- Unpriced and Refused open their explanation (usage.unpriced,
 *     usage.refused): the word in the figure strip, and Refused's column head in the activity table.
 *   v1.9.0 -- 2026-11-08 -- The page explains itself the designed way (.claude/rules/page-guidance.md):
 *     PageStart "usage" and the title's question mark concept.usage.
 *   v1.8.0 -- 2026-09-26 -- Every part is a component that takes data (SettingsPage, Tabs for the
 *     report bar and the time window, FigureStrip, List with its empty line, Note, Layout); the page
 *     writes no class and its pf-ureport-* rules go.
 *   v1.7.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.6.0 -- 2026-09-25 -- A line that says a load or a save failed is the Form message in its error tone (.form-message--error); the error lines' own rules go (a unification: the look most tabs use).
 *   v1.5.0 -- 2026-09-25 -- A table of rows is the Listing (css/components/listing.css): the P&L lines, the accountants, the usage report, the AI spend per app, the security overrides and an agent's internal jobs; figures stand at the right of their column (a unification: the look most tabs use).
 *   v1.4.0 -- 2026-09-25 -- The crumb is the full trail (Settings & Controls / the menu group / the tab), as in the kit tabs (a unification).
 *   v1.3.0 -- 2026-09-25 -- A row of figures is the figure strip (og-strip, css/components/figure-strip.css), the look most Settings tabs draw (UI consolidation phase 5, a unification).
 *   v1.2.0 -- 2026-09-25 -- The page head is the kit's crumb trail and page head (.og-crumb, .og-mast, .og-title, .og-desc), the look most tabs use (a unification).
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
 *   2026-09-13 — V1: compose page and B1 section headings from the shared poster classes.
 *   v1.1.0 — 2026-08-15 — House styles: .stat-grid/.stat-card and .seg/.seg-btn instead of a local
 *     clone; own classes renamed off the colliding pf-usage-* prefix.
 *   v1.0.0 — 2026-08-14 — Initial: the owner-facing usage reports.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { UsageChart, colorForIndex } from '/components/UsageChart.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { Tabs, TabPanel } from '/components/Tabs.js';
import { Note } from '/components/Note.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { List, Row, Name, Num } from '/components/List.js';
import { Row as Line, Space } from '/components/Layout.js';
import { PageStart } from '/components/PageStart.js';
import { HelpLabel } from '/components/HelpTip.js';
import { Select } from '/components/Select.js';
import { money, date as fmtDate } from '/js/format.js';
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

/** Money in the reader's own format: two decimals, four only for an amount under a cent
 *  (js/format.js money); "$0.0000" stood for nothing spent. */
function usd(n) {
  return money(Number(n) || 0, 'USD');
}

/** A day report's key is an ISO day (2026-11-20): written as the reader writes a date. */
const dayOf = (key) => (/^\d{4}-\d{2}-\d{2}$/.test(String(key)) ? fmtDate(`${key}T12:00:00`) : key);

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

  // The chart keeps its own fixed height (UsageChart's height), so switching report does not make
  // the table below it jump.
  const chart = series.length > 1 ? html`
    <${Space} below="large">
      <${UsageChart}
        type="bar"
        labels=${series.map(s => dayOf(s.bucket))}
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
    <//>` : null;

  // A figure that asks the person to look (calls with no known price, refused or failed calls) takes
  // the notice tone while it is above zero.
  const look = (n) => ((Number(n) || 0) > 0 ? 'notice' : undefined);
  const statCards = current.kind === 'spend'
    ? [
        { label: t('profile.usage.statCost'), value: usd(totals?.cost_usd) },
        { label: t('profile.usage.statTokens'), value: compact(totals?.total_tokens) },
        { label: t('profile.usage.statCalls'), value: compact(totals?.calls) },
        { label: t('profile.usage.statUnpriced'), term: 'usage.unpriced', value: compact(totals?.unpriced_calls), tone: look(totals?.unpriced_calls) },
      ]
    : [
        { label: t('profile.usage.statCalls'), value: compact(totals?.calls) },
        { label: t('profile.usage.statRefused'), term: 'usage.refused', value: compact(totals?.refusals), tone: look(totals?.refusals) },
        { label: t('profile.usage.statErrors'), value: compact(totals?.errors), tone: look(totals?.errors) },
        { label: t('profile.usage.statSlowest'), value: ms(totals?.duration_ms_max) },
      ];

  // A word that opens its own explanation (`explain.<term>.*`); without a term the word alone.
  const helpWord = (words, term) => (term ? html`<${HelpLabel} term=${term} label=${words}>${words}<//>` : words);

  // The size of an answer is measured on MCP tool calls alone, so only the report on tools shows it.
  const withAnswerSize = report === 'tool';

  // A column head: its words, and the explanation it opens when it has one.
  const headers = current.kind === 'spend'
    ? [{ label: report === 'day' ? t('profile.usage.colDay') : t('profile.usage.colName') }, { label: t('profile.usage.statCost') }, { label: t('profile.usage.statTokens') }, { label: t('profile.usage.statCalls') }]
    : [
        { label: t('profile.usage.colName') },
        { label: t('profile.usage.statCalls') },
        { label: t('profile.usage.statRefused'), term: 'usage.refused' },
        { label: t('profile.usage.statErrors') },
        { label: t('profile.usage.colAvgTime') },
        ...(withAnswerSize ? [{ label: t('profile.usage.colMaxAnswer'), term: 'usage.answerSize' }] : []),
      ];

  // In an activity report a row with a refusal or a failure comes first, the rest keep the server's
  // order (Array.prototype.sort is stable). A spend report keeps its ranking by cost.
  const troubled = (g) => ((Number(g.refusals) || 0) + (Number(g.errors) || 0) > 0 ? 0 : 1);
  const ordered = current.kind === 'spend' ? groups : [...groups].sort((a, b) => troubled(a) - troubled(b));
  const rows = ordered.map(g => (current.kind === 'spend'
    ? [report === 'day' ? dayOf(g.key) : g.key, usd(g.cost_usd), compact(g.total_tokens), compact(g.calls)]
    : [g.key, compact(g.calls), compact(g.refusals), compact(g.errors), ms(g.duration_ms_avg),
        // A row with no measured answer (a web request, a call from before the measurement) stays empty.
        ...(withAnswerSize ? [g.answer_chars_max ? compact(g.answer_chars_max) : ''] : [])]));

  // An empty report is a fact about this account, not a broken page — so it says which
  // question was asked and over what window, rather than showing a bare dash.
  const emptyWords = t('profile.usage.emptyFor')
    .replace('{report}', t(current.label))
    .replace('{days}', t(`profile.usage.period${period}`));

  // The report and the time window: the report is one Select (eight buttons stood in a wall beside
  // the three of the window), the window a tab row with the chosen one on the sun.
  const controls = html`
    <${Line} wrap align="center" justify="between" gap="medium" below="large">
      <${Select} fit ariaLabel=${t('profile.usage.reportGroupLabel')} value=${report} onChange=${setReport}
        options=${REPORTS.map(r => [r.id, t(r.label)])} />
      <${Tabs} tone="filter" label=${t('profile.usage.periodGroupLabel')} value=${period} onSelect=${setPeriod}
        items=${PERIODS.map(p => ({ value: p, label: t(`profile.usage.period${p}`) }))} />
    <//>`;

  // The figures of the chosen report stand under the head, before the report bar: what a person
  // comes for (the cost, or the calls and how many were refused) is the first thing on the page.
  // With nothing recorded (no call in the window) the strip is not drawn, so an empty report is
  // one line and not a band of zeros (the rule hideZeros states; decided here on the calls, since
  // the figures are formatted, never a bare 0).
  const recorded = (Number(totals?.calls) || 0) > 0;
  const strip = loading && !data
    ? html`<${FigureStrip} loading=${4} />`
    : data && recorded
      ? html`<${FigureStrip} items=${statCards.map(c => ({ key: c.label, n: c.value, tone: c.tone, label: helpWord(c.label, c.term) }))} />`
      : null;

  return html`
    <${SettingsPage}
      crumb=${[t('nav.profile'), t('profile.landing.menuBusiness'), t('profile.tabs.usage')]}
      title=${t('profile.usage.title')}
      help="concept.usage"
      desc=${t('profile.usage.intro')}
      strip=${strip}
      start=${html`<${PageStart} id="usage" />`}>
      ${controls}

      ${error ? html`<${Note} kind="message" error>${error}<//>` : null}
      ${loading && !data ? html`<${Note} kind="loading">${t('profile.usage.loading')}<//>` : null}

      ${data ? html`<${TabPanel} value=${`${report}-${period}`} label=${t(REPORTS.find(r => r.id === report)?.label || '')}>
        ${chart}
        <${List} keepCols cols=${headers.length > 5 ? 'name-n-n-n-n-n' : headers.length > 4 ? 'name-n-n-n-n' : 'name-n-n-n'}
          head=${headers.map((hd, i) => (i
            ? { label: helpWord(hd.label, hd.term), num: true }
            : hd.label))}
          empty=${emptyWords}
          rows=${rows}
          render=${(row, ri) => html`<${Row} key=${ri}>${row.map((cell, i) => (i
            ? html`<${Num} key=${i}>${cell}<//>`
            : html`<${Name} key=${i}>${cell}<//>`))}<//>`} />
      <//>` : null}
    <//>`;
}
