/**
 * @file src/storage/providers/sqlite/methods/files.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/files.ts (fileMethods), so a fix in
 *   one provider finds its twin by file name. Bodies moved verbatim from the files named in the version
 *   history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure fileMethods
 * @usage Object.assign(SqliteStorage.prototype, fileMethods) in ../index.ts
 * @version-history
 *   v1.1.0 — 2026-10-08 — aiProvenanceId is written, read on every path, and set alone by
 *     setStorageFileProvenance (AI provenance for stored files; Postgres 0096).
 *   v1.0.0 — 2026-10-05 — createChunkedUpload, getChunkedUpload, addChunk, deleteChunkedUpload moved here
 *     from identity-nodes.ts; 11 methods (createStorageFile, getStorageFile, getStorageFileMeta, …) moved
 *     here from storage-files.ts so the file mirrors postgres-kysely/methods/files.ts (secaudit 2026-10, M8).
 */
import type { ChunkedUploadRecord, StorageFileRecord } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';
import { sumStorageBytesForOwners as sumStorageBytesForOwnersRepo } from '../repos/storage-file.js';
import { utf8VerdictFor } from '../../../../utils/app-content-type.js';

/** One row shape, one record shape, one mapping — four copies of this had already drifted apart on
 *  which optional fields they carried. `data` is passed in because only the caller knows whether it
 *  asked for the bytes. */
function fileRowToRecord(r: Record<string, unknown>, data: Buffer): StorageFileRecord {
  const record: StorageFileRecord = {
    key: r.key as string,
    ownerGaii: r.ownerGaii as string,
    visibility: r.visibility as StorageFileRecord['visibility'],
    mimeType: r.mimeType as string,
    size: r.size as number,
    data,
    tags: r.tags ? JSON.parse(r.tags as string) : [],
    createdAt: r.createdAt as string,
  };
  if (r.groupId) record.groupId = r.groupId as string;
  if (r.workspaceRef) record.workspaceRef = r.workspaceRef as string;
  record.federate = r.federate === 1;
  // SQLite has no boolean: 1/0 is the verdict, NULL is "never established" and must stay undefined
  // rather than collapsing into false, which would claim we had checked.
  if (r.utf8Verified !== null && r.utf8Verified !== undefined) record.utf8Verified = r.utf8Verified === 1;
  if (r.aiProvenanceId) record.aiProvenanceId = r.aiProvenanceId as string;
  return record;
}

/** Everything except the bytes — the columns a metadata read, a listing and a range reply all need. */
const META_COLUMNS =
  'key, ownerGaii, visibility, mimeType, size, tags, groupId, workspaceRef, federate, utf8Verified, aiProvenanceId, createdAt';

/** What a font file is, by its name or by its type. The same test on Postgres (methods/files.ts). */
const FONT_FILE_WHERE =
  "lower(mimeType) LIKE 'font/%' OR lower(mimeType) LIKE 'application/font%' OR lower(mimeType) LIKE 'application/x-font%'"
  + " OR lower(key) LIKE '%.woff2' OR lower(key) LIKE '%.woff' OR lower(key) LIKE '%.ttf' OR lower(key) LIKE '%.otf'";

