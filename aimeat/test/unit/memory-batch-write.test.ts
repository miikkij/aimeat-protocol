/**
 * @file memory-batch-write.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Batch provenance and I/O contracts on both real providers.
 * @version-history 1.0.0 2026-09-27 Accepted rows, constant lookup counts and rollback.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig } from '../../src/config.js';
import { createMemoryDbService } from '../../src/services/db/index.js';
import { writeMemoryBatch } from '../../src/services/memory-batch-write.js';

type TestStorage = Storage & { close(): void | Promise<void> };
const names = ['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])] as const;
const providers = new Map<string, TestStorage>();
const config = { ...loadConfig().config, aiProvenance: true };
const quota = { maxKeysPerOwner: 2000, maxValueSizeBytes: 1_000_000, totalQuotaBytes: 50_000_000 };
beforeAll(async () => {
  for (const name of names) providers.set(name, await createStorage({
    provider: name === 'sqlite' ? 'sqlite' : 'postgres-kysely',
    sqlitePath: ':memory:', dbUrl: process.env.DATABASE_URL,
  }) as TestStorage);
}, 60_000);
afterAll(async () => { for (const storage of providers.values()) await storage.close(); });

describe.each(names)('%s batch writes', name => {
  it('keeps lookups batched for 1000 records and stamps only accepted rows', async () => {
    const storage = providers.get(name)!;
    const memoryDb = createMemoryDbService(storage, config);
    const principal = `writer#batch-${randomUUID()}@${config.nodeId}`;
    const items = Array.from({ length: 1000 }, (_, i) => ({ key: `audit.batch.${i}`, value: { i } }));
    const reads = vi.spyOn(storage, 'getMemoryByKeys');
    const agentReads = vi.spyOn(storage, 'getAgent');
    const singleReads = vi.spyOn(storage, 'getMemory');
    try {
      // The old DB operation on the same number of rows is the query-count control.
      await memoryDb.writeMany(principal + '-control', items, { quota });
      const before = { batch: reads.mock.calls.length, single: singleReads.mock.calls.length };
      reads.mockClear(); singleReads.mockClear();
      const result = await writeMemoryBatch({ storage, memoryDb, config }, { principal, targetGaii: principal },
        [...items, { key: 'audit.denied', value: {} }], {
          quota, validate: async key => ({ valid: key !== 'audit.denied' }),
        }, 'bulk');
      expect(result.created).toBe(1000);
      expect(result.failed).toBe(1);
      expect(reads.mock.calls.length).toBe(before.batch);
      expect(singleReads.mock.calls.length).toBe(before.single);
      expect(agentReads).toHaveBeenCalledTimes(1);
      const stored = await storage.getMemoryByKeys!(principal, items.map(item => item.key));
      expect(stored).toHaveLength(1000);
      expect(stored.every(row => !!row.aiProvenanceId)).toBe(true);
      expect(await storage.getMemory(principal, 'audit.denied')).toBeNull();
    } finally { vi.restoreAllMocks(); }
  }, 30_000);

  it('rolls back the batch if provenance storage fails', async () => {
    const storage = providers.get(name)!;
    const memoryDb = createMemoryDbService(storage, config);
    const owner = `rollback-${randomUUID()}@${config.nodeId}`;
    const principal = `writer#${owner}`;
    const fail = vi.spyOn(storage, 'createAiProvenance').mockRejectedValueOnce(new Error('provenance write failed'));
    try {
      await expect(writeMemoryBatch({ storage, memoryDb, config }, { principal, targetGaii: principal },
        [{ key: 'audit.rollback', value: 1 }], { quota }, 'bulk')).rejects.toThrow('provenance write failed');
      expect(await storage.getMemory(principal, 'audit.rollback')).toBeNull();
      expect((await storage.listAiProvenance({ ownerGhii: owner })).total).toBe(0);
    } finally { fail.mockRestore(); }
  });
});
