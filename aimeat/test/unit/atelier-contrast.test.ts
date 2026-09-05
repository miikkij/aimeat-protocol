/**
 * @file test/unit/atelier-contrast.test.ts
 * @description The extracted contrast matrix (src/services/atelier-contrast.ts): the extraction
 *   changed nothing (the shipped sheets pass every check, exactly as the tool gate proves), and
 *   the new `overrides` parameter actually reaches the evaluation — an unreadable accent
 *   override produces readability failures with real numbers, which is the capability the
 *   signature's colour door will stand on once mode-paired colours exist.
 * @usage cd aimeat && pnpm test -- atelier-contrast
 * @version-history
 *   v1.1.0 — 2026-09-05 — The lightness cap and the check it exists for: capLightness leaves a
 *     colour already under the line byte-identical and pulls a lighter one down keeping hue and
 *     chroma, and AK-SOLID refuses the raw house coral (3.58:1 under white) that AK-GRAD could
 *     never see, because the gradient every look darkens was the only accent ground proven.
 *   v1.0.0 — 2026-08-28 — initial (TARGET-074, the matrix becomes a callable service).
 */
import { describe, it, expect } from 'vitest';
import { runMatrix, ratio, capLightness } from '../../src/services/atelier-contrast.js';

describe('atelier-contrast — the matrix as a callable service', () => {
  it('the shipped sheets pass the full matrix (the extraction changed nothing)', () => {
    const failures = runMatrix().filter((r) => !r.ok);
    expect(failures).toEqual([]);
  });

  it('an unreadable accent override produces readability failures with real numbers', () => {
    const failures = runMatrix({ '--ak-accent': '#ffff00' }).filter((r) => !r.ok);
    expect(failures.length).toBeGreaterThan(0);
    const text = failures.find((f) => f.label.includes('accent-as-text'));
    expect(text).toBeDefined();
    expect(text!.actual).toBeLessThan(text!.min);
  });

  it('WCAG ratio matches the known anchors', () => {
    expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(ratio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('the lightness cap moves only a colour above the line, and only its lightness', () => {
    // The five light palettes that already carry white sit under 0.576 and must come back
    // untouched — the cap is a floor under readability, not a restyling.
    for (const hex of ['#a03040', '#0e7290', '#1d4ed8', '#47695a', '#c2187e']) {
      expect(capLightness(hex, 0.576)).toBe(hex);
    }
    // The house coral is above it: white goes from failing to passing, and the shade is the one
    // the contract's comment names.
    expect(ratio('#e8564a', '#ffffff')).toBeCloseTo(3.58, 2);
    const capped = capLightness('#e8564a', 0.576);
    expect(capped).toBe('#cf3e35');
    expect(ratio(capped, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('AK-SOLID refuses the raw accent the gradient checks could never see', () => {
    // #e8564a is the shipped house coral before the cap. AK-GRAD passes on it (every look
    // darkens its gradient stops toward the ink); the flat fill under white does not.
    // On the light house palette, which is where the review measured it: every failure the raw
    // coral produces is AK-SOLID, and AK-GRAD is green throughout — one look, one failure.
    const light = runMatrix({ '--ak-accent': '#e8564a' })
      .filter((r) => !r.ok && r.combo.endsWith('aimeat/light'));
    expect(light.length).toBeGreaterThan(0);
    expect(light.every((f) => f.label.startsWith('AK-SOLID'))).toBe(true);
    expect(light.every((f) => f.actual < f.min)).toBe(true);
  });
});
