/**
 * @file src/storage/repositories/file.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage interface segment for stored files and chunked uploads — the contract every
 *   backend implements for file records (create/get/list/delete, tag + visibility updates) and
 *   multi-part chunked upload assembly.
 *
 * @structure
 *   - FileRepository: interface for stored-file CRUD plus tag/visibility updates
 *   - chunked-upload methods: create/get/addChunk/delete for resumable uploads
 *
 * @version-history
 *   2026-10-30 — listStorageFilesInDatabase is listStorageFilesIn: the files of any one place, so a
 *     move can empty a store as well as the database (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-).
 *   2026-10-29 — setStorageFileBlobRef, storageFileBlobRefsIn, listStorageFilesInDatabase and countStorageFilesByStore, and
 *     StorageFileRecord.blobRef on every read: a file's bytes may live in an S3 or Azure Blob store
 *     (storage/blob/; wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 *   2026-10-16 — chunkedUploadsHeldBy and sweepExpiredChunkedUploads; every chunked-upload read honours
 *     the session expiry on both backends (QA audit F05b-02).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 *   v1.1.0 — 2026-07-16 — listStorageFilesForOwners batch primitive (portfolio catalog N+1)
 *   v1.2.0 — 2026-08-15 — TARGET-063: getStorageFileMeta + readStorageFileRange, so serving a byte
 *     range stops reading the whole file to answer it.
 *   v1.3.0 — 2026-10-03 — listFontFilesAcrossOwners: the font manager's inventory of owners' fonts.
 *   v1.4.0 — 2026-10-08 — setStorageFileProvenance, and StorageFileRecord.aiProvenanceId on every
 *     read (AI provenance for stored files).
 */
import type { StorageFileRecord, ChunkedUploadRecord } from '../interface.js';

export interface FileRepository {
  createStorageFile(file: StorageFileRecord): Promise<StorageFileRecord>;
  getStorageFile(ownerGaii: string, key: string): Promise<StorageFileRecord | null>;
  /** Everything about a file EXCEPT its bytes (`data` comes back empty). For a response that needs
   *  the size, the type and the charset verdict but not the content: a HEAD, a 416, or the header
   *  half of a byte-range reply. Measured against the whole-row read on Postgres: 0.31 ms vs
   *  181 ms for a 25 MB file. */
  getStorageFileMeta(ownerGaii: string, key: string): Promise<StorageFileRecord | null>;
  /** `length` bytes from `start` (0-based, inclusive), sliced by the DATABASE rather than by Node.
   *  Null when the file does not exist; a start past the end gives an empty buffer, and deciding
   *  whether that is a 416 belongs to the caller, which is the only party that has read the Range
   *  header. Both providers count from 1 in SQL and this contract does not: the +1 lives in the
   *  provider, once each, so no caller has to remember it. */
  readStorageFileRange(ownerGaii: string, key: string, start: number, length: number): Promise<Buffer | null>;
  listStorageFiles(ownerGaii: string): Promise<StorageFileRecord[]>;
  /** Batch variant of listStorageFiles: file metadata (no bytes) for MANY owner GAIIs in ONE IN query,
   *  keyed by ownerGaii (every input gaii present, empty array if none). Collapses the per-agent
   *  listStorageFiles fan-out in the portfolio catalog builder. */
  listStorageFilesForOwners(ownerGaiis: string[]): Promise<Record<string, StorageFileRecord[]>>;
  /** Total storage bytes + file count across MANY owner identities in ONE DB-side aggregate (the
   *  owner-scope footprint for the usage summary; replaces listStorageFiles-then-sum per identity). */
  sumStorageBytesForOwners(ownerGaiis: string[]): Promise<{ bytes: number; count: number }>;
  /** Font files across every owner, metadata only (no bytes), in ONE bounded query: a key ending in
   *  .woff2, .woff, .ttf or .otf, or a font type. The newest `limit` rows, and `total`, how many
   *  matched, from the same query (a window count). `excludeOwner` leaves one principal out, the
   *  node's own, whose fonts are the theme faces. The operator's inventory in the font manager. */
  listFontFilesAcrossOwners(opts: { limit: number; excludeOwner?: string }): Promise<{ total: number; items: StorageFileRecord[] }>;
  deleteStorageFile(ownerGaii: string, key: string): Promise<boolean>;
  updateFileTagsByKey(ownerGaii: string, key: string, tags: string[]): Promise<StorageFileRecord | null>;
  updateFileVisibility(ownerGaii: string, key: string, visibility: StorageFileRecord['visibility'], workspaceRef?: string): Promise<StorageFileRecord | null>;
  /** Point a stored file at its AI-provenance record, for a write whose record is minted only after
   *  the bytes landed (image generation settles after the store). False when no such file. */
  setStorageFileProvenance(ownerGaii: string, key: string, aiProvenanceId: string): Promise<boolean>;
  /** The bytes of a file the database holds have been copied to an object store: point the row at
   *  the object and empty its `data`. Only while the row still holds its bytes and still has `size`,
   *  so a re-upload that landed in between is never emptied. False when it did not match. */
  setStorageFileBlobRef(ownerGaii: string, key: string, blobRef: string, size: number): Promise<boolean>;
  /** Of these object references, the ones some row still holds. The orphan sweep asks this for each
   *  page of objects it lists, so an object no row names can be removed. */
  storageFileBlobRefsIn(refs: string[]): Promise<string[]>;
  /** The files of one place, metadata only, ordered by (ownerGaii, key) after `after`: `database` for
   *  the rows that hold their own bytes, else a store id (`node:s3`, `owner:<ghii>/<name>`), matched
   *  exactly. `owners` narrows to those identities. The page a move between places works through. */
  listStorageFilesIn(opts: { store: string; limit: number; after?: { ownerGaii: string; key: string }; owners?: string[] }): Promise<StorageFileRecord[]>;
  /** How many files, and how many bytes, each place holds: `database` for the rows that hold their
   *  own bytes, else the store id of the reference (`node:s3`, `owner:<ghii>`). One grouped query. */
  countStorageFilesByStore(): Promise<{ store: string; count: number; bytes: number }[]>;
  createChunkedUpload(record: ChunkedUploadRecord): Promise<ChunkedUploadRecord>;
  getChunkedUpload(uploadId: string): Promise<ChunkedUploadRecord | null>;
  addChunk(uploadId: string, chunkIndex: number, data: Buffer): Promise<boolean>;
  deleteChunkedUpload(uploadId: string): Promise<boolean>;
  /** How many live chunked-upload sessions one principal holds, and how many chunk bytes in them. */
  chunkedUploadsHeldBy(ownerGaii: string): Promise<{ sessions: number; bytes: number }>;
  /** Drop every expired chunked-upload session and its bytes; returns how many went. */
  sweepExpiredChunkedUploads(): Promise<number>;
}
