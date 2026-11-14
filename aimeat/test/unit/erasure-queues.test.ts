/**
 * @file test/unit/erasure-queues.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Erasing an account (eraseOwner) while one of the node's in-process queues, batches or
 *   counters holds work of that account: the call timings, the outside party read log, the receiver
 *   delivery log, the write-time classification queue, the content intake queue, the agent telemetry
 *   buffer, and the visibility and behaviour counters. Each writes a record of the account later, and
 *   the erasure cascade deletes those records, so work that waits, or is being written, when the
 *   erasure runs must not store anything of the account after it. The sibling file
 *   erasure-write-buffers.test.ts covers the five write buffers the register finding named.
 *
 *   Two states per place, each on a real storage of both providers:
 *     - WAITING: the work is queued when the erasure starts and runs after it;
 *     - BEING WRITTEN: the work has read what it decides on and its write is held open by the test
 *       while the erasure runs, then released.
 *   A positive control where the place keeps another account's work: that record is stored.
 *   Register finding f-2026-11-13-write-buffers-and-erasure.
 *
 *   FAIL FIRST, 2026-11-14, on both providers: every section was red before its place held the account,
 *   except the WAITING sections that say they were green: those places read the owner, the record or
 *   the file again before they write, and the erasure removed it.
 * @usage cd aimeat && pnpm exec vitest run test/unit/erasure-queues.test.ts
 *   With PostgreSQL: node --env-file=.env.test.postgres-kysely node_modules/vitest/vitest.mjs run test/unit/erasure-queues.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial: the call timings.
 */
import { describe, expect, it } from 'vitest';
import { requirePostgresWhenAsked } from './postgres-arm.js';
import { eraseOwner } from '../../src/services/owner-erasure.js';
import { recordCallDuration, flushCallTimings, timingKey } from '../../src/services/call-timing.js';
import { twoProviders, NODE, people, holdFirst, eraseDuring } from './erasure-test-kit.js';

requirePostgresWhenAsked('erasure-queues');

const { names, storageOf } = twoProviders(['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])]);
const keyArg = (prefix: string) => (args: unknown[]): boolean => {
  const first = args[0];
  const key = typeof first === 'object' && first !== null ? (first as { key?: unknown }).key : args[1];
  return typeof key === 'string' && key.startsWith(prefix);
};

describe.each(names)('%s: an in-process queue and an account erasure', provider => {
  const st = () => storageOf(provider);

  // ── The call timings (services/call-timing.ts) ──
  it('call timings, WAITING: no timing record of the erased provider is stored after the erasure', async () => {
    const s = st();
    const p = await people(s);
    recordCallDuration(s, p.aliceGhii, 'ext1', 'act', 12);
    recordCallDuration(s, p.bobGhii, 'ext1', 'act', 15);

    await eraseOwner(s, NODE, p.alice);
    await flushCallTimings(s);

    expect(await s.getMemory(p.aliceGhii, timingKey('ext1', 'act'))).toBeNull();
    // POSITIVE CONTROL: bob's timing is stored.
    expect(await s.getMemory(p.bobGhii, timingKey('ext1', 'act'))).not.toBeNull();
  });

  it('call timings, BEING WRITTEN: a timing record whose write is in progress is not stored after the erasure', async () => {
    const s = st();
    const p = await people(s);
    const held = holdFirst(s, 'setMemory', 'before', keyArg('exchange.timing.'));
    try {
      recordCallDuration(s, p.aliceGhii, 'ext2', 'act', 20);
      await eraseDuring(s, p, held, flushCallTimings(s));
    } finally { held.restore(); }
    expect(await s.getMemory(p.aliceGhii, timingKey('ext2', 'act'))).toBeNull();
  });
});
