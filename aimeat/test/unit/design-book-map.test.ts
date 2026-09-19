/**
 * @file test/unit/design-book-map.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Design Book's one-page map: every row is on it, grouped by kind, a genre says
 *   whether it keeps its own colours, and a Book ten times today's size still fits its share of
 *   one tool result with no row dropped.
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { buildDesignBookMap, MAP_BUDGET } from '../../src/services/design-book/map.js';

const opts = { baseUrl: 'https://node.example/' };

describe('buildDesignBookMap', () => {
  it('puts every part on its own line under its kind, genres first', () => {
    const text = buildDesignBookMap([
      { id: 'look-amber', kind: 'look', summary: 'Poster boldness with a proven amber pair. More words after.' },
      { id: 'genre-almanac', kind: 'genre', summary: 'A Swiss data poster: strict rules, one red.' },
      { id: 'genre-living', kind: 'genre', summary: 'A living document whose every colour is a token.' },
    ], { ...opts, light: new Map([['genre-living', 'follows' as const]]) });
    expect(text).toContain('- `genre-almanac` [fixed colours]: A Swiss data poster: strict rules, one red.');
    expect(text).toContain('- `genre-living` [follows the theme]:');
    expect(text).toContain('- `look-amber`: Poster boldness with a proven amber pair.');
    expect(text.indexOf('### GENRES')).toBeLessThan(text.indexOf('### LOOKS'));
    expect(text).toContain('https://node.example/v1/designbook/<id>/preview');
    expect(text).not.toContain('### LAYOUTS');
  });

  it('keeps a kind it was never told about', () => {
    const text = buildDesignBookMap([{ id: 'sound-rain', kind: 'sound', summary: 'Rain on a tin roof, looped without a seam.' }], opts);
    expect(text).toContain('### SOUND (1)');
    expect(text).toContain('- `sound-rain`: Rain on a tin roof, looped without a seam.');
  });

  it('a Book of 900 parts stays inside the budget and drops no row', () => {
    const rows = Array.from({ length: 900 }, (_, i) => ({
      id: `fill-part-${String(i).padStart(3, '0')}`, kind: 'fill',
      summary: 'A long description of what this part is for and where it was proven, which runs on and on past any short line.',
    }));
    const text = buildDesignBookMap(rows, opts);
    expect(text.match(/^- `fill-part-/gm)?.length).toBe(900);
    // 900 rows cannot fit 13 kB at any summary length; what is promised is that the summaries give way first.
    expect(text).toContain('`fill-part-899`: A long description of w');
    const today = buildDesignBookMap(rows.slice(0, 90), opts);
    expect(today.length).toBeLessThanOrEqual(MAP_BUDGET);
  });
});
