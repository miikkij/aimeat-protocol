/**
 * @file test/unit/signals-concurrency.test.ts
 * @description Does a hit that arrives while another is being written actually survive?
 *
 *   WHY THIS IS A UNIT TEST AND NOT AN E2E. The E2E version of this question passes with the
 *   compare-and-swap taken out, and it was measured doing exactly that before this file existed:
 *   the SQLite backend is synchronous, so a whole read-modify-write completes without ever yielding
 *   and the two hits simply queue. A test that cannot fail is worse than no test, because it reads
 *   as proof. The same trap is on record in the businesslauncher inventory work — a race test over
 *   a synchronous store proves nothing about a race.
 *
 *   So the store here is asynchronous the way a real one over a socket is: every read yields, which
 *   lets all the callers read the SAME version before any of them writes. That is the interleaving
 *   a mail campaign produces for free when two hundred people open a message in the same minute.
 *
 *   The proof obligation is symmetric: with the swap in place all hits land, and with a
 *   last-write-wins store they do not. The second half is asserted here too, so a future change
 *   that quietly drops the swap fails this file instead of silently losing counts.
 * @usage pnpm test -- signals-concurrency
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { recordHit, saveStream, readReport } from '../../src/services/signals/signal-service.js';
import type { Storage } from '../../src/storage/interface.js';

const OWNER = 'alice@aimeat-test';

/**
 * A memory store that behaves like a real one across a network: reads YIELD, and every read hands
 * back a fresh deep copy the way JSON deserialization does. The copy matters as much as the yield —
 * a fake that returns the same object reference lets two writers mutate one object, and the loss
 * this test exists to catch never happens.
 */
function makeStore(opts: { cas: boolean }): Storage {
  const rows = new Map<string, { value: unknown; version: number; createdAt: string; updatedAt: string }>();
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

  const store = {
    async getMemory(ownerGaii: string, key: string) {
      await Promise.resolve();                       // the yield a real backend cannot avoid
      const row = rows.get(`${ownerGaii}|${key}`);
      return row ? { key, ownerGaii, value: clone(row.value), version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt, visibility: 'owner', tags: [], ttlHours: null } : null;
    },
    async setMemory(rec: { key: string; ownerGaii: string; value: unknown; createdAt: string; updatedAt: string }) {
      await Promise.resolve();
      const id = `${rec.ownerGaii}|${rec.key}`;
      const prev = rows.get(id);
      rows.set(id, { value: clone(rec.value), version: (prev?.version ?? 0) + 1, createdAt: rec.createdAt, updatedAt: rec.updatedAt });
      return rec;
    },
    async listAllMemory({ prefix }: { prefix: string }) {
      await Promise.resolve();
      const items = [...rows.entries()]
        .filter(([id]) => id.split('|')[1].startsWith(prefix))
        .map(([id, row]) => ({ key: id.split('|')[1], ownerGaii: id.split('|')[0], value: clone(row.value), version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt }));
      return { items, total: items.length };
    },
    async deleteMemory(ownerGaii: string, key: string) {
      await Promise.resolve();
      return rows.delete(`${ownerGaii}|${key}`);
    },
  } as unknown as Storage;

  if (opts.cas) {
    // The real primitives: a write lands only if nobody moved the record since it was read.
    (store as unknown as Record<string, unknown>).createMemoryIfAbsent = async (rec: { key: string; ownerGaii: string; value: unknown; createdAt: string; updatedAt: string }) => {
      await Promise.resolve();
      const id = `${rec.ownerGaii}|${rec.key}`;
      if (rows.has(id)) return null;
      rows.set(id, { value: clone(rec.value), version: 1, createdAt: rec.createdAt, updatedAt: rec.updatedAt });
      return rec;
    };
    (store as unknown as Record<string, unknown>).setMemoryIfVersion = async (rec: { key: string; ownerGaii: string; value: unknown; createdAt: string; updatedAt: string }, expected: number) => {
      await Promise.resolve();
      const id = `${rec.ownerGaii}|${rec.key}`;
      const cur = rows.get(id);
      if (!cur || cur.version !== expected) return null;
      rows.set(id, { value: clone(rec.value), version: expected + 1, createdAt: rec.createdAt, updatedAt: rec.updatedAt });
      return rec;
    };
  }
  // Without cas the two optional primitives are ABSENT, which is the documented fallback path in
  // signal-service.ts: a plain upsert, last write wins.
  return store;
}

