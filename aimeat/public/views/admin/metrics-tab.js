/**
 * @file metrics-tab.js
 * @description Admin dashboard Metrics tab — the node's live process metrics read from the
 *   Prometheus endpoint (/v1/metrics) and rendered as cards instead of raw exposition text.
 *   Memory is the headline: RSS, V8 heap used/total, and external memory (WASM sandboxes +
 *   buffers) each with a session sparkline. Rates (CPU %, requests/s, per-interval avg
 *   latency) are computed client-side from the delta between two polls. Polls every 10 s
 *   while the page is visible; a FEATURE_DISABLED response renders enable instructions
 *   rather than an error.
 * @structure
 *   - parseProm(text)        -- Prometheus text exposition → Map(name → [{labels, value}])
 *   - sum/firstValue         -- read helpers over the parsed map
 *   - Sparkline              -- inline-SVG session history for one series
 *   - MetricsTab (default)   -- cards + HTTP routes table + security counters + all-metrics filter
 * @version-history
 *   v1.1.0 — 2026-08-17 — The headline is "Memory in actual use" (heap used + external), and a
 *     memory-ledger table explains every component in plain language — including that RSS is a
 *     high-water mark inflated by freed-but-retained allocator pages, which kept being read as a
 *     leak. RSS moves off the cards into the ledger's total row.
 *   v1.0.0 — 2026-08-17 — Initial: memory/CPU/event-loop cards, HTTP top routes with req/s,
 *     security counters, filterable raw metric table, 10 s visible-only poll.
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, StatCard, Spinner, useToast, Toast } from './shared.js';
import * as api from '/js/services/admin.js';

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

/** Tiny session-history line: recessive stroke, emphasized endpoint dot. */
function Sparkline({ points }) {
  if (!points || points.length < 2) return null;
  const w = 120, hgt = 28, pad = 2;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const step = (w - pad * 2) / (points.length - 1);
  const y = v => hgt - pad - ((v - min) / span) * (hgt - pad * 2);
  const path = points.map((v, i) => `${(pad + i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const lastX = pad + (points.length - 1) * step, lastY = y(points[points.length - 1]);
  return html`<svg class="adm-metrics-spark" viewBox="0 0 ${w} ${hgt}" width=${w} height=${hgt} aria-hidden="true">
    <polyline points=${path} fill="none" stroke-width="1.5" />
    <circle cx=${lastX.toFixed(1)} cy=${lastY.toFixed(1)} r="2.5" />
  </svg>`;
}

export default function MetricsTab() {
  const [state, setState] = useState({ status: 'loading' });   // loading | disabled | denied | ok | error
  const [filter, setFilter] = useState('');
  const [toast, showErr, , clearToast] = useToast();
  // Last two samples for rate math + memory history for the sparklines.
  const samplesRef = useRef({ prev: null, curr: null });
  const historyRef = useRef({ real: [], heap: [], external: [] });

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
      const at = Date.now();
      const s = samplesRef.current;
      s.prev = s.curr;
      s.curr = { at, parsed };
      const hist = historyRef.current;
      const push = (arr, v) => { if (v !== null) { arr.push(v); if (arr.length > HISTORY_MAX) arr.shift(); } };
      const heapNow = firstValue(parsed, 'nodejs_heap_size_used_bytes');
      const extNow = firstValue(parsed, 'nodejs_external_memory_bytes');
      push(hist.real, heapNow !== null && extNow !== null ? heapNow + extNow : heapNow);
      push(hist.heap, heapNow);
      push(hist.external, extNow);
      setState({ status: 'ok', at });
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

  if (state.status === 'loading') return html`<${Spinner} text=${t('admin.metrics.loading')} />`;

  if (state.status === 'disabled' || state.status === 'denied') {
    return html`<div>
      <div class="section-title">${t('admin.metrics.title')}</div>
      <div class="adm-card adm-metrics-off">
        <p>${state.status === 'disabled' ? t('admin.metrics.disabled') : t('admin.metrics.denied')}</p>
        ${state.status === 'disabled' && html`<p class="adm-metrics-off-hint">${t('admin.metrics.disabledHint')} <code>AIMEAT_METRICS_ENABLED=true</code></p>`}
      </div>
    </div>`;
  }

  const { prev, curr } = samplesRef.current;
  const m = curr?.parsed;
  if (!m) return html`<${Spinner} text=${t('admin.metrics.loading')} />`;

  const rss = firstValue(m, 'process_resident_memory_bytes');
  const heapUsed = firstValue(m, 'nodejs_heap_size_used_bytes');
  const heapTotal = firstValue(m, 'nodejs_heap_size_total_bytes');
  const external = firstValue(m, 'nodejs_external_memory_bytes');
  const startTime = firstValue(m, 'process_start_time_seconds');
  const uptime = startTime !== null ? Date.now() / 1000 - startTime : null;
  const lagP50 = firstValue(m, 'nodejs_eventloop_lag_p50_seconds');
  const lagP99 = firstValue(m, 'nodejs_eventloop_lag_p99_seconds');
  const httpTotal = sum(m, 'aimeat_http_requests_total');

  // The memory ledger: what the process HOLDS (the headline) versus what the OS has LENT it
  // (RSS, a high-water mark that includes freed-but-retained allocator pages). The "freed and
  // native" row is the remainder — RSS minus everything the runtime can account for.
  const realUse = heapUsed !== null && external !== null ? heapUsed + external : heapUsed;
  const heapHeadroom = heapTotal !== null && heapUsed !== null ? Math.max(0, heapTotal - heapUsed) : null;
  const freedNative = rss !== null && heapTotal !== null && external !== null
    ? Math.max(0, rss - heapTotal - external) : null;
  const ledgerRows = [
    { key: 'js', label: t('admin.metrics.ledgerJs'), value: heapUsed, hint: t('admin.metrics.ledgerJsHint') },
    { key: 'headroom', label: t('admin.metrics.ledgerHeadroom'), value: heapHeadroom, hint: t('admin.metrics.ledgerHeadroomHint') },
    { key: 'external', label: t('admin.metrics.ledgerExternal'), value: external, hint: t('admin.metrics.ledgerExternalHint') },
    { key: 'other', label: t('admin.metrics.ledgerOther'), value: freedNative, hint: t('admin.metrics.ledgerOtherHint') },
    { key: 'rss', label: t('admin.metrics.rss'), value: rss, hint: t('admin.metrics.ledgerRssHint') },
  ].map(r => ({ ...r, pct: r.value !== null && rss ? Math.round((r.value / rss) * 100) : 0 }));

  // Rates from the delta between the last two polls.
  let cpuPct = null, reqPerSec = null, intervalAvgMs = null;
  if (prev) {
    const dt = (curr.at - prev.at) / 1000;
    if (dt > 0) {
      // Each pair guards for null: an absent metric must read as "—", never as a zero rate.
      const cpuNow = sum(m, 'process_cpu_seconds_total'), cpuPrev = sum(prev.parsed, 'process_cpu_seconds_total');
      if (cpuNow !== null && cpuPrev !== null) cpuPct = Math.max(0, ((cpuNow - cpuPrev) / dt) * 100);
      const reqPrev = sum(prev.parsed, 'aimeat_http_requests_total');
      if (httpTotal !== null && reqPrev !== null) reqPerSec = Math.max(0, (httpTotal - reqPrev) / dt);
      const sNow = sum(m, 'aimeat_http_request_duration_ms_sum'), sPrev = sum(prev.parsed, 'aimeat_http_request_duration_ms_sum');
      const cNow = sum(m, 'aimeat_http_request_duration_ms_count'), cPrev = sum(prev.parsed, 'aimeat_http_request_duration_ms_count');
      if (sNow !== null && sPrev !== null && cNow !== null && cPrev !== null && cNow - cPrev > 0) {
        intervalAvgMs = (sNow - sPrev) / (cNow - cPrev);
      }
    }
  }
  const overallAvgMs = (() => {
    const s = sum(m, 'aimeat_http_request_duration_ms_sum'), c = sum(m, 'aimeat_http_request_duration_ms_count');
    return s !== null && c ? s / c : null;
  })();

  // Top routes by total requests, with a per-interval rate when a previous sample exists.
  const routeRows = (() => {
    const byRoute = new Map();
    for (const r of m.get('aimeat_http_requests_total') ?? []) {
      const key = r.labels.route || '?';
      byRoute.set(key, (byRoute.get(key) || 0) + r.value);
    }
    const prevByRoute = new Map();
    if (prev) for (const r of prev.parsed.get('aimeat_http_requests_total') ?? []) {
      const key = r.labels.route || '?';
      prevByRoute.set(key, (prevByRoute.get(key) || 0) + r.value);
    }
    const maxN = Math.max(1, ...byRoute.values());
    const dt = prev ? (curr.at - prev.at) / 1000 : 0;
    return [...byRoute.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
      .map(([route, n]) => ({
        route, n,
        rate: prev && dt > 0 && prevByRoute.has(route) ? Math.max(0, (n - prevByRoute.get(route)) / dt) : null,
        pct: Math.round((n / maxN) * 100),
      }));
  })();

  // Filterable raw table (every parsed sample) for the long tail of metrics.
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

  // NOT class="adm": that is the dashboard SHELL's flex-row class (sidebar + main), and a
  // nested .adm lays the tab's sections out as one horizontal row of full-height columns.
  const hist = historyRef.current;
  return html`<div>
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <div class="adm-section-head">
      <div>
        <div class="section-title">${t('admin.metrics.title')}</div>
        <div class="section-desc">${t('admin.metrics.desc')}</div>
      </div>
      <span class="adm-metrics-poll-note">${t('admin.metrics.pollNote')}</span>
    </div>

    <div class="adm-grid adm-grid-4">
      <div class="adm-card">
        <h2>${t('admin.metrics.realUse')}</h2>
        <div class="adm-stat">${fmtBytes(realUse)}</div>
        <div class="adm-stat-label">${t('admin.metrics.realUseHint')}</div>
        <${Sparkline} points=${hist.real} />
      </div>
      <div class="adm-card">
        <h2>${t('admin.metrics.heap')}</h2>
        <div class="adm-stat">${fmtBytes(heapUsed)}</div>
        <div class="adm-stat-label">${t('admin.metrics.heapOf')} ${fmtBytes(heapTotal)}</div>
        <${Sparkline} points=${hist.heap} />
      </div>
      <div class="adm-card">
        <h2>${t('admin.metrics.external')}</h2>
        <div class="adm-stat">${fmtBytes(external)}</div>
        <div class="adm-stat-label">${t('admin.metrics.externalHint')}</div>
        <${Sparkline} points=${hist.external} />
      </div>
      <${StatCard} label=${t('admin.metrics.cpu')}
        value=${cpuPct === null ? '—' : cpuPct.toFixed(1) + ' %'}
        sub=${prev ? null : t('admin.metrics.needsTwoSamples')} />
    </div>

    <div class="adm-card">
      <h2>${t('admin.metrics.ledgerTitle')}</h2>
      <p class="adm-metrics-ledger-intro">${t('admin.metrics.ledgerIntro')}</p>
      <table class="adm-db-table adm-metrics-ledger">
        <thead>
          <tr>
            <th>${t('admin.metrics.ledgerPart')}</th>
            <th class="num">${t('admin.metrics.value')}</th>
            <th>${t('admin.metrics.share')}</th>
            <th>${t('admin.metrics.ledgerMeaning')}</th>
          </tr>
        </thead>
        <tbody>
          ${ledgerRows.map(r => html`<tr key=${r.key}>
            <td>${r.label}</td>
            <td class="num">${fmtBytes(r.value)}</td>
            <td><div class="adm-db-bar-track"><div class="adm-db-bar" style=${`width:${r.pct}%`}></div></div></td>
            <td class="adm-metrics-ledger-hint">${r.hint}</td>
          </tr>`)}
        </tbody>
      </table>
    </div>

    <div class="adm-grid adm-grid-4">
      <${StatCard} label=${t('admin.metrics.uptime')} value=${fmtUptime(uptime)} />
      <${StatCard} label=${t('admin.metrics.eventloop')}
        value=${lagP50 === null ? '—' : (lagP50 * 1000).toFixed(1) + ' ms'}
        sub=${lagP99 === null ? null : `p99 ${(lagP99 * 1000).toFixed(1)} ms`} />
      <${StatCard} label=${t('admin.metrics.reqRate')}
        value=${reqPerSec === null ? '—' : reqPerSec.toFixed(1) + '/s'}
        sub=${httpTotal === null ? null : `${num(Math.round(httpTotal))} ${t('admin.metrics.sinceBoot')}`} />
      <${StatCard} label=${t('admin.metrics.avgLatency')}
        value=${intervalAvgMs === null ? (overallAvgMs === null ? '—' : Math.round(overallAvgMs) + ' ms') : Math.round(intervalAvgMs) + ' ms'}
        sub=${intervalAvgMs === null && overallAvgMs !== null ? t('admin.metrics.sinceBoot') : null} />
    </div>

    <div class="adm-grid adm-grid-3">
      <${StatCard} label=${t('admin.metrics.authFailures')} value=${num(sum(m, 'aimeat_auth_failures_total') ?? 0)} sub=${t('admin.metrics.sinceBoot')} />
      <${StatCard} label=${t('admin.metrics.rateLimitHits')} value=${num(sum(m, 'aimeat_rate_limit_hits_total') ?? 0)} sub=${t('admin.metrics.sinceBoot')} />
      <${StatCard} label=${t('admin.metrics.scopeDenials')} value=${num(sum(m, 'aimeat_scope_denials_total') ?? 0)} sub=${t('admin.metrics.sinceBoot')} />
    </div>

    <div class="adm-card">
      <h2>${t('admin.metrics.topRoutes')}</h2>
      <table class="adm-db-table">
        <thead>
          <tr>
            <th>${t('admin.metrics.route')}</th>
            <th class="num">${t('admin.metrics.requests')}</th>
            <th class="num">${t('admin.metrics.perSec')}</th>
            <th>${t('admin.metrics.share')}</th>
          </tr>
        </thead>
        <tbody>
          ${routeRows.map(r => html`<tr key=${r.route}>
            <td class="adm-metrics-route">${r.route}</td>
            <td class="num">${num(Math.round(r.n))}</td>
            <td class="num">${r.rate === null ? '—' : r.rate.toFixed(2)}</td>
            <td><div class="adm-db-bar-track"><div class="adm-db-bar" style=${`width:${r.pct}%`}></div></div></td>
          </tr>`)}
        </tbody>
      </table>
    </div>

    <div class="adm-card">
      <div class="adm-section-head">
        <h2>${t('admin.metrics.allMetrics')}</h2>
        <input class="input-field adm-metrics-filter" type="search" placeholder=${t('admin.metrics.filterPh')}
          value=${filter} onInput=${e => setFilter(e.target.value)} />
      </div>
      <table class="adm-db-table adm-metrics-all">
        <thead>
          <tr>
            <th>${t('admin.metrics.metric')}</th>
            <th>${t('admin.metrics.labels')}</th>
            <th class="num">${t('admin.metrics.value')}</th>
          </tr>
        </thead>
        <tbody>
          ${allRows.map((r, i) => html`<tr key=${r.name + i}>
            <td class="adm-metrics-route">${r.name}</td>
            <td class="adm-metrics-labels">${r.labelText}</td>
            <td class="num">${r.value % 1 === 0 ? num(r.value) : r.value.toFixed(3)}</td>
          </tr>`)}
        </tbody>
      </table>
    </div>
  </div>`;
}
