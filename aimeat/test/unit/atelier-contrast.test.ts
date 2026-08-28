/**
 * @file test/unit/atelier-contrast.test.ts
 * @description The extracted contrast matrix (src/services/atelier-contrast.ts): the extraction
 *   changed nothing (the shipped sheets pass every check, exactly as the tool gate proves), and
 *   the new `overrides` parameter actually reaches the evaluation — an unreadable accent
 *   override produces readability failures with real numbers, which is the capability the
 *   signature's colour door will stand on once mode-paired colours exist.
 * @usage cd aimeat && pnpm test -- atelier-contrast
 * @version-history
 *   v1.0.0 — 2026-08-28 — initial (TARGET-074, the matrix becomes a callable service).
 */
import { describe, it, expect } from 'vitest';
import { runMatrix, ratio } from '../../src/services/atelier-contrast.js';

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
});
