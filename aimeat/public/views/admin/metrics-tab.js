/**
 * @file metrics-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard Metrics page in the poster face (design canvas "AIMEAT Admin
 *   Metrics"): the node's live process metrics read from the Prometheus endpoint (/v1/metrics).
 *   Memory in actual use is the headline, beside the line the session has been keeping; the ledger
 *   explains why the operating system's number is bigger; the routes are ordered by share of every
 *   call answered; three counters say what was refused and what a climb in each would mean; and the
 *   raw scrape is there with its filter. Rates (CPU %, requests/s) come from the delta between two
 *   polls. Polls every 10 s while the page is visible; a FEATURE_DISABLED response renders enable
 *   instructions rather than an error. The page draws library components only and writes no class
 *   (admin page group G3).
 * @structure
 *   - parseProm(text)        -- Prometheus text exposition → Map(name → [{labels, value}])
 *   - sum/firstValue         -- read helpers over the parsed map
 *   - fmtBytes/fmtUptime     -- the two number formats this page speaks
 *   - Headline               -- the memory in use in the poster face, and what it is made of
 *   - MetricsTab (default)   -- the five sections
 * @version-history
 *   v3.0.0 — 2026-09-27 — Library components only: Section, Beside with the TrendLine (sun ground),
 *     FigureStrip, the ledger, the routes and the raw scrape as Lists with the share Meter, the
 *     refusals as Readings, SearchLine for the filter; admin-metrics-poster.css goes. The line
 *     (formerly Line here) is components/TrendLine.js.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v2.1.0 — 2026-09-13 — Compose shared B1 headings; measured shares use SVG width data.
 *   v2.0.0 — 2026-09-12 — The poster face. Three blue sparklines with no scale become one line of
 *     the number that matters, with its ends labelled and a reading under the cursor; every share
 *     column names its own maximum in the header (share of the OS reserve, share of every call),
 *     and the route bars are a share of all traffic rather than of the busiest route; the three
 *     refusal counters become sentences; and the ledger's words stop calling the OS reserve a
 *     high-water mark, which it never was.
 *   v1.1.0 — 2026-08-17 — The headline is "Memory in actual use" (heap used + external), and a
 *     memory-ledger table explains every component in plain language — including that RSS is
 *     inflated by freed-but-retained allocator pages, which kept being read as a leak. RSS moves
 *     off the cards into the ledger's total row.
 *   v1.0.0 — 2026-08-17 — Initial: memory/CPU/event-loop cards, HTTP top routes with req/s,
 *     security counters, filterable raw metric table, 10 s visible-only poll.
 */
import { h, Fragment } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, Spinner, useToast, Toast } from './shared.js';
import { Section } from '/components/Section.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Figure, Tinted, Meter } from '/components/Figure.js';
import { Readings } from '/components/Readings.js';
import { Mark, Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Action } from '/components/Action.js';
import { Box } from '/components/Box.js';
import { List, Row as ListRow, Name, Num, Desc, Cell, SearchLine } from '/components/List.js';
import { Row, Stack, Beside, Split } from '/components/Layout.js';
import { TrendLine } from '/components/TrendLine.js';
import * as api from '/js/services/admin.js';

const M = (key, params) => t('admin.metrics.' + key, params);

const POLL_MS = 10_000;
const HISTORY_MAX = 360;   // 10 s x 360 = one hour of session history

