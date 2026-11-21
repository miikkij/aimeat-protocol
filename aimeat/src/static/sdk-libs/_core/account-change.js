/**
 * @file _core/account-change.js
 * @description Run a function when the signed-in account changes: AIMEAT.auth's 'login' (a sign-in,
 *   a restore, an account switch) and 'logout' events. A library that caches what one caller may
 *   reach (the AI capabilities and model lists, the agent list) drops its cache here, so the next
 *   account does not see the previous one's answers for up to an hour (appdev pitfall
 *   ai/invalidate-caller-catalogues-and-keep-ai-caller-stable).
 *
 *   aimeat-auth loads first by contract; when it is not on the page yet, the subscription is tried
 *   once more when the document has been parsed.
 * @structure onAccountChange(fn)
 * @usage import { onAccountChange } from '../_core/account-change.js'; onAccountChange(clearCaches);
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */

/**
 * @param {() => void} fn  called on every login and logout event; a throw in it is caught
 * @returns {void}
 */
export function onAccountChange(fn) {
  const safe = function () {
    try { fn(); } catch (e) { console.warn('[aimeat] a cache could not be cleared on an account change:', e && /** @type {Error} */ (e).message); }
  };
  function subscribe() {
    const auth = typeof window !== 'undefined' && window.AIMEAT && window.AIMEAT.auth;
    if (!auth || typeof auth.on !== 'function') return false;
    auth.on('login', safe);
    auth.on('logout', safe);
    return true;
  }
  if (subscribe()) return;
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { subscribe(); }, { once: true });
  }
}
