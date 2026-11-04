/**
 * @file test/unit/boot-lock-pg.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The boot lock on PostgreSQL (storage/providers/postgres-kysely/migrate.ts) is held by
 *   an open transaction and not by a session, so it holds through a connection pooler in transaction
 *   mode (codebase analysis 2026-11-03, HA stage 3):
 *   - the holder's connection is `idle in transaction` while the lock is held, and nothing holds the
 *     key after the release (a session lock showed `idle`);
 *   - a second taker waits, goes on without the lock once its wait ran out, and gets it at once
 *     after the release, as before;
 *   - the lock outlives the pool's idle-in-transaction limit, so a long seeding keeps it;
 *   - two processes migrating one empty schema at once both finish, and every file is in the ledger
 *     once (the usage of the lock: e2e-boot-lock.ts proves the same with two whole nodes).
 *   Runs only when DATABASE_URL names a PostgreSQL test database; it works in an empty database of
 *   its own beside it (`<database>_bootlock`), created at the start and dropped at the end.
 * @usage DATABASE_URL=postgresql://… pnpm exec vitest run test/unit/boot-lock-pg.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item HA stage 3).
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BOOT_LOCK_KEY, runMigrationsLocked, takeBootLock } from '../../src/storage/providers/postgres-kysely/migrate.js';
import { requirePostgresWhenAsked } from './postgres-arm.js';

requirePostgresWhenAsked('boot-lock-pg');
const PG_URL = process.env.DATABASE_URL ?? '';
const MIGRATIONS_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '../../src/storage/providers/postgres-kysely/migrations');

/** The test's own database beside the run's, in PostgreSQL's 63-character name limit. */
function ownUrl(): { url: string; name: string } {
  const u = new URL(PG_URL);
  const name = `${u.pathname.replace(/^\//, '').slice(0, 63 - '_bootlock'.length)}_bootlock`;
  u.pathname = `/${name}`;
  return { url: u.toString(), name };
}
const OWN = PG_URL ? ownUrl() : { url: '', name: '' };
const quoted = (name: string) => `"${name.replace(/"/g, '""')}"`;

const pools: pg.Pool[] = [];
function pool(opts: Partial<pg.PoolConfig> = {}): pg.Pool {
  const p = new pg.Pool({ connectionString: OWN.url, max: 4, ...opts });
  p.on('error', () => { /* a connection the test ended on purpose */ });
  pools.push(p);
  return p;
}

let probe: pg.Pool;

/** Who holds the boot lock's key in the test's database now: the backend and its state. */
async function holders(): Promise<Array<{ pid: number; state: string }>> {
  const r = await probe.query<{ pid: number; state: string }>(
    `SELECT l.pid, a.state FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE l.locktype = 'advisory' AND l.granted AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND (l.classid::bigint << 32) + l.objid::bigint = $1`,
    [BOOT_LOCK_KEY],
  );
  return r.rows;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!PG_URL)('the boot lock is transaction-scoped (PostgreSQL)', () => {
  beforeAll(async () => {
    const admin = new pg.Client(PG_URL);
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${quoted(OWN.name)} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${quoted(OWN.name)}`);
    } finally {
      await admin.end();
    }
    probe = pool({ max: 2 });
  });

  afterAll(async () => {
    for (const p of pools.reverse()) await p.end().catch(() => { /* already ended */ });
    const admin = new pg.Client(PG_URL);
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${quoted(OWN.name)} WITH (FORCE)`).catch(() => { /* the test's own scratch database */ });
    await admin.end();
  });

  it('is held by an open transaction while taken, and by nobody after the release', async () => {
    const release = await takeBootLock(pool(), 5_000);
    try {
      const held = await holders();
      expect(held.length).toBe(1);
      expect(held[0]!.state).toBe('idle in transaction');
    } finally {
      await release();
    }
    expect(await holders()).toEqual([]);
  });

  it('a second taker waits, goes on without it when the wait ran out, and gets it at once after the release', async () => {
    const releaseA = await takeBootLock(pool(), 5_000);
    const t0 = Date.now();
    const releaseB = await takeBootLock(pool(), 300);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
    expect((await holders()).length).toBe(1);
    await releaseB();                                   // B took nothing: A still holds it
    expect((await holders()).length).toBe(1);
    await releaseA();
    const t1 = Date.now();
    const releaseC = await takeBootLock(pool(), 5_000);
    expect(Date.now() - t1).toBeLessThan(2_000);
    expect((await holders()).length).toBe(1);
    await releaseC();
    expect(await holders()).toEqual([]);
  });

  it('outlives the pool\'s idle-in-transaction limit, so a long seeding keeps it', async () => {
    const release = await takeBootLock(pool({ idle_in_transaction_session_timeout: 300 }), 5_000);
    await sleep(900);
    const releaseB = await takeBootLock(pool(), 200);   // still held: B's wait runs out
    await releaseB();
    expect((await holders()).length).toBe(1);
    await release();
    expect(await holders()).toEqual([]);
  });

  it('two processes migrating one empty schema at once both finish, and each file is in the ledger once', async () => {
    await Promise.all([runMigrationsLocked(pool()), runMigrationsLocked(pool())]);
    const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
    const rows = (await probe.query<{ name: string }>('SELECT name FROM "_kysely_migrations" ORDER BY name')).rows.map(r => r.name);
    expect(rows).toEqual(files);
    expect(await holders()).toEqual([]);
  }, 120_000);
});
