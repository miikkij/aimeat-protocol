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
 * @structure RunResults · FlakyNote · flakyLine() · writeRunResults() · readRunResults()
 * @version-history
 *   v1.1.0 -- 2026-11-19 -- `flaky` on a suite that was red in the run and green alone (--retry-red).
 *   v1.0.0 -- 2026-11-15 -- Initial: the results of a shard of the nightly sweep.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface RunSuite {
    name: string; passed: number; failed: number; skipped: number; total: number; time: string;
    exitCode: number; lane: number; cycleMs: number; anonymous: string;
    red: boolean; note: string; failures?: string[];
    /** The suite was red in the run and green when run again alone (`--retry-red`). */
    flaky?: FlakyNote;
}

/** What the first run said about a suite that then passed alone (test/run-e2e-retry.ts). */
export interface FlakyNote { passed: number; total: number; note: string; failures: string[] }

/** The line `pnpm ready` collects: one per suite that failed in the run and passed alone. */
export function flakyLine(dbType: string, name: string, f: FlakyNote): string {
    const why = f.failures[0] ?? f.note ?? '';
    return `[e2e-flaky] ${dbType} ${name}: red in the run (${f.passed}/${f.total}${why ? `: ${why.replace(/\s+/g, ' ').slice(0, 200)}` : ''}), green alone`;
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
