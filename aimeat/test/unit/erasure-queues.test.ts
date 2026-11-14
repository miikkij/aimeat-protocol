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
 *   v1.4.0 — 2026-11-14 — The content intake queue.
 *   v1.3.0 — 2026-11-14 — The write-time classification queue.
 *   v1.2.0 — 2026-11-14 — The receiver delivery log.
 *   v1.1.0 — 2026-11-14 — The outside party read log.
 *   v1.0.0 — 2026-11-14 — Initial: the call timings.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requirePostgresWhenAsked } from './postgres-arm.js';
import { eraseOwner } from '../../src/services/owner-erasure.js';
import { recordCallDuration, flushCallTimings, timingKey } from '../../src/services/call-timing.js';
import { logPartyRead, flushOwner, readLogKey } from '../../src/services/parties/activity.js';
import { PARTY_READS_PREFIX } from '../../src/services/parties/contract.js';
import { logDelivery, flushReceiverLogs } from '../../src/services/receivers/deliveries.js';
import { RECEIVER_LOG_PREFIX } from '../../src/services/receivers/contract.js';
import { serviceNamespaceOf } from '../../src/utils/service-namespace.js';
import { loadConfig } from '../../src/config.js';
import { classifyAfterWrite, flushWriteClassification, setWriteClassifier } from '../../src/services/classify-on-write.js';
import { installWriteClassifier } from '../../src/services/classification-queue-job.js';
import { memoryTarget } from '../../src/services/classification/labels.js';
import { contentAfterStore, flushContentIntake } from '../../src/services/content/intake.js';
import { getFacts, sourceIdOf } from '../../src/services/content/facts-store.js';
import { writeStorageFile } from '../../src/services/storage-file-write.js';

