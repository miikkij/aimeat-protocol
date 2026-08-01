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
 * @structure aiProvenanceMethods — createAiProvenance · getAiProvenance · getAiProvenanceMany ·
 *   findAiProvenanceByHash · publiclyLinkedProvenanceIds · aiProvenanceFacets · listAiProvenance
 * @usage merged onto PostgresKyselyStorage.prototype in ../index.ts
 * @version-history
 *   v1.3.0 — 2026-08-01 — TARGET-058 Phase 8. aiProvenanceFacets() + listAiProvenance(): the read
 *     side for the operator report, the unlabelled-content sweep and the per-owner view. No
 *     migration — both read existing columns and the jsonb document.
 *   v1.2.0 — 2026-08-01 — TARGET-058 Phase 4 step 0b. getAiProvenanceMany(): one query for a page of
 *     items instead of one per item. No migration — it reads the primary key.
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 2. Visibility follows the content: the stored flag is
 *     gone and the public test is an EXISTS over the items that point at the record.
 *     Schema: migrations/0018_ai_provenance_visibility.sql.
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 1. Schema: migrations/0017_ai_provenance.sql.
 */
import { sql, type Selectable } from 'kysely';
import type {
  AiProvenanceRecordRow, AiProvenanceHashQuery,
  AiProvenanceFacet, AiProvenanceFacetQuery, AiProvenanceListQuery,
} from '../../../interface.js';
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

/** Bind-parameter budget for one `IN (...)` statement. Well under the Postgres 65535 ceiling. */
const ID_CHUNK = 1_000;

// The three document fields the report and the sweep group by, read out of the jsonb in SQL. Named
// constants so the facet query and the list query cannot drift on what "unlabelled" means — a sweep
// that counts one population while the report shows another is the kind of disagreement nobody
// notices until a regulator asks. Mirrors the SQLite provider's json_extract() trio.
const HUMAN_INVOLVEMENT = sql<string | null>`p."record"->>'humanInvolvement'`;
const LEVEL = sql<string | null>`p."record"->>'level'`;
/** COALESCE, because an ABSENT disclosure block means no label was computed as required. */
const DISCLOSURE_REQUIRED = sql<boolean>`COALESCE((p."record"->'disclosure'->>'required')::boolean, false)`;

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

  async getAiProvenanceMany(this: PostgresKyselyStorage, ids: string[]): Promise<AiProvenanceRecordRow[]> {
    if (ids.length === 0) return [];
    // Distinct ids only: a page where one crew run stamped fifty records carries fifty references to
    // a handful of statements, and binding the duplicates would widen the IN list for nothing.
    const unique = [...new Set(ids)];
    const out: AiProvenanceRecordRow[] = [];
    // Chunked because Postgres caps bind parameters per statement (65535) and the caller's page size
    // is not ours to bound — a workspace can legitimately hold thousands.
    for (let i = 0; i < unique.length; i += ID_CHUNK) {
      const rows = await this.db.selectFrom('AiProvenance').selectAll()
        .where('id', 'in', unique.slice(i, i + ID_CHUNK))
        .execute();
      for (const r of rows) out.push(toRecord(r));
    }
    return out;
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

  async aiProvenanceFacets(
    this: PostgresKyselyStorage, query?: AiProvenanceFacetQuery,
  ): Promise<AiProvenanceFacet[]> {
    let q = this.db.selectFrom('AiProvenance as p')
      .select([
        HUMAN_INVOLVEMENT.as('hi'),
        LEVEL.as('lvl'),
        sql<string>`substr(p."generatedAt", 1, 10)`.as('day'),
        publiclyLinked('p."id"').as('pub'),
        DISCLOSURE_REQUIRED.as('req'),
        sql<string>`COUNT(*)`.as('n'),
      ])
      .groupBy(['hi', 'lvl', 'day', 'pub', 'req']);
    if (query?.ownerGhii) q = q.where('p.ownerGhii', '=', query.ownerGhii);
    if (query?.since) q = q.where('p.generatedAt', '>=', query.since);
    const rows = await q.execute();
    return rows.map((r) => ({
      // `unstated` rather than null: a record whose document somehow lacks the field says nothing
      // about human involvement, and "nothing" must never be counted as "a human was involved".
      humanInvolvement: r.hi ?? 'unstated',
      level: r.lvl ?? 'unstated',
      day: r.day,
      publiclyLinked: r.pub === true,
      disclosureRequired: r.req === true,
      // COUNT() comes back as a bigint string on this driver; Number() is exact well past any
      // plausible record count.
      count: Number(r.n),
    }));
  },

  async listAiProvenance(
    this: PostgresKyselyStorage, query?: AiProvenanceListQuery,
  ): Promise<{ items: AiProvenanceRecordRow[]; total: number }> {
    // One WHERE, built once and used by both the count and the page — so a total can never describe
    // a different population from the rows shown under it.
    const conditions = sql<boolean>`${sql.join([
      sql`TRUE`,
      ...(query?.ownerGhii ? [sql`p."ownerGhii" = ${query.ownerGhii}`] : []),
      ...(query?.since ? [sql`p."generatedAt" >= ${query.since}`] : []),
      ...(query?.unlabelledPublicOnly ? [
        publiclyLinked('p."id"'),
        sql`${HUMAN_INVOLVEMENT} IN ('none', 'light-review')`,
        sql`NOT ${DISCLOSURE_REQUIRED}`,
      ] : []),
    ], sql` AND `)}`;

    const counted = await this.db.selectFrom('AiProvenance as p')
      .select(sql<string>`COUNT(*)`.as('n'))
      .where(conditions)
      .executeTakeFirst();
    const limit = Math.min(Math.max(query?.limit ?? 50, 1), 500);
    const rows = await this.db.selectFrom('AiProvenance as p').selectAll()
      .where(conditions)
      .orderBy('p.generatedAt', 'desc')
      .limit(limit)
      .offset(Math.max(query?.offset ?? 0, 0))
      .execute();
    return { items: rows.map(toRecord), total: Number(counted?.n ?? 0) };
  },
};
