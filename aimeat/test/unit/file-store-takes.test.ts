/**
 * @file test/unit/file-store-takes.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A store says which files it is for, and a file it is not for keeps its bytes in the
 *   database (wish-a-file-store-says-what-it-is-for-so-small-files-stay-in-post). On 2026-11-08 one
 *   account's Azure container held about 9200 files of under one kilobyte: every file went to the
 *   default store whatever its size, and the content class fingerprint loop (fixed in 669d8e254) had
 *   written thousands of them. Proved here, without a network: the rule itself; the storage wrapper
 *   keeping a small file in the database and sending a large one or a video to the store, also when
 *   the writer named the store; a direct upload that turns out small moving to the database when it
 *   completes; the move of the files a store holds and no longer takes; and the removal of the
 *   fingerprint loop's leftovers, which keeps the real items' facts and the files they name.
 * @usage cd aimeat && pnpm exec vitest run test/unit/file-store-takes.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_TAKES, fileKindOf, readTakesInput, storeTakesFile, takesOrDefault, takesView, type StoreTakes,
} from '../../src/storage/blob/store-takes.js';
import { adoptStorageObject, relocateStorageFile, wrapStorageWithFileStores, type FileStoreTarget } from '../../src/storage/blob/file-store-wrap.js';
import { formatBlobRef, type BlobStore } from '../../src/storage/blob/blob-types.js';
import { returnUntakenFiles } from '../../src/services/file-store/file-store-return.js';
import { removeFingerprintLoopLeftovers } from '../../src/services/content/leftovers.js';
import { allFacts, putFacts, sourceIdOf } from '../../src/services/content/facts-store.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import type { Storage, StorageFileRecord } from '../../src/storage/interface.js';
import type { ContentFacts } from '../../src/services/content/types.js';

const MB = 1024 * 1024;
const OWNER = 'alice@node-1';

function fakeStore(): BlobStore & { map: Map<string, Buffer> } {
  const map = new Map<string, Buffer>();
  return {
    map, kind: 's3', describe: () => 'fake',
    async put(k: string, d: Buffer) { map.set(k, Buffer.from(d)); },
    async get(k: string) { return map.get(k) ?? null; },
    async getRange(k: string, start: number, len: number) { const b = map.get(k); return b ? b.subarray(start, start + len) : null; },
    async delete(k: string) { map.delete(k); },
    async list() { return { objects: [...map.keys()].map(key => ({ key, lastModified: '', size: 0 })) }; },
  } as unknown as BlobStore & { map: Map<string, Buffer> };
}

const file = (key: string, bytes: number, mimeType: string, createdAt = '2026-11-01T00:00:00Z'): StorageFileRecord => ({
  key, ownerGaii: OWNER, visibility: 'private', mimeType, size: bytes, data: Buffer.alloc(bytes, 120), createdAt,
});

/** A real SQLite storage whose file methods go through the wrapper to one fake store. */
function wrapped(takes: StoreTakes | undefined, opts: { store?: ReturnType<typeof fakeStore>; to?: () => boolean } = {}) {
  const storage = new SqliteStorage(':memory:') as unknown as Storage;
  const store = opts.store ?? fakeStore();
  const target: FileStoreTarget = { storeId: 'owner:alice@node-1/main', store, prefix: 'p/', ...(takes ? { takes } : {}) };
  wrapStorageWithFileStores(storage, {
    forWrite: async () => (opts.to && !opts.to() ? null : target),
    forRead: async () => store,
    takesOf: async () => takes ?? null,
  });
  return { storage, store, target };
}

const inStore = async (storage: Storage, key: string) => !!(await storage.getStorageFileMeta(OWNER, key))?.blobRef;

