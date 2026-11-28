/**
 * @file auth/on-login.js
 * @description When a caller's onLogin and onSession run. One place, so the login pill,
 *   AIMEAT.auth.signIn() and AIMEAT.auth.showLoginModal() cannot drift apart on it.
 *
 *   Two callbacks, decided by the developer on 2026-09-13:
 *   - `onLogin(session)` keeps its contract: it runs after an interactive sign-in or registration, and
 *     never for a stored session restored on page load. Measured on aimeat.io the same day, three live
 *     apps reload the page from onLogin and 91 of the 104 apps using it restore the session themselves,
 *     so firing it on a restore would loop the first and run the second twice.
 *   - `onSession(session, { restored })` is the one handler that covers both ways a person arrives:
 *     it runs once for every session that becomes available, the restore on page load
 *     (`restored: true`) and a sign-in (`restored: false`).
 *
 *   Where `restored` comes from: every 'login' the session core emits says which road produced the
 *   session (session.js, the third argument to emit). The restore roads say true: the stored session
 *   and the refresh cookie behind login(), the silent bridge on an app origin when no click asked for
 *   it, and a session handed over by an embedding page. The sign-in roads say false: the password and
 *   passkey logins, registration, the bridge or consent popup a click started, and a re-issued grant
 *   from the permissions gear. This module never guesses; it reads that flag.
 *
 *   "Once per session appearance": a session appears when the library goes from no session, or
 *   another person's, to this person's. A second 'login' about the person already signed in is not a
 *   new appearance. A sign-out ends one, so the next sign-in is reported again.
 * @structure sessionIdentity(session) · reportSession(callbacks, session, restored) ·
 *   loginWatcher(callbacks, liveSession) for a mounted pill · onLoginWhileOpen(callbacks) for one call.
 * @usage import { loginWatcher, onLoginWhileOpen } from './on-login.js';
 * @version-history
 *   2026-11-28 — Comments only: the typedefs AuthSession (what a callback receives) and
 *     MountLoginOptions (what the login button takes), which the library reference serves.
 *   v1.1.0 — 2026-09-13 — onSession(session, { restored }) is the handler that fires on a restore too;
 *     onLogin stays sign-in only, as it always was, after the measurement above.
 *   v1.0.0 — 2026-09-13 — Initial: taken out of modal.js (which called onLogin directly after an
 *     interactive sign-in) and put where every road reaches it.
 */
import { on, off } from './events.js';

/**
 * @typedef {object} AuthSession
 * @property {string} owner  the account name, for example "alice"
 * @property {string|null} ghii  the person's full identity, "alice@node-id"
 * @property {string|null} gaii  an agent's identity when the session is an agent's, else null
 * @property {string|null} identity  gaii when there is one, else ghii
 * @property {string} displayName  the name the person chose to show; may be empty, so show `owner` then
 * @property {string[]} roles
 * @property {string} nodeUrl  the node's address
 * @property {boolean} federated  true for a visitor signed in from another node
 * @property {string} homeNode  that visitor's own node id, else empty
 * @property {string} homeUrl  that node's address, else empty
 * @property {(path: string, opts?: RequestInit) => Promise<{ ok: boolean, data?: any, error?: { code: string, message: string } }>} fetch
 *   an authenticated call to the node; answers the parsed envelope for every status and does not
 *   throw on a refusal, so branch on `ok`
 * @property {() => Promise<any>} refresh  renews the session; the library does it by itself before expiry
 * @property {(title: string, opts?: { body?: string, link?: string, type?: string }) => Promise<any>} notify
 *   sends the person a notification
 */

/**
 * @typedef {object} MountLoginOptions
 * @property {(session: AuthSession, how: { restored: boolean }) => void} [onSession]
 *   once for every session that becomes available, a restore and a sign-in alike: show the app here
 * @property {(session: AuthSession) => void} [onLogin]  after a sign-in or a registration only
 * @property {() => void} [onLogout]
 * @property {string[]} [locales]  the languages the app has (or `<meta name="aimeat-locales"
 *   content="en fi">`): with two or more the button shows a language switch, with fewer none
 * @property {boolean} [compact]  default true: one small button with the rest in a popover at
 *   600 px and under; false keeps the full row at every width
 * @property {string} [buttonText]  replaces the words on the signed-out button
 * @property {string} [nameHref]  makes the person's name a link
 * @property {Record<string, string>} [i18n]  replaces the button's own labels
 */

