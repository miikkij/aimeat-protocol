/**
 * @file public/js/i18n.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SPA i18n runtime: fetches /locales/*.json (with English fallback), flattens the
 *   nested JSON into dot-notation keys, and exposes t()/tOr() lookup plus locale switching.
 *
 * @structure
 *   - loadTranslations(): fetches en.json as fallback + the active locale, version-cache-busted
 *   - t(key, vars) / tOr(key, fallbackText, vars): dot-key lookup with {var} interpolation
 *   - tEn(key): a key's English text, whatever the active locale
 *   - tn(key, n, vars): a count in the language's plural form (`<key>_one`, `<key>_other`, …)
 *   - tPrefix(prefix): every loaded string under one prefix, the prefix taken off
 *   - switchLocale() / onLocaleChange(): change locale and notify subscribed listeners
 *   - applyAccountLocale(): the signed-in account's language, unless ?lang= or a pick on this device
 *   - flatten(): internal — collapses nested translation objects to dot-notation keys
 *
 * @version-history
 *   v1.1.0 — 2026-10-31 — The locale files are keyed by the node's build id (from this module's own
 *     ?v=) instead of the time of each page load, and English and the page's language are fetched
 *     together: every page view had downloaded both files, one after the other (Jouni v27 P7).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 *   v1.1.0 — 2026-10-14 — tEn(): a key's English text, for the menu find's English words.
 *   v1.2.0 — 2026-10-18 — tn(): a count in the language's plural form, through Intl.PluralRules.
 *   v1.3.0 — 2026-10-31 — tPrefix(): the sign-in dialog's strings for the consent page (v27 P1).
 *   v1.4.0 — 2026-11-02 — applyAccountLocale(): at sign-in the page speaks the account's saved
 *     language instead of the browser's; switchLocale() marks a pick made on this device, which
 *     keeps winning (Chief of Staff 2.11 02.00, rk-testi fi on aimeat.io).
 */
import { detectLocale, persistLocale, langPickedHere, LANG_CHOSEN_KEY } from './utils.js';
import { swallowed } from '/js/swallowed.js';

/** Flatten a nested object into dot-notation keys. */
function flatten(obj, prefix = '') {
  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      Object.assign(result, flatten(val, fullKey));
    } else {
      result[fullKey] = val;
    }
  }
  return result;
}

let currentLocale = 'en';
let translations = {};
let fallback = {};
const listeners = new Set();
/**
 * The cache key of the locale files: the node's build id, which portal.ts stamps on this module's own
 * address (`/js/i18n.js?v=<BUILD_ID>` through the importmap). The files are about 2 MB each and the
 * page waits for them before its first render, so a key that changes on every load (it was
 * Date.now(), because __APP_VERSION__ is defined nowhere) downloaded both on every page view: several
 * blank seconds on a new place and on /v1/chat (Jouni v27 P7, 2026-10-31). A build id changes when
 * the files can have changed, and the browser keeps them in between.
 */
const _v = (() => {
  try {
    const stamped = new URL(import.meta.url).searchParams.get('v');
    if (stamped) return stamped;
  } catch (err) {
    swallowed('i18n: build id from the module address', err);
  }
  return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : Date.now();
})();

/** Read one locale file, or null when it cannot be read. */
async function readLocale(tag) {
  const res = await fetch(`/locales/${tag}.json?v=${_v}`);
  return res.ok ? res.json() : null;
}

/** Load translations for a locale. */
export async function loadTranslations(locale) {
  currentLocale = locale || detectLocale();

  // English is the fallback for every key a language does not carry yet. Both files are asked for at
  // once: one after the other, the page waited for the sum of the two downloads.
  const [enData, locData] = await Promise.all([
    readLocale('en'),
    currentLocale !== 'en'
      ? readLocale(currentLocale).catch((err) => { swallowed('i18n: loadTranslations', err); return null; })
      : Promise.resolve(null),
  ]);
  if (enData) fallback = flatten(enData);
  translations = locData ? { ...fallback, ...flatten(locData) } : fallback;

  persistLocale(currentLocale);
  document.documentElement.lang = currentLocale;
}

