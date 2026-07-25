/**
 * @file live/index.js
 * @description The aimeat-live library (SDK-libs migration Phase 1, TARGET-012). Exposes AIMEAT.live
 *   — the realtime "subscribe to server-pushed domain changes" helper that wraps the node's SSE
 *   transport (POST /v1/events/ticket → GET /v1/events?ticket=) in ONE shared, multi-tab-elected
 *   EventSource (Web Locks + BroadcastChannel) with debounce, Page-Visibility gating and
 *   exponential-backoff reconnect. Subscribers re-fetch only when the server says their domain
 *   changed. Componentized ESM source esbuild bundles to the IIFE served, unchanged, at
 *   /v1/libs/aimeat-live.js. Ported verbatim from lib-live.ts.
 * @structure imports getSession (session) + attach (namespace); the shared EventSource state machine
 *   (connect/startShared/_open/ingest/flush/dispatch/reconnect/disconnect/subscribe); attach('live', …).
 * @usage <script src="/v1/libs/aimeat-auth.js"></script><script src="/v1/libs/aimeat-live.js"></script>
 *   const off = AIMEAT.live.subscribe(['agent-tasks','organisms'], (domains) => reload());
 * @version-history
 *   v1.0.0 — 2026-07-19 — Migrated from src/routes/lib-live.ts (SDK-libs migration Phase 1).
 *   v1.1.0 — 2026-07-25 — subscribe() takes a third options argument: { keyPrefix, agent, ownerScope,
 *     minIntervalMs }. On a multi-agent fleet the 'memory' domain fires continuously, so every
 *     subscriber effectively polled. keyPrefix gates on a cheap server-side COUNT (the change frame
 *     carries no key, so a new key is detected and an in-place update is not). Additive.
 */
import { makeSession } from '../_core/session.js';
const { getSession } = makeSession('aimeat-live.js');
import { attach } from '../_core/namespace.js';

var es = null;
var subscribers = [];              // { domains: Set<string>|null, fn }  (null = all)
var debounceTimer = null;
var refCount = 0;
var reconnectTimer = null;
var reconnectDelay = 5000;
var everOpened = false;
var MAX_RECONNECT_DELAY = 120000;
var DEBOUNCE_MS = 1000;            // match server COALESCE_MS
var pendingDomains = new Set();    // null => "everything changed"
var hadHiddenUpdate = false;

// Multi-tab sharing
var started = false;
var isLeader = false;
var bc = null;
var leaderRelease = null;
var leaderAbort = null;

function connect() {
  refCount++;
  if (started) return;
  started = true;
  startShared();
}

function startShared() {
  var canShare = (typeof BroadcastChannel !== 'undefined') && (typeof navigator !== 'undefined') && navigator.locks;
  if (!canShare) { becomeLeader(); return; }
  bc = new BroadcastChannel('aimeat-live');
  bc.onmessage = function (ev) { if (ev.data && ev.data.type === 'domains') ingestDomains(ev.data.domains); };
  leaderAbort = new AbortController();
  navigator.locks.request('aimeat-live-leader', { mode: 'exclusive', signal: leaderAbort.signal }, function () {
    return new Promise(function (release) { leaderRelease = release; becomeLeader(); });
  }).catch(function () { /* aborted while queued */ });
}

function becomeLeader() { if (isLeader) return; isLeader = true; _open(); }
function relay(domains) { if (bc) { try { bc.postMessage({ type: 'domains', domains: domains }); } catch { /* channel closed */ } } }

async function _open() {
  var session;
  try { session = getSession(); } catch { scheduleReconnect(); return; }
  try {
    var r = await session.fetch('/v1/events/ticket', { method: 'POST' });
    if (!r || !r.ok || !r.data || !r.data.ticket) { scheduleReconnect(); return; }
    es = new EventSource('/v1/events?ticket=' + encodeURIComponent(r.data.ticket));
    es.onopen = function () {
      reconnectDelay = 5000;
      if (everOpened) { ingestDomains(null); relay(null); }   // reconnect catch-up: reconcile all
      everOpened = true;
    };
    es.onmessage = function (event) {
      reconnectDelay = 5000;
      var domains = null;
      try { var p = JSON.parse(event.data); if (Array.isArray(p.domains)) domains = p.domains; } catch { /* non-JSON keep-alive frame */ }
      ingestDomains(domains); relay(domains);
    };
    es.onerror = function () { if (es) { es.close(); es = null; } scheduleReconnect(); };
  } catch { scheduleReconnect(); }
}

function ingestDomains(domains) {
  if (domains === null) pendingDomains = null;
  else if (pendingDomains !== null) domains.forEach(function (d) { pendingDomains.add(d); });
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flushDomains, DEBOUNCE_MS);
}

function flushDomains() {
  if (typeof document !== 'undefined' && document.hidden) { hadHiddenUpdate = true; return; }
  var dset = pendingDomains;
  pendingDomains = new Set();
  dispatch(dset);
}

