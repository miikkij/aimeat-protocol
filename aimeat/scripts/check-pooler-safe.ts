/**
 * @file scripts/check-pooler-safe.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's PostgreSQL use stays possible behind a connection pooler in transaction
 *   mode (PgBouncer and the managed services built on it), which hands each transaction, not each
 *   session, a server connection. Two things do not survive that, and this gate refuses both in src/:
 *     - a SESSION advisory lock (`pg_advisory_lock(`, `pg_try_advisory_lock(`, their `_shared` forms
 *       and `pg_advisory_unlock`): taken through a pooler it stays on a server connection the next
 *       client gets, and the unlock goes to another one. Use `pg_advisory_xact_lock` inside a
 *       transaction, or a lease record (services/process-lease.ts). Allowed nowhere;
 *     - a `LISTEN` statement: it holds a session to receive. The event bus listens on one client of
 *       its own outside the pool (storage/providers/postgres-kysely/bus-wire.ts), and that file is
 *       the one place listed.
 *
 *   WHY. Stage 3 of the high-availability plan (codebase analysis 2026-11-03) puts a pooler and a
 *   failover in front of the database, and its two code constraints are these. The boot lock had
 *   been a session lock (migrate.ts, until 2026-11-04); a new one would come back unseen.
 *
 *   WHAT IT READS. Every .ts, .js, .mjs and .sql file under src/, comment lines left out. A finding
 *   is a line that calls one of the session lock functions, or a string that begins with LISTEN.
 *   WHAT IT CANNOT SEE: a statement built from pieces at run time, and a session-level `SET` (the
 *   request statement limit in pool-limits.ts sends one only when an operator sets it).
 * @structure SESSION_LOCK · LISTEN_STATEMENT · LISTEN_ALLOWED · poolerFindings() · main()
 * @usage cd aimeat && pnpm check:pooler-safe
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item HA stage 3).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A call of a session-level advisory lock function. The transaction-scoped forms (`_xact_`) do not match. */
export const SESSION_LOCK = /\bpg_(?:try_)?advisory_(?:lock|unlock)(?:_shared|_all)?\s*\(/i;

/** A SQL string that begins with LISTEN (in quotes or a template literal). */
export const LISTEN_STATEMENT = /['"`]\s*LISTEN\s/i;

/** The one file allowed a LISTEN, with the reason. The list may only shrink. */
export const LISTEN_ALLOWED: Record<string, string> = {
    'src/storage/providers/postgres-kysely/bus-wire.ts': 'The event bus between the node\'s processes: one pg.Client of its own, never a pooled connection, that LISTENs on aimeat_bus and is reconnected when it drops.',
};

export interface PoolerFinding { file: string; line: number; kind: 'session-lock' | 'listen'; text: string }

const isComment = (line: string): boolean => /^\s*(?:\*|\/\/|\/\*|--)/.test(line);

/** Every finding in `files`, LISTEN in an allowed file included (the caller sorts them). */
export function poolerFindings(files: { path: string; text: string }[]): PoolerFinding[] {
    const out: PoolerFinding[] = [];
    for (const { path, text } of files) {
        text.split(/\r?\n/).forEach((line, i) => {
            if (isComment(line)) return;
            if (SESSION_LOCK.test(line)) out.push({ file: path, line: i + 1, kind: 'session-lock', text: line.trim().slice(0, 110) });
            if (LISTEN_STATEMENT.test(line)) out.push({ file: path, line: i + 1, kind: 'listen', text: line.trim().slice(0, 110) });
        });
    }
    return out;
}

function sourceFiles(aimeat: string, dir: string): { path: string; text: string }[] {
    const out: { path: string; text: string }[] = [];
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { out.push(...sourceFiles(aimeat, full)); continue; }
        if (!/\.(?:ts|js|mjs|sql)$/.test(name)) continue;
        out.push({ path: relative(aimeat, full).replace(/\\/g, '/'), text: readFileSync(full, 'utf8') });
    }
    return out;
}

function main(): void {
    const aimeat = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
    const findings = poolerFindings(sourceFiles(aimeat, join(aimeat, 'src')));
    const locks = findings.filter(f => f.kind === 'session-lock');
    const listens = findings.filter(f => f.kind === 'listen');
    const freshListens = listens.filter(f => LISTEN_ALLOWED[f.file] === undefined);
    const stale = Object.keys(LISTEN_ALLOWED).filter(k => !listens.some(f => f.file === k));

    console.log('');
    console.log('  PostgreSQL behind a connection pooler');
    console.log('  ' + '─'.repeat(62));
    console.log(`  session advisory locks       ${String(locks.length).padStart(3)}   (allowed nowhere)`);
    console.log(`  LISTEN in a listed file      ${String(listens.length - freshListens.length).padStart(3)}   (may only fall)`);
    console.log(`  LISTEN elsewhere             ${String(freshListens.length).padStart(3)}`);
    console.log('');
    for (const f of [...locks, ...freshListens]) console.log(`    ${f.file}:${f.line}  ${f.text}`);
    if (stale.length) {
        console.log('  Listed and no longer LISTENing, so remove from LISTEN_ALLOWED:');
        for (const k of stale) console.log(`    ${k}`);
    }
    if (locks.length || freshListens.length) {
        console.error(`\n✖ ${locks.length + freshListens.length} statement(s) hold a database session, which a connection pooler in transaction mode does not keep. Take pg_advisory_xact_lock inside a transaction, or a lease record (services/process-lease.ts), instead of a session lock; LISTEN only on a client of its own outside the pool, listed in LISTEN_ALLOWED in scripts/check-pooler-safe.ts with the reason.`);
        process.exit(1);
    }
    console.log('  ✓ nothing in src/ holds a database session that a pooler would lose');
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
