/**
 * @file src/storage/blob/file-store-wrap.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Puts a stored file's bytes in an object store instead of the database, for every caller
 *   at once. The node writes files from sixteen places (uploads, chunked uploads, generated images,
 *   speech, attachments, app screenshots, extensions…) and reads them from as many; all of them go
 *   through the six Storage methods replaced here, so none of them learns that object stores exist.
 *   Both database providers stay as they were: a row whose bytes are elsewhere carries a `blobRef`
 *   and an empty `data`, and this wrapper fills `data` back in on the way out.
 *
 *   WHICH STORE is the resolver's decision (services/file-store/): the store a person connected for
 *   their own files, else the node's, else none. A file already in the database stays there and is
 *   read from there; nothing is moved by a read.
 *
 *   THE ORDER OF A WRITE. The object is written first and the row second, so a row never names an
 *   object that is not there. When the row write fails, the new object is removed. The object the
 *   row named before (a re-upload under the same key) is removed after the row has moved on; when
 *   that removal fails, the daily sweep (services/file-store/file-store-sweep.ts) finds the object no
 *   row names and removes it then. The sweep is also what removes the objects of an erased account,
 *   whose rows go by a cascade that runs in each provider and never passes through here.
 * @structure FileStoreTarget · FileStoreResolver · wrapStorageWithFileStores · directUploadTarget ·
 *   storedObjectFacts · discardStorageObject · adoptStorageObject · directDownloadUrl · RelocateOptions ·
 *   RELOCATE_ATTEMPTS · relocateStorageFile
 * @usage wrapStorageWithFileStores(storage, resolver);   // once, right after createStorage
 *   await relocateStorageFile(storage, owner, key, target);   // the move actions
 *   const up = await directUploadTarget(storage, owner, undefined, 'image/png', 3600);   // client PUTs to up.url
 * @version-history
 *   v1.4.0 — 2026-11-08 — A move writes only where the bytes are, and only while the row is the one it
 *     read (moveStorageFileBytes, the row's version): a visibility, tags or provenance change between
 *     the read and the write stays, and a re-upload in between keeps its bytes. A write that did not
 *     land reads again and tries again, RELOCATE_ATTEMPTS times, then leaves the file where it is
 *     (secaudit2026nov08b round 15b, file-store/relocate-from-store-rewrites-stale-row).
 *   v1.3.1 — 2026-11-08 — A move out of a store writes the row as it is just before the write, so a
 *     visibility narrowed during the download stays narrowed; a move into the database takes
 *     `maxDatabaseBytes` and leaves a larger file in its store (`too-large`), and adoptStorageObject
 *     passes it on (secaudit2026nov08b round 15, file-store/relocate-from-store-rewrites-stale-row,
 *     file-store/relocate-to-database-without-file-or-quota-ceiling).
 *   v1.3.0 — 2026-11-08 — A store takes only the files its rule names (store-takes.ts): a smaller file
 *     of another kind keeps its bytes in the database, and a direct upload that turns out to be one is
 *     moved there when it completes (wish-a-file-store-says-what-it-is-for-so-small-files-stay-in-post).
 *   v1.2.0 — 2026-10-31 — Direct transfer: a signed write address for a new object, the row of a file
 *     whose object a client put there (adoptStorageObject), and a signed read address for a download
 *     door; the bytes of a large file never pass through the node
 *     (wish-suuret-tiedostot-virtaavat-aimeat-io-n-l-pi-ilman-koko-tiedo).
 *   v1.1.0 — 2026-10-30 — A write may carry `storeChoice`, the store its writer named; it is handed to
 *     the resolver and never stored (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-).
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import { randomUUID } from 'node:crypto';
import type { Storage, StorageFileRecord } from '../interface.js';
import { utf8VerdictFor } from '../../utils/app-content-type.js';
import { logger } from '../../utils/logger.js';
import { BlobStoreError, formatBlobRef, parseBlobRef, signedWriteHeaders, type BlobStore } from './blob-types.js';
import { storeTakesFile, type StoreTakes } from './store-takes.js';

export interface FileStoreTarget {
  storeId: string;
  store: BlobStore;
  /** Prepended to every object key, ending in `/` or empty. */
  prefix: string;
  /** Which files the store takes (store-takes.ts); a file it does not take stays in the database.
   *  The resolver always sets it; absent, the store takes every file. */
  takes?: StoreTakes;
}

