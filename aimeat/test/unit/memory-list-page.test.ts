/**
 * @file test/unit/memory-list-page.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The page of a memory keyspace listing, taken in SQL (codebase analysis 2026-11-03,
 *   item C1), on SQLite and, with DATABASE_URL, on PostgreSQL, which must answer the same sequence:
 *   - a 1 000-record owner with limit 10 answers ten rows in key byte order, and the key cursor the
 *     next ten, until the keyspace ends;
 *   - the tag and flag filters, the bin and an expired row are applied before the LIMIT;
 *   - a many-owner listing pages by key and then owner, and `afterOwner` continues inside one key;
 *   - without limit and after, a listing returns what it returned before, every match;
 *   - on SQLite the LIMIT is in the statement (the rows never reach JavaScript);
 *   - GET /v1/memory's bounded listing (services/memory-list-page.ts) reads the values of its page
 *     only, and its byte sum equals the sum of JSON.stringify of each shown value, the credential
 *     mask included.
 * @usage cd aimeat && DATABASE_URL=postgresql://… pnpm exec vitest run test/unit/memory-list-page.test.ts
 * @version-history
 *   2026-11-04 — Initial (codebase analysis 2026-11-03, item C1).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { memoryPageWithValues, shownMemoryBytes } from '../../src/services/memory-list-page.js';
import { shownMemoryValue } from '../../src/services/secret-records.js';

const SQLITE_PATH = `./test/.memory-list-page-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';
const REQUIRE_POSTGRES = process.env.AIMEAT_CONFORMANCE_REQUIRE_POSTGRES === 'true';

interface Provider { name: string; storage: Storage }
const provs: Provider[] = [];
const RUN = randomUUID().slice(0, 8);

beforeAll(async () => {
  if (REQUIRE_POSTGRES && !PG_URL) throw new Error('Postgres conformance requires DATABASE_URL.');
  provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
  if (PG_URL) provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
}, 60_000);

afterAll(async () => {
  for (const { storage } of provs) {
    for (const o of owners) await storage.deleteAllMemory(o).catch(() => 0);
    await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
  }
  for (const suffix of ['', '-wal', '-shm']) {
    const p = SQLITE_PATH + suffix;
    if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch file */ } }
  }
});

const owners: string[] = [];
function owner(tag: string): string {
  const o = `lp${tag}${RUN}@node`;
  owners.push(o);
  return o;
}

function mem(ownerGaii: string, key: string, over: Partial<MemoryRecord> = {}): MemoryRecord {
  const now = new Date().toISOString();
  return { key, ownerGaii, value: { k: key }, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now, ...over };
}

async function onEach<T>(fn: (s: Storage) => Promise<T>): Promise<Record<string, T>> {
  const out: Record<string, T> = {};
  for (const { name, storage } of provs) out[name] = await fn(storage);
  return out;
}

function same<T>(results: Record<string, T>): T {
  const values = Object.values(results);
  for (const v of values.slice(1)) expect(v).toEqual(values[0]);
  return values[0]!;
}

