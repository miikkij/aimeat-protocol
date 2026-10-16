/**
 * @file scripts/check-own-node-backend.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A suite that starts a node of its own runs it on the run's backend
 *   (test/helpers/own-node-db.ts), or is listed here with the reason it cannot.
 *
 *   WHY. 43 suites started their own node on SQLite whatever the run named, so the PostgreSQL run
 *   and the blocking guards-postgres job executed SQLite a second time for them and reported a
 *   PostgreSQL result (QA audit P1-02, P7-04, F18-02, S6-10, D4-02). The fix moved them to the
 *   helper; this gate keeps the next suite from pinning SQLite again, and counts what is left.
 *
 *   WHAT IT READS. Every test/*.ts and test/helpers/*.ts. A file is a finding when it names a SQLite
 *   backend for a node (`'--db', 'sqlite'`, `AIMEAT_STORAGE: 'sqlite'` or `'memory'`,
 *   `storageProvider = 'memory'`, …) and never names postgres-kysely. WHAT IT CANNOT SEE: a file
 *   that names postgres-kysely is taken to choose between the two, so a second node pinned to
 *   SQLite beside a following first one passes; and a node started with no backend named at all
 *   falls to SQLite in memory unseen. Both are the auditors' own counting rule.
 * @structure SQLITE_NODE · ALLOWED · ownNodeFindings() · main()
 * @usage
 *   cd aimeat && pnpm check:own-node-backend
 * @version-history
 *   2026-10-16 — Initial (QA audit P1-02, W11).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The shapes that name a SQLite backend for a node. */
export const SQLITE_NODE = /'--db',\s*'sqlite'|AIMEAT_STORAGE['"]?\s*[:=]\s*['"](?:sqlite|memory)['"]|AIMEAT_DB['"]?\s*[:=]\s*['"]sqlite['"]|storageProvider\s*[:=]\s*['"](?:sqlite|memory)['"]/;

/**
 * The files that still start a SQLite node of their own, each with the reason. The count may only
 * fall: a file leaves this list by following the run's backend.
 */
export const ALLOWED: Record<string, string> = {
    'test/helpers/node-entry.ts': 'Not a node: the usage line in the header names the SQLite flags as an example.',
    'test/e2e-connect-cli.ts': 'Not a node: `aimeat config import --db sqlite --db-path <file>` is the CLI command under test, writing a SQLite file the suite then reads; the flag is the subject.',
};

export interface OwnNodeFinding { file: string; line: number; text: string }

/** One finding per file that names a SQLite node and never postgres-kysely: its first such line. */
export function ownNodeFindings(files: { path: string; text: string }[]): OwnNodeFinding[] {
    const out: OwnNodeFinding[] = [];
    for (const { path, text } of files) {
        if (text.includes('postgres-kysely')) continue;
        const lines = text.split(/\r?\n/);
        const i = lines.findIndex(l => SQLITE_NODE.test(l));
        if (i >= 0) out.push({ file: path, line: i + 1, text: lines[i].trim().slice(0, 110) });
    }
    return out;
}

function testFiles(aimeat: string): { path: string; text: string }[] {
    const out: { path: string; text: string }[] = [];
    for (const dir of ['test', 'test/helpers']) {
        for (const name of readdirSync(join(aimeat, dir))) {
            if (!name.endsWith('.ts')) continue;
            out.push({ path: `${dir}/${name}`, text: readFileSync(join(aimeat, dir, name), 'utf8') });
        }
    }
    return out;
}

function main(): void {
    const aimeat = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
    const findings = ownNodeFindings(testFiles(aimeat));
    const fresh = findings.filter(f => ALLOWED[f.file] === undefined);
    const stale = Object.keys(ALLOWED).filter(k => !findings.some(f => f.file === k));

    console.log('');
    console.log('  Own nodes on the run\'s backend');
    console.log('  ' + '─'.repeat(62));
    console.log(`  files pinning a SQLite node  ${String(findings.length).padStart(3)}`);
    console.log(`  listed with a reason         ${String(findings.length - fresh.length).padStart(3)}   (may only fall)`);
    console.log(`  NEW, not listed              ${String(fresh.length).padStart(3)}`);
    console.log('');
    for (const f of fresh) console.log(`    ${f.file}:${f.line}  ${f.text}`);
    if (stale.length) {
        console.log('  Listed and now following the run\'s backend, so remove from ALLOWED:');
        for (const k of stale) console.log(`    ${k}`);
    }
    if (fresh.length) {
        console.error(`\n✖ ${fresh.length} file(s) start a node of their own on SQLite whatever backend the run names, so a PostgreSQL run tests SQLite for them. Use ownNodeDb() from test/helpers/own-node-db.ts, or add the file to ALLOWED in scripts/check-own-node-backend.ts with the reason it cannot follow.`);
        process.exit(1);
    }
    console.log('  ✓ no new own node pinned to SQLite');
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
