/**
 * @file test/unit/memory-totals.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The kept memory totals (storage.getMemoryTotals, codebase analysis 2026-11-03, item
 *   C3), on SQLite and, with DATABASE_URL, on PostgreSQL:
 *   - after every step of a mixed sequence of writes, overwrites, bin and restore, archive, the TTL
 *     sweep, bulk writes and deletes, the kept totals equal a full count of the rows: `keys` equals
 *     countMemory with the excluded prefixes, `bytes` equals the provider's SUM over the rows;
 *   - another owner's totals do not move, and an owner whose rows are all gone has zero;
 *   - on PostgreSQL the fold (compactMemoryTotals) keeps the totals and leaves one row per owner;
 *   - the excluded prefixes in the PostgreSQL migration are MEMORY_COUNT_EXCLUDED_PREFIXES;
 *   - one writeMemoryRecord reads the record once, and neither sums nor counts the writer's rows;
 *   - memoryCeilings answers what it answered from the full count, for an update, a new key, the key
 *     ceiling and the byte budget.
 * @usage cd aimeat && DATABASE_URL=postgresql://… pnpm exec vitest run test/unit/memory-totals.test.ts
 * @version-history
 *   2026-11-04 — The full-count storage answers getMemoryTotals by a full count instead of lacking
 *     it, since the method is required (codebase analysis 2026-11-03, item D-e).
 *   2026-11-04 — Initial (codebase analysis 2026-11-03, item C3).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import { MEMORY_COUNT_EXCLUDED_PREFIXES } from '../../src/storage/memory-totals.js';
import { loadConfig } from '../../src/config.js';
import { writeMemoryRecord } from '../../src/services/memory-write.js';
import { memoryCeilings } from '../../src/services/memory-ceilings.js';

const SQLITE_PATH = `./test/.memory-totals-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';
const REQUIRE_POSTGRES = process.env.AIMEAT_CONFORMANCE_REQUIRE_POSTGRES === 'true';
const RUN = randomUUID().slice(0, 8);
const config = loadConfig().config;

interface Provider { name: string; storage: Storage; fullBytes: (owner: string) => Promise<number> }
const provs: Provider[] = [];
let pgClient: pg.Client | null = null;
const owners: string[] = [];

beforeAll(async () => {
  if (REQUIRE_POSTGRES && !PG_URL) throw new Error('Postgres conformance requires DATABASE_URL.');
  const sqlite = await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH });
  const db = (sqlite as unknown as { db: { prepare: (s: string) => { get: (...a: unknown[]) => { s: number } } } }).db;
  provs.push({ name: 'sqlite', storage: sqlite, fullBytes: async o => db.prepare('SELECT COALESCE(SUM(byteSize), 0) AS s FROM memory WHERE ownerGaii = ?').get(o).s });
  if (PG_URL) {
    pgClient = new pg.Client(PG_URL);
    await pgClient.connect();
    const c = pgClient;
    provs.push({
      name: 'postgres-kysely',
      storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }),
      fullBytes: async o => Number((await c.query('SELECT coalesce(sum("byteSize"), 0) AS s FROM "Memory" WHERE "ownerGaii" = $1 AND "archived" = false', [o])).rows[0].s),
    });
  }
}, 60_000);

afterAll(async () => {
  for (const { storage } of provs) {
    for (const o of owners) await storage.deleteAllMemory(o).catch(() => 0);
    await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
  }
  await pgClient?.end();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = SQLITE_PATH + suffix;
    if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch file */ } }
  }
});

function owner(tag: string): string {
  const o = `tot${tag}${RUN}@${config.nodeId}`;
  owners.push(o);
  return o;
}

function mem(ownerGaii: string, key: string, value: unknown, over: Partial<MemoryRecord> = {}): MemoryRecord {
  const now = new Date().toISOString();
  return { key, ownerGaii, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now, ...over };
}

/** The kept totals against a full count of the rows. */
async function expectExact(p: Provider, o: string, step: string): Promise<void> {
  const kept = await p.storage.getMemoryTotals!(o);
  const keys = await p.storage.countMemory([o], { excludePrefixes: [...MEMORY_COUNT_EXCLUDED_PREFIXES] });
  const bytes = await p.fullBytes(o);
  expect(kept, `${p.name}: ${step}`).toEqual({ keys, bytes });
  expect(await p.storage.sumMemoryBytes(o), `${p.name}: sumMemoryBytes after ${step}`).toBe(bytes);
}

