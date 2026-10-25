/**
 * SSE Live Updates — ONE EventSource per browser (shared across tabs), domain-aware,
 * debounced, and visibility-gated.
 *
 * Connection sharing (multi-tab): instead of every tab opening its own EventSource (20 tabs =
 * 20 connections, and HTTP/1.1 caps at 6/domain), a single "leader" tab holds the EventSource
 * and relays each event to follower tabs over a BroadcastChannel. Leadership is elected with the
 * Web Locks API: whoever holds the 'aimeat-live-leader' lock is the leader; when the leader tab
 * closes (or crashes) the browser auto-releases the lock and a waiting tab takes over. Browsers
 * without BroadcastChannel/Web Locks fall back to a per-tab connection (today's behaviour, no
 * regression).
 *
 * A leader that stops delivering (2026-10-25). Closing is not the only way a leader fails: a
 * background tab whose session expired stops its stream (the dead-session stop below) and waits to be
 * shown again, still holding the lock, and every other tab then hears nothing. On production Jouni's
 * Messages tab had no stream of its own, nine tabs waited for the lock, and a message his agent sent
 * appeared only when he clicked the thread. The node now writes its 15 s keepalive as `event: alive`;
 * the leader relays it with whether its stream is signed, and a VISIBLE follower that has heard
 * nothing for 45 s, or hears a visitor stream while it has a session itself, takes the lock with
 * `steal`. The tab it was taken from closes its stream and waits in line. The follower's watchdog is
 * a timer that sends nothing: every byte still arrives on the one stream, never by polling.
 *
 * Selective refetch: the server sends `data: {"domains":[...]}` (which domains changed in the
 * last ~1s window). We accumulate domains across a 1000ms debounce (matching the server
 * coalesce) and notify only the subscribers that care. Hidden tabs do NO refetch fan-out (Page
 * Visibility gating) and catch up once when re-shown. A (re)connect forces one "all domains"
 * reconcile so nothing is missed. A legacy/opaque payload is treated as "everything changed".
 *
 * Dead-session stop (2026-08-17): a 401 on the ticket request means the stored session expired,
 * and retrying it on the network-failure backoff turned every abandoned logged-in tab into a
 * permanent knock on the door every 120 s — the production refusal log showed one dead JWT
 * retried 17 times at exactly that cadence. A 401 now gets ONE retry after 10 s (another call on
 * the same page may have just refreshed the session), then the connection stops and tries again
 * only when the tab next becomes visible. Network failures keep the existing backoff.
 * Reconnect after a restart (2026-08-30): the backoff starts at 2 s and caps at 60 s (was 5 s to
 * 120 s), and a tab that comes back into view while a reconnect is still waiting tries at once. A
 * run page left open across a deploy sat still for over a minute while the run advanced.
 * Build watch (2026-10-18): every stream opens with `event: hello` carrying the build, and the shell
 * calls watchBuild() once, so a node restarted on new code reloads the open page on the reconnect. It
 * replaces the shell's fetch of /v1/build every 60 s (Jouni: live data is an event, never a poll). A
 * signed-out page holds a visitor stream for it (POST /v1/events/visitor-ticket), which carries the
 * build and nothing else, and a view that brings a session reopens the stream signed.
 * Signed-in-only node (2026-10-19): there the gate refuses the visitor ticket, so a page without a
 * session opens no stream, and the first view that brings one opens it signed. Before, the shell's
 * build watch asked for a visitor ticket before the auth lib had loaded, got 401 on every page load
 * of a signed-in person, and went without live updates for the ten seconds of the 401 retry.
 */

/** This node shows its content to its own accounts only (routes/portal-spa.ts window.__SITE). */
const closedNode = () => typeof window !== 'undefined' && /** @type {any} */ (window).__SITE?.contentAccess === 'signed-in';

