/**
 * @file src/storage/providers/postgres-kysely/migrate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Migration runner for the Postgres+Kysely backend. Applies the ordered `migrations/*.sql`
 *   files exactly once each, tracked in a `_kysely_migrations` table, so the schema is materialised on
 *   first boot with no Prisma involvement. DDL is run through the raw `pg` pool (simple-query protocol)
 *   because a migration file holds MANY statements, which Kysely's parametrised (extended) path rejects;
 *   each file is applied atomically in its own transaction.
 *
 *   A FILE CAN BE SUPERSEDED. A migration file on main never changes (security/migration-hashes.json
 *   and `pnpm check:migration-hashes` hold it). When one must not run any more, a later file replaces
 *   it and SUPERSEDED names the pair. On a database that has not applied the old file, the runner does
 *   not run it: it records it with `superseded_by` in the same transaction that applies the new one.
 *   A database that applied the old file keeps what it did, and the new file brings it to the same
 *   end state.
 * @structure
 *   - SUPERSEDED: old file → the file that replaces it
 *   - runMigrations(pool): apply every file not applied yet, in lexical order
 *   - takeBootLock(pool) / runMigrationsLocked(pool): the boot lock two booting processes share
 * @version-history
 *   v1.3.0 — 2026-11-04 — The boot lock (pg_advisory_lock on a connection of its own) around the
 *     migrations, and takeBootLock() for the boot seeding (codebase analysis 2026-11-03, HA stage 1).
 *   v1.2.1 — 2026-10-25 — The `superseded_by` column is added only when it is missing: the ALTER's lock
 *     waited behind the nightly pg_dump and a restart during the dump failed to boot.
 *   v1.2.0 — 2026-10-16 — A migration's transaction lifts the pool's statement and lock limits for
 *     itself (QA audit E6-07).
 *   v1.1.0 — 2026-09-26 — SUPERSEDED, and the `superseded_by` column: 0085 is recorded as replaced by
 *     0086 on a database that has not applied it, and never runs there.
 *   v1.0.0 — 2026-07-15 — Phase 5: SQL-file migration runner (replaces prisma db push).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { logger } from '../../../utils/logger.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Each migration file that a later file replaces, with the file that replaces it.
 *
 * 0085 moved the rows stored under a bare account name to the person's GHII, and took a row older
 * than the account that holds its name now as a deleted account's. 0086 carries the whole move and
 * acts only on positive evidence: such a row is left as it is, for the operator to decide.
 */
export const SUPERSEDED: Readonly<Record<string, string>> = {
  '0085_actions_work_full_identity.sql': '0086_full_identity_on_evidence.sql',
};

const RECORD_SUPERSEDED = 'INSERT INTO "_kysely_migrations"(name, superseded_by) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING';

/**
 * The key of the boot lock: a PostgreSQL session advisory lock that one process of a node holds
 * while it migrates, and again while it seeds at boot (server-bootstrap/service-init.ts). Advisory
 * locks belong to one database, so nodes on other databases of the same server never meet it.
 */
export const BOOT_LOCK_KEY = 4_142_202_611;

/** How long a booting process waits for another to give the boot lock back before it goes on without it. */
export const BOOT_LOCK_WAIT_MS = 60_000;

/**
 * Take the boot lock on a connection of its own, waiting as long as another process holds it, and
 * answer the function that gives it back. Two processes that boot together then migrate and seed one
 * after the other instead of at once: without it both read the applied set, both ran the next file,
 * and the second failed on the first's primary key and did not boot until it was restarted.
 *
 * The wait is bounded by `waitMs`. A holder whose host died keeps its session, and the lock, until
 * the database notices the dead connection, which can take hours; so after the wait the process goes
 * on without the lock, as every process did before the lock existed (a clash then fails one boot,
 * and the process manager starts it again). The connection's own statement limit is back once the
 * lock is held. A lock whose release fails goes with its connection, which is destroyed, and a
 * process that ends releases it the same way.
 */
