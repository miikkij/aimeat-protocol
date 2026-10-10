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
 *   v1.3.0 — 2026-10-03 — listFontFilesAcrossOwners: font files of every owner, one bounded query.
 *   v1.4.0 — 2026-10-08 — aiProvenanceId is written, read on every path, and set alone by
 *     setStorageFileProvenance. Schema: migrations/0096_storage_file_provenance.sql.
 *   v1.5.0 — 2026-10-10 — A value larger than BYTEA_SLICE_BYTES is read in slices, by getStorageFile
 *     and by readStorageFileRange. One query for a value of 256 MB or more made the driver build a
 *     string V8 refuses, and the process exited. createStorageFile binds the bytes once (the update
 *     half reads `excluded`): bound twice, a file over 512 MB passed Postgres's 1 GB message limit.
 */
import { sql } from 'kysely';
import type { ChunkedUploadRecord, StorageFileRecord } from '../../../interface.js';
import type { PostgresKyselyStorage } from '../index.js';
import { utf8VerdictFor } from '../../../../utils/app-content-type.js';

/**
 * The most bytea one query brings back.
 *
 * Postgres sends a bytea value to this driver as hex text, two characters per byte, and pg-protocol
 * turns that text into ONE JavaScript string. V8 refuses a string past 0x1fffffe8 characters, which
 * is a value of 268 435 444 bytes. The refusal is thrown inside the socket's data handler, where no
 * caller can catch it, so the whole node process exits. Measured on 2026-10-10 with a 400 MB file
 * and `Range: bytes=0-`, the first request a `<video>` element makes: ERR_STRING_TOO_LONG, exit.
 *
 * The per-file ceiling used to keep every value far below that (10 MB by default, 50 MB on
 * aimeat.io). Since an operator may set it to 1024 MB, no read may depend on the ceiling for its
 * safety. 32 MB is 64 MB of text per query: small enough to be far from the limit, large enough
 * that a 1 GB file is 32 round trips.
 */
export const BYTEA_SLICE_BYTES = 32 * 1024 * 1024;

/** `length` bytes from byte offset `start`, in one query. `length` is at most one slice. */
async function readOneSlice(self: PostgresKyselyStorage, ownerGaii: string, key: string, start: number, length: number): Promise<Buffer | null> {
  // `substring(bytea from N for L)` counts from 1. The caller's `start` is a byte offset, which
  // counts from 0, and that difference is worth exactly one +1 in one place rather than in every
  // route that ever serves a range.
  const r = await self.db.selectFrom('StorageFile')
    .select(sql<Buffer>`substring("data" from ${start + 1} for ${length})`.as('chunk'))
    .where('ownerGaii', '=', ownerGaii).where('key', '=', key).executeTakeFirst();
  if (!r) return null;
  return Buffer.from(r.chunk);
}

/** The same bytes as one read would give, fetched a slice at a time. Null when the row is gone. */
async function readInSlices(self: PostgresKyselyStorage, ownerGaii: string, key: string, start: number, length: number): Promise<Buffer | null> {
  const parts: Buffer[] = [];
  let got = 0;
  while (got < length) {
    const part = await readOneSlice(self, ownerGaii, key, start + got, Math.min(BYTEA_SLICE_BYTES, length - got));
    if (!part) return null;
    // A short slice means the value ends here: the range ran past the end, as substring allows.
    if (part.length === 0) break;
    parts.push(part);
    got += part.length;
  }
  return Buffer.concat(parts, got);
}

