/**
 * @file test/unit/file-store-relocate-cas.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The write that moves a file's bytes between a store and the database is conditional on
 *   the row being the one the move read (secaudit2026nov08b round 15b). Round 15 made a move out of a
 *   store write the row from a copy read just before the write; a visibility, tags or provenance change
 *   that landed between that read and the write was still lost, and a move out of the database could
 *   point a row at an object that held the bytes before a same-size re-upload. Each case here injects
 *   the change at the provider's write, after every read the move makes, on SQLite and, when
 *   DATABASE_URL is set, on PostgreSQL. The uses kept are proved beside them: an unchanged file moves
 *   in one attempt, and a file that keeps changing is left where it is with nothing left behind.
 * @usage cd aimeat && pnpm exec vitest run test/unit/file-store-relocate-cas.test.ts
 *   (with PostgreSQL: pnpm exec node --env-file=.env.test.postgres-kysely node_modules/vitest/vitest.mjs run …)
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08b round 15b, file-store/relocate-from-store-rewrites-stale-row).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { RELOCATE_ATTEMPTS, relocateStorageFile, wrapStorageWithFileStores, type FileStoreTarget } from '../../src/storage/blob/file-store-wrap.js';
import type { BlobStore } from '../../src/storage/blob/blob-types.js';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, StorageFileRecord } from '../../src/storage/interface.js';
import { requirePostgresWhenAsked } from './postgres-arm.js';

const SQLITE_PATH = `./test/.relocate-cas-${process.pid}.db`;
// A run that asks for PostgreSQL (CI's Postgres job) fails here without a URL, never skips the half.
requirePostgresWhenAsked('file-store-relocate-cas');
const PG_URL = process.env.DATABASE_URL ?? '';
const SOURCE = 'owner:bob@node-1/main';
const OTHER = 'node:main';

/** An in-memory object store. */
function fakeStore() {
  const map = new Map<string, Buffer>();
  const store = {
    map, kind: 's3', describe: () => 'fake',
    async put(k: string, d: Buffer) { map.set(k, Buffer.from(d)); },
    async get(k: string) { return map.get(k) ?? null; },
    async getRange(k: string, start: number, len: number) { const b = map.get(k); return b ? b.subarray(start, start + len) : null; },
    async head(k: string) { const b = map.get(k); return b ? { size: b.length, contentType: 'application/octet-stream' } : null; },
    async delete(k: string) { map.delete(k); },
    async list() { return { objects: [...map.keys()].map(key => ({ key, lastModified: '', size: 0 })) }; },
  };
  return store as unknown as BlobStore & { map: Map<string, Buffer> };
}

/** The provider methods a move may write the row through. Before the fix it wrote with
 *  createStorageFile (out of a store) and setStorageFileBlobRef (out of the database). */
const WRITES = ['createStorageFile', 'setStorageFileBlobRef', 'moveStorageFileBytes'] as const;

interface Rig {
  storage: Storage;
  owner: string;
  source: BlobStore & { map: Map<string, Buffer> };
  /** The second store, `OTHER`, a move may go to. */
  other: BlobStore & { map: Map<string, Buffer> };
  /** The provider's own file methods, unwrapped: the concurrent writer of the test. */
  raw: { create: Storage['createStorageFile']; meta: Storage['getStorageFileMeta']; get: Storage['getStorageFile'] };
  /** Run `change` just before the move's next row write, `times` times (one per write). */
  beforeNextWrite: (change: () => Promise<unknown>, times?: number) => void;
  /** Writes `into` takes: the first file goes to the source store, or to the database with null. */
  writeTo: (where: 'store' | 'database') => void;
}

const rigs: { name: string; storage: Storage }[] = [];

beforeAll(async () => {
  rigs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
  if (PG_URL) rigs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
}, 60_000);

afterAll(async () => {
  for (const { storage } of rigs) await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = SQLITE_PATH + suffix;
    if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch */ } }
  }
});

/** A fresh storage instance over the provider's database, wrapped to one fake source store, with
 *  the provider's row writes interceptable. Each rig has its own owner, so cases never meet. */
