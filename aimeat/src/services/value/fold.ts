/**
 * @file src/services/value/fold.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How the value signals' day counts go stale: day rows older than VALUE_DAY_WINDOW_DAYS
 *   become week rows (the Monday of their week), so the daily grain is a bounded window and a
 *   comparison with the same weeks a year earlier still has its numbers. Run nightly by the core job
 *   value-fold (services/job-seeding.ts).
 * @structure VALUE_DAY_WINDOW_DAYS · valueFoldCutoff · runValueFold
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, phase 1).
 */
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';

/** Day rows are kept this long; a year and a month, so the same day last year is still a day row. */
export const VALUE_DAY_WINDOW_DAYS = 400;

/** The first day still kept as a day row, YYYY-MM-DD. */
export function valueFoldCutoff(now: Date = new Date()): string {
  return new Date(now.getTime() - VALUE_DAY_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/** Fold the day rows before the window into weeks. Answers how many day rows it folded. */
export async function runValueFold(storage: Storage, now: Date = new Date()): Promise<number> {
  const folded = await storage.foldValueDaily(valueFoldCutoff(now));
  if (folded > 0) logger.info('value-fold: day rows folded into weeks', { folded });
  return folded;
}
