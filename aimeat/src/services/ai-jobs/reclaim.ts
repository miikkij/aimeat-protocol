/**
 * @file src/services/ai-jobs/reclaim.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which live jobs a process takes over, and what it does with each: at its start, every
 *   job no live process holds (AiJobService.reconcileAfterRestart, moved here), and while it runs,
 *   every job whose process ended (the adoption pass, every ADOPT_MS).
 *
 *   ONE PROCESS RUNS A JOB. Each entry of the node-wide index names the process that runs the job
 *   (store.ts `by`; services/process-lease.ts). A process leaves alone a job whose holder is alive, and
 *   takes a job over on the index's version (claimActiveEntry), so of two processes one does it. Until
 *   2026-11-04 a starting process failed every running job on the node and ran every queued one again,
 *   the other process's live ones included.
 *
 *   ONE PROCESS SEES NO CHANGE. A restart on the same host and port is the same process name in a new
 *   start, so the jobs the stopped process held are taken back at once, and each is decided as before
 *   (restart.ts restartDecision): a job the stopping node marked is queued again once, a job left
 *   running by a crash is failed with node_restarted (test/e2e-ai-jobs.ts case 15), a queued job runs.
 *   The adoption pass takes only jobs held by another name, so with one process it finds nothing.
 * @structure ADOPT_MS · ReclaimDeps · reclaimJobs(deps, mode)
 * @usage const { failed, requeued } = await reclaimJobs(deps, 'boot');
 * @version-history
 *   v1.0.0 -- 2026-11-04 -- Initial: the restart pass moved from service.ts, with the holder check, the
 *     claim on the index and the adoption pass (codebase analysis 2026-11-03, item HA 2.5).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { thisProcess, sameProcess, holderAlive, processLeaseReady } from '../process-lease.js';
import { restartDecision } from './restart.js';
import { readJob, writeJob, foldIntoLog, readActiveIndex, removeFromActiveIndex, claimActiveEntry } from './store.js';
import type { AiJobRecord } from './types.js';

/** How often a running process looks for jobs whose process ended. */
export const ADOPT_MS = 15_000;

export interface ReclaimDeps {
    storage: Storage;
    config: AimeatConfig;
    /** Whether this process runs the job now. */
    isLive(jobId: string): boolean;
    /** Run a queued job in this process; throws when its inputs cannot be rebuilt. */
    enqueue(job: AiJobRecord): Promise<void>;
}

/**
 * `boot`: every live job no live process holds (no holder, this process's previous life, a process
 * that ended). `adopt`: only the jobs of another process name that ended.
 */
export async function reclaimJobs(deps: ReclaimDeps, mode: 'boot' | 'adopt'): Promise<{ failed: number; requeued: number }> {
    const { storage, config } = deps;
    const me = thisProcess(config);
    // A job this process takes over names it, so its own lease is written first (another process
    // reading the entry must find this process alive).
    await processLeaseReady(config);
    const refs = await readActiveIndex(storage, config.nodeId);
    let failed = 0, requeued = 0;

    for (const ref of refs) {
        if (deps.isLive(ref.jobId)) continue;
        if (mode === 'adopt' && (!ref.by || ref.by.name === me.name)) continue;
        if (!sameProcess(ref.by, me)) {
            if (ref.by && await holderAlive(storage, config, ref.by)) continue;
            if (!await claimActiveEntry(storage, config.nodeId, ref.jobId, ref.by, me)) continue;
        }

        let job = await readJob(storage, ref.ownerGhii, ref.jobId);
        if (!job) { await removeFromActiveIndex(storage, config.nodeId, ref.jobId); continue; }

        if (job.state === 'running') {
            const decision = restartDecision(job);
            if (decision.action === 'requeue') {
                job = decision.job;
                await writeJob(storage, job);
            } else {
                await foldIntoLog(storage, {
                    ...job, state: 'failed', finished_at: new Date().toISOString(),
                    error: { code: 'node_restarted', message: decision.message },
                });
                await removeFromActiveIndex(storage, config.nodeId, ref.jobId);
                failed++;
                continue;
            }
        }

        if (job.state === 'queued') {
            try {
                await deps.enqueue(job);
                requeued++;
            } catch (err) {
                await foldIntoLog(storage, {
                    ...job, state: 'failed', finished_at: new Date().toISOString(),
                    error: { code: 'node_restarted', message: `The node restarted and this queued job could not be rebuilt: ${(err as Error).message}` },
                });
                await removeFromActiveIndex(storage, config.nodeId, ref.jobId);
                failed++;
            }
            continue;
        }

        // Terminal in storage but still indexed: the fold crashed between the two writes.
        await removeFromActiveIndex(storage, config.nodeId, ref.jobId);
    }

    if (failed || requeued) {
        logger.info(mode === 'boot'
            ? `[ai-jobs] restart reconciliation: ${failed} failed (node_restarted), ${requeued} requeued`
            : `[ai-jobs] took over the jobs of a node process that ended: ${failed} failed (node_restarted), ${requeued} requeued`);
    }
    return { failed, requeued };
}
