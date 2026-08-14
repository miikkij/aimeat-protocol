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
 */
import type { StorageFileRecord, ChunkedUploadRecord } from '../interface.js';

export interface FileRepository {
  createStorageFile(file: StorageFileRecord): Promise<StorageFileRecord>;
  getStorageFile(ownerGaii: string, key: string): Promise<StorageFileRecord | null>;
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
