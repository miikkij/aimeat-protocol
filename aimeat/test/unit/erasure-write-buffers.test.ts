/**
 * @file test/unit/erasure-write-buffers.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Erasing an account (eraseOwner, the whole of DELETE /v1/owners/:name below HTTP) while
 *   one of the node's write buffers holds a row of that account. A write buffer takes a row on a
 *   request and writes it later, and the erasure cascade deletes the account's rows in the table it
 *   writes, so a row that waits, or is being written, when the erasure runs must not be stored after
 *   it. One section per buffer.
 *
 *   Two states per buffer, each on a real storage of both providers:
 *     - WAITING: the row is in the buffer when the erasure starts, and the buffer flushes after it;
 *     - BEING WRITTEN: the buffer has taken the row and its storage write is held open by the test
 *       while the erasure runs (the round trip a PostgreSQL write is), then released.
 *   A positive control where the buffer keeps another account's row: that row is stored.
 *   Register finding f-2026-11-13-write-buffers-and-erasure, claim (1). A unit test and not an E2E
 *   suite, because an E2E test cannot hold a buffer's flush or its storage write open.
 *
 *   FAIL FIRST, 2026-11-14, on both providers: every section below was red before its buffer held
 *   the account (the stored row was there after the erasure).
 * @usage cd aimeat && pnpm exec vitest run test/unit/erasure-write-buffers.test.ts
 *   With PostgreSQL: node --env-file=.env.test.postgres-kysely node_modules/vitest/vitest.mjs run test/unit/erasure-write-buffers.test.ts
 * @version-history
 *   v1.2.0 — 2026-11-14 — The memory write tally.
 *   v1.1.0 — 2026-11-14 — The usage call stream.
 *   v1.0.0 — 2026-11-14 — Initial: the consent audit.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { requirePostgresWhenAsked } from './postgres-arm.js';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import { eraseOwner } from '../../src/services/owner-erasure.js';
import { initConsentAuditBuffer, bufferConsentAudit, flushConsentAudit, shutdownConsentAuditBuffer } from '../../src/services/consent-audit-buffer.js';
import { initUsageBuffer, recordUsageCall, flushUsageBuffer, resetUsageBuffer } from '../../src/services/usage/usage-buffer.js';
import { initWriteTallyBuffer, recordMemoryTouch, flushWriteTallyBuffer, resetWriteTallyBuffer } from '../../src/services/data-map/write-tally-buffer.js';

requirePostgresWhenAsked('erasure-write-buffers');

type TestStorage = Storage & { close(): void | Promise<void> };
const names = ['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])];
const providers = new Map<string, TestStorage>();
/** One interval for the whole file, longer than any run: a flush happens only when a test asks. */
const NEVER = 3_600_000;
beforeAll(async () => {
  for (const name of names) providers.set(name, await createStorage({
    provider: name === 'sqlite' ? 'sqlite' : 'postgres-kysely',
    sqlitePath: ':memory:', dbUrl: process.env.DATABASE_URL,
  }) as TestStorage);
}, 60_000);
afterAll(async () => { for (const s of providers.values()) await s.close(); });

const NODE = 'erasure-buffers';
const now = () => new Date().toISOString();

interface People { alice: string; bob: string; aliceGhii: string; bobGhii: string; star: string; scout: string }

/** Two accounts; alice has an agent holding `*` and one holding memory:read only. */
async function people(s: Storage): Promise<People> {
  const tag = randomUUID().slice(0, 8);
  const alice = `alice${tag}`, bob = `bob${tag}`;
  const at = now();
  for (const name of [alice, bob]) {
    await s.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: at });
    await s.createGHII({ ghii: `${name}@${NODE}`, username: name, nodeId: NODE, ownerName: name, displayName: name,
      verificationLevel: 0, totpEnabled: false, createdAt: at, updatedAt: at });
  }
  const aliceGhii = `${alice}@${NODE}`;
  const star = `star#${aliceGhii}`, scout = `scout#${aliceGhii}`;
  for (const [gaii, scopes] of [[star, ['*']], [scout, ['memory:read']]] as const) {
    await s.createAgent({
      name: gaii.split('#')[0], owner: alice, gaii, publicKey: 'pk', trustScore: 50, morselBalance: 0, capabilities: [],
      defaultScopes: [...scopes], createdAt: at, lastSeen: at,
    } as never);
  }
  return { alice, bob, aliceGhii, bobGhii: `${bob}@${NODE}`, star, scout };
}

/**
 * Hold the first call of `method` on `target` open: `began` resolves when it has started, and it
 * answers only after `release()`. A write is held before it reaches storage (`before`); a read that
 * decides a later write is held after it has read (`after`), so the write follows the erasure with
 * what was read before it. Later calls go straight through.
 */
