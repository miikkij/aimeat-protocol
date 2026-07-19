/**
 * @file session.js
 * @description Shared SDK-libs core — the `AIMEAT.auth` session glue that data/storage/social/…
 *   each re-implemented. `getSession()` asserts aimeat-auth.js is loaded and the user is signed in,
 *   returning the live session object; `authFetch()` delegates to `session.fetch` (which injects the
 *   bearer token, refreshes on 401, and self-heals scope drift). Behavior matches the inline
 *   `getSession()` / `authFetch()` of the legacy libs.
 * @structure getSession() · authFetch(path, opts)
 * @usage import { authFetch } from '../_core/session.js';
 * @version-history
 *   v1.0.0 — 2026-07-19 — Initial: extracted from the per-lib inline session glue (SDK-libs migration Phase 0).
 */

/**
 * The live AIMEAT session object exposed by aimeat-auth.js.
 * @typedef {Object} AimeatSession
 * @property {(path: string, opts?: RequestInit) => Promise<any>} fetch  Authed fetch → parsed envelope.
 * @property {string} [jwt]
 */

/**
 * Return the current signed-in session, or throw a descriptive error.
 * @returns {AimeatSession}
 */
export function getSession() {
  const auth = window.AIMEAT && window.AIMEAT.auth;
  if (!auth) {
    throw new Error('AIMEAT.auth is required. Include aimeat-auth.js before this library.');
  }
  const s = auth.getSession();
  if (!s) throw new Error('Not logged in. Call AIMEAT.auth.login() first.');
  return s;
}

/**
 * Authed fetch against the node — delegates to the session's own `fetch` (token + refresh + heal).
 * @param {string} path
 * @param {RequestInit} [opts]
 * @returns {Promise<any>}  The parsed response envelope.
 */
export function authFetch(path, opts) {
  return getSession().fetch(path, opts);
}
