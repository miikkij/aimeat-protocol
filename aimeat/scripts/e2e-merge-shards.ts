/**
 * @file scripts/e2e-merge-shards.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shards of a nightly sweep, merged into the one result per backend that every
 *   reader of the nightly expects. Run by the `sweep (<backend>)` job of .github/workflows/e2e-full.yml
 *   after the `shard (<backend>, i)` jobs; it prints the summary, writes the same `::error`
 *   annotations and job summary the runner writes for a whole run (scripts/lib/e2e-github-report.ts,
 *   whose shapes Lifecycle Central's ci_sweep_ingest reads), and exits 1 when a suite is red or a
 *   shard did not report.
 *
 *   A MISSING SHARD IS RED. A shard that crashed, timed out or never uploaded its file ran an unknown
 *   set of suites; reading the others as the whole would turn "did not run" into green. The merge
 *   therefore names every expected shard that has no file, and the job fails.
 * @usage tsx scripts/e2e-merge-shards.ts --dir=<folder with results-*.json> --db=<backend> --shards=<N> [--times-out=<file>]
 * @version-history
 *   v1.0.0 -- 2026-11-15 -- Initial: the nightly sweep runs in four shards per backend.
 */
import { appendFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { githubAnnotations, githubSummary } from './lib/e2e-github-report.js';
import { readRunResults, type RunSuite } from './lib/e2e-run-results.js';

function arg(name: string): string | undefined {
    return process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const dir = arg('dir');
const db = arg('db');
const expected = Number(arg('shards') ?? '0');
if (!dir || !db || !Number.isInteger(expected) || expected < 1) {
    console.error('usage: tsx scripts/e2e-merge-shards.ts --dir=<folder> --db=<backend> --shards=<N> [--times-out=<file>]');
    process.exit(2);
}

const files = existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).filter(f => /results-.*\.json$/.test(f)) : [];
const seen = new Set<string>();
const suites: RunSuite[] = [];
for (const f of files) {
    const r = readRunResults(join(dir, f));
    if (r.dbType !== db) continue;
    if (r.shard) seen.add(r.shard.split('/')[0]);
    suites.push(...r.suites);
}
const missing = Array.from({ length: expected }, (_, i) => String(i + 1)).filter(i => !seen.has(i));

const red = suites.filter(s => s.red);
const passed = suites.reduce((a, s) => a + s.passed, 0);
const failed = suites.reduce((a, s) => a + s.failed, 0);
const total = suites.reduce((a, s) => a + s.total, 0);
console.log(`E2E on ${db}: ${suites.length} suites from ${seen.size} of ${expected} shards; ${passed} passed, ${failed} failed out of ${total}; ${red.length} red suite(s).`);
for (const s of red) console.log(`  ✗ ${s.name}  ${s.passed}/${s.total}${s.note ? `  ${s.note}` : ''}`);

// A shard with no file is reported as one red row per shard, in the same shapes, so the issue and
// Lifecycle Central name it rather than read a part of the sweep as all of it.
const reported = [
    ...red.map(s => ({ name: s.name, passed: s.passed, total: s.total, note: s.note, failures: s.failures ?? [] })),
    ...missing.map(i => ({ name: `shard-${i}-of-${expected}`, passed: 0, total: 0, note: `DID NOT REPORT: shard ${i} of ${expected} wrote no results file`, failures: [] })),
];
if (missing.length) console.log(`  ! shards with no results: ${missing.join(', ')}`);
if (process.env.GITHUB_ACTIONS === 'true') {
    for (const line of githubAnnotations(reported, db)) console.log(line);
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) appendFileSync(summary, githubSummary(reported, db, { passed, failed, total }));
}

const timesOut = arg('times-out');
if (timesOut) {
    const times = Object.fromEntries(suites.filter(s => !s.red).map(s => [s.name, Math.round(parseFloat(s.time) * 10) / 10]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    writeFileSync(timesOut, JSON.stringify({ dbType: db, times }, null, 1) + '\n', 'utf-8');
}

process.exit(reported.length > 0 ? 1 : 0);
