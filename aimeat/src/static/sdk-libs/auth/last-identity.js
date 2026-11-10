/**
 * @file src/static/sdk-libs/auth/last-identity.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who signed in on this browser last, kept so an app that works with no connection can
 *   open that person's own copy of their data while the node cannot be reached.
 *
 *   WHAT IS KEPT. The account name, the GHII, the display name and the time, in this origin's
 *   localStorage under the library's own prefix. No token and no key: the record names a person and
 *   authorises nothing. A request to the node still needs a session, which only the node gives.
 *
 *   WHEN IT IS READ. A page load that restores no session asks one more question before it treats
 *   the person as signed out: did the node answer at all? With no answer (the browser reports no
 *   network, or a request to the node fails before any status comes back) and a kept identity, the
 *   library emits 'offline' with that identity and leaves the stored session alone, so the app's
 *   sign-out handler does not run and the app may open the copy it keeps on the device. With an
 *   answer and no session, nobody is signed in: the kept identity is removed and 'logout' is emitted
 *   as before.
 *
 *   WHEN THE NETWORK RETURNS. The browser's online event runs the caller's restore once more. A
 *   session that comes back arrives through 'login' like any restore; none ends the offline state
 *   through the branch above.
 *
 *   HOW IT GOES STALE. A sign-in replaces the record, a sign-out removes it, and the first page load
 *   that reaches the node without a session removes it. It is never older than the last time this
 *   browser reached the node.
 * @structure lastIdentity · forgetLastIdentity · offlineIdentity · nodeUnreachable · settleNoSession
 * @usage
 *   import { settleNoSession, offlineIdentity, forgetLastIdentity } from './last-identity.js';
 *   restore().then((s) => s || settleNoSession(restore));
 * @version-history
 *   v1.0.0 — 2026-11-10 — Initial (wish-teht-v-t-todoist-kind-task-app-on-aimeat-with-agents-app-too).
 */
import { save, load, remove } from './crypto.js';
import { emit, on } from './events.js';
import { NODE_URL } from './config.js';

/**
 * @typedef {Object} LastIdentity
 * @property {string} owner        The account name the session carried.
 * @property {string} ghii         The person's GHII, '' when the session carried none.
 * @property {string} displayName  The display name, '' when none.
 * @property {string} at           When the session was established on this browser (ISO).
 */

const KEY = 'last_identity';
/** How long the node gets to answer before it counts as out of reach. */
const PROBE_MS = 5000;

/** @type {LastIdentity|null} The identity announced as offline in this page load. */
let announced = null;
/** @type {(() => void)|null} The listener for the browser's online event, while one is waiting. */
let returning = null;

// A person's session, however it arrived, is the last identity. An agent session names no person.
on('login', function (session) {
  announced = null;
  if (!session || !session.owner || session.gaii) return;
  save(KEY, {
    owner: String(session.owner), ghii: String(session.ghii || ''),
    displayName: String(session.displayName || ''), at: new Date().toISOString(),
  });
});

/** @returns {LastIdentity|null} The kept identity, or null. */
export function lastIdentity() {
  const v = load(KEY);
  return v && typeof v.owner === 'string' && v.owner ? v : null;
}

/** Remove the kept identity: a sign-out, or a page load where the node says nobody is signed in. */
export function forgetLastIdentity() {
  announced = null;
  remove(KEY);
}

/**
 * The identity this page load announced with 'offline', or null: null while a session is live, and
 * null when the node was reached.
 * @returns {LastIdentity|null}
 */
export function offlineIdentity() {
  return announced;
}

/**
 * Whether the node gives no answer at all. An answer of any status counts as reachable; the request
 * is made without credentials and its body is never read.
 * @returns {Promise<boolean>}
 */
export function nodeUnreachable() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve(true);
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(function () { if (ctl) ctl.abort(); }, PROBE_MS);
  return fetch(NODE_URL + '/v1/build', { cache: 'no-store', credentials: 'omit', mode: 'no-cors', signal: ctl ? ctl.signal : undefined })
    .then(function () { return false; }, function () { return true; })
    .finally(function () { clearTimeout(timer); });
}

/**
 * A restore produced no session. Out of reach with a kept identity: emit 'offline' with it, keep the
 * stored session, and run the caller's restore again when the browser reports a network. Reachable: nobody is
 * signed in, so the kept identity and the stored session leave, and 'logout' is emitted when either
 * a stored session or an announced offline identity stood.
 * @param {() => any} retry  The caller's restore; it calls this function again when it finds nothing.
 * @param {boolean} [knownDown]  True when the caller has already found the node out of reach.
 * @returns {Promise<boolean>} True when the node is out of reach.
 */
export function settleNoSession(retry, knownDown) {
  return (knownDown ? Promise.resolve(true) : nodeUnreachable()).then(function (down) {
    if (!down) {
      const stood = !!announced || !!load('session');
      remove('session');
      forgetLastIdentity();
      if (stood) emit('logout');
      return false;
    }
    const who = lastIdentity();
    if (who && !announced) {
      announced = who;
      emit('offline', who);
    }
    if (!returning && typeof window !== 'undefined') {
      returning = function () {
        window.removeEventListener('online', /** @type {() => void} */ (returning));
        returning = null;
        try { retry(); } catch (e) { console.warn('[aimeat-auth] The restore after the network returned failed:', e && /** @type {Error} */ (e).message); }
      };
      window.addEventListener('online', returning);
    }
    return true;
  });
}
