import { describe, it, expect } from 'vitest';
import { matchWildcardPattern, consentMatchPattern } from '../../src/storage/providers/memory/index.js';

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
