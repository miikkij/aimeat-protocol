/**
 * @file test/unit/file-store-relocate-guards.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a move of a file's bytes between a store and the database must not do
 *   (secaudit2026nov08b round 15). A move out of a store must not write back a visibility, tags or
 *   provenance the row had before the object was downloaded (file-store/relocate-from-store-rewrites-stale-row).
 *   The automatic moves into the database (the return job and the end of a direct upload) must not
 *   put a file in the database past the per-file ceiling `storageMaxFileSizeMb`, and the return job
 *   must not move a person's file from their own store into the database past their storage quota
 *   (file-store/relocate-to-database-without-file-or-quota-ceiling). The uses kept are proved beside
 *   each: an unchanged file moves with everything it had, and a small file still comes back to the
 *   database from the person's store and from the node's.
 * @usage cd aimeat && pnpm exec vitest run test/unit/file-store-relocate-guards.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08b round 15).
 */
import { describe, expect, it } from 'vitest';
import { adoptStorageObject, relocateStorageFile, wrapStorageWithFileStores, type FileStoreTarget } from '../../src/storage/blob/file-store-wrap.js';
import { formatBlobRef, type BlobStore } from '../../src/storage/blob/blob-types.js';
import { returnUntakenFiles } from '../../src/services/file-store/file-store-return.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, StorageFileRecord } from '../../src/storage/interface.js';

const MB = 1024 * 1024;
const BOB = 'bob@node-1';
const OWN_STORE = 'owner:bob@node-1/main';
const NODE_STORE = 'node:main';

/** An in-memory store whose get() can be held until the test lets it go. */
function fakeStore() {
  const map = new Map<string, Buffer>();
  let hold: Promise<void> | null = null;
  let entered: () => void = () => {};
  const store = {
    map, kind: 's3', describe: () => 'fake',
    async put(k: string, d: Buffer) { map.set(k, Buffer.from(d)); },
    async get(k: string) { if (hold) { entered(); await hold; } return map.get(k) ?? null; },
    async getRange(k: string, start: number, len: number) { const b = map.get(k); return b ? b.subarray(start, start + len) : null; },
    async head(k: string) { const b = map.get(k); return b ? { size: b.length, contentType: 'application/octet-stream' } : null; },
    async delete(k: string) { map.delete(k); },
    async list() { return { objects: [...map.keys()].map(key => ({ key, lastModified: '', size: 0 })) }; },
  };
  /** The next get() waits; answers a promise that resolves once get() is waiting, and the release. */
  function holdNextGet(): { waiting: Promise<void>; release: () => void } {
    let release: () => void = () => {};
    hold = new Promise<void>(r => { release = () => { hold = null; r(); }; });
    const waiting = new Promise<void>(r => { entered = r; });
    return { waiting, release };
  }
  return { store: store as unknown as BlobStore & { map: Map<string, Buffer> }, holdNextGet };
}

const file = (key: string, bytes: number, mimeType: string, extra: Partial<StorageFileRecord> = {}): StorageFileRecord => ({
  key, ownerGaii: BOB, visibility: 'private', mimeType, size: bytes, data: Buffer.alloc(bytes, 120), createdAt: '2026-11-01T00:00:00Z', ...extra,
});

/** A real SQLite storage whose file methods go through the wrapper to one fake store. */
function wrapped(storeId: string) {
  const storage = new SqliteStorage(':memory:') as unknown as Storage;
  const fake = fakeStore();
  let takes: FileStoreTarget['takes'];
  const target = (): FileStoreTarget => ({ storeId, store: fake.store, prefix: 'p/', ...(takes ? { takes } : {}) });
  wrapStorageWithFileStores(storage, {
    forWrite: async () => target(),
    forRead: async () => fake.store,
    takesOf: async () => takes ?? null,
  });
  return { storage, fake, target, setTakes: (t: FileStoreTarget['takes']) => { takes = t; } };
}

const config = (over: Partial<AimeatConfig> = {}) => ({ storageMaxFileSizeMb: 1, storageQuotaMb: 2, ...over }) as AimeatConfig;
const inStore = async (storage: Storage, key: string) => !!(await storage.getStorageFileMeta(BOB, key))?.blobRef;

describe('a move out of a store keeps a change made while it ran', () => {
  it('a file narrowed to private during the download stays private after the move to the database', async () => {
    const { storage, fake } = wrapped(OWN_STORE);
    await storage.createStorageFile(file('report.txt', 2000, 'text/plain', { visibility: 'public', tags: ['a'] }));
    expect(await inStore(storage, 'report.txt')).toBe(true);

    const { waiting, release } = fake.holdNextGet();
    const moving = relocateStorageFile(storage, BOB, 'report.txt', null);
    await waiting;
    // The SQLite UPDATE runs at once; the method then reads the file back through the held store.
    const narrowing = storage.updateFileVisibility(BOB, 'report.txt', 'private');
    release();
    await narrowing;
    expect(await moving).toBe('moved');

    const row = await storage.getStorageFileMeta(BOB, 'report.txt');
    expect(row?.blobRef).toBeUndefined();
    expect(row?.visibility).toBe('private');
  });

  it('a file narrowed to private during the download stays private after a move to another store', async () => {
    const { storage, fake } = wrapped(OWN_STORE);
    await storage.createStorageFile(file('report.txt', 2000, 'text/plain', { visibility: 'public' }));
    const other = fakeStore();
    const to: FileStoreTarget = { storeId: NODE_STORE, store: other.store, prefix: 'n/' };

    const { waiting, release } = fake.holdNextGet();
    const moving = relocateStorageFile(storage, BOB, 'report.txt', to);
    await waiting;
    const narrowing = storage.updateFileVisibility(BOB, 'report.txt', 'private');
    release();
    await narrowing;
    expect(await moving).toBe('moved');
    expect((await storage.getStorageFileMeta(BOB, 'report.txt'))?.visibility).toBe('private');
  });

  it('use kept: an unchanged file moves with its key, owner, visibility, tags, provenance and creation time', async () => {
    const { storage } = wrapped(OWN_STORE);
    await storage.createStorageFile(file('kept.txt', 2000, 'text/plain', { visibility: 'public', tags: ['x', 'y'], aiProvenanceId: 'prov-1' }));
    const before = await storage.getStorageFileMeta(BOB, 'kept.txt');
    expect(await relocateStorageFile(storage, BOB, 'kept.txt', null)).toBe('moved');
    const after = await storage.getStorageFile(BOB, 'kept.txt');
    expect(after?.blobRef).toBeUndefined();
    expect(after?.data.length).toBe(2000);
    for (const k of ['key', 'ownerGaii', 'visibility', 'tags', 'aiProvenanceId', 'createdAt', 'mimeType', 'size'] as const) {
      expect(after?.[k]).toEqual(before?.[k]);
    }
  });
});

