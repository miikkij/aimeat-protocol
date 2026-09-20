/**
 * @file src/storage/providers/postgres-kysely/methods/ai-decisions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Postgres+Kysely implementation of the AI decision store (TARGET-080, AIMEAT.decide).
 *   One row per call to the decision model; only `record.review` changes after the write, and rows
 *   age out through deleteAiDecisionsBefore(). Mirrors ../../sqlite/methods/ai-decisions.ts.
 * @structure aiDecisionMethods — createAiDecision · getAiDecision · findCachedAiDecision ·
 *   listAiDecisions · setAiDecisionReview · aiDecisionStats · deleteAiDecisionsBefore
 * @usage merged onto PostgresKyselyStorage.prototype in ../index.ts
 * @version-history
 *   v1.1.0 — 2026-09-20 — Decision rules: the rule, ruleVersion, outcome and keyScope columns, the
 *     list's rule and principal filters, and aiDecisionStats. Schema: 0080_ai_decision_rules.sql.
 *   v1.0.0 — 2026-09-19 — TARGET-080. Initial. Schema: migrations/0079_ai_decisions.sql.
 */
import { sql, type Selectable } from 'kysely';
import type {
  AiDecisionRow, AiDecisionRecord, AiDecisionListQuery, AiDecisionReview,
  AiDecisionStatsQuery, AiDecisionStatsGroup, AiDecisionOutcome, AiDecisionKeyScope,
} from '../../../interface.js';
import type { Kysely } from 'kysely';
import type { AiDecision as AiDecisionTable, DB, Json } from '../db-types.js';

/** The one member these methods read off the provider. Named structurally rather than imported
 *  from ../index.js, so this file does not close an import cycle with the class it is merged into. */
type PostgresKyselyStorage = { db: Kysely<DB> };
import { jsonb } from '../helpers.js';

function toRow(r: Selectable<AiDecisionTable>): AiDecisionRow {
  const record = r.record as unknown as AiDecisionRecord;
  return {
    id: r.id,
    ownerGhii: r.ownerGhii,
    principal: r.principal,
    appId: r.appId ?? null,
    subject: r.subject ?? null,
    cacheKey: r.cacheKey,
    model: r.model,
    createdAt: r.createdAt,
    rule: r.rule ?? null,
    ruleVersion: r.ruleVersion ?? null,
    outcome: (r.outcome as AiDecisionOutcome | null) ?? null,
    // A row written before the column existed carries its scope in the document only.
    keyScope: (r.keyScope as AiDecisionKeyScope | null) ?? record.keyScope ?? 'node',
    record,
  };
}

/** Same bounds on both providers: default 50, at least 1, at most 200. */
function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 50, 1), 200);
}

