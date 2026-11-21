/**
 * @file stamped-seeds.test.ts
 * @description The seed stamp decision (src/services/seed/stamped-seed.ts) from fingerprints alone:
 *   create what is missing, follow this build where nobody changed the record, keep an edit, adopt or
 *   update or keep a record seeded before stamps by the store's own evidence. The stores that seed
 *   through it are tested on both providers in existing-install-seeds.test.ts, which runs its cases
 *   one after another on one database.
 * @structure decideStampedSeed · seedFingerprint · seedStampKey
 * @usage cd aimeat && pnpm exec vitest run test/unit/stamped-seeds.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-21 -- Initial (docs/pitfalls.md §88, now deleted).
 */
import { describe, expect, it } from 'vitest';
import { decideStampedSeed, seedFingerprint, seedStampKey } from '../../src/services/seed/stamped-seed.js';

describe('decideStampedSeed', () => {
  const A = 'a', B = 'b', C = 'c';
  it('creates what is missing', () => expect(decideStampedSeed(null, A, B)).toBe('create'));
  it('updates an untouched copy when the build moved', () => expect(decideStampedSeed(A, A, B)).toBe('update'));
  it('leaves an untouched current copy', () => expect(decideStampedSeed(B, B, B)).toBe('current'));
  it('keeps a copy changed after the seed wrote it', () => expect(decideStampedSeed(C, A, B)).toBe('keep-edited'));
  it('keeps a copy held by another principal, whatever its stamp', () => expect(decideStampedSeed(A, A, B, { heldByOther: true })).toBe('keep-edited'));
  it('adopts an unstamped copy equal to the build', () => expect(decideStampedSeed(B, null, B)).toBe('adopt'));
  it('updates an unstamped copy the store says nobody touched', () => expect(decideStampedSeed(A, null, B, { untouchedWithoutStamp: true })).toBe('update'));
  it('keeps an unstamped copy with no evidence', () => expect(decideStampedSeed(A, null, B)).toBe('keep-unknown'));
});

describe('seedFingerprint and seedStampKey', () => {
  it('fingerprints JSON by content, not key order', () => {
    expect(seedFingerprint({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(seedFingerprint({ b: [1, { d: 3, c: 2 }], a: 1 }));
    expect(seedFingerprint({ a: 1 })).not.toBe(seedFingerprint({ a: 2 }));
    expect(seedFingerprint(['x', 'y'])).not.toBe(seedFingerprint(['y', 'x']));
  });
  it('fingerprints a string by its bytes, as the skill seeder always did', () => {
    expect(seedFingerprint('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });
  it('makes a memory key of any record name', () => {
    expect(seedStampKey('profile-schema', 'profile.*.bio')).toBe('seeds.profile-schema.profile._.bio');
    expect(seedStampKey('anonymous-scopes', 'shared#anonymous@n')).toBe('seeds.anonymous-scopes.shared_anonymous_n');
  });
});