let es = null;
let subscribers = [];                 // { domains: Set<string>|null, fn }  (null = all domains)
let debounceTimer = null;
let refCount = 0;
let jwtGetter = null;
let reconnectTimer = null;
// Reconnect backoff (2026-08-30): 2 s doubling to a 60 s cap, from 5 s doubling to 120 s. A node
// restart (a deploy) is down for half a minute or so; with the old schedule a tab that lost its
// connection at the start of one waited 5 + 10 + 20 + 40 s before its first try after the node was
// back, and a run page open across the restart sat still for over a minute while the run advanced.
// The cap stays: a node that is really gone is not knocked on every two seconds forever.
const INITIAL_RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 60000;
let reconnectDelay = INITIAL_RECONNECT_DELAY;
let everOpened = false;
let authRetried = false;             // the one 10 s retry after a 401 has been spent
let authDead = false;                // session known dead: no timers run until the tab is shown again
const AUTH_RETRY_DELAY = 10000;
const DEBOUNCE_MS = 1000;             // match server COALESCE_MS

let pendingDomains = new Set();       // null ⇒ "everything changed" (sticky for the window)
let hadHiddenUpdate = false;

// The build watch (watchBuild below): a signed-out page opens a visitor stream, which carries the
// build and nothing else; a page that signs in later reopens it signed.
let visitorOk = false;
let streamSigned = false;
let buildReloadPending = false;

// Multi-tab connection sharing
let started = false;
let isLeader = false;
let bc = null;                        // BroadcastChannel | null
let leaderRelease = null;            // resolves the Web Lock promise → releases leadership
let leaderAbort = null;             // aborts a still-queued (follower) lock request on disconnect

// Leader liveness (2026-10-25). The node writes `event: alive` every 15 s (routes/sse.ts); the leader
// relays it, and a visible follower that has heard nothing for three of them takes the lock.
const STALE_MS = 45000;
let lastAliveAt = 0;
let leaderSigned = true;            // the leader's last word on whether its stream carries a session
let watchdogTimer = null;
let staleWhileHidden = false;       // the leader went silent while this tab was hidden
let leaderRequest = 0;              // the id of this tab's newest lock request
let heldRequest = 0;                // the id of the request that holds the lock, while it does

export async function connect(getJwt) {
  refCount++;
  jwtGetter = getJwt;
  if (started) {
    // The build watch may hold a visitor stream; a view that has a session needs the signed one.
    // On a signed-in-only node the page opened no stream without the session (_open), so the first
    // view that has one opens it here.
    if (isLeader && (es || closedNode()) && !streamSigned && getJwt?.()) { if (es) { es.close(); es = null; } _open(); }
    return;
  }
  started = true;
  startShared();
}

/**
 * Reload the page when the node answering is a different build: the shell's own watch, started once
 * in the top window (routes/portal-spa.ts). Every stream opens with `event: hello` carrying the build
 * (routes/sse.ts), and a node restarted on new code drops every stream, so the reconnect reads the
 * new build and the page reloads onto fresh modules. It replaces a fetch of /v1/build every 60 s
 * (Jouni, 2026-10-18: live data is an event, never a poll). A signed-out page holds a visitor stream
 * for it, which carries nothing but the build.
 * @param {() => string|undefined} getJwt
 */
export function watchBuild(getJwt) {
  visitorOk = true;
  connect(getJwt);
}

/** The build a stream says it is, against the one this page was served with. */
function checkBuild(build) {
  if (typeof window === 'undefined' || window.self !== window.top) return;
  const mine = window.__BUILD_ID;
  if (!mine || !build || build === mine) return;
  if (document.hidden) { buildReloadPending = true; return; }
  location.reload();
}

function startShared() {
  const canShare = (typeof BroadcastChannel !== 'undefined')
    && (typeof navigator !== 'undefined') && navigator.locks;
  if (!canShare) { becomeLeader(); return; }   // legacy: this tab opens its own connection

  bc = new BroadcastChannel('aimeat-live');
  bc.onmessage = (ev) => {
    if (ev.data && ev.data.type === 'domains') { heardLeader(); ingestDomains(ev.data.domains); }
    if (ev.data && ev.data.type === 'hello') checkBuild(ev.data.build);
    if (ev.data && ev.data.type === 'alive') heardLeader(ev.data.signed !== false);
  };
  lastAliveAt = Date.now();   // the leader gets the same grace a new one does
  requestLeadership(false);
  armWatchdog();
}

