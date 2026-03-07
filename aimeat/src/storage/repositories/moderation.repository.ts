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
  listAllMatches(limit?: number): Promise<MatchRecord[]>;
}
