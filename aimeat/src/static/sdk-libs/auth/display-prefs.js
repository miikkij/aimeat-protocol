/**
 * @file auth/display-prefs.js
 * @description The signed-in person's own `region` (how a date and a number are written) and
 *   `timezone` (which clock), for every served library that writes a date, a time or a number in an
 *   app. _core/format.js reads them through AIMEAT.auth.displayPrefs(); the portal has its own copy
 *   of this read in public/js/display-prefs.js.
 *
 *   THE READ IS THE PERSON'S OWN PROFILE. GET /v1/ghii/me with the app's own session, which any
 *   session acting for the person may already call; only the two settings are kept. Nothing is
 *   derived from the page language: language, regional format and clock are three settings.
 *   → decision "Kieli, esitysmuoto ja aikavyöhyke ovat kolme erillistä asetusta", 2026-09-12
 *
 *   NOTHING SET MEANS THE BROWSER, as before: signed out, a visitor from another node (their profile
 *   lives on their home node), a refused read, or a person who never chose either setting all answer
 *   `{ region: null, timezone: null }`, and Intl then uses the reader's browser.
 *
 *   THE READ STARTS AT THE FIRST DATE OR NUMBER, not at sign-in: an app that writes none sends no
 *   request, and neither does the node's own portal, which loads aimeat-auth and has its own read.
 *   One read per person per page load. Until it lands the copy kept from the last load answers
 *   (localStorage on the app's origin, keyed to the person, removed at sign-out), so a returning
 *   reader's first paint is already right; when the read changes something the window gets
 *   `aimeat-prefs-change` with `{ region, timezone }`, the same event the portal sends, and an app
 *   re-renders its dates on it.
 * @structure makeDisplayPrefs(getSession, store?) → { current(), forget() }
 * @usage import { makeDisplayPrefs } from './display-prefs.js';
 *   var prefs = makeDisplayPrefs(function () { return auth.getSession(); });
 *   auth.displayPrefs = prefs.current; on('logout', prefs.forget);
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 10b of 2026-11-05).
 */
import { save, load, remove } from './crypto.js';

/** The localStorage key (crypto.js adds its `aimeat_` prefix). */
var KEEP_KEY = 'display-prefs';

/**
 * Who a session is, as one string; '' when it names nobody.
 * @param {any} s
 * @returns {string}
 */
function identityOf(s) {
  return s ? String(s.ghii || s.owner || s.identity || '') : '';
}

/**
 * @param {() => any} getSession  the live session, or null when signed out
 * @param {{ save: (k: string, v: any) => void, load: (k: string) => any, remove: (k: string) => void }} [store]
 * @returns {{ current: () => { region: string|null, timezone: string|null }, forget: () => void }}
 */
export function makeDisplayPrefs(getSession, store) {
  var keep = store || { save: save, load: load, remove: remove };
  /** @type {string|null} */ var who = null;
  /** @type {string|null} */ var region = null;
  /** @type {string|null} */ var timezone = null;
  var asked = false;

  function announce() {
    try {
      window.dispatchEvent(new CustomEvent('aimeat-prefs-change', { detail: { region: region, timezone: timezone } }));
    } catch (e) {
      console.warn('[aimeat-auth] The display settings changed but the page could not be told:', e && /** @type {Error} */ (e).message);
    }
  }

  /** @param {any} s @param {string} forWho */
  function read(s, forWho) {
    /** @type {Promise<any>} */ var answer;
    try { answer = Promise.resolve(s.fetch('/v1/ghii/me')); } catch (e) { answer = Promise.reject(e); }
    answer.then(function (body) {
      // Signed out, or somebody else signed in, while the read was on its way.
      if (who !== forWho) return;
      // A refusal is not "no preference": keep what is there.
      if (!body || !body.ok || !body.data) return;
      var r = body.data.region || null;
      var z = body.data.timezone || null;
      keep.save(KEEP_KEY, { who: forWho, region: r, timezone: z });
      if (r === region && z === timezone) return;
      region = r;
      timezone = z;
      announce();
    }, function (e) {
      console.warn('[aimeat-auth] Reading the display settings failed; dates follow the browser:', e && /** @type {Error} */ (e).message);
    });
  }

  function current() {
    var s;
    try {
      s = getSession();
    } catch (e) {
      // No session object to ask is the signed-out answer.
      console.warn('[aimeat-auth] The session could not be read; dates follow the browser:', e && /** @type {Error} */ (e).message);
      s = null;
    }
    var id = identityOf(s);
    if (!s || !id || s.federated) {
      who = null; region = null; timezone = null; asked = false;
      return { region: null, timezone: null };
    }
    if (id !== who) {
      who = id;
      asked = false;
      var kept = keep.load(KEEP_KEY);
      var mine = kept && kept.who === id;
      region = mine ? kept.region || null : null;
      timezone = mine ? kept.timezone || null : null;
    }
    if (!asked) {
      asked = true;
      read(s, id);
    }
    return { region: region, timezone: timezone };
  }

  function forget() {
    who = null; region = null; timezone = null; asked = false;
    keep.remove(KEEP_KEY);
  }

  return { current: current, forget: forget };
}
