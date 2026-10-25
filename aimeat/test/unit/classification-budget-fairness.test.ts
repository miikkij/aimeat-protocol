/**
 * @file test/unit/classification-budget-fairness.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The detection rules' time budgets hold for keyword rules too, and one account cannot
 *   spend the node's regex time for everybody else by spreading its rules over organisms
 *   (secaudit2026oct22: keyword-rules-no-time-limit, node-regex-budget-starvation). A rule a budget
 *   skipped is reported as deferred, so the item is matched again later instead of staying unlabelled.
 * @usage pnpm exec vitest run test/unit/classification-budget-fairness.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — secaudit2026oct22: a 500-rule keyword layer on 200,000 characters, five
 *     organisms of one account against another owner's IBAN rule, and the deferred report.
 */
import { describe, it, expect } from 'vitest';
import { matchRules, runRules, REGEX_TEXT, resetRegexBudgets } from '../../src/services/classification/detect.js';
import { defaultPolicy, type ClassificationRule } from '../../src/services/classification/defaults.js';
import { memoryTarget } from '../../src/services/classification/labels.js';

const IBAN_TEXT = 'pay to FI2112345600000785';
const ibanPolicy = () => {
  const p = defaultPolicy();
  p.rules = [{ id: 'fi', name: 'FI', kind: 'regex', pattern: '\\bFI\\d{16}\\b', flags: '', minLabel: 'luottamuksellinen', enabled: true }];
  return p;
};

/** One keyword rule of about 1000 characters: words that share long prefixes with the text below. */
function keywordRule(r: number): ClassificationRule {
  const words: string[] = [];
  let len = 0;
  for (let i = 0; len < 990; i++) {
    const w = 'a'.repeat(1 + (i % 38)) + String.fromCharCode(98 + (i % 20)) + r;
    words.push(w);
    len += w.length + 1;
  }
  return { id: `kw${r}`, name: `KW ${r}`, kind: 'keyword', pattern: words.join(','), flags: '', minLabel: 'luottamuksellinen', enabled: true };
}

describe('keyword rules count against the time budgets', () => {
  it('a full keyword layer on 200,000 characters stops holding the event loop once the scope has used its minute', () => {
    resetRegexBudgets();
    const p = defaultPolicy();
    p.rules = Array.from({ length: 500 }, (_, r) => keywordRule(r));
    const near = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaz ';
    const text = near.repeat(Math.ceil(200_000 / near.length)).slice(0, 200_000);
    const t0 = performance.now();
    // Each pass of this layer costs about 300 to 750 ms of event loop; twenty were 6 to 15 seconds.
    for (let i = 0; i < 20; i++) matchRules(p, memoryTarget('mallory@n', `notes.${i}`), text);
    expect(performance.now() - t0).toBeLessThan(6000);
    // Past the budget the scope's items are deferred, at almost no cost.
    const t1 = performance.now();
    expect(runRules(p, memoryTarget('mallory@n', 'notes.late'), text).deferred).toBe(true);
    expect(performance.now() - t1).toBeLessThan(50);
    // POSITIVE CONTROL: another owner's rules still run and match.
    expect(matchRules(ibanPolicy(), memoryTarget('alice@n', 'notes.bank'), IBAN_TEXT)?.label).toBe('luottamuksellinen');
    resetRegexBudgets();
  }, 60_000);

  it('an ordinary keyword rule still labels and is not deferred', () => {
    resetRegexBudgets();
    const p = defaultPolicy();
    p.rules = [{ id: 'salary', name: 'Salary', kind: 'keyword', pattern: 'salary, payroll', flags: '', minLabel: 'luottamuksellinen', enabled: true }];
    const run = runRules(p, memoryTarget('alice@n', 'notes.hr'), 'the payroll for March');
    expect(run.hit?.label).toBe('luottamuksellinen');
    expect(run.deferred).toBe(false);
  });
});

describe('one account\'s organisms share one budget', () => {
  it('five organisms of one account cannot spend the node\'s regex time; another owner\'s IBAN rule still runs', () => {
    resetRegexBudgets();
    const slow = defaultPolicy();
    // Passes the static check and reaches the 500 ms rule limit on a long run of one letter.
    slow.rules = [{ id: 'slow', name: 'Slow', kind: 'regex', pattern: 'a.*a.*z', flags: '', minLabel: 'luottamuksellinen', enabled: true }];
    const text = 'a'.repeat(REGEX_TEXT);
    for (let org = 0; org < 5; org++) {
      for (let i = 0; i < 6; i++) {
        runRules(slow, { kind: 'memory', scope: `organism:org-${org}`, key: `organism.org-${org}.notes.${i}` }, text, { budgetKey: 'mallory@n' });
      }
    }
    // The account's own rules are deferred once its share is used.
    expect(runRules(slow, { kind: 'memory', scope: 'organism:org-9', key: 'organism.org-9.notes.x' }, text, { budgetKey: 'mallory@n' }).deferred).toBe(true);
    // Another owner's default-shaped IBAN rule runs and labels.
    expect(matchRules(ibanPolicy(), memoryTarget('alice@n', 'notes.bank'), IBAN_TEXT)?.label).toBe('luottamuksellinen');
    resetRegexBudgets();
  }, 120_000);

  it('without an account key an organism is charged to itself, as before', () => {
    resetRegexBudgets();
    const run = runRules(ibanPolicy(), { kind: 'memory', scope: 'organism:org-1', key: 'organism.org-1.bank' }, IBAN_TEXT);
    expect(run.hit?.label).toBe('luottamuksellinen');
    expect(run.deferred).toBe(false);
  });
});
