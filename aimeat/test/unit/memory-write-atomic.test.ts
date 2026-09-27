/**
 * @file memory-write-atomic.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Real-provider races at the shared memory-write boundary, synchronized after both reads.
 * @version-history 1.0.0 2026-09-27 Atomic version and provenance regression.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import { loadConfig } from '../../src/config.js';
import { writeMemoryRecord } from '../../src/services/memory-write.js';
import { onChangeEvent, offChangeEvent, type ChangeEvent } from '../../src/services/event-bus.js';

type TestStorage = Storage & { close(): void | Promise<void> };
const providers: Array<{ name: string; storage: TestStorage }> = [];
const config = { ...loadConfig().config, aiProvenance: true };
beforeAll(async () => {
  providers.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: ':memory:' }) as TestStorage });
  if (process.env.DATABASE_URL) {
    providers.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: process.env.DATABASE_URL }) as TestStorage });
  } else if (process.env.AIMEAT_CONFORMANCE_REQUIRE_POSTGRES === 'true') {
    throw new Error('PostgreSQL race proof requires DATABASE_URL.');
  }
}, 60_000);
afterAll(async () => { for (const p of providers) await p.storage.close(); });

function record(owner: string, key: string): MemoryRecord {
  const now = new Date().toISOString();
  return { ownerGaii: owner, key, value: { before: true }, visibility: 'private', tags: [],
    version: 1, ttlHours: null, createdAt: now, updatedAt: now, trackable: true };
}

/** Hold only the first two target reads; all I/O, including the later CAS, uses the real provider. */
function twoReaders(storage: Storage, owner: string, key: string): Storage {
  let seen = 0;
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  return new Proxy(storage, {
    get(target, prop) {
      if (prop === 'getMemory') return async (gaii: string, readKey: string) => {
        const row = await target.getMemory(gaii, readKey);
        if (gaii === owner && readKey === key && seen < 2) {
          seen++;
          if (seen === 2) release();
          await barrier;
        }
        return row;
      };
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

describe('conditional memory writes on real providers', () => {
  it.each(['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])])(
    '%s: provenance failure rolls the write back; an unconditional write still works',
    async name => {
      const storage = providers.find(p => p.name === name)!.storage;
      const owner = `rollback-${randomUUID()}@${config.nodeId}`;
      const key = 'audit.rollback';
      const caller = { principal: `writer#${owner}`, targetGaii: owner, scopes: ['memory:write'], roles: ['agent'] };
      const input = { key, value: { saved: true }, visibility: 'private' as const, pipeline: 'test.atomic' };
      const failed = vi.spyOn(storage, 'createAiProvenance').mockRejectedValueOnce(new Error('provenance unavailable'));
      try {
        await expect(writeMemoryRecord({ storage, config }, caller, { ...input, expectedVersion: 0 }))
          .rejects.toThrow('provenance unavailable');
        expect(await storage.getMemory(owner, key)).toBeNull();
        expect((await storage.listAiProvenance({ ownerGhii: owner })).total).toBe(0);
      } finally { failed.mockRestore(); }
      try {
        expect((await writeMemoryRecord({ storage, config }, caller, input)).ok).toBe(true);
        expect((await writeMemoryRecord({ storage, config }, caller, input)).ok).toBe(true);
        expect((await storage.getMemory(owner, key))?.version).toBe(2);
      } finally { await storage.deleteMemory(owner, key); }
    },
  );

  it.each(['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])])(
    '%s: atomic updates preserve workspace fields and refuse a deleted row',
    async name => {
      const storage = providers.find(p => p.name === name)!.storage;
      const owner = `fields-${randomUUID()}@${config.nodeId}`;
      const original = record(owner, 'audit.fields');
      try {
        await storage.setMemory(original);
        const update = { ...original, visibility: 'workspace' as const, workspaceRef: 'org/ws', version: 2 };
        expect(await storage.setMemoryIfVersion!(update, 1)).not.toBeNull();
        expect((await storage.getMemory(owner, original.key))?.workspaceRef).toBe('org/ws');
        await storage.deleteMemory(owner, original.key);
        expect(await storage.setMemoryIfVersion!({ ...update, version: 3 }, 2)).toBeNull();
        expect(await storage.getMemory(owner, original.key)).toBeNull();
      } finally { await storage.deleteMemory(owner, original.key); }
    },
  );

  it.each(['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])].flatMap(name =>
    [0, 1].map(expectedVersion => ({ name, expectedVersion })),
  ))('$name: admits one writer from version $expectedVersion with only its provenance and event', async ({ name, expectedVersion }) => {
      const storage = providers.find(p => p.name === name)!.storage;
      const owner = `atomic-${randomUUID()}@${config.nodeId}`;
      const key = 'audit.atomic';
      if (expectedVersion) await storage.setMemory(record(owner, key));
      const target = twoReaders(storage, owner, key);
      let changes = 0;
      const listen = (e: ChangeEvent) => { if (e.domain === 'memory') changes++; };
      onChangeEvent(listen);
      try {
        const results = await Promise.all(['first', 'second'].map(writer =>
          writeMemoryRecord({ storage: target, config }, {
            principal: `${writer}#${owner}`, targetGaii: owner, scopes: ['memory:write'], roles: ['agent'],
          }, { key, value: { writer }, visibility: 'private', expectedVersion, pipeline: 'test.atomic', ownerScoped: true }),
        ));
        expect(results.filter(r => r.ok), name).toHaveLength(1);
        expect(results.filter(r => !r.ok), name).toMatchObject([
          { ok: false, status: 409, code: 'VERSION_CONFLICT', details: { expectedVersion, currentVersion: expectedVersion + 1 } },
        ]);
        const saved = await storage.getMemory(owner, key);
        const winner = results.find(r => r.ok)!;
        if (!winner.ok) throw new Error('No successful writer');
        expect(saved?.value, name).toEqual(winner.record.value);
        expect(saved?.version, name).toBe(expectedVersion + 1);
        const provenance = await storage.listAiProvenance({ ownerGhii: owner });
        expect(provenance.total, name).toBe(1);
        expect(provenance.items[0].id, name).toBe(saved?.aiProvenanceId);
        expect(changes, name).toBe(1);
        if (expectedVersion) {
          const history = await storage.listMemoryHistory(owner, key);
          expect(history, name).toHaveLength(1);
          expect(history[0].value, name).toEqual({ before: true });
        }
      } finally {
        offChangeEvent(listen);
        await storage.deleteMemory(owner, key);
      }
  }, 30_000);
});
