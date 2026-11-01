/**
 * @file src/services/schedule-load-limits.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two operator limits on what one owner may load the shared scheduler with: how many
 *   schedules the owner keeps (schedules.max_per_owner) and the shortest gap between two runs of a
 *   schedule (schedules.min_interval_seconds). Every fire, a skipped one included, writes a log row and
 *   sends a change event, so many per-second schedules from one account loaded the database and the
 *   event bus every other account uses (secaudit2026oct31w2 round 10, f-2026aug-dos-ratelimit-2).
 *
 *   Both are asked when a schedule is made, and the gap again when an edit gives it a new time. A
 *   schedule that exists keeps firing as it is, and an edit that keeps its time asks nothing, so
 *   nothing stored before the limits needs marking. Each limit is off at 0; the defaults (1000
 *   schedules, 60 seconds) keep every once-a-minute schedule and every documented use working.
 * @structure scheduleIntervalRefusal(cron, timezone, config) · scheduleCountRefusal(storage, ownerScope, config)
 * @usage
 *   const bad = scheduleIntervalRefusal(cron, tz, config) ?? await scheduleCountRefusal(storage, owner, config);
 * @version-history
 *   2026-10-31 — Initial (secaudit2026oct31w2 round 10, f-2026aug-dos-ratelimit-2).
 */
import { Cron } from 'croner';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

export interface ScheduleLoadRefusal {
    status: number;
    code: 'SCHEDULE_TOO_FREQUENT' | 'SCHEDULE_LIMIT';
    message: string;
}

/** How many coming runs are compared. A cron whose short gap only shows later than this is rare. */
const RUNS_COMPARED = 20;

/** The shortest gap in seconds between the next RUNS_COMPARED runs, or null when there are fewer than two. */
function shortestGapSeconds(cron: string, timezone?: string): number | null {
    let c: Cron;
    try {
        c = new Cron(cron, { paused: true, ...(timezone ? { timezone } : {}) });
    } catch (err) {
        // checkScheduleGate has already refused an expression croner cannot read.
        logger.warn('schedule load limits: unreadable cron, the gate answers for it', { error: String(err) });
        return null;
    }
    try {
        const runs = c.nextRuns(RUNS_COMPARED);
        let shortest: number | null = null;
        for (let i = 1; i < runs.length; i++) {
            const gap = (runs[i].getTime() - runs[i - 1].getTime()) / 1000;
            if (shortest === null || gap < shortest) shortest = gap;
        }
        return shortest;
    } finally {
        c.stop();
    }
}

/**
 * The refusal for a cron that runs more often than schedules.min_interval_seconds allows, or null.
 * `@activate` runs once per activation and is never refused.
 */
export function scheduleIntervalRefusal(
    cron: string, timezone: string | undefined, config: Pick<AimeatConfig, 'scheduleMinIntervalSeconds'>,
): ScheduleLoadRefusal | null {
    const min = config.scheduleMinIntervalSeconds;
    if (!min || cron === '@activate') return null;
    const gap = shortestGapSeconds(cron, timezone);
    if (gap === null || gap >= min) return null;
    return {
        status: 400, code: 'SCHEDULE_TOO_FREQUENT',
        message: `This schedule would run every ${gap} seconds, and on this node a schedule runs at most once every ${min} seconds. `
            + `Give it a time that runs less often (with ${min} seconds, "* * * * *" runs once a minute). `
            + 'The operator sets this limit (schedules.min_interval_seconds).',
    };
}

/**
 * The refusal for a new schedule past schedules.max_per_owner, or null. Counts every schedule under the
 * owner's scope: the owner's own, their agents' and their apps'.
 */
export async function scheduleCountRefusal(
    storage: Storage, ownerScope: string, config: Pick<AimeatConfig, 'scheduleMaxPerOwner'>,
): Promise<ScheduleLoadRefusal | null> {
    const max = config.scheduleMaxPerOwner;
    if (!max) return null;
    const held = (await storage.listScheduledJobs({ ownerScope })).length;
    if (held < max) return null;
    return {
        status: 409, code: 'SCHEDULE_LIMIT',
        message: `This account has ${held} schedules, and one owner may keep ${max} on this node. `
            + 'Delete one you no longer need (DELETE /v1/schedules/<id>, or aimeat_schedule_delete) and make this one again. '
            + 'The operator sets this limit (schedules.max_per_owner).',
    };
}
