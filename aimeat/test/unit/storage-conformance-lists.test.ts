/**
 * @file test/unit/storage-conformance-lists.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The second half of the storage contract test (storage-conformance.test.ts is the
 *   first): what a LIST returns, compared between the two providers as a SEQUENCE and not a set. The
 *   QA audit of 2026-10 found four places where the two providers answered the same call differently
 *   and every test passed, because each assertion filtered, counted or sorted before comparing:
 *   - D4-01/E4-01: an expired memory row was never removed on PostgreSQL and kept counting;
 *   - D4-04: wallet history came back oldest first on SQLite and newest first on PostgreSQL, and three
 *     lists had no order on PostgreSQL;
 *   - D4-05: the cross-owner memory listing took its window in JavaScript on PostgreSQL;
 *   - D4-07: a key prefix ignored case on SQLite and `_` was a wildcard on both.
 *   Each case runs on every configured provider and, where both run, requires the same sequence.
 *
 *   Like the first half, a run without DATABASE_URL checks SQLite only, and a configured Postgres that
 *   does not connect fails the suite.
 * @structure provs · seed helpers · cases: TTL sweep, key prefix, cross-owner window, wallet order,
 *   ordered lists
 * @usage cd aimeat && DATABASE_URL=postgresql://… pnpm exec vitest run test/unit/storage-conformance-lists.test.ts
 * @version-history
 *   2026-10-25 — Subdomain sites: listSubdomainSitesPage pages in byte order of the label, and origin
 *     round-trips on create and update (secaudit2026oct22).
 *   2026-10-16 — Initial (QA audit P4-09, D4-01, E4-01, D4-04, D4-05, D4-07).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import { createdAccountIsOperator } from '../../src/services/owner-provisioning.js';

const SQLITE_PATH = `./test/.conformance-lists-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';
const REQUIRE_POSTGRES = process.env.AIMEAT_CONFORMANCE_REQUIRE_POSTGRES === 'true';

interface Provider { name: string; storage: Storage }
const provs: Provider[] = [];
const RUN = randomUUID().slice(0, 8);

beforeAll(async () => {
  if (REQUIRE_POSTGRES && !PG_URL) throw new Error('Postgres conformance requires DATABASE_URL.');
  provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
  if (PG_URL) provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
  console.info(`[conformance-lists] providers checked: ${provs.map(p => p.name).join(', ')}`);
}, 60_000);

afterAll(async () => {
  for (const { storage } of provs) await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = SQLITE_PATH + suffix;
    if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch file */ } }
  }
});

function mem(ownerGaii: string, key: string, over: Partial<MemoryRecord> = {}): MemoryRecord {
  const now = new Date().toISOString();
  return { key, ownerGaii, value: { k: key }, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now, ...over };
}

/** Run `fn` on every provider and return the results keyed by provider name. */
async function onEach<T>(fn: (s: Storage, p: string) => Promise<T>): Promise<Record<string, T>> {
  const out: Record<string, T> = {};
  for (const { name, storage } of provs) out[name] = await fn(storage, `${RUN}${name.slice(0, 2)}`);
  return out;
}

/** Where both providers ran, they must agree. */
function same<T>(results: Record<string, T>): T {
  const values = Object.values(results);
  for (const v of values.slice(1)) expect(v).toEqual(values[0]);
  return values[0]!;
}

describe('the TTL sweep (QA audit D4-01, E4-01)', () => {
  it('removes an expired row of a person and of an agent from the table and the count, and keeps a live one', async () => {
    const r = await onEach(async (s, p) => {
      const person = `ttlp${p}@node`;
      const agent = `bot#ttlp${p}@node`;
      const old = new Date(Date.now() - 2 * 3_600_000).toISOString();
      await s.setMemory(mem(person, 'lease.a', { ttlHours: 1, createdAt: old, updatedAt: old }));
      await s.setMemory(mem(agent, 'lease.b', { ttlHours: 1, createdAt: old, updatedAt: old }));
      await s.setMemory(mem(person, 'lease.live', { ttlHours: 5 }));
      await s.setMemory(mem(person, 'plain', { ttlHours: null, createdAt: old, updatedAt: old }));
      const before = await s.countMemory([person, agent]);
      const removed = await s.deleteExpiredMemory(new Date().toISOString());
      const after = await s.countMemory([person, agent]);
      // The expired key is free again: a create-only write takes it (it answered null on PostgreSQL).
      const created = await s.createMemoryIfAbsent!(mem(person, 'lease.a', { value: { again: true } }));
      return { before, removedAtLeast: removed >= 2, after, recreated: created !== null, live: (await s.getMemory(person, 'lease.live')) !== null };
    });
    expect(same(r)).toEqual({ before: 4, removedAtLeast: true, after: 2, recreated: true, live: true });
  });
});

