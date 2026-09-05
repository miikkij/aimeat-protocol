/**
 * @file src/services/ai-jobs/prune-job.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The nightly sweep that keeps the folded AI-job logs to their retention window.
 *
 *   The fold is what stops a key per run filling the 1000-key ceiling; this is what stops the DAY
 *   records doing the same thing more slowly. Thirty days of them is thirty keys, which is a shape
 *   that can run for years.
 *
 *   It walks the owners rather than the keys, because a memory listing is per namespace. Cheap:
 *   one prefix listing per owner, once a night, and it deletes only whole day records that are
 *   already outside the window.
 * @structure runAiJobLogPrune(config, storage)
 * @usage registered as the `ai-job-log-prune` core handler (services/core-jobs.ts)
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { pruneLogs } from './store.js';

export async function runAiJobLogPrune(config: AimeatConfig, storage: Storage): Promise<void> {
    const owners = await storage.listOwners();
    let removed = 0;
    for (const owner of owners) {
        const ghii = `${owner.name}@${config.nodeId}`;
        try {
            removed += await pruneLogs(storage, ghii, config.aiJobLogRetentionDays);
        } catch (err) {
            // One owner's failure must not stop the sweep for everyone else, and it is logged rather
            // than swallowed: an operator seeing this knows a namespace is accumulating.
            logger.warn('[ai-jobs] log prune failed for one owner', { owner: owner.name, error: String(err) });
        }
    }
    if (removed > 0) {
        logger.info(`[ai-jobs] pruned ${removed} day log(s) older than ${config.aiJobLogRetentionDays} days`);
    }
}
