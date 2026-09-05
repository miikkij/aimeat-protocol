/**
 * @file test/unit/app-mobile-lint.test.ts
 * @description Unit tests for the non-blocking publish-time mobile lint (src/utils/app-mobile-lint.ts):
 *   it must flag the recurring phone-overflow bugs (missing/incomplete viewport meta, CSS-grid 1fr
 *   blowout) and stay silent on clean, mobile-safe HTML.
 * @version-history
 *   v1.1.0 — 2026-09-06 — The hostile-input case: a page of unclosed `<meta` starts, which the
 *     old single-regex viewport match scanned quadratically (CodeQL js/polynomial-redos).
 *   v1.0.0 — 2026-07-19 — initial.
 */
import { describe, it, expect } from 'vitest';
import { lintAppHtmlForMobile } from '../../src/utils/app-mobile-lint.js';

const SAFE = `<!DOCTYPE html><html><head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content">
  <style>.layout{display:grid;grid-template-columns:minmax(0,1fr)}.layout>*{min-width:0}</style>
  </head><body style="overflow-x:clip">ok</body></html>`;

describe('lintAppHtmlForMobile', () => {
  it('is silent on mobile-safe HTML', () => {
    expect(lintAppHtmlForMobile(SAFE)).toEqual([]);
  });

  it('flags a missing viewport meta', () => {
    const hints = lintAppHtmlForMobile('<html><head></head><body>hi</body></html>');
    expect(hints.some(h => /viewport meta/i.test(h))).toBe(true);
  });

  it('flags a viewport meta without width=device-width', () => {
    const hints = lintAppHtmlForMobile('<html><head><meta name="viewport" content="initial-scale=1"></head><body></body></html>');
    expect(hints.some(h => /width=device-width/i.test(h))).toBe(true);
  });

  it('flags a bare 1fr grid track with no minmax(0,…)/min-width:0', () => {
    const html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
      <style>.g{display:grid;grid-template-columns:250px 1fr}</style></head><body></body></html>`;
    const hints = lintAppHtmlForMobile(html);
    expect(hints.some(h => /grid-track-blowout/.test(h))).toBe(true);
  });

  it('does NOT flag a 1fr grid that already uses minmax(0,…)', () => {
    const html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
      <style>.g{display:grid;grid-template-columns:250px minmax(0,1fr)}</style></head><body></body></html>`;
    expect(lintAppHtmlForMobile(html)).toEqual([]);
  });

  it('does NOT flag a 1fr grid that sets min-width:0 on children', () => {
    const html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
      <style>.g{display:grid;grid-template-columns:1fr 1fr}.g>*{min-width:0}</style></head><body></body></html>`;
    expect(lintAppHtmlForMobile(html)).toEqual([]);
  });

  it('answers quickly on a page made of nothing but unclosed <meta starts', () => {
    // The shape that made the old one-regex viewport match quadratic: every `<meta` is a place the
    // engine restarts an unbounded run from, and none of them can match. A publish waits on this.
    const hostile = `<html><head>${'<meta '.repeat(60_000)}</head><body></body></html>`;
    const started = Date.now();
    expect(lintAppHtmlForMobile(hostile).some(h => /viewport meta/i.test(h))).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('returns [] for empty/non-string input', () => {
    expect(lintAppHtmlForMobile('')).toEqual([]);
    // @ts-expect-error — defensive against non-string callers
    expect(lintAppHtmlForMobile(null)).toEqual([]);
  });
});
