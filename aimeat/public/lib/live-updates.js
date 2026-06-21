/**
 * SSE Live Updates — ONE EventSource per browser (shared across tabs), domain-aware,
 * debounced, and visibility-gated.
 *
 * Connection sharing (multi-tab): instead of every tab opening its own EventSource (20 tabs =
 * 20 connections, and HTTP/1.1 caps at 6/domain), a single "leader" tab holds the EventSource
 * and relays each event to follower tabs over a BroadcastChannel. Leadership is elected with the
 * Web Locks API: whoever holds the 'aimeat-live-leader' lock is the leader; when the leader tab
 * closes (or crashes) the browser auto-releases the lock and a waiting tab takes over — no
 * heartbeat, no polling. Browsers without BroadcastChannel/Web Locks fall back to a per-tab
 * connection (today's behaviour, no regression).
 *
 * Selective refetch: the server sends `data: {"domains":[...]}` (which domains changed in the
 * last ~1s window). We accumulate domains across a 1000ms debounce (matching the server
 * coalesce) and notify only the subscribers that care. Hidden tabs do NO refetch fan-out (Page
 * Visibility gating) and catch up once when re-shown. A (re)connect forces one "all domains"
 * reconcile so nothing is missed. A legacy/opaque payload is treated as "everything changed".
 */

let es = null;
let subscribers = [];                 // { domains: Set<string>|null, fn }  (null = all domains)
let debounceTimer = null;
let refCount = 0;
let jwtGetter = null;
let reconnectTimer = null;
let reconnectDelay = 5000;
let everOpened = false;
const MAX_RECONNECT_DELAY = 120000;
const DEBOUNCE_MS = 1000;             // match server COALESCE_MS

let pendingDomains = new Set();       // null ⇒ "everything changed" (sticky for the window)
let hadHiddenUpdate = false;

// Multi-tab connection sharing
let started = false;
let isLeader = false;
let bc = null;                        // BroadcastChannel | null
let leaderRelease = null;            // resolves the Web Lock promise → releases leadership
let leaderAbort = null;             // aborts a still-queued (follower) lock request on disconnect

export async function connect(getJwt) {
  refCount++;
  jwtGetter = getJwt;
  if (started) return;
  started = true;
  startShared();
}

function startShared() {
  const canShare = (typeof BroadcastChannel !== 'undefined')
    && (typeof navigator !== 'undefined') && navigator.locks;
  if (!canShare) { becomeLeader(); return; }   // legacy: this tab opens its own connection

  bc = new BroadcastChannel('aimeat-live');
  bc.onmessage = (ev) => {
    if (ev.data && ev.data.type === 'domains') ingestDomains(ev.data.domains);
  };
  // Hold the lock for as long as this tab is connected; whoever holds it is the leader. The
  // request callback resolves only when we release (on disconnect), at which point the next
  // waiting tab becomes leader. If the leader tab closes/crashes the browser auto-releases.
  // The AbortController cancels a still-QUEUED request (a follower that disconnects before ever
  // acquiring the lock) so it can't later become a phantom leader with no active views.
  leaderAbort = new AbortController();
  navigator.locks.request('aimeat-live-leader', { mode: 'exclusive', signal: leaderAbort.signal }, () => new Promise((release) => {
    leaderRelease = release;
    becomeLeader();
  })).catch(() => { /* aborted while queued — fine */ });
}

function becomeLeader() {
  if (isLeader) return;
  isLeader = true;
  _open();
}

/** Relay an event to follower tabs (no-op when not sharing). */
function relay(domains) {
  if (bc) { try { bc.postMessage({ type: 'domains', domains }); } catch { /* channel closed */ } }
}