export const fileMethods = {

  // ══════════════════════════════════════════════════════════
  // ── Chunked Uploads (in-memory, same as MongoDB adapter) ──
  // ══════════════════════════════════════════════════════════

  async createChunkedUpload(this: SqliteStorage, record: ChunkedUploadRecord): Promise<ChunkedUploadRecord> {
    this.chunkedUploads.set(record.uploadId, record);
    return record;
  },

  async getChunkedUpload(this: SqliteStorage, uploadId: string): Promise<ChunkedUploadRecord | null> {
    const record = this.chunkedUploads.get(uploadId) ?? null;
    if (record && new Date(record.expiresAt).getTime() < Date.now()) {
      this.chunkedUploads.delete(uploadId);
      return null;
    }
    return record;
  },

  async addChunk(this: SqliteStorage, uploadId: string, chunkIndex: number, data: Buffer): Promise<boolean> {
    const record = this.chunkedUploads.get(uploadId);
    if (!record) return false;
    if (new Date(record.expiresAt).getTime() < Date.now()) {
      this.chunkedUploads.delete(uploadId);
      return false;
    }
    record.receivedChunks.set(chunkIndex, data);
    return true;
  },

  async deleteChunkedUpload(this: SqliteStorage, uploadId: string): Promise<boolean> {
    return this.chunkedUploads.delete(uploadId);
  },
  async createStorageFile(this: SqliteStorage, file: StorageFileRecord): Promise<StorageFileRecord> {
    // Settled here, in the provider, because it is the one door every write goes through: sixteen
    // call sites create files and not one of them should have to know this rule exists.
    const utf8Verified = utf8VerdictFor(file);
    this.db.prepare(
      // The `accessCode` column stays in the table and is written by nobody. It was on
      // StorageFileRecord, stored here and absent from Postgres entirely, and no route on either
      // backend ever set it — an access code on a stored file is a concept that exists for APPS,
      // which have their own field and their own doors. Removed from the record on 2026-09-06
      // (review item 5.7) rather than mirrored into Postgres: a field nothing keeps is the same
      // false promise that hid the two real ones beside it, and the column is always NULL.
      `INSERT OR REPLACE INTO storage_files (ownerGaii, key, visibility, groupId, workspaceRef, mimeType, size, data, tags, createdAt, federate, utf8Verified, aiProvenanceId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      file.ownerGaii, file.key, file.visibility, file.groupId ?? null, file.workspaceRef ?? null,
      file.mimeType, file.size, file.data,
      JSON.stringify(file.tags || []), file.createdAt,
      file.federate ? 1 : 0,
      utf8Verified === null ? null : (utf8Verified ? 1 : 0),
      file.aiProvenanceId ?? null,
    );
    return { ...file, utf8Verified: utf8Verified ?? undefined };
  },

  async getStorageFile(this: SqliteStorage, ownerGaii: string, key: string): Promise<StorageFileRecord | null> {
    const row = this.db.prepare('SELECT * FROM storage_files WHERE ownerGaii = ? AND key = ?').get(ownerGaii, key) as Record<string, unknown> | undefined;
    if (!row) return null;
    return fileRowToRecord(row, row.data as Buffer);
  },

  async getStorageFileMeta(this: SqliteStorage, ownerGaii: string, key: string): Promise<StorageFileRecord | null> {
    const row = this.db.prepare(
      `SELECT ${META_COLUMNS} FROM storage_files WHERE ownerGaii = ? AND key = ?`,
    ).get(ownerGaii, key) as Record<string, unknown> | undefined;
    if (!row) return null;
    return fileRowToRecord(row, Buffer.alloc(0));
  },

  async readStorageFileRange(this: SqliteStorage, ownerGaii: string, key: string, start: number, length: number): Promise<Buffer | null> {
    if (length <= 0) return Buffer.alloc(0);
    // substr() over a BLOB counts from 1; the caller's offset counts from 0. SQLite reads only the
    // pages the slice touches, so this does not walk the whole blob to reach the end of it.
    const row = this.db.prepare(
      'SELECT substr(data, ?, ?) AS chunk FROM storage_files WHERE ownerGaii = ? AND key = ?',
    ).get(start + 1, length, ownerGaii, key) as { chunk: Buffer | null } | undefined;
    if (!row) return null;
    return row.chunk ? Buffer.from(row.chunk) : Buffer.alloc(0);
  },

  async sumStorageBytesForOwners(this: SqliteStorage, ownerGaiis: string[]): Promise<{ bytes: number; count: number }> {
    return sumStorageBytesForOwnersRepo(this.db, ownerGaiis);
  },

  async listStorageFiles(this: SqliteStorage, ownerGaii: string): Promise<StorageFileRecord[]> {
    // The column list is the point. This read `SELECT *`, so listing an owner's files pulled every
    // byte of every file out of the database to build a list that names none of them — 500 MB for
    // fifty 10 MB files. The Postgres provider has always omitted `data` here and the interface
    // says metadata; this one disagreed with both, quietly, and only on the fast local backend.
    const rows = this.db.prepare(
      `SELECT ${META_COLUMNS} FROM storage_files WHERE ownerGaii = ?`,
    ).all(ownerGaii) as Record<string, unknown>[];
    return rows.map(r => fileRowToRecord(r, Buffer.alloc(0)));
  },

  async listStorageFilesForOwners(this: SqliteStorage, ownerGaiis: string[]): Promise<Record<string, StorageFileRecord[]>> {
    const out: Record<string, StorageFileRecord[]> = {};
    for (const g of ownerGaiis) out[g] = [];
    if (ownerGaiis.length === 0) return out;
    const placeholders = ownerGaiis.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT ${META_COLUMNS} FROM storage_files WHERE ownerGaii IN (${placeholders})`,
    ).all(...ownerGaiis) as Record<string, unknown>[];
    for (const r of rows) {
      const record = fileRowToRecord(r, Buffer.alloc(0));
      (out[record.ownerGaii] ??= []).push(record);
    }
    return out;
  },

  async listFontFilesAcrossOwners(this: SqliteStorage, opts: { limit: number; excludeOwner?: string }): Promise<{ total: number; items: StorageFileRecord[] }> {
    // One statement: the rows and, by a window count, how many matched. No bytes are read.
    const rows = this.db.prepare(
      `SELECT ${META_COLUMNS}, COUNT(*) OVER () AS total FROM storage_files
       WHERE ownerGaii != ? AND (${FONT_FILE_WHERE})
       ORDER BY createdAt DESC LIMIT ?`,
    ).all(opts.excludeOwner ?? '', Math.max(0, Math.floor(opts.limit))) as Record<string, unknown>[];
    return { total: rows.length ? Number(rows[0].total) : 0, items: rows.map(r => fileRowToRecord(r, Buffer.alloc(0))) };
  },

  async deleteStorageFile(this: SqliteStorage, ownerGaii: string, key: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM storage_files WHERE ownerGaii = ? AND key = ?').run(ownerGaii, key);
    return result.changes > 0;
  },

  async updateFileTagsByKey(this: SqliteStorage, ownerGaii: string, key: string, tags: string[]): Promise<StorageFileRecord | null> {
    const result = this.db.prepare(
      'UPDATE storage_files SET tags = ? WHERE ownerGaii = ? AND key = ?'
    ).run(JSON.stringify(tags), ownerGaii, key);
    if (result.changes === 0) return null;
    return this.getStorageFile(ownerGaii, key);
  },

  async updateFileVisibility(this: SqliteStorage, ownerGaii: string, key: string, visibility: StorageFileRecord['visibility'], workspaceRef?: string): Promise<StorageFileRecord | null> {
    // workspaceRef undefined → change visibility only (keep any existing ref); provided → set both
    // (pass '' to clear). Lets a caller flip a file to 'workspace' AND bind it to its org/ws in one call.
    const result = workspaceRef === undefined
      ? this.db.prepare('UPDATE storage_files SET visibility = ? WHERE ownerGaii = ? AND key = ?').run(visibility, ownerGaii, key)
      : this.db.prepare('UPDATE storage_files SET visibility = ?, workspaceRef = ? WHERE ownerGaii = ? AND key = ?').run(visibility, workspaceRef || null, ownerGaii, key);
    if (result.changes === 0) return null;
    return this.getStorageFile(ownerGaii, key);
  },

  async setStorageFileProvenance(this: SqliteStorage, ownerGaii: string, key: string, aiProvenanceId: string): Promise<boolean> {
    const result = this.db.prepare(
      'UPDATE storage_files SET aiProvenanceId = ? WHERE ownerGaii = ? AND key = ?',
    ).run(aiProvenanceId, ownerGaii, key);
    return result.changes > 0;
  },
};
