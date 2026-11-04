/**
 * @file test/unit/memory-shape-reads.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MemoryShapeRepository reads (codebase analysis 2026-11-03, item C7) against the
 *   reads they replace, on seeded data, on every configured provider. Each case computes the OLD
 *   answer the way the old code did (every row with its value, filtered and sorted in JavaScript) and
 *   requires the new SQL read to give the same rows in the same order:
 *   - the notification bell's page, unread count and total, for every limit and both filters, with
 *     rows whose `id` and `read` take every JSON type (JavaScript truthiness), rows created in the
 *     same millisecond, an expired, an archived, a binned and another owner's row;
 *   - the by-id lookup the mark-read and answered routes use;
 *   - the app-tool manifest scan's key shape, against listAllMemory filtered in JavaScript.
 *
 *   OLD ORDER OF A TIE. Two notifications created in the same millisecond had the order of the old
 *   per-owner list, which named no ORDER BY: on SQLite that is the (ownerGaii, key) index, so key
 *   order; on PostgreSQL it was whatever the plan gave. The new read orders a tie by key, so on SQLite
 *   it is the old answer exactly, and on PostgreSQL it is one of the orders the old read could give.
 *   The comparison therefore breaks ties by key on both, and on SQLite also compares the raw old order.
 *
 *   A run without DATABASE_URL checks SQLite only.
 * @structure provs · seedInbox · oldInbox · cases
 * @usage cd aimeat && DATABASE_URL=postgresql://… pnpm exec vitest run test/unit/memory-shape-reads.test.ts
 * @version-history
 *   2026-11-04 — Initial (codebase analysis 2026-11-03, item C7).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import { listOwnerNotificationRecords, readNotificationInbox, findOwnerNotificationsByIds } from '../../src/services/notification-sweeps.js';
import { NOTIF_PREFIX } from '../../src/services/notify.js';

const SQLITE_PATH = `./test/.memory-shape-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';

interface Provider { name: string; storage: Storage }
const provs: Provider[] = [];
const RUN = randomUUID().slice(0, 8);

beforeAll(async () => {
  provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
  if (PG_URL) provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
  console.info(`[memory-shape] providers checked: ${provs.map(p => p.name).join(', ')}`);
}, 60_000);

afterAll(async () => {
  for (const { storage } of provs) await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = SQLITE_PATH + suffix;
    if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch file */ } }
  }
});

interface Seeded { owner: string; ids: string[] }

/** A notification record as notify() writes it, with `over` laid on the value. */
function notif(owner: string, at: string, over: Record<string, unknown> = {}, rec: Partial<MemoryRecord> = {}): MemoryRecord {
  const id = randomUUID();
  return {
    key: `${NOTIF_PREFIX}${at}.${id.slice(0, 8)}`, ownerGaii: owner,
    value: { id, type: 'test', title: `t ${at}`, body: '', link: '', actions: [], read: false, createdAt: at, ...over },
    visibility: 'private', tags: ['notif'], ttlHours: 24 * 90, version: 1, createdAt: at, updatedAt: at, ...rec,
  };
}

