/**
 * @file src/storage/providers/postgres-kysely/methods/ai-provenance.ts
 * @description Postgres+Kysely implementation of the addressable AI provenance store (TARGET-058).
 *   Four methods, no update and no delete: a provenance record is an attributable statement about a
 *   specific set of bytes, so a correction is a NEW record about the new bytes.
 *
 *   PUBLIC MEANS "SOMETHING PUBLIC POINTS AT IT". There is no visibility column on the record; the
 *   predicate below is the single expression of that rule for this provider, and both the detection
 *   lookup and publiclyLinkedProvenanceIds() are built from it so the two can never disagree.
 *
 *   The hash lookup applies the predicate IN SQL rather than in the route. That is not a performance
 *   choice — it means a third party's non-public row never enters the process at all on the
 *   anonymous detection path, so there is nothing there to leak by a later mistake.
 * @structure aiProvenanceMethods — createAiProvenance · getAiProvenance · findAiProvenanceByHash ·
 *   publiclyLinkedProvenanceIds
 * @usage merged onto PostgresKyselyStorage.prototype in ../index.ts
 * @version-history
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 2. Visibility follows the content: the stored flag is
 *     gone and the public test is an EXISTS over the items that point at the record.
 *     Schema: migrations/0018_ai_provenance_visibility.sql.
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 1. Schema: migrations/0017_ai_provenance.sql.
 */
import { sql, type Selectable } from 'kysely';
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
    generatedAt: r.generatedAt,
    createdAt: r.createdAt,
    record: r.record as AiProvenanceDoc,
  };
}

/**
 * "Is this record's subject readable by an anonymous visitor right now?" — as a SQL fragment, so the
 * answer is computed against live rows rather than a flag someone has to remember to flip.
 *
 * A public memory record covers memory, workspace records, agent faces and WebMCP tool manifests
 * (all memory-backed). An app counts when it is actually served to anyone who asks: not parked, not
 * operator-hidden, and not behind an access code.
 */
const publiclyLinked = (idColumn: string) => sql<boolean>`(
  EXISTS (SELECT 1 FROM "Memory" m WHERE m."aiProvenanceId" = ${sql.raw(idColumn)} AND m."visibility" = 'public')
  OR EXISTS (SELECT 1 FROM "App" a WHERE a."aiProvenanceId" = ${sql.raw(idColumn)}
             AND a."parked" = false AND a."operatorHidden" = false AND a."accessCode" IS NULL)
)`;

export const aiProvenanceMethods = {
  async createAiProvenance(this: PostgresKyselyStorage, row: AiProvenanceRecordRow): Promise<void> {
    await this.db.insertInto('AiProvenance').values({
      id: row.id,
      ownerGhii: row.ownerGhii,
      principal: row.principal,
      contentHash: row.contentHash,
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
    const isPublic = publiclyLinked('"AiProvenance"."id"');
    const rows = await this.db.selectFrom('AiProvenance').selectAll()
      .where('contentHash', '=', contentHash)
      .where((eb) => (owner
        ? eb.or([eb(isPublic, '=', true), eb('ownerGhii', '=', owner)])
        : eb(isPublic, '=', true)))
      .orderBy('generatedAt', 'desc')
      .limit(limit)
      .execute();
    return rows.map(toRecord);
  },

  async publiclyLinkedProvenanceIds(this: PostgresKyselyStorage, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.selectFrom('AiProvenance').select('id')
      .where('id', 'in', ids)
      .where(publiclyLinked('"AiProvenance"."id"'), '=', true)
      .execute();
    return rows.map((r) => r.id);
  },
};
