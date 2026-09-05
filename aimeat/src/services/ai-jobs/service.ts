/**
 * @file src/services/ai-jobs/service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The queue, the handle and the callback — everything an AI job is that a plain model
 *   call is not. ONE implementation, called by the four REST routes, the four MCP tools on all three
 *   surfaces, and `ctx.ai.start` in the sandbox, so the refusals and the bookkeeping happen where
 *   they were written once.
 *
 *   THE MODEL CALL ITSELF IS NOT NEW. `completeForOwner` already picks the key, enforces the daily
 *   budget and the per-app quota, records per-app usage and stamps provenance. Nothing here
 *   duplicates any of that; it is the runner.
 *
 *   REFUSE BEFORE YOU WRITE. Every gate in `startJob` runs before the record exists, in that order,
 *   so a refused start leaves nothing behind. Three defects in this repo have had exactly the other
 *   shape — bytes written before the name was claimed, a paywall standing down before comparing the
 *   coordinate, a response sent before the work it announced — and each was found by reading the
 *   ORDER rather than the presence of the checks.
 * @structure AiJobService · setActiveAiJobService/getActiveAiJobService
 * @usage
 *   const service = new AiJobService(config, storage);
 *   await service.startJob({ prompt, result_key }, { ownerGhii, createdBy });
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { EmailService } from '../email.js';
import { SlotPool, SlotAbortedError } from '../slot-pool.js';
import { completeForOwner, AiCompletionError } from '../ai-completion.js';
import { isReservedServerKey } from '../../utils/reserved-keys.js';
import { parseGAII } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { assembleJobPrompt } from './prompt.js';
import { fireOnDone } from './on-done.js';
import {
    readJob, writeJob, foldIntoLog, findInLogs, listLiveJobs, listLogged, pruneLogs,
    readActiveIndex, addToActiveIndex, removeFromActiveIndex,
} from './store.js';
import {
    AiJobError,
    type AiJobRecord, type AiJobState, type AiJobLogEntry,
    type StartAiJobInput, type StartAiJobContext, type StartAiJobResult, type AiJobStarter,
} from './types.js';

/** How long a caller is asked to wait after a queue-full refusal. A guess would be worse than a
 *  round number: what it really says is "shortly", and Retry-After has no way to say that. */
const RETRY_AFTER_SECONDS = 30;

/** What a live job carries in this process, beside the record in storage. */
interface LiveEntry {
    job: AiJobRecord;
    controller: AbortController;
    /** The assembled prompt. In memory only: it may be two megabytes, which is more than a memory
     *  value may hold, and a restart re-assembles it from the record's own fields anyway. */
    prompt: string;
    /** Resolves when the job reaches a terminal state, so cancel() can answer with the real one. */
    finished: Promise<void>;
    resolveFinished: () => void;
}

export class AiJobService implements AiJobStarter {
    private readonly config: AimeatConfig;
    private readonly storage: Storage;
    private readonly emailService?: EmailService;
    private readonly pool: SlotPool;
    private readonly live = new Map<string, LiveEntry>();

    constructor(config: AimeatConfig, storage: Storage, emailService?: EmailService) {
        this.config = config;
        this.storage = storage;
        this.emailService = emailService;
        // Round-robin by OWNER, not FIFO. One person's burst of fifty must not leave another
        // person's single job behind all of them, and a per-owner concurrency cap is the wrong way
        // to get that — see config-types-ai.ts for why fairness lives in the order and nowhere else.
        this.pool = new SlotPool(config.aiJobSlots);
    }

    // ── start ─────────────────────────────────────────────────────────────────

