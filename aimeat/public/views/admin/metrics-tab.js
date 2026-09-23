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
 *   instructions rather than an error.
 * @structure
 *   - parseProm(text)        -- Prometheus text exposition → Map(name → [{labels, value}])
 *   - sum/firstValue         -- read helpers over the parsed map
 *   - fmtBytes/fmtUptime     -- the two number formats this page speaks
 *   - Line                   -- the session-history chart (the shared chart; its tooltip reads a point)
 *   - MetricsTab (default)   -- the five sections
 * @version-history
 *   v2.2.0 -- 2026-09-22 -- Composed from the shared component set: sections, a numeral band, the
 *     ledger as a shared table, the routes, refusals and raw samples as shared list rows with
 *     progress meters, the filter as the toolbar, and the line drawn by the shared chart; the
 *     page's own sheet is gone.
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
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, Spinner, useToast, Toast } from './shared.js';
import { Section, Columns, Stack, Text, Action, Chip, NumeralBand, Toolbar, Table, ListRow, Meter, Surface } from '/components/poster-parts.js';
import { UsageChart, colorForIndex } from '/components/UsageChart.js';
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

/**
 * The session's own readings of one number, drawn by the shared chart; its tooltip reads the point
 * under the cursor. No time axis: the poll stops while the tab is hidden, so readings times ten
 * seconds is not elapsed time and the ends say oldest and now.
 */
