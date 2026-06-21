/**
 * SSE Live Updates — singleton connection with reference counting and domain-aware,
 * debounced, visibility-gated callbacks.
 *
 * Opens one EventSource to /v1/events (single-use ticket via authenticated POST). The server
 * sends `data: {"domains":[...]}` listing which domains changed in the last ~1s window. We
 * accumulate domains across a 1000ms debounce (matching the server coalesce) and notify only
 * the subscribers that care about those domains — so a tab no longer re-fetches everything on
 * every change. Hidden tabs do NO refetch fan-out (Page Visibility gating) and catch up once
 * when re-shown. A reconnect forces one "all domains" reconcile so nothing is missed.
 *
 * Back-compat: a legacy/opaque payload (or a subscriber registered via onUpdate with no
 * domain filter) is treated as "everything changed".
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

export async function connect(getJwt) {
  refCount++;
  if (es) return;
  jwtGetter = getJwt;
  await _open();
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
      // reconcile. Skip on the very first open (tabs do their own initial load on mount).
      if (everOpened) ingestDomains(null);
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
  clearTimeout(reconnectTimer);
  if (refCount > 0 && jwtGetter) {
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
    if (es) { es.close(); es = null; }
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
