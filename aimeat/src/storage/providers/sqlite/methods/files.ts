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
 *   2026-10-30 — listStorageFilesInDatabase is listStorageFilesIn: the files of the database or of one
 *     store id (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-).
 *   2026-10-29 — `blobRef` written and read on every path (Postgres 0121), the caller's UTF-8 verdict
 *     kept for a row whose bytes are an object elsewhere, and setStorageFileBlobRef,
 *     storageFileBlobRefsIn, listStorageFilesInDatabase and countStorageFilesByStore (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 *   2026-10-16 — The chunked-upload methods go through the shared ChunkedUploadStore (QA audit F05b-02).
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
  if (r.blobRef) record.blobRef = r.blobRef as string;
  return record;
}

/** Everything except the bytes — the columns a metadata read, a listing and a range reply all need. */
const META_COLUMNS =
  'key, ownerGaii, visibility, mimeType, size, tags, groupId, workspaceRef, federate, utf8Verified, aiProvenanceId, blobRef, createdAt';

/** What a font file is, by its name or by its type. The same test on Postgres (methods/files.ts). */
const FONT_FILE_WHERE =
  "lower(mimeType) LIKE 'font/%' OR lower(mimeType) LIKE 'application/font%' OR lower(mimeType) LIKE 'application/x-font%'"
  + " OR lower(key) LIKE '%.woff2' OR lower(key) LIKE '%.woff' OR lower(key) LIKE '%.ttf' OR lower(key) LIKE '%.otf'";

export const fileMethods = {

  // ══════════════════════════════════════════════════════════
  // ── Chunked Uploads (in-memory, same as MongoDB adapter) ──
  // ══════════════════════════════════════════════════════════

  async createChunkedUpload(this: SqliteStorage, record: ChunkedUploadRecord): Promise<ChunkedUploadRecord> {
    return this.chunkedUploads.create(record);
  },

  async getChunkedUpload(this: SqliteStorage, uploadId: string): Promise<ChunkedUploadRecord | null> {
    return this.chunkedUploads.get(uploadId);
  },

  async addChunk(this: SqliteStorage, uploadId: string, chunkIndex: number, data: Buffer): Promise<boolean> {
    return this.chunkedUploads.addChunk(uploadId, chunkIndex, data);
  },

  async deleteChunkedUpload(this: SqliteStorage, uploadId: string): Promise<boolean> {
    return this.chunkedUploads.delete(uploadId);
  },

  async chunkedUploadsHeldBy(this: SqliteStorage, ownerGaii: string): Promise<{ sessions: number; bytes: number }> {
    return this.chunkedUploads.heldBy(ownerGaii);
  },

  async sweepExpiredChunkedUploads(this: SqliteStorage): Promise<number> {
    return this.chunkedUploads.sweep();
  },
  async createStorageFile(this: SqliteStorage, file: StorageFileRecord): Promise<StorageFileRecord> {
    // Settled here, in the provider, because it is the one door every write goes through: sixteen
    // call sites create files and not one of them should have to know this rule exists.
    // A row whose bytes are an object elsewhere keeps the verdict the file-store wrapper settled from
    // the real bytes; the empty `data` it arrives with would measure as valid.
    const utf8Verified = file.blobRef ? (file.utf8Verified ?? null) : utf8VerdictFor(file);
    this.db.prepare(
      // The `accessCode` column stays in the table and is written by nobody. It was on
      // StorageFileRecord, stored here and absent from Postgres entirely, and no route on either
      // backend ever set it — an access code on a stored file is a concept that exists for APPS,
      // which have their own field and their own doors. Removed from the record on 2026-09-06
      // (review item 5.7) rather than mirrored into Postgres: a field nothing keeps is the same
      // false promise that hid the two real ones beside it, and the column is always NULL.
      `INSERT OR REPLACE INTO storage_files (ownerGaii, key, visibility, groupId, workspaceRef, mimeType, size, data, tags, createdAt, federate, utf8Verified, aiProvenanceId, blobRef)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      file.ownerGaii, file.key, file.visibility, file.groupId ?? null, file.workspaceRef ?? null,
      file.mimeType, file.size, file.data,
      JSON.stringify(file.tags || []), file.createdAt,
      file.federate ? 1 : 0,
      utf8Verified === null ? null : (utf8Verified ? 1 : 0),
      file.aiProvenanceId ?? null,
      file.blobRef ?? null,
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

  async setStorageFileBlobRef(this: SqliteStorage, ownerGaii: string, key: string, blobRef: string, size: number): Promise<boolean> {
    const result = this.db.prepare(
      "UPDATE storage_files SET blobRef = ?, data = X'' WHERE ownerGaii = ? AND key = ? AND blobRef IS NULL AND size = ?",
    ).run(blobRef, ownerGaii, key, size);
    return result.changes > 0;
  },

  async storageFileBlobRefsIn(this: SqliteStorage, refs: string[]): Promise<string[]> {
    if (refs.length === 0) return [];
    const out: string[] = [];
    // SQLite caps bound parameters per statement; a listing page is 1000 objects, so ask in parts.
    for (let i = 0; i < refs.length; i += 500) {
      const part = refs.slice(i, i + 500);
      const rows = this.db.prepare(
        `SELECT blobRef FROM storage_files WHERE blobRef IN (${part.map(() => '?').join(',')})`,
      ).all(...part) as { blobRef: string }[];
      for (const r of rows) out.push(r.blobRef);
    }
    return out;
  },

  async listStorageFilesIn(this: SqliteStorage, opts: { store: string; limit: number; after?: { ownerGaii: string; key: string }; owners?: string[] }): Promise<StorageFileRecord[]> {
    if (opts.owners && opts.owners.length === 0) return [];
    // A store id is compared as the reference's first part, never with LIKE, which reads `_` as any character.
    const head = `${opts.store}|`;
    const where: string[] = [opts.store === 'database' ? 'blobRef IS NULL' : 'substr(blobRef, 1, ?) = ?'];
    const args: unknown[] = opts.store === 'database' ? [] : [head.length, head];
    if (opts.owners) { where.push(`ownerGaii IN (${opts.owners.map(() => '?').join(',')})`); args.push(...opts.owners); }
    if (opts.after) { where.push('(ownerGaii > ? OR (ownerGaii = ? AND key > ?))'); args.push(opts.after.ownerGaii, opts.after.ownerGaii, opts.after.key); }
    const rows = this.db.prepare(
      `SELECT ${META_COLUMNS} FROM storage_files WHERE ${where.join(' AND ')} ORDER BY ownerGaii, key LIMIT ?`,
    ).all(...args, Math.max(1, Math.floor(opts.limit))) as Record<string, unknown>[];
    return rows.map(r => fileRowToRecord(r, Buffer.alloc(0)));
  },

  async countStorageFilesByStore(this: SqliteStorage): Promise<{ store: string; count: number; bytes: number }[]> {
    const rows = this.db.prepare(
      `SELECT CASE WHEN blobRef IS NULL THEN 'database' ELSE substr(blobRef, 1, instr(blobRef, '|') - 1) END AS store,
              COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes
       FROM storage_files GROUP BY store`,
    ).all() as { store: string; count: number; bytes: number }[];
    return rows.map(r => ({ store: r.store, count: Number(r.count), bytes: Number(r.bytes) }));
  },
};