export interface FileStoreResolver {
  /** Where a new file of this identity goes; null keeps its bytes in the database. `choice` is the
   *  store its writer named (`own:<name>`, `node:<name>`); the resolver throws when it cannot take it. */
  forWrite(ownerGaii: string, choice?: string): Promise<FileStoreTarget | null>;
  /** The store a reference names; null when this node can no longer reach it (it was disconnected). */
  forRead(storeId: string): Promise<BlobStore | null>;
  /** The rule of the store a reference names; null when this node no longer has the store. */
  takesOf?(storeId: string): Promise<StoreTakes | null>;
}

/** Whether a target takes this file; a target with no rule takes every file. */
function targetTakes(target: FileStoreTarget, size: number | undefined, mimeType: string | undefined): boolean {
  return !target.takes || storeTakesFile(target.takes, size, mimeType);
}

/** The provider's own file methods, kept on the wrapped instance under a symbol: relocateStorageFile
 *  writes a row with a reference it chose, which the wrapped createStorageFile never accepts. A symbol
 *  property, not a WeakMap, so it is found through the perf-trace Proxy as well. */
const RAW = Symbol.for('aimeat.fileStoreRaw');

interface RawFileMethods {
  create: Storage['createStorageFile'];
  meta: Storage['getStorageFileMeta'];
  resolver: FileStoreResolver;
  discard: (blobRef: string | undefined, why: string) => Promise<void>;
}

type Wrapped = Storage & { [RAW]?: RawFileMethods };