/**
 * A hit committed by a DIFFERENT node instance: it writes straight to the store, bypassing this
 * process's queue entirely, which is exactly the position a second instance is in.
 */
async function recordHitAsOtherInstance(
  storage: Storage, read: Storage['getMemory'],
): Promise<void> {
  const key = (await storage.listAllMemory({ prefix: 'signals.hits.' })).items[0]?.key;
  if (!key) return;
  const row = await read(OWNER, key);
  if (!row) return;
  const value = row.value as { days: Record<string, { total: number; events: Record<string, number>; channels: Record<string, number>; classes: Record<string, number>; aiAgents: Record<string, number> }>; subjects: Record<string, unknown> };
  const day = new Date().toISOString().slice(0, 10);
  const d = value.days[day] ?? { total: 0, events: {}, channels: {}, classes: {}, aiAgents: {} };
  d.total += 1;
  d.events.open = (d.events.open ?? 0) + 1;
  d.classes.human = (d.classes.human ?? 0) + 1;
  value.days[day] = d;
  value.subjects['other-instance'] = {
    firstAt: new Date().toISOString(), lastAt: new Date().toISOString(),
    events: { open: 1 }, lastRef: null, machine: false,
  };
  await storage.setMemory({ ...row, value } as Parameters<Storage['setMemory']>[0]);
}

async function fireConcurrently(storage: Storage, streamId: string, count: number): Promise<void> {
  await Promise.all(Array.from({ length: count }, (_, i) => recordHit(storage, {
    ownerGhii: OWNER, streamId, event: 'open', subject: `person-${i}`,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/128.0 Safari/537.36',
  })));
}

describe('signals: hits that arrive together', () => {
  it('counts every one of twenty simultaneous opens', async () => {
    const storage = makeStore({ cas: true });
    await saveStream(storage, OWNER, { streamId: 'campaign' });
    await fireConcurrently(storage, 'campaign', 20);

    const report = await readReport(storage, OWNER, 'campaign', { includeSubjects: true });
    expect(report.totals.hits).toBe(20);
    expect(Object.keys(report.subjects ?? {})).toHaveLength(20);
  });

  it('does not overwrite a hit a SECOND node instance counted mid-write', async () => {
    // What the in-process queue cannot see. Two instances behind one address both hold the month
    // record open; the other one commits first, and this one must notice and re-apply rather than
    // write its own copy over the top. Simulated by moving the record on underneath us exactly
    // once, which is what the losing side of a real swap experiences.
    const storage = makeStore({ cas: true });
    await saveStream(storage, OWNER, { streamId: 'campaign' });
    await recordHit(storage, { ownerGhii: OWNER, streamId: 'campaign', event: 'open', subject: 'first' });

    let interfered = false;
    const realGet = storage.getMemory.bind(storage);
    (storage as unknown as Record<string, unknown>).getMemory = async (owner: string, key: string) => {
      const row = await realGet(owner, key);
      if (!interfered && key.startsWith('signals.hits.')) {
        interfered = true;
        // The other instance's hit lands here, between our read and our write.
        await recordHitAsOtherInstance(storage, realGet);
      }
      return row;
    };

    await recordHit(storage, { ownerGhii: OWNER, streamId: 'campaign', event: 'click', subject: 'second' });

    const report = await readReport(storage, OWNER, 'campaign', { includeSubjects: true });
    expect(interfered).toBe(true);
    // Three hits exist: ours, the other instance's, and the one that opened the record.
    expect(report.totals.hits).toBe(3);
    expect(Object.keys(report.subjects ?? {}).sort()).toEqual(['first', 'other-instance', 'second']);
  });

  it('keeps one key per stream per month however many hits land', async () => {
    const storage = makeStore({ cas: true });
    await saveStream(storage, OWNER, { streamId: 'campaign' });
    await fireConcurrently(storage, 'campaign', 50);

    const { items } = await storage.listAllMemory({ prefix: 'signals.hits.campaign.' });
    expect(items).toHaveLength(1);
  });
});
