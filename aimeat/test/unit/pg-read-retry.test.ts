/**
 * @file test/unit/pg-read-retry.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A PostgreSQL read that met a lost connection is tried once more; a write fails to its
 *   caller as before (storage/providers/postgres-kysely/read-retry.ts):
 *   - with an injected error, through a real Kysely over a scripted driver: a SELECT that failed
 *     with 57P01 or 08006 runs again on another connection, given back first so a pool of one
 *     works; 40001 runs again on the same connection; a second failure reaches the caller; an
 *     INSERT, UPDATE, DELETE, a raw statement, a SELECT whose CTE writes, a read inside a
 *     transaction and an error of another kind are not tried again;
 *   - dropLostConnections: a pooled client whose query failed on a lost connection is destroyed at
 *     its release, any other is given back;
 *   - on PostgreSQL (when DATABASE_URL is set): the backend of a running read is ended
 *     (pg_terminate_backend, 57P01) and the read answers; the backend of a running write is ended
 *     and the write fails, as it did before.
 * @usage pnpm exec vitest run test/unit/pg-read-retry.test.ts
 *        DATABASE_URL=postgresql://… pnpm exec vitest run test/unit/pg-read-retry.test.ts
 * @version-history
 *   v1.0.2 — 2026-11-07 — A lost client given back with release(false), as Kysely 0.29.8 does, is
 *            destroyed (the PostgreSQL pool-of-one case failed in CI about three runs in four).
 *   v1.0.1 — 2026-11-05 — The sleep marker's last digit is never 0, so the SQL literal keeps it
 *            whole and the search in pg_stat_activity finds the statement (it missed about one run
 *            in ten).
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item HA stage 3).
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import {
  CompiledQuery, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, sql,
  type DatabaseConnection, type Dialect, type Driver, type QueryResult,
} from 'kysely';
import { dropLostConnections, isIdempotentRead, lostConnection, withReadRetry, type ReadRetryInfo } from '../../src/storage/providers/postgres-kysely/read-retry.js';
import { PostgresKyselyStorage } from '../../src/storage/providers/postgres-kysely/index.js';
import { POOL_LIMITS } from '../../src/storage/providers/postgres-kysely/pool-limits.js';
import { requirePostgresWhenAsked } from './postgres-arm.js';

requirePostgresWhenAsked('pg-read-retry');
const PG_URL = process.env.DATABASE_URL ?? '';

const failure = (code: string, message = `failed with ${code}`) => Object.assign(new Error(message), { code });

/** A driver whose connections answer from a script: each connection takes the next errors in line, then answers its own id. */
function scripted(errors: Array<Error | null>, opts: { max?: number; acquires?: number } = {}) {
  const log: string[] = [];
  let next = 0;
  let out = 0;
  const conn = (id: number): DatabaseConnection => ({
    async executeQuery<R>(cq: CompiledQuery): Promise<QueryResult<R>> {
      log.push(`c${id}: ${cq.sql.split(' ')[0]}`);
      const e = errors.shift();
      if (e) throw e;
      return { rows: [{ id } as R] };
    },
    // eslint-disable-next-line require-yield -- never streamed here
    async *streamQuery() { throw new Error('not streamed'); },
  });
  const driver: Driver = {
    async init() { /* nothing */ },
    async acquireConnection() {
      if (out >= (opts.max ?? 10)) throw new Error('pool exhausted');
      if (opts.acquires !== undefined && next >= opts.acquires) throw new Error('database unreachable');
      out++;
      const id = ++next;
      log.push(`acquire c${id}`);
      return conn(id);
    },
    async beginTransaction(c) { await c.executeQuery(CompiledQuery.raw('begin')); },
    async commitTransaction(c) { await c.executeQuery(CompiledQuery.raw('commit')); },
    async rollbackTransaction(c) { await c.executeQuery(CompiledQuery.raw('rollback')); },
    async releaseConnection() { out--; log.push('release'); },
    async destroy() { /* nothing */ },
  };
  const retries: ReadRetryInfo[] = [];
  const dialect: Dialect = {
    createDriver: () => driver,
    createQueryCompiler: () => new PostgresQueryCompiler(),
    createAdapter: () => new PostgresAdapter(),
    createIntrospector: (db) => new PostgresIntrospector(db),
  };
  const db = new Kysely<any>({ dialect: withReadRetry(dialect, (i) => retries.push(i)) });
  return { db, log, retries, outstanding: () => out };
}

