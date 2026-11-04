/**
 * @file test/unit/request-statement-limit.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The PostgreSQL request-path statement limit (storage.request_statement_ms;
 *   postgres-kysely/pool-limits.ts applyRequestStatementLimit), codebase analysis 2026-11-03, item C8.
 *
 *   - With the default (the request limit equal to the pool's 120 s) nothing is ever sent: the pool
 *     behaves as it did.
 *   - A statement made while a request is answered gets the configured limit, with one SET on a
 *     connection that does not hold it yet, and none on a connection that does.
 *   - Background work (no request, or a request already answered) gets the pool's own limit back.
 *   - On a real PostgreSQL (DATABASE_URL), `SHOW statement_timeout` inside a request answers the
 *     configured limit and outside it the pool's.
 * @usage cd aimeat && pnpm exec vitest run test/unit/request-statement-limit.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item C8).
 */
import { describe, it, expect, afterAll } from 'vitest';
import type pg from 'pg';
import { requestContext, type RequestScope } from '../../src/utils/request-context.js';
import { applyRequestStatementLimit, POOL_LIMITS, type RequestStatementLimit } from '../../src/storage/providers/postgres-kysely/pool-limits.js';
import { PostgresKyselyStorage } from '../../src/storage/providers/postgres-kysely/index.js';
import { requirePostgresWhenAsked } from './postgres-arm.js';

requirePostgresWhenAsked('request-statement-limit');

/** A pool of one connection that records the statements sent on it. */
function fakePool(): { pool: pg.Pool; sent: string[] } {
  const sent: string[] = [];
  const client = { query: async (text: string) => { sent.push(text); return { rows: [] }; }, release: () => {} };
  const pool = { connect: async (...args: unknown[]) => { if (args.length > 0) throw new Error('callback form not used'); return client; } };
  return { pool: pool as unknown as pg.Pool, sent };
}

function inRequest<T>(fn: (scope: RequestScope) => Promise<T>): Promise<T> {
  const scope: RequestScope = { open: true };
  return requestContext.run({ requestId: 'req-statement', scope }, () => fn(scope));
}

describe('request-path statement limit (codebase analysis 2026-11-03, C8)', () => {
  it('sends nothing while the request limit is the pool\'s own (the default)', async () => {
    const { pool, sent } = fakePool();
    applyRequestStatementLimit(pool, 120_000, { ms: () => 120_000 });
    await inRequest(async () => { await pool.connect(); await pool.connect(); });
    await pool.connect();
    expect(sent).toEqual([]);
  });

  it('a request gets the configured limit, once per connection, and background work the pool\'s back', async () => {
    const { pool, sent } = fakePool();
    const limit: RequestStatementLimit = { ms: () => 15_000 };
    applyRequestStatementLimit(pool, 120_000, limit);
    await inRequest(async () => { await pool.connect(); await pool.connect(); });
    expect(sent).toEqual(['SET statement_timeout = 15000']);
    await pool.connect();
    expect(sent).toEqual(['SET statement_timeout = 15000', 'SET statement_timeout = 120000']);
    // Work a request left running after its answer is background work.
    await inRequest(async (scope) => { scope.open = false; await pool.connect(); });
    expect(sent).toHaveLength(2);
  });

  it('0 is no limit, and a change of the setting applies to the next connection taken', async () => {
    const { pool, sent } = fakePool();
    let ms = 0;
    applyRequestStatementLimit(pool, 120_000, { ms: () => ms });
    await inRequest(async () => { await pool.connect(); });
    ms = 30_000;
    await inRequest(async () => { await pool.connect(); });
    expect(sent).toEqual(['SET statement_timeout = 0', 'SET statement_timeout = 30000']);
  });

  it('a value that is not a whole number of 0 or more is read as the pool\'s own', async () => {
    const { pool, sent } = fakePool();
    applyRequestStatementLimit(pool, 120_000, { ms: () => Number.NaN });
    await inRequest(async () => { await pool.connect(); });
    expect(sent).toEqual([]);
  });
});

const PG_URL = process.env.DATABASE_URL;
describe.runIf(!!PG_URL)('on PostgreSQL', () => {
  const storages: PostgresKyselyStorage[] = [];
  afterAll(async () => { for (const s of storages) await s.close(); });

  it('SHOW statement_timeout answers the request limit inside a request and the pool\'s outside', async () => {
    const storage = new PostgresKyselyStorage(PG_URL!, { ...POOL_LIMITS, maxConnections: 1 });
    storages.push(storage);
    await storage.ready;
    storage.requestStatementLimit.ms = () => 15_000;
    const show = async () => {
      const client = await storage.pool.connect();
      try { return (await client.query('SHOW statement_timeout')).rows[0].statement_timeout as string; }
      finally { client.release(); }
    };
    expect(await inRequest(show)).toBe('15s');
    expect(await show()).toBe('2min');
  }, 60_000);
});
