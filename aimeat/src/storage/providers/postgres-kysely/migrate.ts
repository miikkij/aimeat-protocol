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
 *
 *   THE BOOT LOCK IS TRANSACTION-SCOPED. It is `pg_advisory_xact_lock`, held by an open transaction,
 *   never a session lock: a connection pooler in transaction mode (PgBouncer) gives a session's next
 *   statement to another server connection, so a session lock taken through it is held by whoever
 *   uses that server connection next and is never given back. A transaction keeps its one server
 *   connection until it ends, through a pooler too. `pnpm check:pooler-safe` refuses a session
 *   advisory lock anywhere in src/.
 * @structure
 *   - SUPERSEDED: old file → the file that replaces it
 *   - runMigrations(pool): apply every file not applied yet, in lexical order
 *   - takeBootLock(pool) / runMigrationsLocked(pool): the boot lock two booting processes share
 * @version-history
 *   v1.4.0 — 2026-11-04 — The boot lock is transaction-scoped (pg_advisory_xact_lock): the seeding
 *     holds it in a transaction left open on its connection, and each migration file takes it in its
 *     own transaction and reads the ledger again under it. A session lock does not survive a
 *     connection pooler in transaction mode (codebase analysis 2026-11-03, item HA stage 3).
 *   v1.3.1 — 2026-11-04 — The migrations run on the connection that holds the boot lock, so a pool of
 *     one connection boots (storage-fault-injection E6-07 waited for a second connection and failed).
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
 * The key of the boot lock: a PostgreSQL transaction-scoped advisory lock that one process of a node
 * holds while it applies a migration file, and while it seeds at boot (server-bootstrap/service-init.ts).
 * Advisory locks belong to one database, so nodes on other databases of the same server never meet it.
 */
export const BOOT_LOCK_KEY = 4_142_202_611;

/** How long a booting process waits for another to give the boot lock back before it goes on without it. */
export const BOOT_LOCK_WAIT_MS = 60_000;

/** query_canceled (statement_timeout) and lock_not_available (lock_timeout): a bounded lock wait ran out. */
const WAIT_RAN_OUT = new Set(['57014', '55P03']);

/** A lock wait's bound in whole milliseconds, never 0 (0 means no limit to PostgreSQL). */
const waitBound = (waitMs: number): number => Math.max(1, Math.floor(waitMs));

/**
 * In the open transaction on `client`: wait for the boot lock at most `waitMs`. True when it is held
 * now, until the transaction ends; false when the wait ran out, and then the transaction is aborted
 * and the caller rolls it back. Both statement_timeout and lock_timeout end a lock wait, so both are
 * set to the bound for this one statement (LOCAL: they end with the transaction).
 */
async function lockInTransaction(client: pg.PoolClient, waitMs: number): Promise<boolean> {
  const bound = waitBound(waitMs);
  await client.query(`SET LOCAL statement_timeout = ${bound}`);
  await client.query(`SET LOCAL lock_timeout = ${bound}`);
  try {
    await client.query('SELECT pg_advisory_xact_lock($1)', [BOOT_LOCK_KEY]);
    return true;
  } catch (err) {
    if (WAIT_RAN_OUT.has((err as { code?: string }).code ?? '')) return false;
    throw err;
  }
}

/**
 * ROLLBACK just before the caller throws its own error. That error is the one that matters: a
 * ROLLBACK that also fails adds nothing an operator can act on, and reporting it would replace the
 * real cause.
 */
async function rollbackBeforeThrow(client: pg.PoolClient): Promise<void> {
  // eslint-disable-next-line aimeat/no-silent-catch -- the caller throws the real error right after this
  await client.query('ROLLBACK').catch(() => { /* already broken */ });
}

function warnWaitRanOut(waitMs: number): void {
  logger.warn(`boot lock: another process held it for over ${Math.round(waitMs / 1000)} s; going on without it`);
}

/**
 * Take the boot lock on a connection of its own, waiting as long as another process holds it, and
 * answer the function that gives it back. Two processes that boot together then migrate and seed one
 * after the other instead of at once: without it both read the applied set, both ran the next file,
 * and the second failed on the first's primary key and did not boot until it was restarted.
 *
 * The lock is held by a transaction this function opens and leaves open until the release, which
 * ends it (nothing is written in it). The transaction lifts the pool's idle-in-transaction limit for
 * itself, so a long seeding keeps the lock, as the session lock before it was kept.
 *
 * The wait is bounded by `waitMs`. A holder whose host died keeps its transaction, and the lock, until
 * the database notices the dead connection, which can take hours; so after the wait the process goes
 * on without the lock, as every process did before the lock existed (a clash then fails one boot,
 * and the process manager starts it again). A lock whose release fails goes with its connection,
 * which is destroyed, and a process that ends releases it the same way.
 */
