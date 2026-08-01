/**
 * @file src/storage/providers/sqlite/methods/ai-provenance.ts
 * @description SQLite implementation of the addressable AI provenance store (TARGET-058). Four
 *   methods, no update and no delete: a provenance record is an attributable statement about a
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
 * @usage merged onto SqliteStorage.prototype in ../index.ts
 * @version-history
 *   v1.3.0 — 2026-08-01 — TARGET-058 Phase 8. aiProvenanceFacets() + listAiProvenance(): the read
 *     side for the operator report, the unlabelled-content sweep and the per-owner view. Grouped in
 *     SQL over the whole table — a capped page would make "how many public items carry no label" a
 *     number that quietly means something else.
 *   v1.2.0 — 2026-08-01 — TARGET-058 Phase 4 step 0b. getAiProvenanceMany(): one query for a page of
 *     items instead of one per item. The N+1 it replaces grew with the CONTENT rather than with the
 *     traffic, and Phase 4's MCP read tools hit the same path.
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 2. Visibility follows the content: the stored flag is
 *     gone and the public test is an EXISTS over the items that point at the record.
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 1.
 */
import type {
  AiProvenanceRecordRow, AiProvenanceHashQuery,
  AiProvenanceFacet, AiProvenanceFacetQuery, AiProvenanceListQuery,
} from '../../../interface.js';
import type { AiProvenance } from '../../../../models/ai-provenance-schemas.js';
import type { SqliteStorage } from '../index.js';

function deserialize(row: Record<string, unknown>): AiProvenanceRecordRow {
  return {
    id: row.id as string,
    ownerGhii: row.ownerGhii as string,
    principal: row.principal as string,
    contentHash: (row.contentHash as string | null) ?? null,
    generatedAt: row.generatedAt as string,
    createdAt: row.createdAt as string,
    record: JSON.parse(row.record as string) as AiProvenance,
  };
}

/**
 * "Is this record's subject readable by an anonymous visitor right now?" — as SQL, so the answer is
 * computed against live rows rather than a flag someone has to remember to flip.
 *
 * A public memory record covers memory, workspace records, agent faces and WebMCP tool manifests
 * (all memory-backed). An app counts when it is actually served to anyone who asks: not parked, not
 * operator-hidden, and not behind an access code.
 */
const PUBLICLY_LINKED = `(
  EXISTS (SELECT 1 FROM memory m WHERE m.aiProvenanceId = p.id AND m.visibility = 'public')
  OR EXISTS (SELECT 1 FROM apps a WHERE a.aiProvenanceId = p.id
             AND a.parked = 0 AND a.operatorHidden = 0 AND a.accessCode IS NULL)
)`;

/** Bound-parameter budget for one `IN (...)` statement. Well under SQLite's 999-parameter default. */
const ID_CHUNK = 500;

// The three document fields the report and the sweep group by, read out of the JSON in SQL. Named
// constants so the facet query and the list query cannot drift on what "unlabelled" means — a sweep
// that counts one population while the report shows another is the kind of disagreement nobody
// notices until a regulator asks.
const HUMAN_INVOLVEMENT = "json_extract(p.record, '$.humanInvolvement')";
const LEVEL = "json_extract(p.record, '$.level')";
/** SQLite reads a JSON `true` as the integer 1. */
const DISCLOSURE_REQUIRED = "json_extract(p.record, '$.disclosure.required') = 1";

