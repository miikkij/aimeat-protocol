/**
 * @file display-prefs.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which clock the reader keeps and how they write a date, for every surface in the
 *   SPA. One place, read once per load, and the answer nobody had before: the reader's own.
 *
 *   THREE SETTINGS, NOT ONE. The language pill decides WORDS. It does not decide the clock, and it
 *   does not decide whether a date is 9/12/2026 or 12.9.2026. An operating system keeps display
 *   language, regional format and time zone apart and lets a person mix them; so does this. What
 *   this file replaces is six copies of one line in the profile pages' frame.js files —
 *     const localeTag = () => (getLocale() === 'fi' ? 'fi-FI' : ... : 'en-GB');
 *   — which derived the format FROM the language, and which had already drifted: five of the six
 *   gave English en-GB while the money path special-cased en-US.
 *   → decision "Kieli, esitysmuoto ja aikavyöhyke ovat kolme erillistä asetusta", 2026-09-12
 *
 *   THE BROWSER IS THE DEFAULT AND THE PROFILE OVERRIDES IT. Nobody is moved into a preference
 *   they never expressed: with nothing stored, every formatter behaves exactly as it did before
 *   this file existed, because passing `undefined` to Intl IS the browser default.
 *
 *   IT NEVER BLOCKS A RENDER. The read resolves after the first paint; until it lands the browser
 *   default applies, and a real change then dispatches `aimeat-live-update`, which is the event
 *   every tab in this app already re-renders on. A formatter that awaited a preference would put a
 *   network round trip in front of every date on the screen.
 *
 *   IT IS CALLED AFTER THE SESSION IS RESTORED, and that is not a detail. The read carries a bearer
 *   from localStorage which the auth library puts there; called earlier in the boot it answers 401,
 *   which is indistinguishable from a signed-out reader — so the settings never arrive and every
 *   date keeps the browser's format for the life of the page. Nothing looks broken. spa.html calls
 *   this beside `loadMarginPattern()`, after `AIMEAT.auth.login()`, and again on
 *   `aimeat-auth-change`. Found by driving the browser, after a first fix that changed the fetch
 *   and not the ordering. → docs/pitfalls.md §81
 * @structure
 *   - loadDisplayPrefs() — read /v1/ghii/me; re-runnable, never latches a failure
 *   - setDisplayPrefs(next) — after a save, so an open page repaints without a reload
 *   - getRegion() / getTimeZone() — null when the reader follows their browser
 *   - resolvedTimeZone() / zoneLabel() — the zone actually in force, and how to name it
 *   - onPrefsChange(fn) — for anything that wants the values without a re-render
 * @usage import { getRegion, getTimeZone } from '/js/display-prefs.js';
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the profile's region and timezone fields.
 */
// apiGet, not a bare fetch. This SPA signs in with a JWT held in localStorage and attaches it per
// request; a plain `fetch` with `credentials: 'same-origin'` sends no credential at all and gets a
// 401 on every page load — which reads exactly like a signed-out reader, so the settings simply
// never arrived and every date quietly fell back to the browser. Found by driving the browser.
// Safe against a cycle: api.js reaches auth.js and neither reaches format.js.
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

/** Null means "follow the browser", which is a real answer and not a missing one. */
let region = null;
let timezone = null;
let loaded = false;
let inflight = null;
const listeners = new Set();

/**
 * Tell the page the settings moved.
 *
 * `aimeat-live-update` is what does the work. Every profile and admin tab already re-fetches and
 * re-renders on it — it is the one event this app has for "what is on screen is out of date" — and
 * a private `aimeat-prefs-change` nobody listened to left the dates on an open tab American until
 * the reader navigated away and back. Measured by driving the browser. The private event stays for
 * anything that wants the values without a re-render.
 *
 * Only on a real change: the boot read usually confirms what is already there, and repainting the
 * whole app for that would be a visible flicker on every load.
 */
function announce(changed) {
  for (const fn of listeners) {
    try { fn({ region, timezone }); } catch (err) { swallowed('display-prefs: listener', err); }
  }
  try {
    window.dispatchEvent(new CustomEvent('aimeat-prefs-change', { detail: { region, timezone } }));
    if (changed) window.dispatchEvent(new Event('aimeat-live-update'));
  } catch (err) { swallowed('display-prefs: event', err); }
}

/**
 * Read this person's settings.
 *
 * CALLED AGAIN WHENEVER THE SIGN-IN CHANGES, and it re-reads every time rather than latching on
 * the first answer. It used to cache the first result, which was wrong in the one case that
 * mattered: a read made before the session is restored answers 401, and a latched "no preference"
 * is indistinguishable from a reader who never set one — so every date on the site kept the
 * browser's format for the rest of the page's life. `inflight` still stops a stampede; `loaded`
 * only records that an answer has arrived at least once.
 *
 * Signed out, or the read fails: both settings stay null and every formatter follows the browser,
 * which is the same outcome as never having opened the settings.
 */
export function loadDisplayPrefs() {
  if (inflight) return inflight;
  inflight = apiGet('/v1/ghii/me')
    .then(body => {
      const d = body?.data;
      const was = region + '|' + timezone;
      if (d) {
        region = d.region || null;
        timezone = d.timezone || null;
      }
      loaded = true;
      announce(was !== region + '|' + timezone);
      return { region, timezone };
    })
    .catch(err => {
      // Signed out is the common case here, not a fault. The browser default is the right answer,
      // and `loaded` stays where it was so a later sign-in still gets a real read.
      swallowed('display-prefs: load', err);
      return { region, timezone };
    })
    .finally(() => { inflight = null; });
  return inflight;
}

/** Set both after a save, so the page repaints without a reload. */
export function setDisplayPrefs(next) {
  const was = region + '|' + timezone;
  region = next?.region || null;
  timezone = next?.timezone || null;
  loaded = true;
  announce(was !== region + '|' + timezone);
}

/** The BCP-47 tag to format with, or null to follow the browser. */
export function getRegion() { return region; }

/** The IANA zone to read the clock in, or null to follow the browser. */
export function getTimeZone() { return timezone; }

/** Has the profile been read yet? A surface that wants to wait for it can ask. */
export function prefsLoaded() { return loaded; }

/**
 * The zone actually in force — the stored one, or the browser's own when nothing is stored.
 *
 * Always a real IANA name, so a caller never has to branch on null just to name the zone.
 */
export function resolvedTimeZone() {
  if (timezone) return timezone;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch (err) {
    swallowed('display-prefs: resolvedTimeZone', err);
    return 'UTC';
  }
}

/**
 * How to name the zone beside a time, or null when there is nothing worth saying.
 *
 * Null while the reader follows their browser: a label there would name the clock they are already
 * reading, which teaches nobody anything. Once a zone IS chosen the label is always shown, not only
 * when it differs from the device — a mark that appears only on a mismatch is itself the surprise,
 * and a reader cannot learn to trust something that comes and goes. The convention is the one the
 * design-pattern checklists give: name the zone (EET, CEST) rather than an offset.
 */
export function zoneLabel(at) {
  if (!timezone) return null;
  const when = at ? new Date(at) : new Date();
  if (!Number.isFinite(when.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat(region || undefined, {
      timeZone: timezone, timeZoneName: 'short',
    }).formatToParts(when);
    return parts.find(p => p.type === 'timeZoneName')?.value ?? null;
  } catch (err) {
    swallowed('display-prefs: zoneLabel', err);
    return null;
  }
}

/** Repaint when the settings are saved, or when the first read lands. Returns an unsubscribe. */
export function onPrefsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