/**
 * Who a session belongs to, as one string, so a new sign-in can be told from a repeat about the same
 * person. A session with no name at all still counts as somebody.
 * @param {any} session
 * @returns {string|null}
 */
export function sessionIdentity(session) {
  if (!session) return null;
  return String(session.ghii || session.owner || session.identity || session.gaii || '?');
}

/**
 * Run one page callback. It runs inside the event bus, so a callback that throws, or returns a
 * promise that rejects, is reported in the console and goes no further: one app bug must not stop
 * the page's other login listeners.
 * @param {string} name
 * @param {any} fn
 * @param {any[]} args
 */
function runCallback(name, fn, args) {
  if (typeof fn !== 'function') return;
  var report = function (e) {
    try { console.error('[aimeat-auth] The page\'s ' + name + ' failed. The session is signed in; fix the callback:', e); } catch { /* no console */ }
  };
  try {
    var result = fn.apply(null, args);
    if (result && typeof result.then === 'function') result.then(null, report);
  } catch (e) {
    report(e);
  }
}

/**
 * Report a session to a caller's callbacks: onSession always, with the road it came by; onLogin
 * only for a sign-in, with the session alone, exactly as it was always called.
 * @param {{ onLogin?: any, onSession?: any }} callbacks
 * @param {any} session
 * @param {boolean} restored
 */
export function reportSession(callbacks, session, restored) {
  var cb = callbacks || {};
  runCallback('onSession', cb.onSession, [session, { restored: !!restored }]);
  if (!restored) runCallback('onLogin', cb.onLogin, [session]);
}

/**
 * The callbacks of a mounted login pill: called for each session that appears while it is mounted.
 * A session already live when the pill mounts goes to onSession as a restore (the page cannot have
 * missed its only chance to hear about it), and never to onLogin, which was not called for it before.
 * @param {{ onLogin?: any, onSession?: any }} callbacks
 * @param {any} liveSession the session at mount time, or null
 * @returns {{ login: (session: any, meta?: { restored?: boolean }) => void, logout: () => void }}
 */
export function loginWatcher(callbacks, liveSession) {
  var reported = sessionIdentity(liveSession);
  if (liveSession && callbacks && typeof callbacks.onSession === 'function') {
    // After the mount has finished drawing, so the handler sees the pill in the page.
    setTimeout(function () {
      if (sessionIdentity(liveSession) === reported) runCallback('onSession', callbacks.onSession, [liveSession, { restored: true }]);
    }, 0);
  }
  return {
    login: function (session, meta) {
      var who = sessionIdentity(session);
      if (!who || who === reported) return;
      reported = who;
      reportSession(callbacks, session, !!(meta && meta.restored));
    },
    logout: function () { reported = null; },
  };
}

/**
 * The callbacks handed to ONE sign-in call (AIMEAT.auth.signIn, AIMEAT.auth.showLoginModal): the first
 * session that arrives while that call is open, whichever road brings it, once. The call stops
 * listening when it settles, so a sign-in that happens later belongs to whoever asks then.
 * @param {{ onLogin?: any, onSession?: any }} callbacks
 * @returns {() => void} stop listening
 */
export function onLoginWhileOpen(callbacks) {
  var cb = callbacks || {};
  if (typeof cb.onLogin !== 'function' && typeof cb.onSession !== 'function') return function () {};
  var done = false;
  function hear(session, meta) {
    if (done || !session) return;
    done = true;
    off('login', hear);
    reportSession(cb, session, !!(meta && meta.restored));
  }
  on('login', hear);
  return function stop() { done = true; off('login', hear); };
}
