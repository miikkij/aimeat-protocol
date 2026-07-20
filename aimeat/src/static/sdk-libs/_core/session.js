/**
 * @file session.js
 * @description Shared SDK-libs core — the `AIMEAT.auth` session glue that data/storage/social/…
 *   each re-implemented. `getSession()` asserts aimeat-auth.js is loaded and the user is signed in,
 *   returning the live session object; `authFetch()` delegates to `session.fetch` (which injects the
 *   bearer token, refreshes on 401, and self-heals scope drift). Behavior matches the inline
 *   `getSession()` / `authFetch()` of the legacy libs.
 * @structure getSession(libLabel?) · authFetch(path, opts, libLabel?) · makeSession(libLabel)
 * @usage const { authFetch } = makeSession('aimeat-wallet.js'); // names the lib in the auth-missing error
 * @version-history
 *   v1.0.0 — 2026-07-19 — Initial: extracted from the per-lib inline session glue (SDK-libs migration Phase 0).
 *   v1.1.0 — 2026-07-20 — makeSession(libLabel) restores each lib's specific "before aimeat-<name>.js" auth-guard error (agent-locatable), preserving DRY.
 */

/**
 * The live AIMEAT session object exposed by aimeat-auth.js. Only the members libs actually read
 * are declared; it carries more (see aimeat-auth's createSession).
 * @typedef {Object} AimeatSession
 * @property {(path: string, opts?: RequestInit) => Promise<any>} fetch  Authed fetch → parsed envelope.
 * @property {string} [jwt]
 * @property {string} [ghii]   Full GHII/GAII of the signed-in principal.
 * @property {string} [owner]  Bare owner name.
 * @property {string} [displayName]
 * @property {string[]} [roles]
 */

/**
 * Return the current signed-in session, or throw a descriptive error. `libLabel` (the served
 * filename, e.g. 'aimeat-wallet.js') is named in the "include aimeat-auth.js first" error so the
 * message points at the exact lib — the locator an agent/dev needs to fix the load order.
 * @param {string} [libLabel]
 * @returns {AimeatSession}
 */
export function getSession(libLabel) {
  const auth = window.AIMEAT && window.AIMEAT.auth;
  if (!auth) {
    throw new Error('AIMEAT.auth is required. Include aimeat-auth.js before ' + (libLabel || 'this library'));
  }
  const s = auth.getSession();
  if (!s) throw new Error('Not logged in. Call AIMEAT.auth.login() first.');
  return s;
}

/**
 * Authed fetch against the node — delegates to the session's own `fetch` (token + refresh + heal).
 * @param {string} path
 * @param {RequestInit} [opts]
 * @param {string} [libLabel]  The served filename, named in the auth-missing error.
 * @returns {Promise<any>}  The parsed response envelope.
 */
export function authFetch(path, opts, libLabel) {
  return getSession(libLabel).fetch(path, opts);
}

/**
 * Bind the per-lib served filename once so each lib's auth-guard error names the specific file
 * (e.g. "…before aimeat-wallet.js") instead of a generic "this library". Call sites stay unchanged.
 * @param {string} libLabel  The served filename, e.g. 'aimeat-wallet.js'.
 * @returns {{ getSession: () => AimeatSession, authFetch: (path: string, opts?: RequestInit) => Promise<any> }}
 */
export function makeSession(libLabel) {
  return {
    getSession: () => getSession(libLabel),
    authFetch: (path, opts) => authFetch(path, opts, libLabel),
  };
}
