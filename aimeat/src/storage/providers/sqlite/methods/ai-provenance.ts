/**
 * @file src/storage/providers/sqlite/methods/ai-provenance.ts
 * @description SQLite implementation of the addressable AI provenance store (TARGET-058). Three
 *   methods, no update and no delete: a provenance record is an attributable statement about a
 *   specific set of bytes, so a correction is a NEW record about the new bytes.
 *
 *   The hash lookup filters `visibility`/`ownerGhii` IN SQL rather than in the route. That is not a
 *   performance choice — it means a third party's private row never enters the process at all on the
 *   anonymous detection path, so there is nothing there to leak by a later mistake.
 * @structure aiProvenanceMethods — createAiProvenance · getAiProvenance · findAiProvenanceByHash
 * @usage merged onto SqliteStorage.prototype in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 1.
 */
import type { AiProvenanceRecordRow, AiProvenanceHashQuery } from '../../../interface.js';
import type { AiProvenance } from '../../../../models/ai-provenance-schemas.js';
import type { SqliteStorage } from '../index.js';

function deserialize(row: Record<string, unknown>): AiProvenanceRecordRow {
  return {
    id: row.id as string,
    ownerGhii: row.ownerGhii as string,
    principal: row.principal as string,
    contentHash: (row.contentHash as string | null) ?? null,
    visibility: row.visibility as 'public' | 'private',
    generatedAt: row.generatedAt as string,
    createdAt: row.createdAt as string,
    record: JSON.parse(row.record as string) as AiProvenance,
  };
}

export const aiProvenanceMethods = {
  async createAiProvenance(this: SqliteStorage, row: AiProvenanceRecordRow): Promise<void> {
    this.db.prepare(
      `INSERT INTO ai_provenance (id, ownerGhii, principal, contentHash, visibility, generatedAt, createdAt, record)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      row.id, row.ownerGhii, row.principal, row.contentHash,
      row.visibility, row.generatedAt, row.createdAt,
      JSON.stringify(row.record),
    );
  },

  async getAiProvenance(this: SqliteStorage, id: string): Promise<AiProvenanceRecordRow | undefined> {
    const row = this.db.prepare('SELECT * FROM ai_provenance WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? deserialize(row) : undefined;
  },

  async findAiProvenanceByHash(
    this: SqliteStorage, contentHash: string, query?: AiProvenanceHashQuery,
  ): Promise<AiProvenanceRecordRow[]> {
    const limit = Math.min(Math.max(query?.limit ?? 20, 1), 100);
    const rows = query?.ownerGhii
      ? this.db.prepare(
        `SELECT * FROM ai_provenance WHERE contentHash = ? AND (visibility = 'public' OR ownerGhii = ?)
         ORDER BY generatedAt DESC LIMIT ?`
      ).all(contentHash, query.ownerGhii, limit) as Record<string, unknown>[]
      : this.db.prepare(
        `SELECT * FROM ai_provenance WHERE contentHash = ? AND visibility = 'public'
         ORDER BY generatedAt DESC LIMIT ?`
      ).all(contentHash, limit) as Record<string, unknown>[];
    return rows.map(deserialize);
  },
};