export const aiProvenanceMethods = {
  async createAiProvenance(this: SqliteStorage, row: AiProvenanceRecordRow): Promise<void> {
    this.db.prepare(
      `INSERT INTO ai_provenance (id, ownerGhii, principal, contentHash, generatedAt, createdAt, record)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      row.id, row.ownerGhii, row.principal, row.contentHash,
      row.generatedAt, row.createdAt,
      JSON.stringify(row.record),
    );
  },

  async getAiProvenance(this: SqliteStorage, id: string): Promise<AiProvenanceRecordRow | undefined> {
    const row = this.db.prepare('SELECT * FROM ai_provenance WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? deserialize(row) : undefined;
  },

  async getAiProvenanceMany(this: SqliteStorage, ids: string[]): Promise<AiProvenanceRecordRow[]> {
    if (ids.length === 0) return [];
    // Distinct ids only: a page where one crew run stamped fifty records carries fifty references to
    // a handful of statements, and binding the duplicates would widen the IN list for nothing.
    const unique = [...new Set(ids)];
    const out: AiProvenanceRecordRow[] = [];
    // Chunked because SQLite caps bound parameters per statement (999 on the older default) and the
    // caller's page size is not ours to bound — a workspace can legitimately hold thousands.
    for (let i = 0; i < unique.length; i += ID_CHUNK) {
      const chunk = unique.slice(i, i + ID_CHUNK);
      const rows = this.db.prepare(
        `SELECT * FROM ai_provenance WHERE id IN (${chunk.map(() => '?').join(',')})`
      ).all(...chunk) as Record<string, unknown>[];
      for (const r of rows) out.push(deserialize(r));
    }
    return out;
  },

  async findAiProvenanceByHash(
    this: SqliteStorage, contentHash: string, query?: AiProvenanceHashQuery,
  ): Promise<AiProvenanceRecordRow[]> {
    const limit = Math.min(Math.max(query?.limit ?? 20, 1), 100);
    const rows = query?.ownerGhii
      ? this.db.prepare(
        `SELECT p.* FROM ai_provenance p WHERE p.contentHash = ? AND (${PUBLICLY_LINKED} OR p.ownerGhii = ?)
         ORDER BY p.generatedAt DESC LIMIT ?`
      ).all(contentHash, query.ownerGhii, limit) as Record<string, unknown>[]
      : this.db.prepare(
        `SELECT p.* FROM ai_provenance p WHERE p.contentHash = ? AND ${PUBLICLY_LINKED}
         ORDER BY p.generatedAt DESC LIMIT ?`
      ).all(contentHash, limit) as Record<string, unknown>[];
    return rows.map(deserialize);
  },

  async publiclyLinkedProvenanceIds(this: SqliteStorage, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT p.id FROM ai_provenance p WHERE p.id IN (${placeholders}) AND ${PUBLICLY_LINKED}`
    ).all(...ids) as { id: string }[];
    return rows.map((r) => r.id);
  },

  async aiProvenanceFacets(
    this: SqliteStorage, query?: AiProvenanceFacetQuery,
  ): Promise<AiProvenanceFacet[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (query?.ownerGhii) { where.push('p.ownerGhii = ?'); params.push(query.ownerGhii); }
    if (query?.since) { where.push('p.generatedAt >= ?'); params.push(query.since); }
    const rows = this.db.prepare(
      `SELECT ${HUMAN_INVOLVEMENT} AS hi, ${LEVEL} AS lvl, substr(p.generatedAt, 1, 10) AS day,
              CASE WHEN ${PUBLICLY_LINKED} THEN 1 ELSE 0 END AS pub,
              CASE WHEN ${DISCLOSURE_REQUIRED} THEN 1 ELSE 0 END AS req,
              COUNT(*) AS n
         FROM ai_provenance p
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        GROUP BY hi, lvl, day, pub, req`
    ).all(...params) as Array<{ hi: string | null; lvl: string | null; day: string; pub: number; req: number; n: number }>;
    return rows.map((r) => ({
      // `unstated` rather than null: a record whose document somehow lacks the field says nothing
      // about human involvement, and "nothing" must never be counted as "a human was involved".
      humanInvolvement: r.hi ?? 'unstated',
      level: r.lvl ?? 'unstated',
      day: r.day,
      publiclyLinked: r.pub === 1,
      disclosureRequired: r.req === 1,
      count: r.n,
    }));
  },

  async listAiProvenance(
    this: SqliteStorage, query?: AiProvenanceListQuery,
  ): Promise<{ items: AiProvenanceRecordRow[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (query?.ownerGhii) { where.push('p.ownerGhii = ?'); params.push(query.ownerGhii); }
    if (query?.since) { where.push('p.generatedAt >= ?'); params.push(query.since); }
    if (query?.unlabelledPublicOnly) {
      where.push(PUBLICLY_LINKED);
      where.push(`${HUMAN_INVOLVEMENT} IN ('none', 'light-review')`);
      where.push(`NOT (${DISCLOSURE_REQUIRED})`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM ai_provenance p ${clause}`)
      .get(...params) as { n: number }).n;
    const limit = Math.min(Math.max(query?.limit ?? 50, 1), 500);
    const rows = this.db.prepare(
      `SELECT p.* FROM ai_provenance p ${clause} ORDER BY p.generatedAt DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, Math.max(query?.offset ?? 0, 0)) as Record<string, unknown>[];
    return { items: rows.map(deserialize), total };
  },
};
