/**
 * @file src/storage/providers/postgres-kysely/migrate.ts
 * @description Migration runner for the Postgres+Kysely backend. Applies the ordered `migrations/*.sql`
 *   files exactly once each, tracked in a `_kysely_migrations` table, so the schema is materialised on
 *   first boot with no Prisma involvement. DDL is run through the raw `pg` pool (simple-query protocol)
 *   because a migration file holds MANY statements, which Kysely's parametrised (extended) path rejects;
 *   each file is applied atomically in its own transaction.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: SQL-file migration runner (replaces prisma db push).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Apply every not-yet-applied migration file in lexical order, each in its own transaction. */
export async function runMigrations(pool: pg.Pool): Promise<void> {
  await pool.query('CREATE TABLE IF NOT EXISTS "_kysely_migrations" (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const applied = new Set((await pool.query<{ name: string }>('SELECT name FROM "_kysely_migrations"')).rows.map(r => r.name));
  const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const ddl = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(ddl);
      await client.query('INSERT INTO "_kysely_migrations"(name) VALUES ($1)', [file]);
      await client.query('COMMIT');
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