describe('the kept memory totals equal a full count after every step', () => {
  it('mixed writes, overwrites, bin, restore, archive, the TTL sweep, bulk writes and deletes', async () => {
    for (const p of provs) {
      const s = p.storage;
      const a = owner(`a${p.name.slice(0, 2)}`);
      const b = owner(`b${p.name.slice(0, 2)}`);
      const old = new Date(Date.now() - 3 * 3_600_000).toISOString();
      await expectExact(p, a, 'nothing written');
      await s.setMemory(mem(b, 'other.one', { keep: 'x'.repeat(50) }));
      const bBefore = await s.getMemoryTotals!(b);

      await s.setMemory(mem(a, 'n.one', { v: 1 }));
      await expectExact(p, a, 'insert');
      await s.setMemory(mem(a, 'n.one', { v: 'longer value ÄÖ ✓ 日本語'.repeat(10) }));
      await expectExact(p, a, 'overwrite');
      await s.setMemory(mem(a, 'n.tracked', { v: 1 }, { trackable: true }));
      await s.setMemory(mem(a, 'n.tracked', { v: 2, more: [1, 2, 3] }));
      await expectExact(p, a, 'trackable overwrite');
      await s.setMemory(mem(a, `${MEMORY_COUNT_EXCLUDED_PREFIXES[0]}k1`, { idem: true }));
      await s.setMemory(mem(a, `${MEMORY_COUNT_EXCLUDED_PREFIXES[1]}k2`, { session: true }));
      await expectExact(p, a, 'keys under the excluded prefixes');
      expect(await s.deleteMemory(a, 'n.one')).toBe(true);
      await expectExact(p, a, 'into the bin');
      expect(await s.restoreMemory(a, 'n.one')).toBe(true);
      await expectExact(p, a, 'out of the bin');
      await s.deleteMemory(a, 'n.one');
      expect(await s.createMemoryIfAbsent!(mem(a, 'n.one', { back: true }))).not.toBeNull();
      await expectExact(p, a, 'a create takes over a binned row');
      const cur = await s.getMemory(a, 'n.one');
      expect(await s.setMemoryIfVersion!(mem(a, 'n.one', { cas: 'y'.repeat(30) }, { version: cur!.version + 1 }), cur!.version)).not.toBeNull();
      await expectExact(p, a, 'compare-and-swap');
      await s.archiveMemoryByKey('n.tracked', { archivedRoot: `root${RUN}`, archivedBy: a, archivedAt: new Date().toISOString(), match: 'exact' });
      await expectExact(p, a, 'archived');
      await s.unarchiveMemoryByRoot(`root${RUN}`);
      await expectExact(p, a, 'unarchived');
      await s.setMemory(mem(a, 'n.expired', { gone: true }, { ttlHours: 1, createdAt: old, updatedAt: old }));
      await expectExact(p, a, 'an expired row');
      await s.deleteExpiredMemory(new Date().toISOString());
      await expectExact(p, a, 'the TTL sweep');
      await s.bulkSetMemory!([mem(a, 'bulk.1', { i: 1 }), mem(a, 'bulk.2', { i: 2 }), mem(a, 'n.one', { bulk: 'overwrite' }), mem(b, 'bulk.b', { i: 3 })]);
      await expectExact(p, a, 'bulk write, new and existing');
      await s.bulkBinMemory!([{ ownerGaii: a, key: 'bulk.1' }]);
      await expectExact(p, a, 'bulk into the bin');
      await s.purgeDeletedMemory(new Date(Date.now() + 60_000).toISOString());
      await expectExact(p, a, 'the bin sweep');
      await s.setMemory(mem(a, 'tree', 1));
      await s.setMemory(mem(a, 'tree.draft', 2));
      await s.deleteMemorySubtree!(a, 'tree');
      await expectExact(p, a, 'subtree delete');
      await s.bulkDeleteMemory!([{ ownerGaii: a, key: 'bulk.2' }]);
      await expectExact(p, a, 'bulk delete');
      await s.setMemory(mem(a, `wipe${RUN}.x`, 1));
      await s.deleteMemoryByPrefix!(`wipe${RUN}.`);
      await expectExact(p, a, 'prefix delete');
      await s.incrementMemoryFlagCount(a, 'n.one');
      await expectExact(p, a, 'an update that changes nothing counted');

      await s.deleteAllMemory(a);
      await expectExact(p, a, 'the owner cascade');
      expect(await s.getMemoryTotals!(a)).toEqual({ keys: 0, bytes: 0 });
      // b got one more row from the bulk write, and nothing else.
      await expectExact(p, b, 'the other owner');
      expect((await s.getMemoryTotals!(b)).keys).toBe(bBefore.keys + 1);
    }
  }, 60_000);

  it('PostgreSQL: the fold keeps every total and leaves one row per owner', async () => {
    const p = provs.find(x => x.name === 'postgres-kysely');
    if (!p || !pgClient) return;
    const o = owner('fold');
    for (let i = 0; i < 5; i++) await p.storage.setMemory(mem(o, `f.${i}`, { i }));
    await p.storage.deleteMemory(o, 'f.0');
    const before = await p.storage.getMemoryTotals!(o);
    const rowsBefore = Number((await pgClient.query('SELECT count(*) AS n FROM "MemoryTotals" WHERE "ownerGaii" = $1', [o])).rows[0].n);
    expect(rowsBefore).toBeGreaterThan(1);
    await p.storage.compactMemoryTotals!();
    expect(await p.storage.getMemoryTotals!(o)).toEqual(before);
    expect(Number((await pgClient.query('SELECT count(*) AS n FROM "MemoryTotals" WHERE "ownerGaii" = $1', [o])).rows[0].n)).toBe(1);
    await expectExact(p, o, 'after the fold');
    await p.storage.deleteAllMemory(o);
    await p.storage.compactMemoryTotals!();
    expect(Number((await pgClient.query('SELECT count(*) AS n FROM "MemoryTotals" WHERE "ownerGaii" = $1', [o])).rows[0].n)).toBe(0);
  });
});

