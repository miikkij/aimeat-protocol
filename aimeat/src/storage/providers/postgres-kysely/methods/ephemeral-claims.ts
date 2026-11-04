/**
 * @file src/storage/providers/postgres-kysely/methods/ephemeral-claims.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description EphemeralClaimRepository on PostgreSQL (table "EphemeralClaim", migration 0126). Every
 *   write is one statement: a take is DELETE … RETURNING, a spend and a counter change are INSERT …
 *   ON CONFLICT DO UPDATE … RETURNING, so two processes that reach one row at the same moment get one
 *   answer each, in order. Times are epoch milliseconds from the caller (repository contract); BIGINT
 *   arrives as a string and is converted here.
 * @structure ephemeralClaimMethods
 * @usage Object.assign(PostgresKyselyStorage.prototype, ephemeralClaimMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, high-availability stage 2).
 */
import { sql } from 'kysely';
import type { PostgresKyselyStorage } from '../index.js';
import type { EphemeralClaimRow, EphemeralCount } from '../../../repositories/ephemeral-claim.repository.js';

/** BIGINT arrives as a string. */
const n = (v: unknown): number => (typeof v === 'string' ? Number(v) : Number(v ?? 0));

export const ephemeralClaimMethods = {
  async putEphemeralClaim(this: PostgresKyselyStorage, kind: string, id: string, payload: string, expiresAt: number): Promise<void> {
    await this.db.insertInto('EphemeralClaim')
      .values({ kind, id, payload, count: '0', expiresAt: String(expiresAt) })
      .onConflict(oc => oc.columns(['kind', 'id']).doUpdateSet({
        payload: () => sql`excluded."payload"`,
        count: '0',
        expiresAt: () => sql`excluded."expiresAt"`,
      }))
      .execute();
  },

  async getEphemeralClaim(this: PostgresKyselyStorage, kind: string, id: string): Promise<EphemeralClaimRow | null> {
    const row = await this.db.selectFrom('EphemeralClaim').select(['payload', 'expiresAt'])
      .where('kind', '=', kind).where('id', '=', id).executeTakeFirst();
    return row ? { payload: row.payload, expiresAt: n(row.expiresAt) } : null;
  },

  async takeEphemeralClaim(this: PostgresKyselyStorage, kind: string, id: string): Promise<EphemeralClaimRow | null> {
    const row = await this.db.deleteFrom('EphemeralClaim')
      .where('kind', '=', kind).where('id', '=', id)
      .returning(['payload', 'expiresAt']).executeTakeFirst();
    return row ? { payload: row.payload, expiresAt: n(row.expiresAt) } : null;
  },

  async deleteEphemeralClaim(this: PostgresKyselyStorage, kind: string, id: string): Promise<boolean> {
    const r = await this.db.deleteFrom('EphemeralClaim').where('kind', '=', kind).where('id', '=', id).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  async spendEphemeralClaim(this: PostgresKyselyStorage, kind: string, id: string, expiresAt: number, now: number): Promise<boolean> {
    const row = await this.db.insertInto('EphemeralClaim')
      .values({ kind, id, payload: '', count: '0', expiresAt: String(expiresAt) })
      .onConflict(oc => oc.columns(['kind', 'id'])
        .doUpdateSet({ payload: '', count: '0', expiresAt: () => sql`excluded."expiresAt"` })
        .where(sql<boolean>`"EphemeralClaim"."expiresAt" <= ${String(now)}::bigint`))
      .returning('id')
      .executeTakeFirst();
    return row !== undefined;
  },

  async countEphemeralClaims(this: PostgresKyselyStorage, kind: string, now: number): Promise<number> {
    const row = await this.db.selectFrom('EphemeralClaim')
      .select(eb => eb.fn.countAll<string>().as('n'))
      .where('kind', '=', kind).where('expiresAt', '>', String(now))
      .executeTakeFirst();
    return n(row?.n);
  },

  async bumpEphemeralCounter(this: PostgresKyselyStorage, kind: string, id: string, opts: {
    now: number; windowMs: number; staleBefore: number; sliding: boolean;
  }): Promise<EphemeralCount> {
    const end = String(opts.now + opts.windowMs);
    const stale = sql<boolean>`"EphemeralClaim"."expiresAt" < ${String(opts.staleBefore)}::bigint`;
    // Every expression in SET reads the row as it was before this statement.
    const row = await this.db.insertInto('EphemeralClaim')
      .values({ kind, id, payload: '', count: '1', expiresAt: end })
      .onConflict(oc => oc.columns(['kind', 'id']).doUpdateSet({
        count: () => sql`CASE WHEN ${stale} THEN 1 ELSE "EphemeralClaim"."count" + 1 END`,
        expiresAt: () => opts.sliding
          ? sql`${end}::bigint`
          : sql`CASE WHEN ${stale} THEN ${end}::bigint ELSE "EphemeralClaim"."expiresAt" END`,
      }))
      .returning(['count', 'expiresAt'])
      .executeTakeFirstOrThrow();
    return { count: n(row.count), expiresAt: n(row.expiresAt) };
  },

  async readEphemeralCounter(this: PostgresKyselyStorage, kind: string, id: string): Promise<EphemeralCount | null> {
    const row = await this.db.selectFrom('EphemeralClaim').select(['count', 'expiresAt'])
      .where('kind', '=', kind).where('id', '=', id).executeTakeFirst();
    return row ? { count: n(row.count), expiresAt: n(row.expiresAt) } : null;
  },

  async sweepEphemeralClaims(this: PostgresKyselyStorage, now: number): Promise<number> {
    const r = await this.db.deleteFrom('EphemeralClaim').where('expiresAt', '<', String(now)).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
};
