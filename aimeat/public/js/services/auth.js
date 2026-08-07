/**
 * @file public/js/services/auth.js
 * @description THE frontend session source of truth. Every read of "who is signed in" and every
 *   subscription to that changing goes through this module — nothing in public/ touches
 *   window.AIMEAT.auth directly (enforced by the `aimeat/no-direct-auth` lint rule, which allows
 *   exactly this file).
 *
 *   Why it is a module and not a convention. Session state lived in three places that nothing kept
 *   in agreement: localStorage, the auth lib's `currentSession`, and a private `useState` copy in
 *   every view, synchronised by a payload-less `aimeat-auth-change` window event with no ordering
 *   guarantee. On 2026-08-07 that produced a header rendering the notification bell and the "Me"
 *   menu next to a "Sign In / Register" button: the login pill called its host's onLogout callback
 *   synchronously, before the un-awaited async logout() had cleared anything, so every listener
 *   re-read the OLD session and re-rendered a signed-in header. The same race had already been
 *   found once and worked around inside a single view (portfolio.js) instead of at the source.
 *
 *   Two properties make that class of bug unrepresentable here:
 *     1. Subscribers are driven by the auth lib's OWN 'login'/'logout'/'session-updated' events,
 *        which fire after the state has changed — not by a caller remembering to announce it.
 *        The legacy window event is accepted too, so no existing emitter has to be found and fixed.
 *     2. Every notification re-reads the session and is deduped by signature, so an early or
 *        duplicated event can neither deliver a stale session nor cause a redundant re-render.
 *
 *   The auth lib loads asynchronously (spa.html injects /v1/libs/aimeat-auth.js during boot), so
 *   wiring retries until it appears rather than assuming it is there at import time.
 *
 * @structure
 *   - getSession/hasSession/getOwner/getGhii/getJwt/getNodeUrl/getStoredGhii: read the session
 *   - authHeaders: Authorization header for a raw fetch (empty object when signed out)
 *   - onAuthChange: subscribe to real session changes, returns unsubscribe
 *   - logout/showLoginModal/updateSessionMeta: the lifecycle actions a view may trigger
 *   - getProfile/updateProfile/changePassword: the current user's GHII profile
 *
 * @usage
 *   import { getSession, onAuthChange } from '/js/services/auth.js';
 *   // In a Preact view prefer the hook: import { useSession } from '/js/use-session.js';
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 *   v2.0.0 — 2026-08-07 — Becomes the single session source: subscribes to the auth lib's own
 *     post-change events (killing the stale-session race for every consumer at once), dedupes by
 *     signature, and absorbs the lifecycle + jwt/header surface that views were reaching past it for.
 */

/* eslint-disable aimeat/no-direct-auth -- THIS is the module the rule points everything else to;
   it is the one place allowed to touch the auth lib. */

/** The auth lib object, or null until /v1/libs/aimeat-auth.js has loaded. */
function lib() {
  return (typeof window !== 'undefined' && window.AIMEAT && window.AIMEAT.auth) || null;
}

// ── Reads ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Get the current auth session, or null if not logged in.
 * A session without a jwt is treated as no session — that is the only definition of "signed in"
 * the whole frontend uses, so a half-populated object can never render as a logged-in state.
 * @returns {any}
 */
export function getSession() {
  const a = lib();
  if (!a || typeof a.getSession !== 'function') return null;
  const s = a.getSession();
  return (s && s.jwt) ? s : null;
}

/** Check if a session is active. @returns {boolean} */
export function hasSession() {
  return getSession() !== null;
}

/** Get owner name from session. @returns {string|null} */
export function getOwner() {
  return getSession()?.owner || null;
}

/** Get GHII from session. @returns {string|null} */
export function getGhii() {
  const s = getSession();
  return s?.ghii || (s?.owner ? s.owner + '@unknown' : null);
}

/**
 * The raw JWT of the active session, or '' when signed out. Returning '' (never null/undefined)
 * keeps the common `Authorization: 'Bearer ' + getJwt()` call sites free of guards.
 * @returns {string}
 */
export function getJwt() {
  return getSession()?.jwt || '';
}

/**
 * Authorization header for a raw fetch — `{}` when signed out, so it always spreads safely:
 * `headers: { 'Content-Type': 'application/json', ...authHeaders() }`.
 * @returns {Record<string, string>}
 */
export function authHeaders() {
  const jwt = getJwt();
  return jwt ? { Authorization: 'Bearer ' + jwt } : {};
}

/** Get the node URL (current origin). @returns {string} */
export function getNodeUrl() {
  return typeof window !== 'undefined' ? window.location.origin : '';
}

/** The node id the auth lib was built against (used to compose a GHII when the session lacks one). */
export function getNodeId() {
  return lib()?.nodeId || '';
}

/**
 * The GHII persisted in localStorage, readable WITHOUT an active session — the one legitimate
 * "who was here last" read (an invite/grant screen showing which account a stale link belongs to).
 * @returns {string|null}
 */
export function getStoredGhii() {
  return lib()?.storedGhii || null;
}