describe('one list of excluded prefixes', () => {
  it('the PostgreSQL migration names exactly MEMORY_COUNT_EXCLUDED_PREFIXES', () => {
    const sql = readFileSync(path.join(process.cwd(), 'src/storage/providers/postgres-kysely/migrations/0125_memory_totals.sql'), 'utf8');
    const named = [...sql.matchAll(/NOT LIKE '([^']+)%'/g)].map(m => m[1]);
    expect(named).toEqual([...MEMORY_COUNT_EXCLUDED_PREFIXES]);
  });
});

describe('one memory write reads the record once and scans none of the writer’s rows', () => {
  /** The storage with every call counted by method name, and getMemory by owner and key. */
  function counted(s: Storage): { storage: Storage; calls: Map<string, number> } {
    const calls = new Map<string, number>();
    const storage = new Proxy(s, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv) as unknown;
        if (typeof v !== 'function' || typeof prop !== 'string') return v;
        return (...a: unknown[]) => {
          const name = prop === 'getMemory' ? `getMemory ${String(a[0])} ${String(a[1])}` : prop;
          calls.set(name, (calls.get(name) ?? 0) + 1);
          return (v as (...x: unknown[]) => unknown).apply(target, a);
        };
      },
    });
    return { storage, calls };
  }

  it('a new key and an update: one read of the record, no SUM and no COUNT over the writer', async () => {
    for (const p of provs) {
      const o = owner(`w${p.name.slice(0, 2)}`);
      const caller = { principal: o, targetGaii: o, scopes: ['memory:write'], roles: ['owner'] };
      for (const step of ['create', 'update']) {
        const { storage, calls } = counted(p.storage);
        const out = await writeMemoryRecord({ storage, config }, caller, { key: 'w.one', value: { step }, visibility: 'private' });
        expect(out.ok, `${p.name} ${step}`).toBe(true);
        expect(calls.get(`getMemory ${o} w.one`) ?? 0, `${p.name} ${step}: reads of the record`).toBe(1);
        expect(calls.get('sumMemoryBytes') ?? 0, `${p.name} ${step}: byte SUM`).toBe(0);
        expect(calls.get('countMemory') ?? 0, `${p.name} ${step}: key COUNT`).toBe(0);
        expect(calls.get('getMemoryTotals') ?? 0, `${p.name} ${step}: kept totals`).toBe(1);
      }
    }
  });
});

describe('memoryCeilings answers what the full count answered', () => {
  /** The storage as it was before the kept totals: a full SUM and COUNT. getMemoryTotals is required
   *  on Storage since 2026-11-04 (item D-e), so it answers here what memoryCeilings computed without
   *  it: countMemory with the excluded prefixes, and the full byte sum. */
  function fullCount(p: Provider): Storage {
    return new Proxy(p.storage, {
      get(target, prop, recv) {
        if (prop === 'getMemoryTotals') return async (o: string) => ({
          keys: await target.countMemory([o], { excludePrefixes: [...MEMORY_COUNT_EXCLUDED_PREFIXES] }),
          bytes: await p.fullBytes(o),
        });
        if (prop === 'sumMemoryBytes') return (o: string) => p.fullBytes(o);
        const v = Reflect.get(target, prop, recv) as unknown;
        return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(target) : v;
      },
    });
  }

  it('an update, a new key, the key ceiling and the byte budget', async () => {
    for (const p of provs) {
      const o = owner(`c${p.name.slice(0, 2)}`);
      for (let i = 0; i < 4; i++) await p.storage.setMemory(mem(o, `c.${i}`, { i, pad: 'z'.repeat(400) }));
      await p.storage.setMemory(mem(o, `${MEMORY_COUNT_EXCLUDED_PREFIXES[0]}x`, 1));
      const configs = [
        config,
        { ...config, memoryMaxKeysPerAgent: 4 },
        { ...config, memoryQuotaMb: 0.001, memoryOverageMorselsPerMbMonth: 10 },
      ];
      const planned = [[{ key: 'c.1', value: { i: 1, pad: 'q'.repeat(800) } }], [{ key: 'c.new', value: { fresh: true } }]];
      for (const cfg of configs) {
        for (const set of planned) {
          const now = await memoryCeilings({ storage: p.storage, config: cfg }, o, set);
          const before = await memoryCeilings({ storage: fullCount(p), config: cfg }, o, set);
          expect(now, `${p.name} ${set[0]!.key} keys ${cfg.memoryMaxKeysPerAgent} quota ${cfg.memoryQuotaMb}`).toEqual(before);
        }
      }
    }
  });
});
