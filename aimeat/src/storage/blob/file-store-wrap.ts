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
 * @structure FileStoreTarget · FileStoreResolver · wrapStorageWithFileStores · relocateStorageFile
 * @usage wrapStorageWithFileStores(storage, resolver);   // once, right after createStorage
 *   await relocateStorageFile(storage, owner, key, target);   // the move actions
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import { randomUUID } from 'node:crypto';
import type { Storage, StorageFileRecord } from '../interface.js';
import { utf8VerdictFor } from '../../utils/app-content-type.js';
import { logger } from '../../utils/logger.js';
import { BlobStoreError, formatBlobRef, parseBlobRef, type BlobStore } from './blob-types.js';

export interface FileStoreTarget {
  storeId: string;
  store: BlobStore;
  /** Prepended to every object key, ending in `/` or empty. */
  prefix: string;
}

export interface FileStoreResolver {
  /** Where a new file of this identity goes; null keeps its bytes in the database. */
  forWrite(ownerGaii: string): Promise<FileStoreTarget | null>;
  /** The store a reference names; null when this node can no longer reach it (it was disconnected). */
  forRead(storeId: string): Promise<BlobStore | null>;
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
    const previous = await meta(file.ownerGaii, file.key);
    const target = await resolver.forWrite(file.ownerGaii);
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

export type RelocateOutcome = 'moved' | 'already-there' | 'gone' | 'changed';

/**
 * Move one file's bytes to `target` (a store) or, with null, back into the database. Everything else
 * about the file stays: its key, owner, visibility, tags, provenance and creation time.
 *
 * From the database the move is safe against a concurrent upload by construction: the object is
 * written, then the row is pointed at it only if it still holds the same bytes it was read with
 * (setStorageFileBlobRef). From a store, the row is re-written; it is read again just before, and a
 * row that changed in between is left alone. In both cases a move that does not land removes the
 * object it wrote, and the object the row named before is removed after the row has moved on.
 */
export async function relocateStorageFile(storage: Storage, ownerGaii: string, key: string, target: FileStoreTarget | null): Promise<RelocateOutcome> {
  const raw = (storage as Wrapped)[RAW];
  if (!raw) throw new Error('relocateStorageFile: this storage has no file stores installed');
  const file = await storage.getStorageFile(ownerGaii, key);
  if (!file) return 'gone';
  const from = file.blobRef;
  if ((parseBlobRef(from)?.storeId ?? null) === (target?.storeId ?? null)) return 'already-there';

  let blobRef: string | undefined;
  if (target) {
    const objectKey = `${target.prefix}${randomUUID()}`;
    await target.store.put(objectKey, file.data, file.mimeType);
    blobRef = formatBlobRef(target.storeId, objectKey);
  }

  if (!from) {
    // Database to a store: the conditional update is the whole move.
    if (await storage.setStorageFileBlobRef(ownerGaii, key, blobRef!, file.size)) return 'moved';
    await raw.discard(blobRef, 'the file changed while it was being moved');
    return 'changed';
  }

  const now = await raw.meta(ownerGaii, key);
  if (!now || now.blobRef !== from) {
    await raw.discard(blobRef, 'the file changed while it was being moved');
    return now ? 'changed' : 'gone';
  }
  const utf8Verified = file.utf8Verified ?? utf8VerdictFor(file) ?? undefined;
  try {
    await raw.create(target
      ? { ...file, data: Buffer.alloc(0), blobRef, utf8Verified }
      : { ...file, blobRef: undefined });
  } catch (err) {
    await raw.discard(blobRef, 'the row write failed');
    throw err;
  }
  await raw.discard(from, 'the file moved');
  return 'moved';
}
