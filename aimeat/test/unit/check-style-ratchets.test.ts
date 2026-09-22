/**
 * @file test/unit/check-style-ratchets.test.ts
 * @description Proof for the two ratchets that keep per-page styling from growing back while the
 *   pages move onto the shared set. check:poster-shapes counts a design-language shape copied into
 *   a page sheet whether it is written with the literal value or with its shape token, and leaves a
 *   sheet that only uses the class alone. check:view-sheet-lines refuses a page sheet that grew or a
 *   new one, and lets a shrink, a removal and a listed exception pass.
 * @usage cd aimeat && pnpm exec vitest run test/unit/check-style-ratchets.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-22 — Initial, with the token-aware shape patterns and the line ratchet.
 */
import { describe, it, expect } from 'vitest';
import { countShapes } from '../../scripts/check-poster-shapes.js';
import { lineCount, findGrowth } from '../../scripts/check-view-sheet-lines.js';

describe('check:poster-shapes counts a copied shape', () => {
  it('counts the literal and the token spelling of the same frame', () => {
    expect(countShapes('.a { border: 3px solid var(--text); }')).toEqual({ frame3: 1 });
    expect(countShapes('.a { border: var(--rule-heavy) solid var(--text); }')).toEqual({ frame3: 1 });
  });

  it('counts an offset shadow written with the tokens', () => {
    expect(countShapes('.a { box-shadow: var(--offset-m) var(--offset-m) 0 var(--sun); }')).toEqual({ record: 1 });
    expect(countShapes('.a { box-shadow: var(--offset-s) var(--offset-s) 0 var(--sun); }')).toEqual({ slab: 1 });
  });

  it('leaves a sheet alone that only places the shared class', () => {
    expect(countShapes('.pf-grid { display: grid; gap: 1rem; } /* border: 3px solid var(--text) */')).toEqual({});
  });
});

describe('check:view-sheet-lines refuses growth', () => {
  const baseline = { _note: '', _measured: { date: '', files: 2, lines: 30 }, exceptions: { 'public/css/views/kept.css': 'a reason' },
    files: { 'public/css/views/a.css': 10, 'public/css/views/b.css': 20 } };

  it('counts lines as a person scrolling the sheet sees them', () => {
    expect(lineCount('')).toBe(0);
    expect(lineCount('.a{}\n.b{}\n')).toBe(2);
    expect(lineCount('.a{}\r\n.b{}')).toBe(2);
  });

  it('passes a sheet that shrank and a sheet that is gone', () => {
    expect(findGrowth({ 'public/css/views/a.css': 4 }, baseline)).toEqual([]);
  });

  it('refuses a sheet that grew', () => {
    const found = findGrowth({ 'public/css/views/a.css': 11, 'public/css/views/b.css': 20 }, baseline);
    expect(found).toEqual(['public/css/views/a.css: 10 -> 11 lines']);
  });

  it('refuses a new sheet unless it is a listed exception', () => {
    expect(findGrowth({ 'public/css/views/new.css': 5 }, baseline)).toEqual(['public/css/views/new.css: a new page sheet (5 lines)']);
    expect(findGrowth({ 'public/css/views/kept.css': 5 }, baseline)).toEqual([]);
  });
});