describe('MemoryListOpts limit and key cursor (codebase analysis 2026-11-03, item C1)', () => {
  const big = owner('big');
  beforeAll(async () => {
    for (const { storage } of provs) {
      const rows: MemoryRecord[] = [];
      // Mixed case and digits, so byte order and a locale order would differ: 'B' < 'a' in bytes.
      for (let i = 0; i < 1000; i++) rows.push(mem(big, `${i % 2 ? 'Big' : 'big'}.${String(i).padStart(4, '0')}`));
      await storage.bulkSetMemory!(rows);
    }
  }, 120_000);

  it('a 1 000-record owner with limit 10 answers ten rows in key byte order, and the cursor walks the whole keyspace', async () => {
    const r = await onEach(async (s) => {
      const first = await s.listMemoryMeta(big, { limit: 10 });
      let after = first[first.length - 1]!.key;
      const seen = first.map(m => m.key);
      for (;;) {
        const page = await s.listMemoryMeta(big, { limit: 97, after });
        if (page.length === 0) break;
        seen.push(...page.map(m => m.key));
        after = page[page.length - 1]!.key;
      }
      return { first: first.map(m => m.key), seen };
    });
    const out = same(r);
    expect(out.first).toHaveLength(10);
    expect(out.first[0]).toBe('Big.0001');
    expect(out.seen).toHaveLength(1000);
    expect(new Set(out.seen).size).toBe(1000);
    const bytes = [...out.seen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(out.seen).toEqual(bytes);
  });

  it('the values listing pages the same keys, with values', async () => {
    const r = await onEach(async (s) => (await s.listMemory(big, { limit: 3, after: 'big.0500' })).map(m => [m.key, m.value]));
    expect(same(r)).toEqual([['big.0502', { k: 'big.0502' }], ['big.0504', { k: 'big.0504' }], ['big.0506', { k: 'big.0506' }]]);
  });

  it('without limit and after, the listing returns every match, as before', async () => {
    const r = await onEach(async (s) => (await s.listMemoryMeta(big, { prefix: 'big.' })).map(m => m.key).sort());
    expect(same(r)).toHaveLength(500);
  });
});

describe('the filters come before the LIMIT', () => {
  const o = owner('flt');
  beforeAll(async () => {
    const old = new Date(Date.now() - 3 * 3_600_000).toISOString();
    for (const { storage } of provs) {
      await storage.setMemory(mem(o, 'f.a', { tags: ['x'] }));
      await storage.setMemory(mem(o, 'f.b', { tags: ['y'] }));
      await storage.setMemory(mem(o, 'f.c', { tags: ['x', 'y'] }));
      await storage.setMemory(mem(o, 'f.d', { tags: ['x'], flagCount: 5 }));
      await storage.setMemory(mem(o, 'f.e', { tags: ['x'], ttlHours: 1, createdAt: old, updatedAt: old }));
      await storage.setMemory(mem(o, 'f.f', { tags: ['x'] }));
      await storage.deleteMemory(o, 'f.f');
      await storage.setMemory(mem(o, 'f.g', { tags: ['x'] }));
    }
  });

  it('tags, maxFlags, the bin and an expired row are left out before two rows are taken', async () => {
    const r = await onEach(async (s) => ({
      tagged: (await s.listMemory(o, { tags: ['x'], maxFlags: 1, limit: 2 })).map(m => m.key),
      both: (await s.listMemoryMeta(o, { tags: ['x', 'y'], limit: 5 })).map(m => m.key),
      rest: (await s.listMemoryMeta(o, { tags: ['x'], maxFlags: 1, limit: 5, after: 'f.c' })).map(m => m.key),
    }));
    expect(same(r)).toEqual({ tagged: ['f.a', 'f.c'], both: ['f.c'], rest: ['f.g'] });
  });
});

describe('a many-owner listing pages by key and then owner', () => {
  const a = owner('ma');
  const b = owner('mb');
  beforeAll(async () => {
    for (const { storage } of provs) {
      for (const k of ['m.1', 'm.2', 'm.3']) {
        await storage.setMemory(mem(a, k));
        await storage.setMemory(mem(b, k));
      }
    }
  });

  it('limit cuts inside a key, and afterOwner continues with the next owner of that key', async () => {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const r = await onEach(async (s) => {
      const first = await s.listMemoryForOwners([a, b], { limit: 3 });
      const last = first[first.length - 1]!;
      const next = await s.listMemoryMetaForOwners([a, b], { limit: 3, after: last.key, afterOwner: last.ownerGaii });
      return { first: first.map(m => `${m.key} ${m.ownerGaii}`), next: next.map(m => `${m.key} ${m.ownerGaii}`) };
    });
    expect(same(r)).toEqual({
      first: [`m.1 ${lo}`, `m.1 ${hi}`, `m.2 ${lo}`],
      next: [`m.2 ${hi}`, `m.3 ${lo}`, `m.3 ${hi}`],
    });
  });
});

describe('on SQLite the LIMIT is in the statement', () => {
  it('the statement carries LIMIT and hands back ten rows of a thousand', async () => {
    const s = new SqliteStorage(':memory:');
    const o = 'limitsql@node';
    const rows: MemoryRecord[] = [];
    for (let i = 0; i < 1000; i++) rows.push(mem(o, `k.${String(i).padStart(4, '0')}`));
    await s.bulkSetMemory(rows);
    const db = (s as unknown as { db: { prepare: (sql: string) => object } }).db;
    const realPrepare = db.prepare.bind(db);
    const seen: Array<{ sql: string; rows: number }> = [];
    db.prepare = (sql: string) => {
      const st = realPrepare(sql) as { all: (...a: unknown[]) => unknown[] };
      return new Proxy(st, {
        get(t, p) {
          if (p === 'all') return (...a: unknown[]) => { const out = t.all(...a); seen.push({ sql, rows: out.length }); return out; };
          const v = Reflect.get(t, p) as unknown;
          return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(t) : v;
        },
      });
    };
    const page = await s.listMemory(o, { limit: 10 });
    db.prepare = realPrepare;
    expect(page).toHaveLength(10);
    const listing = seen.find(x => x.sql.startsWith('SELECT * FROM memory WHERE ownerGaii'));
    expect(listing?.sql).toMatch(/ORDER BY key, ownerGaii LIMIT \?$/);
    expect(listing?.rows).toBe(10);
  });
});

describe("GET /v1/memory's bounded listing (services/memory-list-page.ts)", () => {
  const o = owner('pv');
  const values: Array<[string, unknown]> = [
    ['p.a', { text: 'ÄÖ ✓ 日本語 🧠', n: 12.5, arr: [1, null, true] }],
    ['p.b', 'plain'],
    ['openrouter.apikey', { key: 'sk-or-secret-value-that-is-long', saved: true }],
    ['ai.apikey.provider.mine', 'sk-provider-secret'],
    ['organism.o1.w.ws1.meta.share', { token: 't', passwordHash: 'h'.repeat(60), icsKeyHash: '' }],
    ['p.c', [{ deep: { deeper: 'x'.repeat(300) } }]],
  ];
  beforeAll(async () => {
    for (const { storage } of provs) for (const [k, v] of values) await storage.setMemory(mem(o, k, { value: v }));
  });

  it('the byte sum equals JSON.stringify of each shown value, the masked records included', async () => {
    const r = await onEach(async (s) => {
      const meta = await s.listMemoryMeta(o);
      const full = await s.listMemory(o);
      const expected = full.reduce((n, rec) => n + Buffer.byteLength(JSON.stringify(shownMemoryValue(rec.key, rec.value)), 'utf8'), 0);
      return { got: await shownMemoryBytes(s, meta), expected };
    });
    for (const v of Object.values(r)) expect(v.got).toBe(v.expected);
    same(r);
  });

  it('the page reads the values of its own rows only, masked, in the page order', async () => {
    const r = await onEach(async (s) => {
      const meta = (await s.listMemoryMeta(o)).sort((x, y) => (x.key < y.key ? 1 : -1));
      const asked: string[] = [];
      const counting = new Proxy(s, {
        get(target, prop, recv) {
          if (prop === 'getMemoryByKeys') return async (owner: string, keys: string[]) => { asked.push(...keys); return target.getMemoryByKeys!(owner, keys); };
          return Reflect.get(target, prop, recv);
        },
      });
      const page = await memoryPageWithValues(counting as Storage, meta.slice(0, 3).map((m, i) => (i === 0 ? { ...m, alsoUnder: ['x#y@node'] } : m)));
      return { asked: asked.sort(), page: page.map(p => ({ key: p.key, value: p.value, alsoUnder: (p as { alsoUnder?: string[] }).alsoUnder })) };
    });
    const out = same(r);
    expect(out.asked).toEqual(['p.c', 'p.b', 'p.a'].sort());
    expect(out.page.map(p => p.key)).toEqual(['p.c', 'p.b', 'p.a']);
    expect(out.page[0]!.alsoUnder).toEqual(['x#y@node']);
    const secret = await memoryPageWithValues(provs[0]!.storage, (await provs[0]!.storage.listMemoryMeta(o, { prefix: 'openrouter.' })));
    expect(secret[0]!.value).toEqual({ configured: true });
  });
});
