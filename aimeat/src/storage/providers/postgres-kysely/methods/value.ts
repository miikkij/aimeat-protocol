/**
 * @file src/storage/providers/postgres-kysely/methods/value.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Postgres implementation of the value signals (ValueRepository, migration 0135). The
 *   per-record upsert writes the maker on insert only and adds the counts; the daily upsert adds; the
 *   fold turns old day rows into week rows (Monday) and deletes them, in one transaction. BIGINT
 *   counts arrive as strings and are converted here, at the edge.
 * @structure valueMethods · pseudonymiseValueProducerDb
 * @usage Object.assign(PostgresKyselyStorage.prototype, valueMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, phase 1).
 */
import { sql } from 'kysely';
import type { PostgresKyselyStorage } from '../index.js';
import type {
  ValueKeyRow, ValueKeyDelta, ValueDailyDelta, ValueDailyFilter, ValueDailyGroup, ValueDailySum, ValueSignal,
} from '../../../types/value.js';

/** BIGINT arrives as a string; a count is a number everywhere above this layer. */
const n = (v: unknown): number => (typeof v === 'string' ? Number(v) : (v as number) ?? 0);

/** The columns a caller may group by; anything else is refused rather than put into SQL. */
const GROUPABLE: ReadonlySet<ValueDailyGroup> = new Set(['day', 'signal', 'producer', 'family', 'ownerGhii', 'orgId', 'wsId']);

function toKeyRow(r: Record<string, unknown>): ValueKeyRow {
  return {
    ownerGaii: r.ownerGaii as string,
    key: r.key as string,
    producer: r.producer as string,
    producerLevel: (r.producerLevel as string | null) ?? null,
    producedAt: r.producedAt as string,
    revisions: n(r.revisions),
    corrections: n(r.corrections),
    correctionBytes: n(r.correctionBytes),
    lastCorrectedAt: (r.lastCorrectedAt as string | null) ?? null,
    readsByOthers: n(r.readsByOthers),
    lastReadAt: (r.lastReadAt as string | null) ?? null,
    lastBytes: n(r.lastBytes),
  };
}

