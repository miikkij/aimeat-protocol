/**
 * @file memory-read-contract.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Real-provider discovery pagination and value-free listing contracts.
 * @version-history 1.0.0 2026-09-27 Later eligible hits and metadata parity.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import { discoverMemory } from '../../src/services/memory-discover.js';

type TestStorage = Storage & { close(): void | Promise<void> };
const names = ['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])];
const providers = new Map<string, TestStorage>();
beforeAll(async () => {
  for (const name of names) providers.set(name, await createStorage({
    provider: name === 'sqlite' ? 'sqlite' : 'postgres-kysely', sqlitePath: ':memory:', dbUrl: process.env.DATABASE_URL,
  }) as TestStorage);
}, 60_000);
afterAll(async () => { for (const storage of providers.values()) await storage.close(); });
function row(ownerGaii: string, key: string, extra: Partial<MemoryRecord> = {}): MemoryRecord {
  const now = new Date().toISOString();
  return { ownerGaii, key, value: 'x'.repeat(8192), visibility: 'public', tags: [], version: 1,
    ttlHours: null, createdAt: now, updatedAt: now, ...extra };
}

describe.each(names)('%s memory reads', name => {
  it('finds later eligible rows before paging and never loads values', async () => {
    const storage = providers.get(name)!;
    const prefix = `read-${randomUUID()}.`;
    const caller = `${prefix}caller@node`, other = `${prefix}other@node`;
    await storage.bulkSetMemory!(Array.from({ length: 1000 }, (_, i) =>
      row(i < 500 ? caller : other, `${prefix}a${String(i).padStart(4, '0')}`)));
    await storage.bulkSetMemory!([
      row(other, prefix + 'y-secret', { visibility: 'private', tags: ['ÄÄNI'] }),
      row(other, prefix + 'z1', { tags: ['ÄÄNI'] }), row(other, prefix + 'z2', { tags: ['ÄÄNI'] }),
    ]);
    const oldRead = await storage.listAllMemory({ prefix, visibility: 'public', limit: 50 });
    const oldBytes = Buffer.byteLength(JSON.stringify(oldRead));
    const full = vi.spyOn(storage, 'listAllMemory');
    const meta = vi.spyOn(storage, 'listAllMemoryMeta');
    try {
      // Classification off: the organism leave check passes everything and reads no storage.
      const config = { nodeId: 'test-node', classificationMode: 'off' } as never;
      const page = await discoverMemory(storage, config, caller, { prefix, q: 'ääni', limit: 1, offset: 1 });
      expect(page.map(item => item.key)).toEqual([prefix + 'z2']);
      expect(page.every(item => !('value' in item))).toBe(true);
      expect(full).not.toHaveBeenCalled();
      expect(meta).toHaveBeenCalledTimes(1);
      const loaded = await meta.mock.results[0].value;
      expect(Buffer.byteLength(JSON.stringify(loaded))).toBeLessThan(oldBytes);
      expect(await discoverMemory(storage, config, caller, { prefix, q: 'missing', limit: 50, offset: 0 })).toEqual([]);
    } finally { vi.restoreAllMocks(); }
  }, 30_000);

  it('metadata has the same live keys, order and filters as full reads', async () => {
    const storage = providers.get(name)!;
    const owner = `meta-${randomUUID()}@node`;
    await storage.bulkSetMemory!([
      row(owner, 'b', { tags: ['match'] }), row(owner, 'a', { tags: ['match'] }),
      row(owner, 'expired', { tags: ['match'], ttlHours: 1, createdAt: '2020-01-01T00:00:00.000Z' }),
      row(owner, 'private', { visibility: 'private', tags: ['match'] }),
    ]);
    const opts = { visibility: 'public', tags: ['match'] };
    const meta = await storage.listMemoryMeta(owner, opts);
    const full = await storage.listMemory(owner, opts);
    expect(meta.map(r => r.key)).toEqual(full.map(r => r.key));
    expect(meta.every(r => !('value' in r))).toBe(true);
    expect((await storage.listMemoryMetaForOwners([owner], opts)).map(r => r.key)).toEqual(full.map(r => r.key));
  });
});
