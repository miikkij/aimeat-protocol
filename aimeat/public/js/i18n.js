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
 *   - flatten(): internal — collapses nested translation objects to dot-notation keys
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 *   v1.1.0 — 2026-10-14 — tEn(): a key's English text, for the menu find's English words.
 *   v1.2.0 — 2026-10-18 — tn(): a count in the language's plural form, through Intl.PluralRules.
 *   v1.3.0 — 2026-10-31 — tPrefix(): the sign-in dialog's strings for the consent page (v27 P1).
 */
import { detectLocale, persistLocale } from './utils.js';
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
const _v = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : Date.now();

/** Load translations for a locale. */
export async function loadTranslations(locale) {
  currentLocale = locale || detectLocale();

  // Always load English as fallback (cache-bust with version)
  const enRes = await fetch(`/locales/en.json?v=${_v}`);
  if (enRes.ok) {
    const enData = await enRes.json();
    fallback = flatten(enData);
  }
  translations = fallback;

  if (currentLocale !== 'en') {
    try {
      const locRes = await fetch(`/locales/${currentLocale}.json?v=${_v}`);
      const locData = await locRes.json();
      translations = { ...fallback, ...flatten(locData) };
    } catch (err) {
      // Fall back to English
      swallowed('i18n: loadTranslations', err);
      translations = fallback;
    }
  }

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

/** Switch locale and notify listeners. */
export async function switchLocale(newLocale) {
  await loadTranslations(newLocale);
  for (const fn of listeners) fn(currentLocale);
  window.dispatchEvent(new CustomEvent('lang-change', { detail: { locale: currentLocale } }));
}

/** Subscribe to locale changes. Returns unsubscribe function. */
export function onLocaleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
