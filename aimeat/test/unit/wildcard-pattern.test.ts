/**
 * @file wildcard-pattern.test.ts
 * @description The two schema/consent key matchers, held to their documented shapes: dot-segment
 *   wildcards, the rest-of-key '**', and the colon-prefix form cortex manifests are written in.
 * @version-history
 *   v1.1.0 — 2026-08-10 — Cover 'chart:*'. Every bundled cortex pack declares its schema with a
 *     trailing star glued to a prefix, the matcher split on '.' only, and an unmatched schema is
 *     invisible: the write just succeeds. So the packs shipped with schemas that validated nothing
 *     and no test said so.
 *   v1.0.0 — 2026-03-xx — Initial.
 */
import { describe, it, expect } from 'vitest';
import { matchWildcardPattern, consentMatchPattern } from '../../src/storage/pattern-utils.js';

describe('matchWildcardPattern', () => {
  it('exact match', () => {
    expect(matchWildcardPattern('profile.alice.interests', 'profile.alice.interests')).toBe(true);
  });

  it('exact non-match', () => {
    expect(matchWildcardPattern('profile.alice.interests', 'profile.bob.interests')).toBe(false);
  });

  it('single wildcard * matches one segment', () => {
    expect(matchWildcardPattern('profile.*.interests', 'profile.alice.interests')).toBe(true);
    expect(matchWildcardPattern('profile.*.interests', 'profile.bob.interests')).toBe(true);
  });

  it('* does not match multiple segments', () => {
    expect(matchWildcardPattern('profile.*.interests', 'profile.alice.deep.interests')).toBe(false);
  });

  it('* does not match empty segment', () => {
    expect(matchWildcardPattern('profile.*.interests', 'profile.interests')).toBe(false);
  });

  it('double wildcard ** matches multiple segments', () => {
    expect(matchWildcardPattern('iot.**', 'iot.temperature.living-room')).toBe(true);
    expect(matchWildcardPattern('iot.**', 'iot.humidity')).toBe(true);
  });

  it('** matches deeply nested keys', () => {
    expect(matchWildcardPattern('data.**', 'data.a.b.c.d.e')).toBe(true);
  });

  it('no match for different prefix', () => {
    expect(matchWildcardPattern('profile.*.interests', 'iot.temperature')).toBe(false);
  });

  it('partial key does not match', () => {
    expect(matchWildcardPattern('profile.alice', 'profile.alice.interests')).toBe(false);
  });

  it('key shorter than pattern does not match', () => {
    expect(matchWildcardPattern('profile.alice.interests', 'profile.alice')).toBe(false);
  });
});

describe('matchWildcardPattern — the colon-prefix form cortex manifests use', () => {
  it("'chart:*' matches the keys the chart pack writes", () => {
    // public/cortex-bundled/aimeat-charts.yaml declares exactly this, with apply_to: prefix.
    expect(matchWildcardPattern('chart:*', 'chart:sales-2026')).toBe(true);
    expect(matchWildcardPattern('drawing:*', 'drawing:sketch')).toBe(true);
    expect(matchWildcardPattern('recipe:*', 'recipe:bad-recipe')).toBe(true);
  });

  it('and does not reach past its own prefix', () => {
    expect(matchWildcardPattern('chart:*', 'flow:sales-2026')).toBe(false);
    expect(matchWildcardPattern('chart:*', 'chart')).toBe(false);
  });

  it('the prefix swallows dots — a colon key is one address, not a segment path', () => {
    expect(matchWildcardPattern('chart:*', 'chart:a.b.c')).toBe(true);
  });

  it('REGRESSION: a star that IS its own dot-segment still means one segment', () => {
    // The narrow guard exists so these keep going through the segment walk untouched.
    expect(matchWildcardPattern('profile.*', 'profile.name')).toBe(true);
    expect(matchWildcardPattern('profile.*', 'profile.a.b')).toBe(false);
    expect(matchWildcardPattern('profile.*.interests', 'profile.alice.interests')).toBe(true);
    expect(matchWildcardPattern('iot.**', 'iot.a.b')).toBe(true);
  });
});

describe('consentMatchPattern', () => {
  it('exact match', () => {
    expect(consentMatchPattern('profile.alice.interests', 'profile.alice.interests')).toBe(true);
  });

  it('single wildcard * matches one segment', () => {
    expect(consentMatchPattern('profile.*.interests', 'profile.alice.interests')).toBe(true);
    expect(consentMatchPattern('profile.*.interests', 'profile.bob.interests')).toBe(true);
  });

  it('* does not match multiple segments', () => {
    expect(consentMatchPattern('profile.*.interests', 'profile.alice.deep.interests')).toBe(false);
  });

  it('double wildcard ** matches multiple segments', () => {
    expect(consentMatchPattern('iot.**', 'iot.temperature.living-room')).toBe(true);
    expect(consentMatchPattern('iot.**', 'iot.humidity')).toBe(true);
  });

  it('no match for different prefix', () => {
    expect(consentMatchPattern('profile.*.interests', 'settings.theme')).toBe(false);
  });

  it('** matches deeply nested', () => {
    expect(consentMatchPattern('data.**', 'data.a.b.c.d')).toBe(true);
  });
});
