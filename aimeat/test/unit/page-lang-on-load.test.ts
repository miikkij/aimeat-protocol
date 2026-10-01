/**
 * @file test/unit/page-lang-on-load.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `<html lang>` names the language the page is drawn in from the first paint, not
 *   only after a switch. Before this, the auth library set the attribute on a language change and
 *   the kit never set it at all: on a reload with Spanish or Finnish stored, an app and the Design
 *   Book preview drew their words in that language while `<html lang>` still said "en", so a screen
 *   reader read Finnish with English rules.
 *
 *   The two libraries are loaded fresh per case into a small stub document, because both decide
 *   at load.
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const g = globalThis as any;
const saved: Record<string, any> = {};

/** A document with <html>, an optional aimeat-locales meta, and the storage and address a page has. */
function page(opts: { locales?: string; stored?: string; search?: string; navigator?: string; htmlLang?: string }) {
  const attrs: Record<string, string> = { lang: opts.htmlLang ?? 'en' };
  const html = {
    dataset: {} as Record<string, string>,
    setAttribute(k: string, v: string) { attrs[k] = String(v); },
    getAttribute(k: string) { return k in attrs ? attrs[k] : null; },
    get lang() { return attrs.lang ?? ''; },
    set lang(v: string) { attrs.lang = String(v); },
  };
  const meta = opts.locales == null ? null : { content: opts.locales };
  const store = new Map<string, string>();
  if (opts.stored) store.set('aimeat-lang', opts.stored);
  g.document = {
    documentElement: html,
    readyState: 'complete',
    cookie: '',
    querySelector: (sel: string) => (sel.includes('aimeat-locales') ? meta : null),
    addEventListener() {},
    createElement: () => ({ set textContent(v: string) { this.innerHTML = v; }, innerHTML: '' }),
  };
  g.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
  };
  g.location = { search: opts.search ?? '' };
  Object.defineProperty(g, 'navigator', { value: { language: opts.navigator ?? 'en-US' }, configurable: true, writable: true });
  g.window = g;
  g.addEventListener = () => {};
  g.dispatchEvent = () => true;
  g.CustomEvent = class { type: string; detail: any; constructor(t: string, i: any) { this.type = t; this.detail = i && i.detail; } };
  return html;
}

beforeEach(() => {
  for (const k of ['document', 'localStorage', 'location', 'window', 'addEventListener', 'dispatchEvent', 'CustomEvent', 'AIMEAT']) saved[k] = g[k];
  saved.navigator = Object.getOwnPropertyDescriptor(g, 'navigator');
  vi.resetModules();
});
afterEach(() => {
  for (const k of Object.keys(saved)) if (k !== 'navigator') g[k] = saved[k];
  if (saved.navigator) Object.defineProperty(g, 'navigator', saved.navigator);
});

describe('the auth library marks the page language at load', () => {
  it('takes the stored language when the app declares it', async () => {
    const html = page({ locales: 'en fi es', stored: 'es' });
    const { aimeatRestoreLang } = await import('../../src/static/sdk-libs/auth/locale.js');
    aimeatRestoreLang();
    expect(html.getAttribute('lang')).toBe('es');
  });

  it('takes ?lang= over the stored choice, as the switch does', async () => {
    const html = page({ locales: 'en fi', stored: 'en', search: '?lang=fi' });
    const { aimeatRestoreLang } = await import('../../src/static/sdk-libs/auth/locale.js');
    aimeatRestoreLang();
    expect(html.getAttribute('lang')).toBe('fi');
  });

  it('leaves a page with one language as the server wrote it', async () => {
    const html = page({ locales: 'fi', stored: 'en', htmlLang: 'fi' });
    const { aimeatRestoreLang } = await import('../../src/static/sdk-libs/auth/locale.js');
    aimeatRestoreLang();
    expect(html.getAttribute('lang')).toBe('fi');
  });

  it('leaves a stored language the app does not carry', async () => {
    const html = page({ locales: 'en fi', stored: 'es', navigator: 'de-DE' });
    const { aimeatRestoreLang } = await import('../../src/static/sdk-libs/auth/locale.js');
    aimeatRestoreLang();
    // The switch would show the first declared language; the page says so too.
    expect(html.getAttribute('lang')).toBe('en');
  });
});

describe('the kit marks the language it draws in', () => {
  it('on the Design Book preview: no auth library, Finnish stored', async () => {
    const html = page({ stored: 'fi' });
    const { i18n } = await import('../../src/static/sdk-libs/atelier/i18n.js');
    expect(i18n.lang()).toBe('fi');
    expect(html.getAttribute('lang')).toBe('fi');
  });

  it('follows a change made through the kit', async () => {
    const html = page({ locales: 'en fi es', stored: 'fi' });
    const { i18n } = await import('../../src/static/sdk-libs/atelier/i18n.js');
    i18n.setLang('es');
    expect(html.getAttribute('lang')).toBe('es');
  });

  it('leaves the page alone when nobody chose and the page declares no language', async () => {
    const html = page({ navigator: 'fi-FI', htmlLang: 'en' });
    await import('../../src/static/sdk-libs/atelier/i18n.js');
    expect(html.getAttribute('lang')).toBe('en');
  });

  it('leaves a one-language page whose language is not the browser default', async () => {
    const html = page({ locales: 'fi', navigator: 'en-US', htmlLang: 'fi' });
    await import('../../src/static/sdk-libs/atelier/i18n.js');
    expect(html.getAttribute('lang')).toBe('fi');
  });
});