describe('read retry, with an injected error', () => {
  it('a SELECT that lost its connection (57P01) runs again on another one, given back first: a pool of one works', async () => {
    const s = scripted([failure('57P01', 'terminating connection due to administrator command')], { max: 1 });
    expect(await s.db.selectFrom('t').selectAll().execute()).toEqual([{ id: 2 }]);
    expect(s.log).toEqual(['acquire c1', 'c1: select', 'release', 'acquire c2', 'c2: select', 'release']);
    expect(s.retries.map(r => [r.reason, r.code])).toEqual([['connection', '57P01']]);
    expect(s.outstanding()).toBe(0);
  });

  it('08006 and a terminated socket count as a lost connection too', async () => {
    for (const e of [failure('08006'), failure('ECONNRESET'), new Error('Connection terminated unexpectedly')]) {
      const s = scripted([e]);
      expect(await s.db.selectFrom('t').selectAll().executeTakeFirst()).toEqual({ id: 2 });
    }
  });

  it('40001 runs again once on the same connection', async () => {
    const s = scripted([failure('40001')]);
    expect(await s.db.selectFrom('t').selectAll().execute()).toEqual([{ id: 1 }]);
    expect(s.log).toEqual(['acquire c1', 'c1: select', 'c1: select', 'release']);
  });

  it('once only: a second failure reaches the caller', async () => {
    const s = scripted([failure('08006'), failure('08006')]);
    await expect(s.db.selectFrom('t').selectAll().execute()).rejects.toMatchObject({ code: '08006' });
    expect(s.outstanding()).toBe(0);
  });

  it('when no other connection can be taken, the caller gets the first error', async () => {
    const s = scripted([failure('57P01')], { acquires: 1 });
    await expect(s.db.selectFrom('t').selectAll().execute()).rejects.toMatchObject({ code: '57P01' });
    expect(s.outstanding()).toBe(0);
  });

  it('a write, a raw statement, a SELECT whose CTE writes, and another kind of error are not tried again', async () => {
    const cases: Array<[string, (db: Kysely<any>) => Promise<unknown>, Error]> = [
      ['insert', db => db.insertInto('t').values({ a: 1 }).execute(), failure('57P01')],
      ['update', db => db.updateTable('t').set({ a: 1 }).execute(), failure('57P01')],
      ['delete', db => db.deleteFrom('t').execute(), failure('08006')],
      ['raw', db => sql`select 1`.execute(db), failure('57P01')],
      ['cte that writes', db => db.with('w', q => q.updateTable('t').set({ a: 1 }).returning('a')).selectFrom('w').selectAll().execute(), failure('57P01')],
      ['unique violation', db => db.selectFrom('t').selectAll().execute(), failure('23505')],
      ['statement timeout', db => db.selectFrom('t').selectAll().execute(), failure('57014')],
    ];
    for (const [name, run, err] of cases) {
      const s = scripted([err]);
      await expect(run(s.db), name).rejects.toBe(err);
      expect(s.retries, name).toEqual([]);
      expect(s.log.filter(l => l.startsWith('acquire')).length, name).toBe(1);
    }
  });

  it('a read inside a transaction is not tried again', async () => {
    const s = scripted([null, failure('57P01')]);   // begin answers, the read fails
    await expect(s.db.transaction().execute(trx => trx.selectFrom('t').selectAll().execute())).rejects.toMatchObject({ code: '57P01' });
    expect(s.retries).toEqual([]);
    expect(s.outstanding()).toBe(0);
  });

  it('a read after a transaction ended is tried again as any other', async () => {
    const s = scripted([null, null, failure('57P01')], { max: 1 });   // begin, commit, then the read fails
    await s.db.transaction().execute(async () => undefined);
    expect(await s.db.selectFrom('t').selectAll().execute()).toEqual([{ id: 3 }]);
  });

  it('isIdempotentRead: a SELECT with a reading CTE is a read', () => {
    const db = scripted([]).db as Kysely<any>;
    expect(isIdempotentRead(db.with('r', q => q.selectFrom('t').selectAll()).selectFrom('r').selectAll().compile().query)).toBe(true);
    expect(isIdempotentRead(db.insertInto('t').values({ a: 1 }).compile().query)).toBe(false);
  });
});

