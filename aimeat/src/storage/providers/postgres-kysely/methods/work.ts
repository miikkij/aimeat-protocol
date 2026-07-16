/**
 * @file src/storage/providers/postgres-kysely/methods/work.ts
 * @description Work (task escrow) domain for the Postgres+Kysely backend (Work table). Backs the work
 *   inbox/sent + the owner delete/usage cascades. Translated 1:1 from the Prisma implementation; the
 *   flat cost columns fold back into the nested `cost` object. Replaces the listWorkBy* placeholders.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: work domain on Postgres+Kysely.
 */
import { sql } from 'kysely';
import type { Selectable } from 'kysely';
import type { WorkRecord } from '../../../interface.js';
import type { Work } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();

function toWork(r: Selectable<Work>): WorkRecord {
  return {
    trackingCode: r.trackingCode, status: r.status, actionId: r.actionId, providerGaii: r.providerGaii, requesterGaii: r.requesterGaii,
    input: r.input as Record<string, unknown>, output: (r.output ?? undefined) as Record<string, unknown> | undefined,
    cost: { basePrice: r.costBasePrice, networkFee: r.costNetworkFee, total: r.costTotal, inEscrow: r.costInEscrow },
    ttlExpiresAt: iso(r.ttlExpiresAt), callbackUrl: r.callbackUrl ?? undefined,
    rating: r.ratingScore != null ? { score: r.ratingScore, comment: r.ratingComment ?? undefined } : undefined,
    createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt),
  };
}

export const workMethods = {
  async createWork(this: PostgresKyselyStorage, w: WorkRecord): Promise<WorkRecord> {
    const [row] = await this.db.insertInto('Work').values({
      trackingCode: w.trackingCode, status: w.status, actionId: w.actionId, providerGaii: w.providerGaii, requesterGaii: w.requesterGaii,
      input: jsonb(w.input), costBasePrice: w.cost.basePrice, costNetworkFee: w.cost.networkFee, costTotal: w.cost.total, costInEscrow: w.cost.inEscrow,
      ttlExpiresAt: new Date(w.ttlExpiresAt), callbackUrl: w.callbackUrl ?? null, createdAt: new Date(w.createdAt), updatedAt: new Date(w.updatedAt),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).returningAll().execute();
    return toWork(row);
  },
  async getWork(this: PostgresKyselyStorage, trackingCode: string): Promise<WorkRecord | null> {
    const r = await this.db.selectFrom('Work').selectAll().where('trackingCode', '=', trackingCode).executeTakeFirst();
    return r ? toWork(r) : null;
  },
  async updateWork(this: PostgresKyselyStorage, trackingCode: string, updates: Partial<WorkRecord>): Promise<WorkRecord | null> {
    const data: Record<string, unknown> = {};
    if (updates.status) data.status = updates.status;
    if (updates.output) data.output = jsonb(updates.output);
    if (updates.updatedAt) data.updatedAt = new Date(updates.updatedAt);
    if (updates.rating) { data.ratingScore = updates.rating.score; data.ratingComment = updates.rating.comment ?? null; }
    if (Object.keys(data).length === 0) return this.getWork(trackingCode);
    const rows = await this.db.updateTable('Work').set(data as never).where('trackingCode', '=', trackingCode).returningAll().execute();
    return rows[0] ? toWork(rows[0]) : null;
  },
  async listWorkByProvider(this: PostgresKyselyStorage, gaii: string): Promise<WorkRecord[]> {
    return (await this.db.selectFrom('Work').selectAll().where('providerGaii', '=', gaii).execute()).map(toWork);
  },
  async listWorkByRequester(this: PostgresKyselyStorage, gaii: string): Promise<WorkRecord[]> {
    return (await this.db.selectFrom('Work').selectAll().where('requesterGaii', '=', gaii).execute()).map(toWork);
  },
  async countPendingWorkByProviders(this: PostgresKyselyStorage, providerGaiis: string[], statuses: string[]): Promise<number> {
    if (providerGaiis.length === 0 || statuses.length === 0) return 0;
    const r = await this.db.selectFrom('Work').select(sql<number>`count(*)`.as('n'))
      .where('providerGaii', 'in', providerGaiis).where('status', 'in', statuses).executeTakeFirst();
    return Number(r?.n ?? 0);
  },
  async listAllWork(this: PostgresKyselyStorage, limit = 10000): Promise<WorkRecord[]> {
    return (await this.db.selectFrom('Work').selectAll().orderBy('createdAt', 'desc').limit(Math.min(limit, 10000)).execute()).map(toWork);
  },
};
