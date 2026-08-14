/**
 * @file src/storage/repositories/moderation.repository.ts
 * @description Storage-interface segment for moderation — the CRUD contract each backend implements
 *   for content flags, appeals, and profile matches (create/get/update/list plus match expiry/cleanup).
 *
 * @structure
 *   - ModerationRepository: interface grouping flag ops (createFlag/getFlagSummary/listFlags/...),
 *     appeal ops (createAppeal/getAppealByFlagId/...), and match ops (createMatch/deleteExpiredMatches/...)
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { FlagRecord, FlagSummary, AppealRecord, MatchRecord } from '../interface.js';

export interface ModerationRepository {
  createFlag(record: FlagRecord): Promise<FlagRecord>;
  getFlag(id: string): Promise<FlagRecord | null>;
  getFlagsByTarget(targetType: string, targetId: string): Promise<FlagRecord[]>;
  getFlagByUser(targetType: string, targetId: string, flaggedBy: string): Promise<FlagRecord | null>;
  getFlagSummary(targetType: string, targetId: string): Promise<FlagSummary | null>;
  updateFlag(id: string, updates: Partial<FlagRecord>): Promise<FlagRecord | null>;
  listFlags(opts?: { status?: string; targetType?: string; page?: number; perPage?: number }): Promise<FlagRecord[]>;
  createAppeal(record: AppealRecord): Promise<AppealRecord>;
  getAppeal(id: string): Promise<AppealRecord | null>;
  getAppealByFlagId(flagId: string): Promise<AppealRecord | null>;
  listAppeals(opts?: { status?: string; page?: number; perPage?: number }): Promise<AppealRecord[]>;
  updateAppeal(id: string, updates: Partial<AppealRecord>): Promise<AppealRecord | null>;
  createMatch(record: MatchRecord): Promise<MatchRecord>;
  getMatch(id: string): Promise<MatchRecord | null>;
  getMatchByPair(profileA: string, profileB: string): Promise<MatchRecord | null>;
  listMatchesByProfile(profile: string, opts?: { status?: string; page?: number; perPage?: number }): Promise<MatchRecord[]>;
  updateMatch(id: string, updates: Partial<MatchRecord>): Promise<MatchRecord | null>;
  deleteExpiredMatches(): Promise<number>;
  deleteMatchesByProfile(profile: string): Promise<number>;
  listAllMatches(limit?: number): Promise<MatchRecord[]>;
}
