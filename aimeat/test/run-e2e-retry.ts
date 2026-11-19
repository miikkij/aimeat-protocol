/**
 * @file test/run-e2e-retry.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `--retry-red`: a suite that was red in the run is run once more, alone, on a node of its
 *   own and a database emptied for it (runLane empties it before the first suite too). Red again, the
 *   first result stands and the run is red. Green alone, the rerun's result replaces the first one,
 *   carries `flaky` with what the first run said, and the runner prints it with the `[e2e-flaky]` mark,
 *   which `pnpm ready` collects into its report.
 *
 *   WHY. On 2026-11-19 one branch took four pnpm ready runs of about 40 minutes each; two of them were
 *   stopped by suites that failed for timing and passed alone (two suites' far-side servers on one
 *   port on neighbouring CI lanes; twelve concurrent patches on PostgreSQL). Rerunning the whole sweep
 *   costs 40 minutes and may meet another such suite; rerunning the one suite costs seconds.
 *
 *   ONLY WHERE ASKED. pnpm ready dispatches the full sweep with the input `retry_red`; the nightly does
 *   not, so a suite that fails for timing stays red there, where it is seen and fixed. More than
 *   MAX_RETRIES red suites is a broken change, not timing, and nothing is retried.
 * @structure MAX_RETRIES · retryRed()
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (wish-pnpm-ready-slow-checks-locally-first-a-failed-suite-rerun-al).
 */
import { basename } from 'node:path';
import { runLane, type LaneOptions, type SuiteResult } from './run-e2e-lane.js';
import type { RunnerTarget } from './run-e2e-server.js';

import type { FlakyNote } from '../scripts/lib/e2e-run-results.js';

/** Past this many red suites the run is red for a reason of its own, and nothing is retried. */
export const MAX_RETRIES = 5;

/**
 * Run each red suite once more, alone, on `targets` (lane 0's, whose run has finished), one after
 * another. Returns the results with each suite that passed alone replaced by its rerun.
 */
export async function retryRed(
    results: SuiteResult[],
    suitePaths: string[],
    verdictOf: (r: SuiteResult) => { red: boolean; note: string },
    targets: RunnerTarget[],
    opts: LaneOptions,
): Promise<SuiteResult[]> {
    const red = results.filter(r => verdictOf(r).red);
    if (red.length === 0) return results;
    if (red.length > MAX_RETRIES) {
        console.log(`\n[retry] ${red.length} suites are red, more than ${MAX_RETRIES}: that is the change, not timing, so none is run again.`);
        return results;
    }
    const pathOf = new Map(suitePaths.map(p => [basename(p, '.ts'), p]));
    const out = [...results];
    for (const first of red) {
        const path = pathOf.get(first.name);
        if (!path) continue;
        console.log(`\n[retry] ${first.name} was red (${first.passed}/${first.total}${verdictOf(first).note ? `, ${verdictOf(first).note}` : ''}); running it once more, alone.`);
        let again: SuiteResult | undefined;
        try {
            [again] = await runLane(0, targets, [path], false, opts);
        } catch (e) {
            console.log(`[retry] ${first.name} could not run again: ${(e as Error).message.split('\n')[0]}`);
            continue;
        }
        if (!again || verdictOf(again).red) {
            console.log(`[retry] ${first.name} is red alone too: the first result stands.`);
            continue;
        }
        const flaky: FlakyNote = { passed: first.passed, total: first.total, note: verdictOf(first).note, failures: first.failures ?? [] };
        out[out.indexOf(first)] = { ...again, lane: first.lane, flaky };
        console.log(`[retry] ${first.name} passed alone (${again.passed}/${again.total}): read as timing, named in the report.`);
    }
    return out;
}
