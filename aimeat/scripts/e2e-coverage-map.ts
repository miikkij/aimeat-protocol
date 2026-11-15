/**
 * @file scripts/e2e-coverage-map.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Builds the map of which E2E suite executes which function of src/ (scripts/lib/
 *   e2e-coverage-map.ts says why and what the map holds), from a runner run made with
 *   AIMEAT_COVERAGE_PER_SUITE=<dir>: one directory of reduced V8 snapshots per suite, and one shared
 *   smc/ directory of source maps (test/coverage-preload.mjs writes both).
 *
 *   The nightly runs this per coverage shard (`build`) and once over the shards (`merge`), and
 *   publishes the result as the artifact e2e-coverage-map; `pnpm e2e:nightly coverage` fetches it
 *   for `pnpm gate`.
 * @usage
 *   tsx scripts/e2e-coverage-map.ts build --raw=<dir> --out=<file> [--commit=<sha>]
 *   tsx scripts/e2e-coverage-map.ts merge --out=<file> <part.json>...
 * @version-history
 *   v1.0.0 -- 2026-11-15 -- Initial (report of 2026-11-15, 4.2.6).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { functionsOf, mergeMaps, type CoverageMap, type FnEntry, type ScriptCoverage, type SourceMapEntry } from './lib/e2e-coverage-map.js';

const ROOT = resolve(process.cwd(), '..');
const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);

function headCommit(): string {
    try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; }
}

/** `file:///…/aimeat/src/x.ts` → `aimeat/src/x.ts`; null for anything outside the repository. */
function repoPath(url: string): string | null {
    let abs: string;
    try { abs = url.startsWith('file:') ? fileURLToPath(url) : url; } catch { return null; }
    const rel = relative(ROOT, abs).replace(/\\/g, '/');
    return rel.startsWith('aimeat/src/') ? rel : null;
}

function build(): void {
    const raw = opt('raw');
    const out = opt('out');
    if (!raw || !out) throw new Error('build needs --raw=<dir> and --out=<file>');
    const maps = new Map<string, SourceMapEntry>();
    const smc = join(raw, 'smc');
    if (existsSync(smc)) {
        for (const f of readdirSync(smc)) {
            try {
                const { url, entry } = JSON.parse(readFileSync(join(smc, f), 'utf8')) as { url: string; entry: SourceMapEntry };
                maps.set(url, entry);
            } catch { /* a half-written map: the script it belongs to maps nothing */ }
        }
    }
    const suites: string[] = [];
    const files = new Map<string, Map<string, Set<number>>>();
    for (const suite of readdirSync(raw).sort()) {
        const dir = join(raw, suite);
        // smc/ holds the shared source maps and stop/ the preload's stop sentinels; neither is a suite.
        if (suite === 'smc' || suite === 'stop' || !statSync(dir).isDirectory()) continue;
        const id = suites.length;
        suites.push(suite);
        for (const f of readdirSync(dir).filter(n => n.startsWith('cov-') && n.endsWith('.json'))) {
            let result: ScriptCoverage[];
            try { result = (JSON.parse(readFileSync(join(dir, f), 'utf8')) as { result: ScriptCoverage[] }).result ?? []; } catch { continue; }
            for (const script of result) {
                const path = repoPath(script.url);
                if (!path) continue;
                const byRange = files.get(path) ?? new Map<string, Set<number>>();
                for (const [a, b] of functionsOf(script, maps.get(script.url) ?? null)) {
                    const key = `${a}:${b}`;
                    byRange.set(key, (byRange.get(key) ?? new Set<number>()).add(id));
                }
                files.set(path, byRange);
            }
        }
    }
    const map: CoverageMap = { commit: opt('commit') ?? headCommit(), built: new Date().toISOString(), suites, files: {} };
    for (const [path, byRange] of [...files].sort((x, y) => x[0].localeCompare(y[0]))) {
        if (byRange.size === 0) continue; // loaded, no function of it ran: the map does not know it
        map.files[path] =[...byRange].map(([k, set]): FnEntry => {
            const [a, b] = k.split(':').map(Number);
            return [a, b, [...set].sort((x, y) => x - y)];
        }).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    }
    writeFileSync(out, JSON.stringify(map) + '\n', 'utf8');
    const fnCount = Object.values(map.files).reduce((n, e) => n + e.length, 0);
    console.log(`coverage map: ${suites.length} suites, ${Object.keys(map.files).length} files, ${fnCount} executed functions → ${out}`);
}

function merge(): void {
    const out = opt('out');
    const parts = argv.filter(a => !a.startsWith('--') && a !== 'merge');
    if (!out || parts.length === 0) throw new Error('merge needs --out=<file> and the part files');
    const map = mergeMaps(parts.map(p => JSON.parse(readFileSync(p, 'utf8')) as CoverageMap));
    writeFileSync(out, JSON.stringify(map) + '\n', 'utf8');
    console.log(`coverage map: ${map.suites.length} suites from ${parts.length} part(s), ${Object.keys(map.files).length} files → ${out}`);
}

if (argv[0] === 'build') build();
else if (argv[0] === 'merge') merge();
else {
    console.error('usage: e2e-coverage-map.ts build --raw=<dir> --out=<file> | merge --out=<file> <parts...>');
    process.exit(2);
}
