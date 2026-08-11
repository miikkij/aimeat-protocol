/**
 * @file test/unit/memory-db-service.test.ts
 * @description Phase 0 parity + framework tests for the data-access redesign scaffolding. Proves the new
 *   Service → Repository → Adapter stack returns byte-for-byte the same results as the current
 *   services/owner-memory.ts helpers over the SAME SqliteStorage (coexistence, zero behaviour change),
 *   and unit-tests the read-scope primitive (IdentityMap memoisation).
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 0 scaffolding tests.
 *   v1.1.0 — 2026-08-11 — Dropped the BatchLoader tests with the class they covered: nothing in src
 *     ever called `uow.loader()`, so this suite was proving an unreachable class worked.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AgentRecord, MemoryRecord } from '../../src/storage/interface.js';
import { createMemoryDbService, MemoryRepository } from '../../src/services/db/index.js';
import { IdentityMap } from '../../src/storage/read-scope/identity-map.js';
import {
  listOwnerScopeMemory,
  listOwnerScopeMemoryMeta,
  getOwnerScopeMemory,
} from '../../src/services/owner-memory.js';

const NODE = 'test-node';
const OWNER = 'alice';
const GHII = `${OWNER}@${NODE}`;

function agent(i: number): AgentRecord {
  const now = new Date().toISOString();
  return {
    name: `agent${i}`, owner: OWNER, gaii: `agent${i}#${OWNER}@${NODE}`,
    displayName: `Agent ${i}`, description: '', capabilities: [], publicKey: `pk${i}`,
    trustScore: 50, morselBalance: 0, allowedOrigins: [], defaultScopes: ['*'], federate: false,
    mode: 'interactive', maxConcurrentTasks: 1, tags: [], createdAt: now, lastSeen: now,
  } as AgentRecord;
}

function mem(ownerGaii: string, key: string, value: unknown, visibility: MemoryRecord['visibility'] = 'private'): MemoryRecord {
  const now = new Date().toISOString();
  return { key, ownerGaii, value, visibility, tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now };
}

describe('MemoryDbService — Phase 0 parity with owner-memory.ts', () => {
  let storage: SqliteStorage;

  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: 'pk', roles: ['owner'], createdAt: new Date().toISOString() });
    for (let i = 0; i < 3; i++) await storage.createAgent(agent(i));
    // GHII-owned keys, including one key ('shared.note') ALSO written under an agent so dedup GHII-first matters.
    await storage.setMemory(mem(GHII, 'profile.bio', { text: 'hi' }, 'public'));
    await storage.setMemory(mem(GHII, 'shared.note', { from: 'ghii' }));
    await storage.setMemory(mem(`agent0#${OWNER}@${NODE}`, 'shared.note', { from: 'agent0' }));
    await storage.setMemory(mem(`agent0#${OWNER}@${NODE}`, 'agent0.data', { n: 1 }));
    await storage.setMemory(mem(`agent1#${OWNER}@${NODE}`, 'agent1.data', { n: 2 }));
  });

  it('listOwnerScope matches listOwnerScopeMemory (deduped GHII-first)', async () => {
    const svc = createMemoryDbService(storage, { nodeId: NODE });
    const legacy = await listOwnerScopeMemory(storage, NODE, OWNER);
    const next = await svc.listOwnerScope(OWNER);
    const norm = (rows: MemoryRecord[]) => rows.map(r => `${r.key}@${r.ownerGaii}`).sort();
    expect(norm(next)).toEqual(norm(legacy));
    // The doubly-written key resolves to the GHII copy in both.
    expect(next.find(r => r.key === 'shared.note')?.ownerGaii).toBe(GHII);
  });

  it('listOwnerScopeMeta matches the legacy meta helper', async () => {
    const svc = createMemoryDbService(storage, { nodeId: NODE });
    const legacy = await listOwnerScopeMemoryMeta(storage, NODE, OWNER);
    const next = await svc.listOwnerScopeMeta(OWNER);
    const norm = (rows: { key: string; ownerGaii: string }[]) => rows.map(r => `${r.key}@${r.ownerGaii}`).sort();
    expect(norm(next)).toEqual(norm(legacy));
  });

  it('getOwnerScope matches getOwnerScopeMemory for GHII, agent-owned, and missing keys', async () => {
    const svc = createMemoryDbService(storage, { nodeId: NODE });
    for (const key of ['shared.note', 'agent1.data', 'does.not.exist']) {
      const legacy = await getOwnerScopeMemory(storage, NODE, OWNER, key);
      const next = await svc.getOwnerScope(OWNER, key);
      expect(next?.ownerGaii ?? null).toBe(legacy?.ownerGaii ?? null);
      expect(next?.value ?? null).toEqual(legacy?.value ?? null);
    }
  });

  it('countOwnerScope equals the distinct-key count of the deduped list', async () => {
    const svc = createMemoryDbService(storage, { nodeId: NODE });
    const list = await svc.listOwnerScope(OWNER);
    const count = await svc.countOwnerScope(OWNER);
    expect(count).toBe(new Set(list.map(r => r.key)).size);
  });

  it('deleteRecordFamily removes base + base.* but spares sibling keys', async () => {
    const base = 'organism.o.w.ws.crm.contacts.rec1';
    await storage.setMemory(mem(GHII, base, { root: true }));
    await storage.setMemory(mem(GHII, `${base}.latest`, { v: 'latest' }));
    await storage.setMemory(mem(GHII, `${base}.version.1`, { v: 1 }));
    await storage.setMemory(mem(GHII, `${base}X.latest`, { sibling: true })); // must NOT be deleted

    const svc = createMemoryDbService(storage, { nodeId: NODE });
    const removed = await svc.deleteRecordFamily(GHII, base);
    expect(removed).toBe(3);
    expect(await storage.getMemory(GHII, `${base}.latest`)).toBeNull();
    expect(await storage.getMemory(GHII, `${base}X.latest`)).not.toBeNull();
  });
});

describe('MemoryDbService.writeMany — Phase 1 batched write', () => {
  let storage: SqliteStorage;
  const OK = { valid: true } as const;

  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: 'pk', roles: ['owner'], createdAt: new Date().toISOString() });
    await storage.setMemory(mem(GHII, 'existing.key', { v: 'old' }));
  });

  const quota = { maxKeysPerOwner: 1000, maxValueSizeBytes: 100 * 1024, totalQuotaBytes: 10 * 1024 * 1024 };

  it('creates new keys and updates existing ones, committing all rows', async () => {
    const svc = createMemoryDbService(storage, { nodeId: NODE });
    const res = await svc.writeMany(GHII, [
      { key: 'existing.key', value: { v: 'new' } },
      { key: 'fresh.a', value: { n: 1 } },
      { key: 'fresh.b', value: { n: 2 } },
    ], { quota, validate: async () => OK });
    expect(res).toMatchObject({ created: 2, updated: 1, skipped: 0, failed: 0 });
    expect((await storage.getMemory(GHII, 'existing.key'))!.value).toEqual({ v: 'new' });
    expect((await storage.getMemory(GHII, 'existing.key'))!.version).toBe(2);
    expect(await storage.getMemory(GHII, 'fresh.a')).not.toBeNull();
    expect(await storage.getMemory(GHII, 'fresh.b')).not.toBeNull();
  });

  it('mode:skip leaves existing keys untouched', async () => {
    const svc = createMemoryDbService(storage, { nodeId: NODE });
    const res = await svc.writeMany(GHII, [
      { key: 'existing.key', value: { v: 'ignored' } },
      { key: 'fresh.c', value: { n: 3 } },
    ], { mode: 'skip', quota, validate: async () => OK });
    expect(res).toMatchObject({ created: 1, updated: 0, skipped: 1 });
    expect((await storage.getMemory(GHII, 'existing.key'))!.value).toEqual({ v: 'old' });
  });

  it('enforces key-count quota, value-size, and schema validation per entry', async () => {
    const svc = createMemoryDbService(storage, { nodeId: NODE });
    const res = await svc.writeMany(GHII, [
      { key: 'big', value: 'x'.repeat(20) },       // fails size (tiny cap below)
      { key: 'bad.schema', value: { n: 1 } },      // fails injected schema
      { key: 'ok', value: { n: 1 } },
    ], {
      quota: { maxKeysPerOwner: 1000, maxValueSizeBytes: 10, totalQuotaBytes: 10 * 1024 * 1024 },
      validate: async (key) => ({ valid: key !== 'bad.schema' }),
    });
    expect(res.created).toBe(1);
    expect(res.failed).toBe(2);
    const reasons = res.items.filter(i => i.status === 'failed').map(i => i.reason);
    expect(reasons).toContain('value too large');
    expect(reasons).toContain('schema validation failed');
    expect(await storage.getMemory(GHII, 'ok')).not.toBeNull();
    expect(await storage.getMemory(GHII, 'big')).toBeNull();
  });

  it('refuses to overwrite an archived record (read-only parity with single write)', async () => {
    await storage.archiveMemoryByKey('existing.key', { archivedRoot: 'r', archivedBy: OWNER, archivedAt: new Date().toISOString(), match: 'exact' });
    const svc = createMemoryDbService(storage, { nodeId: NODE });
    const res = await svc.writeMany(GHII, [
      { key: 'existing.key', value: { v: 'attempt' } },
      { key: 'brand.new', value: { n: 1 } },
    ], { quota, validate: async () => OK });
    expect(res.created).toBe(1);
    expect(res.items.find(i => i.key === 'existing.key')).toMatchObject({ status: 'failed', reason: 'record is archived (read-only)' });
  });

  it('fails entries that would exceed the total-bytes quota', async () => {
    const svc = createMemoryDbService(storage, { nodeId: NODE });
    const res = await svc.writeMany(GHII, [
      { key: 'a', value: 'x'.repeat(30) },
      { key: 'b', value: 'y'.repeat(30) },
    ], { quota: { maxKeysPerOwner: 1000, maxValueSizeBytes: 1024, totalQuotaBytes: 50 }, validate: async () => OK });
    // Base is 11 bytes ('existing.key' from beforeEach). 'a' (+32 = 43) fits under 50; 'b' (+32 = 75) exceeds.
    expect(res.created).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.items.find(i => i.key === 'b')?.reason).toBe('memory quota exceeded');
  });
});

describe('Storage bulk primitives (SQLite)', () => {
  let storage: SqliteStorage;
  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: 'pk', roles: ['owner'], createdAt: new Date().toISOString() });
  });

  it('getMemoryByKeys returns only existing keys, in one query', async () => {
    await storage.setMemory(mem(GHII, 'a', { n: 1 }));
    await storage.setMemory(mem(GHII, 'b', { n: 2 }));
    const rows = await storage.getMemoryByKeys!(GHII, ['a', 'missing', 'b']);
    expect(rows.map(r => r.key).sort()).toEqual(['a', 'b']);
  });

  it('bulkSetMemory writes all rows and bumps versions on overwrite', async () => {
    await storage.setMemory(mem(GHII, 'x', { v: 1 }));
    const out = await storage.bulkSetMemory!([mem(GHII, 'x', { v: 2 }), mem(GHII, 'y', { v: 1 })]);
    expect(out).toHaveLength(2);
    expect((await storage.getMemory(GHII, 'x'))!.version).toBe(2);
    expect((await storage.getMemory(GHII, 'y'))!.version).toBe(1);
  });

  it('deleteMemorySubtree removes base + base.* but not a sibling baseX', async () => {
    const base = 'rec.1';
    await storage.setMemory(mem(GHII, base, { root: true }));
    await storage.setMemory(mem(GHII, `${base}.latest`, {}));
    await storage.setMemory(mem(GHII, `${base}.version.1`, {}));
    await storage.setMemory(mem(GHII, `${base}X`, { sibling: true }));
    const removed = await storage.deleteMemorySubtree!(GHII, base);
    expect(removed).toBe(3);
    expect(await storage.getMemory(GHII, `${base}X`)).not.toBeNull();
  });

  it('deleteMemoryByPrefix wipes all owners + active AND archived, but spares sibling containers', async () => {
    const wsPrefix = 'organism.abc.w.ws.';
    await storage.setMemory(mem(GHII, `${wsPrefix}crm.rec0.latest`, { a: 1 }));
    await storage.setMemory(mem(`agent0#${OWNER}@${NODE}`, `${wsPrefix}crm.rec0.version.1`, { a: 1 })); // cross-owner row
    await storage.setMemory(mem(GHII, `${wsPrefix}crm.rec1.latest`, { a: 2 }));
    await storage.setMemory(mem(GHII, 'organism.abc.w.ws2.crm.rec0.latest', { other: true })); // sibling ws
    await storage.setMemory(mem(GHII, 'organism.abcd.w.ws.crm.rec0.latest', { other: true }));  // sibling org
    // Archive one row — the wipe must still remove it (delete everything under the container).
    await storage.archiveMemoryByKey(`${wsPrefix}crm.rec1.latest`, { archivedRoot: 'r', archivedBy: OWNER, archivedAt: new Date().toISOString(), match: 'exact' });

    const removed = await storage.deleteMemoryByPrefix!(wsPrefix);
    expect(removed).toBe(3); // 2 active (rec0.latest, rec0.version.1) + 1 archived (rec1.latest)
    expect(await storage.getMemory(GHII, 'organism.abc.w.ws2.crm.rec0.latest')).not.toBeNull();
    expect(await storage.getMemory(GHII, 'organism.abcd.w.ws.crm.rec0.latest')).not.toBeNull();
  });

  it('listMemoryKeysByPrefix returns value-free addresses, all owners, ACTIVE only', async () => {
    await storage.setMemory(mem(GHII, 'ns.a.latest', { big: 'value' }));
    await storage.setMemory(mem(`agent0#${OWNER}@${NODE}`, 'ns.a.version.1', { big: 'value' }));
    await storage.setMemory(mem(GHII, 'ns.b.latest', {}));
    await storage.setMemory(mem(GHII, 'other.x', {}));   // different prefix
    await storage.archiveMemoryByKey('ns.b.latest', { archivedRoot: 'r', archivedBy: OWNER, archivedAt: new Date().toISOString(), match: 'exact' });
    const rows = await storage.listMemoryKeysByPrefix!('ns.');
    // value-free shape, active only (ns.b.latest archived → excluded), all owners (GHII + agent).
    expect(rows.every(r => !('value' in r))).toBe(true);
    expect(rows.map(r => r.key).sort()).toEqual(['ns.a.latest', 'ns.a.version.1']);
    expect(rows.find(r => r.key === 'ns.a.version.1')?.ownerGaii).toBe(`agent0#${OWNER}@${NODE}`);
  });

  it('bulkDeleteMemory removes exactly the given (owner,key) refs in one unit', async () => {
    await storage.setMemory(mem(GHII, 'rec.a.latest', {}));
    await storage.setMemory(mem(`agent0#${OWNER}@${NODE}`, 'rec.a.version.1', {})); // cross-owner family row
    await storage.setMemory(mem(GHII, 'rec.b.latest', { keep: true }));
    const removed = await storage.bulkDeleteMemory!([
      { ownerGaii: GHII, key: 'rec.a.latest' },
      { ownerGaii: `agent0#${OWNER}@${NODE}`, key: 'rec.a.version.1' },
      { ownerGaii: GHII, key: 'rec.missing' },
    ]);
    expect(removed).toBe(2);
    expect(await storage.getMemory(GHII, 'rec.b.latest')).not.toBeNull();
    expect(await storage.getMemory(`agent0#${OWNER}@${NODE}`, 'rec.a.version.1')).toBeNull();
  });
});

describe('MemoryRepository.dedupByKey', () => {
  it('keeps the highest-priority identity per key', () => {
    const identities = [GHII, `agent0#${OWNER}@${NODE}`];
    const rows = [
      { key: 'k', ownerGaii: `agent0#${OWNER}@${NODE}` },
      { key: 'k', ownerGaii: GHII },
    ];
    const out = MemoryRepository.dedupByKey(rows, identities);
    expect(out).toHaveLength(1);
    expect(out[0].ownerGaii).toBe(GHII);
  });
});

describe('IdentityMap', () => {
  it('getOrLoad runs the loader once and caches (incl. null)', async () => {
    const map = new IdentityMap();
    let calls = 0;
    const load = async () => { calls++; return null; };
    const a = await map.getOrLoad('organism', 'o1', load);
    const b = await map.getOrLoad('organism', 'o1', load);
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(calls).toBe(1);
    expect(map.has('organism', 'o1')).toBe(true);
  });

  it('concurrent getOrLoad shares one in-flight load', async () => {
    const map = new IdentityMap();
    let calls = 0;
    const load = async () => { calls++; await Promise.resolve(); return { id: 'x' }; };
    const [a, b] = await Promise.all([
      map.getOrLoad('e', 'x', load),
      map.getOrLoad('e', 'x', load),
    ]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });
});

