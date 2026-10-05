/**
 * @file test/unit/sdk-lang.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one language resolver the served SDK libs share (_core/lang.js). The order is
 *   the platform's documented one: ?lang=, the stored choice, the cookie, the browser, the
 *   fallback. With a list a source counts only when it names a listed language; without one any
 *   source counts. Each case removes the source above it to show the next one answers.
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, M7).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LANG_KEY, readLang, pageLang, readLocales, storedLang, writeLang } from '../../src/static/sdk-libs/_core/lang.js';

const g = globalThis as any;
const saved: Record<string, any> = {};

/** The page sources the resolver reads: address, storage, cookie, browser, and the locales meta. */
function page(opts: { search?: string; stored?: string; cookie?: string; navigator?: string; locales?: string; blocked?: boolean }) {
  const store = new Map<string, string>();
  if (opts.stored) store.set('aimeat-lang', opts.stored);
  const meta = opts.locales == null ? null : { content: opts.locales };
  const doc = {
    cookie: opts.cookie ?? '',
    querySelector: (sel: string) => (sel.includes('aimeat-locales') ? meta : null),
  };
  g.document = doc;
  g.localStorage = opts.blocked
    ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }
    : {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => { store.set(k, String(v)); },
      };
  g.location = { search: opts.search ?? '' };
  Object.defineProperty(g, 'navigator', { value: { language: opts.navigator ?? '' }, configurable: true, writable: true });
  return { store, doc };
}

beforeEach(() => {
  for (const k of ['document', 'localStorage', 'location']) saved[k] = g[k];
  saved.navigator = Object.getOwnPropertyDescriptor(g, 'navigator');
});
afterEach(() => {
  for (const k of ['document', 'localStorage', 'location']) g[k] = saved[k];
  if (saved.navigator) Object.defineProperty(g, 'navigator', saved.navigator);
});

const ALL = { search: '?lang=es', stored: 'fi', cookie: 'x=1; aimeat-lang=sv', navigator: 'de-DE' };

describe('readLang with a list: the documented order', () => {
  const list = ['en', 'fi', 'es', 'sv', 'de'];

  it('?lang= wins over everything', () => {
    page(ALL);
    expect(readLang(list)).toBe('es');
  });

  it('then the stored choice', () => {
    page({ ...ALL, search: '' });
    expect(readLang(list)).toBe('fi');
  });

  it('then the cookie', () => {
    page({ ...ALL, search: '', stored: undefined });
    expect(readLang(list)).toBe('sv');
  });

  it('then the browser, cut to two letters', () => {
    page({ ...ALL, search: '', stored: undefined, cookie: '' });
    expect(readLang(list)).toBe('de');
  });

  it('then the first listed language', () => {
    page({});
    expect(readLang(['fi', 'en'])).toBe('fi');
  });

  it('skips a source that names a language the list does not carry', () => {
    page({ search: '?lang=pt', stored: 'ru', cookie: 'aimeat-lang=ja', navigator: 'fi-FI' });
    expect(readLang(['en', 'fi'])).toBe('fi');
  });

  it('answers undefined for an empty list, as AIMEAT.auth.getLang() did on a page with no languages', () => {
    page(ALL);
    expect(readLang([])).toBeUndefined();
  });

  it('goes to the browser when storage is blocked', () => {
    page({ ...ALL, search: '', blocked: true });
    expect(readLang(list)).toBe('de');
  });
});

describe('readLang without a list', () => {
  it('takes any source in the same order, cut to two letters', () => {
    page({ ...ALL, search: '?lang=pt-BR' });
    expect(readLang()).toBe('pt');
    page({ ...ALL, search: '' });
    expect(readLang()).toBe('fi');
    page({ ...ALL, search: '', stored: undefined });
    expect(readLang()).toBe('sv');
    page({ ...ALL, search: '', stored: undefined, cookie: '' });
    expect(readLang()).toBe('de');
  });

  it('falls back to English', () => {
    page({});
    expect(readLang(null)).toBe('en');
  });
});

describe('pageLang', () => {
  it('keeps to the languages the page declares when it declares two or more', () => {
    page({ stored: 'es', navigator: 'de-DE', locales: 'fi en' });
    expect(pageLang()).toBe('fi');
  });

  it('takes any language when the page declares one or none', () => {
    page({ stored: 'es', locales: 'fi' });
    expect(pageLang()).toBe('es');
    page({ navigator: 'sv-SE' });
    expect(pageLang()).toBe('sv');
  });
});

describe('readLocales, storedLang and writeLang', () => {
  it('reads the declared list, drops duplicates and bad codes, and ignores a single language', () => {
    page({ locales: 'EN, fi fi xyz es' });
    expect(readLocales()).toEqual(['en', 'fi', 'es']);
    expect(readLocales({ locales: ['fi'] })).toEqual([]);
  });

  it('reads the stored choice, and null when storage is blocked', () => {
    page({ stored: 'fi' });
    expect(storedLang()).toBe('fi');
    page({ blocked: true });
    expect(storedLang()).toBeNull();
  });

  it('writes the stored key and the cookie together', () => {
    const { store, doc } = page({});
    writeLang('es');
    expect(store.get(LANG_KEY)).toBe('es');
    expect(doc.cookie).toBe('aimeat-lang=es;path=/;max-age=31536000;SameSite=Lax');
    expect(readLang(['en', 'es'])).toBe('es');
  });
});