describe('the rule', () => {
  it('takes a file of a listed kind whatever its size, and any other file from the size limit up', () => {
    expect(storeTakesFile(DEFAULT_TAKES, 10, 'video/mp4')).toBe(true);
    expect(storeTakesFile(DEFAULT_TAKES, 10, 'audio/mpeg')).toBe(true);
    expect(storeTakesFile(DEFAULT_TAKES, 436, 'text/plain; charset=utf-8')).toBe(false);
    expect(storeTakesFile(DEFAULT_TAKES, 900 * 1024, 'image/png')).toBe(false);
    expect(storeTakesFile(DEFAULT_TAKES, MB, 'application/json')).toBe(true);
    expect(storeTakesFile({ minBytes: 0, kinds: [] }, 1, 'text/plain')).toBe(true);
    // A size not known yet (a direct upload before its bytes are there) counts as large.
    expect(storeTakesFile(DEFAULT_TAKES, undefined, 'text/plain')).toBe(true);
  });

  it('reads a media type as a kind', () => {
    expect(fileKindOf('Video/WebM')).toBe('video');
    expect(fileKindOf('application/pdf')).toBe('pdf');
    expect(fileKindOf('image/svg+xml')).toBe('image');
    expect(fileKindOf('application/json')).toBeNull();
  });

  it('reads a store with no rule, or a broken one, as the default', () => {
    expect(takesOrDefault(undefined)).toEqual({ minBytes: MB, kinds: ['video', 'audio'] });
    expect(takesOrDefault({ minBytes: -1, kinds: [] })).toEqual({ minBytes: MB, kinds: ['video', 'audio'] });
    expect(takesOrDefault({ minBytes: 5, kinds: ['image', 'nonsense'] })).toEqual({ minBytes: 5, kinds: ['image'] });
  });

  it('takes a rule as typed, keeps a part left out, and names what is wrong', () => {
    expect(readTakesInput(undefined)).toBeUndefined();
    expect(readTakesInput({ min_mb: 0.5 })).toEqual({ minBytes: MB / 2, kinds: ['video', 'audio'] });
    expect(readTakesInput({ kinds: ['image'] }, { minBytes: 3, kinds: ['video'] })).toEqual({ minBytes: 3, kinds: ['image'] });
    expect(readTakesInput({ min_mb: -1 })).toHaveProperty('problem');
    expect(readTakesInput({ kinds: ['text'] })).toHaveProperty('problem');
    expect(readTakesInput('1')).toHaveProperty('problem');
    expect(takesView({ minBytes: MB, kinds: ['video'] })).toEqual({ min_mb: 1, kinds: ['video'] });
  });
});

describe('the storage wrapper with a rule', () => {
  it('keeps a small text file in the database and sends a large one and a small video to the store', async () => {
    const { storage, store } = wrapped({ ...DEFAULT_TAKES });
    await storage.createStorageFile(file('contentclass-text/a.txt', 436, 'text/plain; charset=utf-8'));
    await storage.createStorageFile(file('big.json', 2 * MB, 'application/json'));
    await storage.createStorageFile(file('clip.mp4', 2000, 'video/mp4'));
    expect(await inStore(storage, 'contentclass-text/a.txt')).toBe(false);
    expect((await storage.getStorageFile(OWNER, 'contentclass-text/a.txt'))?.data.length).toBe(436);
    expect(await inStore(storage, 'big.json')).toBe(true);
    expect(await inStore(storage, 'clip.mp4')).toBe(true);
    expect(store.map.size).toBe(2);
  });

  it('a store with no rule on its target takes every file, as before', async () => {
    const { storage, store } = wrapped(undefined);
    await storage.createStorageFile(file('a.txt', 10, 'text/plain'));
    expect(store.map.size).toBe(1);
  });

  it('removes the object a file had when a smaller version of it goes to the database', async () => {
    const { storage, store } = wrapped({ ...DEFAULT_TAKES });
    await storage.createStorageFile(file('notes.txt', 2 * MB, 'text/plain'));
    expect(store.map.size).toBe(1);
    await storage.createStorageFile(file('notes.txt', 100, 'text/plain'));
    expect(await inStore(storage, 'notes.txt')).toBe(false);
    expect(store.map.size).toBe(0);
  });

  it('refuses a move to a store that does not take the file, and moves it when the store does', async () => {
    const { storage, target } = wrapped({ ...DEFAULT_TAKES }, { to: () => false });
    await storage.createStorageFile(file('small.txt', 10, 'text/plain'));
    await storage.createStorageFile(file('large.txt', 2 * MB, 'text/plain'));
    expect(await relocateStorageFile(storage, OWNER, 'small.txt', target)).toBe('not-taken');
    expect(await relocateStorageFile(storage, OWNER, 'large.txt', target)).toBe('moved');
  });

  it('moves a direct upload that turns out small to the database when it completes', async () => {
    const { storage, store } = wrapped({ ...DEFAULT_TAKES });
    const blobRef = formatBlobRef('owner:alice@node-1/main', 'p/direct-1');
    store.map.set('p/direct-1', Buffer.from('tiny'));
    await adoptStorageObject(storage, { ...file('direct.txt', 4, 'text/plain'), data: Buffer.alloc(0) }, blobRef);
    expect(await inStore(storage, 'direct.txt')).toBe(false);
    expect((await storage.getStorageFile(OWNER, 'direct.txt'))?.data.toString()).toBe('tiny');
    expect(store.map.size).toBe(0);
  });
});

