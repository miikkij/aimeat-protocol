/**
 * @file test/unit/app-ui-catalogue-index.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The UI catalogue in the size a reader can take: the index fits one tool result with
 *   a stored layout beside it, names every component the whole catalogue holds, and answers the
 *   named parts in full.
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { buildUiCatalogue } from '../../src/services/app-ui/catalogue.js';
import { buildUiCatalogueView, catalogueMode } from '../../src/services/app-ui/catalogue-index.js';

const size = (v: unknown) => JSON.stringify(v, null, 2).length;

describe('buildUiCatalogueView', () => {
  it('the whole catalogue is past one tool result, which is why this exists', () => {
    expect(size(buildUiCatalogueView('full'))).toBeGreaterThan(24_000);
  });

  it('the index names every component and fits beside a layout in one tool result', () => {
    const index = buildUiCatalogueView('index') as { components: Record<string, string> };
    expect(Object.keys(index.components)).toEqual(buildUiCatalogue().components.map(c => c.id));
    expect(index.components.hero).toMatch(/Settings: title, sub, image\. At most 1 per layout\./);
    // 24 kB is what a result carries; a stored layout of a rich app is about 4 kB of it.
    expect(size(index)).toBeLessThan(18_000);
  });

  it('a named component and a named section come back whole, and an unknown name is said', () => {
    const view = buildUiCatalogueView('index', ['table', 'effects', 'no-such-thing']) as {
      detail: Record<string, { props?: Record<string, unknown>; entries?: unknown[] }>; detail_unknown: string[];
    };
    expect(view.detail.table.props).toEqual(buildUiCatalogue().components.find(c => c.id === 'table')?.props);
    expect(view.detail.effects.entries?.length).toBe(buildUiCatalogue().effects.entries.length);
    expect(view.detail_unknown).toEqual(['no-such-thing']);
  });

  it('none is nothing, and an unknown mode is left to the door', () => {
    expect(buildUiCatalogueView('none')).toBeUndefined();
    expect(catalogueMode('index')).toBe('index');
    expect(catalogueMode('everything')).toBeUndefined();
  });
});