// The model path is not what these cases test; an IBAN meets the detection rules alone.
vi.mock('../../src/services/decide/service.js', () => ({
  decideForOwner: vi.fn(async () => ({ decision_id: 'stub-decision', answers: { label: { value: 'luottamuksellinen', confidence: 0.95 } } })),
}));
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

  // ── The outside party read log (services/parties/activity.ts) ──
  const read = (uid: string) => ({ at: new Date().toISOString(), share: null, party: 'carol', uid, what: 'pkg', verdict: 'served' as const });

  it('party read log, WAITING: no read log of the erased owner is stored after the erasure', async () => {
    const s = st();
    const p = await people(s);
    // The log writes two seconds later on its own timer; that timer is taken off here.
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    logPartyRead(s, p.aliceGhii, read('u1'));
    logPartyRead(s, p.bobGhii, read('u2'));
    vi.useRealTimers();

    await eraseOwner(s, NODE, p.alice);
    await flushOwner(p.aliceGhii);
    await flushOwner(p.bobGhii);

    expect(await s.getMemory(p.aliceGhii, readLogKey())).toBeNull();
    // POSITIVE CONTROL: bob's read log is stored.
    expect(await s.getMemory(p.bobGhii, readLogKey())).not.toBeNull();
  });

  it('party read log, BEING WRITTEN: a read log whose write is in progress is not stored after the erasure', async () => {
    const s = st();
    const p = await people(s);
    // The write reads the month's record, then writes it: held after the read.
    const held = holdFirst(s, 'getMemory', 'after', keyArg(PARTY_READS_PREFIX));
    try {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      logPartyRead(s, p.aliceGhii, read('u3'));
      vi.useRealTimers();
      await eraseDuring(s, p, held, flushOwner(p.aliceGhii));
    } finally { held.restore(); }
    expect(await s.getMemory(p.aliceGhii, readLogKey())).toBeNull();
  });

  // ── The receiver delivery log (services/receivers/deliveries.ts) ──
  const delivery = () => ({ at: new Date().toISOString(), verb: 'write', status: 201, bytes: 10 });
  const receiverLog = (s: ReturnType<typeof st>, ghii: string, name: string) =>
    s.getMemory(serviceNamespaceOf(ghii), `${RECEIVER_LOG_PREFIX}${name}`);

  it('receiver log, WAITING: no delivery log of the erased owner is stored after the erasure', async () => {
    const s = st();
    const p = await people(s);
    // The log writes five seconds later on its own timer; that timer is taken off here.
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    logDelivery(s, p.aliceGhii, 'sensor', delivery());
    logDelivery(s, p.bobGhii, 'sensor', delivery());
    vi.useRealTimers();

    await eraseOwner(s, NODE, p.alice);
    await flushReceiverLogs(p.aliceGhii);
    await flushReceiverLogs(p.bobGhii);

    expect(await receiverLog(s, p.aliceGhii, 'sensor')).toBeNull();
    // POSITIVE CONTROL: bob's delivery log is stored.
    expect(await receiverLog(s, p.bobGhii, 'sensor')).not.toBeNull();
  });

  it('receiver log, BEING WRITTEN: a delivery log whose write is in progress is not stored after the erasure', async () => {
    const s = st();
    const p = await people(s);
    // The write reads the log record, then writes it: held after the read.
    const held = holdFirst(s, 'getMemory', 'after', keyArg(RECEIVER_LOG_PREFIX));
    try {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      logDelivery(s, p.aliceGhii, 'meter', delivery());
      vi.useRealTimers();
      await eraseDuring(s, p, held, flushReceiverLogs(p.aliceGhii));
    } finally { held.restore(); }
    expect(await receiverLog(s, p.aliceGhii, 'meter')).toBeNull();
  });

  // ── The write-time classification queue (services/classify-on-write.ts) ──
  describe('write-time classification', () => {
    const IBAN = 'Pay to FI2112345600000785 by Friday.';
    const deps = () => ({ storage: st(), config: { ...loadConfig().config, nodeId: NODE, classificationMode: 'all' as const, aiProvenance: false } });
    const label = (ghii: string, key: string) => st().getContentLabel(memoryTarget(ghii, key));
    beforeEach(() => { installWriteClassifier(); });
    afterEach(async () => { await flushWriteClassification(); setWriteClassifier(null); });

    it('WAITING: no label of the erased account is stored after the erasure', async () => {
      const s = st();
      const p = await people(s);
      // The queue's worker starts on setImmediate; that is taken off here, so the writes wait.
      vi.useFakeTimers({ toFake: ['setImmediate'] });
      try {
        classifyAfterWrite(deps(), p.aliceGhii, 'notes.invoice', { text: IBAN });
        classifyAfterWrite(deps(), p.bobGhii, 'notes.invoice', { text: IBAN });
        await eraseOwner(s, NODE, p.alice);
        vi.runOnlyPendingTimers();
      } finally { vi.useRealTimers(); }
      await flushWriteClassification();

      expect(await label(p.aliceGhii, 'notes.invoice')).toBeUndefined();
      // POSITIVE CONTROL: bob's write is labelled.
      expect(await label(p.bobGhii, 'notes.invoice')).toBeDefined();
    });

    it('BEING WRITTEN: a label whose write is in progress is not stored after the erasure', async () => {
      const s = st();
      const p = await people(s);
      const held = holdFirst(s, 'putContentLabel', 'before',
        args => (args[0] as { scope?: string } | undefined)?.scope === p.aliceGhii);
      try {
        classifyAfterWrite(deps(), p.aliceGhii, 'notes.held', { text: IBAN });
        await eraseDuring(s, p, held, flushWriteClassification());
      } finally { held.restore(); }
      expect(await label(p.aliceGhii, 'notes.held')).toBeUndefined();
    });
  });

  // ── The content intake queue (services/content/intake.ts) ──
  describe('content intake', () => {
    const deps = () => ({ storage: st(), config: { ...loadConfig().config, nodeId: NODE, contentClassMode: 'on' as const } });
    const store = async (ghii: string, key: string) => {
      const out = await writeStorageFile(deps(), ghii, { key, data: Buffer.from('Quarterly notes. '.repeat(40)), mimeType: 'text/plain' });
      expect(out.ok).toBe(true);
    };
    const facts = (ghii: string, key: string) => getFacts(st(), ghii, sourceIdOf({ kind: 'file', owner: ghii, key }));
    const ownRecords = async (ghii: string) => (await st().listMemory(ghii, { prefix: 'contentclass.' })).map(r => r.key);
    afterEach(async () => { await flushContentIntake(); });

    it('WAITING: no facts of the erased account are stored after the erasure (green before the fix too: the item reads the file again, and the erasure removed it)', async () => {
      const s = st();
      const p = await people(s);
      await store(p.aliceGhii, 'docs/a.txt');
      await store(p.bobGhii, 'docs/b.txt');
      // The queue's worker starts on setImmediate; that is taken off here, so the items wait.
      vi.useFakeTimers({ toFake: ['setImmediate'] });
      try {
        contentAfterStore(deps(), p.aliceGhii, 'docs/a.txt');
        contentAfterStore(deps(), p.bobGhii, 'docs/b.txt');
        await eraseOwner(s, NODE, p.alice);
        vi.runOnlyPendingTimers();
      } finally { vi.useRealTimers(); }
      await flushContentIntake();

      expect(await facts(p.aliceGhii, 'docs/a.txt')).toBeNull();
      expect(await ownRecords(p.aliceGhii)).toEqual([]);
      // POSITIVE CONTROL: bob's file gets its facts.
      expect(await facts(p.bobGhii, 'docs/b.txt')).not.toBeNull();
    });

    it('BEING WRITTEN: facts whose write is in progress are not stored after the erasure', async () => {
      const s = st();
      const p = await people(s);
      await store(p.aliceGhii, 'docs/held.txt');
      // The inspection reads the facts record, then writes it: held after that read.
      const held = holdFirst(s, 'getMemory', 'after', args => args[0] === p.aliceGhii && String(args[1]).startsWith('contentclass.facts.'));
      try {
        contentAfterStore(deps(), p.aliceGhii, 'docs/held.txt');
        await eraseDuring(s, p, held, flushContentIntake());
      } finally { held.restore(); }
      expect(await facts(p.aliceGhii, 'docs/held.txt')).toBeNull();
      expect(await ownRecords(p.aliceGhii)).toEqual([]);
    });
  });
});
