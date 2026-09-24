/**
 * @file test/unit/check-shape-tokens.test.ts
 * @description Proof that `pnpm check:shape-tokens` counts a corner, a frame width, a shadow and a
 *   letter case written as values, and stays quiet where a component reads the theme's shape values,
 *   for a circle, a hairline, a comment and a custom property's own definition. And that a rise over
 *   the baseline is named per file and kind.
 * @usage cd aimeat && pnpm exec vitest run test/unit/check-shape-tokens.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial, with the gate (07 "New components follow the theme").
 */
import { describe, it, expect } from 'vitest';
import { countShapeLiterals, rises } from '../../scripts/check-shape-tokens.js';

describe('check:shape-tokens', () => {
  it('counts each kind of literal once per declaration', () => {
    const css = `.x { border-radius: 0; border: 2px solid var(--text); box-shadow: 4px 4px 0 var(--sun); text-transform: uppercase; }
      .y { border-bottom: 3px solid var(--text) !important; outline: 3px solid var(--sun); }`;
    expect(countShapeLiterals(css)).toEqual({ corner: 1, frame: 3, shadow: 1, case: 1 });
  });

  it('is quiet where the shape values are read, and for what has no shape value', () => {
    const css = `/* border-radius: 0; text-transform: uppercase */
      .x { border-radius: var(--shape-corner); border: var(--shape-frame) solid var(--shape-frame-colour); }
      .y { box-shadow: var(--shape-shadow-action); text-transform: var(--shape-case-heading); }
      .dot { border-radius: 50%; border: 1px solid var(--border); border-left: 6px solid var(--sun); box-shadow: none; text-transform: none; }
      :root { --shape-corner: 0; --shape-frame: 2px; }`;
    expect(countShapeLiterals(css)).toEqual({});
  });

  it('names a rise per file and kind, and lets a fall pass', () => {
    const baseline = { 'public/css/components/a.css': { corner: 2 }, 'public/css/components/b.css': { shadow: 1 } };
    expect(rises({ 'public/css/components/a.css': { corner: 3 }, 'public/css/components/b.css': {} }, baseline))
      .toEqual(['public/css/components/a.css: corner 2 -> 3']);
    expect(rises({ 'public/css/components/c.css': { case: 1 } }, baseline)).toEqual(['public/css/components/c.css: case 0 -> 1']);
    expect(rises({ 'public/css/components/a.css': { corner: 1 } }, baseline)).toEqual([]);
  });
});
