/**
 * @file scripts/check-test-types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Typechecks the test tree, which tsconfig.json leaves out, against a per-file error
 *   count that may only shrink.
 *
 *   WHY. `tsc -p tsconfig.json` excludes test/, so a function that gained a required parameter kept
 *   being called the old way from its tests, the missing argument emptied both sides of an
 *   assertion, and `expect([]).toEqual([])` passed. Nothing went red (2026-08-26,
 *   docs/pitfalls.md §26 until 2026-11-21). The whole tree had about 1 700 type errors in 425 files
 *   on the day this was written, so the gate holds each file to the count it has: a file may not
 *   gain an error, and a file with none may not get one.
 *
 *   COST. The program is src/ plus test/, and tsc needs more than its 4 GB default heap for it
 *   (measured 2026-11-21: out of memory at 4 GB, 48 s at 12 GB). It runs in `pnpm gate` when
 *   TypeScript under src/ or test/ changed, not in check:fast or the commit hook.
 * @usage
 *   cd aimeat && pnpm check:test-types            # gate: refuses a file above its count
 *   cd aimeat && pnpm check:test-types --update   # write the counts that FELL (never a rise)
 *   cd aimeat && pnpm check:test-types --seed     # rewrite the baseline from today (a decision)
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial, seeded from the tree of that day.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AIMEAT = process.cwd();
const BASELINE = join(AIMEAT, 'security', 'test-types-baseline.json');

interface Baseline { note: string; files: Record<string, number> }

/** File → error count, from tsc's plain output (`path(line,col): error TSnnnn: …`). */
export function countErrors(output: string): { counts: Map<string, number>; lines: Map<string, string[]> } {
    const counts = new Map<string, number>();
    const lines = new Map<string, string[]>();
    for (const line of output.split(/\r?\n/)) {
        const m = /^(.+?)\(\d+,\d+\): error TS\d+:/.exec(line);
        if (!m) continue;
        const file = m[1].split('\\').join('/');
        counts.set(file, (counts.get(file) ?? 0) + 1);
        lines.set(file, [...(lines.get(file) ?? []), line]);
    }
    return { counts, lines };
}

/** Files whose count rose above the baseline (a file the baseline does not name has 0), and files that fell. */
export function compare(counts: Map<string, number>, baseline: Record<string, number>): { rose: Array<[string, number, number]>; fell: Array<[string, number, number]> } {
    const rose: Array<[string, number, number]> = [];
    const fell: Array<[string, number, number]> = [];
    for (const [file, n] of counts) {
        const allowed = baseline[file] ?? 0;
        if (n > allowed) rose.push([file, allowed, n]);
    }
    for (const [file, allowed] of Object.entries(baseline)) {
        const n = counts.get(file) ?? 0;
        if (n < allowed) fell.push([file, allowed, n]);
    }
    return { rose: rose.sort(), fell: fell.sort() };
}

function runTsc(): string {
    mkdirSync(join(AIMEAT, 'node_modules', '.cache', 'tsc'), { recursive: true });
    const tsc = join(AIMEAT, 'node_modules', 'typescript', 'bin', 'tsc');
    const r = spawnSync(process.execPath, ['--max-old-space-size=12288', tsc, '--noEmit', '-p', 'tsconfig.tests.json', '--pretty', 'false',
        '--incremental', '--tsBuildInfoFile', join('node_modules', '.cache', 'tsc', 'tests.tsbuildinfo')],
    { cwd: AIMEAT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    if (r.status !== 0 && !/error TS\d+/.test(out)) {
        console.error(out.slice(-4000));
        console.error('\n✖ check:test-types: tsc stopped without a type error list (out of memory, or a config error above).');
        process.exit(1);
    }
    return out;
}

function main(): void {
    const update = process.argv.includes('--update');
    const seed = process.argv.includes('--seed');
    const { counts, lines } = countErrors(runTsc());
    const total = [...counts.values()].reduce((a, b) => a + b, 0);

    if (seed) {
        const files = Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
        writeFileSync(BASELINE, JSON.stringify({
            note: 'Type errors per file in the test tree (tsconfig.tests.json), seeded 2026-11-21. A file may not rise above its count, and a file not named here has 0. The counts only fall: pnpm check:test-types --update writes a fall. Each entry is DEBT: a test that calls code with the wrong types, which can make an assertion compare two empty results (docs/coding-guidelines/testing-requirements.md).',
            files,
        } satisfies Baseline, null, 2) + '\n');
        console.log(`  seeded ${counts.size} file(s), ${total} error(s) into security/test-types-baseline.json`);
        return;
    }

    const baseline: Baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline : { note: '', files: {} };
    const { rose, fell } = compare(counts, baseline.files);

    if (update && rose.length === 0 && fell.length > 0) {
        for (const [file, , n] of fell) {
            if (n === 0) delete baseline.files[file];
            else baseline.files[file] = n;
        }
        writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n');
        console.log(`  lowered ${fell.length} file(s) in security/test-types-baseline.json`);
        return;
    }

    console.log(`\n  test/ typecheck: ${total} error(s) in ${counts.size} file(s); baseline ${Object.values(baseline.files).reduce((a, b) => a + b, 0)} in ${Object.keys(baseline.files).length}`);
    if (fell.length > 0) console.log(`  ${fell.length} file(s) fell below their count: pnpm check:test-types --update writes it down.`);
    if (rose.length === 0) {
        console.log('  ✓ no test file has more type errors than its baseline\n');
        return;
    }
    for (const [file, allowed, n] of rose) {
        console.error(`\n  ${file}: ${n} error(s), baseline ${allowed}`);
        for (const l of (lines.get(file) ?? []).slice(0, 8)) console.error(`    ${l}`);
    }
    console.error(`\n✖ ${rose.length} file(s) gained a type error. A test that calls changed code the old way can`
        + '\n  pass by comparing two empty results; fix the call, never the baseline.\n');
    process.exit(1);
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
