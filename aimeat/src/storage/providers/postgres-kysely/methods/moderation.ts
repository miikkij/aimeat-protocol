/**
 * @file src/storage/providers/postgres-kysely/methods/moderation.ts
 * @description Moderation domain for the Postgres+Kysely backend: content flags, appeals, and profile
 *   matches. Translated 1:1 from the Prisma implementation (providers/mongodb/methods/governance.ts)
 *   against the same tables. Covers flag CRUD + per-target summary aggregation, the appeal ledger, and
 *   the match lifecycle (create/get/list/update + expiry cleanup + per-profile cleanup).
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: moderation (flags/appeals/matches) on Postgres+Kysely.
 */
import type { Selectable } from 'kysely';
import type { AppealRecord, FlagRecord, FlagSummary, MatchRecord } from '../../../interface.js';
import type { Appeal, Flag, Match } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();
const isoU = (t: Date | string | null | undefined): string | undefined => (t == null ? undefined : iso(t));
const isoN = (t: Date | string | null | undefined): string | null => (t == null ? null : iso(t));

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
function toMatch(r: Selectable<Match>): MatchRecord {
  return {
    id: r.id, profileA: r.profileA, profileB: r.profileB, score: r.score,
    breakdown: r.breakdown as unknown as MatchRecord['breakdown'], status: r.status as MatchRecord['status'],
    notifiedAt: isoN(r.notifiedAt), respondedAt: isoN(r.respondedAt), expiresAt: iso(r.expiresAt), createdAt: iso(r.createdAt),
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

  // ── Matches ──
  async createMatch(this: PostgresKyselyStorage, r: MatchRecord): Promise<MatchRecord> {
    await this.db.insertInto('Match').values({
      id: r.id, profileA: r.profileA, profileB: r.profileB, score: r.score, breakdown: jsonb(r.breakdown), status: r.status,
      notifiedAt: r.notifiedAt ? new Date(r.notifiedAt) : null, respondedAt: r.respondedAt ? new Date(r.respondedAt) : null,
      expiresAt: new Date(r.expiresAt), createdAt: new Date(r.createdAt),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return r;
  },
  async getMatch(this: PostgresKyselyStorage, id: string): Promise<MatchRecord | null> {
    const r = await this.db.selectFrom('Match').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toMatch(r) : null;
  },
  async getMatchByPair(this: PostgresKyselyStorage, profileA: string, profileB: string): Promise<MatchRecord | null> {
    const r = await this.db.selectFrom('Match').selectAll().where(eb => eb.or([
      eb.and([eb('profileA', '=', profileA), eb('profileB', '=', profileB)]),
      eb.and([eb('profileA', '=', profileB), eb('profileB', '=', profileA)]),
    ])).executeTakeFirst();
    return r ? toMatch(r) : null;
  },
  async listMatchesByProfile(this: PostgresKyselyStorage, profile: string, opts?: { status?: string; page?: number; perPage?: number }): Promise<MatchRecord[]> {
    const page = opts?.page ?? 1, perPage = opts?.perPage ?? 10;
    let q = this.db.selectFrom('Match').selectAll().where(eb => eb.or([eb('profileA', '=', profile), eb('profileB', '=', profile)]));
    if (opts?.status) q = q.where('status', '=', opts.status);
    const rows = await q.orderBy('createdAt', 'desc').limit(perPage).offset((page - 1) * perPage).execute();
    return rows.map(toMatch);
  },
  async updateMatch(this: PostgresKyselyStorage, id: string, updates: Partial<MatchRecord>): Promise<MatchRecord | null> {
    const data: Record<string, unknown> = {};
    if (updates.status) data.status = updates.status;
    if (updates.notifiedAt) data.notifiedAt = new Date(updates.notifiedAt);
    if (updates.respondedAt) data.respondedAt = new Date(updates.respondedAt);
    if (Object.keys(data).length === 0) return this.getMatch(id);
    const rows = await this.db.updateTable('Match').set(data as never).where('id', '=', id).returningAll().execute();
    return rows[0] ? toMatch(rows[0]) : null;
  },
  async deleteExpiredMatches(this: PostgresKyselyStorage): Promise<number> {
    const r = await this.db.deleteFrom('Match').where('expiresAt', '<', new Date()).where('status', '!=', 'accepted').executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
  async deleteMatchesByProfile(this: PostgresKyselyStorage, profile: string): Promise<number> {
    const r = await this.db.deleteFrom('Match').where(eb => eb.or([eb('profileA', '=', profile), eb('profileB', '=', profile)])).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
  async listAllMatches(this: PostgresKyselyStorage, limit = 10000): Promise<MatchRecord[]> {
    const rows = await this.db.selectFrom('Match').selectAll().limit(Math.min(limit, 10000)).execute();
    return rows.map(toMatch);
  },
};
