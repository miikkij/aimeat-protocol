/**
 * @file src/storage/providers/sqlite/methods/ai-decisions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite implementation of the AI decision store (TARGET-080, AIMEAT.decide). One row
 *   per call to the decision model; only `record.review` changes after the write, and rows age out
 *   through deleteAiDecisionsBefore(). Mirrors ../../postgres-kysely/methods/ai-decisions.ts.
 * @structure aiDecisionMethods — createAiDecision · getAiDecision · findCachedAiDecision ·
 *   listAiDecisions · setAiDecisionReview · deleteAiDecisionsBefore
 * @usage merged onto SqliteStorage.prototype in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-09-19 — TARGET-080. Initial.
 */
import type {
  AiDecisionRow, AiDecisionRecord, AiDecisionListQuery, AiDecisionReview,
} from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

function deserialize(row: Record<string, unknown>): AiDecisionRow {
  return {
    id: row.id as string,
    ownerGhii: row.ownerGhii as string,
    principal: row.principal as string,
    appId: (row.appId as string | null) ?? null,
    subject: (row.subject as string | null) ?? null,
    cacheKey: row.cacheKey as string,
    model: row.model as string,
    createdAt: row.createdAt as string,
    record: JSON.parse(row.record as string) as AiDecisionRecord,
  };
}

/** Same bounds on both providers: default 50, at least 1, at most 200. */
function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 50, 1), 200);
}

export const aiDecisionMethods = {
  async createAiDecision(this: SqliteStorage, row: AiDecisionRow): Promise<void> {
    this.db.prepare(
      `INSERT INTO ai_decisions (id, ownerGhii, principal, appId, subject, cacheKey, model, createdAt, record)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      row.id, row.ownerGhii, row.principal, row.appId, row.subject,
      row.cacheKey, row.model, row.createdAt,
      JSON.stringify(row.record),
    );
  },

  async getAiDecision(this: SqliteStorage, id: string): Promise<AiDecisionRow | undefined> {
    const row = this.db.prepare('SELECT * FROM ai_decisions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? deserialize(row) : undefined;
  },

  async findCachedAiDecision(
    this: SqliteStorage, ownerGhii: string, cacheKey: string, since: string,
  ): Promise<AiDecisionRow | undefined> {
    // A cache hit is never the source of another hit: the chain always ends at one real call.
    const row = this.db.prepare(
      `SELECT * FROM ai_decisions
        WHERE ownerGhii = ? AND cacheKey = ? AND createdAt >= ?
          AND json_extract(record, '$.cachedFrom') IS NULL
        ORDER BY createdAt DESC LIMIT 1`
    ).get(ownerGhii, cacheKey, since) as Record<string, unknown> | undefined;
    return row ? deserialize(row) : undefined;
  },

  async listAiDecisions(
    this: SqliteStorage, query: AiDecisionListQuery,
  ): Promise<{ items: AiDecisionRow[]; total: number }> {
    // One WHERE for the count and the page, so the total describes the rows shown under it. The
    // cursor is applied to the page only: `total` is the size of the whole filtered population.
    const where: string[] = ['ownerGhii = ?'];
    const params: unknown[] = [query.ownerGhii];
    if (query.subject !== undefined) { where.push('subject = ?'); params.push(query.subject); }
    if (query.appId !== undefined) { where.push('appId = ?'); params.push(query.appId); }
    const clause = where.join(' AND ');
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM ai_decisions WHERE ${clause}`)
      .get(...params) as { n: number }).n;
    const pageWhere = query.before !== undefined ? `${clause} AND createdAt < ?` : clause;
    const pageParams = query.before !== undefined ? [...params, query.before] : params;
    const rows = this.db.prepare(
      `SELECT * FROM ai_decisions WHERE ${pageWhere} ORDER BY createdAt DESC, id DESC LIMIT ?`
    ).all(...pageParams, clampLimit(query.limit)) as Record<string, unknown>[];
    return { items: rows.map(deserialize), total };
  },

  async setAiDecisionReview(
    this: SqliteStorage, id: string, ownerGhii: string, review: AiDecisionReview,
  ): Promise<boolean> {
    // json_set on the one path: nothing else in the document can change through this door.
    const res = this.db.prepare(
      `UPDATE ai_decisions SET record = json_set(record, '$.review', json(?))
        WHERE id = ? AND ownerGhii = ?`
    ).run(JSON.stringify(review), id, ownerGhii);
    return res.changes > 0;
  },

  async deleteAiDecisionsBefore(this: SqliteStorage, before: string): Promise<number> {
    return this.db.prepare('DELETE FROM ai_decisions WHERE createdAt < ?').run(before).changes;
  },
};
