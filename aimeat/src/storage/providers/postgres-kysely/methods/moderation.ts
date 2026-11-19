/**
 * @file src/storage/providers/postgres-kysely/methods/moderation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Moderation domain for the Postgres+Kysely backend: content flags, appeals, and profile
 *   matches. Translated 1:1 from the Prisma implementation (providers/mongodb/methods/governance.ts)
 *   against the same tables. Covers flag CRUD + per-target summary aggregation, the appeal ledger, and
 *   the match lifecycle (create/get/list/update + expiry cleanup + per-profile cleanup).
 * @version-history
 *   v1.1.0 — 2026-11-19 — eraseModerationParty: an account erasure removes the flags on the person's
 *     content with their appeals and the person's appeals, and renames their reviews.
 *   v1.0.0 — 2026-07-15 — Phase 5: moderation (flags/appeals/matches) on Postgres+Kysely.
 */
import { sql, type Selectable } from 'kysely';
import { moderationTargets } from '../../../erased-logs.js';
import type { AppealRecord, FlagRecord, FlagSummary } from '../../../interface.js';
import type { Appeal, Flag } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();
const isoU = (t: Date | string | null | undefined): string | undefined => (t == null ? undefined : iso(t));

function toFlag(r: Selectable<Flag>): FlagRecord {
  return {
    id: r.id, targetType: r.targetType as FlagRecord['targetType'], targetId: r.targetId, flaggedBy: r.flaggedBy,
    reason: r.reason as FlagRecord['reason'], description: r.description ?? undefined, status: r.status as FlagRecord['status'],
    reviewedBy: r.reviewedBy ?? undefined, reviewedAt: isoU(r.reviewedAt), createdAt: iso(r.createdAt),
  };
}
function toAppeal(r: Selectable<Appeal>): AppealRecord {
  return {
    id: r.id, flagId: r.flagId, appealedBy: r.appealedBy, reason: r.reason, status: r.status as AppealRecord['status'],
    reviewedBy: r.reviewedBy ?? undefined, reviewNote: r.reviewNote ?? undefined, createdAt: iso(r.createdAt), reviewedAt: isoU(r.reviewedAt),
  };
}

