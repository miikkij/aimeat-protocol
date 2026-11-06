/**
 * @file test/unit/app-seo-listable.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app with no description of its own is left out of the sitemaps and the IndexNow
 *   notices, and stays indexable at its address (TARGET-089 Y2). The API refuses to publish such an
 *   app now, so the case exists only as older data (one search-visible app on aimeat.io on
 *   2026-11-06), and this is where the rule is proven.
 * @version-history
 *   v1.0.0 — 2026-11-06 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { appOwnDescription, appSeoIndexable, appSeoListable } from '../../src/services/app-seo.js';
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

describe('appSeoListable', () => {
  it('lists a search-visible app with a description', () => {
    expect(appSeoListable(app({ description: 'A place for notes.' }), cfg)).toBe(true);
  });

  it('leaves out a search-visible app with no description, which stays indexable', () => {
    const bare = app({ description: '' });
    expect(appSeoIndexable(bare, cfg)).toBe(true);
    expect(appSeoListable(bare, cfg)).toBe(false);
  });

  it('leaves out an app that is not search-visible, whatever its description says', () => {
    expect(appSeoListable(app({ description: 'Words.', seo: { index: false } }), cfg)).toBe(false);
    expect(appSeoListable(app({ description: 'Words.' }), { ...cfg, seoIndexing: 'off' } as AimeatConfig)).toBe(false);
  });
});
