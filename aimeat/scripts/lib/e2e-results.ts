/**
 * @file scripts/lib/e2e-results.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What one E2E suite's run means: its numbers read from its output, and the verdict
 *   the runner's table prints for it. Pure functions, so the verdicts are unit-tested
 *   (test/unit/e2e-results.test.ts) and not only seen in a two-hour sweep.
 *
 *   WHAT WAS WRONG (QA audit 2026-10-16). The runner called a suite red only on a failed count or a
 *   non-zero exit, so:
 *     - a suite that exited 0 having run no test got a tick and "0 0 0"; e2e-x402-testnet did that
 *       in every sweep (P1-04, F14a-03);
 *     - a skipped test was counted as passed, and the table had no place to say otherwise (F7b-01);
 *     - a suite that never ended held its lane with no limit (P1-06), and a lane whose restart failed
 *       took the whole run's summary with it (P1-09).
 *   The verdicts below give each of those a row of its own.
 *
 *   THE RESULT LINE. A suite ends with `N passed, M failed` (anything around it), and may say
 *   `K skipped` in the same line. A suite that skips itself whole prints `0 passed, 0 failed,
 *   1 skipped` and its reason above. Lines starting with ✅, ❌ and ⏭ are counted when the result line
 *   never came (a crash before the end).
 * @structure parseResults() · classify() · formatRow()
 * @version-history
 *   v1.0.0 -- 2026-10-16 -- Initial (QA audit W12: P1-04, P1-06, P1-07, P1-09, F7b-01, F14a-03).
 */

export interface ParsedResult {
    passed: number;
    failed: number;
    skipped: number;
    /** Tests that ran: passed + failed. */
    total: number;
    /** The suite printed its result line (and did not only emit ✅/❌ lines). */
    resultLine: boolean;
}

/** Read a suite's numbers from what it printed. */
export function parseResults(output: string): ParsedResult {
    const lines = output.split('\n');
    const resultLine = lines.filter(l => /\d+ passed.*\d+ failed/.test(l)).pop();
    if (resultLine) {
        const m = resultLine.match(/(\d+) passed.*?(\d+) failed/);
        if (m) {
            const passed = +m[1];
            const failed = +m[2];
            const skippedMatch = resultLine.match(/(\d+) skipped/);
            const skipped = skippedMatch ? +skippedMatch[1] : 0;
            const totalMatch = resultLine.match(/(?:out of |of |total.*?)(\d+)/);
            let total = totalMatch ? +totalMatch[1] : passed + failed;
            // "out of N" that counts the skipped ones too: the total column is what RAN.
            if (skipped > 0 && total === passed + failed + skipped) total = passed + failed;
            return { passed, failed, skipped, total, resultLine: true };
        }
    }
    let passed = 0, failed = 0, skipped = 0;
    for (const line of lines) {
        if (/^\s*✅/.test(line)) passed++;
        if (/^\s*❌/.test(line)) failed++;
        if (/^\s*⏭/.test(line)) skipped++;
    }
    return { passed, failed, skipped, total: passed + failed, resultLine: false };
}

export type SuiteStatus = 'passed' | 'failed' | 'skipped' | 'empty' | 'did-not-run' | 'timed-out' | 'not-run' | 'node-died';

export interface SuiteFacts {
    passed: number; failed: number; skipped: number; total: number; exitCode: number;
    /** The runner ended the suite at its time limit. */
    timedOut?: boolean;
    /** The suite never started: its lane could not restart the node (the reason). */
    notRun?: string;
    /** The lane's node exited while the suite ran (its exit code or signal). */
    nodeDied?: string;
}

export interface Verdict { status: SuiteStatus; red: boolean; mark: string; note: string }

/**
 * The table's verdict for one suite. `guard` is true for a guard-tier suite, where a skipped test is
 * red: the tier's promise is that each of its refusals ran (F7b-01, F7b-02).
 */
export function classify(r: SuiteFacts, opts: { guard: boolean }): Verdict {
    if (r.notRun) return { status: 'not-run', red: true, mark: '!', note: `NOT RUN: ${r.notRun}` };
    if (r.timedOut) return { status: 'timed-out', red: true, mark: '✗', note: 'TIMED OUT: the runner ended it at its time limit' };
    if (r.nodeDied) return { status: 'node-died', red: true, mark: '✗', note: `NODE DIED during the suite (${r.nodeDied})` };
    if (r.exitCode !== 0 && r.total === 0 && r.skipped === 0) return { status: 'did-not-run', red: true, mark: '!', note: `DID NOT RUN (exit ${r.exitCode})` };
    if (r.failed > 0 || r.exitCode !== 0) return { status: 'failed', red: true, mark: '✗', note: r.failed > 0 ? '' : `exit ${r.exitCode}` };
    if (r.total === 0 && r.skipped === 0) return { status: 'empty', red: true, mark: '!', note: 'NO TEST: exited 0 having reported no test case' };
    if (r.total === 0) return { status: 'skipped', red: opts.guard, mark: opts.guard ? '✗' : '-', note: opts.guard ? 'SKIPPED WHOLE in the guard tier' : 'SKIPPED WHOLE' };
    if (r.skipped > 0 && opts.guard) return { status: 'failed', red: true, mark: '✗', note: `${r.skipped} test(s) SKIPPED in the guard tier` };
    return { status: 'passed', red: false, mark: '✓', note: '' };
}

/** The table's header and one row, so the columns stay aligned in one place. */
export function formatHeader(lanes: boolean): string {
    return 'Suite'.padEnd(30) + 'Passed'.padEnd(8) + 'Failed'.padEnd(8) + 'Skipped'.padEnd(9) + 'Total'.padEnd(8) + 'Time'.padEnd(10) + 'Anon'.padEnd(10) + (lanes ? 'Lane' : '');
}

export function formatRow(name: string, r: SuiteFacts & { time: string; anonymous: string; lane: number }, v: Verdict, lanes: boolean): string {
    return `${v.mark} ${name.padEnd(28)}${String(r.passed).padEnd(8)}${String(r.failed).padEnd(8)}${String(r.skipped).padEnd(9)}${String(r.total).padEnd(8)}${r.time.padEnd(10)}${r.anonymous.padEnd(10)}${lanes ? String(r.lane) : ''}${v.note ? `  ${v.note}` : ''}`;
}
