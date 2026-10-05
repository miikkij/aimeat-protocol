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
 *   v1.1.0 — 2026-09-30 — One scope's slow rules stop costing the node once the scope has used its
 *     minute of regex time (TARGET-082 second review, S4).
 *   v1.0.0 — 2026-09-29 — Initial (TARGET-082 review).
 */
import { describe, it, expect } from 'vitest';
import { unsafeRegexReason, testWithin } from '../../src/services/classification/regex-safety.js';
import { matchRules, REGEX_TEXT, resetRegexBudgets } from '../../src/services/classification/detect.js';
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

  it('stops charging the node for one scope\'s slow rules once the scope has used its minute', () => {
    resetRegexBudgets();
    // Passes the static check, yet reaches the per-rule limit on a long run with no x.
    const slow = defaultPolicy();
    slow.rules = [{ id: 'slow', name: 'Slow', kind: 'regex', pattern: '[a-z]*x', flags: '', minLabel: 'luottamuksellinen', enabled: true }];
    const text = 'a'.repeat(REGEX_TEXT);
    const attacker = memoryTarget('mallory@n', 'notes.loop');
    const t0 = performance.now();
    // Each write costs this pattern 150 to 500 ms, so thirty would block the node 5 to 15 seconds;
    // the scope's budget is three seconds a minute.
    for (let i = 0; i < 30; i++) matchRules(slow, attacker, text);
    expect(performance.now() - t0).toBeLessThan(4500);
    // Past its budget the scope's writes cost nothing.
    const t1 = performance.now();
    matchRules(slow, attacker, text);
    expect(performance.now() - t1).toBeLessThan(50);
    // POSITIVE CONTROL: another owner's regex rule still runs and matches.
    const iban = defaultPolicy();
    iban.rules = [{ id: 'fi', name: 'FI', kind: 'regex', pattern: '\\bFI\\d{16}\\b', flags: '', minLabel: 'luottamuksellinen', enabled: true }];
    expect(matchRules(iban, memoryTarget('alice@n', 'notes.bank'), 'pay to FI2112345600000785')?.label).toBe('luottamuksellinen');
    resetRegexBudgets();
  });

  // Secaudit 2026-10, DATA-1: an agent's content has the agent as its scope, so each agent had a
  // budget of its own and one owner multiplied it by the number of their agents.
  it('one owner\'s agents share the owner\'s budget; they do not each get a minute of their own', () => {
    resetRegexBudgets();
    const policy = defaultPolicy();
    policy.rules = [
      { id: 'slow', name: 'Slow', kind: 'regex', pattern: '[a-z]*x', flags: '', minLabel: 'luottamuksellinen', enabled: true },
      { id: 'fi', name: 'FI', kind: 'regex', pattern: '\\bFI\\d{16}\\b', flags: '', minLabel: 'luottamuksellinen', enabled: true },
    ];
    const text = `pay to FI2112345600000785 ${'a'.repeat(REGEX_TEXT)}`;
    // The first agent writes until its scope's minute is spent: the IBAN rule then no longer runs.
    let writes = 0;
    while (matchRules(policy, memoryTarget('bot0#mallory@n', `notes.${writes}`), text) && writes < 5000) writes++;
    expect(writes).toBeLessThan(5000);
    // A second agent of the same owner is out of time too.
    expect(matchRules(policy, memoryTarget('bot1#mallory@n', 'notes.other'), text)).toBeNull();
    // POSITIVE CONTROL: another owner's agent still has its owner's minute.
    expect(matchRules(policy, memoryTarget('bot#alice@n', 'notes.bank'), text)?.label).toBe('luottamuksellinen');
    resetRegexBudgets();
  }, 60_000);

  it("skips a rule whose label is retired, so setLabel never sees it", () => {
    const p = defaultPolicy();
    p.labels.push({ ...p.labels[2]!, id: 'vanha', rank: 25, status: 'retired' });
    p.rules = [{ id: 'old', name: 'Old', kind: 'keyword', pattern: 'salary', flags: '', minLabel: 'vanha', enabled: true }];
    expect(matchRules(p, t('x'), 'the salary list')).toBeNull();
  });
});
