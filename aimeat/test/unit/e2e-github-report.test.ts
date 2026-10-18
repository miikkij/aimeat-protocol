/**
 * @file test/unit/e2e-github-report.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The red suites of an E2E run reach GitHub's public surfaces: the annotations name every
 *   red suite and carry the first failed tests, a message cannot end its workflow command early, and
 *   the job summary lists each red suite (scripts/lib/e2e-github-report.ts).
 * @version-history
 *   v1.1.0 -- 2026-10-18 -- The suites past the eighth carry their first failure in the list annotation.
 *   v1.0.0 -- 2026-10-16 -- Initial: the nightly sweep names its red suites in public.
 */
import { describe, expect, it } from 'vitest';
import { failedTestLines, githubAnnotations, githubSummary, type RedSuite } from '../../scripts/lib/e2e-github-report.js';

const red = (name: string, over: Partial<RedSuite> = {}): RedSuite => ({ name, passed: 3, total: 4, note: '', failures: [`❌ ${name} 1a: expected 200, got 403`], ...over });

describe('failedTestLines', () => {
    it('keeps the ❌ lines, at most five, trimmed', () => {
        const out = ['  ✅ one', '  ❌ two: boom', 'noise', ...Array.from({ length: 7 }, (_, i) => `   ❌ more ${i}`)].join('\n');
        const lines = failedTestLines(out);
        expect(lines).toHaveLength(5);
        expect(lines[0]).toBe('❌ two: boom');
    });
    it('is empty for an output with no failed test', () => {
        expect(failedTestLines('  ✅ a\n1 passed, 0 failed')).toEqual([]);
    });
});

describe('githubAnnotations', () => {
    it('says nothing for a green run', () => {
        expect(githubAnnotations([], 'sqlite')).toEqual([]);
    });
    it('names every red suite first, then one annotation per suite with its failed tests', () => {
        const lines = githubAnnotations([red('e2e-a'), red('e2e-b', { note: 'TIMED OUT: the runner ended it at its time limit', failures: [] })], 'sqlite');
        expect(lines[0]).toBe('::error title=2 red E2E suite(s) on sqlite::e2e-a, e2e-b');
        expect(lines[1]).toBe('::error title=E2E e2e-a on sqlite::3/4 passed%0A❌ e2e-a 1a: expected 200, got 403');
        expect(lines[2]).toContain('TIMED OUT');
        expect(lines).toHaveLength(3);
    });
    it('stays inside GitHub\'s ten error annotations a step: one list and at most eight suites', () => {
        const lines = githubAnnotations(Array.from({ length: 20 }, (_, i) => red(`e2e-${i}`)), 'postgres-kysely');
        expect(lines).toHaveLength(9);
        expect(lines[0]).toContain('e2e-19');
    });
    it('gives the suites past the eighth their first failure in the list annotation, one line each, after the names', () => {
        const many = Array.from({ length: 10 }, (_, i) => red(`e2e-${i}`, i === 9 ? { failures: [], note: 'TIMED OUT' } : {}));
        const lines = githubAnnotations(many, 'sqlite');
        expect(lines).toHaveLength(9);
        // Lifecycle Central's ci_sweep_ingest reads this shape anonymously: the first line names every
        // red suite, each later line is "<suite>: <passed>/<total> passed[; note][ · first failure]".
        const message = lines[0].split('::').slice(2).join('::').split('%0A');
        expect(message[0]).toBe(many.map(r => r.name).join(', '));
        expect(message.slice(1)).toEqual([
            'e2e-8: 3/4 passed · ❌ e2e-8 1a: expected 200, got 403',
            'e2e-9: 3/4 passed; TIMED OUT',
        ]);
        expect(lines.slice(1).some(l => l.includes('E2E e2e-8 on'))).toBe(false);
    });
    it('keeps the list annotation to the names alone when every red suite has an annotation of its own', () => {
        const [first] = githubAnnotations(Array.from({ length: 8 }, (_, i) => red(`e2e-${i}`)), 'sqlite');
        expect(first).not.toContain('%0A');
    });
    it('escapes what would end the command early: newline and % in the message, : and , in the title', () => {
        const [, line] = githubAnnotations([red('e2e-x', { failures: ['❌ 100% done\r\nnext'] })], 'a:b,c');
        expect(line.startsWith('::error title=E2E e2e-x on a%3Ab%2Cc::')).toBe(true);
        expect(line).toContain('100%25 done%0D%0Anext');
        expect(line.split('\n')).toHaveLength(1);
    });
});

describe('githubSummary', () => {
    it('lists every red suite, beyond the annotation limit', () => {
        const md = githubSummary(Array.from({ length: 12 }, (_, i) => red(`e2e-${i}`)), 'sqlite', { passed: 30, failed: 12, total: 42 });
        expect(md).toContain('### E2E on sqlite: 30 passed, 12 failed out of 42');
        expect(md).toContain('| e2e-11 | 3/4 |');
        expect(md.split('\n').filter(l => l.startsWith('| e2e-'))).toHaveLength(12);
    });
    it('says green for a green run', () => {
        expect(githubSummary([], 'sqlite', { passed: 5, failed: 0, total: 5 })).toContain('Every suite is green.');
    });
});
