/**
 * @file test/unit/silent-catch-ratchet.test.ts
 * @description The comparisons behind `check:silent-catch --strict` (scripts/lib/silent-catch-ratchet.ts).
 *   src/static had 408 silent handlers that the script reported and never gated, so a new one there
 *   passed every check; and an `eslint-disable… aimeat/no-silent-catch` directive removed a finding
 *   from every count without leaving one of its own, so an exemption could be added silently. These
 *   cases hold the three things the gate now does: a file over its ceiling fails (per shape under
 *   src/static), a file under it is named so the gain can be locked in, and an exemption is counted
 *   per file with a directive that gives no reason after `--` named for refusal.
 *
 *   FIRST FAIL: before 2026-10-16 the module did not exist and this file could not import it.
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (W25 "An error is not an empty result").
 */
import { describe, it, expect } from 'vitest';
import { compareCeilings, compareShapeCeilings, countExemptions, shapeName } from '../../scripts/lib/silent-catch-ratchet.js';

const RULE = 'aimeat/no-silent-catch';

describe('compareCeilings', () => {
  it('fails a file over its ceiling and a new file with any count', () => {
    const r = compareCeilings(new Map([['a.js', 3], ['new.js', 1]]), { 'a.js': { count: 2 } }, true);
    expect(r.over).toEqual(['a.js: 3 now, 2 allowed', 'new.js: 1 now, 0 allowed']);
  });

  it('names a file under its ceiling, a file that went to zero included', () => {
    const r = compareCeilings(new Map([['a.js', 1]]), { 'a.js': { count: 2 }, 'gone.js': { count: 1 } }, true);
    expect(r.over).toEqual([]);
    expect(r.under).toEqual(['a.js: 1 now, 2 listed', 'gone.js: 0 now, 1 listed']);
  });

  it('claims no gain from a staged pass, where untouched files were never linted', () => {
    const r = compareCeilings(new Map(), { 'a.js': { count: 2 } }, false);
    expect(r.under).toEqual([]);
  });
});

describe('compareShapeCeilings', () => {
  it('does not let a fixed empty catch pay for a new substitute', () => {
    const now = new Map([['src/static/x.js', { empty: 1, substitute: 1 }]]);
    const r = compareShapeCeilings(now, { 'src/static/x.js': { counts: { empty: 2 } } }, true);
    expect(r.over).toEqual(['src/static/x.js: 1 substitute now, 0 allowed']);
    expect(r.under).toEqual(['src/static/x.js: 1 empty now, 2 listed']);
  });

  it('holds a file at its listed counts quietly', () => {
    const now = new Map([['src/static/x.js', { empty: 2, absence: 1 }]]);
    const r = compareShapeCeilings(now, { 'src/static/x.js': { counts: { empty: 2, absence: 1 } } }, true);
    expect(r).toEqual({ over: [], under: [] });
  });
});

describe('countExemptions', () => {
  const directive = (justification: string) => ({ kind: 'directive', justification });

  it('counts every suppressed finding of the rule per file, and only of the rule', () => {
    const r = countExemptions([
      { file: 'a.ts', suppressed: [
        { ruleId: RULE, line: 3, suppressions: [directive('not JSON is an answer here')] },
        { ruleId: RULE, line: 9, suppressions: [directive('cleanup after a failed send')] },
        { ruleId: 'react-hooks/exhaustive-deps', line: 12, suppressions: [directive('mount only')] },
      ] },
      { file: 'b.js', suppressed: [{ ruleId: RULE, line: 1, suppressions: [directive('ok')] }] },
    ], RULE);
    expect([...r.perFile]).toEqual([['a.ts', 2], ['b.js', 1]]);
    expect(r.unreasoned).toEqual([]);
  });

  it('names a directive with no reason after --', () => {
    const r = countExemptions([{ file: 'a.ts', suppressed: [
      { ruleId: RULE, line: 7, suppressions: [directive('')] },
      { ruleId: RULE, line: 8, suppressions: [directive('   ')] },
    ] }], RULE);
    expect(r.unreasoned).toEqual(['a.ts:7', 'a.ts:8']);
    expect(r.perFile.get('a.ts')).toBe(2);
  });

  it('leaves out a suppression that came from outside a directive', () => {
    const r = countExemptions([{ file: 'a.ts', suppressed: [{ ruleId: RULE, line: 7, suppressions: [{ kind: 'external' }] }] }], RULE);
    expect(r.perFile.size).toBe(0);
  });
});

describe('shapeName', () => {
  it('maps the rule\'s message ids to the baseline names', () => {
    expect(['emptyCatch', 'returnsAbsence', 'discardsError', 'substitutesValue'].map(shapeName))
      .toEqual(['empty', 'absence', 'discards', 'substitute']);
  });
});