function dispatch(dset) {
  // window event first (family convention: apps may listen instead of subscribe)
  try { window.dispatchEvent(new CustomEvent('aimeat-live-update', { detail: { domains: dset } })); } catch { /* no window */ }
  var list = subscribers.slice();
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    if (dset === null || s.domains === null) { try { s.fn(dset); } catch { /* subscriber threw */ } continue; }
    var it = dset.values ? dset.values() : dset[Symbol.iterator]();
    var hit = false, n;
    while (!(n = it.next()).done) { if (s.domains.has(n.value)) { hit = true; break; } }
    if (hit) { try { s.fn(dset); } catch { /* subscriber threw */ } }
  }
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  if (refCount > 0 && isLeader) {
    reconnectTimer = setTimeout(function () { if (refCount > 0) _open(); }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && hadHiddenUpdate) { hadHiddenUpdate = false; pendingDomains = null; flushDomains(); }
  });
}

function disconnect() {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0) {
    started = false;
    if (es) { es.close(); es = null; }
    if (leaderAbort) { try { leaderAbort.abort(); } catch { /* already aborted */ } leaderAbort = null; }
    if (leaderRelease) { try { leaderRelease(); } catch { /* already released */ } leaderRelease = null; }
    isLeader = false;
    if (bc) { try { bc.close(); } catch { /* already closed */ } bc = null; }
    clearTimeout(debounceTimer); clearTimeout(reconnectTimer);
    reconnectDelay = 5000; everOpened = false; pendingDomains = new Set(); hadHiddenUpdate = false;
  }
}

/**
 * Subscribe to specific domains (or null = all). Auto-connects on first subscribe.
 * Returns an unsubscribe function.
 *
 * opts (all optional, all additive — a two-argument call behaves exactly as before):
 *   keyPrefix    — string | string[]. Only fire when the number of the caller's memory keys
 *                  under one of these prefixes has CHANGED since the last check. The server's
 *                  change frame carries a domain name only (see services/event-bus.ts), never
 *                  the key that changed, so this is a client-side gate: on each 'memory' event
 *                  the lib asks for a cheap server-side COUNT (`?count=true`, no values, its
 *                  cache invalidated by any write) and stays quiet when the count is unmoved.
 *                  LIMITATION, by design of the frame: a NEW key is detected, an in-place
 *                  UPDATE of an existing key is not. For update-sensitive views pass
 *                  minIntervalMs instead of (or with) keyPrefix.
 *   agent        — GAII to scope the count to one agent's namespace.
 *   ownerScope   — count across the owner's GHII + agents (an app-grant token needs this).
 *   minIntervalMs— never invoke the callback more often than this. On a fleet with many agents
 *                  the 'memory' domain is a firehose; this is the blunt version of the gate.
 *
 * Why this exists: a multi-agent owner writes memory constantly, so `subscribe(['memory'], reload)`
 * fires more or less continuously, and every subscriber that re-fetched a full listing on each
 * event turned one agent's activity into a permanent poll.
 */
function subscribe(domains, fn, opts) {
  if (typeof domains === 'function') { opts = fn; fn = domains; domains = null; }
  opts = opts || {};
  var prefixes = opts.keyPrefix
    ? (Array.isArray(opts.keyPrefix) ? opts.keyPrefix.slice() : [opts.keyPrefix])
    : null;
  var minInterval = opts.minIntervalMs > 0 ? opts.minIntervalMs : 0;
  var counts = Object.create(null);   // prefix -> last seen count
  var lastCall = 0;
  var probing = false;
  var primed = !prefixes;             // with keyPrefix, the first event only records a baseline

  function pass(dset) { lastCall = Date.now(); try { fn(dset); } catch { /* subscriber threw */ } }

  function gate(dset) {
    if (minInterval && (Date.now() - lastCall) < minInterval) return;
    if (!prefixes) { pass(dset); return; }
    if (probing) return;              // one probe in flight is enough
    probing = true;
    Promise.all(prefixes.map(function (p) {
      var qs = 'count=true&prefix=' + encodeURIComponent(p) +
        (opts.agent ? '&agent=' + encodeURIComponent(opts.agent)
          : (opts.ownerScope ? '&owner_scope=true' : ''));
      return getSession().fetch('/v1/memory?' + qs)
        .then(function (r) {
          var c = r && r.data && typeof r.data.count === 'number' ? r.data.count : null;
          return { prefix: p, count: c };
        })
        .catch(function () { return { prefix: p, count: null }; });
    })).then(function (res) {
      probing = false;
      var changed = false;
      res.forEach(function (r) {
        if (r.count == null) return;                 // probe failed: do not claim a change
        if (counts[r.prefix] !== r.count) { changed = true; counts[r.prefix] = r.count; }
      });
      // A failed/unavailable probe must not silence a real update forever: if we could not
      // establish any baseline, fall through and let the subscriber decide.
      if (!primed) { primed = true; if (res.every(function (r) { return r.count != null; })) return; }
      if (changed) pass(dset);
    }).catch(function () { probing = false; });
  }

  var entry = { domains: domains ? new Set(domains) : null, fn: gate };
  subscribers.push(entry);
  connect();
  return function () {
    var i = subscribers.indexOf(entry);
    if (i >= 0) { subscribers.splice(i, 1); disconnect(); }
  };
}

attach('live', {
  connect: connect,
  disconnect: disconnect,
  subscribe: subscribe,
  onUpdate: function (fn) { return subscribe(null, fn); },
});