/** LIKE has its own wildcards; a key holding % or _ must not become a prefix match for more. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, m => `\\${m}`);
}

export const valueMethods = {
  async getValueKeys(this: PostgresKyselyStorage, pairs: Array<{ ownerGaii: string; key: string }>): Promise<ValueKeyRow[]> {
    if (pairs.length === 0) return [];
    const batch = pairs.slice(0, 1000);
    const rows = await this.db.selectFrom('ValueKey').selectAll()
      .where(eb => eb.or(batch.map(p => eb.and([eb('ownerGaii', '=', p.ownerGaii), eb('key', '=', p.key)]))))
      .execute();
    return rows.map(r => toKeyRow(r as unknown as Record<string, unknown>));
  },

  async upsertValueKeys(this: PostgresKyselyStorage, rows: ValueKeyDelta[]): Promise<void> {
    for (const r of rows) {
      await this.db.insertInto('ValueKey')
        .values({
          ownerGaii: r.ownerGaii, key: r.key, producer: r.producer, producerLevel: r.producerLevel,
          producedAt: r.producedAt,
          revisions: String(r.revisions), corrections: String(r.corrections),
          correctionBytes: String(r.correctionBytes), lastCorrectedAt: r.lastCorrectedAt,
          readsByOthers: String(r.readsByOthers), lastReadAt: r.lastReadAt,
          lastBytes: String(r.lastBytes ?? 0),
        })
        .onConflict(oc => oc.columns(['ownerGaii', 'key']).doUpdateSet({
          revisions: eb => sql`${eb.ref('ValueKey.revisions')} + excluded."revisions"`,
          corrections: eb => sql`${eb.ref('ValueKey.corrections')} + excluded."corrections"`,
          correctionBytes: eb => sql`${eb.ref('ValueKey.correctionBytes')} + excluded."correctionBytes"`,
          lastCorrectedAt: eb => sql`greatest(${eb.ref('ValueKey.lastCorrectedAt')}, excluded."lastCorrectedAt")`,
          readsByOthers: eb => sql`${eb.ref('ValueKey.readsByOthers')} + excluded."readsByOthers"`,
          lastReadAt: eb => sql`greatest(${eb.ref('ValueKey.lastReadAt')}, excluded."lastReadAt")`,
          lastBytes: eb => (r.lastBytes === null ? eb.ref('ValueKey.lastBytes') : sql`excluded."lastBytes"`),
        }))
        .execute();
    }
  },

  async deleteValueKeys(this: PostgresKyselyStorage, pairs: Array<{ ownerGaii: string; key: string }>): Promise<void> {
    if (pairs.length === 0) return;
    for (let i = 0; i < pairs.length; i += 500) {
      const batch = pairs.slice(i, i + 500);
      await this.db.deleteFrom('ValueKey')
        .where(eb => eb.or(batch.map(p => eb.and([eb('ownerGaii', '=', p.ownerGaii), eb('key', '=', p.key)]))))
        .execute();
    }
  },

  async listValueKeys(
    this: PostgresKyselyStorage,
    f: { ownerGaii: string; keyPrefix?: string; keys?: string[]; limit?: number },
  ): Promise<ValueKeyRow[]> {
    let q = this.db.selectFrom('ValueKey').selectAll().where('ownerGaii', '=', f.ownerGaii);
    if (f.keys && f.keys.length > 0) q = q.where('key', 'in', f.keys.slice(0, 1000));
    else if (f.keyPrefix) q = q.where('key', 'like', `${escapeLike(f.keyPrefix)}%`);
    const rows = await q.orderBy('producedAt', 'desc').limit(Math.min(f.limit ?? 500, 5000)).execute();
    return rows.map(r => toKeyRow(r as unknown as Record<string, unknown>));
  },

  async upsertValueDaily(this: PostgresKyselyStorage, input: ValueDailyDelta[]): Promise<void> {
    if (input.length === 0) return;
    // One statement may not touch a row twice on PostgreSQL: rows with the same key are added first.
    const merged = new Map<string, ValueDailyDelta>();
    for (const r of input) {
      const id = [r.day, r.ownerGhii, r.orgId, r.wsId, r.producer, r.family, r.signal].join('\u0000');
      const had = merged.get(id);
      if (had) { had.count += r.count; had.bytes += r.bytes; } else merged.set(id, { ...r });
    }
    const rows = [...merged.values()];
    await this.db.insertInto('ValueDaily')
      .values(rows.map(r => ({
        day: r.day, grain: 'day', ownerGhii: r.ownerGhii, orgId: r.orgId, wsId: r.wsId,
        producer: r.producer, family: r.family, signal: r.signal,
        count: String(r.count), bytes: String(r.bytes),
      })))
      .onConflict(oc => oc.columns(['day', 'grain', 'ownerGhii', 'orgId', 'wsId', 'producer', 'family', 'signal']).doUpdateSet({
        count: eb => sql`${eb.ref('ValueDaily.count')} + excluded."count"`,
        bytes: eb => sql`${eb.ref('ValueDaily.bytes')} + excluded."bytes"`,
      }))
      .execute();
  },

  async sumValueDaily(this: PostgresKyselyStorage, f: ValueDailyFilter, groupBy: ValueDailyGroup[]): Promise<ValueDailySum[]> {
    const cols = groupBy.filter(g => GROUPABLE.has(g));
    const conds = [];
    if (f.ownerGhii) conds.push(sql`"ownerGhii" = ${f.ownerGhii}`);
    if (f.orgId) conds.push(sql`"orgId" = ${f.orgId}`);
    if (f.wsId) conds.push(sql`"wsId" = ${f.wsId}`);
    if (f.producer) conds.push(sql`"producer" = ${f.producer}`);
    if (f.from) conds.push(sql`"day" >= ${f.from}`);
    if (f.to) conds.push(sql`"day" <= ${f.to}`);
    const colList = cols.map(c => sql.ref(c));
    const select = sql.join([
      ...colList,
      sql`SUM("count")::bigint AS "count"`, sql`SUM("bytes")::bigint AS "bytes"`,
      sql`COUNT(DISTINCT "ownerGhii")::bigint AS "owners"`,
    ]);
    const where = conds.length ? sql` WHERE ${sql.join(conds, sql` AND `)}` : sql``;
    const group = cols.length ? sql` GROUP BY ${sql.join(colList)} ORDER BY ${sql.join(colList)}` : sql``;
    const res = await sql<Record<string, unknown>>`SELECT ${select} FROM "ValueDaily"${where}${group}`.execute(this.db);
    return res.rows.map(r => ({
      ...(r.day !== undefined ? { day: r.day as string } : {}),
      ...(r.signal !== undefined ? { signal: r.signal as ValueSignal } : {}),
      ...(r.producer !== undefined ? { producer: r.producer as string } : {}),
      ...(r.family !== undefined ? { family: r.family as string } : {}),
      ...(r.ownerGhii !== undefined ? { ownerGhii: r.ownerGhii as string } : {}),
      ...(r.orgId !== undefined ? { orgId: r.orgId as string } : {}),
      ...(r.wsId !== undefined ? { wsId: r.wsId as string } : {}),
      count: n(r.count), bytes: n(r.bytes), owners: n(r.owners),
    }));
  },

  async foldValueDaily(this: PostgresKyselyStorage, beforeDay: string): Promise<number> {
    return this.db.transaction().execute(async trx => {
      await sql`
        INSERT INTO "ValueDaily" ("day", "grain", "ownerGhii", "orgId", "wsId", "producer", "family", "signal", "count", "bytes")
        SELECT to_char(date_trunc('week', "day"::date), 'YYYY-MM-DD'), 'week', "ownerGhii", "orgId", "wsId",
               "producer", "family", "signal", SUM("count"), SUM("bytes")
        FROM "ValueDaily" WHERE "grain" = 'day' AND "day" < ${beforeDay}
        GROUP BY 1, "ownerGhii", "orgId", "wsId", "producer", "family", "signal"
        ON CONFLICT ("day", "grain", "ownerGhii", "orgId", "wsId", "producer", "family", "signal") DO UPDATE SET
          "count" = "ValueDaily"."count" + excluded."count",
          "bytes" = "ValueDaily"."bytes" + excluded."bytes"
      `.execute(trx);
      const res = await trx.deleteFrom('ValueDaily').where('grain', '=', 'day').where('day', '<', beforeDay).executeTakeFirst();
      return Number(res?.numDeletedRows ?? 0);
    });
  },
};

/**
 * The erased person's agents as the maker of another person's records keep their counts under the
 * erasure's pseudonym: the counts are the other person's record. A free function so the owner
 * cascade runs it inside its own transaction, as it does pseudonymiseTallyWriterDb.
 */
