/**
 * @file src/services/scheduler-catch-up.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What happens at start to a fire that fell while the node was not running.
 *
 *   The scheduler stores each job's next fire (ScheduledJob.nextRunAt) when it schedules the job and
 *   after every run. At start, a stored time that is already past means at least one fire was missed:
 *   the node was down, or it stopped while that run was in progress. Before this, start() scheduled
 *   the job from its pattern and the missed fire was neither run nor recorded.
 *
 *   THE CHOICE, per kind:
 *   - A core job whose period is a day or longer (the daily allowance, the nightly prunes, the
 *     monthly compliance report, the weekly behaviour fixer) runs ONCE to catch up, however many fires
 *     were missed. Its handler decides by stored state what it still owes (the allowance by its
 *     ledger row per day, the compliance report by the months already stored), so the extra run
 *     doubles nothing.
 *   - A core job that runs more often than daily is left alone: its next fire is minutes away.
 *   - A user schedule (every other kind) is not run: what a person scheduled for 07:00 may be wrong
 *     at 11:00. One `skipped` row in its run log says the run was missed and when, so the list no
 *     longer hides it. There is no opt-in to catch-up runs for user schedules yet.
 *
 *   ONE PROCESS DOES IT. The catch-up is claimed like a cron fire (storage claimScheduledFire, keyed
 *   by the missed fire's scheduled time), so two node processes on one database neither run it twice
 *   nor write two rows, and a fire another process already ran is not caught up.
 * @structure CATCH_UP_MIN_PERIOD_MS · MissedFire · missedFire(job, now) · missedMessage(fireAt)
 * @usage const plan = missedFire(job); if (plan) …
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit E4-07).
 */
import { Cron } from 'croner';
import type { ScheduledJobRecord } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

/** A core job whose fires are at least this far apart is caught up. 23 h, so a DST day still counts. */
export const CATCH_UP_MIN_PERIOD_MS = 23 * 3_600_000;

/** What to do about one missed fire: run the job once, or write one `skipped` row. */
export interface MissedFire {
  action: 'run' | 'record';
  /** The scheduled time of the latest missed fire, ISO. The catch-up claims this time. */
  fireAt: string;
}

/**
 * The missed fire of an enabled cron job at start, or null when none was missed or nothing is done
 * about it. Pure: reads the job's stored nextRunAt and lastRunAt and its pattern.
 */
export function missedFire(job: ScheduledJobRecord, now: Date = new Date()): MissedFire | null {
  if (!job.enabled || job.cron === '@activate' || !job.nextRunAt) return null;
  const storedNext = Date.parse(job.nextRunAt);
  if (!Number.isFinite(storedNext) || storedNext > now.getTime()) return null;
  // A run that finished at or after that time ran it; only the write of the next time was lost.
  if (job.lastRunAt && Date.parse(job.lastRunAt) >= storedNext) return null;

  let cron: Cron;
  try {
    cron = new Cron(job.cron, { paused: true, ...(job.timezone ? { timezone: job.timezone } : {}) });
  } catch (err) {
    // A pattern croner refuses is reported where the job is scheduled; nothing to catch up here.
    logger.warn(`Scheduler catch-up: the pattern of ${job.id} cannot be read`, { cron: job.cron, error: String(err) });
    return null;
  }
  try {
    const [latest] = cron.previousRuns(1, now);
    const fireAt = (latest && latest.getTime() >= storedNext ? latest : new Date(storedNext)).toISOString();
    if (job.type !== 'core') return { action: 'record', fireAt };
    const [a, b] = cron.nextRuns(2, now);
    const period = a && b ? b.getTime() - a.getTime() : 0;
    return period >= CATCH_UP_MIN_PERIOD_MS ? { action: 'run', fireAt } : null;
  } finally {
    cron.stop();
  }
}

/** The run-log text of a missed fire of a user schedule. */
export function missedMessage(fireAt: string): string {
  return `Missed: the node was not running at ${fireAt}, so this run did not happen. The next run happens at its time.`;
}