export async function takeBootLock(pool: pg.Pool, waitMs = BOOT_LOCK_WAIT_MS): Promise<() => Promise<void>> {
  const client = await pool.connect();
  try {
    await client.query(`SET statement_timeout = ${Math.max(1, Math.floor(waitMs))}`);
    await client.query('SELECT pg_advisory_lock($1)', [BOOT_LOCK_KEY]);
    await client.query('RESET statement_timeout');
  } catch (err) {
    if ((err as { code?: string }).code === '57014') {
      // query_canceled: the wait ran out. The connection is sound; it goes back without the lock.
      await client.query('RESET statement_timeout').then(() => client.release(), (e: Error) => client.release(e));
      logger.warn(`boot lock: another process held it for over ${Math.round(waitMs / 1000)} s; going on without it`);
      return async () => { /* nothing was taken */ };
    }
    client.release(err as Error);
    throw err;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [BOOT_LOCK_KEY]);
      client.release();
    } catch (err) {
      // Destroying the connection ends its session, and the lock with it.
      client.release(err as Error);
    }
  };
}

/** runMigrations under the boot lock, so a second process booting at the same time waits for this one. */
export async function runMigrationsLocked(pool: pg.Pool): Promise<void> {
  const release = await takeBootLock(pool);
  try {
    await runMigrations(pool);
  } finally {
    await release();
  }
}

/** Apply every not-yet-applied migration file in lexical order, each in its own transaction. */
export async function runMigrations(pool: pg.Pool): Promise<void> {
  await pool.query('CREATE TABLE IF NOT EXISTS "_kysely_migrations" (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  // Set on a file that never ran, to the file that replaced it. ALTER TABLE takes its ACCESS EXCLUSIVE
  // lock before IF NOT EXISTS is checked, so it waits behind any reader of the table (the nightly
  // pg_dump holds one for minutes) and the boot dies on the pool's lock_timeout. It runs only when
  // the column is missing.
  const hasSupersededBy = await pool.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '_kysely_migrations' AND column_name = 'superseded_by'",
  );
  if (hasSupersededBy.rowCount === 0) await pool.query('ALTER TABLE "_kysely_migrations" ADD COLUMN IF NOT EXISTS superseded_by text');
  const applied = new Set((await pool.query<{ name: string }>('SELECT name FROM "_kysely_migrations"')).rows.map(r => r.name));
  const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const replacement = SUPERSEDED[file];
    if (replacement && files.includes(replacement)) {
      // Never run. It is recorded in the transaction that applies its replacement (below), or here
      // when the replacement was applied before this file was known to be replaced.
      if (applied.has(replacement)) await pool.query(RECORD_SUPERSEDED, [file, replacement]);
      continue;
    }
    const ddl = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // The pool's statement and lock limits end a stalled request (pool-limits.ts). A migration
      // that rewrites a large table is not stalled, and a node that cannot finish one does not boot,
      // so this transaction lifts both limits for itself (LOCAL ends with the transaction).
      await client.query('SET LOCAL statement_timeout = 0');
      await client.query('SET LOCAL lock_timeout = 0');
      await client.query(ddl);
      await client.query('INSERT INTO "_kysely_migrations"(name) VALUES ($1)', [file]);
      for (const [old, by] of Object.entries(SUPERSEDED)) {
        if (by === file && !applied.has(old)) await client.query(RECORD_SUPERSEDED, [old, file]);
      }
      await client.query('COMMIT');
      applied.add(file);
    } catch (err) {
      // The migration error thrown on the next line is the one that matters. A ROLLBACK that also
      // fails adds nothing an operator can act on, and reporting it would replace the real cause.
      // eslint-disable-next-line aimeat/no-silent-catch -- the real error is thrown immediately below
      await client.query('ROLLBACK').catch(() => { /* already broken */ });
      throw new Error(`migration ${file} failed: ${(err as Error).message}`, { cause: err });
    } finally {
      client.release();
    }
  }
}
