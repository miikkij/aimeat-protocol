/**
 * @file test/unit/replication-consent-pattern.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The federation consent pattern that decides replication is a glob, never a regular
 *   expression (secaudit2026oct26, memory-replication:matchesPattern-compiles-owner-pattern-as-raw-regex).
 *   `*` is one segment between dots, `**` is any rest, and every other character is itself: a pattern
 *   holding regex syntax matches only the key that spells it, and a pattern built to backtrack ends at
 *   once. The plain patterns the node writes (`packages/<id>/*`, `profile.*`, `*`, an exact key) keep
 *   matching the keys they matched.
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect } from 'vitest';
import { federationConsentCovers } from '../../src/services/memory-replication.js';

const covers = (pattern: string, key: string) =>
  federationConsentCovers([{ status: 'active', scope: 'federation', dataPattern: pattern }], key);

describe('the federation consent pattern', () => {
  it('reads regex syntax as the characters themselves', () => {
    expect(covers('a+b', 'aab')).toBe(false);
    expect(covers('a+b', 'a+b')).toBe(true);
    expect(covers('(x|y).z', 'y.z')).toBe(false);
    expect(covers('(x|y).z', '(x|y).z')).toBe(true);
    expect(covers('profile.[ab]', 'profile.a')).toBe(false);
  });

  it('ends at once on a pattern built to backtrack', () => {
    const key = 'a'.repeat(40) + '!';
    const started = Date.now();
    expect(covers('(a+)+$', key)).toBe(false);
    expect(covers('*a*a*a*a*a*a*a*a*a*a*a*a*b', key)).toBe(false);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('keeps the meaning of the plain patterns the node writes', () => {
    expect(covers('*', 'anything.at.all')).toBe(true);
    expect(covers('profile.*', 'profile.bio')).toBe(true);
    expect(covers('profile.*', 'profile.bio.long')).toBe(false);
    expect(covers('profile.**', 'profile.bio.long')).toBe(true);
    expect(covers('packages/abc/*', 'packages/abc/manifest')).toBe(true);
    expect(covers('packages/abc/*', 'packages/abd/manifest')).toBe(false);
    expect(covers('notes.today', 'notes.today')).toBe(true);
    expect(covers('notes.today', 'notesXtoday')).toBe(false);
    // `*` spans no dot but may be empty, as the earlier regex [^.]* allowed.
    expect(covers('profile.*', 'profile.')).toBe(true);
    expect(covers('a*.b', 'a.b')).toBe(true);
  });

  it('counts only an active federation consent', () => {
    expect(federationConsentCovers([{ status: 'revoked', scope: 'federation', dataPattern: '*' }], 'k')).toBe(false);
    expect(federationConsentCovers([{ status: 'active', scope: 'read', dataPattern: '*' }], 'k')).toBe(false);
  });
});