export const moderationMethods = {
  // ── Flags ──
  async createFlag(this: PostgresKyselyStorage, r: FlagRecord): Promise<FlagRecord> {
    await this.db.insertInto('Flag').values({
      id: r.id, targetType: r.targetType, targetId: r.targetId, flaggedBy: r.flaggedBy, reason: r.reason,
      description: r.description ?? null, status: r.status, createdAt: new Date(r.createdAt),
    }).execute();
    return r;
  },
  async getFlag(this: PostgresKyselyStorage, id: string): Promise<FlagRecord | null> {
    const r = await this.db.selectFrom('Flag').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toFlag(r) : null;
  },
  async getFlagsByTarget(this: PostgresKyselyStorage, targetType: string, targetId: string): Promise<FlagRecord[]> {
    const rows = await this.db.selectFrom('Flag').selectAll().where('targetType', '=', targetType).where('targetId', '=', targetId).execute();
    return rows.map(toFlag);
  },
  async getFlagByUser(this: PostgresKyselyStorage, targetType: string, targetId: string, flaggedBy: string): Promise<FlagRecord | null> {
    const r = await this.db.selectFrom('Flag').selectAll().where('targetType', '=', targetType).where('targetId', '=', targetId).where('flaggedBy', '=', flaggedBy).executeTakeFirst();
    return r ? toFlag(r) : null;
  },
  async getFlagSummary(this: PostgresKyselyStorage, targetType: string, targetId: string): Promise<FlagSummary | null> {
    const matching = await this.db.selectFrom('Flag').selectAll().where('targetType', '=', targetType).where('targetId', '=', targetId).execute();
    if (matching.length === 0) return null;
    const byReason: Record<string, number> = {};
    let latestFlag = '';
    for (const f of matching) {
      byReason[f.reason] = (byReason[f.reason] ?? 0) + 1;
      const ts = iso(f.createdAt);
      if (ts > latestFlag) latestFlag = ts;
    }
    return { targetType, targetId, totalFlags: matching.length, byReason, latestFlag };
  },
  async updateFlag(this: PostgresKyselyStorage, id: string, updates: Partial<FlagRecord>): Promise<FlagRecord | null> {
    const data: Record<string, unknown> = {};
    if (updates.status) data.status = updates.status;
    if (updates.reviewedBy) data.reviewedBy = updates.reviewedBy;
    if (updates.reviewedAt) data.reviewedAt = new Date(updates.reviewedAt);
    if (Object.keys(data).length === 0) return this.getFlag(id);
    const rows = await this.db.updateTable('Flag').set(data as never).where('id', '=', id).returningAll().execute();
    return rows[0] ? toFlag(rows[0]) : null;
  },
  async listFlags(this: PostgresKyselyStorage, opts?: { status?: string; targetType?: string; page?: number; perPage?: number }): Promise<FlagRecord[]> {
    const page = opts?.page ?? 1, perPage = opts?.perPage ?? 20;
    let q = this.db.selectFrom('Flag').selectAll();
    if (opts?.status) q = q.where('status', '=', opts.status);
    if (opts?.targetType) q = q.where('targetType', '=', opts.targetType);
    const rows = await q.orderBy('createdAt', 'desc').limit(perPage).offset((page - 1) * perPage).execute();
    return rows.map(toFlag);
  },

  // ── Appeals ──
  async createAppeal(this: PostgresKyselyStorage, r: AppealRecord): Promise<AppealRecord> {
    await this.db.insertInto('Appeal').values({
      id: r.id, flagId: r.flagId, appealedBy: r.appealedBy, reason: r.reason, status: r.status, createdAt: new Date(r.createdAt),
    }).execute();
    return r;
  },
  async getAppeal(this: PostgresKyselyStorage, id: string): Promise<AppealRecord | null> {
    const r = await this.db.selectFrom('Appeal').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toAppeal(r) : null;
  },
  async getAppealByFlagId(this: PostgresKyselyStorage, flagId: string): Promise<AppealRecord | null> {
    const r = await this.db.selectFrom('Appeal').selectAll().where('flagId', '=', flagId).executeTakeFirst();
    return r ? toAppeal(r) : null;
  },
  async listAppeals(this: PostgresKyselyStorage, opts?: { status?: string; page?: number; perPage?: number }): Promise<AppealRecord[]> {
    const page = opts?.page ?? 1, perPage = opts?.perPage ?? 20;
    let q = this.db.selectFrom('Appeal').selectAll();
    if (opts?.status) q = q.where('status', '=', opts.status);
    const rows = await q.orderBy('createdAt', 'desc').limit(perPage).offset((page - 1) * perPage).execute();
    return rows.map(toAppeal);
  },
  async updateAppeal(this: PostgresKyselyStorage, id: string, updates: Partial<AppealRecord>): Promise<AppealRecord | null> {
    const data: Record<string, unknown> = {};
    if (updates.status) data.status = updates.status;
    if (updates.reviewedBy) data.reviewedBy = updates.reviewedBy;
    if (updates.reviewNote) data.reviewNote = updates.reviewNote;
    if (updates.reviewedAt) data.reviewedAt = new Date(updates.reviewedAt);
    if (Object.keys(data).length === 0) return this.getAppeal(id);
    const rows = await this.db.updateTable('Appeal').set(data as never).where('id', '=', id).returningAll().execute();
    return rows[0] ? toAppeal(rows[0]) : null;
  },

  // An account erasure (../../../erased-logs.ts says what each step is for). The twin is
  // sqlite/methods/moderation.ts eraseModerationParty.
  async eraseModerationParty(this: PostgresKyselyStorage, identities: string[], pseudonym: string): Promise<{ flagsRemoved: number; appealsRemoved: number; reviewsRenamed: number }> {
    const { exact, prefixes } = moderationTargets(identities);
    let flagsRemoved = 0, appealsRemoved = 0, reviewsRenamed = 0;
    const flagIds = new Set<string>();
    if (exact.length) {
      for (const r of await this.db.selectFrom('Flag').select('id').where('targetId', 'in', exact).execute()) flagIds.add(r.id);
    }
    for (const p of prefixes) {
      for (const r of await sql<{ id: string }>`SELECT id FROM "Flag" WHERE "targetId" LIKE ${p} ESCAPE '\\'`.execute(this.db).then(x => x.rows)) flagIds.add(r.id);
    }
    if (flagIds.size) {
      const ids = [...flagIds];
      appealsRemoved += Number((await this.db.deleteFrom('Appeal').where('flagId', 'in', ids).executeTakeFirst()).numDeletedRows ?? 0);
      flagsRemoved += Number((await this.db.deleteFrom('Flag').where('id', 'in', ids).executeTakeFirst()).numDeletedRows ?? 0);
    }
    if (identities.length) {
      appealsRemoved += Number((await this.db.deleteFrom('Appeal').where('appealedBy', 'in', identities).executeTakeFirst()).numDeletedRows ?? 0);
      reviewsRenamed += Number((await this.db.updateTable('Appeal').set({ reviewedBy: pseudonym }).where('reviewedBy', 'in', identities).executeTakeFirst()).numUpdatedRows ?? 0);
      reviewsRenamed += Number((await this.db.updateTable('Flag').set({ reviewedBy: pseudonym }).where('reviewedBy', 'in', identities).executeTakeFirst()).numUpdatedRows ?? 0);
    }
    return { flagsRemoved, appealsRemoved, reviewsRenamed };
  },
};