/** Translate a dot-notation key with optional interpolation. Returns the key itself if not found. */
export function t(key, vars) {
  let str = translations[key] ?? fallback[key] ?? key;
  if (vars && typeof str === 'string') {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}

/**
 * Every loaded string under one prefix, with the prefix taken off: `tPrefix('modal.')` is the sign-in
 * dialog's strings in the page's language, handed to it so its first paint is not English (v27 P1).
 */
export function tPrefix(prefix) {
  const out = {};
  for (const source of [fallback, translations]) {
    for (const [k, v] of Object.entries(source)) {
      if (k.startsWith(prefix) && typeof v === 'string') out[k.slice(prefix.length)] = v;
    }
  }
  return out;
}

/**
 * A count in words, in the language's plural form: the key `<key>_<category>` (the Intl.PluralRules
 * category of `n` for the page's language: `one`, `other`, and in other languages `few`, `many`) when
 * the language has it, else `<key>`. `n` is passed into `{n}`. "1 keys" is what this prevents: a key
 * whose text says "{n} keys" carries `<key>_one` = "{n} key" beside it.
 */
export function tn(key, n, vars) {
  // currentLocale is one of the tags i18n.ts LOCALES ships, each a valid BCP 47 tag.
  const category = new Intl.PluralRules(currentLocale).select(Number(n));
  const plural = `${key}_${category}`;
  const chosen = (translations[plural] ?? fallback[plural]) !== undefined ? plural : key;
  return t(chosen, { n, ...vars });
}

/** Translate a key, but fall back to `fallbackText` when the key is missing.
 *  t() returns the raw key string on a miss (truthy), which defeats the common
 *  `t(key) || serverProvidedTitle` pattern -- use this when a server-provided
 *  label should win over a raw key. */
export function tOr(key, fallbackText, vars) {
  const val = t(key, vars);
  return val === key ? (fallbackText ?? key) : val;
}

/** A key's English text whatever the page's language, or the key itself when English has none (the
 *  menu find matches a place by its English words too). */
export function tEn(key) {
  const str = fallback[key];
  return typeof str === 'string' ? str : key;
}

/** Get current locale. */
export function getLocale() {
  return currentLocale;
}

/**
 * Has the person picked a language on this device? `aimeat-lang` alone cannot say so:
 * loadTranslations() stores whatever was detected on every load, the browser's language included.
 */
function chosenHere() {
  try { return langPickedHere(); } catch (err) { swallowed('i18n: read the choice mark', err); return false; }
}

async function applyLocale(locale) {
  await loadTranslations(locale);
  for (const fn of listeners) fn(currentLocale);
  window.dispatchEvent(new CustomEvent('lang-change', { detail: { locale: currentLocale } }));
}

/** Switch locale and notify listeners. Every caller is the person's own pick (the pill, the help, a setting). */
export async function switchLocale(newLocale) {
  try { localStorage.setItem(LANG_CHOSEN_KEY, '1'); } catch (err) { swallowed('i18n: mark the choice', err); }
  // The same mark as a cookie: the server's front page reads it (src/i18n.ts pickedLocale).
  document.cookie = `${LANG_CHOSEN_KEY}=1;path=/;max-age=31536000;SameSite=Lax`;
  await applyLocale(newLocale);
}

/**
 * The signed-in account's own language (GET /v1/ghii/me `locale`, the one its email is written in).
 * It wins over what the browser says, so a buyer whose account is Finnish reads Finnish on a node
 * that never saw them before (rk-testi on aimeat.io, 2.11). An address's ?lang= and a pick made on
 * this device still win over it. 'en' is not taken as a wish: several ways of making an account
 * write it as a default, so it would move a Finnish browser to English for nothing.
 */
export async function applyAccountLocale(locale) {
  if (locale !== 'fi' && locale !== 'es') return;
  if (locale === currentLocale || chosenHere()) return;
  if (new URLSearchParams(window.location.search).get('lang')) return;
  await applyLocale(locale);
}

/** Subscribe to locale changes. Returns unsubscribe function. */
export function onLocaleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