export async function pseudonymiseValueProducerDb(
  db: PostgresKyselyStorage['db'], ownerGhii: string, marker: string,
): Promise<number> {
  const asAgent = `%#${ownerGhii}`;
  const keys = await db.updateTable('ValueKey')
    .set({ producer: marker })
    .where('ownerGaii', '!=', ownerGhii)
    .where('ownerGaii', 'not like', asAgent)
    .where(eb => eb.or([eb('producer', '=', ownerGhii), eb('producer', 'like', asAgent)]))
    .executeTakeFirst();
  // A day row may already exist under the marker; fold into it rather than collide on the key.
  const daily = await sql`
    WITH moved AS (
      DELETE FROM "ValueDaily"
      WHERE "ownerGhii" <> ${ownerGhii} AND ("producer" = ${ownerGhii} OR "producer" LIKE ${asAgent})
      RETURNING "day", "grain", "ownerGhii", "orgId", "wsId", "family", "signal", "count", "bytes"
    )
    INSERT INTO "ValueDaily" ("day", "grain", "ownerGhii", "orgId", "wsId", "producer", "family", "signal", "count", "bytes")
    SELECT "day", "grain", "ownerGhii", "orgId", "wsId", ${marker}, "family", "signal", SUM("count"), SUM("bytes")
    FROM moved GROUP BY "day", "grain", "ownerGhii", "orgId", "wsId", "family", "signal"
    ON CONFLICT ("day", "grain", "ownerGhii", "orgId", "wsId", "producer", "family", "signal") DO UPDATE SET
      "count" = "ValueDaily"."count" + excluded."count",
      "bytes" = "ValueDaily"."bytes" + excluded."bytes"
  `.execute(db);
  return Number(keys?.numUpdatedRows ?? 0) + Number(daily.numAffectedRows ?? 0);
}
