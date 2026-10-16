/**
 * @file test/unit/e2e-results.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the E2E runner's table says about a suite, proven without a two-hour sweep
 *   (QA audit 2026-10-16, W12):
 *     - a skipped test has its own column, a suite with no test case is red, a suite that skips
 *       itself whole is "skipped" (red in the guard tier) (P1-04, F7b-01, F14a-03);
 *     - a suite past its time limit is ended with the processes it started and is TIMED OUT (P1-06);
 *     - a lane whose node cannot be restarted reports its suites NOT RUN instead of ending the run
 *       (P1-09).
 * @version-history
 *   v1.0.0 -- 2026-10-16 -- Initial (QA audit W12).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, formatRow, parseResults } from '../../scripts/lib/e2e-results.js';
import { runLane, runTest } from '../run-e2e-lane.js';
import type { RunnerTarget } from '../run-e2e-server.js';

const scratch = mkdtempSync(join(tmpdir(), 'aimeat-e2e-results-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const facts = (over: Partial<Parameters<typeof classify>[0]>) => ({ passed: 0, failed: 0, skipped: 0, total: 0, exitCode: 0, ...over });

describe('parseResults reads a suite\'s numbers', () => {
    it('reads the usual result line', () => {
        expect(parseResults('  ✅ a\n\n12 passed, 0 failed out of 12\n')).toEqual({ passed: 12, failed: 0, skipped: 0, total: 12, resultLine: true });
    });
    it('reads the skipped count, and the total is what ran', () => {
        expect(parseResults('10 passed, 1 failed, 3 skipped out of 14')).toMatchObject({ passed: 10, failed: 1, skipped: 3, total: 11 });
        expect(parseResults('x402 TESTNET E2E: 0 passed, 0 failed, 1 skipped')).toMatchObject({ passed: 0, failed: 0, skipped: 1, total: 0 });
    });
    it('counts ✅ ❌ ⏭ lines when the suite died before its result line', () => {
        expect(parseResults('  ✅ one\n  ⏭ two: no browser\n  ❌ three: boom\n')).toEqual({ passed: 1, failed: 1, skipped: 1, total: 2, resultLine: false });
    });
});

describe('classify gives each kind of run its own verdict', () => {
    it('a green suite is green', () => {
        expect(classify(facts({ passed: 5, total: 5 }), { guard: true })).toMatchObject({ status: 'passed', red: false, mark: '✓' });
    });
    it('a suite that exits 0 having run no test is red (it used to be a tick with 0 0 0)', () => {
        expect(classify(facts({}), { guard: false })).toMatchObject({ status: 'empty', red: true });
    });
    it('a suite that skips itself whole is skipped, and red in the guard tier', () => {
        expect(classify(facts({ skipped: 1 }), { guard: false })).toMatchObject({ status: 'skipped', red: false, mark: '-' });
        expect(classify(facts({ skipped: 1 }), { guard: true })).toMatchObject({ status: 'skipped', red: true });
    });
    it('a skipped test inside a guard suite is red; outside the tier it is counted, not red', () => {
        expect(classify(facts({ passed: 3, skipped: 2, total: 3 }), { guard: true })).toMatchObject({ status: 'failed', red: true });
        expect(classify(facts({ passed: 3, skipped: 2, total: 3 }), { guard: false })).toMatchObject({ status: 'passed', red: false });
    });
    it('timed out, node died, not run and did not run are red with their own notes', () => {
        expect(classify(facts({ passed: 2, total: 2, exitCode: 124, timedOut: true }), { guard: false })).toMatchObject({ status: 'timed-out', red: true });
        expect(classify(facts({ passed: 2, total: 2, nodeDied: 'exit 1' }), { guard: false })).toMatchObject({ status: 'node-died', red: true });
        expect(classify(facts({ exitCode: 1, notRun: 'no node' }), { guard: false })).toMatchObject({ status: 'not-run', red: true });
        expect(classify(facts({ exitCode: 1 }), { guard: false })).toMatchObject({ status: 'did-not-run', red: true });
    });
    it('the row prints the skipped column', () => {
        const r = { ...facts({ passed: 3, skipped: 2, total: 3 }), time: '1.00s', anonymous: 'on', lane: 0 };
        expect(formatRow('e2e-example', r, classify(r, { guard: false }), false)).toMatch(/^✓ e2e-example\s+3\s+0\s+2\s+3\s+1\.00s/);
    });
});

const target = (over: Partial<RunnerTarget> = {}): RunnerTarget => ({
    port: '1', baseUrl: 'http://127.0.0.1:1', dbType: 'sqlite', dbPath: join(scratch, 'none.db'), dbUrl: '', external: true, ...over,
} as RunnerTarget);

describe('a suite has a time limit', { timeout: 60_000 }, () => {
    it('a suite that never ends is ended with what it started, and reported as timed out', async () => {
        const suite = join(scratch, 'e2e-hangs.ts');
        // The suite starts a child of its own that would also run forever.
        writeFileSync(suite, `import { spawn } from 'node:child_process';\nspawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });\nconsole.log('  ✅ first test');\nsetInterval(() => {}, 1000);\n`);
        process.env.AIMEAT_E2E_SUITE_TIMEOUT_MS = '2000';
        try {
            const t0 = Date.now();
            const r = await runTest(suite, 'e2e-hangs', target(), false);
            expect(r.timedOut).toBe(true);
            expect(r.exitCode).toBe(124);
            expect(r.output).toContain('reached its time limit');
            expect(Date.now() - t0).toBeLessThan(30_000);
        } finally {
            delete process.env.AIMEAT_E2E_SUITE_TIMEOUT_MS;
        }
    });
});

describe('a lane whose node cannot be restarted does not end the run', { timeout: 60_000 }, () => {
    it('reports this suite and the rest of the lane NOT RUN, with the reason, and resolves', async () => {
        // A Postgres URL nothing answers: the database clean before the first suite fails at once.
        const dead = target({ external: false, dbType: 'postgres-kysely', dbUrl: 'postgresql://nobody:nothing@127.0.0.1:1/none' });
        const results = await runLane(0, dead, ['test/e2e-a.ts', 'test/e2e-b.ts'], false, { session: 'unit', isGuard: () => false });
        expect(results.map(r => r.name)).toEqual(['e2e-a', 'e2e-b']);
        for (const r of results) {
            expect(r.notRun).toMatch(/could not be restarted/);
            expect(classify(r, { guard: false })).toMatchObject({ status: 'not-run', red: true });
        }
    });
});
