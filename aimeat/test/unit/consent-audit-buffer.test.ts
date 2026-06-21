/**
 * @file consent-audit-buffer.test.ts
 * @description Unit tests for the off-request-path consent-audit buffer: entries are queued
 *   in memory (no synchronous storage write), flushed in batches, retried on failure, exposed
 *   to the audit endpoint as pending, and bounded so a wedged DB can't grow memory unbounded.
 * @version-history
 *   v1.0.0 -- 2026-06-21 -- Initial coverage for the buffered consent-audit writer.
 */
import { describe, it, expect } from 'vitest';
import type { Storage, ConsentAuditEntry } from '../../src/storage/interface.js';
import {
  initConsentAuditBuffer,
  bufferConsentAudit,
  flushConsentAudit,
  getPendingConsentAudit,
  pendingConsentAuditCount,
} from '../../src/services/consent-audit-buffer.js';

function entry(owner: string, over: Partial<ConsentAuditEntry> = {}): ConsentAuditEntry {
  return {
    id: Math.random().toString(36).slice(2),
    consentId: 'none',
    ownerGaii: owner,
    accessorGaii: 'b#o@n',
    memoryKey: 'k',
    action: 'read',
    timestamp: new Date().toISOString(),
    allowed: false,
    ...over,
  };
}

function makeStorage(failFirst = 0): { storage: Storage; written: ConsentAuditEntry[]; calls: () => number } {
  const written: ConsentAuditEntry[] = [];
  let n = 0;
  const storage = {
    async addConsentAuditEntry(e: ConsentAuditEntry) {
      n++;
      if (n <= failFirst) throw new Error('boom');
      written.push(e);
      return e;
    },
  } as unknown as Storage;
  return { storage, written, calls: () => n };
}

describe('consent-audit-buffer', () => {
  it('queues entries without writing, then flushes them all', async () => {
    const { storage, written } = makeStorage();
    initConsentAuditBuffer(storage);
    const owner = `o#x@n-${Date.now()}-a`;

    bufferConsentAudit(entry(owner));
    bufferConsentAudit(entry(owner));
    expect(written.length).toBe(0);           // nothing written synchronously
    expect(pendingConsentAuditCount()).toBeGreaterThanOrEqual(2);

    await flushConsentAudit();
    expect(written.filter(e => e.ownerGaii === owner).length).toBe(2);
  });

  it('exposes pending entries to the audit endpoint, filtered by owner', async () => {
    const { storage } = makeStorage();
    initConsentAuditBuffer(storage);
    const owner = `o#x@n-${Date.now()}-b`;
    bufferConsentAudit(entry(owner, { memoryKey: 'mine' }));
    bufferConsentAudit(entry(`someone#else@n-${Date.now()}`, { memoryKey: 'theirs' }));

    const mine = getPendingConsentAudit(owner);
    expect(mine.every(e => e.ownerGaii === owner)).toBe(true);
    expect(mine.some(e => e.memoryKey === 'mine')).toBe(true);
    expect(mine.some(e => e.memoryKey === 'theirs')).toBe(false);
    await flushConsentAudit();
  });

  it('retries failed writes on the next flush (does not lose audit entries)', async () => {
    const { storage, written } = makeStorage(/* failFirst */ 1);
    initConsentAuditBuffer(storage);
    const owner = `o#x@n-${Date.now()}-c`;
    bufferConsentAudit(entry(owner, { memoryKey: 'retryme' }));

    await flushConsentAudit(); // first attempt throws → entry returned to queue
    expect(written.some(e => e.memoryKey === 'retryme')).toBe(false);

    await flushConsentAudit(); // second attempt succeeds
    expect(written.some(e => e.memoryKey === 'retryme')).toBe(true);
  });
});
