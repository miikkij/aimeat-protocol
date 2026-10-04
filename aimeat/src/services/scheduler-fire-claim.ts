/**
 * @file scheduler-fire-claim.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One cron fire of a scheduled job runs once, however many node processes share the
 *   database. Every process starts its own Scheduler, and the scheduled_jobs row is shared, so
 *   before a cron fire runs, the process claims it in the database (storage claimScheduledFire,
 *   one conditional update of ScheduledJob.lastFireAt). The process that loses does not run it.
 *
 *   WHY. On aimeat.io the workflow laimeat-sanomat-evening started two runs per fire on 2026-10-02
 *   and 2026-10-03, 1 ms and 15 ms apart, and each run dispatched its own tasks; two other
 *   workflows did the same in August. One process cannot start a second run of a job it is
 *   running (Scheduler.executing), so two processes fired it. A manual "Run now" and an @activate
 *   run are not cron fires and are not claimed.
 *
 *   The claim key is the fire's SCHEDULED time, not the moment the timer ran: two processes run
 *   their timers some milliseconds apart and must name the same fire. croner does not hand the
 *   callback that time, so it is read back as the latest time the pattern matches at or before
 *   this second (previousRuns from the start of the next second).
 * @version-history
 *   v1.0.0 — 2026-10-04 — Initial.
 */
import type { Cron } from 'croner';
import type { ScheduledJobRecord, Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

/** The scheduled time of the fire croner is running now, as an ISO string, or null if none matches. */
export function scheduledFireAt(cron: Cron, now: number = Date.now()): string | null {
  const nextSecond = new Date(Math.floor(now / 1000) * 1000 + 1000);
  const [fireAt] = cron.previousRuns(1, nextSecond);
  return fireAt ? fireAt.toISOString() : null;
}

/**
 * True when this process may run this cron fire. A claim that cannot be made because the database
 * failed lets the fire run, as it did before claims existed: a lost fire is worse than the double
 * run this guards against, and a database that refuses the claim will most likely refuse the run.
 */
export async function claimCronFire(storage: Storage, job: ScheduledJobRecord, cron: Cron): Promise<boolean> {
  const fireAt = scheduledFireAt(cron);
  if (!fireAt) return true;
  try {
    const claimed = await storage.claimScheduledFire(job.id, fireAt);
    if (!claimed) logger.info(`Scheduler: another node process already ran ${job.id} for ${fireAt}; skipping this fire`);
    return claimed;
  } catch (err) {
    logger.warn(`Scheduler: could not claim ${job.id} for ${fireAt}; running it`, { error: String(err) });
    return true;
  }
}
