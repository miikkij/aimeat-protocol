/**
 * @file src/storage/providers/postgres-kysely/methods/files.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage-file domain for the Postgres+Kysely backend (StorageFile table, bytea `data`) +
 *   the transient in-memory chunked-upload buffer. Translated 1:1 from the Prisma implementation:
 *   create is upsert (re-upload replaces), sumStorageBytesForOwners is one cross-identity aggregate,
 *   listStorageFiles omits the bytes.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: storage files on Postgres+Kysely.
 *   v1.1.0 — 2026-07-16 — listStorageFilesForOwners batch primitive.
 *   v1.2.0 — 2026-08-15 — TARGET-063: getStorageFileMeta and readStorageFileRange (database-side
 *     substring), and the UTF-8 verdict settled on write.
 */
import { sql } from 'kysely';
import type { ChunkedUploadRecord, StorageFileRecord } from '../../../interface.js';
import type { PostgresKyselyStorage } from '../index.js';
import { utf8VerdictFor } from '../../../../utils/app-content-type.js';

export const fileMethods = {
  async createStorageFile(this: PostgresKyselyStorage, file: StorageFileRecord): Promise<StorageFileRecord> {
    const utf8Verified = utf8VerdictFor(file);
    const shared = {
      visibility: file.visibility, mimeType: file.mimeType, size: file.size, data: file.data,
      tags: file.tags || [], federate: file.federate ?? false, groupId: file.groupId ?? null,
      workspaceRef: file.workspaceRef ?? null, createdAt: new Date(file.createdAt), utf8Verified,
    };
    await this.db.insertInto('StorageFile').values({ key: file.key, ownerGaii: file.ownerGaii, ...shared })
      .onConflict(oc => oc.columns(['ownerGaii', 'key']).doUpdateSet(shared)).execute();
    return { ...file, utf8Verified: utf8Verified ?? undefined };
  },

  async getStorageFile(this: PostgresKyselyStorage, ownerGaii: string, key: string): Promise<StorageFileRecord | null> {
    const r = await this.db.selectFrom('StorageFile').selectAll().where('ownerGaii', '=', ownerGaii).where('key', '=', key).executeTakeFirst();
    if (!r) return null;
    return {
      key: r.key, ownerGaii: r.ownerGaii, visibility: r.visibility as StorageFileRecord['visibility'],
      groupId: r.groupId ?? undefined, workspaceRef: r.workspaceRef ?? undefined, mimeType: r.mimeType,
      size: r.size, data: Buffer.from(r.data), tags: r.tags || [], federate: r.federate ?? false,
      utf8Verified: r.utf8Verified ?? undefined,
      createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).toISOString(),
    };
  },

  async getStorageFileMeta(this: PostgresKyselyStorage, ownerGaii: string, key: string): Promise<StorageFileRecord | null> {
    const r = await this.db.selectFrom('StorageFile')
      .select(['key', 'ownerGaii', 'visibility', 'groupId', 'workspaceRef', 'mimeType', 'size', 'tags', 'federate', 'utf8Verified', 'createdAt'])
      .where('ownerGaii', '=', ownerGaii).where('key', '=', key).executeTakeFirst();
    if (!r) return null;
    return {
      key: r.key, ownerGaii: r.ownerGaii, visibility: r.visibility as StorageFileRecord['visibility'],
      groupId: r.groupId ?? undefined, workspaceRef: r.workspaceRef ?? undefined, mimeType: r.mimeType,
      size: r.size, data: Buffer.alloc(0), tags: r.tags || [], federate: r.federate ?? false,
      utf8Verified: r.utf8Verified ?? undefined,
      createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).toISOString(),
    };
  },

  async readStorageFileRange(this: PostgresKyselyStorage, ownerGaii: string, key: string, start: number, length: number): Promise<Buffer | null> {
    if (length <= 0) return Buffer.alloc(0);
    // `substring(bytea from N for L)` counts from 1. The caller's `start` is a byte offset, which
    // counts from 0, and that difference is worth exactly one +1 in one place rather than in every
    // route that ever serves a range.
    const r = await this.db.selectFrom('StorageFile')
      .select(sql<Buffer>`substring("data" from ${start + 1} for ${length})`.as('chunk'))
      .where('ownerGaii', '=', ownerGaii).where('key', '=', key).executeTakeFirst();
    if (!r) return null;
    return Buffer.from(r.chunk);
  },

  async listStorageFiles(this: PostgresKyselyStorage, ownerGaii: string): Promise<StorageFileRecord[]> {
    const rows = await this.db.selectFrom('StorageFile')
      .select(['key', 'ownerGaii', 'visibility', 'groupId', 'workspaceRef', 'mimeType', 'size', 'tags', 'federate', 'createdAt'])
      .where('ownerGaii', '=', ownerGaii).execute();
    return rows.map(r => ({
      key: r.key, ownerGaii: r.ownerGaii, visibility: r.visibility as StorageFileRecord['visibility'],
      groupId: r.groupId ?? undefined, workspaceRef: r.workspaceRef ?? undefined, mimeType: r.mimeType,
      size: r.size, data: Buffer.alloc(0), tags: r.tags || [], federate: r.federate ?? false,
      createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).toISOString(),
    }));
  },

  async listStorageFilesForOwners(this: PostgresKyselyStorage, ownerGaiis: string[]): Promise<Record<string, StorageFileRecord[]>> {
    const out: Record<string, StorageFileRecord[]> = {};
    for (const g of ownerGaiis) out[g] = [];
    if (ownerGaiis.length === 0) return out;
    const rows = await this.db.selectFrom('StorageFile')
      .select(['key', 'ownerGaii', 'visibility', 'groupId', 'workspaceRef', 'mimeType', 'size', 'tags', 'federate', 'createdAt'])
      .where('ownerGaii', 'in', ownerGaiis).execute();
    for (const r of rows) {
      (out[r.ownerGaii] ??= []).push({
        key: r.key, ownerGaii: r.ownerGaii, visibility: r.visibility as StorageFileRecord['visibility'],
        groupId: r.groupId ?? undefined, workspaceRef: r.workspaceRef ?? undefined, mimeType: r.mimeType,
        size: r.size, data: Buffer.alloc(0), tags: r.tags || [], federate: r.federate ?? false,
        createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).toISOString(),
      });
    }
    return out;
  },

  async sumStorageBytesForOwners(this: PostgresKyselyStorage, ownerGaiis: string[]): Promise<{ bytes: number; count: number }> {
    if (ownerGaiis.length === 0) return { bytes: 0, count: 0 };
    const r = await this.db.selectFrom('StorageFile')
      .select([sql<number>`coalesce(sum(size),0)`.as('bytes'), sql<number>`count(*)`.as('count')])
      .where('ownerGaii', 'in', ownerGaiis).executeTakeFirst();
    return { bytes: Number(r?.bytes ?? 0), count: Number(r?.count ?? 0) };
  },

  async deleteStorageFile(this: PostgresKyselyStorage, ownerGaii: string, key: string): Promise<boolean> {
    const r = await this.db.deleteFrom('StorageFile').where('ownerGaii', '=', ownerGaii).where('key', '=', key).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  async updateFileTagsByKey(this: PostgresKyselyStorage, ownerGaii: string, key: string, tags: string[]): Promise<StorageFileRecord | null> {
    const r = await this.db.updateTable('StorageFile').set({ tags }).where('ownerGaii', '=', ownerGaii).where('key', '=', key).executeTakeFirst();
    if (Number(r.numUpdatedRows ?? 0) === 0) return null;
    return this.getStorageFile(ownerGaii, key);
  },

  async updateFileVisibility(this: PostgresKyselyStorage, ownerGaii: string, key: string, visibility: StorageFileRecord['visibility'], workspaceRef?: string): Promise<StorageFileRecord | null> {
    const data = workspaceRef === undefined ? { visibility } : { visibility, workspaceRef: workspaceRef || null };
    const r = await this.db.updateTable('StorageFile').set(data).where('ownerGaii', '=', ownerGaii).where('key', '=', key).executeTakeFirst();
    if (Number(r.numUpdatedRows ?? 0) === 0) return null;
    return this.getStorageFile(ownerGaii, key);
  },

  // ── Chunked uploads (transient, in-memory — matches the other backends) ──
  async createChunkedUpload(this: PostgresKyselyStorage, record: ChunkedUploadRecord): Promise<ChunkedUploadRecord> {
    this.chunkedUploads.set(record.uploadId, record);
    return record;
  },
  async getChunkedUpload(this: PostgresKyselyStorage, uploadId: string): Promise<ChunkedUploadRecord | null> {
    return this.chunkedUploads.get(uploadId) ?? null;
  },
  async addChunk(this: PostgresKyselyStorage, uploadId: string, chunkIndex: number, data: Buffer): Promise<boolean> {
    const upload = this.chunkedUploads.get(uploadId);
    if (!upload) return false;
    upload.receivedChunks.set(chunkIndex, data);
    return true;
  },
  async deleteChunkedUpload(this: PostgresKyselyStorage, uploadId: string): Promise<boolean> {
    return this.chunkedUploads.delete(uploadId);
  },
};
