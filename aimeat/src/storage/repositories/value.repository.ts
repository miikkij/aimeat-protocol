/**
 * @file src/storage/repositories/value.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Backend-agnostic contract for the value signals (storage/types/value.ts): the state of
 *   each live AI-made record, and the daily counts.
 *
 *   HOW IT GOES STALE. The per-record state is deleted with its record. Day rows older than the daily
 *   window are folded into week rows (foldValueDaily, run daily by the core job value-fold), so the
 *   daily grain stays a bounded window and a year-on-year comparison still has its weeks.
 *
 *   ERASURE. Both cascades delete the per-record rows of the erased person's namespaces and the day
 *   counts of what their AI made (a day row belongs to the producer's owner). Where an agent of theirs
 *   made a record in another person's namespace or in an organism workspace, the per-record row stays
 *   with the erasure's pseudonym as its maker, because that record is the other side's.
 * @structure ValueRepository
 * @usage implemented by both storage providers; called through Storage.
 * @version-history
 *   v1.1.0 — 2026-11-20 — The data counts: upsertDataDaily, sumDataDaily, pruneDataDaily (migration 0136).
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, phase 1).
 */
import type {
  ValueKeyRow, ValueKeyDelta, ValueDailyDelta, ValueDailyFilter, ValueDailyGroup, ValueDailySum,
  DataDailyDelta, DataDailyFilter, DataDailyGroup, DataDailySum,
} from '../types/value.js';

export interface ValueRepository {
  /** The state of these records, when an AI made them. At most 1000 pairs a call. */
  getValueKeys(pairs: Array<{ ownerGaii: string; key: string }>): Promise<ValueKeyRow[]>;
  /** Fold changes into the per-record state; a missing row is created from the delta. */
  upsertValueKeys(rows: ValueKeyDelta[]): Promise<void>;
  /** Forget records that are gone. */
  deleteValueKeys(pairs: Array<{ ownerGaii: string; key: string }>): Promise<void>;
  /** The records of one namespace under a key prefix, newest first. */
  listValueKeys(filter: { ownerGaii: string; keyPrefix?: string; keys?: string[]; limit?: number }): Promise<ValueKeyRow[]>;

  /** Add daily counts. */
  upsertValueDaily(rows: ValueDailyDelta[]): Promise<void>;
  /** Sums grouped by the named columns, day and week rows alike. */
  sumValueDaily(filter: ValueDailyFilter, groupBy: ValueDailyGroup[]): Promise<ValueDailySum[]>;
  /** Fold the day rows before `beforeDay` into week rows; answers how many day rows it folded. */
  foldValueDaily(beforeDay: string): Promise<number>;

  /** Add daily counts of what data passed through (types/value.ts DataDailyDelta). */
  upsertDataDaily(rows: DataDailyDelta[]): Promise<void>;
  /** Sums grouped by the named columns, with the distinct owners behind each group. */
  sumDataDaily(filter: DataDailyFilter, groupBy: DataDailyGroup[]): Promise<DataDailySum[]>;
  /** Delete the day rows before `beforeDay`; the data counts keep no week grain. */
  pruneDataDaily(beforeDay: string): Promise<number>;
}
