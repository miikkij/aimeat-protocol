/**
 * @file src/storage/providers/sqlite/repos/storage-file.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite (better-sqlite3) helper for binary storage files that methods/files.ts calls:
 *   the byte and file totals of many owner identities in one query. The storage-file methods and the
 *   chunked uploads live in methods/files.ts (the uploads in the shared ChunkedUploadStore).
 *
 * @structure
 *   - sumStorageBytesForOwners: total bytes and file count across many owner identities
 *
 * @version-history
 *   v1.1.0 — 2026-11-04 — createStorageFile, getStorageFile, listStorageFiles, deleteStorageFile,
 *     updateFileTagsByKey, updateFileVisibility, createChunkedUpload, getChunkedUpload, addChunk and
 *     deleteChunkedUpload deleted, and the comment of a micro-memory function deleted earlier: nothing
 *     imported them, methods/files.ts holds the live copies since M8, and this listStorageFiles still
 *     read every file's bytes, the read methods/files.ts had fixed (codebase analysis 2026-11-03,
 *     item A15).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type Database from 'better-sqlite3';

/** Total storage bytes + file count across MANY owner identities in ONE SQL query — the owner-scope
 *  footprint for the usage summary (replaces one listStorageFiles-then-sum per identity). */
export function sumStorageBytesForOwners(db: Database.Database, ownerGaiis: string[]): { bytes: number; count: number } {
  if (ownerGaiis.length === 0) return { bytes: 0, count: 0 };
  const ph = ownerGaiis.map(() => '?').join(',');
  const row = db.prepare(`SELECT COALESCE(SUM(size), 0) AS bytes, COUNT(*) AS count FROM storage_files WHERE ownerGaii IN (${ph})`).get(...ownerGaiis) as { bytes: number; count: number };
  return { bytes: row.bytes, count: row.count };
}