function Line({ points }) {
  const datasets = [{
    label: M('realUse'),
    data: points,
    borderColor: colorForIndex(0),
    backgroundColor: colorForIndex(0),
    pointRadius: 0,
    borderWidth: 2,
  }];
  return html`<${UsageChart} type="line" labels=${points.map(() => '')} datasets=${datasets}
    height=${150} legend=${false} yFormat=${fmtBytes} />`;
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
    return html`<${Section} title=${M('nowTitle')} count="01">
      <${Surface} kind="aside">
        <${Stack} density="compact">
          <${Text}>${state.status === 'disabled' ? M('disabled') : M('denied')}<//>
          ${state.status === 'disabled' && html`<${Text}>${M('disabledHint')} <${Text} kind="mono">AIMEAT_METRICS_ENABLED=true<//><//>`}
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
  const cell = (value, label, sub) => ({ label, value, note: sub });
  const bar = (pct) => html`<${Meter} kind="progress" value=${pct} max=${100} label=${pct.toFixed(1) + ' %'} />`;

  return html`
    <div>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

      <${Section} title=${M('nowTitle')} count="01" actions=${html`<${Chip} tone="coral">${M('pollNote')}<//>`}>
        <${Columns} layout="trailing" collapse=${900} density="roomy">
          <${Stack} density="compact">
            <${Text} kind="label">${M('realUse')}<//>
            <${Text} kind="number" size="large">${fmtBytes(realUse)}<//>
            <${Text} kind="mono" tone="muted">${fmtBytes(heapUsed)} ${M('heroJs')}<//>
            <${Text} kind="mono" tone="muted">${fmtBytes(external)} ${M('heroBuffers')}<//>
            <${Text} kind="mono" tone="muted">${fmtBytes(rss)} ${M('heroReserve')}<//>
          <//>

          ${hist.length > 1 ? html`
            <${Stack} density="compact">
              <${Stack} direction="wrap" align="between">
                <${Text} kind="label">${M('chartLabel')}<//>
                <${Text} kind="mono" tone="muted">${M('chartNote')}<//>
              <//>
              <${Line} points=${hist} />
              <${Stack} direction="wrap" align="between">
                <${Text} kind="mono" tone="muted">${fmtBytes(hist[0])} · ${M('chartOldest')}<//>
                <${Text} kind="mono" tone="muted">${fmtBytes(hist[hist.length - 1])} · ${M('chartNow')}<//>
              <//>
            <//>
          ` : html`<${Surface} kind="box"><${Text}>${M('chartWait')}<//><//>`}
        <//>

        <${NumeralBand} tone="plain" size="small" items=${[
    cell(cpuPct === null ? '—' : cpuPct.toFixed(1) + ' %', M('cpu'), cpuPct === null ? M('needsTwoSamples') : M('betweenReadings')),
    cell(lagP50 === null ? '—' : (lagP50 * 1000).toFixed(1) + ' ms', M('eventloop'), lagP99 === null ? '' : `p99 ${(lagP99 * 1000).toFixed(1)} ms`),
    cell(reqPerSec === null ? '—' : reqPerSec.toFixed(1) + '/s', M('reqRate'), httpTotal === null ? M('needsTwoSamples') : M('sinceBootN', { n: num(Math.round(httpTotal)) })),
    cell(fmtUptime(uptime), M('uptime'), M('sinceStart')),
  ]} />
      <//>

      <${Section} title=${M('ledgerTitle')} count="02" description=${M('ledgerIntro')}>
        <${Table} density="compact" collapse=${600} label=${M('ledgerTitle')}
          headers=${[M('ledgerPart'), M('value'), M('shareOf', { max: fmtBytes(rss) }), M('ledgerMeaning')]}
          rows=${[
    ...ledgerRows.map(r => [html`<strong>${r.label}</strong>`, { text: fmtBytes(r.value), align: 'end', mono: true }, bar(r.pct), r.hint]),
    [html`<strong>${M('rss')}</strong>`, { text: fmtBytes(rss), align: 'end', mono: true }, bar(100), M('ledgerRssHint')],
  ]} />
      <//>

      <${Section} title=${M('routesTitle')} count="03" description=${M('routesLead')}>
        <${Stack}>
          <${Table} density="compact" label=${M('routesTitle')}
            headers=${[M('route'), M('requests'), M('perSec'), M('shareOf', { max: num(Math.round(httpTotal ?? 0)) })]}
            rows=${routeRows.map(r => [
    { text: r.route, mono: true },
    { text: num(Math.round(r.n)), align: 'end' },
    { text: r.rate === null ? '—' : r.rate.toFixed(2), align: 'end' },
    bar(r.pct),
  ])} />
          <${Stack} direction="wrap" align="between">
            <${Text} kind="caption" tone="muted">${M('routesShown', { n: num(routeRows.length), calls: num(Math.round(shownCalls)), total: num(Math.round(httpTotal ?? 0)) })}<//>
            <${Text} kind="mono" tone="muted">${M('routesNote')}<//>
          <//>
        <//>
      <//>

      <${Section} title=${M('refusedTitle')} count="04" description=${M('refusedLead')}>
        <div>
          ${refusals.map(r => html`<${ListRow} key=${r.key} name=${r.name} detail=${r.why} detailKind="text"
            value=${html`<${Stack} density="compact" align="end">
              <${Text} kind="number" size="small">${num(r.n)}<//>
              <${Text} kind="mono" tone="muted">${r.metric}<//>
            <//>`} />`)}
        </div>
      <//>

      <${Section} title=${M('allMetrics')} count="05" description=${M('allLead')}
        actions=${html`<${Action} href="/v1/metrics" target="_blank">${M('openScrape')}<//>`}>
        <${Toolbar} label=${M('allMetrics')}
          search=${{ ariaLabel: M('filterPh'), placeholder: M('filterPh'), value: filter, onInput: e => setFilter(e.target.value) }} />
        <div>
          ${allRows.map((r, i) => html`<${ListRow} key=${r.name + i} density="compact" name=${r.name}
            detail=${r.labelText || null} value=${r.value % 1 === 0 ? num(r.value) : r.value.toFixed(3)} />`)}
        </div>
        <${Stack} direction="wrap" align="between">
          <${Text} kind="caption" tone="muted">${M('allShown', { n: num(allRows.length), total: num(sampleTotal) })}<//>
          <${Text} kind="mono" tone="muted">${M('allNote')}<//>
        <//>
      <//>
    </div>
  `;
}