async function rig(name: string): Promise<Rig> {
  const base = rigs.find(r => r.name === name)!.storage;
  // A per-case object that inherits the provider instance: the wrapper replaces methods on it, and
  // the interceptors below sit on it, so the shared instance is never changed.
  const storage = Object.create(base) as Storage;
  const s = storage as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const raw = {
    create: base.createStorageFile.bind(base),
    meta: base.getStorageFileMeta.bind(base),
    get: base.getStorageFile.bind(base),
  };
  const pending: (() => Promise<unknown>)[] = [];
  for (const m of WRITES) {
    const original = (base as unknown as Record<string, unknown>)[m];
    if (typeof original !== 'function') continue;
    s[m] = async (...args: unknown[]) => {
      const change = pending.shift();
      if (change) await change();
      return (original as (...a: unknown[]) => Promise<unknown>).apply(base, args);
    };
  }
  const source = fakeStore();
  const other = fakeStore();
  let where: 'store' | 'database' = 'store';
  wrapStorageWithFileStores(storage, {
    forWrite: async () => (where === 'store' ? { storeId: SOURCE, store: source, prefix: 'p/' } : null),
    forRead: async (id: string) => (id === SOURCE ? source : id === OTHER ? other : null),
  });
  return {
    storage, owner: `bob-${randomUUID().slice(0, 8)}@node-1`, source, other, raw,
    beforeNextWrite: (change, times = 1) => { for (let i = 0; i < times; i++) pending.push(change); },
    writeTo: (w) => { where = w; },
  };
}

const file = (owner: string, key: string, extra: Partial<StorageFileRecord> = {}): StorageFileRecord => ({
  key, ownerGaii: owner, visibility: 'public', mimeType: 'text/plain', size: 2000, data: Buffer.alloc(2000, 120),
  createdAt: '2026-11-01T00:00:00.000Z', tags: ['a'], ...extra,
});

const providers = () => rigs.map(r => r.name);

