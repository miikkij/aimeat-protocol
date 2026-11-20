/**
 * @file src/storage/types/value.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Record types for the value signals: what happened to a record an AI made after it was
 *   made. The signals are derived where a principal writes, deletes or opens a memory record
 *   (services/value/signal-buffer.ts), so nobody acknowledges anything: a person corrects, deletes or
 *   uses a result, and the node counts it.
 *
 *   TWO GRAINS. ValueKeyRow is the state of one live record an AI made: who made it, how often it was
 *   revised by its maker, corrected by someone else, and opened by someone else. It is deleted with
 *   the record (the rejection stays in the daily grain), so it never outgrows the memory table.
 *   ValueDailyRow is the count per day: the grain reports, rhythm and the operator's totals read.
 * @structure ValueSignal · ValueKeyRow · ValueKeyDelta · ValueDailyRow · ValueDailyDelta ·
 *   ValueDailyFilter · ValueDailyGroup · ValueDailySum
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, phase 1).
 */

/**
 * What happened, in one word each.
 * - produced: an AI (agent, ecosystem app or AI job) made a new record.
 * - refined: the same, when the AI declared it combined real sources (provenance level `synthesized`).
 * - revised: the AI that made the record wrote it again. Its own next round, not a correction.
 * - corrected: someone other than the maker changed an AI-made record.
 * - rejected: an AI-made record was deleted within the rejection window after it was made.
 * - used: someone other than the maker opened an AI-made record.
 */
export type ValueSignal = 'produced' | 'refined' | 'revised' | 'corrected' | 'rejected' | 'used';

export const VALUE_SIGNALS: readonly ValueSignal[] = ['produced', 'refined', 'revised', 'corrected', 'rejected', 'used'];

/** The state of one live AI-made record. */
export interface ValueKeyRow {
  /** The namespace the record lives in; '' for a workspace record, which is one record whichever
   *  namespace its draft, published copy and versions sit in. `key` is the base key. */
  ownerGaii: string;
  key: string;
  /** The principal that made it: a GAII, a GEAI or `schedule:{id}`. */
  producer: string;
  /** The provenance level the maker declared, when the write path knew it. */
  producerLevel: string | null;
  producedAt: string;
  /** Writes by the maker after the first. */
  revisions: number;
  /** Writes by anyone else. */
  corrections: number;
  /** Sum of the size changes those corrections made, in bytes. */
  correctionBytes: number;
  lastCorrectedAt: string | null;
  /** Opens by anyone other than the maker. */
  readsByOthers: number;
  lastReadAt: string | null;
  /** The value's size after the last write, so the next correction's size can be told. */
  lastBytes: number;
}

/**
 * One change to fold in. The identity fields are written on insert only; the counts are deltas; the
 * two timestamps keep the latest; lastBytes is set when given.
 */
export interface ValueKeyDelta {
  ownerGaii: string;
  key: string;
  producer: string;
  producerLevel: string | null;
  producedAt: string;
  revisions: number;
  corrections: number;
  correctionBytes: number;
  lastCorrectedAt: string | null;
  readsByOthers: number;
  lastReadAt: string | null;
  lastBytes: number | null;
}

/** One day's count of one signal. `grain` week rows hold the days older than the daily window. */
export interface ValueDailyRow {
  /** YYYY-MM-DD: the day, or the Monday of the week for a week row. */
  day: string;
  grain: 'day' | 'week';
  /** The person whose AI made the record (the producer's owner GHII), wherever the record landed. */
  ownerGhii: string;
  /** The organism and workspace of a workspace record, '' otherwise. */
  orgId: string;
  wsId: string;
  /** The AI that made the record. */
  producer: string;
  /** The key family (utils/key-family.ts), the feature the record belongs to. */
  family: string;
  signal: ValueSignal;
  count: number;
  bytes: number;
}

export type ValueDailyDelta = Omit<ValueDailyRow, 'grain'>;

export interface ValueDailyFilter {
  ownerGhii?: string;
  orgId?: string;
  wsId?: string;
  producer?: string;
  /** Inclusive YYYY-MM-DD bounds on `day`. */
  from?: string;
  to?: string;
}

export type ValueDailyGroup = 'day' | 'signal' | 'producer' | 'family' | 'ownerGhii' | 'orgId' | 'wsId';

/** One group's sums. The grouped columns are present; `owners` counts the distinct owners behind it. */
export interface ValueDailySum {
  day?: string;
  signal?: ValueSignal;
  producer?: string;
  family?: string;
  ownerGhii?: string;
  orgId?: string;
  wsId?: string;
  count: number;
  bytes: number;
  owners: number;
}