export const fileMethods = {
  async createStorageFile(this: PostgresKyselyStorage, file: StorageFileRecord): Promise<StorageFileRecord> {
    const utf8Verified = utf8VerdictFor(file);
    const shared = {
      visibility: file.visibility, mimeType: file.mimeType, size: file.size, data: file.data,
      tags: file.tags || [], federate: file.federate ?? false, groupId: file.groupId ?? null,
      workspaceRef: file.workspaceRef ?? null, createdAt: new Date(file.createdAt), utf8Verified,
      // A re-upload under the same key replaces the record too: new bytes, new statement or none.
      aiProvenanceId: file.aiProvenanceId ?? null,
    };
    // THE BYTES ARE BOUND ONCE. The update half names the row the insert proposed (`excluded`)
    // instead of repeating the values. Repeating them bound `data` as two parameters of one
    // statement, so the message Postgres received was twice the file, and Postgres drops a
    // connection whose message passes 1 GB: a file over 512 MB could not be stored and took the
    // connection with it (measured 2026-10-10: 500 MB stored, 550 MB did not).
    await this.db.insertInto('StorageFile').values({ key: file.key, ownerGaii: file.ownerGaii, ...shared })
      .onConflict(oc => oc.columns(['ownerGaii', 'key']).doUpdateSet(eb => ({
        visibility: eb.ref('excluded.visibility'), mimeType: eb.ref('excluded.mimeType'), size: eb.ref('excluded.size'),
        data: eb.ref('excluded.data'), tags: eb.ref('excluded.tags'), federate: eb.ref('excluded.federate'),
        groupId: eb.ref('excluded.groupId'), workspaceRef: eb.ref('excluded.workspaceRef'),
        createdAt: eb.ref('excluded.createdAt'), utf8Verified: eb.ref('excluded.utf8Verified'),
        aiProvenanceId: eb.ref('excluded.aiProvenanceId'),
      }))).execute();
    return { ...file, utf8Verified: utf8Verified ?? undefined };
  },

  async getStorageFile(this: PostgresKyselyStorage, ownerGaii: string, key: string): Promise<StorageFileRecord | null> {
    // The bytes come back in this one query only when the value is small. A larger one is NULL here
    // and is read in slices below; BYTEA_SLICE_BYTES says why. `octet_length` reads the length from
    // the value's header, so it does not fetch the value.
    const r = await this.db.selectFrom('StorageFile')
      .select(['key', 'ownerGaii', 'visibility', 'groupId', 'workspaceRef', 'mimeType', 'size', 'tags', 'federate', 'utf8Verified', 'aiProvenanceId', 'createdAt'])
      .select(sql<number>`octet_length("data")`.as('bytes'))
      .select(sql<Buffer | null>`CASE WHEN octet_length("data") <= ${BYTEA_SLICE_BYTES} THEN "data" END`.as('data'))
      .where('ownerGaii', '=', ownerGaii).where('key', '=', key).executeTakeFirst();
    if (!r) return null;
    const data = r.data ? Buffer.from(r.data) : await readInSlices(this, ownerGaii, key, 0, Number(r.bytes));
    // Null only when the row was deleted between the two reads.
    if (!data) return null;
    return {
      key: r.key, ownerGaii: r.ownerGaii, visibility: r.visibility as StorageFileRecord['visibility'],
      groupId: r.groupId ?? undefined, workspaceRef: r.workspaceRef ?? undefined, mimeType: r.mimeType,
      size: r.size, data, tags: r.tags || [], federate: r.federate ?? false,
      aiProvenanceId: r.aiProvenanceId ?? undefined,
      utf8Verified: r.utf8Verified ?? undefined,
      createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).toISOString(),
    };
  },

  async getStorageFileMeta(this: PostgresKyselyStorage, ownerGaii: string, key: string): Promise<StorageFileRecord | null> {
    const r = await this.db.selectFrom('StorageFile')
      .select(['key', 'ownerGaii', 'visibility', 'groupId', 'workspaceRef', 'mimeType', 'size', 'tags', 'federate', 'utf8Verified', 'aiProvenanceId', 'createdAt'])
      .where('ownerGaii', '=', ownerGaii).where('key', '=', key).executeTakeFirst();
    if (!r) return null;
    return {
      key: r.key, ownerGaii: r.ownerGaii, visibility: r.visibility as StorageFileRecord['visibility'],
      groupId: r.groupId ?? undefined, workspaceRef: r.workspaceRef ?? undefined, mimeType: r.mimeType,
      size: r.size, data: Buffer.alloc(0), tags: r.tags || [], federate: r.federate ?? false,
      aiProvenanceId: r.aiProvenanceId ?? undefined,
      utf8Verified: r.utf8Verified ?? undefined,
      createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).toISOString(),
    };
  },

  async readStorageFileRange(this: PostgresKyselyStorage, ownerGaii: string, key: string, start: number, length: number): Promise<Buffer | null> {
    if (length <= 0) return Buffer.alloc(0);
    // A range longer than one slice is read as several, for the reason BYTEA_SLICE_BYTES gives. A
    // caller that asks for 400 MB gets 400 MB; it does not get a dead process.
    if (length > BYTEA_SLICE_BYTES) return readInSlices(this, ownerGaii, key, start, length);
    return readOneSlice(this, ownerGaii, key, start, length);
  },

  async listStorageFiles(this: PostgresKyselyStorage, ownerGaii: string): Promise<StorageFileRecord[]> {
    const rows = await this.db.selectFrom('StorageFile')
      .select(['key', 'ownerGaii', 'visibility', 'groupId', 'workspaceRef', 'mimeType', 'size', 'tags', 'federate', 'aiProvenanceId', 'createdAt'])
      .where('ownerGaii', '=', ownerGaii).execute();
    return rows.map(r => ({
      key: r.key, ownerGaii: r.ownerGaii, visibility: r.visibility as StorageFileRecord['visibility'],
      groupId: r.groupId ?? undefined, workspaceRef: r.workspaceRef ?? undefined, mimeType: r.mimeType,
      size: r.size, data: Buffer.alloc(0), tags: r.tags || [], federate: r.federate ?? false,
      aiProvenanceId: r.aiProvenanceId ?? undefined,
      createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).toISOString(),
    }));
  },

  async listStorageFilesForOwners(this: PostgresKyselyStorage, ownerGaiis: string[]): Promise<Record<string, StorageFileRecord[]>> {
    const out: Record<string, StorageFileRecord[]> = {};
    for (const g of ownerGaiis) out[g] = [];
    if (ownerGaiis.length === 0) return out;
    const rows = await this.db.selectFrom('StorageFile')
      .select(['key', 'ownerGaii', 'visibility', 'groupId', 'workspaceRef', 'mimeType', 'size', 'tags', 'federate', 'aiProvenanceId', 'createdAt'])
      .where('ownerGaii', 'in', ownerGaiis).execute();
    for (const r of rows) {
      (out[r.ownerGaii] ??= []).push({
        key: r.key, ownerGaii: r.ownerGaii, visibility: r.visibility as StorageFileRecord['visibility'],
        groupId: r.groupId ?? undefined, workspaceRef: r.workspaceRef ?? undefined, mimeType: r.mimeType,
        size: r.size, data: Buffer.alloc(0), tags: r.tags || [], federate: r.federate ?? false,
        aiProvenanceId: r.aiProvenanceId ?? undefined,
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

  async listFontFilesAcrossOwners(this: PostgresKyselyStorage, opts: { limit: number; excludeOwner?: string }): Promise<{ total: number; items: StorageFileRecord[] }> {
    // One statement: the rows and, by a window count, how many matched. `data` is not selected, so
    // no bytea is read. The test for a font is the SQLite provider's (methods/files.ts).
    const rows = await this.db.selectFrom('StorageFile')
      .select(['key', 'ownerGaii', 'visibility', 'groupId', 'workspaceRef', 'mimeType', 'size', 'tags', 'federate', 'aiProvenanceId', 'createdAt', sql<string>`count(*) over ()`.as('total')])
      .where('ownerGaii', '!=', opts.excludeOwner ?? '')
      .where(sql<boolean>`(lower("mimeType") like 'font/%' or lower("mimeType") like 'application/font%' or lower("mimeType") like 'application/x-font%'
        or lower("key") like '%.woff2' or lower("key") like '%.woff' or lower("key") like '%.ttf' or lower("key") like '%.otf')`)
      .orderBy('createdAt', 'desc').limit(Math.max(0, Math.floor(opts.limit))).execute();
    return {
      total: rows.length ? Number(rows[0].total) : 0,
      items: rows.map(r => ({
        key: r.key, ownerGaii: r.ownerGaii, visibility: r.visibility as StorageFileRecord['visibility'],
        groupId: r.groupId ?? undefined, workspaceRef: r.workspaceRef ?? undefined, mimeType: r.mimeType,
        size: r.size, data: Buffer.alloc(0), tags: r.tags || [], federate: r.federate ?? false,
        aiProvenanceId: r.aiProvenanceId ?? undefined,
        createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).toISOString(),
      })),
    };
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

  async setStorageFileProvenance(this: PostgresKyselyStorage, ownerGaii: string, key: string, aiProvenanceId: string): Promise<boolean> {
    const r = await this.db.updateTable('StorageFile').set({ aiProvenanceId })
      .where('ownerGaii', '=', ownerGaii).where('key', '=', key).executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0) > 0;
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