describe('a key prefix is literal and case-sensitive (QA audit D4-07)', () => {
  it('list, count, subtree delete and prefix delete do not widen on case, _ or %', async () => {
    const r = await onEach(async (s, p) => {
      const o = `pfx${p}@node`;
      for (const key of ['Notes.a', 'notes.b', 'a_b', 'a_b.x', 'aXb.y', 'p%q.r', 'pZq.s', 'gl*b.t', 'glob.u']) await s.setMemory(mem(o, key));
      const list = (await s.listMemory(o, { prefix: 'Notes.' })).map(m => m.key).sort();
      const count = await s.countMemory([o], { prefix: 'a_b.' });
      const pct = (await s.listMemory(o, { prefix: 'p%q.' })).map(m => m.key);
      const star = (await s.listMemory(o, { prefix: 'gl*b.' })).map(m => m.key);
      const all = (await s.listAllMemory({ prefix: 'a_b', ownerPrefix: o })).items.map(m => m.key).sort();
      const subtree = await s.deleteMemorySubtree!(o, 'a_b');
      const left = (await s.listMemory(o)).map(m => m.key).sort();
      return { list, count, pct, star, all, subtree, left };
    });
    expect(same(r)).toEqual({
      list: ['Notes.a'], count: 1, pct: ['p%q.r'], star: ['gl*b.t'], all: ['a_b', 'a_b.x'], subtree: 2,
      left: ['Notes.a', 'aXb.y', 'gl*b.t', 'glob.u', 'notes.b', 'p%q.r', 'pZq.s'].sort(),
    });
  });
});

describe('the cross-owner listing window (QA audit D4-05)', () => {
  it('pages in SQL over live rows only, in one stable order, with a total of live rows', async () => {
    const r = await onEach(async (s, p) => {
      const prefix = `win${p}.`;
      const owners = [`wa${p}@node`, `wb${p}@node`];
      const old = new Date(Date.now() - 2 * 3_600_000).toISOString();
      for (let i = 0; i < 30; i++) {
        for (const o of owners) {
          const expired = i % 7 === 3;   // expired rows sit inside the windows, not only at the end
          await s.setMemory(mem(o, `${prefix}${String(i).padStart(3, '0')}`, expired ? { ttlHours: 1, createdAt: old, updatedAt: old } : {}));
        }
      }
      const pages: string[] = [];
      let total = -1;
      for (let offset = 0; offset < 80; offset += 9) {
        const page = await s.listAllMemory({ prefix, limit: 9, offset });
        total = page.total;
        expect(page.items.length).toBeLessThanOrEqual(9);
        pages.push(...page.items.map(m => `${m.key}|${m.ownerGaii}`));
      }
      const whole = (await s.listAllMemory({ prefix })).items.map(m => `${m.key}|${m.ownerGaii}`);
      const meta = await s.listAllMemoryMeta({ prefix, limit: 9, offset: 9 });
      return { total, pagesEqualWhole: JSON.stringify(pages) === JSON.stringify(whole), count: whole.length, metaTotal: meta.total, metaPage: meta.items.map(m => `${m.key}|${m.ownerGaii}`.split(p).join('')), firstKeys: whole.slice(0, 3).map(k => k.split(p).join('')) };
    });
    const v = same(r);
    // 30 keys × 2 owners, minus the expired ones (i = 3, 10, 17, 24 → 4 keys × 2 owners).
    expect(v.total).toBe(52);
    expect(v.count).toBe(52);
    expect(v.metaTotal).toBe(52);
    expect(v.pagesEqualWhole).toBe(true);
    expect(v.metaPage.length).toBe(9);
  });
});

describe('wallet history order (QA audit D4-04)', () => {
  it('getTransactions returns the newest rows newest first, as one sequence of ids', async () => {
    const r = await onEach(async (s, p) => {
      const g = `wal${p}@node`;
      const t0 = Date.now() - 100_000;
      for (let i = 0; i < 8; i++) {
        await s.addTransaction({ id: `tx-${p}-${i}`, gaii: g, type: 'credit', amount: i + 1, timestamp: new Date(t0 + i * 1000).toISOString() });
      }
      return (await s.getTransactions(g, 5)).map(t => t.id.replace(`tx-${p}-`, ''));
    });
    expect(same(r)).toEqual(['7', '6', '5', '4', '3']);
  });
});