    async startJob(input: StartAiJobInput, ctx: StartAiJobContext): Promise<StartAiJobResult> {
        const ownerGhii = ctx.ownerGhii;
        const chainDepth = ctx.chainDepth ?? 0;

        this.assertResultKey(ownerGhii, input.result_key);

        if (chainDepth > this.config.aiJobMaxChain) {
            throw new AiJobError('AI_JOB_CHAIN_TOO_DEEP', 422,
                `This chain has called itself ${chainDepth} times and was stopped; the limit on this node is ${this.config.aiJobMaxChain}.`);
        }

        // The FIRST of the two owner checks on a callback. The second is at fire time, in
        // on-done.ts, because `installedBy` is decided at install and a delete-and-reinstall by
        // another owner outlives this one.
        if (input.on_done) await this.assertCallbackAllowed(ownerGhii, input.on_done.extension, input.on_done.action);

        const queuedForOwner = this.countQueued(ownerGhii);
        if (queuedForOwner >= this.config.aiJobMaxQueuedPerOwner) {
            throw new AiJobError('AI_JOB_LIMIT_REACHED', 429,
                `You have ${queuedForOwner} jobs queued, which is this node's ceiling. Nothing is wrong with the node — something of yours is probably looping. Cancel what you do not need and start again.`);
        }

        if (this.countQueued() >= this.config.aiJobMaxQueued) {
            throw new AiJobError('AI_JOB_QUEUE_FULL', 503,
                'This node is busy: its AI job queue is full. Try again shortly.', RETRY_AFTER_SECONDS);
        }

        // Last, because it is the only gate that reads anything. Throws INVALID_BODY when there is
        // no prompt at all and AI_JOB_PROMPT_TOO_LARGE when the assembly is over the cap.
        const prompt = await assembleJobPrompt({ storage: this.storage, config: this.config }, ownerGhii, input);

        // ── nothing above this line has written anything ──

        const now = new Date().toISOString();
        const job: AiJobRecord = {
            id: randomUUID(),
            state: 'queued',
            owner: ownerGhii,
            ...(input.app_id ? { app_id: input.app_id } : {}),
            ...(ctx.extension ? { extension: ctx.extension } : {}),
            ...(input.prompt ? { prompt: input.prompt } : {}),
            ...(input.prompt_key ? { prompt_key: input.prompt_key } : {}),
            ...(input.input_keys?.length ? { input_keys: input.input_keys } : {}),
            ...(input.model ? { model: input.model } : {}),
            ...(input.system_prompt ? { system_prompt: input.system_prompt } : {}),
            result_key: input.result_key,
            result_visibility: input.result_visibility ?? 'private',
            ...(input.json ? { json: true } : {}),
            ...(input.on_done ? { on_done: input.on_done } : {}),
            chain_depth: chainDepth,
            ...(ctx.parentJob ? { parent_job: ctx.parentJob } : {}),
            queued_at: now,
            created_by: ctx.createdBy,
        };

        const queuePosition = this.pool.positionIfEnqueued();

        let resolveFinished!: () => void;
        const finished = new Promise<void>(resolve => { resolveFinished = resolve; });
        this.live.set(job.id, { job, controller: new AbortController(), prompt, finished, resolveFinished });

        await writeJob(this.storage, job);
        await addToActiveIndex(this.storage, this.config.nodeId, { jobId: job.id, ownerGhii });

        // Not awaited: the whole point is that a start returns before the work does. Nothing in this
        // design ever holds an HTTP request for the duration of a model call.
        void this.run(job.id);

        return { job_id: job.id, state: 'queued', queue_position: queuePosition };
    }

    // ── read ──────────────────────────────────────────────────────────────────

    /** One job by id, live or finished. Null when it is neither — which is also the answer a
     *  stranger gets, because whose jobs exist is not their business. */
    async getJob(ownerGhii: string, jobId: string): Promise<AiJobRecord | AiJobLogEntry | null> {
        const liveRecord = this.live.get(jobId);
        if (liveRecord && liveRecord.job.owner === ownerGhii) return liveRecord.job;
        const stored = await readJob(this.storage, ownerGhii, jobId);
        if (stored) return stored;
        return findInLogs(this.storage, ownerGhii, jobId);
    }

