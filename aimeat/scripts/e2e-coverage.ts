/**
 * @file scripts/e2e-coverage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which part of src/ an E2E sweep never executes. Runs the E2E runner with every
 *   node it starts under V8 coverage (test/coverage-preload.mjs does the per-process work), merges
 *   the hundreds of per-node snapshots one at a time so memory stays flat, reattaches the source
 *   maps, and has c8 write the HTML and JSON reports. On top of c8's per-file view it writes a
 *   per-directory table and the list of files never executed, which is what the question
 *   "where are we not covered" is actually asking; and it can compare the two backends, because
 *   the E2E sweep is supposed to execute the same code on both.
 *
 *   The measure is the RUNNING NODE: what the servers and connector daemons executed while the
 *   suites drove them. What a suite process imported is stopped at startup and not counted.
 * @structure parseArgs, run (kill leftovers, runner under coverage, then report), report (merge,
 *   c8, by-directory), compare, and the small path helpers.
 * @usage
 *   pnpm test:e2e:coverage --db=sqlite [--port=40271] [--workers=4] [--snapshot-ms=0] [runner args]
 *   pnpm test:e2e:coverage report --db=sqlite        # redo the report from an earlier run's raw files
 *   pnpm test:e2e:coverage report --db=union         # both backends' raw files as one measure
 *   pnpm test:e2e:coverage compare                    # sqlite versus postgres-kysely, file by file
 *   Output: aimeat/coverage-e2e/<db>/ (index.html, coverage-summary.json, by-directory.md) and
 *   aimeat/coverage-e2e/compare.md. All gitignored.
 * @version-history
 *   v1.0.0 — 2026-09-07 — Initial.
 */
import { mergeProcessCovs, type ProcessCov } from '@bcoe/v8-coverage';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT_ROOT = resolve(ROOT, 'coverage-e2e');
const PRELOAD = resolve(ROOT, 'test/coverage-preload.mjs');
const DBS = ['sqlite', 'postgres-kysely'] as const;
/** `union` is a report over both backends' raw files at once: what the E2E sweep reaches on either. */
type Db = typeof DBS[number] | 'union';

interface Args { command: 'run' | 'report' | 'compare'; db: Db; port: string; workers: string; snapshotMs: string; rest: string[] }

function parseArgs(argv: string[]): Args {
    const args: Args = { command: 'run', db: 'sqlite', port: '', workers: '4', snapshotMs: '0', rest: [] };
    for (const a of argv) {
        if (a === 'run' || a === 'report' || a === 'compare') args.command = a;
        else if (a.startsWith('--db=')) args.db = a.slice(5) as Db;
        else if (a.startsWith('--port=')) args.port = a.slice(7);
        else if (a.startsWith('--workers=')) args.workers = a.slice(10);
        else if (a.startsWith('--snapshot-ms=')) args.snapshotMs = a.slice(14);
        else args.rest.push(a);
    }
    const known: readonly string[] = args.command === 'report' ? [...DBS, 'union'] : DBS;
    if (!known.includes(args.db)) throw new Error(`--db must be one of ${known.join(', ')}, got "${args.db}"`);
    return args;
}

const outDir = (db: Db): string => join(OUT_ROOT, db);
const rawDir = (db: Db): string => join(outDir(db), 'raw');
const rawDirs = (db: Db): string[] => (db === 'union' ? DBS.map(rawDir) : [rawDir(db)]).filter(d => existsSync(d));

// ── Run ──