describe('the operator question without the owner table (QA audit P7-10)', () => {
  it('operatorAccountState agrees with a read of every owner, and registration asks it instead of listing owners', async () => {
    for (const { storage: s } of provs) {
      await s.createOwner({ name: `opst${RUN}`, displayName: 'x', publicKey: 'pk', roles: ['owner', 'operator'], createdAt: new Date().toISOString() });
      const all = await s.listOwners();
      expect(await s.operatorAccountState()).toEqual({
        anyOwner: all.some(o => o.name !== 'anonymous'),
        anyOperator: all.some(o => (o.roles ?? []).includes('operator')),
      });
      // Every registration asks whether the new account is the operator. It loaded every owner to answer.
      const noTableScan = new Proxy(s, {
        get(target, prop, recv) {
          if (prop === 'listOwners') return () => { throw new Error('listOwners was called'); };
          const v = Reflect.get(target, prop, recv);
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
      await expect(createdAccountIsOperator(noTableScan)).resolves.toBe(false);
    }
  });
});

describe('lists that had no order on PostgreSQL (QA audit D4-04)', () => {
  it('listReviews is in timestamp order, so the last element is the latest review', async () => {
    const r = await onEach(async (s, p) => {
      const pkg = `packages/${p}/manifest`;
      const t0 = Date.now() - 50_000;
      for (const i of [2, 0, 3, 1]) {
        await s.createReview({ id: randomUUID(), packageId: pkg, operatorGaii: `op${p}@node`, reason: 'routine_review', action: 'note', customText: `r${i}`, timestamp: new Date(t0 + i * 1000).toISOString() });
      }
      return (await s.listReviews(pkg)).map(x => x.customText);
    });
    expect(same(r)).toEqual(['r0', 'r1', 'r2', 'r3']);
  });

  it('listSystemPrompts is ordered by group and name, and listNotificationTemplates by id and locale', async () => {
    const r = await onEach(async (s, p) => {
      for (const [group, name] of [['zz' + p, 'b'], ['aa' + p, 'z'], ['zz' + p, 'a'], ['aa' + p, 'c']]) {
        await s.upsertSystemPrompt({ id: `${group}.${name}`, group, name, description: '', content: 'x', active: true, variables: [], usedIn: [], version: 1, updatedAt: new Date().toISOString(), updatedBy: 'op' });
      }
      for (const [id, locale] of [[`t2${p}`, 'fi'], [`t1${p}`, 'fi'], [`t2${p}`, 'en'], [`t1${p}`, 'en']]) {
        await s.upsertNotificationTemplate({ id, locale, fields: { body: 'b' }, placeholders: [], updatedAt: new Date().toISOString(), updatedBy: 'op' });
      }
      const prompts = (await s.listSystemPrompts()).filter(x => x.group.endsWith(p)).map(x => `${x.group.slice(0, 2)}.${x.name}`);
      const templates = (await s.listNotificationTemplates()).filter(t => t.id.endsWith(p)).map(t => `${t.id.slice(0, 2)}.${t.locale}`);
      return { prompts, templates };
    });
    expect(same(r)).toEqual({ prompts: ['aa.c', 'aa.z', 'zz.a', 'zz.b'], templates: ['t1.en', 't1.fi', 't2.en', 't2.fi'] });
  });
});

describe('subdomain sites: the keyset page and the origin (secaudit2026oct22)', () => {
  it('pages in byte order of the label, and writes and reads origin back', async () => {
    const r = await onEach(async (s, p) => {
      const at = new Date().toISOString();
      const site = (subdomain: string, origin?: 'operator' | 'publisher') =>
        s.createSubdomainSite({ subdomain, kind: 'app', target: `o${p}/a.html`, enabled: true, createdBy: `o${p}@node`, createdAt: at, updatedAt: at, ...(origin ? { origin } : {}) });
      // '-' sorts before 'a' in byte order; a locale collation that skips '-' would give another sequence.
      await site(`${p}a`); await site(`${p}-b`, 'publisher'); await site(`${p}-a-2`); await site(`${p}-a`, 'operator');
      await s.updateSubdomainSite(`${p}a`, { origin: 'operator' });
      const seen: string[] = [];
      let after = p;
      for (let i = 0; i < 5; i++) {
        const page = await s.listSubdomainSitesPage({ after, limit: 2 });
        const mine = page.filter(x => x.subdomain.startsWith(p));
        if (!mine.length) break;
        seen.push(...mine.map(x => `${x.subdomain.slice(p.length)}:${x.origin ?? 'null'}`));
        after = page[page.length - 1]!.subdomain;
      }
      return seen;
    });
    expect(same(r)).toEqual(['-a:operator', '-a-2:null', '-b:publisher', 'a:operator']);
  });
});