/** An inbox with every shape the old filter decided on. */
async function seedInbox(s: Storage, tag: string): Promise<Seeded> {
  const owner = `inbox${tag}@node`;
  const base = Date.now() - 3_600_000;
  const at = (ms: number) => new Date(base + ms).toISOString();
  const rows: MemoryRecord[] = [];
  for (let i = 0; i < 12; i++) rows.push(notif(owner, at(i * 1000), { read: i % 3 === 0 }));
  // Three created in the same millisecond, one of them read.
  for (let i = 0; i < 3; i++) rows.push(notif(owner, at(20_000), { read: i === 1 }));
  // `read` in every JSON type: truthy 1, 'yes', {}, []; falsy 0, '', null, absent.
  for (const [i, read] of [1, 'yes', {}, [], 0, '', null].entries()) rows.push(notif(owner, at(30_000 + i * 10), { read }));
  const absent = notif(owner, at(30_500)); delete (absent.value as Record<string, unknown>).read; rows.push(absent);
  // `id` in every JSON type: only a truthy id counts.
  for (const [i, id] of [0, '', null, false, true, 7, {}].entries()) rows.push(notif(owner, at(40_000 + i * 10), { id }));
  const noId = notif(owner, at(40_500)); delete (noId.value as Record<string, unknown>).id; rows.push(noId);
  // A value that is not an object.
  rows.push({ ...notif(owner, at(41_000)), value: 'just text' });
  rows.push({ ...notif(owner, at(41_100)), value: [1, 2] });
  // Expired (created two hours ago with a one-hour life), archived, binned, and another owner's.
  rows.push(notif(owner, new Date(Date.now() - 7_200_000).toISOString(), {}, { ttlHours: 1 }));
  const archived = notif(owner, at(50_000)); rows.push(archived);
  const binned = notif(owner, at(51_000)); rows.push(binned);
  rows.push(notif(`other${tag}@node`, at(52_000)));
  // A row outside the prefix.
  rows.push({ ...notif(owner, at(53_000)), key: `notifx.${tag}` });
  for (const r of rows) await s.setMemory(r);
  await s.archiveMemoryByKey(archived.key, { archivedRoot: archived.key, archivedBy: 'test', archivedAt: new Date().toISOString(), match: 'exact' });
  await s.deleteMemory(owner, binned.key, 'test');
  return { owner, ids: rows.map(r => (r.value as { id?: unknown })?.id).filter((v): v is string => typeof v === 'string' && v.length > 0) };
}

type V = { id: string; read?: unknown; createdAt: string };

/** The old route: every row, newest createdAt first (stable over the old read's order), then filter and slice. */
function oldInbox(all: MemoryRecord[], limit: number, unreadOnly: boolean) {
  const mine = all.map(r => r.value as V);
  const unread = mine.filter(n => !n.read).length;
  const list = (unreadOnly ? mine.filter(n => !n.read) : mine).slice(0, limit);
  return { ids: list.map(v => v.id), unread, total: mine.length };
}

/** The old read with a tie broken by key, the order SQLite's index gave and one PostgreSQL could give. */
async function oldRecordsKeyTies(s: Storage, owner: string): Promise<MemoryRecord[]> {
  const rows = (await s.listMemory(owner, { prefix: NOTIF_PREFIX }))
    .filter(r => r.value && typeof r.value === 'object' && (r.value as V).id)
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return rows.sort((a, b) => ((b.value as V).createdAt || '').localeCompare((a.value as V).createdAt || ''));
}

