/**
 * @file src/routes/lib-live.ts
 * @description Generates the client-side aimeat-live.js library string served to apps — the
 *   realtime "subscribe to server-pushed domain changes" helper (TARGET-012) that wraps the
 *   node's SSE transport in one shared, multi-tab-elected EventSource with debounce and backoff.
 *
 * @structure
 *   - aimeatLiveLib(config): returns the aimeat-live.js source, exposing AIMEAT.live.{connect,subscribe,onUpdate,disconnect}
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { AimeatConfig } from '../config.js';

/**
 * aimeat-live.js — Realtime live-update helper for AIMEAT apps (TARGET-012).
 *
 * The platform-level "subscribe to server-pushed changes" capability: instead of polling or asking
 * the operator to press F5, an app subscribes to the domains it cares about and re-fetches ONLY when
 * the server says that domain actually changed. It wraps the node's existing SSE transport
 * (POST /v1/events/ticket -> GET /v1/events?ticket=, owner-scoped + typed + coalesced) behind one
 * shared EventSource per browser (elected via the Web Locks API, relayed to other tabs over a
 * BroadcastChannel) with debounce, Page-Visibility gating and exponential-backoff reconnect.
 *
 * Usage (requires aimeat-auth.js loaded first, and a logged-in session):
 *   AIMEAT.live.connect();                                   // start the shared stream (idempotent)
 *   const off = AIMEAT.live.subscribe(['agent-tasks','organisms'], (domains) => reload());
 *   // ...later: off();  AIMEAT.live.disconnect();
 * Or listen to the window event any subscriber also receives:
 *   window.addEventListener('aimeat-live-update', (e) => { const d = e.detail && e.detail.domains; ... });
 *
 * Domains a fleet/agent app typically wants: 'agent-tasks' (task lifecycle), 'agents' (agent state +
 * self-reports), 'organisms' (workspace records incl. your own run/deliverable records),
 * 'notifications', 'memory'. The server owner-scopes hot per-owner domains, so you only hear about
 * your own changes.
 */
export function aimeatLiveLib(config: AimeatConfig): string {
  return `// aimeat-live.js — AIMEAT realtime live-updates (TARGET-012)
// Node: ${config.nodeId} | Generated: ${new Date().toISOString()}
// Requires: aimeat-auth.js loaded first
(function (global) {
'use strict';

function getSession() {
  if (!global.AIMEAT || !global.AIMEAT.auth) throw new Error('AIMEAT.auth is required. Include aimeat-auth.js before aimeat-live.js');
  var s = global.AIMEAT.auth.getSession();
  if (!s) throw new Error('Not logged in. Call AIMEAT.auth.login() first.');
  return s;
}

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
function relay(domains) { if (bc) { try { bc.postMessage({ type: 'domains', domains: domains }); } catch (e) {} } }

async function _open() {
  var session;
  try { session = getSession(); } catch (e) { scheduleReconnect(); return; }
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
      try { var p = JSON.parse(event.data); if (Array.isArray(p.domains)) domains = p.domains; } catch (e) {}
      ingestDomains(domains); relay(domains);
    };
    es.onerror = function () { if (es) { es.close(); es = null; } scheduleReconnect(); };
  } catch (e) { scheduleReconnect(); }
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
  try { window.dispatchEvent(new CustomEvent('aimeat-live-update', { detail: { domains: dset } })); } catch (e) {}
  var list = subscribers.slice();
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    if (dset === null || s.domains === null) { try { s.fn(dset); } catch (e) {} continue; }
    var it = dset.values ? dset.values() : dset[Symbol.iterator]();
    var hit = false, n;
    while (!(n = it.next()).done) { if (s.domains.has(n.value)) { hit = true; break; } }
    if (hit) { try { s.fn(dset); } catch (e) {} }
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
    if (leaderAbort) { try { leaderAbort.abort(); } catch (e) {} leaderAbort = null; }
    if (leaderRelease) { try { leaderRelease(); } catch (e) {} leaderRelease = null; }
    isLeader = false;
    if (bc) { try { bc.close(); } catch (e) {} bc = null; }
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

if (!global.AIMEAT) global.AIMEAT = {};
global.AIMEAT.live = {
  connect: connect,
  disconnect: disconnect,
  subscribe: subscribe,
  onUpdate: function (fn) { return subscribe(null, fn); },
};

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
`;
}