/** Parse Prometheus text exposition into Map(name → [{labels, value}]). Comments skipped. */
function parseProm(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    if (!line || line[0] === '#') continue;
    const sp = line.lastIndexOf(' ');
    if (sp < 0) continue;
    const value = Number(line.slice(sp + 1));
    if (!Number.isFinite(value)) continue;
    let name = line.slice(0, sp);
    const labels = {};
    const brace = name.indexOf('{');
    if (brace >= 0) {
      const labelStr = name.slice(brace + 1, name.lastIndexOf('}'));
      name = name.slice(0, brace);
      for (const m of labelStr.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g)) {
        labels[m[1]] = m[2].replace(/\\(["\\n])/g, x => (x === '\\n' ? '\n' : x[1]));
      }
    }
    if (!out.has(name)) out.set(name, []);
    out.get(name).push({ labels, value });
  }
  return out;
}

/** Sum of every sample of a metric (collapses label sets), or null if absent. */
function sum(map, name) {
  const rows = map.get(name);
  if (!rows || !rows.length) return null;
  return rows.reduce((a, r) => a + r.value, 0);
}

/** First sample's value, or null. For single-sample gauges. */
function firstValue(map, name) {
  const rows = map.get(name);
  return rows && rows.length ? rows[0].value : null;
}

function fmtBytes(b) {
  if (b === null) return '—';
  if (b >= 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  if (b >= 1024 * 1024) return Math.round(b / (1024 * 1024)) + ' MB';
  return Math.round(b / 1024) + ' kB';
}

function fmtUptime(seconds) {
  if (seconds === null || seconds < 0) return '—';
  const d = Math.floor(seconds / 86400), hh = Math.floor((seconds % 86400) / 3600), mm = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} d ${hh} h`;
  if (hh > 0) return `${hh} h ${mm} min`;
  return `${mm} min`;
}

/** The memory in actual use in the poster face, and the three numbers it is read against. */
function Headline({ realUse, heapUsed, external, rss }) {
  return html`
    <${Stack} gap="none">
      <${Label} block>${M('realUse')}<//>
      <${Figure} large n=${fmtBytes(realUse)} />
      <${Stack} gap="none" above="small">
        <${Note} kind="meta" mono><${Tinted} strong>${fmtBytes(heapUsed)}<//> ${M('heroJs')}<//>
        <${Note} kind="meta" mono><${Tinted} strong>${fmtBytes(external)}<//> ${M('heroBuffers')}<//>
        <${Note} kind="meta" mono><${Tinted} strong>${fmtBytes(rss)}<//> ${M('heroReserve')}<//>
      <//>
    <//>`;
}

export default function MetricsTab() {
  const [state, setState] = useState({ status: 'loading' });   // loading | disabled | denied | ok | error
  const [filter, setFilter] = useState('');
  const [toast, showErr, , clearToast] = useToast();
  // Last two samples for rate math + memory history for the line.
  const samplesRef = useRef({ prev: null, curr: null });
  const historyRef = useRef({ real: [] });

  // This ref kept `load` stable before useToast memoized its callbacks. Previously every
  // completed poll restarted the effect, measured at 250 requests in 60 s before this guard.
  const showErrRef = useRef(showErr);
  showErrRef.current = showErr;

  const load = useCallback(async () => {
    try {
      const text = await api.getMetricsText();
      const parsed = parseProm(text);
      const now = Date.now();
      const s = samplesRef.current;
      s.prev = s.curr;
      s.curr = { at: now, parsed };
      const heapNow = firstValue(parsed, 'nodejs_heap_size_used_bytes');
      const extNow = firstValue(parsed, 'nodejs_external_memory_bytes');
      const real = heapNow !== null && extNow !== null ? heapNow + extNow : heapNow;
      if (real !== null) {
        const arr = historyRef.current.real;
        arr.push(real);
        if (arr.length > HISTORY_MAX) arr.shift();
      }
      setState({ status: 'ok', at: now });
    } catch (e) {
      if (e.code === 'FEATURE_DISABLED') setState({ status: 'disabled' });
      else if (e.code === 'ACCESS_DENIED') setState({ status: 'denied' });
      else { setState(st => (st.status === 'ok' ? st : { status: 'error' })); showErrRef.current(e.message); }
    }
  }, []);

  // Poll while visible. The interval is the point of this page (it computes rates from
  // deltas), so it is deliberate, announced in the header, and stops when hidden.
  useEffect(() => {
    let timer = null;
    const start = () => { if (!timer) { load(); timer = setInterval(load, POLL_MS); } };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVis = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener('visibilitychange', onVis);
    return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  useEffect(() => {
    const handler = () => { if (!document.hidden) load(); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  if (state.status === 'loading') return html`<${Spinner} text=${M('loading')} />`;

  if (state.status === 'disabled' || state.status === 'denied') {
    return html`
      <${Section} first num="01" title=${M('nowTitle')}>
        <${Box} tone="dim">
          <${Stack} gap="medium">
            <${Note} kind="lead">${state.status === 'disabled' ? M('disabled') : M('denied')}<//>
            ${state.status === 'disabled' && html`<${Note} kind="lead">${M('disabledHint')} <${Code}>AIMEAT_METRICS_ENABLED=true<//><//>`}
          <//>
        <//>
      <//>`;
  }

  const { prev, curr } = samplesRef.current;
  const m = curr?.parsed;
  if (!m) return html`<${Spinner} text=${M('loading')} />`;

  const rss = firstValue(m, 'process_resident_memory_bytes');
  const heapUsed = firstValue(m, 'nodejs_heap_size_used_bytes');
  const heapTotal = firstValue(m, 'nodejs_heap_size_total_bytes');
  const external = firstValue(m, 'nodejs_external_memory_bytes');
  const startTime = firstValue(m, 'process_start_time_seconds');
  const uptime = startTime !== null ? Date.now() / 1000 - startTime : null;
  const lagP50 = firstValue(m, 'nodejs_eventloop_lag_p50_seconds');
  const lagP99 = firstValue(m, 'nodejs_eventloop_lag_p99_seconds');
  const httpTotal = sum(m, 'aimeat_http_requests_total');

  // The ledger: what the process HOLDS (the headline) against what the operating system has LENT
  // it. RSS is a current count, not a high-water mark, and it includes pages the program already
  // freed that the allocator kept for reuse — which is why it reads as a leak and is not one. The
  // "freed and native" row is the remainder, so the column adds up by construction.
  const realUse = heapUsed !== null && external !== null ? heapUsed + external : heapUsed;
  const heapHeadroom = heapTotal !== null && heapUsed !== null ? Math.max(0, heapTotal - heapUsed) : null;
  const freedNative = rss !== null && heapTotal !== null && external !== null
    ? Math.max(0, rss - heapTotal - external) : null;
  const ledgerRows = [
    { key: 'js', label: M('ledgerJs'), value: heapUsed, hint: M('ledgerJsHint') },
    { key: 'headroom', label: M('ledgerHeadroom'), value: heapHeadroom, hint: M('ledgerHeadroomHint') },
    { key: 'external', label: M('ledgerExternal'), value: external, hint: M('ledgerExternalHint') },
    { key: 'other', label: M('ledgerOther'), value: freedNative, hint: M('ledgerOtherHint') },
  ].map(r => ({ ...r, pct: r.value !== null && rss ? (r.value / rss) * 100 : 0 }));

  // Rates from the delta between the last two polls.
  let cpuPct = null, reqPerSec = null;
  if (prev) {
    const dt = (curr.at - prev.at) / 1000;
    if (dt > 0) {
      // Each pair guards for null: an absent metric must read as "—", never as a zero rate.
      const cpuNow = sum(m, 'process_cpu_seconds_total'), cpuPrev = sum(prev.parsed, 'process_cpu_seconds_total');
      if (cpuNow !== null && cpuPrev !== null) cpuPct = Math.max(0, ((cpuNow - cpuPrev) / dt) * 100);
      const reqPrev = sum(prev.parsed, 'aimeat_http_requests_total');
      if (httpTotal !== null && reqPrev !== null) reqPerSec = Math.max(0, (httpTotal - reqPrev) / dt);
    }
  }

  // Routes by method AND route: POST /v1/memory and GET /v1/memory are different work, and the
  // label carries both. The share is of every call this process has answered, which is what the
  // column header names, so the bar and the number are the same measurement.
  const routeRows = (() => {
    const byRoute = new Map();
    for (const r of m.get('aimeat_http_requests_total') ?? []) {
      const key = `${r.labels.method || '?'} ${r.labels.route || '?'}`;
      byRoute.set(key, (byRoute.get(key) || 0) + r.value);
    }
    const prevByRoute = new Map();
    if (prev) for (const r of prev.parsed.get('aimeat_http_requests_total') ?? []) {
      const key = `${r.labels.method || '?'} ${r.labels.route || '?'}`;
      prevByRoute.set(key, (prevByRoute.get(key) || 0) + r.value);
    }
    const dt = prev ? (curr.at - prev.at) / 1000 : 0;
    const total = Math.max(1, httpTotal ?? 0);
    return [...byRoute.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
      .map(([route, n]) => ({
        route, n,
        rate: prev && dt > 0 && prevByRoute.has(route) ? Math.max(0, (n - prevByRoute.get(route)) / dt) : null,
        pct: (n / total) * 100,
      }));
  })();
  const shownCalls = routeRows.reduce((a, r) => a + r.n, 0);

  const refusals = [
    { key: 'auth', n: sum(m, 'aimeat_auth_failures_total') ?? 0, name: M('refAuth'), why: M('refAuthWhy'), metric: 'aimeat_auth_failures_total' },
    { key: 'rate', n: sum(m, 'aimeat_rate_limit_hits_total') ?? 0, name: M('refRate'), why: M('refRateWhy'), metric: 'aimeat_rate_limit_hits_total' },
    { key: 'scope', n: sum(m, 'aimeat_scope_denials_total') ?? 0, name: M('refScope'), why: M('refScopeWhy'), metric: 'aimeat_scope_denials_total' },
  ];

  // The filterable raw table (every parsed sample) for the long tail of metrics. The node's own
  // name and version are on every sample and say nothing here, so they are dropped.
  const allRows = (() => {
    const needle = filter.trim().toLowerCase();
    const rows = [];
    for (const [name, samples] of m) {
      for (const s of samples) {
        const labelText = Object.entries(s.labels)
          .filter(([k]) => k !== 'node_id' && k !== 'version')
          .map(([k, v]) => `${k}="${v}"`).join(' ');
        if (needle && !`${name} ${labelText}`.toLowerCase().includes(needle)) continue;
        rows.push({ name, labelText, value: s.value });
        if (rows.length >= 200) return rows;
      }
    }
    return rows;
  })();
  const sampleTotal = [...m.values()].reduce((a, s) => a + s.length, 0);

  const hist = historyRef.current.real;
  const cell = (key, value, label, sub) => ({ key, n: value, label, sub });

  /** The foot under a list: how much of it is shown, and the mono note on what it counts. */
  const foot = (shown, note) => html`
    <${Row} wrap justify="between" align="baseline" above="medium">
      <${Note} kind="meta" inline>${shown}<//>
      <${Note} kind="meta" inline mono>${note}<//>
    <//>`;

  return html`
    <${Fragment}>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

      <${Section} first num="01" title=${M('nowTitle')} doors=${html`<${Mark} tone="coral" live>${M('pollNote')}<//>`}>
        <${Beside} start narrow side=${html`<${Headline} realUse=${realUse} heapUsed=${heapUsed} external=${external} rss=${rss} />`}>
          ${hist.length > 1 ? html`
            <${TrendLine} area label=${M('chartLabel')} note=${M('chartNote')} points=${hist}
              readAt=${(i) => fmtBytes(hist[i])}
              ends=${[`${fmtBytes(hist[0])} · ${M('chartOldest')}`, `${fmtBytes(hist[hist.length - 1])} · ${M('chartNow')}`]} />
          ` : html`<${Box} tone="dim"><${Note} kind="lead">${M('chartWait')}<//><//>`}
        <//>

        <${FigureStrip} wrap items=${[
    cell('cpu', cpuPct === null ? '—' : cpuPct.toFixed(1) + ' %', M('cpu'), cpuPct === null ? M('needsTwoSamples') : M('betweenReadings')),
    cell('lag', lagP50 === null ? '—' : (lagP50 * 1000).toFixed(1) + ' ms', M('eventloop'), lagP99 === null ? '' : `p99 ${(lagP99 * 1000).toFixed(1)} ms`),
    cell('req', reqPerSec === null ? '—' : reqPerSec.toFixed(1) + '/s', M('reqRate'), httpTotal === null ? M('needsTwoSamples') : M('sinceBootN', { n: num(Math.round(httpTotal)) })),
    cell('up', fmtUptime(uptime), M('uptime'), M('sinceStart')),
  ]} />
      <//>

      <${Section} num="02" title=${M('ledgerTitle')}>
        <${Note} kind="lead">${M('ledgerIntro')}<//>
        <${List} cols="name-n-bar-desc" labels head=${[
    M('ledgerPart'), { label: M('value'), num: true }, M('shareOf', { max: fmtBytes(rss) }), M('ledgerMeaning'),
  ]}>
          ${ledgerRows.map(r => html`
            <${ListRow} key=${r.key}>
              <${Name}>${r.label}<//>
              <${Num}>${fmtBytes(r.value)}<//>
              <${Cell}><${Meter} thin pct=${r.pct} /><//>
              <${Desc}>${r.hint}<//>
            <//>`)}
        <//>
        ${/* The total is measured, not a part of the stack: it stands under the heavy rule, and its
              bar is ink rather than the parts' colour. */ ''}
        <${Split} heavy pad="none" above="none">
          <${List} cols="name-n-bar-desc">
            <${ListRow}>
              <${Name}>${M('rss')}<//>
              <${Num}>${fmtBytes(rss)}<//>
              <${Cell}><${Meter} thin pct=${100} tone="ink" /><//>
              <${Desc}>${M('ledgerRssHint')}<//>
            <//>
          <//>
        <//>
      <//>

      <${Section} num="03" title=${M('routesTitle')}>
        <${Note} kind="lead">${M('routesLead')}<//>
        <${List} cols="name-n-n-bar" labels head=${[
    M('route'), { label: M('requests'), num: true }, { label: M('perSec'), num: true }, M('shareOf', { max: num(Math.round(httpTotal ?? 0)) }),
  ]}>
          ${routeRows.map(r => html`
            <${ListRow} key=${r.route}>
              <${Name} code>${r.route}<//>
              <${Num}>${num(Math.round(r.n))}<//>
              <${Num} quiet>${r.rate === null ? '—' : r.rate.toFixed(2)}<//>
              <${Cell}><${Meter} thin pct=${r.pct} /><//>
            <//>`)}
        <//>
        ${foot(M('routesShown', { n: num(routeRows.length), calls: num(Math.round(shownCalls)), total: num(Math.round(httpTotal ?? 0)) }), M('routesNote'))}
      <//>

      <${Section} num="04" title=${M('refusedTitle')}>
        <${Note} kind="lead">${M('refusedLead')}<//>
        <${Readings} rows=${refusals.map((r, i) => ({
    key: r.key,
    name: r.name,
    why: r.why,
    mark: html`<${Figure} small end n=${num(r.n)} />`,
    value: r.metric,
    last: i === refusals.length - 1,
  }))} />
      <//>

      <${Section} num="05" title=${M('allMetrics')}
        doors=${html`<${Action} small href="/v1/metrics" newTab>${M('openScrape')}<//>`}>
        <${Note} kind="lead">${M('allLead')}<//>
        <${SearchLine} find value=${filter} onInput=${e => setFilter(e.target.value)} placeholder=${M('filterPh')} />
        <${List} cols="name-n-desc" labels head=${[M('metric'), { label: M('value'), num: true }, M('labels')]}>
          ${allRows.map((r, i) => html`
            <${ListRow} key=${r.name + i}>
              <${Name} code>${r.name}<//>
              <${Num}>${r.value % 1 === 0 ? num(r.value) : r.value.toFixed(3)}<//>
              <${Desc}><${Note} kind="meta" inline mono>${r.labelText}<//><//>
            <//>`)}
        <//>
        ${foot(M('allShown', { n: num(allRows.length), total: num(sampleTotal) }), M('allNote'))}
      <//>
    <//>
  `;
}
