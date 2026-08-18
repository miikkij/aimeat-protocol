/**
 * @file src/storage/providers/sqlite/methods/storage-files.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Stored-file methods for the SQLite backend: create, read (whole / metadata / one byte
 *   range), list, delete, and the tag + visibility updates.
 *
 *   A PURE EXTRACTION from methods/identity-nodes.ts, which had grown past the 800-line limit. The
 *   bodies moved unchanged; the only thing that is new here is the file itself, and the grouping is
 *   the one the Storage interface already draws — FileRepository is a segment of its own.
 *
 *   THE ONE RULE THAT LIVES IN THIS FILE RATHER THAN ABOVE IT. `createStorageFile` settles the
 *   UTF-8 verdict, because the provider is the single door every write goes through: sixteen call
 *   sites create files and none of them should have to know the rule exists. Everything else here is
 *   about reading only what was asked for — metadata without bytes, a range as a range.
 * @structure fileRowToRecord() — the one row-to-record mapping · storageFileMethods — the interface
 *   segment, merged onto SqliteStorage's prototype
 * @usage merged in providers/sqlite/index.ts alongside the other method groups
 * @version-history
 *   v1.0.0 — 2026-08-15 — Extracted from methods/identity-nodes.ts (max-file-lines), carrying
 *     TARGET-063's getStorageFileMeta, readStorageFileRange and the UTF-8 verdict.
 */
import type { StorageFileRecord } from '../../../interface.js';
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
  if (r.accessCode) record.accessCode = r.accessCode as string;
  if (r.groupId) record.groupId = r.groupId as string;
  if (r.workspaceRef) record.workspaceRef = r.workspaceRef as string;
  record.federate = r.federate === 1;
  // SQLite has no boolean: 1/0 is the verdict, NULL is "never established" and must stay undefined
  // rather than collapsing into false, which would claim we had checked.
  if (r.utf8Verified !== null && r.utf8Verified !== undefined) record.utf8Verified = r.utf8Verified === 1;
  return record;
}

/** Everything except the bytes — the columns a metadata read, a listing and a range reply all need. */
const META_COLUMNS =
  'key, ownerGaii, visibility, mimeType, size, tags, accessCode, groupId, workspaceRef, federate, utf8Verified, createdAt';

export const storageFileMethods = {
  async createStorageFile(this: SqliteStorage, file: StorageFileRecord): Promise<StorageFileRecord> {
    // Settled here, in the provider, because it is the one door every write goes through: sixteen
    // call sites create files and not one of them should have to know this rule exists.
    const utf8Verified = utf8VerdictFor(file);
    this.db.prepare(
      `INSERT OR REPLACE INTO storage_files (ownerGaii, key, visibility, groupId, workspaceRef, mimeType, size, data, accessCode, tags, createdAt, federate, utf8Verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      file.ownerGaii, file.key, file.visibility, file.groupId ?? null, file.workspaceRef ?? null,
      file.mimeType, file.size, file.data,
      file.accessCode ?? null, JSON.stringify(file.tags || []), file.createdAt,
      file.federate ? 1 : 0,
      utf8Verified === null ? null : (utf8Verified ? 1 : 0),
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
};
