/**
 * @file test/unit/app-seo-listable.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app with no description of its own is left out of the sitemaps and the IndexNow
 *   notices, and stays indexable at its address (TARGET-089 Y2). The API refuses to publish such an
 *   app now, so the case exists only as older data (one search-visible app on aimeat.io on
 *   2026-11-06), and this is where the rule is proven.
 * @version-history
 *   v1.2.0 — 2026-11-07 — seoNote names the sitemap only for an app the node announces.
 *   v1.1.0 — 2026-11-06 — Listing also needs 150 words of the app's own text (Jouni, TARGET-093).
 *   v1.0.0 — 2026-11-06 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { appOwnDescription, appSeoIndexable, appSeoListable, seoNote } from '../../src/services/app-seo.js';
import type { AimeatConfig } from '../../src/config.js';
import type { AppSummaryRecord } from '../../src/storage/types/apps.js';

const cfg = { seoIndexing: 'on', appsSeoMode: 'owner', baseUrl: 'https://node.example' } as unknown as AimeatConfig;
const app = (manifest: Record<string, unknown>): AppSummaryRecord => ({
  ownerGaii: 'alice@node-1', ownerName: 'alice', filename: 'notes.html', versionNumber: 1,
  mimeType: 'text/html', size: 10, createdAt: '2026-08-01T00:00:00.000Z',
  manifest: { name: 'Notes', tags: [], seo: { index: true }, ...manifest },
} as unknown as AppSummaryRecord);

describe('appOwnDescription', () => {
  it('takes the typed search description first, then the description, then a per-language one', () => {
    expect(appOwnDescription(app({ description: 'Plain.', seo: { index: true, description: 'Typed.' } }))).toBe('Typed.');
    expect(appOwnDescription(app({ description: '  Plain.  ' }))).toBe('Plain.');
    expect(appOwnDescription(app({ description: '', descriptions: { fi: ' ', en: 'In English.' } }))).toBe('In English.');
  });

  it('is empty when the owner wrote none, never the generated sentence', () => {
    expect(appOwnDescription(app({ description: '   ' }))).toBe('');
    expect(appOwnDescription(app({}))).toBe('');
  });
});

/** A text about the app long enough to carry a page past APP_OWN_WORDS_MIN (160 words). */
const LONG_ABOUT = { text: Array.from({ length: 16 }, () => 'Notes keeps short notes and finds them again later by word.').join('\n\n'), lang: 'en' };

describe('appSeoListable', () => {
  it('lists a search-visible app with a description and at least 150 words of its own text', () => {
    expect(appSeoListable(app({ description: 'A place for notes.', about: LONG_ABOUT }), cfg)).toBe(true);
  });

  it('leaves out a search-visible app whose page has fewer than 150 words of its own (TARGET-093)', () => {
    const short = app({ description: 'A place for notes.' });
    expect(appSeoIndexable(short, cfg)).toBe(true);
    expect(appSeoListable(short, cfg)).toBe(false);
  });

  it('leaves out a search-visible app with no description, which stays indexable', () => {
    const bare = app({ description: '' });
    expect(appSeoIndexable(bare, cfg)).toBe(true);
    expect(appSeoListable(bare, cfg)).toBe(false);
  });

  it('leaves out an app that is not search-visible, whatever its text says', () => {
    expect(appSeoListable(app({ description: 'Words.', about: LONG_ABOUT, seo: { index: false } }), cfg)).toBe(false);
    expect(appSeoListable(app({ description: 'Words.', about: LONG_ABOUT }), { ...cfg, seoIndexing: 'off' } as AimeatConfig)).toBe(false);
  });
});

describe('seoNote', () => {
  it('names the sitemap only when the node announces the app', () => {
    expect(seoNote('on')).toMatch(/sitemap; engines/);
    expect(seoNote('on', false)).not.toMatch(/added to this node's sitemap/);
    expect(seoNote('on', false)).toMatch(/does not yet list it/);
  });
});