/**
 * Ask for the 'aimeat-live-leader' lock. Holding it makes this tab the leader; the callback's promise
 * resolves only when we release (on disconnect), and the browser releases it when the tab closes.
 * A plain request waits in line, and its AbortController cancels it while still QUEUED (a follower
 * that disconnects before ever acquiring the lock) so it can't later become a phantom leader with no
 * active views. `steal` takes the lock from a leader that has gone silent (takeOver): the browser
 * rejects that leader's request, and its catch below hands the stream back (lostLeadership).
 * Web Locks refuse `signal` together with `steal`, so a stealing request carries none.
 */
function requestLeadership(steal) {
  const mine = ++leaderRequest;
  /** @type {LockOptions} */
  const opts = steal
    ? { mode: 'exclusive', steal: true }
    : { mode: 'exclusive', signal: (leaderAbort = new AbortController()).signal };
  navigator.locks.request('aimeat-live-leader', opts, () => new Promise((release) => {
    heldRequest = mine;
    leaderRelease = release;
    becomeLeader();
  })).catch(() => {
    // Aborted while queued (disconnect, or this tab stealing past its own queued request): nothing
    // held, nothing to do. Stolen while held: another tab leads now.
    if (mine === heldRequest && isLeader && started) lostLeadership();
  });
}

function becomeLeader() {
  if (isLeader) return;
  isLeader = true;
  clearTimeout(watchdogTimer);
  staleWhileHidden = false;
  _open();
}

/** Another tab took the lock: close this tab's stream and listen to the new leader instead. */
function lostLeadership() {
  isLeader = false;
  leaderRelease = null;
  if (es) { es.close(); es = null; }
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  lastAliveAt = Date.now();
  requestLeadership(false);
  armWatchdog();
}

/** The leader's stream is alive: tell the followers, and whether it carries a signed session. */
function beat() {
  if (bc && isLeader) { try { bc.postMessage({ type: 'alive', signed: streamSigned }); } catch { /* channel closed */ } }
}

/** A follower heard the leader (a relayed keepalive or a change). */
function heardLeader(signed) {
  lastAliveAt = Date.now();
  if (signed !== undefined) leaderSigned = signed;
  armWatchdog();
}

/**
 * A follower's watchdog: a timer that sends nothing and asks the node nothing. It fires when the
 * leader has relayed nothing for STALE_MS. A few seconds of jitter keep several followers from all
 * stealing at once.
 */
function armWatchdog() {
  clearTimeout(watchdogTimer);
  if (!bc || isLeader || refCount === 0) return;
  watchdogTimer = setTimeout(checkLeader, STALE_MS + Math.floor(Math.random() * 5000));
}

/** Silent past STALE_MS, or holding a visitor stream while this tab has a session. */
function leaderFailing() {
  return Date.now() - lastAliveAt > STALE_MS || (!leaderSigned && !!jwtGetter?.());
}

function checkLeader() {
  if (!bc || isLeader || refCount === 0) return;
  if (!leaderFailing()) { armWatchdog(); return; }
  // A hidden tab does not take the stream; it does so when the person comes back to it.
  if (typeof document !== 'undefined' && document.hidden) { staleWhileHidden = true; return; }
  takeOver();
}

function takeOver() {
  staleWhileHidden = false;
  if (leaderAbort) { try { leaderAbort.abort(); } catch { /* already settled */ } leaderAbort = null; }
  everOpened = true;   // the stream opens after a gap: its onopen reconciles every domain in every tab
  requestLeadership(true);
}

/** Relay an event to follower tabs (no-op when not sharing). */
function relay(domains) {
  if (bc) { try { bc.postMessage({ type: 'domains', domains }); } catch { /* channel closed */ } }
}