    /** `state` defaults to the live ones, which is what "what am I waiting for" means. */
    async listJobs(
        ownerGhii: string, opts: { state?: AiJobState | 'live' | 'all'; limit?: number } = {},
    ): Promise<Array<AiJobRecord | AiJobLogEntry>> {
        const want = opts.state ?? 'live';
        const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50) || 50, 1), 500);

        const liveJobs = await listLiveJobs(this.storage, ownerGhii);
        let out: Array<AiJobRecord | AiJobLogEntry>;

        if (want === 'live') {
            out = liveJobs.filter(j => j.state === 'queued' || j.state === 'running');
        } else if (want === 'queued' || want === 'running') {
            out = liveJobs.filter(j => j.state === want);
        } else {
            const logged = await listLogged(this.storage, ownerGhii);
            const all = [...liveJobs, ...logged];
            out = want === 'all' ? all : all.filter(j => j.state === want);
        }

        return out
            .sort((a, b) => (b.queued_at ?? '').localeCompare(a.queued_at ?? ''))
            .slice(0, limit);
    }

    // ── cancel ────────────────────────────────────────────────────────────────

    /**
     * Stop a job, queued or running, and answer with the state it actually reached.
     *
     * The abort is the whole mechanism: a queued job's wait for a slot rejects, and a running job's
     * provider call is torn down through the signal threaded into complete(). One writer reaches the
     * terminal state either way — `run()` — so there is no race between a cancel and a completion
     * over which of them gets to fold the record.
     */
    async cancelJob(ownerGhii: string, jobId: string): Promise<AiJobRecord | AiJobLogEntry> {
        const existing = await this.getJob(ownerGhii, jobId);
        if (!existing) throw new AiJobError('NOT_FOUND', 404, 'No such job.');
        if (existing.state !== 'queued' && existing.state !== 'running') {
            throw new AiJobError('AI_JOB_ALREADY_TERMINAL', 409,
                `That job is already ${existing.state}; there is nothing left to stop.`);
        }

        const entry = this.live.get(jobId);
        if (!entry) {
            // Live in storage but not in this process: what a restart leaves behind between the boot
            // and the reconciliation pass. Terminate it here rather than leaving it running for ever.
            const stored = await readJob(this.storage, ownerGhii, jobId);
            if (stored) {
                const cancelled: AiJobRecord = { ...stored, state: 'cancelled', finished_at: new Date().toISOString() };
                await foldIntoLog(this.storage, cancelled);
                await removeFromActiveIndex(this.storage, this.config.nodeId, jobId);
                return cancelled;
            }
            throw new AiJobError('NOT_FOUND', 404, 'No such job.');
        }

        entry.controller.abort();
        await entry.finished;

        const after = await this.getJob(ownerGhii, jobId);
        if (!after) throw new AiJobError('NOT_FOUND', 404, 'No such job.');
        return after;
    }

    // ── the runner ────────────────────────────────────────────────────────────

    private async run(jobId: string): Promise<void> {
        const entry = this.live.get(jobId);
        if (!entry) return;
        const owner = entry.job.owner;

        try {
            await this.pool.acquire(owner, { signal: entry.controller.signal });
        } catch (err) {
            if (err instanceof SlotAbortedError) {
                await this.finish(jobId, { state: 'cancelled' });
                return;
            }
            await this.finish(jobId, {
                state: 'failed',
                error: { code: 'AI_JOB_QUEUE_ERROR', message: (err as Error).message },
            });
            return;
        }

        try {
            entry.job = { ...entry.job, state: 'running', started_at: new Date().toISOString() };
            await writeJob(this.storage, entry.job);

            const result = await completeForOwner(this.storage, this.config, owner, {
                prompt: entry.prompt,
                ...(entry.job.system_prompt ? { systemPrompt: entry.job.system_prompt } : {}),
                ...(entry.job.model ? { model: entry.job.model } : {}),
                ...(entry.job.app_id ? { appId: entry.job.app_id } : {}),
                signal: entry.controller.signal,
                // NO TOKEN CAP. scripts/check-no-max-tokens.ts forbids one: a cap truncates a long
                // generation in silence, and a long generation is the whole point of a background job.
            });

            // The provider answered, so the money is spent and recorded whatever happens next. Carry
            // the numbers onto the job even if it turns out to have been cancelled meanwhile: a
            // cancelled call is not a free call, and a record that dropped them would make the spend
            // charts disagree with the usage row that is already written.
            const spend = {
                cost_usd: result.usage.costUsd,
                tokens: result.usage.totalTokens,
                ...(result.provenance ? { provenance_id: result.provenance.id } : {}),
            };

            if (entry.controller.signal.aborted) {
                await this.finish(jobId, { state: 'cancelled', ...spend });
                return;
            }

            await this.writeResult(entry.job, result.content, result.provenance?.id);

            // The callback, and the reason a green job can still be a failure. See on-done.ts.
            if (entry.job.on_done) {
                const outcome = await fireOnDone(
                    { storage: this.storage, config: this.config, service: this, emailService: this.emailService },
                    { ...entry.job, ...spend, state: 'done' },
                );
                if (!outcome.ok) {
                    await this.finish(jobId, {
                        state: 'failed', ...spend,
                        ...(outcome.chainStopped ? { chain_stopped: outcome.chainStopped } : {}),
                        error: outcome.error,
                    });
                    return;
                }
            }

            await this.finish(jobId, { state: 'done', ...spend });
        } catch (err) {
            if (entry.controller.signal.aborted) {
                await this.finish(jobId, { state: 'cancelled' });
                return;
            }
            const code = err instanceof AiCompletionError ? err.code : 'AI_JOB_FAILED';
            await this.finish(jobId, {
                state: 'failed',
                error: { code, message: (err as Error).message },
            });
        } finally {
            this.pool.release(owner);
        }
    }

    /** Land the answer where the caller said it should go. */
    private async writeResult(job: AiJobRecord, content: string, provenanceId?: string): Promise<void> {
        let value: unknown = content;
        if (job.json) {
            // Parsed HERE when the job asked for JSON, so a malformed answer fails at the job rather
            // than becoming a string every downstream reader has to re-parse and none of them checks.
            const m = /\{[\s\S]*\}|\[[\s\S]*\]/.exec(content);
            if (!m) throw new Error('The job asked for json and the answer contained none.');
            value = JSON.parse(m[0]);
        }

        const existing = await this.storage.getMemory(job.owner, job.result_key);
        const now = new Date().toISOString();
        await this.storage.setMemory({
            key: job.result_key,
            ownerGaii: job.owner,
            value,
            // TARGET-058: the completion already minted an observed record — the node watched the
            // model produce these exact bytes — so it is CARRIED here rather than re-derived. Nobody
            // read the substance on this path, so `humanInvolvement: 'none'` stands untouched.
            ...(provenanceId ? { aiProvenanceId: provenanceId } : {}),
            visibility: job.result_visibility,
            tags: ['ai', 'ai-job-result'],
            ttlHours: null,
            version: existing ? existing.version + 1 : 1,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        });
    }

    /**
     * Reach a terminal state: fold into the day's log, delete the live key, drop the index entry.
     *
     * THE LIVE KEY MUST GO. A key per run fills the 1000-key ceiling in weeks — see store.ts for the
     * arithmetic and for the existing feature that has this defect today.
     */
    private async finish(jobId: string, patch: Partial<AiJobRecord> & { state: AiJobState }): Promise<void> {
        const entry = this.live.get(jobId);
        if (!entry) return;

        const finishedJob: AiJobRecord = { ...entry.job, ...patch, finished_at: new Date().toISOString() };
        this.live.delete(jobId);

        try {
            await foldIntoLog(this.storage, finishedJob);
            await removeFromActiveIndex(this.storage, this.config.nodeId, jobId);
        } catch (err) {
            logger.error(`[ai-jobs] could not fold job ${jobId} into its day log`, { error: String(err) });
        } finally {
            entry.resolveFinished();
        }

        logger.info(`[ai-jobs] ${jobId} ${finishedJob.state} owner=${finishedJob.owner} app=${finishedJob.app_id ?? '_unknown'} cost=$${(finishedJob.cost_usd ?? 0).toFixed(4)}`);
    }

    // ── gates ─────────────────────────────────────────────────────────────────

    /**
     * Where an answer may land. `runAiJob` already refuses a foreign INPUT namespace at run time
     * (services/scheduler-remote-jobs.ts) with the comment explaining why; this is the same check in
     * the other direction, on the write.
     */
    private assertResultKey(ownerGhii: string, key: unknown): void {
        if (typeof key !== 'string' || !key.trim()) {
            throw new AiJobError('INVALID_BODY', 400, 'result_key is required.');
        }
        if (key.includes('::') || key.includes('@')) {
            throw new AiJobError('INVALID_BODY', 400,
                `result_key "${key}" names a namespace. A job writes into its own owner's namespace and nowhere else.`);
        }
        if (isReservedServerKey(key)) {
            throw new AiJobError('INVALID_BODY', 400,
                `result_key "${key}" falls under a prefix this node reads and trusts for behaviour. Pick a key of your own.`);
        }
        void ownerGhii;
    }

    /**
     * A callback may name only an extension installed by the job's OWN owner.
     *
     * Same wording whichever way it fails, deliberately: which extensions exist is not a stranger's
     * business, so "no such extension" and "that one is somebody else's" must read the same.
     */
    private async assertCallbackAllowed(ownerGhii: string, extensionName: string, actionId: string): Promise<void> {
        const ownerName = parseGAII(ownerGhii)?.owner ?? ownerGhii.split('@')[0];
        const refuse = (): never => {
            throw new AiJobError('AI_JOB_CALLBACK_FORBIDDEN', 403,
                `on_done names an extension action this account cannot call: ${extensionName}/${actionId}.`);
        };
        if (!extensionName || !actionId) refuse();
        const ext = await this.storage.getExtension(extensionName);
        if (!ext) refuse();
        if (ext!.installedBy !== ownerName) refuse();
        if (!ext!.actions.some(a => a.id === actionId)) refuse();
    }

    /** Queued jobs, node-wide or for one owner. Counted from this process's own live map, which is
     *  the only place that knows what has been accepted but not yet started. */
    private countQueued(ownerGhii?: string): number {
        let n = 0;
        for (const entry of this.live.values()) {
            if (entry.job.state !== 'queued') continue;
            if (ownerGhii && entry.job.owner !== ownerGhii) continue;
            n++;
        }
        return n;
    }

    // ── restart ───────────────────────────────────────────────────────────────

    /**
     * Job records outlive the process. Anything left `running` has no worker any more and would sit
     * "running" for ever in every view, so it is failed with a named reason; anything left `queued`
     * never started and goes back into the pool.
     *
     * The same shape as WorkflowEngine.resumeInflight(), and for the same reason: a state that only
     * a live process can advance has to be reconciled by the process that replaces it.
     */
    async reconcileAfterRestart(): Promise<{ failed: number; requeued: number }> {
        const refs = await readActiveIndex(this.storage, this.config.nodeId);
        let failed = 0, requeued = 0;

        for (const ref of refs) {
            const job = await readJob(this.storage, ref.ownerGhii, ref.jobId);
            if (!job) { await removeFromActiveIndex(this.storage, this.config.nodeId, ref.jobId); continue; }

            if (job.state === 'running') {
                await foldIntoLog(this.storage, {
                    ...job, state: 'failed', finished_at: new Date().toISOString(),
                    error: { code: 'node_restarted', message: 'The node restarted while this job was running, so its answer was lost. Start it again.' },
                });
                await removeFromActiveIndex(this.storage, this.config.nodeId, ref.jobId);
                failed++;
                continue;
            }

            if (job.state === 'queued') {
                try {
                    // Re-assembled rather than carried: the assembled prompt lives in the dead
                    // process's heap, and the record has the fields it was built from.
                    const prompt = await assembleJobPrompt({ storage: this.storage, config: this.config }, job.owner, job);
                    let resolveFinished!: () => void;
                    const finished = new Promise<void>(resolve => { resolveFinished = resolve; });
                    this.live.set(job.id, { job, controller: new AbortController(), prompt, finished, resolveFinished });
                    void this.run(job.id);
                    requeued++;
                } catch (err) {
                    await foldIntoLog(this.storage, {
                        ...job, state: 'failed', finished_at: new Date().toISOString(),
                        error: { code: 'node_restarted', message: `The node restarted and this queued job could not be rebuilt: ${(err as Error).message}` },
                    });
                    await removeFromActiveIndex(this.storage, this.config.nodeId, ref.jobId);
                    failed++;
                }
                continue;
            }

            // Terminal in storage but still indexed: the fold crashed between the two writes.
            await removeFromActiveIndex(this.storage, this.config.nodeId, ref.jobId);
        }

        if (failed || requeued) {
            logger.info(`[ai-jobs] restart reconciliation: ${failed} failed (node_restarted), ${requeued} requeued`);
        }
        return { failed, requeued };
    }

    /** The nightly prune of the folded day logs, for every owner that has any. */
    async pruneOwnerLogs(ownerGhii: string): Promise<number> {
        return pruneLogs(this.storage, ownerGhii, this.config.aiJobLogRetentionDays);
    }

    /** What the node is doing right now, for the operator surface and the tests. */
    stats(): { slots: number; running: number; waiting: number; live: number } {
        const { slots, running, waiting } = this.pool.stats();
        return { slots, running, waiting, live: this.live.size };
    }
}

/**
 * Process-wide handle to the active service. Set once during service init so surfaces created
 * per-request (the MCP server, the sandbox context) can reach it without threading the instance
 * through every signature — the same shape `getActiveScheduler()` uses.
 */
let _activeAiJobService: AiJobService | null = null;
export function setActiveAiJobService(service: AiJobService): void { _activeAiJobService = service; }
export function getActiveAiJobService(): AiJobService | null { return _activeAiJobService; }
