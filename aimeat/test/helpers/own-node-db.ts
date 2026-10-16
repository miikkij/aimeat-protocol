/**
 * @file test/helpers/own-node-db.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The database for a node a suite starts itself, on the run's backend.
 *
 *   WHY. A suite that starts its own node used to pick SQLite for it whatever backend the run named
 *   (a file, or 'memory', which the storage factory opens as SQLite in memory), so the PostgreSQL
 *   run of 43 suites, 15 of them in the guard tier, executed SQLite a second time and was reported
 *   as a PostgreSQL result (QA audit P1-02, P7-04, F18-02, S6-10, D4-02). This helper is the one
 *   answer: on a PostgreSQL run each own node gets a database of its own beside the run's database
 *   (`<run database>_o_<tag>`), emptied before use; on a SQLite run it gets a SQLite file of its
 *   own (or SQLite in memory, for an in-process node that asked for one).
 *
 *   WHICH BACKEND. Read once, when this module is first imported, from AIMEAT_DB (the env file) and
 *   then AIMEAT_STORAGE (the runner's pin), and DATABASE_URL (the runner's pin, which is the lane's
 *   own database). Read at import because several suites set process.env.AIMEAT_STORAGE for the node
 *   they start in-process, and that must not change the answer.
 *
 *   ONE DATABASE PER TAG. Two nodes on one Postgres database would share every table, so a suite
 *   with two nodes asks for two tags. The name is derived from the run's database, which is already
 *   unique per session and per lane, so two lanes or two sessions never meet.
 *
 *   scripts/check-own-node-backend.ts counts the suites that still name a SQLite backend for a node
 *   of their own, and the count may only fall.
 * @structure ownNodeDb(tag, opts) → OwnNodeDb; runBackend()
 * @usage
 *   const db = await ownNodeDb('core-jobs');
 *   spawn('node', [...nodeEntryArgs(), 'start', ...db.args], { env: { ...process.env, ...db.env, … } });
 *   Object.assign(config, db.config);              // an in-process node, after loadConfig()
 * @version-history
 *   2026-10-16 — Initial (QA audit P1-02, P7-04, F18-02, S6-10, D4-02).
 */
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RUN_BACKEND = process.env.AIMEAT_DB ?? process.env.AIMEAT_STORAGE ?? 'sqlite';
const RUN_URL = process.env.DATABASE_URL ?? process.env.AIMEAT_DB_URL ?? '';

export interface OwnNodeDb {
    provider: 'sqlite' | 'postgres-kysely';
    /** For `aimeat start`: `--db sqlite --db-path <file>` or `--db postgres-kysely --db-url <url>`. */
    args: string[];
    /** The environment that agrees with `args`, for a spawned node or for loadConfig() in-process. */
    env: Record<string, string>;
    /** The config fields for an in-process node: Object.assign(config, db.config) after loadConfig(). */
    config: { storageProvider: 'sqlite' | 'postgres-kysely'; sqlitePath: string; dbUrl: string | null };
    /** The SQLite file, or '' on PostgreSQL. ':memory:' when the caller asked for memory. */
    sqlitePath: string;
    /** The PostgreSQL URL, or '' on SQLite. */
    dbUrl: string;
}

/** The backend the run names: 'postgres-kysely' only when it also has a URL to use. */
export function runBackend(): 'sqlite' | 'postgres-kysely' {
    return RUN_BACKEND === 'postgres-kysely' && RUN_URL ? 'postgres-kysely' : 'sqlite';
}

/**
 * A database for one own node. `tag` names the node within the suite (`core-jobs`, `peer-a`).
 * `opts.memory` keeps SQLite in memory on a SQLite run, for an in-process node that had 'memory'.
 * `opts.sqlitePath` names the SQLite file on a SQLite run, for a suite that opens it itself.
 */
export async function ownNodeDb(tag: string, opts: { memory?: boolean; sqlitePath?: string } = {}): Promise<OwnNodeDb> {
    if (runBackend() === 'postgres-kysely') {
        const dbUrl = siblingUrl(RUN_URL, tag);
        await freshDatabase(RUN_URL, dbUrl);
        return {
            provider: 'postgres-kysely',
            args: ['--db', 'postgres-kysely', '--db-url', dbUrl],
            env: { AIMEAT_STORAGE: 'postgres-kysely', AIMEAT_DB: 'postgres-kysely', DATABASE_URL: dbUrl, AIMEAT_SQLITE_PATH: '' },
            config: { storageProvider: 'postgres-kysely', sqlitePath: '', dbUrl },
            sqlitePath: '',
            dbUrl,
        };
    }
    const sqlitePath = opts.memory ? ':memory:'
        : opts.sqlitePath ?? join(mkdtempSync(join(tmpdir(), `aimeat-own-${safe(tag)}-`)), `${safe(tag)}.db`);
    return {
        provider: 'sqlite',
        args: ['--db', 'sqlite', '--db-path', sqlitePath],
        env: { AIMEAT_STORAGE: 'sqlite', AIMEAT_DB: 'sqlite', AIMEAT_SQLITE_PATH: sqlitePath, AIMEAT_DB_PATH: sqlitePath, DATABASE_URL: '' },
        config: { storageProvider: 'sqlite', sqlitePath, dbUrl: null },
        sqlitePath,
        dbUrl: '',
    };
}

function safe(tag: string): string {
    return tag.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'node';
}

/** `<run database>_o_<tag>`, inside PostgreSQL's 63-character name limit. */
function siblingUrl(runUrl: string, tag: string): string {
    const u = new URL(runUrl);
    const base = u.pathname.replace(/^\//, '');
    const short = `${safe(tag).slice(0, 14)}_${createHash('sha1').update(tag).digest('hex').slice(0, 6)}`;
    u.pathname = `/${base.slice(0, 63 - 3 - short.length)}_o_${short}`;
    return u.toString();
}

/**
 * Create the database when it is missing and empty it when it is not, keeping the migration ledger
 * so the node does not run every migration again. The same reset the runner applies to its own
 * database between suites (run-e2e-server.ts resetKyselyPgTables).
 */
async function freshDatabase(runUrl: string, dbUrl: string): Promise<void> {
    const pg = (await import('pg')).default;
    const name = new URL(dbUrl).pathname.replace(/^\//, '');
    const admin = new pg.Client(runUrl);
    await admin.connect();
    try {
        const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
        // A database name cannot be a bind parameter; it comes from siblingUrl's own character set.
        if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
    } catch (error) {
        throw new Error(`Could not create the own-node database ${name}: ${(error as Error).message}. Grant CREATEDB to the role in DATABASE_URL, or create the database by hand.`, { cause: error });
    } finally {
        await admin.end();
    }
    const client = new pg.Client(dbUrl);
    await client.connect();
    try {
        await client.query(`DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_kysely_migrations') LOOP
    EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
  END LOOP;
END $$;`);
    } finally {
        await client.end();
    }
}
