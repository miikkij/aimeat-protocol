/**
 * @file atelier/members-shared.js
 * @description What the members components share (members-admin.js, members.js): the sample test,
 *   the redraw on a sign-in, a sign-out or a language change, the confirm dialog read from the kit's
 *   public surface, the library on the page, the refusal sentence, dates, roles and their power, and
 *   one person drawn as a face with a name over an account. Split out of members.js when the owner's
 *   screen grew past what one file holds.
 * @structure appSession · isPlaceholder · wantsSample · sampleBadge · watch · ask · iamOf · ready ·
 *   refusalWords · refusal · day · power · roleSelect · person
 * @usage import { ready, refusal, person } from './members-shared.js';
 * @version-history
 *   v0.63.0 — 2026-10-02 — appSession() moves here from connections.js unchanged, for decision.js;
 *     refusal() keeps the node's own sentence for INVALID_INPUT and NOT_FOUND when it names the field.
 *   v0.62.0 — 2026-10-02 — refusal() says a refusal code it knows in the page's language
 *     (refusalWords, members-i18n.js refuse.<CODE>), with the retry date and the wait through
 *     _core/format.js; an unknown code keeps the node's sentence. The code and details are read off
 *     the envelope's `error` and off a thrown error's own `code` and `details`.
 *   v0.61.0 — 2026-10-01 — Initial: moved out of members.js unchanged, plus power() and person().
 */
import { el } from './dom.js';
import { tm } from './members-i18n.js';
import { i18n } from './i18n.js';
import { dateTime, duration } from '../_core/format.js';
import { APEX_URL } from '../_core/config.js';

/**
 * True when this page is an app kept apart from the node (its own origin, or the node's isolated
 * frame), where the node grants no connections:write and refuses an app's review of a decision it
 * asked for. Read from AIMEAT.auth, which knows both; a page without the auth library compares its
 * origin with the node's apex. Moved from connections.js unchanged; decision.js asks it too.
 * @returns {boolean}
 */
export function appSession() {
  const ns = /** @type {any} */ (window).AIMEAT;
  const auth = ns && ns.auth;
  if (auth && typeof auth.isAppOrigin === 'function') {
    try { if (auth.isAppOrigin()) return true; } catch { /* read the session below */ }
    const s = typeof auth.getSession === 'function' ? auth.getSession() : null;
    return !!(s && s._appOrigin);
  }
  try {
    return !!APEX_URL && window.location.origin !== new URL(APEX_URL).origin;
  } catch {
    return false;
  }
}

/** A fill's unreplaced placeholder: "<owner/file.html>" and friends. */
export function isPlaceholder(v) {
  return /^\s*</.test(String(v == null ? '' : v));
}

/** Whether this spec asks for the sample state: by flag, or by an app id that is a placeholder. */
export function wantsSample(spec) {
  return !!spec && (spec.sample === true || !spec.app || isPlaceholder(spec.app));
}

/** The chip every sample render carries, so gallery content is never mistaken for the real thing. */
export function sampleBadge() {
  return el('span', { class: 'ak-mem-sample' }, tm('sample.badge'));
}

/**
 * Draw again when the person changes (a sign-in or a sign-out on the same page) or the language
 * does. Without this a visitor who signed in after the owner was shown the owner's controls until
 * a reload. Returns the function that stops listening.
 *
 * A block the app removed from the page without calling destroy() stops listening on the next
 * event: an app that clears its main region and draws again on every sign-in otherwise collected
 * one more listener, and one more standing read, per sign-in.
 * @param {() => void} again
 * @param {HTMLElement} root  the block's own element
 */
export function watch(again, root) {
  let stopped = false;
  const auth = /** @type {any} */ (window).AIMEAT && /** @type {any} */ (window).AIMEAT.auth;
  const on = auth && typeof auth.on === 'function';
  function handle() {
    if (stopped) return;
    if (!root.isConnected) { stop(); return; }
    again();
  }
  const stopLang = i18n.onChange(handle);
  if (on) { auth.on('login', handle); auth.on('logout', handle); }
  function stop() {
    if (stopped) return;
    stopped = true;
    if (typeof stopLang === 'function') stopLang();
    if (on && typeof auth.off === 'function') { auth.off('login', handle); auth.off('logout', handle); }
  }
  return stop;
}

/**
 * The kit's own confirm dialog, read from the public surface at the moment it is needed. Imported
 * directly it closed an import cycle (dialog → mosaic → mosaic-self → members → dialog); the kit is
 * on the page whenever this module runs, and the browser's own box answers if it somehow is not.
 * @param {{ title: string, text?: string, confirmLabel?: string, tone?: 'primary'|'danger' }} spec
 * @returns {Promise<boolean>}
 */
export function ask(spec) {
  const kit = /** @type {any} */ (window).AIMEAT && /** @type {any} */ (window).AIMEAT.atelier;
  if (kit && typeof kit.confirm === 'function') return kit.confirm(spec);
  return Promise.resolve(window.confirm(spec.title));
}

/** The page's AIMEAT.iam, or null. */
export function iamOf() {
  const ns = /** @type {any} */ (window).AIMEAT;
  return ns && ns.iam ? ns.iam : null;
}

