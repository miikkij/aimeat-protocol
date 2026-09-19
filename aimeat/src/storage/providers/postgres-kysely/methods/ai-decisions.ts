/**
 * @file src/storage/providers/postgres-kysely/methods/ai-decisions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Postgres+Kysely implementation of the AI decision store (TARGET-080, AIMEAT.decide).
 *   One row per call to the decision model; only `record.review` changes after the write, and rows
 *   age out through deleteAiDecisionsBefore(). Mirrors ../../sqlite/methods/ai-decisions.ts.
 * @structure aiDecisionMethods — createAiDecision · getAiDecision · findCachedAiDecision ·
 *   listAiDecisions · setAiDecisionReview · deleteAiDecisionsBefore
 * @usage merged onto PostgresKyselyStorage.prototype in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-09-19 — TARGET-080. Initial. Schema: migrations/0079_ai_decisions.sql.
 */
import { sql, type Selectable } from 'kysely';
import type {
  AiDecisionRow, AiDecisionRecord, AiDecisionListQuery, AiDecisionReview,
} from '../../../interface.js';
import type { AiDecision as AiDecisionTable, Json } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

function toRow(r: Selectable<AiDecisionTable>): AiDecisionRow {
  return {
    id: r.id,
    ownerGhii: r.ownerGhii,
    principal: r.principal,
    appId: r.appId ?? null,
    subject: r.subject ?? null,
    cacheKey: r.cacheKey,
    model: r.model,
    createdAt: r.createdAt,
    record: r.record as unknown as AiDecisionRecord,
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

  async deleteAiDecisionsBefore(this: PostgresKyselyStorage, before: string): Promise<number> {
    const res = await this.db.deleteFrom('AiDecision').where('createdAt', '<', before).executeTakeFirst();
    return Number(res.numDeletedRows);
  },
};
