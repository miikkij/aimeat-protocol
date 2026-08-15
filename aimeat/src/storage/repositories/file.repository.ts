/**
 * @file src/storage/repositories/file.repository.ts
 * @description Storage interface segment for stored files and chunked uploads — the contract every
 *   backend implements for file records (create/get/list/delete, tag + visibility updates) and
 *   multi-part chunked upload assembly.
 *
 * @structure
 *   - FileRepository: interface for stored-file CRUD plus tag/visibility updates
 *   - chunked-upload methods: create/get/addChunk/delete for resumable uploads
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 *   v1.1.0 — 2026-07-16 — listStorageFilesForOwners batch primitive (portfolio catalog N+1)
 *   v1.2.0 — 2026-08-15 — TARGET-063: getStorageFileMeta + readStorageFileRange, so serving a byte
 *     range stops reading the whole file to answer it.
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
  deleteStorageFile(ownerGaii: string, key: string): Promise<boolean>;
  updateFileTagsByKey(ownerGaii: string, key: string, tags: string[]): Promise<StorageFileRecord | null>;
  updateFileVisibility(ownerGaii: string, key: string, visibility: StorageFileRecord['visibility'], workspaceRef?: string): Promise<StorageFileRecord | null>;
  createChunkedUpload(record: ChunkedUploadRecord): Promise<ChunkedUploadRecord>;
  getChunkedUpload(uploadId: string): Promise<ChunkedUploadRecord | null>;
  addChunk(uploadId: string, chunkIndex: number, data: Buffer): Promise<boolean>;
  deleteChunkedUpload(uploadId: string): Promise<boolean>;
}
