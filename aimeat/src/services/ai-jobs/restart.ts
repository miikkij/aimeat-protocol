/**
 * @file src/services/ai-jobs/restart.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a starting node does with a job the previous process left `running`, and what
 *   a stopping node writes on the jobs it is running so the next start can tell.
 *
 *   A STOP THE NODE MAKES IS NOT A FAILURE OF THE JOB. A deploy or a restart stops the process with
 *   SIGTERM, and until 2026-11-04 every job running at that moment was failed at the next start
 *   (`node_restarted`), so the person saw their work fail on every deploy. Now the stopping process
 *   marks each running job (`stopped_at`), and the next start puts a marked job back in the queue once
 *   (`requeued_after_stop` counts it). A job the node stops a second time is failed, so a job that
 *   itself brings the process down cannot loop.
 *
 *   A CRASH STAYS A FAILURE. A job left running with no mark was cut off by a process that died
 *   without stopping (a kill, an out-of-memory end). The node cannot tell whether the job caused it,
 *   so it is failed as before; test/e2e-ai-jobs.ts case 15 holds that. A job whose answer was already
 *   written (`result_version`) is failed with the message that the answer can be read, because a
 *   second run would pay again and write over it (case 15b).
 * @structure restartDecision · markStopped
 * @usage
 *   const d = restartDecision(job); if (d.action === 'requeue') ... else fail with d.message
 * @version-history
 *   v1.0.0 -- 2026-11-04 -- Initial (codebase analysis 2026-11-03, item HA 1.4).
 */
import type { AiJobRecord } from './types.js';

/** How many times a restart puts one job back in the queue. The next interrupted run fails it. */
export const MAX_REQUEUES_AFTER_STOP = 1;

export type RestartDecision =
    | { action: 'requeue'; job: AiJobRecord }
    | { action: 'fail'; message: string };

/** What the next start does with a job its previous process left `running`. */
export function restartDecision(job: AiJobRecord): RestartDecision {
    if (job.result_version !== undefined) {
        return { action: 'fail', message: 'The node restarted while this job\'s on_done action was running. The answer was written and can be read; the action did not finish.' };
    }
    const requeued = job.requeued_after_stop ?? 0;
    if (job.stopped_at && requeued < MAX_REQUEUES_AFTER_STOP) {
        // Queued again with the fields it was started with; the run's own stamps go.
        const next: AiJobRecord = { ...job, state: 'queued', requeued_after_stop: requeued + 1 };
        delete next.stopped_at;
        delete next.started_at;
        return { action: 'requeue', job: next };
    }
    if (job.stopped_at) {
        return { action: 'fail', message: 'The node restarted twice while this job was running, so it was stopped. Start it again.' };
    }
    return { action: 'fail', message: 'The node restarted while this job was running, so its answer was lost. Start it again.' };
}

/** The mark a stopping process writes on a running job whose answer is not written yet. */
export function markStopped(job: AiJobRecord, at: string = new Date().toISOString()): AiJobRecord | null {
    if (job.state !== 'running' || job.result_version !== undefined) return null;
    return { ...job, stopped_at: at };
}