export async function takeBootLock(pool: pg.Pool, waitMs = BOOT_LOCK_WAIT_MS): Promise<() => Promise<void>> {
  const client = await pool.connect();
  let held: boolean;
  try {
    await client.query('BEGIN');
    held = await lockInTransaction(client, waitMs);
    if (held) await client.query('SET LOCAL idle_in_transaction_session_timeout = 0');
  } catch (err) {
    await rollbackBeforeThrow(client);
    client.release(err as Error);
    throw err;
  }
  if (!held) {
    // The wait ran out. The connection is sound; it goes back without the lock.
    await client.query('ROLLBACK').then(() => client.release(), (e: Error) => client.release(e));
    warnWaitRanOut(waitMs);
    return async () => { /* nothing was taken */ };
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      await client.query('COMMIT');
      client.release();
    } catch (err) {
      // Destroying the connection ends its transaction, and the lock with it.
      client.release(err as Error);
    }
  };
}

/**
 * runMigrations under the boot lock, so a second process booting at the same time waits for this one.
 * Each step takes the lock in its own transaction: the ledger table's creation, then every file not
 * applied yet, which is read in the ledger again once the lock is held, so a file another process
 * applied meanwhile is passed over. One connection at a time: a pool of one connection (a small
 * personal node, the E6-07 pool test) has no second one to give.
 */
export async function runMigrationsLocked(pool: pg.Pool): Promise<void> {
  await migrateOn(pool, BOOT_LOCK_WAIT_MS);
}

/** Apply every not-yet-applied migration file in lexical order, each in its own transaction. */
export async function runMigrations(pool: pg.Pool): Promise<void> {
  await migrateOn(pool, null);
}

/**
 * One transaction on its own connection, under the boot lock when `lock` holds a wait bound. Answers
 * 'wait-ran-out' when the lock was not had in time; nothing of `fn` ran then.
 */
async function lockedTransaction(pool: pg.Pool, lock: number | null, fn: (client: pg.PoolClient) => Promise<void>): Promise<'done' | 'wait-ran-out'> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (lock !== null && !await lockInTransaction(client, lock)) {
      await client.query('ROLLBACK');
      return 'wait-ran-out';
    }
    await fn(client);
    await client.query('COMMIT');
    return 'done';
  } catch (err) {
    await rollbackBeforeThrow(client);
    throw err;
  } finally {
    client.release();
  }
}

/** `lockedTransaction`, and without the lock from then on when the wait ran out (the caller's `state.lock` turns null). */
async function stepUnderBootLock(pool: pg.Pool, state: { lock: number | null }, fn: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  if (await lockedTransaction(pool, state.lock, fn) === 'done') return;
  warnWaitRanOut(state.lock ?? 0);
  state.lock = null;
  await lockedTransaction(pool, null, fn);
}

async function migrateOn(pool: pg.Pool, lockWaitMs: number | null): Promise<void> {
  const state = { lock: lockWaitMs };
  await stepUnderBootLock(pool, state, async (client) => {
    // Under the lock: two processes creating the ledger table at once collide in the catalog. The
    // lock's own wait bound is put back to the pool's limits for these statements.
    if (state.lock !== null) {
      await client.query('SET LOCAL statement_timeout = DEFAULT');
      await client.query('SET LOCAL lock_timeout = DEFAULT');
    }
    await client.query('CREATE TABLE IF NOT EXISTS "_kysely_migrations" (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    // Set on a file that never ran, to the file that replaced it. ALTER TABLE takes its ACCESS EXCLUSIVE
    // lock before IF NOT EXISTS is checked, so it waits behind any reader of the table (the nightly
    // pg_dump holds one for minutes) and the boot dies on the pool's lock_timeout. It runs only when
    // the column is missing.
    const hasSupersededBy = await client.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '_kysely_migrations' AND column_name = 'superseded_by'",
    );
    if (hasSupersededBy.rowCount === 0) await client.query('ALTER TABLE "_kysely_migrations" ADD COLUMN IF NOT EXISTS superseded_by text');
  });
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
    try {
      await stepUnderBootLock(pool, state, async (client) => {
        // Another process that held the lock before this one may have applied the file meanwhile.
        if (state.lock !== null && (await client.query('SELECT 1 FROM "_kysely_migrations" WHERE name = $1', [file])).rowCount) return;
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
      });
      applied.add(file);
    } catch (err) {
      throw new Error(`migration ${file} failed: ${(err as Error).message}`, { cause: err });
    }
  }
}
