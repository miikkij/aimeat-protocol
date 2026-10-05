/**
 * @file lang.js
 * @description Shared SDK-libs core: the reader's language, resolved one way for every served
 *   library. Before this, five libraries resolved it on their own (the auth pill, the sign-in modal,
 *   the header, the Atelier kit and the game kit) and a dozen places read the 'aimeat-lang' storage
 *   key directly, so the order drifted: two of them skipped the cookie, and the kits skipped ?lang=.
 *
 *   THE ORDER is the one the platform documents (public/js/utils.js detectLocale, the build-app
 *   prompt, AIMEAT.auth.getLang): ?lang= → the stored choice ('aimeat-lang' in localStorage) → the
 *   'aimeat-lang' cookie → the browser's language → the fallback.
 *
 *   WITH A LIST (the languages a page or a library carries) a source counts only when it names one
 *   of them, and the fallback is the list's first language. An EMPTY list accepts nothing and
 *   answers undefined, which is what AIMEAT.auth.getLang() has always answered on a page that
 *   declares no languages. WITHOUT A LIST any source counts, cut to two letters, and the fallback
 *   is 'en'.
 *
 *   WRITING sets the stored choice and the cookie together, so the SPA, an app on the same origin
 *   and the server agree. The 'aimeat-lang-change' event stays with the caller: each library
 *   announces a change its own way.
 * @structure LANG_KEY · readLocales(opts) · storedLang() · readLang(locales) · pageLang() ·
 *   writeLang(lang)
 * @usage import { readLang, pageLang, writeLang } from '../_core/lang.js';
 *   readLang(['en', 'fi', 'es']);   // a library that ships three languages
 *   pageLang();                     // the page's declared languages, or any language
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial: the one resolver and the one setter, moved here from
 *     auth/locale.js (aimeatReadLang, aimeatApplyLang, readLocales) so the modal, the header and the
 *     two kits use them too (secaudit 2026-10, M7).
 */

/** The one language key on this platform: localStorage and cookie both. */
export const LANG_KEY = 'aimeat-lang';

/** How long the cookie keeps the choice: one year, as the SPA's persistLocale writes it. */
const COOKIE_MAX_AGE = 31536000;

/**
 * The two-letter codes a page says it carries: `opts.locales`, else the
 * `<meta name="aimeat-locales" content="en fi">` tag. Order is kept, duplicates and malformed codes
 * are dropped, and a single language answers an empty list (one language needs no switch).
 * @param {{ locales?: string[] }} [opts]
 * @returns {string[]}
 */
export function readLocales(opts) {
  let list = (opts && Array.isArray(opts.locales)) ? opts.locales : null;
  if (!list) {
    try {
      const m = /** @type {HTMLMetaElement|null} */ (document.querySelector('meta[name="aimeat-locales"]'));
      if (m && m.content) list = m.content.split(/[\s,]+/);
    } catch { /* no document */ }
  }
  if (!list) return [];
  /** @type {Record<string, number>} */
  const seen = {};
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const c = String(list[i] || '').trim().toLowerCase();
    if (/^[a-z]{2}$/.test(c) && !seen[c]) { seen[c] = 1; out.push(c); }
  }
  return out.length > 1 ? out : [];
}

/**
 * The language the person chose, as stored, or null when there is none or storage is blocked.
 * @returns {string|null}
 */
export function storedLang() {
  try { return localStorage.getItem(LANG_KEY) || null; } catch { return null; }
}

/**
 * The reader's language: ?lang= → stored choice → cookie → browser → fallback.
 * @param {string[]|null} [locales]  the languages accepted; null or left out accepts any
 * @returns {string|undefined}  undefined only for an empty list
 */
export function readLang(locales) {
  const list = Array.isArray(locales) ? locales : null;
  /** @type {(v: string|null|undefined) => string|null} */
  const pick = list
    ? function (v) { return v && list.indexOf(v) >= 0 ? v : null; }
    : function (v) { return v ? String(v).slice(0, 2) : null; };
  try {
    const u = pick(new URLSearchParams(location.search).get('lang'));
    if (u) return u;
    const s = pick(localStorage.getItem(LANG_KEY));
    if (s) return s;
    const c = document.cookie.match(/(?:^|;\s*)aimeat-lang=([a-z]{2})(?:;|$)/);
    const cv = c ? pick(c[1]) : null;
    if (cv) return cv;
  } catch { /* storage blocked, or no location or document: the browser answers below */ }
  let nav = null;
  try { nav = pick(String(navigator.language || '').slice(0, 2).toLowerCase()); } catch { /* no navigator */ }
  if (nav) return nav;
  return list ? list[0] : 'en';
}

/**
 * The reader's language for a library that carries no list of its own (the Atelier and game kits,
 * the asset texts): the page's declared languages when it declares two or more, else any language.
 * @returns {string}
 */
export function pageLang() {
  const list = readLocales();
  return /** @type {string} */ (readLang(list.length ? list : null));
}

/**
 * Remember the person's choice: the stored key and the cookie, in one step.
 * @param {string} lang  a two-letter code
 */
export function writeLang(lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
    document.cookie = LANG_KEY + '=' + lang + ';path=/;max-age=' + COOKIE_MAX_AGE + ';SameSite=Lax';
  } catch { /* storage blocked */ }
}
