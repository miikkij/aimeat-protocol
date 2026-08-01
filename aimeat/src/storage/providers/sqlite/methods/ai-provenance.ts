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
 * @structure aiProvenanceMethods — createAiProvenance · getAiProvenance · findAiProvenanceByHash ·
 *   publiclyLinkedProvenanceIds
 * @usage merged onto SqliteStorage.prototype in ../index.ts
 * @version-history
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 2. Visibility follows the content: the stored flag is
 *     gone and the public test is an EXISTS over the items that point at the record.
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
};
