/**
 * @file living/i18n.js
 * @description A LIVING RECORD CARRIES ITS OWN WORDS. Everything else in this library is about
 *   numbers standing on each other; this is the one part that is about a person reading them. A
 *   record written for two languages used to mean two records, or an app holding a dictionary
 *   beside the document and rewriting the labels after mount — which is code between the record
 *   and the screen, the one thing a living document is supposed to have none of.
 *
 *   SO ANY HUMAN-FACING STRING MAY BE A LANGUAGE MAP INSTEAD OF A STRING:
 *   `{ fi: "Ilma ovella", en: "Air at the door" }`. A label, a title, a hint, a pick's option, a
 *   sentence template, the words a machine's entry action writes, a block's title and sub. The
 *   record is bilingual BY CONSTRUCTION rather than by an app remembering to translate it, and
 *   the same record read on a Finnish screen and an English one is the same document.
 *
 *   THE RESOLUTION ORDER IS THE PAGE FIRST, THE RECORD SECOND, THE MAP LAST. The page language is
 *   the kit's own — AIMEAT.atelier.i18n.lang(), which is what the login pill sets — then the html
 *   element's lang, then the stored `aimeat-lang`, then the browser. The record's `lang` field is
 *   the fallback for a language the record does not carry, and the map's first key is the last
 *   resort, so a document always says something rather than going blank in Portuguese.
 *
 *   A LANGUAGE MAP IS RECOGNISED BY POSITION, NOT BY SHAPE. A `label` is a string or a map and
 *   there is no third thing, so an object in that position is an INTENDED map: one with no
 *   language keys is a refusal validate() names, rather than an object quietly printed as
 *   "[object Object]". That split — the position decides what it is, the keys decide whether it
 *   is valid — is what makes the refusal possible at all.
 * @structure pageLanguage · preference · isPlainObject · isLangMap · pickLang · textOf ·
 *   langKeysOf · langMapError · TEXT_KEYS · hasLangMap · localizeProps · localizeLayout ·
 *   onLanguageChange
 * @usage
 *   import { textOf, preference } from './i18n.js';
 *   textOf({ fi: 'Lämpötila', en: 'Temperature' }, preference(doc));   // 'Lämpötila'
 * @version-history
 *   v0.4.0 — 2026-09-06 — Initial (the living document, stage 4): the record carries its own
 *     words, in every language it was written for.
 */

/** A key that names a language: `fi`, `en`, `pt-BR`. Anything else is not one, and is refused. */
export const LANG_KEY = /^[a-z]{2}(?:-[A-Za-z0-9]{2,8})?$/;

/**
 * The prop names on a layout block whose value is words a person reads. A key not on this list is
 * left exactly as the record wrote it, so a `source`, an `id` or a `prop` can never be mistaken
 * for something to translate.
 */
export const TEXT_KEYS = [
  'title', 'sub', 'hint', 'caption', 'label', 'text', 'summary', 'note', 'placeholder',
  'emptyTitle', 'emptyHint', 'legend', 'heading', 'subtitle', 'description', 'alt',
];

/** A plain object — not null, not an array, not a quantity, not a Date. */
export function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

/** Whether this object is a USABLE language map: at least one language key holding a string. */
export function isLangMap(v) {
  if (!isPlainObject(v)) return false;
  const keys = Object.keys(v);
  if (!keys.length) return false;
  for (const k of keys) if (LANG_KEY.test(k) && typeof v[k] === 'string') return true;
  return false;
}

/**
 * The page's language, the way this platform resolves it everywhere else: the kit's i18n (which
 * the login pill sets), then the document element, then the shared `aimeat-lang` key, then the
 * browser. Never a language switch of this library's own — there is one on the page already.
 * @returns {string}
 */
export function pageLanguage() {
  try {
    const ns = /** @type {any} */ (window).AIMEAT;
    if (ns && ns.atelier && ns.atelier.i18n && typeof ns.atelier.i18n.lang === 'function') {
      const l = ns.atelier.i18n.lang();
      if (l) return String(l);
    }
  } catch { /* no kit on the page */ }
  try {
    const l = document.documentElement.getAttribute('lang');
    if (l) return String(l);
  } catch { /* no document */ }
  try {
    const stored = localStorage.getItem('aimeat-lang');
    if (stored) return String(stored);
  } catch { /* storage blocked */ }
  try { return String(navigator.language || 'en'); } catch { return 'en'; }
}

/**
 * The order a word is looked for in: the language in force, then the record's own default. An
 * `override` is what a host asked for through handle.setLanguage().
 * @param {any} doc @param {string|null} [override]
 * @returns {string[]}
 */
export function preference(doc, override) {
  const out = [];
  const add = (l) => { if (l && out.indexOf(String(l)) < 0) out.push(String(l)); };
  add(override || pageLanguage());
  add(doc && doc.lang);
  return out;
}

/**
 * Which entry of a language map answers for the languages wanted: an exact tag, then the same
 * base language written either way (`fi` for `fi-FI`, `pt-BR` for `pt`), then the map's first key
 * so a document always says something.
 * @param {Record<string, any>} map @param {string[]} wanted
 * @returns {{ lang: string, text: any }|null}
 */
