/**
 * @file test/unit/consent-pattern-bounded.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description consentMatchPattern ends in bounded time for every pattern a writer can store
 *   (secaudit2026oct31w2 round 10, aimeat/src/storage/pattern-utils.ts:consentMatchPattern:
 *   unbounded-globstar-backtracking). A consent or share pattern with many `**` segments, tested
 *   against a long dotted key that does not match, answers at once. Every pattern keeps matching
 *   exactly the keys the earlier anchored-RegExp matcher matched: the equivalence block compares
 *   the two on the patterns the node writes and on a seeded random sweep.
 * @version-history
 *   v1.0.0 -- 2026-10-31 -- Initial (secaudit2026oct31w2 round 10).
 */
import { describe, it, expect } from 'vitest';
import { consentMatchPattern } from '../../src/storage/pattern-utils.js';

/** The matcher as it was before round 10: one anchored RegExp per call. The reference for equivalence. */
function regexMatcher(pattern: string, key: string): boolean {
  const regex = pattern
    .split(/([./])/)
    .map(tok => {
      if (tok === '**') return '.*';
      if (tok === '*') return '[^./]+';
      if (tok === '.') return '\\.';
      if (tok === '/') return '/';
      return tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${regex}$`).test(key);
}

describe('consentMatchPattern runs in bounded time', () => {
  it('answers at once on a many-globstar pattern against a long dotted key that does not match', () => {
    const key = 'abc' + '.a'.repeat(40) + '.b';
    const started = Date.now();
    for (const k of [2, 3, 4, 5, 6, 7, 8]) {
      expect(consentMatchPattern('abc' + '.**'.repeat(k) + '.z', key)).toBe(false);
    }
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('answers at once on a 400-character share pattern made of globstars', () => {
    const pattern = 'abc' + '.**'.repeat(131) + '.z';
    expect(pattern.length).toBeLessThanOrEqual(400);
    const key = 'abc' + '.a'.repeat(140) + '.b';
    const started = Date.now();
    expect(consentMatchPattern(pattern, key)).toBe(false);
    expect(consentMatchPattern(pattern, key.slice(0, -1) + 'z')).toBe(true);
    expect(Date.now() - started).toBeLessThan(200);
  });
});

describe('consentMatchPattern keeps matching the same keys', () => {
  const written: Array<[string, string]> = [
    ['profile.*', 'profile.bio'],
    ['profile.*', 'profile.bio.long'],
    ['profile.**', 'profile.bio.long'],
    ['profile.**', 'profile'],
    ['profile.**', 'profile.'],
    ['packages/abc-123/*', 'packages/abc-123/manifest'],
    ['packages/abc-123/*', 'packages/abc-123/a/b'],
    ['packages/abc/**', 'packages/abc/a/b.png'],
    ['storage:images/*', 'storage:images/photo'],
    ['storage:images/*', 'storage:images/a.png'],
    ['storage:images/**', 'storage:images/a.png'],
    ['deliveries.abc.**', 'deliveries.abc.x.y'],
    ['deliveries.abc.**', 'deliveries.abd.x'],
    ['*', 'anything'],
    ['*', 'any.thing'],
    ['**', ''],
    ['**', 'a.b/c'],
    ['*', ''],
    ['a.b+c', 'a.b+c'],
    ['a.b+c', 'a.bXc'],
    ['a*.b', 'a*.b'],
    ['a*.b', 'ax.b'],
    ['a.***', 'a.***'],
    ['a.***', 'a.x'],
    ['a..b', 'a..b'],
    ['a.**.**', 'a.x'],
    ['a.**.**', 'a..'],
    ['a.*.**.*', 'a.x.y.z'],
    ['a.*.**.*', 'a.x..z'],
    ['organism.org-1', 'organism.org-1'],
    ['**.secret', 'a.b\n.secret'],
    ['**.secret', 'a.b.secret'],
    ['a.*', 'a.b\nc'],
  ];
  it('on the patterns the node writes and their edges', () => {
    for (const [p, k] of written) {
      expect([p, k, consentMatchPattern(p, k)]).toEqual([p, k, regexMatcher(p, k)]);
    }
  });

  it('on a seeded random sweep of short patterns and keys', () => {
    let seed = 0x2026_1031;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const patternAtoms = ['a', 'b', 'ab', '*', '**', '.', '/', '+', '\n', '***', 'a*'];
    const keyAtoms = ['a', 'b', 'ab', '.', '/', '+', '*', '\n', 'x'];
    for (let i = 0; i < 20000; i++) {
      let p = '';
      for (let j = rand(7); j >= 0; j--) p += patternAtoms[rand(patternAtoms.length)];
      let k = '';
      for (let j = rand(9); j >= 0; j--) k += keyAtoms[rand(keyAtoms.length)];
      const got = consentMatchPattern(p, k);
      const want = regexMatcher(p, k);
      if (got !== want) expect({ p, k, got }).toEqual({ p, k, got: want });
    }
  });
});

// CodeQL js/loop-bound-injection (alert 1776): the matcher sizes its position table by key.length, so a
// key that reached it from parsed JSON as an object with a huge length would allocate that table.
describe('consentMatchPattern takes strings only', () => {
  it('answers false, without allocating, for a key or pattern that is not a string', () => {
    const forged = { length: 2 ** 31 } as unknown as string;
    expect(consentMatchPattern('a.*', forged)).toBe(false);
    expect(consentMatchPattern(['a', '*'] as unknown as string, 'a.b')).toBe(false);
  });

  it('use kept: a string key and pattern still match as before', () => {
    expect(consentMatchPattern('a.*', 'a.b')).toBe(true);
    expect(consentMatchPattern('packages/p1/*', 'packages/p1/manifest')).toBe(true);
  });
});
