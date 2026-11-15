/**
 * @file scripts/lib/e2e-run-results.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One E2E run's results as a file: written by the runner (`--results-out=<file>`),
 *   read by scripts/e2e-merge-shards.ts, which turns the shards of a nightly sweep back into one
 *   result per backend, and by scripts/e2e-nightly.ts, which rewrites test/e2e-suite-times.json.
 *
 *   WHY A FILE. A sharded sweep runs on four GitHub machines. Every reader of the nightly (the issue
 *   job, Lifecycle Central's ci_sweep_ingest, `pnpm nightly:preflight`) reads one job per backend
 *   named `sweep (<backend>)`, so the shards hand their results to that job as artifacts, and it
 *   writes the annotations the readers know (scripts/lib/e2e-github-report.ts).
 * @structure RunResults · writeRunResults() · readRunResults()
 * @version-history
 *   v1.0.0 -- 2026-11-15 -- Initial: the results of a shard of the nightly sweep.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface RunSuite {
    name: string; passed: number; failed: number; skipped: number; total: number; time: string;
    exitCode: number; lane: number; cycleMs: number; anonymous: string;
    red: boolean; note: string; failures?: string[];
}

export interface RunResults {
    dbType: string;
    /** `i/N` for a shard of a sweep, null for a whole run. */
    shard: string | null;
    wallMs: number;
    suites: RunSuite[];
}

export function writeRunResults(file: string, results: RunResults): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(results, null, 1) + '\n', 'utf-8');
}

/** A results file, checked for the fields the readers use; throws naming the file otherwise. */
export function readRunResults(file: string): RunResults {
    const r = JSON.parse(readFileSync(file, 'utf-8')) as RunResults;
    if (typeof r.dbType !== 'string' || !Array.isArray(r.suites)) throw new Error(`${file} is not an E2E results file`);
    return r;
}