describe.each(['sqlite', 'postgres-kysely'])('the move writes conditionally on %s', (name) => {
  const skip = () => !providers().includes(name);

  it('a file narrowed to private between the read and the write stays private after the move to the database', async (ctx) => {
    if (skip()) return ctx.skip();
    const r = await rig(name);
    await r.storage.createStorageFile(file(r.owner, 'report.txt'));
    expect((await r.raw.meta(r.owner, 'report.txt'))?.blobRef).toBeTruthy();

    r.beforeNextWrite(() => r.storage.updateFileVisibility(r.owner, 'report.txt', 'private'));
    expect(await relocateStorageFile(r.storage, r.owner, 'report.txt', null)).toBe('moved');

    const row = await r.raw.get(r.owner, 'report.txt');
    expect(row?.blobRef).toBeUndefined();
    expect(row?.visibility).toBe('private');
    expect(row?.data.length).toBe(2000);
    expect(r.source.map.size).toBe(0);
  });

  it('tags and provenance set between the read and the write stay after a move to another store', async (ctx) => {
    if (skip()) return ctx.skip();
    const r = await rig(name);
    await r.storage.createStorageFile(file(r.owner, 'notes.txt'));
    const other = r.other;
    const to: FileStoreTarget = { storeId: OTHER, store: other, prefix: 'n/' };

    r.beforeNextWrite(async () => {
      await r.storage.updateFileTagsByKey(r.owner, 'notes.txt', ['a', 'b']);
      await r.storage.setStorageFileProvenance(r.owner, 'notes.txt', 'prov-9');
    });
    expect(await relocateStorageFile(r.storage, r.owner, 'notes.txt', to)).toBe('moved');

    const row = await r.raw.meta(r.owner, 'notes.txt');
    expect(row?.blobRef?.startsWith(`${OTHER}|`)).toBe(true);
    expect(row?.tags).toEqual(['a', 'b']);
    expect(row?.aiProvenanceId).toBe('prov-9');
    // The object of the attempt that lost is gone; only the one the row names is left.
    expect(other.map.size).toBe(1);
    expect(r.source.map.size).toBe(0);
  });

  it('a same-size re-upload between the read and the write keeps its bytes after a move out of the database', async (ctx) => {
    if (skip()) return ctx.skip();
    const r = await rig(name);
    r.writeTo('database');
    await r.storage.createStorageFile(file(r.owner, 'data.bin'));
    expect((await r.raw.meta(r.owner, 'data.bin'))?.blobRef).toBeUndefined();
    const target: FileStoreTarget = { storeId: SOURCE, store: r.source, prefix: 'p/' };

    // The re-upload lands in the database with other bytes of the same size.
    r.beforeNextWrite(() => r.raw.create(file(r.owner, 'data.bin', { data: Buffer.alloc(2000, 66) })));
    await relocateStorageFile(r.storage, r.owner, 'data.bin', target);

    const row = await r.storage.getStorageFile(r.owner, 'data.bin');
    expect(row?.data.equals(Buffer.alloc(2000, 66))).toBe(true);
  });

  it('a file that changes at every attempt is left where it is, and the move leaves no object behind', async (ctx) => {
    if (skip()) return ctx.skip();
    const r = await rig(name);
    await r.storage.createStorageFile(file(r.owner, 'busy.txt'));
    const before = await r.raw.meta(r.owner, 'busy.txt');
    let n = 0;
    r.beforeNextWrite(() => r.storage.updateFileTagsByKey(r.owner, 'busy.txt', [`t${++n}`]), 50);
    const other = r.other;
    expect(await relocateStorageFile(r.storage, r.owner, 'busy.txt', { storeId: OTHER, store: other, prefix: 'n/' })).toBe('changed');

    const row = await r.raw.meta(r.owner, 'busy.txt');
    expect(row?.blobRef).toBe(before?.blobRef);
    expect(row?.tags).toEqual([`t${n}`]);
    // A bounded number of attempts, each of which removed what it wrote.
    expect(n).toBe(RELOCATE_ATTEMPTS);
    expect(other.map.size).toBe(0);
    expect((await r.storage.getStorageFile(r.owner, 'busy.txt'))?.data.length).toBe(2000);
  });

  it('use kept: an unchanged file moves in one write, with everything it had', async (ctx) => {
    if (skip()) return ctx.skip();
    const r = await rig(name);
    await r.storage.createStorageFile(file(r.owner, 'kept.txt', { tags: ['x', 'y'], aiProvenanceId: 'prov-1' }));
    const before = await r.raw.meta(r.owner, 'kept.txt');
    let writes = 0;
    r.beforeNextWrite(async () => { writes++; }, 10);
    expect(await relocateStorageFile(r.storage, r.owner, 'kept.txt', null)).toBe('moved');
    expect(writes).toBe(1);
    const after = await r.raw.get(r.owner, 'kept.txt');
    expect(after?.blobRef).toBeUndefined();
    expect(after?.data.length).toBe(2000);
    for (const k of ['key', 'ownerGaii', 'visibility', 'tags', 'aiProvenanceId', 'createdAt', 'mimeType', 'size'] as const) {
      expect(after?.[k]).toEqual(before?.[k]);
    }
  });

  it('use kept: a file moves from the database to a store and back', async (ctx) => {
    if (skip()) return ctx.skip();
    const r = await rig(name);
    r.writeTo('database');
    await r.storage.createStorageFile(file(r.owner, 'round.txt'));
    const target: FileStoreTarget = { storeId: SOURCE, store: r.source, prefix: 'p/' };
    expect(await relocateStorageFile(r.storage, r.owner, 'round.txt', target)).toBe('moved');
    expect((await r.raw.meta(r.owner, 'round.txt'))?.blobRef?.startsWith(`${SOURCE}|`)).toBe(true);
    expect(await relocateStorageFile(r.storage, r.owner, 'round.txt', target)).toBe('already-there');
    expect(await relocateStorageFile(r.storage, r.owner, 'round.txt', null)).toBe('moved');
    const row = await r.raw.get(r.owner, 'round.txt');
    expect(row?.blobRef).toBeUndefined();
    expect(row?.data.equals(Buffer.alloc(2000, 120))).toBe(true);
    expect(r.source.map.size).toBe(0);
  });
});