describe('returnUntakenFiles', () => {
  it('moves the files a store holds and does not take to the database, and leaves the rest', async () => {
    const store = fakeStore();
    // Written while the store took every file, as before the rule.
    const { storage } = wrapped(undefined, { store });
    for (let i = 0; i < 5; i++) await storage.createStorageFile(file(`contentclass-text/${i}.txt`, 436, 'text/plain'));
    await storage.createStorageFile(file('film.mp4', 3000, 'video/mp4'));
    await storage.createStorageFile(file('big.bin', 2 * MB, 'application/octet-stream'));
    expect(store.map.size).toBe(7);

    const target: FileStoreTarget = { storeId: 'owner:alice@node-1/main', store, prefix: 'p/', takes: { ...DEFAULT_TAKES } };
    const results = await returnUntakenFiles({ storage, config: {} as AimeatConfig }, { targetOf: async () => target });
    expect(results).toEqual([{ storeId: 'owner:alice@node-1/main', checked: 7, moved: 5, failed: 0 }]);
    expect(store.map.size).toBe(2);
    expect(await inStore(storage, 'contentclass-text/3.txt')).toBe(false);
    expect((await storage.getStorageFile(OWNER, 'contentclass-text/3.txt'))?.data.length).toBe(436);
    expect(await inStore(storage, 'film.mp4')).toBe(true);
    expect(await inStore(storage, 'big.bin')).toBe(true);

    // A second run finds nothing more to move.
    const again = await returnUntakenFiles({ storage, config: {} as AimeatConfig }, { targetOf: async () => target });
    expect(again[0].moved).toBe(0);
  });

  it('stops at the run\'s limit, and the next run goes on', async () => {
    const store = fakeStore();
    const { storage } = wrapped(undefined, { store });
    for (let i = 0; i < 4; i++) await storage.createStorageFile(file(`s/${i}.txt`, 10, 'text/plain'));
    const target: FileStoreTarget = { storeId: 'owner:alice@node-1/main', store, prefix: 'p/', takes: { ...DEFAULT_TAKES } };
    const ctx = { storage, config: {} as AimeatConfig };
    expect((await returnUntakenFiles(ctx, { maxMoves: 3, targetOf: async () => target }))[0].moved).toBe(3);
    expect((await returnUntakenFiles(ctx, { maxMoves: 3, targetOf: async () => target }))[0].moved).toBe(1);
    expect(store.map.size).toBe(0);
  });
});

describe('removeFingerprintLoopLeftovers', () => {
  let storage: Storage;
  let config: AimeatConfig;
  const writer = { principal: OWNER, ownerGhii: OWNER, scopes: [] as string[], roles: ['owner'] };
  const facts = (key: string, extra: Partial<ContentFacts> = {}): ContentFacts => {
    const source = { kind: 'file' as const, owner: OWNER, key };
    return {
      source, sourceId: sourceIdOf(source), stages: {}, readFrom: 'sha256:x', updatedAt: '2026-11-05T00:00:00Z',
      technical: { kind: 'text', size: 1, mimeType: 'text/plain', contentHash: 'sha256:x' }, ...extra,
    } as ContentFacts;
  };

  beforeEach(() => {
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    config = { ...loadConfig().config, nodeId: 'node-1' };
  });

  it('removes the facts of the pipeline\'s own files and the files nothing names, and keeps the real ones', async () => {
    const deps = { storage, config };
    // A real document, its kept text and its fingerprint's sections file.
    await putFacts(deps, writer, facts('docs/report.pdf', {
      textKey: 'contentclass-text/real.txt',
      profile: { detailKey: 'contentclass-profile/real.json' } as ContentFacts['profile'],
    }));
    await storage.createStorageFile(file('docs/report.pdf', 100, 'application/pdf'));
    await storage.createStorageFile(file('contentclass-text/real.txt', 50, 'text/plain'));
    await storage.createStorageFile(file('contentclass-profile/real.json', 50, 'application/json'));
    // The loop: the sections file got facts of its own, a text copy and the next sections file.
    await putFacts(deps, writer, facts('contentclass-profile/real.json', {
      textKey: 'contentclass-text/loop-1.txt',
      profile: { detailKey: 'contentclass-profile/loop-1.json' } as ContentFacts['profile'],
    }));
    await putFacts(deps, writer, facts('contentclass-profile/loop-1.json', { textKey: 'contentclass-text/loop-2.txt' }));
    await storage.createStorageFile(file('contentclass-text/loop-1.txt', 436, 'text/plain'));
    await storage.createStorageFile(file('contentclass-profile/loop-1.json', 436, 'application/json'));
    await storage.createStorageFile(file('contentclass-text/loop-2.txt', 436, 'text/plain'));
    // Written a moment ago, its facts not saved yet: left alone.
    const now = Date.parse('2026-11-08T12:00:00Z');
    await storage.createStorageFile(file('contentclass-text/fresh.txt', 10, 'text/plain', '2026-11-08T11:59:00Z'));

    const out = await removeFingerprintLoopLeftovers(deps, { now });
    expect(out).toEqual([{ owner: OWNER, facts: 2, files: 3, failed: 0 }]);

    expect((await allFacts(storage, OWNER)).map(f => f.source.key)).toEqual(['docs/report.pdf']);
    const keys = (await storage.listStorageFiles(OWNER)).map(f => f.key).sort();
    expect(keys).toEqual(['contentclass-profile/real.json', 'contentclass-text/fresh.txt', 'contentclass-text/real.txt', 'docs/report.pdf']);

    // Nothing left the second time.
    expect(await removeFingerprintLoopLeftovers(deps, { now })).toEqual([]);
  });
});
