/**
 * @file test/unit/classification-on-write.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Write-time classification and the classifier's queue job (TARGET-082 V3) against
 *   SqliteStorage(':memory:'): a memory write with an IBAN in it gets the rule label shortly after the
 *   write and not during it; an organism workspace write is labelled in the organism's scope; a write
 *   under the reserved `classification.policy.` is not judged; with the switch off nothing is scheduled and nothing is
 *   read; with no classifier set at boot nothing is scheduled; the queue job judges queued memory
 *   items with a stubbed model and drops file items and records that are gone. The review fixes:
 *   past the in-process limit a write goes to the persistent queue instead of being dropped, and the
 *   write hook hands the classifier the policy it read.
 * @version-history
 *   v1.2.0 — 2026-09-30 — One owner holds at most 50 writes in process (TARGET-082 second review, S4).
 *   v1.1.0 — 2026-09-29 — The review fixes (TARGET-082 review, findings 5 and 6).
 *   v1.0.0 — 2026-09-29 — TARGET-082 V3. Initial.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { writeMemoryRecord } from '../../src/services/memory-write.js';
import { writeWorkspaceRecord } from '../../src/services/workspace-write.js';
import { classifyAfterWrite, flushWriteClassification, pendingWriteClassifications, setWriteClassifier } from '../../src/services/classify-on-write.js';
import { runClassificationQueueJob, installWriteClassifier } from '../../src/services/classification-queue-job.js';
import { enqueue, readQueue } from '../../src/services/classification/classifier.js';
import { memoryTarget, fileTarget } from '../../src/services/classification/labels.js';

vi.mock('../../src/services/decide/service.js', () => ({
  decideForOwner: vi.fn(async () => ({
    decision_id: 'stub-decision', answers: { label: { value: 'luottamuksellinen', confidence: 0.95 } },
  })),
}));
import { decideForOwner } from '../../src/services/decide/service.js';

const NODE = 'test-node';
const ALICE = `alice@${NODE}`;
const IBAN = 'Pay to FI2112345600000785 by Friday.';
const owner = { principal: ALICE, targetGaii: ALICE, scopes: [] as string[], roles: ['owner'] };
const write = (key: string, value: unknown) => ({ key, value, visibility: 'private' as const, pipeline: 'test.classify' });

describe('write-time classification', () => {
  let storage: SqliteStorage;
  let config: AimeatConfig;
  const deps = () => ({ storage, config });
  beforeEach(() => {
    storage = new SqliteStorage(':memory:');
    config = { ...loadConfig().config, nodeId: NODE, classificationMode: 'all', aiProvenance: false };
    installWriteClassifier();   // what registerCoreHandlers does at boot
  });
  afterEach(async () => {
    await flushWriteClassification();
    setWriteClassifier(null);
    storage.close();
    vi.restoreAllMocks();
  });

  it('without a classifier set, a write schedules nothing', async () => {
    setWriteClassifier(null);
    const out = await writeMemoryRecord(deps(), owner, write('notes.invoice', { text: IBAN }));
    expect(out.ok).toBe(true);
    expect(pendingWriteClassifications()).toBe(0);
  });

  it('a memory write with an IBAN gets the rule label after the write, not during it', async () => {
    const out = await writeMemoryRecord(deps(), owner, write('notes.invoice', { text: IBAN }));
    expect(out.ok).toBe(true);
    expect(pendingWriteClassifications()).toBeGreaterThan(0);
    expect(await storage.getContentLabel(memoryTarget(ALICE, 'notes.invoice')) ?? null).toBeNull();
    await flushWriteClassification();
    const row = await storage.getContentLabel(memoryTarget(ALICE, 'notes.invoice'));
    expect(row).toMatchObject({ label: 'luottamuksellinen', source: 'rule', locked: false });
    expect(decideForOwner).not.toHaveBeenCalled();
  });

  it('an organism workspace record is labelled in the organism scope', async () => {
    const key = 'organism.org1.w.ws1.docs.d1.draft';
    await writeWorkspaceRecord(deps(), { key, value: { body: IBAN }, owner: ALICE, prev: null, principal: ALICE });
    await flushWriteClassification();
    const target = memoryTarget(ALICE, key);
    expect(target.scope).toBe('organism:org1');
    expect(await storage.getContentLabel(target)).toMatchObject({ label: 'luottamuksellinen', source: 'rule' });
  });

  it("an app's own classification.* data is judged like any other (only classification.policy. is reserved)", async () => {
    const out = await writeMemoryRecord(deps(), owner, write('classification.notes', IBAN));
    expect(out.ok).toBe(true);
    expect(pendingWriteClassifications()).toBeGreaterThan(0);
    await flushWriteClassification();
    expect(await storage.getContentLabel(memoryTarget(ALICE, 'classification.notes'))).toMatchObject({ label: 'luottamuksellinen' });
  });

  it('hands the classifier the policy it read, so the classifier reads it no second time (finding 5)', async () => {
    const seen: unknown[] = [];
    setWriteClassifier(async (_d, _t, _text, opts) => { seen.push(opts.policy); });
    await writeMemoryRecord(deps(), owner, write('notes.invoice', { text: IBAN }));
    await flushWriteClassification();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ defaultLabel: 'sisainen' });
  });

  it('past the in-process limit a write waits in the persistent queue instead of being dropped (finding 6)', async () => {
    let judged = 0;
    const { enqueue } = await import('../../src/services/classification/classifier.js');
    setWriteClassifier(async () => { judged++; }, enqueue);
    // All scheduled in one tick, so the worker has not started: forty owners fill the 2000 places
    // (50 each, the per-owner limit), and the 2001st write is past the limit.
    for (let o = 0; o < 40; o++) {
      for (let i = 0; i < 50; i++) classifyAfterWrite(deps(), `o${o}@${NODE}`, `bulk.${i}`, 'text');
    }
    classifyAfterWrite(deps(), ALICE, 'bulk.2000', 'text');
    await flushWriteClassification();
    expect(judged).toBe(2000);
    expect(await readQueue(storage, NODE)).toMatchObject([{ key: 'bulk.2000', scope: ALICE, origin: 'write' }]);
  });

  it('one owner holds at most 50 writes in process; the rest wait in the persistent queue by address', async () => {
    let judged = 0;
    const { enqueue } = await import('../../src/services/classification/classifier.js');
    setWriteClassifier(async () => { judged++; }, enqueue);
    for (let i = 0; i < 60; i++) classifyAfterWrite(deps(), ALICE, `big.${i}`, 'x'.repeat(10_000));
    // POSITIVE CONTROL: another owner's write is still judged in process.
    classifyAfterWrite(deps(), `bob@${NODE}`, 'notes.one', 'text');
    await flushWriteClassification();
    expect(judged).toBe(51);
    expect((await readQueue(storage, NODE)).map(q => q.key)).toEqual(Array.from({ length: 10 }, (_, i) => `big.${50 + i}`));
  });

  it('with the switch off nothing is scheduled and nothing is read', async () => {
    config = { ...config, classificationMode: 'off' };
    const labelRead = vi.spyOn(storage, 'getContentLabel');
    const memRead = vi.spyOn(storage, 'getMemory');
    const out = await writeMemoryRecord(deps(), owner, write('notes.invoice', { text: IBAN }));
    expect(out.ok).toBe(true);
    expect(pendingWriteClassifications()).toBe(0);
    await flushWriteClassification();
    expect(labelRead).not.toHaveBeenCalled();
    // The write does its own reads; none of them is a policy, the queue or the day's counter, which
    // all live under `classification.`.
    const classifierReads = memRead.mock.calls.filter(([, key]) => String(key).startsWith('classification.'));
    expect(classifierReads).toEqual([]);
    memRead.mockClear();
    expect(await runClassificationQueueJob(config, storage)).toBeNull();
    expect(memRead).not.toHaveBeenCalled();
    expect(labelRead).not.toHaveBeenCalled();
  });
});

describe('the classification queue job', () => {
  let storage: SqliteStorage;
  let config: AimeatConfig;
  beforeEach(() => {
    storage = new SqliteStorage(':memory:');
    config = { ...loadConfig().config, nodeId: NODE, classificationMode: 'all', aiProvenance: false };
    vi.mocked(decideForOwner).mockClear();
  });
  afterEach(async () => {
    await flushWriteClassification();
    storage.close();
  });

  async function seed(ownerGaii: string, key: string, value: unknown): Promise<void> {
    const now = new Date().toISOString();
    await storage.setMemory({ key, ownerGaii, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
  }

  it('judges queued memory items, personal and organism, and drops what it cannot load', async () => {
    const deps = { storage, config };
    await seed(ALICE, 'notes.plain', 'Lunch with the team at noon.');
    await seed(ALICE, 'organism.org1.w.ws1.docs.d2.latest', { body: IBAN });
    await enqueue(deps, memoryTarget(ALICE, 'notes.plain'));
    await enqueue(deps, memoryTarget(ALICE, 'organism.org1.w.ws1.docs.d2.latest'));
    await enqueue(deps, memoryTarget(ALICE, 'notes.gone'));
    await enqueue(deps, fileTarget(ALICE, 'files/report.pdf'));
    expect(await readQueue(storage, NODE)).toHaveLength(4);

    const out = await runClassificationQueueJob(config, storage);
    expect(out).toEqual({ done: 2, waiting: 0 });
    expect(await readQueue(storage, NODE)).toEqual([]);

    // The personal item: no rule matches, the stubbed model answers, and in suggest mode it waits.
    expect(decideForOwner).toHaveBeenCalledTimes(1);
    const plain = await storage.getContentLabel(memoryTarget(ALICE, 'notes.plain'));
    expect(plain?.label).toBe('sisainen');
    expect(plain?.suggestion).toMatchObject({ label: 'luottamuksellinen', why: 'AI_SUGGESTS', source: 'ai' });
    // The organism item: the IBAN rule labels it in the organism scope.
    expect(await storage.getContentLabel(memoryTarget(ALICE, 'organism.org1.w.ws1.docs.d2.latest')))
      .toMatchObject({ scope: 'organism:org1', label: 'luottamuksellinen', source: 'rule' });
  });
});
