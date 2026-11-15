/**
 * @file scripts/e2e-nightly.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the nightly sweep publishes for this machine to use, fetched with the gh CLI:
 *   the per-suite coverage map `pnpm gate` selects suites from, and the measured suite times the
 *   runner balances lanes and shards with.
 *
 *     coverage  the artifact e2e-coverage-map of the newest completed nightly on main that has one,
 *               into coverage-e2e/coverage-map.json (gitignored); `pnpm gate` calls this when its
 *               copy is missing or older than a day
 *     times     the artifacts e2e-times-sqlite and e2e-times-postgres-kysely of the newest nightly,
 *               merged into test/e2e-suite-times.json (committed; a suite missing from the night,
 *               because it was red, keeps its old time)
 *
 *   GitHub serves a public repository's artifacts to a signed-in reader only, so this needs `gh auth
 *   login`; without it the command says so and exits 1, and the gate goes on without the map.
 * @usage pnpm e2e:nightly coverage [--quiet] · pnpm e2e:nightly times
 * @version-history
 *   v1.0.0 -- 2026-11-15 -- Initial (report of 2026-11-15, 4.2.6).
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const AIMEAT = process.cwd();
const QUIET = process.argv.includes('--quiet');
const COVERAGE_MAP_FILE =resolve(AIMEAT, 'coverage-e2e', 'coverage-map.json');
const TIMES_FILE = resolve(AIMEAT, 'test', 'e2e-suite-times.json');

function gh(args: string[]): string {
    return execFileSync('gh', args, { cwd: AIMEAT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The newest completed nightly runs on main, newest first. */
function nightlyRuns(): Array<{ databaseId: number; headSha: string; createdAt: string }> {
    return JSON.parse(gh(['run', 'list', '--workflow', 'e2e-full.yml', '--branch', 'main', '--status', 'completed', '--limit', '6', '--json', 'databaseId,headSha,createdAt'])) as Array<{ databaseId: number; headSha: string; createdAt: string }>;
}

/** Download the named artifacts of one run into a fresh directory; null when the run has none of them. */
function download(run: number, names: string[]): string | null {
    const dir = mkdtempSync(join(tmpdir(), 'aimeat-nightly-'));
    try {
        gh(['run', 'download', String(run), ...names.flatMap(n => ['-n', n]), '-D', dir]);
        return dir;
    } catch {
        return null;
    }
}

function findFile(dir: string, name: string): string | null {
    for (const entry of readdirSync(dir, { recursive: true }).map(String)) {
        if (entry.replace(/\\/g, '/').endsWith(name)) return join(dir, entry);
    }
    return null;
}

function coverage(): number {
    for (const run of nightlyRuns()) {
        const dir = download(run.databaseId, ['e2e-coverage-map']);
        const file = dir && findFile(dir, 'coverage-map.json');
        if (!file) continue;
        mkdirSync(resolve(AIMEAT, 'coverage-e2e'), { recursive: true });
        copyFileSync(file, COVERAGE_MAP_FILE);
        if (!QUIET) console.log(`coverage map of nightly ${run.databaseId} (${run.headSha.slice(0, 9)}, ${run.createdAt}) → ${COVERAGE_MAP_FILE}`);
        return 0;
    }
    console.error('No completed nightly on main has an e2e-coverage-map artifact yet.');
    return 1;
}

function times(): number {
    for (const run of nightlyRuns()) {
        const dir = download(run.databaseId, ['e2e-times-sqlite', 'e2e-times-postgres-kysely']);
        if (!dir) continue;
        const doc = existsSync(TIMES_FILE) ? JSON.parse(readFileSync(TIMES_FILE, 'utf8')) as Record<string, unknown> : {};
        let n = 0;
        for (const db of ['sqlite', 'postgres-kysely']) {
            const f = findFile(dir, `e2e-times-${db}.json`);
            if (!f) continue;
            const night = (JSON.parse(readFileSync(f, 'utf8')) as { times: Record<string, number> }).times;
            const old = (doc[db] ?? {}) as Record<string, number>;
            doc[db] = Object.fromEntries(Object.entries({ ...old, ...night }).sort((a, b) => a[0].localeCompare(b[0])));
            n += Object.keys(night).length;
        }
        if (n === 0) continue;
        doc.source = { run: run.databaseId, commit: run.headSha.slice(0, 9), note: 'Seconds per suite from the nightly sweep; the runner balances lanes and shards with them. pnpm e2e:nightly times rewrites this file from the latest nightly.' };
        const ordered = { source: doc.source, sqlite: doc.sqlite, 'postgres-kysely': doc['postgres-kysely'] };
        writeFileSync(TIMES_FILE, JSON.stringify(ordered, null, 1) + '\n', 'utf8');
        console.log(`suite times of nightly ${run.databaseId} (${n} measurements) → ${TIMES_FILE}`);
        return 0;
    }
    console.error('No completed nightly on main has e2e-times artifacts yet.');
    return 1;
}

const command = process.argv[2];
try {
    process.exit(command === 'coverage' ? coverage() : command === 'times' ? times() : (console.error('usage: pnpm e2e:nightly coverage|times'), 2));
} catch (e) {
    const msg = (e as Error).message.split('\n')[0];
    console.error(`Could not read the nightly from GitHub (${msg}). The gh CLI must be installed and signed in: gh auth login.`);
    process.exit(1);
}
