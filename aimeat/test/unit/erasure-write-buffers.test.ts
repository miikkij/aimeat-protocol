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
 *   the account (the stored row was there after the erasure), except the two WAITING sections that
 *   say they were green: those buffers read the agent before they write, and the erasure removed it.
 * @usage cd aimeat && pnpm exec vitest run test/unit/erasure-write-buffers.test.ts
 *   With PostgreSQL: node --env-file=.env.test.postgres-kysely node_modules/vitest/vitest.mjs run test/unit/erasure-write-buffers.test.ts
 * @version-history
 *   v1.5.0 — 2026-11-14 — The shared setup and the call hold move to erasure-test-kit.ts.
 *   v1.4.0 — 2026-11-14 — The agent refusal notes.
 *   v1.3.0 — 2026-11-14 — The record of the permissions a `*` agent uses.
 *   v1.2.0 — 2026-11-14 — The memory write tally.
 *   v1.1.0 — 2026-11-14 — The usage call stream.
 *   v1.0.0 — 2026-11-14 — Initial: the consent audit.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { requirePostgresWhenAsked } from './postgres-arm.js';
import type { Storage } from '../../src/storage/interface.js';
import { eraseOwner } from '../../src/services/owner-erasure.js';
import { twoProviders, NODE, now, people, holdFirst, eraseDuring, until, type People } from './erasure-test-kit.js';
import { initConsentAuditBuffer, bufferConsentAudit, flushConsentAudit, shutdownConsentAuditBuffer } from '../../src/services/consent-audit-buffer.js';
import { initUsageBuffer, recordUsageCall, flushUsageBuffer, resetUsageBuffer } from '../../src/services/usage/usage-buffer.js';
import { initWriteTallyBuffer, recordMemoryTouch, flushWriteTallyBuffer, resetWriteTallyBuffer } from '../../src/services/data-map/write-tally-buffer.js';
import { initScopeUse, noteScopeUse, flushScopeUse, SCOPE_USE_KEY } from '../../src/services/scope-use.js';
import { initAgentRefusals, noteAgentRefusal, flushAgentRefusals, agentRefusalsKey } from '../../src/services/agent/refusals.js';

requirePostgresWhenAsked('erasure-write-buffers');

const { names, storageOf } = twoProviders(['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])]);
/** One interval for the whole file, longer than any run: a flush happens only when a test asks. */
const NEVER = 3_600_000;

describe.each(names)('%s: a write buffer and an account erasure', provider => {
  const st = () => storageOf(provider);
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

  // ── The permissions a `*` agent uses (services/scope-use.ts) ──
  it('scope use, WAITING: no record of the erased account is stored after the erasure (green before the fix too: the write reads the agent first)', async () => {
    const s = st();
    const p = await people(s);
    initScopeUse(s);
    noteScopeUse(p.star, ['memory:read']);

    await eraseOwner(s, NODE, p.alice);
    await flushScopeUse(s);

    expect(await s.getMemory(p.aliceGhii, SCOPE_USE_KEY)).toBeNull();
  });

  it('scope use, BEING WRITTEN: a record whose write is in progress is not stored after the erasure', async () => {
    const s = st();
    const p = await people(s);
    initScopeUse(s);
    // The flush reads the agent, then writes: held after the read, the write comes after the erasure.
    const held = holdFirst(s, 'getAgent', 'after');
    try {
      noteScopeUse(p.star, ['memory:read']);
      await eraseDuring(s, p, held, flushScopeUse(s));
    } finally { held.restore(); }
    expect(await s.getMemory(p.aliceGhii, SCOPE_USE_KEY)).toBeNull();
  });

  // ── The agent refusal notes (services/agent/refusals.ts) ──
  const refused = (p: People, call: string) => noteAgentRefusal({ sub: p.scout, roles: ['agent'] }, ['memory:write'], false, call);
  const refusalNote = (s: Storage, p: People) => s.getMemory(p.aliceGhii, agentRefusalsKey('scout'));

  it('refusal notes, WAITING: no note of the erased account is stored after the erasure (green before the fix too: the note reads the agent first)', async () => {
    const s = st();
    const p = await people(s);
    initAgentRefusals(s);
    // The first refusal is written at once; the second waits for the end of its one-minute window.
    refused(p, 'POST /v1/memory');
    await until(async () => (await refusalNote(s, p)) !== null, 'the first note');
    refused(p, 'POST /v1/memory');

    await eraseOwner(s, NODE, p.alice);
    await flushAgentRefusals();

    expect(await refusalNote(s, p)).toBeNull();
  });

  it('refusal notes, BEING WRITTEN: a note whose write is in progress is not stored after the erasure', async () => {
    const s = st();
    const p = await people(s);
    initAgentRefusals(s);
    // The note reads the agent, then writes: held after the read, the write comes after the erasure.
    const held = holdFirst(s, 'getAgent', 'after');
    try {
      refused(p, 'PUT /v1/memory');
      await eraseDuring(s, p, held, Promise.resolve());
      await flushAgentRefusals();
    } finally { held.restore(); }
    expect(await refusalNote(s, p)).toBeNull();
  });
});
