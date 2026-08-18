/**
 * @file src/services/usage/archive-job.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Moves raw usage rows past the hot window into the archive tables, and prunes the
 *   hour-grain rollups the live dashboards no longer need.
 *   Design: docs/internal/telemetria/02-design.md
 *
 *   WHY MOVE RATHER THAN DELETE. A usage row can become a billing question or a legal one, and the
 *   operator carries liability for both, so nothing here deletes a call record. The hot tables stay
 *   small enough to query fast; the archive keeps everything. Pruning the archive is a deliberate
 *   operator action with an explicit before-date, never a scheduled job — a cron that quietly
 *   destroys evidence is a cron nobody remembers approving.
 *
 *   WHY IT LOOPS. One sweep is bounded so a single transaction stays short. The loop is bounded too:
 *   after a long outage the backlog is worked off across runs rather than in one pass that holds
 *   locks for minutes.
 * @structure
 *   - runUsageArchiveJob(storage) -- one bounded sweep loop; returns totals
 * @usage
 *   scheduler.registerCoreHandler('usage-archive', () => runUsageArchiveJob(storage));
 * @version-history
 *   v1.0.0 — 2026-08-14 — Initial: the 90-day hot window becomes enforceable.
 */
import type { Storage, UsageArchiveResult } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';

/** How long raw stays queryable in the hot tables. */
const HOT_DAYS = Number(process.env.AIMEAT_USAGE_HOT_DAYS) || 90;
/** Hour-grain rollups are a live-dashboard resolution; the day grain carries the history. */
const HOUR_ROLLUP_DAYS = Number(process.env.AIMEAT_USAGE_HOUR_ROLLUP_DAYS) || 30;
const BATCH = Number(process.env.AIMEAT_USAGE_ARCHIVE_BATCH) || 2_000;
/** Sweeps per run. Bounded so one run cannot occupy the database for an unbounded time. */
const MAX_SWEEPS = 50;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export async function runUsageArchiveJob(storage: Storage): Promise<UsageArchiveResult> {
  const before = daysAgo(HOT_DAYS);
  const pruneHourBefore = daysAgo(HOUR_ROLLUP_DAYS).slice(0, 13);
  const total: UsageArchiveResult = { usageCalls: 0, usageEvents: 0, hourRollupsPruned: 0 };

  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    const moved = await storage.archiveUsageRows({ before, pruneHourBefore, batch: BATCH });
    total.usageCalls += moved.usageCalls;
    total.usageEvents += moved.usageEvents;
    total.hourRollupsPruned += moved.hourRollupsPruned;
    // Nothing left to move. The hour prune is a single statement that runs on every sweep and is
    // idempotent, so it is not part of the stop condition.
    if (moved.usageCalls === 0 && moved.usageEvents === 0) break;
  }

  if (total.usageCalls > 0 || total.usageEvents > 0 || total.hourRollupsPruned > 0) {
    logger.info('usage-archive: swept', {
      hotDays: HOT_DAYS,
      calls: total.usageCalls,
      events: total.usageEvents,
      hourRollupsPruned: total.hourRollupsPruned,
    });
  }
  return total;
}
