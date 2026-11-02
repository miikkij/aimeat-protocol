/**
 * @file test/unit/page-language.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which language the SPA opens in (public/js/utils.js detectLocale), for a visitor on a
 *   sign-in page: the browser's whole list counts and Finnish anywhere in it wins, what an earlier load
 *   stored by itself does not hold a Finnish visitor in English, and a person's pick always stays.
 * @usage cd aimeat && pnpm exec vitest run test/unit/page-language.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (Jouni, 2.11: innokas's sign-in page opened in English).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { detectLocale, langPickedHere } from '../../public/js/utils.js';

function visitor(o: { languages?: string[]; language?: string; stored?: Record<string, string>; cookie?: string; search?: string; node?: string }) {
  const stored = o.stored ?? {};
  vi.stubGlobal('window', { location: { search: o.search ?? '' }, __SITE: o.node ? { defaultLocale: o.node } : undefined });
  vi.stubGlobal('navigator', { languages: o.languages ?? [], language: o.language ?? o.languages?.[0] ?? '' });
  vi.stubGlobal('document', { cookie: o.cookie ?? '' });
  vi.stubGlobal('localStorage', { getItem: (k: string) => stored[k] ?? null });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('detectLocale', () => {
  it('follows the browser, and Finnish anywhere in its list wins', () => {
    visitor({ languages: ['fi-FI', 'en'] });
    expect(detectLocale()).toBe('fi');
    visitor({ languages: ['en-US', 'en', 'fi'] });
    expect(detectLocale()).toBe('fi');
    visitor({ languages: ['en-GB', 'en'] });
    expect(detectLocale()).toBe('en');
    visitor({ languages: ['es-419', 'en'] });
    expect(detectLocale()).toBe('es');
    visitor({ languages: ['de-DE', 'es', 'en'] });
    expect(detectLocale()).toBe('es');
    visitor({ languages: ['de-DE'] });
    expect(detectLocale()).toBe('en');
    visitor({ language: 'fi-FI' });
    expect(detectLocale()).toBe('fi');
  });

  it('does not hold a Finnish visitor in the English an earlier load stored by itself', () => {
    const before = { stored: { 'aimeat-lang': 'en' }, cookie: 'aimeat-lang=en' };
    visitor({ languages: ['en-US', 'en', 'fi'], ...before });
    expect(detectLocale()).toBe('fi');
    visitor({ languages: ['en-US', 'en'], ...before });
    expect(detectLocale()).toBe('en');
  });

  it('keeps a pick: with its mark, from the front page, and from before the mark existed', () => {
    visitor({ languages: ['en-US', 'fi'], stored: { 'aimeat-lang': 'en', 'aimeat-lang-chosen': '1' } });
    expect(detectLocale()).toBe('en');
    expect(langPickedHere()).toBe(true);
    visitor({ languages: ['en-US', 'fi'], cookie: 'aimeat-lang=en; aimeat-lang-chosen=1' });
    expect(detectLocale()).toBe('en');
    expect(langPickedHere()).toBe(true);
    visitor({ languages: ['fi-FI'], stored: { 'aimeat-lang': 'es' } });
    expect(detectLocale()).toBe('es');
    expect(langPickedHere()).toBe(false);
  });

  it('puts the address first and the node\'s own language before the browser', () => {
    visitor({ languages: ['fi'], stored: { 'aimeat-lang': 'es', 'aimeat-lang-chosen': '1' }, search: '?lang=en' });
    expect(detectLocale()).toBe('en');
    visitor({ languages: ['en-US'], node: 'fi' });
    expect(detectLocale()).toBe('fi');
    visitor({ languages: ['en-US'], node: 'fi', stored: { 'aimeat-lang': 'fi' } });
    expect(detectLocale()).toBe('fi');
    visitor({ languages: ['fi'], node: 'es', stored: { 'aimeat-lang': 'en', 'aimeat-lang-chosen': '1' } });
    expect(detectLocale()).toBe('en');
  });
});
