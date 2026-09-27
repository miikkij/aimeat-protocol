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
 * @version-history
 *   v1.1.0 — 2026-09-26 — SUPERSEDED, and the `superseded_by` column: 0085 is recorded as replaced by
 *     0086 on a database that has not applied it, and never runs there.
 *   v1.0.0 — 2026-07-15 — Phase 5: SQL-file migration runner (replaces prisma db push).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

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

/** Apply every not-yet-applied migration file in lexical order, each in its own transaction. */
export async function runMigrations(pool: pg.Pool): Promise<void> {
  await pool.query('CREATE TABLE IF NOT EXISTS "_kysely_migrations" (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  // Set on a file that never ran, to the file that replaced it.
  await pool.query('ALTER TABLE "_kysely_migrations" ADD COLUMN IF NOT EXISTS superseded_by text');
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
