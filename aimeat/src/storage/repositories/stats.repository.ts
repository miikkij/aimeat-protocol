/**
 * @file stats.repository.ts
 * @description Storage repository for persisting stats counters and daily history.
 * @version-history v1.0.0 -- 2026-05-21 -- Initial creation
 */

export interface StatsRepository {
  flushStats(counters: Record<string, number>): Promise<void>;
  loadStats(): Promise<Record<string, number>>;
  flushDailyHistory(history: Record<string, Record<string, number>>): Promise<void>;
  loadDailyHistory(): Promise<Record<string, Record<string, number>>>;
}