function run(args: Args): number {
    if (args.db === 'union') throw new Error('union is a report over existing runs; run one backend at a time.');
    const raw = rawDir(args.db);
    rmSync(outDir(args.db), { recursive: true, force: true });
    mkdirSync(raw, { recursive: true });

    const env: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_V8_COVERAGE: raw,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import ${pathToFileURL(PRELOAD).href}`.trim(),
        AIMEAT_COVERAGE_SRC: `${pathToFileURL(resolve(ROOT, 'src')).href}/`,
        AIMEAT_COVERAGE_SNAPSHOT_MS: args.snapshotMs,
    };
    if (args.port) { env.AIMEAT_PORT = args.port; env.AIMEAT_TEST_PORT = args.port; }

    console.log(`E2E coverage: ${args.db}, port ${args.port || '(from .env.test)'}, ${args.workers} workers, raw files in ${raw}`);
    spawnSync('node', ['--import', 'tsx', 'scripts/kill-test-servers.ts'], { env, stdio: 'inherit', cwd: ROOT });
    const runner = spawnSync('node', [
        `--env-file=.env.test.${args.db}`, '--import', 'tsx', 'test/run-e2e-ci.ts', `--workers=${args.workers}`, ...args.rest,
    ], { env, stdio: 'inherit', cwd: ROOT });
    console.log(`\nRunner exited with ${runner.status ?? 'signal ' + runner.signal}. Building the report.`);
    report(args.db);
    return runner.status ?? 1;
}

// ── Report ──

function loadSourceMaps(raws: string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const raw of raws) {
        const smcDir = join(raw, 'smc');
        if (!existsSync(smcDir)) continue;
        for (const f of readdirSync(smcDir)) {
            if (!f.endsWith('.json')) continue;
            const { url, entry } = JSON.parse(readFileSync(join(smcDir, f), 'utf8')) as { url: string; entry: unknown };
            out[url] ??= entry;
        }
    }
    return out;
}

/**
 * `cov-*.json` is what the preload reduced on the way out. `coverage-*.json` is Node's own write at
 * exit, from a node that ended without the sentinel (a boot failure, a shutdown of its own): the
 * same data, unreduced, so it is reduced here, and its source maps fill any the preload did not
 * reach. Measured on a full sweep: 348 of the first kind, 4 of the second.
 */
function mergeSnapshots(raws: string[], sourceMaps: Record<string, unknown>): { merged: ProcessCov; files: number } {
    const srcPrefix = `${pathToFileURL(resolve(ROOT, 'src')).href}/`;
    const files = raws.flatMap(raw => readdirSync(raw)
        .filter(f => (f.startsWith('cov-') || f.startsWith('coverage-')) && f.endsWith('.json'))
        .sort()
        .map(f => join(raw, f)));
    let merged: ProcessCov = { result: [] };
    for (const path of files) {
        const f = path.slice(path.lastIndexOf(sep) + 1);
        let cov: ProcessCov & { 'source-map-cache'?: Record<string, unknown> };
        try { cov = JSON.parse(readFileSync(path, 'utf8')) as typeof cov; } catch { continue; }
        if (f.startsWith('coverage-')) {
            cov.result = cov.result.filter(s => s.url.startsWith(srcPrefix));
            for (const [url, entry] of Object.entries(cov['source-map-cache'] ?? {})) {
                if (url.startsWith(srcPrefix) && !(url in sourceMaps)) sourceMaps[url] = entry;
            }
        }
        merged = mergeProcessCovs([merged, { result: cov.result }]);
    }
    return { merged, files: files.length };
}

function report(db: Db): void {
    const raws = rawDirs(db);
    const out = outDir(db);
    if (raws.length === 0) throw new Error(`No raw coverage under ${rawDir(db)}. Run the sweep first.`);
    const sourceMaps = loadSourceMaps(raws);
    const { merged, files } = mergeSnapshots(raws, sourceMaps);
    const mergedDir = join(out, 'merged');
    rmSync(mergedDir, { recursive: true, force: true });
    mkdirSync(mergedDir, { recursive: true });
    writeFileSync(join(mergedDir, 'coverage-merged.json'), JSON.stringify({ result: merged.result, 'source-map-cache': sourceMaps }));
    console.log(`Merged ${files} node snapshots into ${merged.result.length} scripts (${Object.keys(sourceMaps).length} source maps).`);

    const c8 = spawnSync(process.execPath, [
        resolve(ROOT, 'node_modules/c8/bin/c8.js'), 'report', `--temp-directory=${mergedDir}`, `--reports-dir=${out}`,
        '--reporter=html', '--reporter=json-summary', '--reporter=text-summary',
        '--src=src', '--include=src/**/*.ts', '--exclude=src/**/*.d.ts', '--exclude=**/dist/**', '--exclude=src/**/__tests__/**', '--all',
    ], { stdio: 'inherit', cwd: ROOT });
    if (c8.status !== 0) throw new Error(`c8 report exited with ${c8.status}`);
    byDirectory(db);
    console.log(`\nReport: ${join(out, 'index.html')}\nBy directory: ${join(out, 'by-directory.md')}`);
}

/**
 * Lines and functions, side by side. A line count flatters: every import, every top-level constant
 * and every function DEFINITION executes when the module loads, so a file nobody called can still
 * show forty percent of its lines covered. A function is covered only when something called it,
 * which is the measure a gap is read from.
 */
interface Stat { total: number; covered: number; fnTotal: number; fnCovered: number }
type Summary = Record<string, { lines: { total: number; covered: number }; functions: { total: number; covered: number } }>;

const empty = (): Stat => ({ total: 0, covered: 0, fnTotal: 0, fnCovered: 0 });

function readSummary(db: Db): Map<string, Stat> {
    const path = join(outDir(db), 'coverage-summary.json');
    if (!existsSync(path)) throw new Error(`No ${path}. Run the report for ${db} first.`);
    const json = JSON.parse(readFileSync(path, 'utf8')) as Summary;
    const files = new Map<string, Stat>();
    for (const [key, value] of Object.entries(json)) {
        if (key === 'total') continue;
        files.set(relative(ROOT, key).split(sep).join('/'), {
            total: value.lines.total, covered: value.lines.covered,
            fnTotal: value.functions.total, fnCovered: value.functions.covered,
        });
    }
    return files;
}

const pct = (covered: number, total: number): string => total === 0 ? '-' : `${((100 * covered) / total).toFixed(1)}%`;

function rollup(files: Map<string, Stat>, depth: number): Map<string, Stat> {
    const out = new Map<string, Stat>();
    for (const [file, s] of files) {
        const parts = file.split('/');
        const dir = parts.slice(0, Math.min(depth, parts.length - 1)).join('/');
        const acc = out.get(dir) ?? empty();
        acc.total += s.total;
        acc.covered += s.covered;
        acc.fnTotal += s.fnTotal;
        acc.fnCovered += s.fnCovered;
        out.set(dir, acc);
    }
    return out;
}

function table(rows: Map<string, Stat>, label: string): string {
    const sorted = [...rows.entries()].sort((a, b) => (b[1].total - b[1].covered) - (a[1].total - a[1].covered));
    const lines = [`| ${label} | lines | uncovered | lines % | functions | uncalled | functions % |`, '|---|---:|---:|---:|---:|---:|---:|'];
    for (const [dir, s] of sorted) {
        lines.push(`| ${dir} | ${s.total} | ${s.total - s.covered} | ${pct(s.covered, s.total)} | ${s.fnTotal} | ${s.fnTotal - s.fnCovered} | ${pct(s.fnCovered, s.fnTotal)} |`);
    }
    return lines.join('\n');
}

function byDirectory(db: Db): void {
    const files = readSummary(db);
    const total = rollup(files, 0).get('') ?? empty();
    const never = [...files.entries()].filter(([, s]) => s.covered === 0).map(([f]) => f).sort();
    const low = [...files.entries()].filter(([, s]) => s.covered > 0 && s.covered / s.total < 0.25)
        .sort((a, b) => (b[1].total - b[1].covered) - (a[1].total - a[1].covered));
    const md = [
        `# E2E coverage of src/ on ${db}`,
        '',
        `Generated ${new Date().toISOString()}. Lines: ${total.covered} of ${total.total} (${pct(total.covered, total.total)}). Functions: ${total.fnCovered} of ${total.fnTotal} (${pct(total.fnCovered, total.fnTotal)}). Files: ${files.size}, never executed: ${never.length}.`,
        '',
        '## By top-level directory',
        '',
        table(rollup(files, 2), 'directory'),
        '',
        '## By second-level directory',
        '',
        table(rollup(files, 3), 'directory'),
        '',
        `## Files never executed (${never.length})`,
        '',
        ...never.map(f => `- ${f} (${files.get(f)!.total} lines)`),
        '',
        `## Files under 25% (${low.length})`,
        '',
        ...low.map(([f, s]) => `- ${f}: ${s.covered}/${s.total} lines (${pct(s.covered, s.total)}), ${s.fnCovered}/${s.fnTotal} functions`),
        '',
    ].join('\n');
    writeFileSync(join(outDir(db), 'by-directory.md'), md);
    console.log(`\n${table(rollup(files, 2), 'directory')}`);
}