describe('dropLostConnections', () => {
  function fakePool(code: string) {
    const releases: unknown[] = [];
    const client = {
      query: (text: string) => text === 'fail' ? Promise.reject(failure(code)) : Promise.resolve({ rows: [] }),
      release: (_e?: unknown) => undefined as unknown,
    };
    const pool = {
      connect: (...args: unknown[]) => {
        if (args.length) throw new Error('callback form not used here');
        client.release = (e?: unknown) => { releases.push(e); };
        return Promise.resolve(client);
      },
    };
    dropLostConnections(pool as unknown as pg.Pool);
    return { pool: pool as unknown as pg.Pool, releases };
  }

  it('a client whose query lost its connection is destroyed at its release', async () => {
    const { pool, releases } = fakePool('57P01');
    const c = await pool.connect();
    await expect(c.query('fail')).rejects.toMatchObject({ code: '57P01' });
    c.release();
    expect(releases[0]).toBeInstanceOf(Error);
  });

  it('a lost client given back with release(false), as Kysely 0.29.8 does, is destroyed too', async () => {
    const { pool, releases } = fakePool('57P01');
    const c = await pool.connect();
    await expect(c.query('fail')).rejects.toMatchObject({ code: '57P01' });
    c.release(false);
    expect(releases[0]).toBeInstanceOf(Error);
  });

  it('a client whose query failed for another reason goes back to the pool', async () => {
    const { pool, releases } = fakePool('23505');
    const c = await pool.connect();
    await expect(c.query('fail')).rejects.toMatchObject({ code: '23505' });
    c.release();
    const again = await pool.connect();
    await again.query('ok');
    again.release();
    expect(releases).toEqual([undefined, undefined]);
  });
});

describe.skipIf(!PG_URL)('read retry on PostgreSQL: a backend ended under a running statement', () => {
  /**
   * A sleep of about 3 s whose length names the statement in pg_stat_activity. The last digit is
   * never 0: the SQL literal is written from Number(marker), which drops a trailing zero, and the
   * search for the marker would then miss the statement.
   */
  const sleepMarker = (): string => `3.0${Math.floor(Math.random() * 9000) + 1000}${Math.floor(Math.random() * 9) + 1}`;

  /** Run `start`, end the backend that runs the statement marked `marker`, and answer what `start` settled to. */
  async function endUnder<T>(marker: string, start: () => Promise<T>): Promise<PromiseSettledResult<T>> {
    const admin = new pg.Client(PG_URL);
    await admin.connect();
    try {
      const running = start();
      running.catch(() => { /* settled below */ });
      let pid: number | undefined;
      for (let i = 0; i < 100 && pid === undefined; i++) {
        await new Promise(r => setTimeout(r, 20));
        const r = await admin.query<{ pid: number }>(
          'SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND state = \'active\' AND position($1 in query) > 0',
          [marker],
        );
        pid = r.rows[0]?.pid;
      }
      expect(pid, 'the statement was seen running').toBeDefined();
      await admin.query('SELECT pg_terminate_backend($1)', [pid]);
      return (await Promise.allSettled([running]))[0]!;
    } finally {
      await admin.end();
    }
  }

  it('a read answers, from another connection of a pool of one', async () => {
    const store = new PostgresKyselyStorage(PG_URL, { ...POOL_LIMITS, maxConnections: 1 });
    try {
      await store.ready;
      const marker = sleepMarker();
      const out = await endUnder(marker, () => store.rootDb.selectNoFrom(sql<number>`(select 1 from pg_sleep(${sql.lit(Number(marker))}))`.as('one')).executeTakeFirst());
      expect(out).toEqual({ status: 'fulfilled', value: { one: 1 } });
      // The pool goes on with a sound connection.
      expect(await store.rootDb.selectNoFrom(sql<number>`2`.as('two')).executeTakeFirst()).toEqual({ two: 2 });
    } finally {
      await store.close();
    }
  }, 30_000);

  it('a write fails to its caller, as before', async () => {
    const store = new PostgresKyselyStorage(PG_URL, { ...POOL_LIMITS, maxConnections: 1 });
    try {
      await store.ready;
      const marker = sleepMarker();
      const out = await endUnder(marker, () => store.rootDb.updateTable('SystemSetting').set({ value: 'x' })
        .where('key', '=', `read-retry-${randomUUID()}`)
        .where(sql<boolean>`(select true from pg_sleep(${sql.lit(Number(marker))}))`).execute());
      expect(out.status).toBe('rejected');
      // 57P01 when the server's message is read first, "Connection terminated" when the socket's end is.
      expect(lostConnection((out as PromiseRejectedResult).reason), String((out as PromiseRejectedResult).reason)).toBe(true);
      expect(await store.rootDb.selectNoFrom(sql<number>`2`.as('two')).executeTakeFirst()).toEqual({ two: 2 });
    } finally {
      await store.close();
    }
  }, 30_000);
});
