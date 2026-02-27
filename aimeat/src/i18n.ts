import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Dict { [key: string]: string | string[] | Dict; }

export type Locale = 'en' | 'fi';
export const LOCALES: readonly Locale[] = ['en', 'fi'] as const;
export const DEFAULT_LOCALE: Locale = 'fi';

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
