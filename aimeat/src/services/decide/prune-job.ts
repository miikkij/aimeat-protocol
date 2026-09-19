/**
 * @file src/services/decide/prune-job.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The nightly sweep that keeps decision records to their retention window (TARGET-080).
 *
 *   A register with no way to forget becomes a store that answers every question with everything.
 *   A decision older than `decideRetentionDays` (a year by default) is deleted, whoever it belongs to,
 *   in one indexed statement. The cache is the same table, so a pruned decision is also no longer
 *   reused, which is right: an answer that old was made by a model version long since replaced.
 * @structure runDecisionPrune(config, storage)
 * @usage registered as the `ai-decision-prune` core handler (services/core-jobs.ts)
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';

export async function runDecisionPrune(config: AimeatConfig, storage: Storage): Promise<number> {
  const days = Math.max(1, config.decideRetentionDays);
  const before = new Date(Date.now() - days * 86_400_000).toISOString();
  const removed = await storage.deleteAiDecisionsBefore(before);
  if (removed > 0) logger.info(`[decide] pruned ${removed} decision record(s) older than ${days} days`);
  return removed;
}
