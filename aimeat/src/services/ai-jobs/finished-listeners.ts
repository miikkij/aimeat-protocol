/**
 * @file src/services/ai-jobs/finished-listeners.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who hears that a background AI job finished (done, failed or cancelled). The job
 *   service calls emitAiJobFinished once per job from its one finish path (service.ts finish); a
 *   feature that started jobs registers a listener at start-up and reads only the jobs that are its
 *   own (by `app_id`). A registry rather than an import, so the job service names no feature and no
 *   feature becomes a dependency of it. A listener's failure is logged and never reaches the job.
 * @structure onAiJobFinished(listener) · emitAiJobFinished(job)
 * @usage onAiJobFinished(job => { if (job.app_id === 'goals') settle(job); });   // services/goals/goals-sweep.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial: agent goals settle a work the node's model did (session cc-jouni-goals).
 */
import { logger } from '../../utils/logger.js';
import type { AiJobRecord } from './types.js';

type Listener = (job: AiJobRecord) => Promise<void> | void;

const listeners = new Set<Listener>();

/** Hear every job that finishes; answers the function that stops hearing. */
export function onAiJobFinished(listener: Listener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** Tell every listener; awaited one after another, each failure logged on its own. */
export async function emitAiJobFinished(job: AiJobRecord): Promise<void> {
    for (const listener of listeners) {
        try {
            await listener(job);
        } catch (err) {
            logger.warn('[ai-jobs] a finished-job listener failed', { jobId: job.id, app: job.app_id, error: String(err) });
        }
    }
}
