/**
 * @file stats.repository.ts
 * @description Storage repository for persisting stats counters and daily history, plus the operator
 *   storage-growth telemetry: per-table row counts (backend-specific) captured as hourly snapshots.
 * @version-history
 *   v1.1.0 -- 2026-07-16 -- Storage stats snapshots (per-table row counts over time) for the admin DB tab.
 *   v1.0.0 -- 2026-05-21 -- Initial creation
 */

/** An hourly snapshot of the node's storage size: live row count per table + the total, at a point in time. */
export interface StorageStatsSnapshot {
  id: string;
  capturedAt: string;                    // ISO timestamp
  counts: Record<string, number>;        // { tableName: rowCount }
  totalRows: number;
}

export interface StatsRepository {
  flushStats(counters: Record<string, number>): Promise<void>;
  loadStats(): Promise<Record<string, number>>;
  flushDailyHistory(history: Record<string, Record<string, number>>): Promise<void>;
  loadDailyHistory(): Promise<Record<string, Record<string, number>>>;

  /** Current live row count per table/collection (backend-specific; an estimate is acceptable). */
  getTableRowCounts(): Promise<Record<string, number>>;
  /** Memory-table composition: how many rows are `.version.N` workspace-history snapshots and how
   *  many are archived. Both classes live in the single memory table and inflate it invisibly —
   *  the admin Database tab surfaces them so an operator sees WHAT the table is made of, not just
   *  its size. One DB-side aggregate, no values loaded. */
  getMemoryRowBreakdown(): Promise<{ versionRows: number; archivedRows: number }>;
  /** Persist one storage-size snapshot (append-only; keyed by id). */
  saveStorageStatsSnapshot(snapshot: StorageStatsSnapshot): Promise<void>;
  /** Snapshots newest-first, optionally bounded by count and/or a since-ISO lower bound. */
  listStorageStatsSnapshots(opts?: { limit?: number; sinceIso?: string }): Promise<StorageStatsSnapshot[]>;
  /** Delete snapshots captured strictly before the ISO cutoff. Returns the number removed. */
  pruneStorageStatsSnapshots(beforeIso: string): Promise<number>;
}
