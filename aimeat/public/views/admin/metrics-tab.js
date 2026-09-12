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
 *   - Line                   -- the session-history chart with a reading under the cursor
 *   - MetricsTab (default)   -- the five sections
 * @version-history
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
import { useViewCSS } from '/components/useViewCSS.js';
import { num, Spinner, useToast, Toast } from './shared.js';
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

const W = 720, H = 150;

/**
 * The session's own readings of one number: a sun ground under an ink line, the newest reading
 * marked. The cursor reads the point nearest to it. No time axis: the poll stops while the tab is
 * hidden, so readings times ten seconds is not elapsed time and the ends say oldest and now.
 */
function Line({ points, at, onPick }) {
  const lo = Math.min(...points), hi = Math.max(...points);
  const span = Math.max(1, hi - lo);
  const x = i => (points.length < 2 ? W - 2 : (i / (points.length - 1)) * (W - 2));
  const y = v => H - 12 - ((v - lo) / span) * (H - 26);
  const line = points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `0,${H} ${line} ${x(points.length - 1).toFixed(1)},${H}`;
  const pick = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - box.left) / Math.max(1, box.width);
    onPick(Math.min(points.length - 1, Math.max(0, Math.round(rel * (points.length - 1)))));
  };
  return html`
    <div class="adm-mx-chart">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label=${M('chartLabel')}>
        <polygon class="adm-mx-area" points=${area} />
        <polyline class="adm-mx-line" points=${line} vector-effect="non-scaling-stroke" />
        ${at != null ? html`<line class="adm-mx-cursor" x1=${x(at)} y1="0" x2=${x(at)} y2=${H} vector-effect="non-scaling-stroke" />` : null}
        ${/* The box is scaled to its column, so a circle would draw as an ellipse: the newest
              reading is a tick whose stroke does not scale. */ ''}
        <line class="adm-mx-now" x1=${x(points.length - 1)} y1=${y(points[points.length - 1]) - 7}
          x2=${x(points.length - 1)} y2=${y(points[points.length - 1]) + 7} vector-effect="non-scaling-stroke" />
        <rect class="adm-mx-hit" x="0" y="0" width=${W} height=${H}
          onMouseMove=${pick} onMouseLeave=${() => onPick(null)} />
      </svg>
      ${at != null ? html`<span class="adm-mx-read">${fmtBytes(points[at])}</span>` : null}
    </div>`;
}

