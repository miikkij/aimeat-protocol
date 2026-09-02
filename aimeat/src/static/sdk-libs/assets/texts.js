/**
 * @file assets/texts.js
 * @description The words a media-heavy app puts on screen, kept in the same record as its files.
 *   A game's strings belong beside its sprites: one manifest, one save, one thing to hand somebody
 *   who is translating it.
 *
 *   ENGLISH IS THE FLOOR. A language is filled in over several passes, so a key missing from
 *   Finnish falls through to English on its own instead of drawing the key name at a player. That
 *   is the same rule the node's own locales follow.
 *
 *   THE LANGUAGE IS THE PLATFORM'S, not a second one invented here: the Atelier kit's choice when
 *   the kit is on the page, then the auth library, then the browser. An app that wants to override
 *   it calls library.lang('fi') and is obeyed.
 * @structure detectLang() · fill(text, vars) · lookup(texts, lang, key, vars) · languages(texts)
 * @usage
 *   import { lookup } from './texts.js';
 *   lookup(man.texts, 'fi', 'coins', { n: 3 });   // "3 kolikkoa"
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial: the platform language, {var} substitution and the English
 *     fallback.
 */

/** The variable form a text may carry: {n}, {name}. */
const VAR_RE = /\{(\w+)\}/g;

/**
 * Which language this app is being read in. Nothing here throws: a browser with storage blocked
 * still gets an answer, and the answer is English when nothing else says otherwise.
 * @returns {string}
 */
export function detectLang() {
  try {
    const root = /** @type {any} */ (window).AIMEAT;
    if (root && root.atelier && root.atelier.i18n && typeof root.atelier.i18n.lang === 'function') {
      const kit = root.atelier.i18n.lang();
      if (kit) return String(kit).slice(0, 2);
    }
    if (root && root.auth && typeof root.auth.getLang === 'function') {
      const auth = root.auth.getLang();
      if (auth) return String(auth).slice(0, 2);
    }
    const stored = localStorage.getItem('aimeat-lang');
    if (stored) return stored.slice(0, 2);
  } catch {
    /* storage blocked, or no AIMEAT on the page: the browser's own language answers below */
  }
  if (typeof navigator !== 'undefined' && navigator.language) return navigator.language.slice(0, 2);
  return 'en';
}

/**
 * Put the variables into a text. A name with no value is left as it was written, so a missing
 * variable shows up as {n} in the interface instead of as the word "undefined".
 * @param {string} text
 * @param {Record<string, any>} [vars]
 * @returns {string}
 */
export function fill(text, vars) {
  const value = String(text == null ? '' : text);
  if (!vars) return value;
  return value.replace(VAR_RE, function (whole, name) {
    return vars[name] == null ? whole : String(vars[name]);
  });
}

/**
 * Look one text up: the asked-for language, then English, then the key itself. The key is returned
 * rather than an empty string, because a key on screen is a bug report and a blank is a mystery.
 * @param {Record<string, Record<string, string>>} texts
 * @param {string} lang
 * @param {string} key
 * @param {Record<string, any>} [vars]
 * @returns {string}
 */
export function lookup(texts, lang, key, vars) {
  const all = texts || {};
  const here = all[lang];
  const found = (here && here[key] != null) ? here[key] : (all.en && all.en[key] != null ? all.en[key] : key);
  return fill(found, vars);
}

/**
 * Every language the manifest carries, English first so a side-by-side table reads left to right
 * from the one that is always complete.
 * @param {Record<string, Record<string, string>>} texts
 * @returns {string[]}
 */
export function languages(texts) {
  const names = Object.keys(texts || {});
  const rest = names.filter(function (name) { return name !== 'en'; }).sort();
  return names.indexOf('en') >= 0 ? ['en'].concat(rest) : rest;
}

/**
 * Every text key in the manifest, across every language, sorted. A table needs the union rather
 * than one language's set, so a key that exists only in Finnish is still visible as a gap.
 * @param {Record<string, Record<string, string>>} texts
 * @returns {string[]}
 */
export function textKeys(texts) {
  /** @type {Record<string, boolean>} */
  const seen = {};
  for (const lang of Object.keys(texts || {})) {
    for (const key of Object.keys(texts[lang] || {})) seen[key] = true;
  }
  return Object.keys(seen).sort();
}