function holdFirst<T extends object>(target: T, method: keyof T & string, when: 'before' | 'after' = 'before'): { began: Promise<void>; release: () => void; restore: () => void } {
  const real = (target[method] as unknown as (...a: unknown[]) => unknown).bind(target);
  let started!: () => void;
  let release!: () => void;
  const began = new Promise<void>(r => { started = r; });
  const released = new Promise<void>(r => { release = r; });
  let first = true;
  (target as Record<string, unknown>)[method] = async (...args: unknown[]) => {
    if (!first) return real(...args);
    first = false;
    if (when === 'before') { started(); await released; return real(...args); }
    const answer = await real(...args);
    started();
    await released;
    return answer;
  };
  return { began, release, restore: () => { delete (target as Record<string, unknown>)[method]; } };
}

/** Let `work` run until it has finished or has nothing left to do but wait. */
async function settledOrWaiting(work: Promise<unknown>): Promise<void> {
  let done = false;
  void work.then(() => { done = true; }, () => { done = true; });
  for (let i = 0; i < 30 && !done; i++) await new Promise(r => setTimeout(r, 20));
}

/** Erase alice while `held` holds a buffer's write open, then release it and wait for both. */
async function eraseDuring(s: Storage, p: People, held: { began: Promise<void>; release: () => void }, write: Promise<unknown>): Promise<void> {
  await held.began;
  const erased = eraseOwner(s, NODE, p.alice);
  await settledOrWaiting(erased);
  held.release();
  await Promise.all([write, erased]);
}

async function until(cond: () => Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 100; i++) { if (await cond()) return; await new Promise(r => setTimeout(r, 20)); }
  throw new Error(`timed out waiting for ${what}`);
}

