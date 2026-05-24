/**
 * AIMEAT i18n Module
 * Loads translations from /locales/*.json and provides t() lookup.
 * Uses nested JSON structure, accessed via dot-notation keys.
 */
import { detectLocale, persistLocale } from './utils.js';

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
    } catch {
      // Fall back to English
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
