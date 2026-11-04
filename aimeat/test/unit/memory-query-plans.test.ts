/**
 * @file test/unit/memory-query-plans.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The hot query shapes on the memory table are served by an index, not a full scan
 *   (codebase analysis 2026-11-03, item C6). The statements are the providers' own: each case runs the
 *   storage method, captures the SQL and parameters it sent, and asks the database for the plan.
 *   - the TTL sweep (deleteExpiredMemory, every five minutes);
 *   - the newest public records (listAllMemory with visibility 'public' and newestFirst: the activity
 *     ticker and today's public writes);
 *   - one owner's keys under a prefix, unpaged and paged (listMemory, listMemoryMeta with limit).
 *   SQLite: no `SCAN memory` (a whole-table walk) and no temporary sort for an ordered shape.
 *   PostgreSQL (with DATABASE_URL): no `Seq Scan on "Memory"` with sequential scans priced out
 *   (enable_seqscan off), which a shape no index can serve still answers with.
 * @usage cd aimeat && DATABASE_URL=postgresql://… pnpm exec vitest run test/unit/memory-query-plans.test.ts
 * @version-history
 *   2026-11-04 — Initial (codebase analysis 2026-11-03, item C6).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';

const PG_URL = process.env.DATABASE_URL ?? '';
const REQUIRE_POSTGRES = process.env.AIMEAT_CONFORMANCE_REQUIRE_POSTGRES === 'true';
const RUN = randomUUID().slice(0, 8);
const OWNER = `plans${RUN}@node`;

function mem(key: string, over: Partial<MemoryRecord> = {}): MemoryRecord {
  const now = new Date().toISOString();
  return { key, ownerGaii: OWNER, value: { k: key }, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now, ...over };
}

async function seed(s: Storage): Promise<void> {
  const rows: MemoryRecord[] = [];
  for (let i = 0; i < 300; i++) {
    rows.push(mem(`notes.${String(i).padStart(3, '0')}`, {
      visibility: i % 3 === 0 ? 'public' : 'private',
      ttlHours: i % 5 === 0 ? 24 : null,
    }));
  }
  await s.bulkSetMemory!(rows);
}

/** The hot shapes, as storage calls. Each one's statements are captured while it runs. */
const SHAPES: Array<{ name: string; ordered: boolean; run: (s: Storage) => Promise<unknown> }> = [
  { name: 'TTL sweep', ordered: false, run: s => s.deleteExpiredMemory(new Date().toISOString()) },
  { name: 'public newest first', ordered: true, run: s => s.listAllMemory({ visibility: 'public', excludeOwnerPrefix: 'system@', newestFirst: true, limit: 100 }) },
  { name: 'public newest first, meta', ordered: true, run: s => s.listAllMemoryMeta({ visibility: 'public', excludeOwnerPrefix: 'system@', newestFirst: true, limit: 500 }) },
  { name: 'owner prefix list', ordered: false, run: s => s.listMemory(OWNER, { prefix: 'notes.1' }) },
  { name: 'owner prefix page', ordered: true, run: s => s.listMemoryMeta(OWNER, { prefix: 'notes.', limit: 10, after: 'notes.100' }) },
];

describe('SQLite: the hot memory shapes use an index', () => {
  let storage: SqliteStorage;
  let db: { prepare: (sql: string) => { all: (...a: unknown[]) => Array<Record<string, unknown>> } };
  beforeAll(async () => {
    storage = new SqliteStorage(':memory:');
    await seed(storage);
    db = (storage as unknown as { db: typeof db }).db;
  });

  /** The statements one call sends to the memory table, with their parameters. */
  async function captured(run: () => Promise<unknown>): Promise<Array<{ sql: string; params: unknown[] }>> {
    const seen: Array<{ sql: string; params: unknown[] }> = [];
    const real = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      const st = real(sql) as unknown as Record<string, (...a: unknown[]) => unknown>;
      return new Proxy(st, {
        get(t, p) {
          const v = Reflect.get(t, p) as unknown;
          if (typeof v !== 'function') return v;
          if (p === 'all' || p === 'get' || p === 'run' || p === 'iterate') {
            return (...a: unknown[]) => { if (/\bmemory\b/.test(sql) && !/memory_(fts|history|totals)/.test(sql)) seen.push({ sql, params: a }); return (v as (...x: unknown[]) => unknown).apply(t, a); };
          }
          return (v as (...x: unknown[]) => unknown).bind(t);
        },
      }) as never;
    };
    try { await run(); } finally { db.prepare = real; }
    return seen;
  }

  for (const shape of SHAPES) {
    it(`${shape.name}: no full scan of memory${shape.ordered ? ' and no temporary sort' : ''}`, async () => {
      const statements = await captured(() => shape.run(storage));
      expect(statements.length).toBeGreaterThan(0);
      for (const st of statements) {
        const plan = db.prepare('EXPLAIN QUERY PLAN ' + st.sql).all(...st.params).map(r => String(r.detail));
        expect(plan.filter(d => /^SCAN memory\b/.test(d)), `${st.sql}\n${plan.join('\n')}`).toEqual([]);
        if (shape.ordered && /ORDER BY/.test(st.sql)) {
          expect(plan.filter(d => /TEMP B-TREE FOR ORDER BY/.test(d)), `${st.sql}\n${plan.join('\n')}`).toEqual([]);
        }
      }
    });
  }
});

describe('PostgreSQL: the hot memory shapes have an index to use', () => {
  let storage: Storage | null = null;
  let client: pg.Client | null = null;

  beforeAll(async () => {
    if (REQUIRE_POSTGRES && !PG_URL) throw new Error('Postgres conformance requires DATABASE_URL.');
    if (!PG_URL) return;
    storage = await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL });
    await seed(storage);
    client = new pg.Client(PG_URL);
    await client.connect();
  }, 60_000);

  afterAll(async () => {
    if (storage) await storage.deleteAllMemory(OWNER).catch(() => 0);
    await client?.end();
    await (storage as unknown as { close?: () => Promise<void> } | null)?.close?.();
  });

  /** The statements one call sends, captured at the driver. */
  async function captured(run: () => Promise<unknown>): Promise<Array<{ sql: string; params: unknown[] }>> {
    const seen: Array<{ sql: string; params: unknown[] }> = [];
    const proto = pg.Client.prototype as unknown as { query: (...a: unknown[]) => unknown };
    const real = proto.query;
    proto.query = function (this: unknown, ...a: unknown[]) {
      const first = a[0] as string | { text?: string; values?: unknown[] };
      const sql = typeof first === 'string' ? first : first?.text ?? '';
      const params = (typeof first === 'string' ? a[1] : first?.values) as unknown[] | undefined;
      if (/"Memory"/.test(sql)) seen.push({ sql, params: params ?? [] });
      return real.apply(this, a);
    };
    try { await run(); } finally { proto.query = real; }
    return seen;
  }

  for (const shape of SHAPES) {
    it(`${shape.name}: no sequential scan of "Memory" when one is priced out`, async () => {
      if (!storage || !client) return;
      const statements = await captured(() => shape.run(storage!));
      expect(statements.length).toBeGreaterThan(0);
      for (const st of statements) {
        await client.query('BEGIN');
        try {
          await client.query('SET LOCAL enable_seqscan = off');
          const r = await client.query('EXPLAIN ' + st.sql, st.params);
          const plan = r.rows.map(x => String(x['QUERY PLAN']));
          expect(plan.filter(l => /Seq Scan on "?Memory"?/.test(l)), `${st.sql}\n${plan.join('\n')}`).toEqual([]);
        } finally {
          await client.query('ROLLBACK');
        }
      }
    });
  }
});
