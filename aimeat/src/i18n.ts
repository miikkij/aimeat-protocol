/**
 * @file src/i18n.ts
 * @description Server-side i18n core: loads locales/en.json + fi.json at startup and produces
 *   bound translation functions with dot-path key resolution, {{var}} interpolation, and fallback.
 *
 * @structure
 *   - LOCALES / DEFAULT_LOCALE / Locale: supported locale set (en, fi)
 *   - createT(locale): returns a TFunction that resolves keys, falls back to en, then to the key
 *   - detectLocale(acceptLang): picks best locale from an Accept-Language header
 *   - toLocale(val): validates/coerces an arbitrary value to a Locale
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Dict { [key: string]: string | string[] | Dict; }

export type Locale = 'en' | 'fi';
export const LOCALES: readonly Locale[] = ['en', 'fi'] as const;
export const DEFAULT_LOCALE: Locale = 'en';

export type TFunction = (key: string, vars?: Record<string, string | number>) => string;

// Load translations at startup
const translations = new Map<Locale, Dict>();
for (const loc of LOCALES) {
  const raw = readFileSync(join(__dirname, '..', 'locales', `${loc}.json`), 'utf-8');
  translations.set(loc, JSON.parse(raw) as Dict);
}

function resolve(dict: Dict, key: string): string | string[] | undefined {
  const parts = key.split('.');
  let cur: string | string[] | Dict = dict;
  for (const p of parts) {
    if (typeof cur !== 'object' || cur === null || Array.isArray(cur)) return undefined;
    cur = (cur as Dict)[p];
  }
  if (typeof cur === 'string') return cur;
  if (Array.isArray(cur)) return cur;
  return undefined;
}

function interpolate(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{{${name}}}`
  );
}

/** Create a bound t() function for a locale. Falls back to DEFAULT_LOCALE, then returns key. */
export function createT(locale: Locale): TFunction {
  const dict = translations.get(locale);
  const fallback = locale !== DEFAULT_LOCALE ? translations.get(DEFAULT_LOCALE) : undefined;
  return (key: string, vars?: Record<string, string | number>): string => {
    let val = dict ? resolve(dict, key) : undefined;
    if (val === undefined && fallback) val = resolve(fallback, key);
    if (val === undefined) return key;
    const str = Array.isArray(val) ? val.join(', ') : val;
    return vars ? interpolate(str, vars) : str;
  };
}

/** Detect best locale from Accept-Language header. */
export function detectLocale(acceptLang: string | undefined): Locale {
  if (!acceptLang) return DEFAULT_LOCALE;
  const parsed = acceptLang.split(',').map(e => {
    const [tag] = e.trim().split(';');
    return tag.trim().split('-')[0].toLowerCase();
  });
  for (const lang of parsed) {
    if (LOCALES.includes(lang as Locale)) return lang as Locale;
  }
  return DEFAULT_LOCALE;
}

/** Validate a locale string. */
export function toLocale(val: unknown): Locale {
  if (typeof val === 'string' && LOCALES.includes(val as Locale)) return val as Locale;
  return DEFAULT_LOCALE;
}

/** Extract locale from cookie header string (looks for aimeat-lang=xx). */
export function localeFromCookie(cookieHeader: string | undefined): Locale | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(/(?:^|;\s*)aimeat-lang=(en|fi)(?:;|$)/);
  return match ? (match[1] as Locale) : undefined;
}

/** Resolve locale from request: ?lang= query > cookie > Accept-Language > default. */
export function resolveLocale(
  langParam: string | undefined,
  cookieHeader: string | undefined,
  acceptLang: string | undefined,
): Locale {
  if (langParam) return toLocale(langParam);
  const fromCookie = localeFromCookie(cookieHeader);
  if (fromCookie) return fromCookie;
  return detectLocale(acceptLang);
}

/** Extract all keys under a prefix as a flat Record for client-side embedding.
 *  e.g. resolveFlat('fi', 'profile') → { 'profile.title': '...', 'profile.stats.agents': '...', ... }
 *  Falls back to DEFAULT_LOCALE for missing keys. */
export function resolveFlat(locale: Locale, prefix: string): Record<string, string> {
  const dict = translations.get(locale);
  const fallback = locale !== DEFAULT_LOCALE ? translations.get(DEFAULT_LOCALE) : undefined;
  const result: Record<string, string> = {};

  function navigateTo(d: Dict, pfx: string): Dict | undefined {
    const parts = pfx.split('.');
    let cur: string | string[] | Dict = d;
    for (const p of parts) {
      if (typeof cur !== 'object' || cur === null || Array.isArray(cur)) return undefined;
      cur = (cur as Dict)[p];
    }
    if (typeof cur === 'object' && cur !== null && !Array.isArray(cur)) return cur as Dict;
    return undefined;
  }

  function collect(obj: Dict, path: string, overwrite: boolean): void {
    for (const [k, v] of Object.entries(obj)) {
      const full = path ? `${path}.${k}` : k;
      if (typeof v === 'string') { if (overwrite || !(full in result)) result[full] = v; }
      else if (Array.isArray(v)) { if (overwrite || !(full in result)) result[full] = v.join(', '); }
      else if (typeof v === 'object' && v !== null) collect(v as Dict, full, overwrite);
    }
  }

  // Walk the primary locale
  const sub = dict ? navigateTo(dict, prefix) : undefined;
  if (sub) collect(sub, prefix, true);

  // Fill in missing keys from fallback
  if (fallback) {
    const fbSub = navigateTo(fallback, prefix);
    if (fbSub) collect(fbSub, prefix, false);
  }

  return result;
}