export const aiDecisionMethods = {
  async createAiDecision(this: PostgresKyselyStorage, row: AiDecisionRow): Promise<void> {
    await this.db.insertInto('AiDecision').values({
      id: row.id,
      ownerGhii: row.ownerGhii,
      principal: row.principal,
      appId: row.appId,
      subject: row.subject,
      cacheKey: row.cacheKey,
      model: row.model,
      createdAt: row.createdAt,
      rule: row.rule,
      ruleVersion: row.ruleVersion,
      outcome: row.outcome,
      keyScope: row.keyScope,
      // jsonb() yields a `<json>::jsonb` SQL fragment; kysely-codegen types the column as the
      // VALUE it reads back, so the fragment needs one narrowing cast on the way in.
      record: jsonb(row.record) as unknown as Json,
    }).execute();
  },

  async getAiDecision(this: PostgresKyselyStorage, id: string): Promise<AiDecisionRow | undefined> {
    const r = await this.db.selectFrom('AiDecision').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toRow(r) : undefined;
  },

  async findCachedAiDecision(
    this: PostgresKyselyStorage, ownerGhii: string, cacheKey: string, since: string,
  ): Promise<AiDecisionRow | undefined> {
    // A cache hit is never the source of another hit: the chain always ends at one real call.
    // `->>` returns SQL NULL for an absent key and for a JSON null alike, matching json_extract.
    const r = await this.db.selectFrom('AiDecision').selectAll()
      .where('ownerGhii', '=', ownerGhii)
      .where('cacheKey', '=', cacheKey)
      .where('createdAt', '>=', since)
      .where(sql<boolean>`"record"->>'cachedFrom' IS NULL`)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .executeTakeFirst();
    return r ? toRow(r) : undefined;
  },

  async listAiDecisions(
    this: PostgresKyselyStorage, query: AiDecisionListQuery,
  ): Promise<{ items: AiDecisionRow[]; total: number }> {
    // One WHERE for the count and the page, so the total describes the rows shown under it. The
    // cursor is applied to the page only: `total` is the size of the whole filtered population.
    let base = this.db.selectFrom('AiDecision').where('ownerGhii', '=', query.ownerGhii);
    if (query.subject !== undefined) base = base.where('subject', '=', query.subject);
    if (query.appId !== undefined) base = base.where('appId', '=', query.appId);
    if (query.rule !== undefined) base = base.where('rule', '=', query.rule);
    if (query.principal !== undefined) base = base.where('principal', '=', query.principal);

    const counted = await base.select(sql<string>`COUNT(*)`.as('n')).executeTakeFirst();
    let page = base.selectAll();
    if (query.before !== undefined) page = page.where('createdAt', '<', query.before);
    const rows = await page
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .limit(clampLimit(query.limit))
      .execute();
    // COUNT() comes back as a bigint string on this driver.
    return { items: rows.map(toRow), total: Number(counted?.n ?? 0) };
  },

  async setAiDecisionReview(
    this: PostgresKyselyStorage, id: string, ownerGhii: string, review: AiDecisionReview,
  ): Promise<boolean> {
    // jsonb_set on the one path: nothing else in the document can change through this door.
    const res = await this.db.updateTable('AiDecision')
      .set({ record: sql<Json>`jsonb_set("record", '{review}', ${jsonb(review)}, true)` })
      .where('id', '=', id)
      .where('ownerGhii', '=', ownerGhii)
      .executeTakeFirst();
    return Number(res.numUpdatedRows) > 0;
  },

  async aiDecisionStats(
    this: PostgresKyselyStorage, query: AiDecisionStatsQuery, groupBy: 'rule' | 'principal',
  ): Promise<AiDecisionStatsGroup[]> {
    let base = this.db.selectFrom('AiDecision').where('ownerGhii', '=', query.ownerGhii);
    if (query.rule !== undefined) base = base.where('rule', '=', query.rule);
    if (query.principal !== undefined) base = base.where('principal', '=', query.principal);
    if (groupBy === 'rule') base = base.where('rule', 'is not', null);
    const rows = await base
      .select([
        sql<string | null>`${sql.ref(groupBy)}`.as('k'),
        sql<string>`COUNT(*)`.as('decisions'),
        sql<string>`COUNT(*) FILTER (WHERE "outcome" = 'act')`.as('act'),
        sql<string>`COUNT(*) FILTER (WHERE "outcome" = 'ask')`.as('ask'),
        sql<string>`COUNT(*) FILTER (WHERE "outcome" = 'stop')`.as('stop'),
        sql<string>`COUNT(*) FILTER (WHERE "record"->'gate'->>'stopped' = 'true')`.as('gateStops'),
        sql<string>`COUNT(*) FILTER (WHERE "record"->'review'->>'outcome' = 'overridden')`.as('overridden'),
        sql<string>`COUNT(*) FILTER (WHERE "record"->'review'->>'outcome' = 'confirmed')`.as('confirmed'),
        sql<string>`COALESCE(SUM(("record"->'usage'->>'costUsd')::double precision), 0)`.as('costUsd'),
        sql<string | null>`MAX("createdAt")`.as('lastAt'),
      ])
      .groupBy(groupBy)
      .execute();
    // COUNT() and SUM() come back as strings on this driver.
    return rows.map(r => ({
      key: r.k ?? '',
      decisions: Number(r.decisions ?? 0),
      outcomes: { act: Number(r.act ?? 0), ask: Number(r.ask ?? 0), stop: Number(r.stop ?? 0) },
      gateStops: Number(r.gateStops ?? 0),
      overridden: Number(r.overridden ?? 0),
      confirmed: Number(r.confirmed ?? 0),
      costUsd: Number(r.costUsd ?? 0),
      lastAt: r.lastAt ?? null,
    }));
  },

  async deleteAiDecisionsBefore(this: PostgresKyselyStorage, before: string): Promise<number> {
    const res = await this.db.deleteFrom('AiDecision').where('createdAt', '<', before).executeTakeFirst();
    return Number(res.numDeletedRows);
  },
};
