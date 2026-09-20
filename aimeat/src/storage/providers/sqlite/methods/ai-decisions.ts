/**
 * @file src/storage/providers/sqlite/methods/ai-decisions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite implementation of the AI decision store (TARGET-080, AIMEAT.decide). One row
 *   per call to the decision model; only `record.review` changes after the write, and rows age out
 *   through deleteAiDecisionsBefore(). Mirrors ../../postgres-kysely/methods/ai-decisions.ts.
 * @structure aiDecisionMethods — createAiDecision · getAiDecision · findCachedAiDecision ·
 *   listAiDecisions · setAiDecisionReview · aiDecisionStats · deleteAiDecisionsBefore
 * @usage merged onto SqliteStorage.prototype in ../index.ts
 * @version-history
 *   v1.1.0 — 2026-09-20 — Decision rules: the rule, ruleVersion, outcome and keyScope columns, the
 *     list's rule and principal filters, and aiDecisionStats.
 *   v1.0.0 — 2026-09-19 — TARGET-080. Initial.
 */
import type {
  AiDecisionRow, AiDecisionRecord, AiDecisionListQuery, AiDecisionReview,
  AiDecisionStatsQuery, AiDecisionStatsGroup, AiDecisionOutcome, AiDecisionKeyScope,
} from '../../../interface.js';
import type Database from 'better-sqlite3';

/** The one member these methods read off the provider. Named structurally rather than imported
 *  from ../index.js, so this file does not close an import cycle with the class it is merged into. */
type SqliteStorage = { db: Database.Database };

function deserialize(row: Record<string, unknown>): AiDecisionRow {
  const record = JSON.parse(row.record as string) as AiDecisionRecord;
  return {
    id: row.id as string,
    ownerGhii: row.ownerGhii as string,
    principal: row.principal as string,
    appId: (row.appId as string | null) ?? null,
    subject: (row.subject as string | null) ?? null,
    cacheKey: row.cacheKey as string,
    model: row.model as string,
    createdAt: row.createdAt as string,
    rule: (row.rule as string | null) ?? null,
    ruleVersion: (row.ruleVersion as number | null) ?? null,
    outcome: (row.outcome as AiDecisionOutcome | null) ?? null,
    // A row written before the column existed carries its scope in the document only.
    keyScope: ((row.keyScope as AiDecisionKeyScope | null) ?? record.keyScope ?? 'node'),
    record,
  };
}

/** Same bounds on both providers: default 50, at least 1, at most 200. */
function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 50, 1), 200);
}

export const aiDecisionMethods = {
  async createAiDecision(this: SqliteStorage, row: AiDecisionRow): Promise<void> {
    this.db.prepare(
      `INSERT INTO ai_decisions (id, ownerGhii, principal, appId, subject, cacheKey, model, createdAt,
                                 rule, ruleVersion, outcome, keyScope, record)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      row.id, row.ownerGhii, row.principal, row.appId, row.subject,
      row.cacheKey, row.model, row.createdAt,
      row.rule, row.ruleVersion, row.outcome, row.keyScope,
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
    if (query.rule !== undefined) { where.push('rule = ?'); params.push(query.rule); }
    if (query.principal !== undefined) { where.push('principal = ?'); params.push(query.principal); }
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

  async aiDecisionStats(
    this: SqliteStorage, query: AiDecisionStatsQuery, groupBy: 'rule' | 'principal',
  ): Promise<AiDecisionStatsGroup[]> {
    const where: string[] = ['ownerGhii = ?'];
    const params: unknown[] = [query.ownerGhii];
    if (query.rule !== undefined) { where.push('rule = ?'); params.push(query.rule); }
    if (query.principal !== undefined) { where.push('principal = ?'); params.push(query.principal); }
    if (groupBy === 'rule') where.push('rule IS NOT NULL');
    // groupBy is one of two literals, never caller text, so it is safe in the statement.
    const rows = this.db.prepare(
      `SELECT ${groupBy} AS k,
              COUNT(*) AS decisions,
              SUM(CASE WHEN outcome = 'act' THEN 1 ELSE 0 END) AS act,
              SUM(CASE WHEN outcome = 'ask' THEN 1 ELSE 0 END) AS ask,
              SUM(CASE WHEN outcome = 'stop' THEN 1 ELSE 0 END) AS stop,
              SUM(CASE WHEN json_extract(record, '$.gate.stopped') = 1 THEN 1 ELSE 0 END) AS gateStops,
              SUM(CASE WHEN json_extract(record, '$.review.outcome') = 'overridden' THEN 1 ELSE 0 END) AS overridden,
              SUM(CASE WHEN json_extract(record, '$.review.outcome') = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
              SUM(COALESCE(json_extract(record, '$.usage.costUsd'), 0)) AS costUsd,
              MAX(createdAt) AS lastAt
         FROM ai_decisions WHERE ${where.join(' AND ')} GROUP BY ${groupBy}`
    ).all(...params) as Record<string, unknown>[];
    return rows.map(r => ({
      key: String(r.k ?? ''),
      decisions: Number(r.decisions ?? 0),
      outcomes: { act: Number(r.act ?? 0), ask: Number(r.ask ?? 0), stop: Number(r.stop ?? 0) },
      gateStops: Number(r.gateStops ?? 0),
      overridden: Number(r.overridden ?? 0),
      confirmed: Number(r.confirmed ?? 0),
      costUsd: Number(r.costUsd ?? 0),
      lastAt: (r.lastAt as string | null) ?? null,
    }));
  },

  async deleteAiDecisionsBefore(this: SqliteStorage, before: string): Promise<number> {
    return this.db.prepare('DELETE FROM ai_decisions WHERE createdAt < ?').run(before).changes;
  },
};
