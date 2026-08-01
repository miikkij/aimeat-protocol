/**
 * @file src/storage/providers/postgres-kysely/methods/ai-provenance.ts
 * @description Postgres+Kysely implementation of the addressable AI provenance store (TARGET-058).
 *   Three methods, no update and no delete: a provenance record is an attributable statement about a
 *   specific set of bytes, so a correction is a NEW record about the new bytes.
 *
 *   The hash lookup filters `visibility`/`ownerGhii` IN SQL rather than in the route. That is not a
 *   performance choice — it means a third party's private row never enters the process at all on the
 *   anonymous detection path, so there is nothing there to leak by a later mistake.
 * @structure aiProvenanceMethods — createAiProvenance · getAiProvenance · findAiProvenanceByHash
 * @usage merged onto PostgresKyselyStorage.prototype in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 1. Schema: migrations/0017_ai_provenance.sql.
 */
import type { Selectable } from 'kysely';
import type { AiProvenanceRecordRow, AiProvenanceHashQuery } from '../../../interface.js';
import type { AiProvenance as AiProvenanceDoc } from '../../../../models/ai-provenance-schemas.js';
import type { AiProvenance as AiProvenanceRow, Json } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

function toRecord(r: Selectable<AiProvenanceRow>): AiProvenanceRecordRow {
  return {
    id: r.id,
    ownerGhii: r.ownerGhii,
    principal: r.principal,
    contentHash: r.contentHash ?? null,
    visibility: r.visibility as 'public' | 'private',
    generatedAt: r.generatedAt,
    createdAt: r.createdAt,
    record: r.record as AiProvenanceDoc,
  };
}

export const aiProvenanceMethods = {
  async createAiProvenance(this: PostgresKyselyStorage, row: AiProvenanceRecordRow): Promise<void> {
    await this.db.insertInto('AiProvenance').values({
      id: row.id,
      ownerGhii: row.ownerGhii,
      principal: row.principal,
      contentHash: row.contentHash,
      visibility: row.visibility,
      generatedAt: row.generatedAt,
      createdAt: row.createdAt,
      // jsonb() yields a `<json>::jsonb` SQL fragment; kysely-codegen types the column as the
      // VALUE it reads back, so the fragment needs one narrowing cast on the way in.
      record: jsonb(row.record) as unknown as Json,
    }).execute();
  },

  async getAiProvenance(this: PostgresKyselyStorage, id: string): Promise<AiProvenanceRecordRow | undefined> {
    const r = await this.db.selectFrom('AiProvenance').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toRecord(r) : undefined;
  },

  async findAiProvenanceByHash(
    this: PostgresKyselyStorage, contentHash: string, query?: AiProvenanceHashQuery,
  ): Promise<AiProvenanceRecordRow[]> {
    const limit = Math.min(Math.max(query?.limit ?? 20, 1), 100);
    const owner = query?.ownerGhii;
    const rows = await this.db.selectFrom('AiProvenance').selectAll()
      .where('contentHash', '=', contentHash)
      .where((eb) => (owner
        ? eb.or([eb('visibility', '=', 'public'), eb('ownerGhii', '=', owner)])
        : eb('visibility', '=', 'public')))
      .orderBy('generatedAt', 'desc')
      .limit(limit)
      .execute();
    return rows.map(toRecord);
  },
};