describe.each(names)('%s: a write buffer and an account erasure', provider => {
  const st = () => providers.get(provider)!;
  afterEach(async () => {
    await shutdownConsentAuditBuffer();
    resetUsageBuffer();
    resetWriteTallyBuffer();
  });

  // ── The consent audit (services/consent-audit-buffer.ts) ──
  const audit = (owner: string, accessor: string) => ({
    id: randomUUID(), consentId: 'none', ownerGaii: owner, accessorGaii: accessor,
    memoryKey: 'notes.a', action: 'read' as const, timestamp: now(), allowed: false,
  });

  it('consent audit, WAITING: no row of the erased account is stored after the erasure', async () => {
    const s = st();
    const p = await people(s);
    initConsentAuditBuffer(s);
    // The buffer writes within a second on its own timer; that timer is taken off here, so the rows
    // wait until the test flushes.
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    bufferConsentAudit(audit(p.aliceGhii, p.bobGhii));
    bufferConsentAudit(audit(p.scout, p.bobGhii));
    bufferConsentAudit(audit(p.bobGhii, p.aliceGhii));
    vi.useRealTimers();

    await eraseOwner(s, NODE, p.alice);
    await flushConsentAudit();

    expect(await s.listConsentAudit(p.aliceGhii)).toEqual([]);
    expect(await s.listConsentAudit(p.scout)).toEqual([]);
    // POSITIVE CONTROL: bob's record of alice's refused read is bob's, and it is stored.
    expect((await s.listConsentAudit(p.bobGhii)).length).toBe(1);
  });

  it('consent audit, BEING WRITTEN: a row whose write is in progress is not stored after the erasure', async () => {
    const s = st();
    const p = await people(s);
    initConsentAuditBuffer(s);
    const held = holdFirst(s, 'addConsentAuditEntry');
    try {
      bufferConsentAudit(audit(p.aliceGhii, p.bobGhii));
      await eraseDuring(s, p, held, flushConsentAudit());
    } finally { held.restore(); }
    expect(await s.listConsentAudit(p.aliceGhii)).toEqual([]);
  });

  // ── The usage call stream (services/usage/usage-buffer.ts) ──
  it('usage calls, WAITING: no call of the erased account is stored after the erasure', async () => {
    const s = st();
    const p = await people(s);
    initUsageBuffer(s, NEVER);
    recordUsageCall({ ownerGhii: p.aliceGhii, surface: 'mcp', coordinate: 'aimeat_memory_read' });
    recordUsageCall({ ownerGhii: p.aliceGhii, actorGaii: p.star, actorKind: 'agent', surface: 'mcp', coordinate: 'aimeat_memory_write' });
    recordUsageCall({ ownerGhii: p.bobGhii, surface: 'mcp', coordinate: 'aimeat_memory_read' });

    await eraseOwner(s, NODE, p.alice);
    await flushUsageBuffer();

    expect(await s.listUsageCalls({ ownerGhii: p.aliceGhii })).toEqual([]);
    expect(await s.listUsageCalls({ actorGaii: p.star })).toEqual([]);
    // POSITIVE CONTROL: bob's call in the same buffer is stored.
    expect((await s.listUsageCalls({ ownerGhii: p.bobGhii })).length).toBe(1);
  });

  it('usage calls, BEING WRITTEN: a batch whose write is in progress is not stored after the erasure', async () => {
    const s = st();
    const p = await people(s);
    initUsageBuffer(s, NEVER);
    const held = holdFirst(s, 'appendUsageCall');
    try {
      recordUsageCall({ ownerGhii: p.aliceGhii, surface: 'rest', coordinate: 'GET /v1/memory' });
      await eraseDuring(s, p, held, flushUsageBuffer());
    } finally { held.restore(); }
    expect(await s.listUsageCalls({ ownerGhii: p.aliceGhii })).toEqual([]);
  });

  // ── The memory write tally (services/data-map/write-tally-buffer.ts) ──
  const tally = (s: Storage, ownerGaii: string, key?: string) => s.listMemoryWriteTally({ ownerGaii, ...(key ? { key } : {}) });
  /**
   * The first sighting writes the key's row and the family's row, and only then counts the pair as
   * written; a touch made between the two would be lost to the count (a property of the buffer, not
   * of the erasure). So the test waits for the key's row and then for the family's write to end.
   */
  const firstSightingsWritten = async (cond: () => Promise<boolean>) => {
    await until(cond, 'the first sightings');
    await new Promise(r => setTimeout(r, 200));
  };

  it('write tally, WAITING: no count of the erased account\'s keys is stored after the erasure', async () => {
    const s = st();
    const p = await people(s);
    initWriteTallyBuffer(s, NEVER);
    // The first touch of a pair is written at once; the second waits for the flush.
    recordMemoryTouch({ ownerGaii: p.aliceGhii, key: 'notes.a', writerPrincipal: p.star, kind: 'write' });
    recordMemoryTouch({ ownerGaii: p.bobGhii, key: 'notes.b', writerPrincipal: p.bobGhii, kind: 'write' });
    await firstSightingsWritten(async () => (await tally(s, p.aliceGhii)).length === 1 && (await tally(s, p.bobGhii)).length === 1);
    recordMemoryTouch({ ownerGaii: p.aliceGhii, key: 'notes.a', writerPrincipal: p.star, kind: 'write' });
    recordMemoryTouch({ ownerGaii: p.bobGhii, key: 'notes.b', writerPrincipal: p.bobGhii, kind: 'write' });

    await eraseOwner(s, NODE, p.alice);
    await flushWriteTallyBuffer();

    expect(await tally(s, p.aliceGhii)).toEqual([]);
    // POSITIVE CONTROL: bob's two touches are counted.
    expect((await tally(s, p.bobGhii)).map(r => r.writeCount)).toEqual([2]);
  });

  it('write tally, WAITING: alice\'s touch of bob\'s key is stored under the erasure\'s pseudonym, not her name, and bob\'s count stays whole', async () => {
    const s = st();
    const p = await people(s);
    initWriteTallyBuffer(s, NEVER);
    recordMemoryTouch({ ownerGaii: p.bobGhii, key: 'shared.c', writerPrincipal: p.aliceGhii, kind: 'write' });
    await firstSightingsWritten(async () => (await tally(s, p.bobGhii, 'shared.c')).length === 1);
    recordMemoryTouch({ ownerGaii: p.bobGhii, key: 'shared.c', writerPrincipal: p.aliceGhii, kind: 'write' });

    await eraseOwner(s, NODE, p.alice);
    await flushWriteTallyBuffer();

    const rows = await tally(s, p.bobGhii, 'shared.c');
    expect(rows.filter(r => r.writerPrincipal.includes(p.alice))).toEqual([]);
    expect(rows.reduce((n, r) => n + r.writeCount, 0)).toBe(2);
  });

  it('write tally, BEING WRITTEN: a first sighting whose write is in progress is not stored after the erasure', async () => {
    const s = st();
    const p = await people(s);
    initWriteTallyBuffer(s, NEVER);
    const held = holdFirst(s, 'upsertMemoryWriteTally');
    try {
      recordMemoryTouch({ ownerGaii: p.aliceGhii, key: 'notes.held', writerPrincipal: p.aliceGhii, kind: 'write' });
      await eraseDuring(s, p, held, Promise.resolve());
      // The held write-through is a floating promise inside the buffer: give it its turn.
      await new Promise(r => setTimeout(r, 100));
      await flushWriteTallyBuffer();
    } finally { held.restore(); }
    expect(await tally(s, p.aliceGhii)).toEqual([]);
  });
});