describe('the return job keeps the database ceilings', () => {
  it('leaves a file over the per-file ceiling, and a person\'s file past their quota, in their own store', async () => {
    const { storage, fake, setTakes } = wrapped(OWN_STORE);
    // Admitted to the person's own store while it took every file: outside the quota.
    for (const n of ['a', 'b', 'c']) await storage.createStorageFile(file(`${n}.txt`, 900 * 1024, 'text/plain'));
    await storage.createStorageFile(file('big.txt', Math.round(1.5 * MB), 'text/plain'));
    expect(fake.store.map.size).toBe(4);
    // The person then says the store is for nothing under 100 MB.
    setTakes({ minBytes: 100 * MB, kinds: [] });

    const r = await returnUntakenFiles({ storage, config: config() }, {
      targetOf: async () => ({ storeId: OWN_STORE, store: fake.store, prefix: 'p/', takes: { minBytes: 100 * MB, kinds: [] } }),
    });
    // Two 900 kB files fit the 2 MB quota; the third would not, and the 1.5 MB file is over the 1 MB ceiling.
    expect(r[0].moved).toBe(2);
    expect(await inStore(storage, 'big.txt')).toBe(true);
    const inDb = (await storage.listStorageFiles(BOB)).filter(f => !f.blobRef);
    expect(inDb.reduce((a, f) => a + f.size, 0)).toBeLessThanOrEqual(2 * MB);
    // Nothing is lost: every file still reads.
    for (const n of ['a', 'b', 'c', 'big']) expect((await storage.getStorageFile(BOB, `${n}.txt`))?.data.length).toBeGreaterThan(0);
  });

  it('leaves a file over the per-file ceiling in the node\'s store', async () => {
    const { storage, fake } = wrapped(NODE_STORE);
    await storage.createStorageFile(file('big.txt', Math.round(1.5 * MB), 'text/plain'));
    const r = await returnUntakenFiles({ storage, config: config({ storageQuotaMb: 100 }) }, {
      targetOf: async () => ({ storeId: NODE_STORE, store: fake.store, prefix: 'p/', takes: { minBytes: 100 * MB, kinds: [] } }),
    });
    expect(r[0].moved).toBe(0);
    expect(await inStore(storage, 'big.txt')).toBe(true);
  });

  it('use kept: a small file comes back to the database from a person\'s store and from the node\'s', async () => {
    for (const storeId of [OWN_STORE, NODE_STORE]) {
      const { storage, fake } = wrapped(storeId);
      await storage.createStorageFile(file('small.txt', 500, 'text/plain'));
      const r = await returnUntakenFiles({ storage, config: config() }, {
        targetOf: async () => ({ storeId, store: fake.store, prefix: 'p/', takes: { minBytes: MB, kinds: ['video', 'audio'] } }),
      });
      expect(r[0].moved).toBe(1);
      expect(await inStore(storage, 'small.txt')).toBe(false);
      expect((await storage.getStorageFile(BOB, 'small.txt'))?.data.length).toBe(500);
    }
  });
});

describe('a direct upload the store does not take keeps the per-file ceiling', () => {
  it('a file over the ceiling stays in the store and still reads', async () => {
    const { storage, fake, setTakes } = wrapped(OWN_STORE);
    setTakes({ minBytes: 100 * MB, kinds: [] });
    const bytes = Math.round(1.5 * MB);
    fake.store.map.set('p/direct-1', Buffer.alloc(bytes, 65));
    await adoptStorageObject(storage, { ...file('direct.bin', bytes, 'application/octet-stream'), data: Buffer.alloc(0) },
      formatBlobRef(OWN_STORE, 'p/direct-1'), { maxDatabaseBytes: MB });
    expect(await inStore(storage, 'direct.bin')).toBe(true);
    expect((await storage.getStorageFile(BOB, 'direct.bin'))?.data.length).toBe(bytes);
  });

  it('use kept: a small direct upload moves to the database', async () => {
    const { storage, fake, setTakes } = wrapped(OWN_STORE);
    setTakes({ minBytes: 100 * MB, kinds: [] });
    fake.store.map.set('p/direct-2', Buffer.from('tiny'));
    await adoptStorageObject(storage, { ...file('tiny.txt', 4, 'text/plain'), data: Buffer.alloc(0) },
      formatBlobRef(OWN_STORE, 'p/direct-2'), { maxDatabaseBytes: MB });
    expect(await inStore(storage, 'tiny.txt')).toBe(false);
    expect(fake.store.map.size).toBe(0);
  });
});
