/**
 * @file test/unit/prune-scripts-mode.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The name of a prune command decides what it does. `telemetry:stats` and
 *   `consent-audit:stats` only read: a delete flag is refused with exit 2 and no row goes. The
 *   `:prune` commands without `--older-than` or `--clear` print their usage and exit 2 instead of
 *   printing statistics as if they had done their job. A correct call does what it did before: the
 *   stats commands print the counts, and `--older-than=N --force` deletes exactly the rows older
 *   than N days. Each case runs the real script as a child process against a throwaway SQLite file,
 *   with the mode word the package.json script passes, so the wiring is proven with the behaviour.
 * @structure package.json wiring · telemetry-prune.ts · consent-audit-prune.ts
 * @usage pnpm exec vitest run test/unit/prune-scripts-mode.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-13 — Initial (structure programme 2026-11, unit 6: one name, one action).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const AIMEAT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const SCRIPTS = (JSON.parse(readFileSync(join(AIMEAT, 'package.json'), 'utf-8')) as { scripts: Record<string, string> }).scripts;

const DAY = 24 * 60 * 60 * 1000;
const iso = (daysAgo: number): string => new Date(Date.now() - daysAgo * DAY).toISOString();

let dir = '';
let dbPath = '';

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aimeat-prune-mode-'));
    dbPath = join(dir, 'prune.db');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE telemetry_events (id TEXT PRIMARY KEY, createdAt TEXT)');
    db.exec('CREATE TABLE consent_audit (id TEXT PRIMARY KEY, action TEXT, allowed INTEGER, timestamp TEXT)');
    const t = db.prepare('INSERT INTO telemetry_events (id, createdAt) VALUES (?, ?)');
    t.run('old-1', iso(30)); t.run('old-2', iso(20)); t.run('new-1', iso(1));
    const c = db.prepare('INSERT INTO consent_audit (id, action, allowed, timestamp) VALUES (?, ?, ?, ?)');
    c.run('old-1', 'read', 0, iso(200)); c.run('new-1', 'write', 1, iso(2));
    db.close();
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function rows(table: string): number {
    const db = new Database(dbPath, { readonly: true });
    try { return (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c; } finally { db.close(); }
}

/** The arguments a package.json script hands its file, after the file name. */
function argsOf(script: string, file: string): string[] {
    const command = SCRIPTS[script];
    if (!command) throw new Error(`aimeat/package.json has no script "${script}"`);
    const at = command.indexOf(file);
    if (at < 0) throw new Error(`"${script}" does not run ${file}: ${command}`);
    return command.slice(at + file.length).trim().split(/\s+/).filter(Boolean);
}

/** Runs the script as `pnpm <script> <extra>` would, minus the operator's .env. */
function run(script: string, file: string, extra: string[]): { status: number | null; out: string } {
    const r = spawnSync(process.execPath, ['--import', 'tsx', join('scripts', file), ...argsOf(script, file), ...extra], {
        cwd: AIMEAT,
        encoding: 'utf-8',
        env: { ...process.env, AIMEAT_STORAGE: 'sqlite', AIMEAT_SQLITE_PATH: dbPath },
        input: '',
        timeout: 60_000,
    });
    return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

const CASES = [
    { name: 'telemetry', file: 'telemetry-prune.ts', table: 'telemetry_events', before: 3, olderThan: 7, after: 1 },
    { name: 'consent-audit', file: 'consent-audit-prune.ts', table: 'consent_audit', before: 2, olderThan: 90, after: 1 },
] as const;

for (const k of CASES) {
    describe(`${k.name}:stats and ${k.name}:prune`, () => {
        it(`${k.name}:stats prints the counts and deletes nothing`, () => {
            const r = run(`${k.name}:stats`, k.file, []);
            expect(r.status, r.out).toBe(0);
            expect(r.out).toContain(`Rows:           ${k.before}`);
            expect(rows(k.table)).toBe(k.before);
        }, 60_000);

        it(`${k.name}:stats refuses --clear and --older-than, and deletes nothing`, () => {
            for (const flag of [['--clear', '--force'], [`--older-than=${k.olderThan}`, '--force']]) {
                const r = run(`${k.name}:stats`, k.file, flag);
                expect(r.status, r.out).toBe(2);
                expect(r.out).toContain(`${k.name}:prune`);
                expect(rows(k.table)).toBe(k.before);
            }
        }, 60_000);

        it(`${k.name}:prune with no flag prints its usage, exits 2 and deletes nothing`, () => {
            const r = run(`${k.name}:prune`, k.file, []);
            expect(r.status, r.out).toBe(2);
            expect(r.out).toContain('--older-than=');
            expect(r.out).toContain('--clear');
            expect(r.out).not.toContain('Rows:');
            expect(rows(k.table)).toBe(k.before);
        }, 60_000);

        it(`${k.name}:prune --older-than=${k.olderThan} --force deletes the older rows only`, () => {
            const r = run(`${k.name}:prune`, k.file, [`--older-than=${k.olderThan}`, '--force']);
            expect(r.status, r.out).toBe(0);
            expect(r.out).toContain(`Deleted ${k.before - k.after} row(s).`);
            expect(rows(k.table)).toBe(k.after);
        }, 60_000);

        it(`${k.name}:prune --clear --force deletes every row`, () => {
            const r = run(`${k.name}:prune`, k.file, ['--clear', '--force']);
            expect(r.status, r.out).toBe(0);
            expect(rows(k.table)).toBe(0);
        }, 60_000);
    });
}