export default function MetricsTab() {
  useViewCSS('/css/views/admin-metrics-poster.css');
  const [state, setState] = useState({ status: 'loading' });   // loading | disabled | denied | ok | error
  const [filter, setFilter] = useState('');
  const [at, setAt] = useState(null);
  const [toast, showErr, , clearToast] = useToast();
  // Last two samples for rate math + memory history for the line.
  const samplesRef = useRef({ prev: null, curr: null });
  const historyRef = useRef({ real: [] });

  // useToast returns fresh function identities every render. Reaching showErr through a ref
  // keeps `load` stable ([] deps below): with showErr as a dependency, every completed poll
  // re-rendered, rebuilt `load`, restarted the poll effect, and its immediate load() call made
  // the 10 s poll a continuous one — measured at 250 requests in 60 s before this guard.
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
    return html`<div class="og adm-mx">
      <section class="og-sec og-sec--first">
        <div class="og-sec-h"><h2>${M('nowTitle')}<small>01</small></h2></div>
        <div class="adm-mx-wait">
          <p>${state.status === 'disabled' ? M('disabled') : M('denied')}</p>
          ${state.status === 'disabled' && html`<p>${M('disabledHint')} <code>AIMEAT_METRICS_ENABLED=true</code></p>`}
        </div>
      </section>
    </div>`;
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
  const cell = (value, label, sub) => html`<div><b>${value}</b><span>${label}</span><small>${sub}</small></div>`;

  return html`
    <div class="og adm-mx">
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}

      <section class="og-sec og-sec--first">
        <div class="og-sec-h"><h2>${M('nowTitle')}<small>01</small></h2>
          <span class="adm-mx-live"><i></i>${M('pollNote')}</span></div>

        <div class="adm-mx-top">
          <div>
            <div class="adm-mx-lbl">${M('realUse')}</div>
            <div class="adm-mx-hero">${fmtBytes(realUse)}</div>
            <p class="adm-mx-hero-sub">
              <b>${fmtBytes(heapUsed)}</b> ${M('heroJs')}<br />
              <b>${fmtBytes(external)}</b> ${M('heroBuffers')}<br />
              <b>${fmtBytes(rss)}</b> ${M('heroReserve')}
            </p>
          </div>

          ${hist.length > 1 ? html`
            <div>
              <div class="adm-mx-chart-h">
                <span class="adm-mx-lbl">${M('chartLabel')}</span>
                <small>${M('chartNote')}</small>
              </div>
              <${Line} points=${hist} at=${at} onPick=${setAt} />
              <div class="adm-mx-x">
                <span>${fmtBytes(hist[0])} · ${M('chartOldest')}</span>
                <span>${fmtBytes(hist[hist.length - 1])} · ${M('chartNow')}</span>
              </div>
            </div>
          ` : html`<div class="adm-mx-wait"><p>${M('chartWait')}</p></div>`}
        </div>

        <div class="og-strip">
          ${cell(cpuPct === null ? '—' : cpuPct.toFixed(1) + ' %', M('cpu'), cpuPct === null ? M('needsTwoSamples') : M('betweenReadings'))}
          ${cell(lagP50 === null ? '—' : (lagP50 * 1000).toFixed(1) + ' ms', M('eventloop'), lagP99 === null ? '' : `p99 ${(lagP99 * 1000).toFixed(1)} ms`)}
          ${cell(reqPerSec === null ? '—' : reqPerSec.toFixed(1) + '/s', M('reqRate'), httpTotal === null ? M('needsTwoSamples') : M('sinceBootN', { n: num(Math.round(httpTotal)) }))}
          ${cell(fmtUptime(uptime), M('uptime'), M('sinceStart'))}
        </div>
      </section>

      <section class="og-sec">
        <div class="og-sec-h"><h2>${M('ledgerTitle')}<small>02</small></h2></div>
        <p class="adm-mx-lead">${M('ledgerIntro')}</p>
        <div class="adm-mx-rows adm-mx-ledger">
          <div class="adm-mx-hrow">
            <span>${M('ledgerPart')}</span><span class="r">${M('value')}</span>
            <span>${M('shareOf', { max: fmtBytes(rss) })}</span><span>${M('ledgerMeaning')}</span>
          </div>
          ${ledgerRows.map(r => html`
            <div class="adm-mx-row" key=${r.key}>
              <span class="adm-mx-part">${r.label}</span>
              <span class="adm-mx-val r">${fmtBytes(r.value)}</span>
              <span class="adm-mx-bar"><i style=${`width:${r.pct.toFixed(1)}%`}></i></span>
              <span class="adm-mx-what">${r.hint}</span>
            </div>`)}
          <div class="adm-mx-row adm-mx-row--sum">
            <span class="adm-mx-part">${M('rss')}</span>
            <span class="adm-mx-val r">${fmtBytes(rss)}</span>
            <span class="adm-mx-bar"><i style="width:100%"></i></span>
            <span class="adm-mx-what">${M('ledgerRssHint')}</span>
          </div>
        </div>
      </section>

      <section class="og-sec">
        <div class="og-sec-h"><h2>${M('routesTitle')}<small>03</small></h2></div>
        <p class="adm-mx-lead">${M('routesLead')}</p>
        <div class="adm-mx-rows adm-mx-routes">
          <div class="adm-mx-hrow">
            <span>${M('route')}</span><span class="r">${M('requests')}</span>
            <span class="r">${M('perSec')}</span><span>${M('shareOf', { max: num(Math.round(httpTotal ?? 0)) })}</span>
          </div>
          ${routeRows.map(r => html`
            <div class="adm-mx-row" key=${r.route}>
              <span class="adm-mx-route">${r.route}</span>
              <span class="adm-mx-val r">${num(Math.round(r.n))}</span>
              <span class="adm-mx-rate r">${r.rate === null ? '—' : r.rate.toFixed(2)}</span>
              <span class="adm-mx-bar"><i style=${`width:${r.pct.toFixed(1)}%`}></i></span>
            </div>`)}
        </div>
        <div class="adm-mx-foot">
          <span>${M('routesShown', { n: num(routeRows.length), calls: num(Math.round(shownCalls)), total: num(Math.round(httpTotal ?? 0)) })}</span>
          <span class="adm-mx-note">${M('routesNote')}</span>
        </div>
      </section>

      <section class="og-sec">
        <div class="og-sec-h"><h2>${M('refusedTitle')}<small>04</small></h2></div>
        <p class="adm-mx-lead">${M('refusedLead')}</p>
        <div class="adm-mx-refusals">
          ${refusals.map(r => html`
            <div class="adm-mx-rrow" key=${r.key}>
              <span><b>${num(r.n)}</b><span class="adm-mx-rname">${r.name}</span></span>
              <span class="adm-mx-rwhy">${r.why}</span>
              <span class="adm-mx-rmetric">${r.metric}</span>
            </div>`)}
        </div>
      </section>

      <section class="og-sec">
        <div class="og-sec-h"><h2>${M('allMetrics')}<small>05</small></h2>
          <div class="og-doors"><a class="og-door" href="/v1/metrics" target="_blank" rel="noopener">${M('openScrape')}</a></div></div>
        <p class="adm-mx-lead">${M('allLead')}</p>
        <div class="adm-mx-find">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"></circle><path d="M16 16 L21 21"></path></svg>
          <input type="search" value=${filter} onInput=${e => setFilter(e.target.value)} placeholder=${M('filterPh')} />
        </div>
        <div class="adm-mx-rows adm-mx-raw">
          <div class="adm-mx-hrow">
            <span>${M('metric')}</span><span>${M('labels')}</span><span class="r">${M('value')}</span>
          </div>
          ${allRows.map((r, i) => html`
            <div class="adm-mx-row" key=${r.name + i}>
              <span class="adm-mx-name">${r.name}</span>
              <span class="adm-mx-labels">${r.labelText}</span>
              <span class="adm-mx-val r">${r.value % 1 === 0 ? num(r.value) : r.value.toFixed(3)}</span>
            </div>`)}
        </div>
        <div class="adm-mx-foot">
          <span>${M('allShown', { n: num(allRows.length), total: num(sampleTotal) })}</span>
          <span class="adm-mx-note">${M('allNote')}</span>
        </div>
      </section>
    </div>
  `;
}
