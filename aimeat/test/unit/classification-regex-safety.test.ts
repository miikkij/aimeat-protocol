/**
 * @file test/unit/classification-regex-safety.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The detection rules cannot stop the node (TARGET-082 review, ReDoS): the static
 *   check refuses a repeat inside a repeat, overlapping alternatives under a repeat and two
 *   overlapping repeats side by side, and accepts the default rules; a match with a time limit
 *   stops a catastrophic pattern; matchRules does not run a refused pattern, finishes the default
 *   policy on a long base64-like value in well under a second, and skips a rule whose label was
 *   retired.
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial (TARGET-082 review).
 */
import { describe, it, expect } from 'vitest';
import { unsafeRegexReason, testWithin } from '../../src/services/classification/regex-safety.js';
import { matchRules, REGEX_TEXT } from '../../src/services/classification/detect.js';
import { defaultPolicy } from '../../src/services/classification/defaults.js';
import { memoryTarget } from '../../src/services/classification/labels.js';

const t = (key: string) => memoryTarget('alice@n', key);

describe('the regex safety check', () => {
  it.each([
    '(a+)+', '(a*)*', '(a|a)+', '(\\w|\\d)+', '(\\w+\\s?)*', '(a|)+', '(?:a+){2,}', '((ab)*)+',
    '(x+x+)+y', '^(([a-z])+.)+[A-Z]([a-z])+$', '(.*a){12}', '\\d+\\d+', '.*.*', '\\w+\\s*\\w+',
  ])('refuses %s', pattern => {
    expect(unsafeRegexReason(pattern)).toMatch(/time/);
  });

  it.each([
    '\\bFI\\d{16}\\b', '(?:\\.[a-z0-9-]+)*', '(a|b)+', '(?:foo|bar)+', 'a.*b.*c', '(?:, ?\\w+)*',
    '(?: [A-Z0-9]{4}){3,7}', '[]a]', 'x+',
  ])('accepts %s', pattern => {
    expect(unsafeRegexReason(pattern)).toBeNull();
  });

  it('accepts every default rule, and refuses a flag the policy does not allow', () => {
    for (const r of defaultPolicy().rules) if (r.kind === 'regex') expect(unsafeRegexReason(r.pattern, r.flags), r.id).toBeNull();
    expect(unsafeRegexReason('abc', 'g')).toMatch(/flag/);
    expect(unsafeRegexReason('(')).toMatch(/not a valid/);
  });

  it('stops a catastrophic match at its time limit', () => {
    const t0 = performance.now();
    expect(testWithin(/(a+)+$/, `${'a'.repeat(40)}b`, 20)).toBeNull();
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(testWithin(/b$/, 'aab', 20)).toBe(true);
    expect(testWithin(/c$/, 'aab', 20)).toBe(false);
  });
});

describe('matchRules with regex rules', () => {
  it('does not run a stored pattern that fails the check', () => {
    const p = defaultPolicy();
    p.rules = [{ id: 'bad', name: 'Bad', kind: 'regex', pattern: '(a+)+$', flags: '', minLabel: 'luottamuksellinen', enabled: true }];
    // The pattern would match here at once; it is refused, not run.
    expect(matchRules(p, t('x'), 'aaaa')).toBeNull();
  });

  it('finishes the default rules on a long base64-like value quickly', () => {
    // A 60 000-letter run with no @ takes the default e-mail rule seconds when the whole of it is read.
    const blob = 'A'.repeat(60_000);
    const t0 = performance.now();
    expect(matchRules(defaultPolicy(), t('img'), blob)).toBeNull();
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(REGEX_TEXT).toBe(20_000);
  });

  it("skips a rule whose label is retired, so setLabel never sees it", () => {
    const p = defaultPolicy();
    p.labels.push({ ...p.labels[2]!, id: 'vanha', rank: 25, status: 'retired' });
    p.rules = [{ id: 'old', name: 'Old', kind: 'keyword', pattern: 'salary', flags: '', minLabel: 'vanha', enabled: true }];
    expect(matchRules(p, t('x'), 'the salary list')).toBeNull();
  });
});