/**
 * AIMEAT.iam, initialised for this app once. A page that already called init() is left alone, so an
 * app that wired the library itself keeps its own vocabulary.
 * @param {{ app: string, roles?: any }} spec
 */
export async function ready(spec) {
  const iam = iamOf();
  if (!iam) return null;
  if (!iam.me()) {
    // Signed out, the standing cannot be read; the library is still there, with nobody to stand.
    await iam.init({ app: spec.app, roles: spec.roles }).catch(function (e) {
      console.debug('aimeat-atelier: members standing not read', e);
    });
  }
  return iam;
}

/** Codes that share another code's words: the node says ACCESS_DENIED where a role is missing. */
const SAME_WORDS = /** @type {Record<string, string>} */ ({ ACCESS_DENIED: 'FORBIDDEN' });

/** How the date in a refusal is written: short enough to read the same in any language around it. */
const WHEN = { dateStyle: 'medium', timeStyle: 'short' };

/**
 * A refusal code in the page's language, or '' when this dictionary (or the host's, under
 * `members.refuse.<CODE>`) has no words for it. `details.retryAt` becomes the date `{d}` and
 * `details.retry_after_sec` the wait `{t}`, both through the SDK's formatter (_core/format.js); a
 * sentence that needs one the refusal did not carry takes its `.later` form.
 * @param {unknown} code
 * @param {any} [details]
 * @returns {string}
 */
export function refusalWords(code, details) {
  if (typeof code !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(code)) return '';
  const key = 'refuse.' + (SAME_WORDS[code] || code);
  const d = details && typeof details === 'object' ? details : {};
  /** @type {Record<string, string>} */
  const vars = {};
  if (typeof d.retryAt === 'string' && Number.isFinite(Date.parse(d.retryAt))) vars.d = dateTime(d.retryAt, WHEN);
  if (typeof d.retry_after_sec === 'number' && d.retry_after_sec > 0) vars.t = duration(d.retry_after_sec * 1000, { max: 2 });
  const text = tm(key, vars);
  if (text === key) return '';
  if (!/\{[dt]\}/.test(text)) return text;
  const later = tm(key + '.later');
  return later === key + '.later' ? '' : later;
}

/**
 * Codes whose node sentence names the field or the thing that failed ("Field 'email' is too long",
 * "No account named x"). The general words would lose that, so they stand in only when the node
 * said nothing.
 */
const SPECIFIC = new Set(['INVALID_INPUT', 'NOT_FOUND']);

/**
 * The sentence a refusal carries: the node's envelope, an extension's string, or a thrown error.
 * A code this dictionary knows is said in the page's language (refusalWords); any other keeps the
 * node's own sentence, which is English, and so does a SPECIFIC code that came with one.
 */
export function refusal(r) {
  if (!r) return '';
  const thrown = r instanceof Error;
  if (!thrown && r.ok !== false) return '';
  const env = thrown ? /** @type {any} */ (r) : (r.error && typeof r.error === 'object' ? r.error : {});
  const said = thrown ? r.message
    : (typeof r.error === 'string' ? r.error : (typeof env.message === 'string' ? env.message : ''));
  if (said && SPECIFIC.has(env.code)) return said;
  return refusalWords(env.code, env.details) || said;
}

/** A date as a person reads it; a value that is not a date is shown as itself. */
export function day(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toISOString().slice(0, 10);
}

/**
 * How much a role may do: its capability count, `*` counting as everything. Raising somebody to a
 * role with more power asks first; lowering does not.
 * @param {Record<string, string[]>} caps
 * @param {string} role
 */
export function power(caps, role) {
  const c = (caps && caps[role]) || [];
  return c.indexOf('*') !== -1 ? Infinity : c.length;
}

/** A role select, set to `value`. */
export function roleSelect(roles, value, label, labelOf) {
  const s = /** @type {HTMLSelectElement} */ (el('select', { class: 'ak-input ak-mem__role', 'aria-label': label },
    roles.map(function (r) { return el('option', { value: r, selected: r === value ? true : null }, labelOf ? labelOf(r) : r); })));
  if (value) s.value = value;
  return s;
}

/**
 * One person: a face with their initial, the name, and under it the address the owner holds for
 * them (or, without one, the account name when it differs from the name). A name that is the
 * account name is shown once. The account name is always in the title, for the pointer.
 * @param {string} account
 * @param {string|null|undefined} displayName
 * @param {string|null|undefined} [email]
 */
export function person(account, displayName, email) {
  const shown = displayName || account || '';
  const sub = email || (displayName && account && displayName !== account ? account : '');
  return el('span', { class: 'ak-mem__person', 'data-ak-part': 'who', title: account || null }, [
    el('span', { class: 'ak-mem__face', 'aria-hidden': 'true' }, shown.slice(0, 1).toUpperCase()),
    el('span', { class: 'ak-mem__names' }, [
      el('span', { class: 'ak-mem__name' }, shown),
      sub ? el('span', { class: 'ak-mem__account' }, sub) : null,
    ].filter(Boolean)),
  ]);
}
