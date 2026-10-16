/**
 * @file src/services/scheduler-failures.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who is told when a scheduled run fails, and when a failing schedule is paused.
 *
 *   A CORE JOB has no owner: it is the node's own maintenance. Its failure goes to the operator as
 *   the same deduplicated message a failed request sends (services/system-fault-report.ts,
 *   reportJobFault): one message per job per hour, however often it fails. A core job is never
 *   paused here, because a paused cleanup or expiry job stops work the node depends on, and the
 *   operator, who is told, decides.
 *
 *   A USER SCHEDULE (every other kind) tells its owner through the bell (services/notify.ts, which
 *   also sends web push when the owner has it on) on the first failure of a run of failures, not on
 *   every one. After MAX_CONSECUTIVE_FAILURES failures in a row the schedule is paused and the owner
 *   is told that too. The scheduler keeps the count per job in memory (reset by a success); after a
 *   start, the first failure reads it from the execution log, newest first, skipping the `skipped`
 *   rows (a skip is not a run), so it needs no new field on the job row.
 * @structure MAX_CONSECUTIVE_FAILURES · failureStreak(storage, jobId) · onFailedRun(deps, job, error, streaks) ·
 *   noteSuccess(streaks, jobId) · tellScheduleOwner(storage, job, what, detail)
 * @usage const { pauseReason } = await onFailedRun({ storage, config }, job, errorMessage, this.failureStreaks);
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit E4-03).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, ScheduledJobRecord } from '../storage/interface.js';
import { notify } from './notify.js';
import { reportJobFault } from './system-fault-report.js';
import { logger } from '../utils/logger.js';

/** Failures in a row after which a user schedule is paused. */
export const MAX_CONSECUTIVE_FAILURES = 5;

/** How many of the newest runs of this job ended in error, in a row, up to `max`. Skips are not runs. */
export async function failureStreak(storage: Storage, jobId: string, max = MAX_CONSECUTIVE_FAILURES): Promise<number> {
  const rows = await storage.listExecutionLogs({ jobId, limit: max * 4 });
  let streak = 0;
  for (const row of rows) {
    if (row.result === 'skipped') continue;
    if (row.result !== 'error') break;
    if (++streak >= max) break;
  }
  return streak;
}

/**
 * Tell the right person about a failed run. Returns a pause reason when a user schedule has now
 * failed MAX_CONSECUTIVE_FAILURES times in a row; the scheduler pauses it and tells the owner.
 * Never throws: telling is best-effort and must not turn one failure into two.
 */
export async function onFailedRun(
  deps: { storage: Storage; config: AimeatConfig }, job: ScheduledJobRecord, error: string,
  streaks: Map<string, number>,
): Promise<{ pauseReason?: string }> {
  try {
    if (job.type === 'core') {
      await reportJobFault(deps, { jobId: job.id, jobName: job.displayName || job.name, error });
      return {};
    }
    // The count this process kept since its last success; the run log only when this process has
    // seen no run of the job yet (after a start), because rows written in the same millisecond have
    // no order to read.
    const known = streaks.get(job.id);
    const streak = known !== undefined ? known + 1 : await failureStreak(deps.storage, job.id);
    streaks.set(job.id, streak);
    if (streak >= MAX_CONSECUTIVE_FAILURES) {
      streaks.set(job.id, 0);   // turned on again, it gets the full count before the next pause
      return { pauseReason: `It failed ${streak} times in a row, so it was paused. The last error: ${error}. Fix the cause, then turn the schedule on again.` };
    }
    if (streak <= 1) await tellScheduleOwner(deps.storage, job, 'failed', error);
  } catch (err) {
    logger.warn('scheduler: could not tell anybody about a failed run', { jobId: job.id, error: String(err) });
  }
  return {};
}

/** A run of this job succeeded: its count of failures in a row starts again. */
export function noteSuccess(streaks: Map<string, number>, jobId: string): void {
  streaks.set(jobId, 0);
}

/** A bell notification to the schedule's owner (and web push, when they have it). No owner, no message. */
export async function tellScheduleOwner(
  storage: Storage, job: ScheduledJobRecord, what: 'failed' | 'paused', detail: string,
): Promise<void> {
  if (!job.ownerScope) return;
  const name = job.displayName || job.name;
  await notify(storage, job.ownerScope, {
    type: what === 'failed' ? 'schedule_failed' : 'schedule_paused',
    title: what === 'failed' ? `Schedule "${name}" failed` : `Schedule "${name}" was paused`,
    body: detail,
    link: '/v1/profile?tab=scheduler',
    i18n: { key: what === 'failed' ? 'schedule_failed' : 'schedule_paused', vars: { name, detail } },
  });
}