// ── Compare ──

function compare(): void {
    const a = readSummary('sqlite');
    const b = readSummary('postgres-kysely');
    const rows: string[] = [];
    let differing = 0;
    for (const file of [...new Set([...a.keys(), ...b.keys()])].sort()) {
        const sa = a.get(file) ?? empty();
        const sb = b.get(file) ?? empty();
        const pa = sa.total ? (100 * sa.covered) / sa.total : 0;
        const pb = sb.total ? (100 * sb.covered) / sb.total : 0;
        if (Math.abs(pa - pb) < 1) continue;
        differing++;
        rows.push(`| ${file} | ${pct(sa.covered, sa.total)} | ${pct(sb.covered, sb.total)} | ${(pb - pa).toFixed(1)} | ${sa.fnCovered}/${sa.fnTotal} | ${sb.fnCovered}/${sb.fnTotal} |`);
    }
    const ta = rollup(a, 0).get('') ?? empty();
    const tb = rollup(b, 0).get('') ?? empty();
    const md = [
        '# E2E coverage: sqlite versus postgres-kysely',
        '',
        `Generated ${new Date().toISOString()}. Lines: sqlite ${pct(ta.covered, ta.total)} (${ta.covered}/${ta.total}), postgres-kysely ${pct(tb.covered, tb.total)} (${tb.covered}/${tb.total}). Functions: sqlite ${pct(ta.fnCovered, ta.fnTotal)}, postgres-kysely ${pct(tb.fnCovered, tb.fnTotal)}. Files differing by a line-percentage point or more: ${differing}.`,
        '',
        '| file | sqlite lines | postgres-kysely lines | delta | sqlite functions | postgres-kysely functions |', '|---|---:|---:|---:|---:|---:|', ...rows, '',
    ].join('\n');
    mkdirSync(OUT_ROOT, { recursive: true });
    writeFileSync(join(OUT_ROOT, 'compare.md'), md);
    console.log(md);
}

const args = parseArgs(process.argv.slice(2));
if (args.command === 'run') process.exit(run(args));
else if (args.command === 'report') report(args.db);
else compare();