export function wrapStorageWithFileStores(storage: Storage, resolver: FileStoreResolver): void {
  const s = storage as Wrapped;
  if (s[RAW]) return;

  const create = storage.createStorageFile.bind(storage);
  const get = storage.getStorageFile.bind(storage);
  const meta = storage.getStorageFileMeta.bind(storage);
  const range = storage.readStorageFileRange.bind(storage);
  const remove = storage.deleteStorageFile.bind(storage);

  /** The store and key a row's reference names. Throws when the store is gone, so the caller gets a
   *  message naming it rather than an empty file. */
  async function locate(file: StorageFileRecord): Promise<{ store: BlobStore; objectKey: string }> {
    const ref = parseBlobRef(file.blobRef);
    if (!ref) throw new BlobStoreError(`File ${file.key} has an unreadable object reference`, 0, 'BAD_REFERENCE');
    const store = await resolver.forRead(ref.storeId);
    if (!store) {
      throw new BlobStoreError(
        `File ${file.key} is kept in a file store this node no longer has (${ref.storeId}). Connect that store again to read it.`,
        0, 'STORE_NOT_CONNECTED');
    }
    return { store, objectKey: ref.objectKey };
  }

  /** Remove the object a reference names, and only log a failure: the sweep removes it later. */
  async function discard(blobRef: string | undefined, why: string): Promise<void> {
    const ref = parseBlobRef(blobRef);
    if (!ref) return;
    try {
      const store = await resolver.forRead(ref.storeId);
      if (store) await store.delete(ref.objectKey);
    } catch (err) {
      logger.warn('file store: an object could not be removed; the daily sweep will remove it', {
        storeId: ref.storeId, objectKey: ref.objectKey, why, error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  s[RAW] = { create, meta, resolver, discard };

  storage.createStorageFile = async (incoming: StorageFileRecord): Promise<StorageFileRecord> => {
    // A reference is never taken from the caller. A caller that copies a file it read (an attachment
    // duplicated to its recipient) passes the original's reference along with the bytes, and two rows
    // naming one object would lose the bytes of both when either is deleted. Every write is a new
    // object, made here from the bytes.
    const file = { ...incoming };
    delete file.blobRef;
    // The store the writer chose rides on the record to here and is never stored.
    const choice = file.storeChoice;
    delete file.storeChoice;
    const previous = await meta(file.ownerGaii, file.key);
    const resolved = await resolver.forWrite(file.ownerGaii, choice);
    // A store takes only the files it is for (store-takes.ts); the rest keep their bytes in the database.
    const target = resolved && targetTakes(resolved, file.data.length, file.mimeType) ? resolved : null;
    if (!target) {
      const written = await create(file);
      if (previous?.blobRef) await discard(previous.blobRef, 'replaced by a database write');
      return written;
    }
    const objectKey = `${target.prefix}${randomUUID()}`;
    await target.store.put(objectKey, file.data, file.mimeType);
    const blobRef = formatBlobRef(target.storeId, objectKey);
    let written: StorageFileRecord;
    try {
      written = await create({ ...file, data: Buffer.alloc(0), blobRef, utf8Verified: utf8VerdictFor(file) ?? undefined });
    } catch (err) {
      await discard(blobRef, 'the row write failed');
      throw err;
    }
    if (previous?.blobRef) await discard(previous.blobRef, 'replaced by a new upload');
    return { ...written, data: file.data };
  };

  storage.getStorageFile = async (ownerGaii: string, key: string): Promise<StorageFileRecord | null> => {
    const row = await get(ownerGaii, key);
    if (!row?.blobRef) return row;
    const { store, objectKey } = await locate(row);
    const data = await store.get(objectKey);
    if (!data) {
      logger.warn('file store: a row names an object that is not in its store', { ownerGaii, key, blobRef: row.blobRef });
      return null;
    }
    return { ...row, data };
  };

  storage.readStorageFileRange = async (ownerGaii: string, key: string, start: number, length: number): Promise<Buffer | null> => {
    const row = await meta(ownerGaii, key);
    if (!row?.blobRef) return row ? range(ownerGaii, key, start, length) : null;
    const { store, objectKey } = await locate(row);
    return store.getRange(objectKey, start, length);
  };

  storage.deleteStorageFile = async (ownerGaii: string, key: string): Promise<boolean> => {
    const row = await meta(ownerGaii, key);
    const removed = await remove(ownerGaii, key);
    if (removed && row?.blobRef) await discard(row.blobRef, 'the file was deleted');
    return removed;
  };
}

// ── Direct transfer: the bytes go between the client and the store, the node signs and records ──

function rawOf(storage: Storage): RawFileMethods | null {
  return (storage as Wrapped)[RAW] ?? null;
}

/** Text types up to this size get their UTF-8 verdict read from the store when a direct upload lands;
 *  a larger one is stored without it being valid UTF-8 claimed (utf8Verified false). */
const DIRECT_UTF8_CHECK_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Where the next file of `ownerGaii` would go, as a signed address the client PUTs the bytes to, and
 * the reference the row will name once they are there. Null when the file would go to the database or
 * the store cannot sign one; the caller then uses an upload through the node. The object key is new,
 * like every write's, and the reference is kept by the node (in a signed upload token), never taken
 * from the client.
 */
export async function directUploadTarget(storage: Storage, ownerGaii: string, choice: string | undefined, contentType: string, expiresInSec: number):
  Promise<{ blobRef: string; url: string; headers: Record<string, string> } | null> {
  const raw = rawOf(storage);
  if (!raw) return null;
  const target = await raw.resolver.forWrite(ownerGaii, choice);
  if (!target?.store.signedUrl) return null;
  const objectKey = `${target.prefix}${randomUUID()}`;
  const url = target.store.signedUrl(objectKey, { kind: 'write', expiresInSec, contentType });
  if (!url) return null;
  return { blobRef: formatBlobRef(target.storeId, objectKey), url, headers: signedWriteHeaders(target.store.kind, contentType) };
}

/** The size and type of the object a reference names, or null when it is not there (not uploaded yet). */
export async function storedObjectFacts(storage: Storage, blobRef: string): Promise<{ size: number; contentType: string } | null> {
  const raw = rawOf(storage);
  const ref = parseBlobRef(blobRef);
  if (!raw || !ref) return null;
  const store = await raw.resolver.forRead(ref.storeId);
  if (!store?.head) return null;
  return store.head(ref.objectKey);
}

/** Remove an object a direct upload left that will not become a file (refused, or too large). */
export async function discardStorageObject(storage: Storage, blobRef: string, why: string): Promise<void> {
  await rawOf(storage)?.discard(blobRef, why);
}

/**
 * Write the row of a file whose bytes a client already put in a store, through a signed address the
 * node made for exactly this reference. The object the key named before is removed after the row has
 * moved on, as with every write. A text file small enough gets its UTF-8 verdict from the object.
 * A file the store does not take moves to the database unless it is over `opts.maxDatabaseBytes`
 * (the per-file database ceiling); then it stays in the store, where its bytes already are.
 */
export async function adoptStorageObject(storage: Storage, file: StorageFileRecord, blobRef: string,
  opts: RelocateOptions = {}): Promise<StorageFileRecord> {
  const raw = rawOf(storage);
  const ref = parseBlobRef(blobRef);
  if (!raw || !ref) throw new BlobStoreError(`File ${file.key} has an unreadable object reference`, 0, 'BAD_REFERENCE');
  let utf8Verified: boolean | undefined;
  if (utf8VerdictFor({ mimeType: file.mimeType, data: Buffer.alloc(0) }) !== null) {
    const store = await raw.resolver.forRead(ref.storeId);
    const bytes = file.size <= DIRECT_UTF8_CHECK_MAX_BYTES && store ? await store.getRange(ref.objectKey, 0, file.size) : null;
    utf8Verified = bytes ? utf8VerdictFor({ mimeType: file.mimeType, data: bytes }) ?? undefined : false;
  }
  const previous = await raw.meta(file.ownerGaii, file.key);
  const row = { ...file };
  delete row.storeChoice;
  delete row.blobRef;
  const written = await raw.create({ ...row, data: Buffer.alloc(0), blobRef, utf8Verified });
  if (previous?.blobRef && previous.blobRef !== blobRef) await raw.discard(previous.blobRef, 'replaced by a new upload');
  // The address was made before the size was known. A file the store does not take after all (a small
  // one, of a kind it is not for) moves to the database now, as it would have gone there through the node.
  const takes = raw.resolver.takesOf ? await raw.resolver.takesOf(ref.storeId) : null;
  if (takes && !storeTakesFile(takes, file.size, file.mimeType)) {
    const out = await relocateStorageFile(storage, file.ownerGaii, file.key, null, opts);
    if (out === 'moved') return { ...written, blobRef: undefined };
  }
  return written;
}

/**
 * A signed address that reads one stored file straight from its store, for a download door that has
 * already decided the caller may read it. Null when the file's bytes are in the database or the store
 * cannot sign one, and the door sends the bytes itself.
 */
export async function directDownloadUrl(storage: Storage, ownerGaii: string, key: string, opts: { expiresInSec: number; filename?: string }): Promise<string | null> {
  const raw = rawOf(storage);
  if (!raw) return null;
  const row = await raw.meta(ownerGaii, key);
  const ref = parseBlobRef(row?.blobRef);
  if (!row || !ref) return null;
  const store = await raw.resolver.forRead(ref.storeId);
  if (!store?.signedUrl) return null;
  return store.signedUrl(ref.objectKey, {
    kind: 'read', expiresInSec: opts.expiresInSec, contentType: row.mimeType,
    ...(opts.filename ? { filename: opts.filename } : {}),
  });
}

/** `not-taken`: the target's rule does not take this file (store-takes.ts), so it stays where it is.
 *  `too-large`: a move into the database would pass `maxDatabaseBytes`, so the file stays in its store.
 *  `changed`: the file changed after each of RELOCATE_ATTEMPTS reads, so it stays where it is. */
export type RelocateOutcome = 'moved' | 'already-there' | 'gone' | 'changed' | 'not-taken' | 'too-large';

export interface RelocateOptions {
  /** A move into the database leaves a file larger than this in its store (`too-large`). The callers
   *  that move without the person pass the database's per-file ceiling (storageMaxFileSizeMb), or less
   *  where the owner's storage quota leaves less room. Absent, no size is asked. */
  maxDatabaseBytes?: number;
}

/** Whether a file of this many bytes would pass the move's database ceiling. */
function overCeiling(ceiling: number | null, bytes: number | undefined): boolean {
  return ceiling !== null && typeof bytes === 'number' && bytes > ceiling;
}

/** How many times a move reads the file and tries its write before it leaves the file where it is. */
export const RELOCATE_ATTEMPTS = 3;

/**
 * Move one file's bytes to `target` (a store) or, with null, back into the database. Everything else
 * about the file stays: its key, owner, visibility, tags, provenance and creation time.
 *
 * The write is conditional (moveStorageFileBytes): it sets only where the bytes are, and only while the
 * row's version and object reference are the ones the move read together with the bytes. A visibility,
 * tags or provenance change made while the bytes were on their way is never written over, and a
 * re-upload in between (in the database or in a store) is never pointed at the old bytes. When the
 * write did not land, the object it wrote is removed and the move reads the file again and tries
 * again, RELOCATE_ATTEMPTS times in all; then it leaves the file where it is (`changed`). The object
 * the row named before is removed after the row has moved on.
 *
 * With `maxDatabaseBytes`, a move into the database is asked three times, so a file over it is never
 * read whole into the node: the row's size, then the object's own size where the store can say it
 * (the store may hold other bytes than the row says), then the bytes that arrived.
 */
export async function relocateStorageFile(storage: Storage, ownerGaii: string, key: string, target: FileStoreTarget | null,
  opts: RelocateOptions = {}): Promise<RelocateOutcome> {
  const raw = (storage as Wrapped)[RAW];
  if (!raw) throw new Error('relocateStorageFile: this storage has no file stores installed');
  for (let attempt = 0; attempt < RELOCATE_ATTEMPTS; attempt++) {
    const out = await relocateOnce(storage, raw, ownerGaii, key, target, opts);
    if (out !== 'lost') return out;
  }
  return 'changed';
}

/** One read and one conditional write of a move; `lost` when the row changed after it was read. */
async function relocateOnce(storage: Storage, raw: RawFileMethods, ownerGaii: string, key: string, target: FileStoreTarget | null,
  opts: RelocateOptions): Promise<RelocateOutcome | 'lost'> {
  const ceiling = !target && typeof opts.maxDatabaseBytes === 'number' && Number.isFinite(opts.maxDatabaseBytes) ? opts.maxDatabaseBytes : null;
  if (ceiling !== null) {
    const row = await raw.meta(ownerGaii, key);
    if (!row) return 'gone';
    const ref = parseBlobRef(row.blobRef);
    if (!ref) return 'already-there';
    if (overCeiling(ceiling, row.size)) return 'too-large';
    const store = await raw.resolver.forRead(ref.storeId);
    const facts = store?.head ? await store.head(ref.objectKey) : null;
    if (overCeiling(ceiling, facts?.size)) return 'too-large';
  }
  const file = await storage.getStorageFile(ownerGaii, key);
  if (!file) return 'gone';
  const from = file.blobRef;
  if ((parseBlobRef(from)?.storeId ?? null) === (target?.storeId ?? null)) return 'already-there';
  if (target && !targetTakes(target, file.size, file.mimeType)) return 'not-taken';
  if (overCeiling(ceiling, file.data.length)) return 'too-large';

  let blobRef: string | undefined;
  if (target) {
    const objectKey = `${target.prefix}${randomUUID()}`;
    await target.store.put(objectKey, file.data, file.mimeType);
    blobRef = formatBlobRef(target.storeId, objectKey);
  }

  // `file` is one row read: its version, its reference and the bytes that reference named. The write
  // lands only on that row, so nothing the row gained after the read is lost.
  const expect = { rowVersion: file.rowVersion, blobRef: from };
  let landed: boolean;
  try {
    landed = await storage.moveStorageFileBytes(ownerGaii, key, target
      ? { expect, blobRef, data: Buffer.alloc(0), size: file.size, utf8Verified: file.utf8Verified ?? utf8VerdictFor(file) ?? undefined }
      // The size the database holds is the bytes that arrived, which the quota then counts.
      : { expect, data: file.data, size: file.data.length, utf8Verified: utf8VerdictFor(file) ?? undefined });
  } catch (err) {
    await raw.discard(blobRef, 'the row write failed');
    throw err;
  }
  if (!landed) {
    await raw.discard(blobRef, 'the file changed while it was being moved');
    return (await raw.meta(ownerGaii, key)) ? 'lost' : 'gone';
  }
  if (from) await raw.discard(from, 'the file moved');
  return 'moved';
}
