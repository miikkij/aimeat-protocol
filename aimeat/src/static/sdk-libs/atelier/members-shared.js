/**
 * @file atelier/members-shared.js
 * @description What the members components share (members-admin.js, members.js): the sample test,
 *   the redraw on a sign-in, a sign-out or a language change, the confirm dialog read from the kit's
 *   public surface, the library on the page, the refusal sentence, dates, roles and their power, and
 *   one person drawn as a face with a name over an account. Split out of members.js when the owner's
 *   screen grew past what one file holds.
 * @structure isPlaceholder · wantsSample · sampleBadge · watch · ask · iamOf · ready · refusal · day ·
 *   power · roleSelect · person
 * @usage import { ready, refusal, person } from './members-shared.js';
 * @version-history
 *   v0.61.0 — 2026-10-01 — Initial: moved out of members.js unchanged, plus power() and person().
 */
import { el } from './dom.js';
import { tm } from './members-i18n.js';
import { i18n } from './i18n.js';

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

/** The sentence a refusal carries: the node's envelope, an extension's string, or a thrown error. */
export function refusal(r) {
  if (!r) return '';
  if (r instanceof Error) return r.message;
  if (r.ok !== false) return '';
  if (typeof r.error === 'string') return r.error;
  return (r.error && typeof r.error.message === 'string') ? r.error.message : '';
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
 * One person: a face with their initial, the display name over the account name. A person with no
 * display name shows the account once.
 * @param {string} account
 * @param {string|null|undefined} displayName
 */
export function person(account, displayName) {
  const shown = displayName || account || '';
  return el('span', { class: 'ak-mem__person', 'data-ak-part': 'who' }, [
    el('span', { class: 'ak-mem__face', 'aria-hidden': 'true' }, shown.slice(0, 1).toUpperCase()),
    el('span', { class: 'ak-mem__names' }, [
      el('span', { class: 'ak-mem__name' }, shown),
      displayName && account ? el('span', { class: 'ak-mem__account' }, account) : null,
    ].filter(Boolean)),
  ]);
}