describe('the notification bell reads its page and counts in SQL (C7)', () => {
  it('answers the same page, unread count and total as the old read, for every limit and both filters', async () => {
    for (const { name, storage: s } of provs) {
      const { owner } = await seedInbox(s, `${RUN}${name.slice(0, 2)}a`);
      const old = await oldRecordsKeyTies(s, owner);
      expect(old.length).toBeGreaterThan(20);
      for (const unreadOnly of [false, true]) {
        for (const limit of [1, 2, 3, 13, 14, 15, 16, 50, 200]) {
          const want = oldInbox(old, limit, unreadOnly);
          const got = await readNotificationInbox(s, owner, { limit, unreadOnly });
          expect({ provider: name, limit, unreadOnly, ids: got.rows.map(r => (r.value as V).id), unread: got.unread, total: got.total })
            .toEqual({ provider: name, limit, unreadOnly, ...want });
          // The rows are the stored records, values whole.
          expect(got.rows.map(r => r.value)).toEqual(old.filter(r => !unreadOnly || !(r.value as V).read).slice(0, limit).map(r => r.value));
        }
      }
      if (name === 'sqlite') {
        // On SQLite the old read itself, unsorted by key, gives the same sequence.
        const raw = await listOwnerNotificationRecords(s, owner);
        expect(raw.map(r => r.key)).toEqual(old.map(r => r.key));
      }
    }
  });

  it('counts JavaScript truthiness of id and read for every JSON type', async () => {
    for (const { name, storage: s } of provs) {
      const { owner } = await seedInbox(s, `${RUN}${name.slice(0, 2)}b`);
      const all = await s.listMemory(owner, { prefix: NOTIF_PREFIX });
      const counted = all.filter(r => r.value && typeof r.value === 'object' && (r.value as V).id).map(r => r.value as V);
      expect(await s.countInboxRows(owner, NOTIF_PREFIX)).toEqual({ total: counted.length, unread: counted.filter(v => !v.read).length });
    }
  });

  it('finds notifications by id as the old filter over every row did', async () => {
    for (const { name, storage: s } of provs) {
      const { owner, ids } = await seedInbox(s, `${RUN}${name.slice(0, 2)}c`);
      const old = await oldRecordsKeyTies(s, owner);
      const asks: unknown[][] = [[ids[0]], [ids[3], ids[13], ids[14]], [ids[5], 'nope', 42, null, ''], [], ['%', '*', '_x', '[a]']];
      for (const ask of asks) {
        const set = new Set(ask);
        const want = old.filter(r => set.has((r.value as V).id)).map(r => r.key);
        const got = await findOwnerNotificationsByIds(s, owner, ask);
        expect({ provider: name, keys: got.map(r => r.key) }).toEqual({ provider: name, keys: want });
      }
    }
  });

  it('the unread-only read with no limit is every unread row (mark all read)', async () => {
    for (const { name, storage: s } of provs) {
      const { owner } = await seedInbox(s, `${RUN}${name.slice(0, 2)}d`);
      const old = await oldRecordsKeyTies(s, owner);
      const got = await s.listInboxRows(owner, NOTIF_PREFIX, { unreadOnly: true });
      expect(got.map(r => r.key)).toEqual(old.filter(r => !(r.value as V).read).map(r => r.key));
    }
  });
});

describe('the key-shape listing (C7, the app-tool scan)', () => {
  it('lists the rows listAllMemory lists for the prefix, filtered to the suffix and visibility, in the same order', async () => {
    for (const { name, storage: s } of provs) {
      const tag = `${RUN}${name.slice(0, 2)}`;
      const prefix = `shape${tag}.`;
      const now = new Date().toISOString();
      const put = (owner: string, key: string, visibility: 'public' | 'private') => s.setMemory({
        key, ownerGaii: owner, value: { tools: [{ name: key }] }, visibility, tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
      });
      await put(`b${tag}@node`, `${prefix}one.html.tools`, 'public');
      await put(`a${tag}@node`, `${prefix}one.html.tools`, 'public');
      await put(`a${tag}@node`, `${prefix}two.tools`, 'private');
      await put(`a${tag}@node`, `${prefix}two.config`, 'public');
      await put(`a${tag}@node`, `${prefix}x_y%z.tools`, 'public');
      await put(`a${tag}@node`, `${prefix}.tools`, 'public');
      await put(`a${tag}@node`, `${prefix}three.toolsX`, 'public');
      await put(`a${tag}@node`, `${prefix.toUpperCase()}four.tools`, 'public');
      const all = (await s.listAllMemory({ prefix })).items;
      const want = all.filter(r => r.key.endsWith('.tools') && r.visibility === 'public');
      const got = await s.listAllMemoryByKeyShape(prefix, '.tools', { visibility: 'public' });
      expect({ provider: name, rows: got.map(r => [r.ownerGaii, r.key]) }).toEqual({ provider: name, rows: want.map(r => [r.ownerGaii, r.key]) });
      expect(got.map(r => r.value)).toEqual(want.map(r => r.value));
      const meta = await s.listAllMemoryMetaByKeyShape(prefix, '.tools', { visibility: 'public' });
      expect(meta.map(r => [r.ownerGaii, r.key, r.version, r.updatedAt])).toEqual(want.map(r => [r.ownerGaii, r.key, r.version, r.updatedAt]));
      expect(meta.every(r => !('value' in r))).toBe(true);
      expect((await s.listAllMemoryByKeyShape(prefix, '.tools', { limit: 1 })).map(r => r.key)).toEqual([all.filter(r => r.key.endsWith('.tools'))[0]!.key]);
    }
  });
});