/** True when the page is a published app on its isolated origin rather than the apex. */
export function isAppOrigin() {
  const a = lib();
  return !!(a && typeof a.isAppOrigin === 'function' && a.isAppOrigin());
}

// ── Lifecycle ───────────────────────────────────────────────────────────────────────────────────

/**
 * Sign out. Resolves once the session is gone locally; the server-side revoke completes in the
 * background. Subscribers are notified by the auth lib's 'logout' event, so callers do NOT need
 * to announce it — announcing it by hand, before this resolved, is what caused the header bug.
 * @returns {Promise<void>}
 */
export async function logout() {
  const a = lib();
  if (a && typeof a.logout === 'function') await a.logout();
}

/**
 * Open the sign-in modal. Sign-in notifies subscribers through the auth lib's 'login' event, so a
 * caller does not pass an onLogin callback — it subscribes (or uses useSession) like everything else.
 * Returns false when the auth lib has not loaded and no modal could be shown, so a caller can fall
 * back to a full-page sign-in route instead of leaving the user with a dead button.
 * @param {object} [opts]
 * @returns {boolean}
 */
export function showLoginModal(opts) {
  const a = lib();
  if (!a || typeof a.showLoginModal !== 'function') return false;
  a.showLoginModal(opts || {});
  return true;
}

/**
 * Patch mutable, non-secret session metadata (e.g. displayName after a profile edit) and let every
 * subscriber re-render — no page reload.
 * @param {Record<string, unknown>} patch
 */
export function updateSessionMeta(patch) {
  const a = lib();
  if (a && typeof a.updateSessionMeta === 'function') a.updateSessionMeta(patch);
}

// ── Change notification ─────────────────────────────────────────────────────────────────────────

/** @type {Set<(session: any) => void>} */
const subscribers = new Set();
/** Signature of the session subscribers were last told about — the dedupe key. */
let lastSignature = signatureOf(null);
let wired = false;
/** @type {any} */ let wireTimer = null;

/**
 * Identity of a session for change detection. jwt alone is not enough: a display-name edit keeps
 * the same token but must still re-render, and a token refresh rotates the jwt without being a
 * change of WHO is signed in — including all three keeps both cases correct.
 * @param {any} s
 */
function signatureOf(s) {
  if (!s) return '-';
  return (s.ghii || s.owner || '') + '|' + (s.displayName || '') + '|' + (s.jwt || '');
}

/** Re-read the session and notify subscribers, but only when it actually differs. */
function publish() {
  const s = getSession();
  const sig = signatureOf(s);
  if (sig === lastSignature) return;
  lastSignature = sig;
  for (const cb of Array.from(subscribers)) {
    try { cb(s); } catch (err) { console.error('[aimeat] auth subscriber failed:', err); }
  }
}

/**
 * Attach to the auth lib's own events. The lib is injected during boot, so this retries until it
 * exists instead of silently doing nothing when the module happens to import first.
 */
function ensureWired() {
  if (wired || typeof window === 'undefined') return;
  const a = lib();
  if (!a || typeof a.on !== 'function') {
    if (wireTimer === null) wireTimer = setInterval(() => { ensureWired(); }, 50);
    return;
  }
  wired = true;
  if (wireTimer !== null) { clearInterval(wireTimer); wireTimer = null; }
  // These three fire AFTER the lib's state changed — the property the whole module rests on.
  a.on('login', publish);
  a.on('logout', publish);
  a.on('session-updated', publish);
  publish(); // the lib may have restored a session before we attached
}

if (typeof window !== 'undefined') {
  // The legacy channel: hosts that announce auth changes by hand (spa.html boot, the session-expiry
  // handler). Kept so no emitter has to be hunted down — publish() re-reads and dedupes, so an
  // early or duplicate announcement is harmless rather than a stale render.
  window.addEventListener('aimeat-auth-change', publish);
  ensureWired();
}

/**
 * Listen for auth state changes. The callback receives the new session (or null) and fires only on
 * a real change. Returns an unsubscribe function.
 * @param {(session: any) => void} callback
 * @returns {() => void}
 */
export function onAuthChange(callback) {
  ensureWired();
  subscribers.add(callback);
  return () => { subscribers.delete(callback); };
}

// ── Profile ─────────────────────────────────────────────────────────────────────────────────────

/** Fetch the current user's own profile (includes private fields like email). */
export async function getProfile() {
  const s = getSession();
  if (!s) return null;
  return s.fetch('/v1/ghii/me');
}

/** Update the current user's profile via PUT /v1/ghii. */
export async function updateProfile(fields) {
  const s = getSession();
  if (!s) throw new Error('Not logged in');
  return s.fetch('/v1/ghii', { method: 'PUT', body: JSON.stringify(fields) });
}

/** Change the current user's password via POST /v1/ghii/password/change. */
export async function changePassword(currentPassword, newPassword) {
  const s = getSession();
  if (!s) throw new Error('Not logged in');
  return s.fetch('/v1/ghii/password/change', {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}