async function _open() {
  const jwt = jwtGetter?.();
  if (!jwt && (!visitorOk || closedNode())) return;

  try {
    streamSigned = !!jwt;
    const resp = jwt
      ? await fetch('/v1/events/ticket', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${jwt}` },
      })
      // Signed out: the visitor stream, which carries the build and nothing else (watchBuild).
      : await fetch('/v1/events/visitor-ticket', { method: 'POST', credentials: 'omit' });
    if (!resp.ok) {
      console.warn('[SSE] Ticket request failed:', resp.status);
      if (resp.status === 401) {
        // The stored session is expired. One retry shortly (another call on this page may have
        // just refreshed it); after that, stop — the visibility listener resumes when the user
        // actually returns, and a re-login remounts the views which restarts this machinery.
        clearTimeout(reconnectTimer);
        if (!authRetried) {
          authRetried = true;
          reconnectTimer = setTimeout(() => { if (refCount > 0) _open(); }, AUTH_RETRY_DELAY);
        } else {
          authDead = true;
        }
        return;
      }
      scheduleReconnect();
      return;
    }
    const body = await resp.json();
    const ticket = body.data.ticket;
    // Another tab took the lock while the ticket was on its way: the stream is that tab's to open.
    if (!isLeader) return;

    es = new EventSource(`/v1/events?ticket=${encodeURIComponent(ticket)}`);

    // The node's 15 s keepalive, relayed so the followers know this stream is alive.
    es.addEventListener('alive', beat);

    // Which build answers: a restart on new code reloads the page (watchBuild).
    es.addEventListener('hello', (event) => {
      let build = null;
      try { build = JSON.parse(event.data).build; } catch { /* not ours to read */ }
      if (bc) { try { bc.postMessage({ type: 'hello', build }); } catch { /* channel closed */ } }
      checkBuild(build);
    });

    es.onopen = () => {
      reconnectDelay = INITIAL_RECONNECT_DELAY;
      authRetried = false;
      authDead = false;
      // Reconnect catch-up: after a gap we may have missed events, so force one "all domains"
      // reconcile (locally + relayed). Skip on the very first open (views load on mount).
      if (everOpened) { ingestDomains(null); relay(null); }
      everOpened = true;
      beat();
    };

    es.onmessage = (event) => {
      reconnectDelay = INITIAL_RECONNECT_DELAY;
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
    // A new build arrived while the tab was hidden: the reload happens when the person comes back.
    if (!document.hidden && buildReloadPending) { location.reload(); return; }
    // The leader went silent while this tab was hidden: take the stream now if it still is.
    if (!document.hidden && staleWhileHidden) {
      staleWhileHidden = false;
      if (bc && !isLeader && refCount > 0 && leaderFailing()) takeOver(); else armWatchdog();
    }
    if (!document.hidden && hadHiddenUpdate) {
      hadHiddenUpdate = false;
      pendingDomains = null;   // one catch-up reconcile across all domains
      flushDomains();
    }
    // A dead-session stop gets one fresh attempt when the user actually comes back to the tab:
    // by then they may have signed in again (here or in a sibling tab sharing the session).
    if (!document.hidden && authDead && refCount > 0 && isLeader) {
      authDead = false;
      authRetried = false;
      _open();
      return;
    }
    // A reconnect still waiting on its backoff does not make the person wait: coming back to the
    // tab is the moment they want it live, so the attempt happens now and the backoff starts over.
    if (!document.hidden && reconnectTimer && !es && refCount > 0 && isLeader) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      reconnectDelay = INITIAL_RECONNECT_DELAY;
      _open();
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
    clearTimeout(watchdogTimer);
    staleWhileHidden = false;
    leaderSigned = true;
    heldRequest = 0;
    reconnectDelay = INITIAL_RECONNECT_DELAY;
    authRetried = false;
    authDead = false;
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
 * For a page that is a route of its own: open the stream and relay each change as the window event
 * 'aimeat-live-update', which is what a page's blocks listen for. Returns the cleanup, so it is the
 * whole body of a useEffect. The profile, the admin and the home's first page each wired this by
 * hand; the home's other routes (one agent, one piece of work, the computers, the history) listened
 * for the event and opened no stream, so an agent's page showed "working" until a reload although
 * its task had finished (found on production, 2026-10-11).
 * @param {() => string|undefined} getJwt
 * @returns {() => void}
 */
export function relayLiveUpdates(getJwt) {
  const notify = (domains) => {
    window.dispatchEvent(new CustomEvent('aimeat-live-update', { detail: { domains } }));
  };
  connect(getJwt);
  onUpdate(notify);
  return () => { offUpdate(notify); disconnect(); };
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