export function pickLang(map, wanted) {
  const keys = Object.keys(map || {});
  if (!keys.length) return null;
  for (const want of (wanted || [])) {
    if (!want) continue;
    const w = String(want).toLowerCase();
    const base = w.split('-')[0];
    for (const k of keys) if (k.toLowerCase() === w) return { lang: k, text: map[k] };
    for (const k of keys) if (k.toLowerCase() === base) return { lang: k, text: map[k] };
    for (const k of keys) if (k.toLowerCase().split('-')[0] === base) return { lang: k, text: map[k] };
  }
  return { lang: keys[0], text: map[keys[0]] };
}

/**
 * One human-facing field, read in the language wanted. A string is itself; nothing is still
 * nothing (a label the record left out must stay left out, not become an empty heading).
 * @param {any} v @param {string[]} wanted
 * @returns {any}
 */
export function textOf(v, wanted) {
  if (v == null || typeof v === 'string') return v;
  if (!isPlainObject(v)) return v;
  const got = pickLang(v, wanted);
  return got ? got.text : '';
}

/** Every language a map carries, in the order it was written. @param {any} v @returns {string[]} */
export function langKeysOf(v) {
  if (!isPlainObject(v)) return [];
  return Object.keys(v).filter((k) => LANG_KEY.test(k));
}

/**
 * The refusal a value in a language-map position earns, in words, or null when it is fine. This
 * is the half validate() uses: the POSITION already said it should be words or a map, so an
 * object with no languages in it is a mistake worth naming rather than a shape to guess at.
 * @param {any} v
 * @returns {string|null}
 */
export function langMapError(v) {
  if (v == null || typeof v === 'string') return null;
  if (typeof v === 'number' || typeof v === 'boolean') return null;
  if (!isPlainObject(v)) return 'is neither a line of text nor a language map';
  const keys = Object.keys(v);
  if (!keys.length) return 'is an empty language map — it carries no language at all';
  const bad = keys.filter((k) => !LANG_KEY.test(k));
  if (bad.length === keys.length) {
    return 'is a language map with no language in it (' + bad.join(', ')
      + '); a key is a language tag such as "fi" or "en"';
  }
  if (bad.length) {
    return 'is a language map carrying "' + bad.join('", "')
      + '", which is not a language tag such as "fi" or "en"';
  }
  const notText = keys.filter((k) => typeof v[k] !== 'string');
  if (notText.length) {
    return 'is a language map whose ' + notText.map((k) => '"' + k + '"').join(' and ')
      + ' is not a line of text';
  }
  return null;
}

/**
 * A copy of a block's props with every human-facing field read in the language wanted, however
 * deep it sits — a gauge's `label`, a chart series' `label`, a band's caption. Only the names in
 * TEXT_KEYS are touched, so an id, a source name or a number is carried through untouched.
 * @param {any} props @param {string[]} wanted
 * @returns {any}
 */
export function localizeProps(props, wanted) {
  if (Array.isArray(props)) return props.map((p) => localizeProps(p, wanted));
  if (!isPlainObject(props)) return props;
  const out = {};
  for (const key of Object.keys(props)) {
    const v = props[key];
    if (TEXT_KEYS.indexOf(key) >= 0 && isPlainObject(v)) { out[key] = textOf(v, wanted); continue; }
    out[key] = (isPlainObject(v) || Array.isArray(v)) ? localizeProps(v, wanted) : v;
  }
  return out;
}

/**
 * Whether anything under here is words written in more than one language. mount() asks it once
 * per block, so a language change touches the blocks that have something to say in the new
 * language and leaves the rest of the screen exactly where it is — which is the difference
 * between changing the words and repainting the page.
 * @param {any} v
 * @returns {boolean}
 */
export function hasLangMap(v) {
  if (Array.isArray(v)) return v.some(hasLangMap);
  if (!isPlainObject(v)) return false;
  for (const key of Object.keys(v)) {
    const at = v[key];
    if (TEXT_KEYS.indexOf(key) >= 0 && isPlainObject(at)) return true;
    if ((isPlainObject(at) || Array.isArray(at)) && hasLangMap(at)) return true;
  }
  return false;
}

/**
 * The arrangement, read in one language. The record itself is never touched: the document a
 * person saves is the document they wrote, in every language they wrote it in.
 * @param {any} layout @param {string[]} wanted
 * @returns {any}
 */
export function localizeLayout(layout, wanted) {
  if (!layout || !Array.isArray(layout.blocks)) return layout;
  return Object.assign({}, layout, {
    blocks: layout.blocks.map(function (block) {
      if (!block || !block.props) return block;
      return Object.assign({}, block, { props: localizeProps(block.props, wanted) });
    }),
  });
}

/**
 * Follow the platform's language, whichever door it comes through: the kit's own subscription
 * when the kit is on the page, and the `aimeat-lang-change` window event either way. Both may
 * fire for one switch, so the caller compares the resolved language before doing any work.
 * @param {() => void} cb
 * @returns {() => void}  stop listening
 */
export function onLanguageChange(cb) {
  const stops = [];
  try {
    const ns = /** @type {any} */ (window).AIMEAT;
    if (ns && ns.atelier && ns.atelier.i18n && typeof ns.atelier.i18n.onChange === 'function') {
      stops.push(ns.atelier.i18n.onChange(function () { cb(); }));
    }
  } catch { /* no kit on the page */ }
  const onEvent = function () { cb(); };
  try {
    window.addEventListener('aimeat-lang-change', onEvent);
    stops.push(function () { window.removeEventListener('aimeat-lang-change', onEvent); });
  } catch { /* no window */ }
  return function () { for (const stop of stops) { try { stop(); } catch { /* already gone */ } } };
}
