/**
 * @file test/unit/glob-matcher-linear.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A key glob is matched in time bounded by the glob and key lengths, and answers exactly
 *   what the anchored RegExp it replaced answered (secaudit2026oct26,
 *   signal-eval.ts:globToRegExp:catastrophic-backtracking).
 *
 *   The attack case: a glob of many stars and a literal the key lacks. The RegExp tried every split
 *   of the key among the stars (8 stars on 36 characters took about 3 s on the node's event loop).
 *   The usage case: every glob shape saved workflows, recipes and offers use matches as before,
 *   compared one by one with the old RegExp.
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect } from 'vitest';
import { globToRegExp } from '../../src/services/workflow/signal-eval.js';

/** The converter as it was before 2026-10-27, the reference for the answers. */
function oldGlob(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

describe('globToRegExp', () => {
  it('answers a many-star glob against a long key in bounded time', () => {
    const t = Date.now();
    expect(globToRegExp(`${'*'.repeat(8)}X`).test('a'.repeat(36))).toBe(false);
    expect(globToRegExp(`${'*'.repeat(60)}X`).test('a'.repeat(400))).toBe(false);
    expect(globToRegExp(`a*${'*a'.repeat(100)}X`).test('a'.repeat(400))).toBe(false);
    expect(Date.now() - t).toBeLessThan(250);
  });

  it('usage: answers what the old RegExp answered for the globs workflows, recipes and offers use', () => {
    const globs = [
      'notes.*', 'feedback.stats.*', '*', '', 'exact.key', 'a*b', '*.out', 'org-*', 'ws-*',
      'news.*.draft', '**', 'a**b', '*a*', 'x.y+z(1)', '[a]*', 'q?.*', '$^.*', 'a\\b*', 'line*end',
    ];
    const keys = [
      'notes.trip', 'notes.', 'notes', 'feedback.stats.2026', 'feedback.stats', 'exact.key', 'exact.keys',
      'ab', 'axxb', 'axxbc', 'step.out', '.out', 'org-123', 'ws-mtemu9rieuk', 'news.today.draft',
      'news..draft', 'x.y+z(1)', '[a]', '[a]bc', 'q?.x', 'q.x', '$^.k', 'a\\bc', '', 'a', 'b',
      'line\nend', 'line end', 'line\rend', 'line end', 'x\ny', 'a\nb',
    ];
    for (const g of globs) {
      const now = globToRegExp(g);
      const was = oldGlob(g);
      for (const k of keys) expect(`${g} ~ ${JSON.stringify(k)}: ${now.test(k)}`).toBe(`${g} ~ ${JSON.stringify(k)}: ${was.test(k)}`);
    }
  });
});
