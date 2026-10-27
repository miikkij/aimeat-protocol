/**
 * @file test/unit/regex-safety-unterminated.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The regex safety check ends on every pattern the engine accepts (secaudit2026oct26,
 *   regex-safety.ts:Parser:unterminated-escape-cursor-reset). Without the u flag, `\p{`, `\u{` and
 *   `\k<a` are valid patterns, and the check read them by moving its cursor to the closing character,
 *   which is not there. Each input runs in a child process with a time limit, so a check that does not
 *   end fails this test instead of holding the test runner.
 *
 *   The keep-use half: a property escape with the u flag, a named group and its back reference, and
 *   the default detection rules keep the verdict they had.
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { unsafeRegexReason } from '../../src/services/classification/regex-safety.js';
import { DEFAULT_RULES } from '../../src/services/classification/defaults.js';

const MODULE = pathToFileURL(resolve(__dirname, '../../src/services/classification/regex-safety.ts')).href;

/** The check's answer for one pattern, from a child process stopped after `ms`. */
function answerWithin(pattern: string, flags: string, ms: number): { ended: boolean; answer: string | null } {
  const code = `import { unsafeRegexReason } from ${JSON.stringify(MODULE)};`
    + `process.stdout.write('\\nANSWER ' + JSON.stringify({ a: unsafeRegexReason(${JSON.stringify(pattern)}, ${JSON.stringify(flags)}) }));`;
  const r = spawnSync(process.execPath, ['--max-old-space-size=128', '--import', 'tsx', '--input-type=module', '-e', code], {
    timeout: ms, encoding: 'utf8', killSignal: 'SIGKILL',
  });
  // The node's logger writes to stdout too; the answer is the line the child marked.
  const line = (r.stdout ?? '').split('\n').find(l => l.startsWith('ANSWER '));
  if (r.status !== 0 || !line) return { ended: false, answer: null };
  return { ended: true, answer: (JSON.parse(line.slice(7)) as { a: string | null }).a };
}

describe('the regex safety check ends on an unterminated escape', () => {
  it.each(['\\p{', '\\P{L', '\\u{', '\\u{41', '\\k<a', '(?<n', '(?i'])('refuses %s without the u flag, and ends', (pattern) => {
    let valid = true;
    try { new RegExp(pattern, ''); } catch { valid = false; }
    const r = answerWithin(pattern, '', 20_000);
    expect(r.ended, `the check did not end on ${pattern}`).toBe(true);
    // A pattern the engine refuses is refused by the engine's own words; one it accepts is refused
    // because the check could not read it. Either way it is never run.
    expect(r.answer).toMatch(valid ? /could not be read/ : /not a valid regular expression/);
  }, 30_000);
});

describe('the verdicts that stay', () => {
  it('accepts a property escape with the u flag, and a named group with its back reference', () => {
    expect(unsafeRegexReason('\\p{L}+', 'u')).toBeNull();
    expect(unsafeRegexReason('(?<y>\\d{4})-\\k<y>')).toBeNull();
    expect(unsafeRegexReason('\\u{1F600}', 'u')).toBeNull();
  });

  it('accepts every regex rule of the default policy', () => {
    const rules = DEFAULT_RULES.filter(r => r.kind === 'regex');
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(unsafeRegexReason(r.pattern, r.flags ?? ''), r.pattern).toBeNull();
  });
});
