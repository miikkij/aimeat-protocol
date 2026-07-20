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

// Subscribe to specific domains (or null = all). Auto-connects on first subscribe. Returns unsubscribe.
function subscribe(domains, fn) {
  if (typeof domains === 'function') { fn = domains; domains = null; }
  var entry = { domains: domains ? new Set(domains) : null, fn: fn };
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
