/**
 * @file lang.js
 * @description Shared SDK-libs core: the reader's language, resolved one way for every served
 *   library. Before this, five libraries resolved it on their own (the auth pill, the sign-in modal,
 *   the header, the Atelier kit and the game kit) and a dozen places read the 'aimeat-lang' storage
 *   key directly, so the order drifted: two of them skipped the cookie, and the kits skipped ?lang=.
 *
 *   THE ORDER is the one the platform documents (public/js/utils.js detectLocale, the build-app
 *   prompt, AIMEAT.auth.getLang): ?lang= → the stored choice ('aimeat-lang' in localStorage) → the
 *   'aimeat-lang' cookie → the node's own language (site.default_locale, from the config prelude)
 *   → the browser's language → the fallback.
 *
 *   WITH A LIST (the languages a page or a library carries) a source counts only when it names one
 *   of them, and the fallback is the list's first language. An EMPTY list accepts nothing and
 *   answers undefined, which is what AIMEAT.auth.getLang() has always answered on a page that
 *   declares no languages. WITHOUT A LIST any source counts, cut to two letters, and the fallback
 *   is 'en'.
 *
 *   A PAGE THE NODE PICKED BY LANGUAGE comes first of all. The node serves an operator's front page
 *   as one whole page per language and names the language of the page it sent in
 *   `<meta name="aimeat-page-lang">` (src/utils/page-head.ts). The server chose that page from the
 *   address, the person's pick and the browser's list, so a library on it speaks the page's
 *   language: resolving again here could answer a different language than the text around it.
 *
 *   WRITING sets the stored choice and the cookie together, so the SPA, an app on the same origin
 *   and the server agree. Every caller is the person's own pick (a language button, setLang), so
 *   it also sets the pick mark ('aimeat-lang-chosen', storage and cookie) that the SPA's
 *   switchLocale sets: the server follows a language on its front page only with that mark
 *   (src/i18n.ts pickedLocale), because 'aimeat-lang' alone can be a detected language. The
 *   'aimeat-lang-change' event stays with the caller: each library announces a change its own way.
 * @structure LANG_KEY · LANG_CHOSEN_KEY · readLocales(opts) · storedLang() · servedPageLang() ·
 *   readLang(locales) · pageLang() · writeLang(lang)
 * @usage import { readLang, pageLang, writeLang } from '../_core/lang.js';
 *   readLang(['en', 'fi', 'es']);   // a library that ships three languages
 *   pageLang();                     // the page's declared languages, or any language
 * @version-history
 *   v1.2.0 — 2026-11-12 — The language of a page the node picked (meta aimeat-page-lang) is the
 *     first source, and writeLang sets the pick mark. On an operator's front page in several
 *     languages the header's language buttons stored the language without the mark, so the server
 *     did not follow the press and sent the same page again.
 *   v1.1.0 — 2026-10-31 — The node's own language (window.__AIMEAT_SDK_CFG__.defaultLocale) before the
 *     browser's, as detectLocale reads it since 2026-10-29: an app on a Finnish customer's place had
 *     its sign-in pill in English for an English browser (crew32 check turn).
 *   v1.0.0 — 2026-10-05 — Initial: the one resolver and the one setter, moved here from
 *     auth/locale.js (aimeatReadLang, aimeatApplyLang, readLocales) so the modal, the header and the
 *     two kits use them too (secaudit 2026-10, M7).
 */

/** The one language key on this platform: localStorage and cookie both. */
export const LANG_KEY = 'aimeat-lang';

/** The mark beside it that says a person picked the language. Same as public/js/utils.js. */
export const LANG_CHOSEN_KEY = 'aimeat-lang-chosen';

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
 * The language of a page the node picked by language, from `<meta name="aimeat-page-lang">`, or
 * null on every other page.
 * @returns {string|null}
 */
export function servedPageLang() {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return null;
  const m = /** @type {HTMLMetaElement|null} */ (document.querySelector('meta[name="aimeat-page-lang"]'));
  const code = m && m.content ? m.content.trim().toLowerCase() : '';
  return /^[a-z]{2}$/.test(code) ? code : null;
}

/**
 * The reader's language: the page the node picked → ?lang= → stored choice → cookie → the node's
 * own language → browser → fallback.
 * @param {string[]|null} [locales]  the languages accepted; null or left out accepts any
 * @returns {string|undefined}  undefined only for an empty list
 */
export function readLang(locales) {
  const list = Array.isArray(locales) ? locales : null;
  /** @type {(v: string|null|undefined) => string|null} */
  const pick = list
    ? function (v) { return v && list.indexOf(v) >= 0 ? v : null; }
    : function (v) { return v ? String(v).slice(0, 2) : null; };
  const served = pick(servedPageLang());
  if (served) return served;
  try {
    const u = pick(new URLSearchParams(location.search).get('lang'));
    if (u) return u;
    const s = pick(localStorage.getItem(LANG_KEY));
    if (s) return s;
    const c = document.cookie.match(/(?:^|;\s*)aimeat-lang=([a-z]{2})(?:;|$)/);
    const cv = c ? pick(c[1]) : null;
    if (cv) return cv;
  } catch { /* storage blocked, or no location or document: the browser answers below */ }
  const cfg = typeof window !== 'undefined' ? window.__AIMEAT_SDK_CFG__ : undefined;
  const node = pick(cfg && cfg.defaultLocale);
  if (node) return node;
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
 * Remember the person's choice: the stored key, the cookie and the pick mark, in one step. The
 * cookies are written first, so a browser that blocks storage still tells the server.
 * @param {string} lang  a two-letter code
 */
export function writeLang(lang) {
  const keep = ';path=/;max-age=' + COOKIE_MAX_AGE + ';SameSite=Lax';
  try {
    document.cookie = LANG_KEY + '=' + lang + keep;
    document.cookie = LANG_CHOSEN_KEY + '=1' + keep;
    localStorage.setItem(LANG_KEY, lang);
    localStorage.setItem(LANG_CHOSEN_KEY, '1');
  } catch { /* storage blocked */ }
}