async function _open() {
  const jwt = jwtGetter?.();
  if (!jwt) return;

  try {
    const resp = await fetch('/v1/events/ticket', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${jwt}` },
    });
    if (!resp.ok) {
      console.warn('[SSE] Ticket request failed:', resp.status);
      scheduleReconnect();
      return;
    }
    const body = await resp.json();
    const ticket = body.data.ticket;

    es = new EventSource(`/v1/events?ticket=${encodeURIComponent(ticket)}`);

    es.onopen = () => {
      reconnectDelay = 5000;
      // Reconnect catch-up: after a gap we may have missed events, so force one "all domains"
      // reconcile (locally + relayed). Skip on the very first open (views load on mount).
      if (everOpened) { ingestDomains(null); relay(null); }
      everOpened = true;
    };

    es.onmessage = (event) => {
      reconnectDelay = 5000;
      let domains = null;
      try {
        const p = JSON.parse(event.data);
        if (Array.isArray(p.domains)) domains = p.domains;
      } catch { /* legacy {"t":"change"} or non-JSON ⇒ treat as "everything" */ }
      ingestDomains(domains);
      relay(domains);
    };

    es.onerror = () => {
      if (es) { es.close(); es = null; }
      scheduleReconnect();
    };
  } catch {
    scheduleReconnect();
  }
}

/** Accumulate changed domains and (re)arm the debounce. `null` ⇒ everything changed. */
function ingestDomains(domains) {
  if (domains === null) pendingDomains = null;
  else if (pendingDomains !== null) domains.forEach(d => pendingDomains.add(d));
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flushDomains, DEBOUNCE_MS);
}

/** Dispatch accumulated domains to interested subscribers — unless this tab is hidden. */
function flushDomains() {
  // Page Visibility gating: a hidden tab does NO refetch fan-out; it catches up on re-show.
  if (typeof document !== 'undefined' && document.hidden) { hadHiddenUpdate = true; return; }
  const dset = pendingDomains;
  pendingDomains = new Set();
  dispatch(dset);
}

function dispatch(dset) {
  for (const s of subscribers.slice()) {
    if (dset === null || s.domains === null) { try { s.fn(dset); } catch { /* listener error */ } continue; }
    for (const d of dset) {
      if (s.domains.has(d)) { try { s.fn(dset); } catch { /* listener error */ } break; }
    }
  }
}

function scheduleReconnect() {
  // Only the connection holder (leader / legacy) reconnects.
  clearTimeout(reconnectTimer);
  if (refCount > 0 && jwtGetter && isLeader) {
    reconnectTimer = setTimeout(() => { if (refCount > 0) _open(); }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && hadHiddenUpdate) {
      hadHiddenUpdate = false;
      pendingDomains = null;   // one catch-up reconcile across all domains
      flushDomains();
    }
  });
}

export function disconnect() {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0) {
    started = false;
    if (es) { es.close(); es = null; }
    if (leaderAbort) { try { leaderAbort.abort(); } catch { /* noop */ } leaderAbort = null; }
    if (leaderRelease) { try { leaderRelease(); } catch { /* already released */ } leaderRelease = null; }
    isLeader = false;
    if (bc) { try { bc.close(); } catch { /* already closed */ } bc = null; }
    clearTimeout(debounceTimer);
    clearTimeout(reconnectTimer);
    reconnectDelay = 5000;
    jwtGetter = null;
    everOpened = false;
    pendingDomains = new Set();
    hadHiddenUpdate = false;
  }
}

/**
 * Subscribe to live updates for specific domains.
 * @param {string[]|null} domains  Domains of interest (e.g. ['agent-tasks']); null = all domains.
 * @param {(domains: Set<string>|null) => void} fn  Called when any of those domains change.
 * @returns {() => void} unsubscribe
 */
export function subscribe(domains, fn) {
  const entry = { domains: domains ? new Set(domains) : null, fn };
  subscribers.push(entry);
  return () => { const i = subscribers.indexOf(entry); if (i >= 0) subscribers.splice(i, 1); };
}

/** Back-compat: subscribe to ALL changes (no domain filter). */
export function onUpdate(callback) { return subscribe(null, callback); }

export function offUpdate(callback) {
  for (let i = subscribers.length - 1; i >= 0; i--) {
    if (subscribers[i].fn === callback) subscribers.splice(i, 1);
  }
}

/**
 * Convenience for views: listen to the window 'aimeat-live-update' event, filtered to the
 * domains a view cares about, and run `fn` only when one of those domains changed (or when the
 * payload is the legacy "everything changed"). Replaces the old per-tab
 * `addEventListener + setInterval(fallback poll)` boilerplate — no steady-state polling.
 * @param {string[]|null} domains  Domains of interest; null = fire on any change.
 * @param {() => void} fn
 * @returns {() => void} unsubscribe (use as a useEffect cleanup)
 */
export function onLiveUpdate(domains, fn) {
  const want = domains ? new Set(domains) : null;
  const handler = (e) => {
    const d = e.detail?.domains;            // Set<string> | null
    if (want && d && ![...want].some(x => d.has(x))) return;
    fn();
  };
  window.addEventListener('aimeat-live-update', handler);
  return () => window.removeEventListener('aimeat-live-update', handler);
}
