/**
 * @file src/services/ai-jobs/service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The queue, the handle and the callback — everything an AI job is that a plain model
 *   call is not. ONE implementation, called by the four REST routes, the four MCP tools on all three
 *   surfaces, and `ctx.ai.start` in the sandbox, so the refusals and the bookkeeping happen where
 *   they were written once.
 *
 *   THE MODEL CALL ITSELF IS NOT NEW. `completeForOwner`, `generateForOwner` and
 *   `transcribeForOwner` already pick the key, enforce the daily budget and the per-app quota,
 *   record per-app usage and stamp provenance; run-op.ts calls the one the job's `op` names. Nothing
 *   here duplicates any of that; it is the runner.
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
 *   v1.17.0 -- 2026-10-25 -- finish() tells the finished-job listeners (finished-listeners.ts).
 *   v1.16.0 -- 2026-10-22 -- The start and a restart hold the job's inputs to its viewer (starter.ts
 *     jobReadViewer) and keep `read_as` (secaudit 2026-10, r49, v75).
 *   v1.15.0 — 2026-10-21 — A gated image job's private picture gets its publish request after the
 *     answer's record is written, as a part of the record's request (picture-request.ts), so one press
 *     decides both; on its own when the record asked nothing, failed or the job was cancelled.
 *   v1.14.0 — 2026-10-21 — Every use that worked before keeps working (the developer's rule for the
 *     round): the answer's write starts no trigger or recipe (`noTriggers`), as before; what the
 *     write would refuse and the start can know (organism key, archived record, a schema lock that
 *     cannot take the op's answer, key ceiling, byte quota) is refused at the start, before any cost
 *     (result-precheck.ts); the on_done refusal tells an app's author what to declare
 *     (starter.ts onDoneScopeRefusal), and published apps that bind on_done keep ext:invoke
 *     (services/app-on-done-keep-migration.ts).
 *   v1.13.0 — 2026-10-20 — The answer is written through the shared memory write
 *     (services/memory-write.ts writeMemoryRecord) as the job's starter (starter.ts jobWriter), with
 *     gatePublic: a raise to public by a caller the node asks the owner about stays private and files
 *     a publish request, the closed-node level and the label audience cap apply, and an `organism.*`
 *     result key is held to the organism namespace rule, which the start also asks before anything
 *     is written. The job records the version and the visibility actually stored. It was a raw
 *     storage write at the caller's chosen visibility (secaudit 2026-10,
 *     writeResult:raw-write-caller-chosen-visibility; the organism case is record v66). `on_done`
 *     from a starter that is not the owner in person needs ext:invoke, refused 403 SCOPE_DENIED at
 *     the start; ctx.ai.start keeps working (secaudit 2026-10, assertCallbackAllowed:on-done-asks-no-ext-invoke).
 *   v1.12.0 — 2026-10-20 — `getJob`, `listJobs` and `cancelJob` take a `viewer` (types.ts AiJobViewer):
 *     a caller that does not read as the owner sees and stops only the jobs it started. The MCP tools
 *     look the OWNER's namespace up, so without it an agent holding ai:use read its owner's and its
 *     siblings' job prompts and cancelled their running jobs, while the REST twin answered 404
 *     (secaudit 2026-10, mcp/ai-jobs.ts:registerAiJobTools:jobs-keyed-by-owner-ghii).
 *   v1.11.0 — 2026-10-19 — A text job's record carries `finish_reason` and `truncated` once the model
 *     answered (wish ai-jobs-run-uncapped-and-report-a-cut-answer).
 *   v1.10.1 — 2026-10-18 — The job record is stored once the answer is written, so result_version
 *     survives a restart during on_done and ctx.ai.result still reads the answer after it.
 *   v1.10.0 — 2026-10-18 — `readResult`, the service side of `ctx.ai.result(job_id)`: an extension
 *     reads the answer of a job it started, which `on_done` also receives in its input. The job keeps
 *     the version of the record it wrote (`result_version`), and writes the answer on the version it
 *     read, so that number names one value.
 *   v1.9.0 — 2026-10-08 — A failed job's error keeps the refusal's status and details (aiprov plan, A11).
 *   v1.8.1 — 2026-10-06 — ctx.ai.start is counted too; only a chain's continuation is exempt
 *     (secaudit 2026-10 follow-up, A5).
 *   v1.8.0 — 2026-10-05 — The AI call limit is counted per account in the service, so the MCP tools share it (secaudit 2026-10, C5).
 *     A start answers 429 RATE_LIMITED with a Retry-After past it; ctx.ai.start passes `limit: 'exempt'`.
 *   v1.7.0 — 2026-09-30 — The warning-classified items a job gives its model are kept on the job
 *     (`classification_warnings`): the prompt's records at the start, which the start answer names
 *     too, and a transcription's audio when it runs (TARGET-082 review, item 2).
 *   v1.6.0 — 2026-09-29 — A job records who started it (`started_by`, from ctx.startedBy) and its
 *     prompt is assembled with that starter's reader; a job with none reads as an AI (starter.ts,
 *     TARGET-082 V4).
 *   v1.5.0 — 2026-09-29 — The prompt is assembled with the node's classification reader (TARGET-082).
 *   v1.4.0 — 2026-09-28 — A job may name a `role`, the AI role its call runs as; op.ts refuses one that
 *     is not a string of 1 to 300 characters, before the record exists.
 *   v1.3.0 — 2026-09-28 — System 2 plan, V5: a job has an `op` (text, image, transcribe) and may name
 *     a `provider`. The start refuses a field that does not apply to the op (op.ts), and for a
 *     transcription it refuses an `audio_key` that is not in the owner's own storage, both before
 *     the record exists. The model call moved to run-op.ts; the result write, the spend and the
 *     provenance are the same for every op. A job's own refusal code (AiJobError) is kept on a
 *     failed job, beside the completion service's.
 *   v1.2.1 — 2026-09-26 — The job owner's account name comes from localAccountName (utils/gaii.ts),
 *     which keeps an identity of another node whole, so it never names the local namesake
 *     (secaudit 2026-09, F-1).
 *   v1.2.0 — 2026-09-26 — A job reads no record the node keeps for itself and writes its answer over
 *     none (services/ai-job-keys.ts, the rule the scheduled AI job asks too): prompt_key, input_keys
 *     and result_key are asked at the start and again when a restart brings a queued job back. A
 *     reserved result_key answers 403 RESERVED_KEY, as the memory doors do
 *     (secaudit 2026-09: 573704db10ed).
 *   v1.1.0 — 2026-09-20 — An agent's job is paid by its owner, in the agent's name (aiPayerOf), as
 *     POST /v1/ai/complete pays. The job and its result stay in the caller's namespace.
 *   v1.0.0 — 2026-08-31 — Initial.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { EmailService } from '../email.js';
import { CAS_ATTEMPTS } from '../record-cas.js';
import { SlotPool, SlotAbortedError } from '../slot-pool.js';
import { AiCompletionError } from '../ai/completion.js';
import { aiJobKeyRefusal } from '../ai-job-keys.js';
import { localAccountName } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { assembleJobPrompt } from './prompt.js';
import { jobReader, jobWriter, jobReadViewer, starterMayInvokeExtensions, onDoneScopeRefusal } from './starter.js';
import { writeMemoryRecord } from '../memory-write.js';
import { resultWriteRefusal } from './result-precheck.js';
import { warningsNote } from '../classification/reader.js';
import { presentMemory } from '../classification/present-memory.js';
import { fireOnDone } from './on-done.js';
import { aiOpOf, aiOpRefusal } from './op.js';
import { runJobOp, assertAudioInReach, type JobOpOutcome } from './run-op.js';
import { fileJobPictureRequest } from './picture-request.js';
import { takeAiCall } from '../account-limits.js';
import { emitAiJobFinished } from './finished-listeners.js';
import {
    readJob, writeJob, foldIntoLog, findInLogs, listLiveJobs, listLogged, pruneLogs,
    readActiveIndex, addToActiveIndex, removeFromActiveIndex,
} from './store.js';
import {
    AiJobError,
    type AiJobRecord, type AiJobState, type AiJobLogEntry, type AiJobClassificationWarnings,
    type StartAiJobInput, type StartAiJobContext, type StartAiJobResult, type AiJobStarter,
    type AiJobResultRead, type AiJobViewer,
} from './types.js';

/** How long a caller is asked to wait after a queue-full refusal. A guess would be worse than a
 *  round number: what it really says is "shortly", and Retry-After has no way to say that. */
const RETRY_AFTER_SECONDS = 30;

/**
 * Whether this viewer may see this job. No viewer means the caller's own key IS the lookup key (the
 * REST routes resolve the principal) or the caller is the node itself, so there is nothing to fence.
 * A viewer that does not read as the owner sees only what it started: `created_by` is the audit
 * trail, and it is the only field that says which principal asked for the job.
 */
const visibleToViewer = (job: { created_by: string }, viewer?: AiJobViewer): boolean =>
    !viewer || viewer.all || job.created_by === viewer.principal;

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
        this.assertKeysInReach(input);
        this.assertOpFields(input);
        const op = aiOpOf(input.op);

        if (chainDepth > this.config.aiJobMaxChain) {
            throw new AiJobError('AI_JOB_CHAIN_TOO_DEEP', 422,
                `This chain has called itself ${chainDepth} times and was stopped; the limit on this node is ${this.config.aiJobMaxChain}.`);
        }

        // Where the answer lands, asked as the shared memory write will ask it when the answer is
        // written (services/memory-write.ts): an `organism.*` key the starter may not write, an
        // archived record, a schema lock that cannot take this op's answer, the key ceiling and the
        // byte quota are refused here, before any money is spent, rather than failing the job after
        // the model call (result-precheck.ts).
        const resultRefusal = await resultWriteRefusal({ storage: this.storage, config: this.config }, {
            ownerGhii, key: input.result_key, op, ...(input.json ? { json: true } : {}),
            ...(ctx.startedBy ? { startedBy: ctx.startedBy } : {}),
        });
        if (resultRefusal) throw new AiJobError(resultRefusal.code, resultRefusal.status, resultRefusal.message);

        if (input.on_done) {
            // Who may bind a callback at all. The action runs unattended in the owner's name, which
            // costs ext:invoke on every other code path (POST /v1/ext/:ext/:action, a workflow
            // extension step), so ai:use alone does not buy it. The owner in person and ctx.ai.start
            // in an extension (no starter recorded) pass.
            if (!starterMayInvokeExtensions(ctx.startedBy)) {
                throw new AiJobError('SCOPE_DENIED', 403, onDoneScopeRefusal(ctx.startedBy));
            }
            // The FIRST of the two owner checks on a callback. The second is at fire time, in
            // on-done.ts, because `installedBy` is decided at install and a delete-and-reinstall by
            // another owner outlives this one.
            await this.assertCallbackAllowed(ownerGhii, input.on_done.extension, input.on_done.action);
        }

        const queuedForOwner = this.countQueued(ownerGhii);
        if (queuedForOwner >= this.config.aiJobMaxQueuedPerOwner) {
            throw new AiJobError('AI_JOB_LIMIT_REACHED', 429,
                `You have ${queuedForOwner} jobs queued, which is this node's ceiling. Nothing is wrong with the node — something of yours is probably looping. Cancel what you do not need and start again.`);
        }

        if (this.countQueued() >= this.config.aiJobMaxQueued) {
            throw new AiJobError('AI_JOB_QUEUE_FULL', 503,
                'This node is busy: its AI job queue is full. Try again shortly.', RETRY_AFTER_SECONDS);
        }

        // Last, because these are the only gates that read anything. The prompt assembly throws
        // INVALID_BODY when there is no prompt at all and AI_JOB_PROMPT_TOO_LARGE when the assembly is
        // over the cap. A transcription has no prompt: its read is the audio file's metadata, which
        // answers 404 for a key that is not in the owner's own storage.
        const { prompt, warnings } = await this.prepareInput(ownerGhii, {
            ...input, op, ...(ctx.startedBy ? { started_by: ctx.startedBy } : {}), ...(ctx.readAs ? { read_as: ctx.readAs } : {}),
        });

        // The account's AI call limit (services/account-limits.ts): POST /v1/ai/jobs and
        // aimeat_ai_job_start both arrive here and draw on one count per account, and so does
        // ctx.ai.start in an extension. Only a chain's continuation is 'exempt' (its first start was
        // counted); the run itself is not counted again (run-op.ts).
        if (ctx.limit !== 'exempt') {
            const turn = takeAiCall(this.config, ownerGhii);
            if (!turn.ok) throw new AiJobError(turn.code, 429, turn.message, turn.retryAfterSec);
        }

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
            op,
            ...(input.provider ? { provider: input.provider } : {}),
            ...(input.role ? { role: input.role } : {}),
            ...(input.audio_key ? { audio_key: input.audio_key } : {}),
            ...(input.language ? { language: input.language } : {}),
            ...(input.size ? { size: input.size } : {}),
            result_key: input.result_key,
            result_visibility: input.result_visibility ?? 'private',
            ...(input.json ? { json: true } : {}),
            ...(input.on_done ? { on_done: input.on_done } : {}),
            chain_depth: chainDepth,
            ...(ctx.parentJob ? { parent_job: ctx.parentJob } : {}),
            queued_at: now,
            created_by: ctx.createdBy,
            ...(ctx.startedBy ? { started_by: ctx.startedBy } : {}),
            ...(ctx.readAs ? { read_as: ctx.readAs } : {}),
            ...(warnings ? { classification_warnings: warnings } : {}),
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

        return { job_id: job.id, state: 'queued', queue_position: queuePosition, ...(warnings ? { classification_warnings: warnings } : {}) };
    }

    // ── read ──────────────────────────────────────────────────────────────────

    /** One job by id, live or finished. Null when it is neither — which is also the answer a
     *  stranger gets, and the answer a `viewer` that did not start this job gets, because whose jobs
     *  exist is not their business and a live record carries the prompt. */
    async getJob(ownerGhii: string, jobId: string, viewer?: AiJobViewer): Promise<AiJobRecord | AiJobLogEntry | null> {
        const found = await this.findJob(ownerGhii, jobId);
        return found && visibleToViewer(found, viewer) ? found : null;
    }

    /** The job itself, with no viewer fence. Private: every caller goes through getJob. */
    private async findJob(ownerGhii: string, jobId: string): Promise<AiJobRecord | AiJobLogEntry | null> {
        const liveRecord = this.live.get(jobId);
        if (liveRecord && liveRecord.job.owner === ownerGhii) return liveRecord.job;
        const stored = await readJob(this.storage, ownerGhii, jobId);
        if (stored) return stored;
        return findInLogs(this.storage, ownerGhii, jobId);
    }

    /**
     * The answer of a job, for the extension that started it. The answer lands in the OWNER's
     * namespace, which the sandbox cannot read, and making it public to reach it would publish
     * private content. So the job itself is the permission: the extension named on it (as starter
     * or as `on_done`) reads that one record, and only the version the job wrote.
     *
     * This opens nothing an extension could not already reach: it chose the prompt and the inputs
     * the model saw, and it could always have asked for `result_visibility: 'public'`.
     */
    async readResult(ownerGhii: string, jobId: string, extension: string): Promise<AiJobResultRead> {
        const notFound: AiJobResultRead = { ok: false, code: 'AI_JOB_NOT_FOUND', message: `No job "${jobId}" started by this extension.` };
        if (!jobId) return notFound;
        const job = await this.getJob(ownerGhii, jobId);
        if (!job || (job.extension !== extension && job.on_done?.extension !== extension)) return notFound;

        const base = { ok: true as const, job_id: job.id, state: job.state, result_key: job.result_key };
        if (job.result_version === undefined) return base;
        const record = await this.storage.getMemory(job.owner, job.result_key);
        // Through the job's own classification reader, the one its inputs were read with
        // (starter.ts): a label the owner put on the answer since applies, and what it hides reads
        // as absent, as it does to ctx.memory.getPublic.
        const shown = record && record.version === job.result_version
            ? await presentMemory(jobReader({ storage: this.storage, config: this.config }, job), record)
            : null;
        if (!shown) {
            return { ok: false, code: 'AI_JOB_RESULT_GONE', message: `The answer at "${job.result_key}" is no longer there: the record was deleted or written again after the job wrote it.` };
        }
        return { ...base, value: shown.value };
    }

    /** `state` defaults to the live ones, which is what "what am I waiting for" means. A `viewer`
     *  that does not read as the owner is shown only the jobs it started. */
    async listJobs(
        ownerGhii: string, opts: { state?: AiJobState | 'live' | 'all'; limit?: number; viewer?: AiJobViewer } = {},
    ): Promise<Array<AiJobRecord | AiJobLogEntry>> {
        const want = opts.state ?? 'live';
        const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50) || 50, 1), 500);

        const liveJobs = (await listLiveJobs(this.storage, ownerGhii)).filter(j => visibleToViewer(j, opts.viewer));
        let out: Array<AiJobRecord | AiJobLogEntry>;

        if (want === 'live') {
            out = liveJobs.filter(j => j.state === 'queued' || j.state === 'running');
        } else if (want === 'queued' || want === 'running') {
            out = liveJobs.filter(j => j.state === want);
        } else {
            const logged = (await listLogged(this.storage, ownerGhii)).filter(j => visibleToViewer(j, opts.viewer));
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
     *
     * THE VIEWER IS CHECKED BEFORE ANYTHING IS ABORTED. Stopping somebody else's job is a write, so
     * it is held to the same rule as the read: a `viewer` that did not start the job is refused with
     * the same 404 a read answers, and the job keeps running.
     */
    async cancelJob(ownerGhii: string, jobId: string, viewer?: AiJobViewer): Promise<AiJobRecord | AiJobLogEntry> {
        const existing = await this.getJob(ownerGhii, jobId, viewer);
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

        // No viewer here: the cancel was authorized above, and this read only reports the state the
        // job reached.
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

        // A picture stored private while making it public waits for the owner (picture-request.ts):
        // its request is filed once, as a part of the record's request or on its own.
        let picture: JobOpOutcome['picturePublish'];
        const filePicture = async (recordRequestId?: string) => {
            const pending = picture;
            picture = undefined;
            await fileJobPictureRequest({ storage: this.storage, config: this.config }, pending, recordRequestId);
        };
        try {
            entry.job = { ...entry.job, state: 'running', started_at: new Date().toISOString() };
            await writeJob(this.storage, entry.job);

            // The job and its result stay in the CALLER's namespace; the money is the human's. An
            // agent's job is paid by its owner, in the agent's name, exactly as POST /v1/ai/complete
            // pays (services/agent-ai-keys.ts aiPayerOf, applied in run-op.ts), so the two code
            // paths cannot disagree on a key. No token cap: see run-op.ts.
            const outcome = await runJobOp(
                { storage: this.storage, config: this.config }, entry.job, entry.prompt, entry.controller.signal,
            );

            // The provider answered, so the money is spent and recorded whatever happens next. Carry
            // the numbers onto the job even if it turns out to have been cancelled meanwhile: a
            // cancelled call is not a free call, and a record that dropped them would make the spend
            // charts disagree with the usage row that is already written.
            const spend = outcome.spend;
            picture = outcome.picturePublish;
            // What the call itself read (a transcription's audio) joins what the prompt held.
            if (outcome.warnings?.length) {
                const had = entry.job.classification_warnings ?? [];
                const more = outcome.warnings.filter(w => !had.some(h => h.key === w.key));
                entry.job = { ...entry.job, classification_warnings: [...had, ...more] };
            }
            // Why the provider stopped, and whether the text was cut at a token limit: on the record
            // from here on, so every finish below (done, failed in on_done, cancelled) keeps it.
            if (outcome.answer) entry.job = { ...entry.job, ...outcome.answer };

            if (entry.controller.signal.aborted) {
                await filePicture();
                await this.finish(jobId, { state: 'cancelled', ...spend });
                return;
            }

            const written = await this.writeResult(entry.job, outcome.value, outcome.parseJson, spend.provenance_id);
            await filePicture(written.requestId);
            // Before the callback, so readResult already hands the answer to the on_done action.
            // Stored too, not only kept in this process: a restart during on_done folds the stored
            // record into the log, and ctx.ai.result reads the answer from there. The visibility is
            // the one STORED, so a raise to public that waits for the owner reads as what it is.
            entry.job = { ...entry.job, result_version: written.version, result_visibility: written.visibility };
            await writeJob(this.storage, entry.job);

            // The callback, and the reason a green job can still be a failure. See on-done.ts.
            if (entry.job.on_done) {
                const outcome = await fireOnDone(
                    { storage: this.storage, config: this.config, service: this, emailService: this.emailService },
                    { ...entry.job, ...spend, state: 'done' },
                    written.value,
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
            // The picture exists and stays private: its request is still the owner's to answer.
            await filePicture();
            if (entry.controller.signal.aborted) {
                await this.finish(jobId, { state: 'cancelled' });
                return;
            }
            const typed = err instanceof AiCompletionError || err instanceof AiJobError ? err : undefined;
            // The status and details a REST call would have answered (a provider's 422 with its
            // provider_status and provider_message), so a reader of the job can tell a refusal that
            // repeats from one worth retrying (aiprov plan, A11).
            const details = err instanceof AiCompletionError ? err.details : undefined;
            await this.finish(jobId, {
                state: 'failed',
                error: {
                    code: typed ? typed.code : 'AI_JOB_FAILED', message: (err as Error).message,
                    ...(typed ? { status: typed.status } : {}), ...(details ? { details } : {}),
                },
            });
        } finally {
            this.pool.release(owner);
        }
    }

    /** Land the answer where the caller said it should go. `parseJson` is set for a text answer
     *  the job asked JSON of; an image record and a transcription arrive in their final shape.
     *  Answers with the value stored, the version it was stored at and the visibility it got. */
    private async writeResult(
        job: AiJobRecord, answer: unknown, parseJson: boolean, provenanceId?: string,
    ): Promise<{ value: unknown; version: number; visibility: AiJobRecord['result_visibility']; requestId?: string }> {
        let value: unknown = answer;
        if (parseJson) {
            // Parsed HERE when the job asked for JSON, so a malformed answer fails at the job rather
            // than becoming a string every downstream reader has to re-parse and none of them checks.
            const content = typeof answer === 'string' ? answer : '';
            const m = /\{[\s\S]*\}|\[[\s\S]*\]/.exec(content);
            if (!m) throw new Error('The job asked for json and the answer contained none.');
            value = JSON.parse(m[0]);
        }

        // THROUGH THE SHARED MEMORY WRITE, as the job's starter (starter.ts jobWriter). A raw storage
        // write here stored the answer at whatever visibility the caller asked: an agent without
        // publish:public made its answer public with no request to the owner, past the closed-node
        // level and the label audience cap, and wrote an `organism.*` key the organism namespace
        // rule refuses it on POST /v1/memory (secaudit 2026-10). `gatePublic` asks the publish gate,
        // which keeps the record at the level it had and files the request; the job records what
        // was stored. `ai:use` is the word this write answers to, the one the start already asked.
        //
        // Written on the version read, so the version the job records (result_version) is the one
        // its answer holds: a concurrent writer makes this read again instead of being overwritten
        // under a version number that then names two different values.
        const writer = jobWriter(job);
        for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
            const existing = await this.storage.getMemory(job.owner, job.result_key);
            const written = await writeMemoryRecord({ storage: this.storage, config: this.config }, writer, {
                key: job.result_key,
                value,
                visibility: job.result_visibility,
                tags: ['ai', 'ai-job-result'],
                ttlHours: null,
                expectedVersion: existing?.version ?? 0,
                authorisingScope: 'ai:use',
                gatePublic: true,
                // As before the answer came through here: it starts no workflow trigger, Tracked
                // Response, connector push, ecosystem push or automation recipe. A chain of work
                // after a job is what on_done is for.
                noTriggers: true,
                pipeline: `ai-job:${job.id}`,
                // TARGET-058: the completion already minted an observed record — the node watched the
                // model produce these exact bytes — so it is CARRIED here rather than re-derived. Nobody
                // read the substance on this path, so `humanInvolvement: 'none'` stands untouched.
                ...(provenanceId ? { declaredProvenanceId: provenanceId } : {}),
            });
            if (written.ok) {
                return {
                    value, version: written.record.version, visibility: written.record.visibility,
                    // The record's own publish request, which a picture's request joins as a part.
                    ...(written.publishRequest ? { requestId: written.publishRequest.request_id } : {}),
                };
            }
            if (written.code === 'VERSION_CONFLICT') continue;
            throw new AiJobError(written.code, written.status, written.message);
        }
        throw new Error(`The record at "${job.result_key}" changed under every one of ${CAS_ATTEMPTS} attempts to write the answer.`);
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
        // A feature that started the job hears it finish (finished-listeners.ts): agent goals settle
        // the work the node's model did. After the log, so a listener reads the job as stored.
        await emitAiJobFinished(finishedJob);
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
        void ownerGhii;
    }

    /**
     * What a job reads into its prompt and where it writes its answer: none of the records the node
     * keeps for itself. The one rule both kinds of AI job ask (services/ai-job-keys.ts). Asked at the
     * start and again when a restart brings a queued job back, so a job stored before the rule is
     * held to it too; the prompt assembly asks once more at the read.
     */
    private assertKeysInReach(spec: { prompt_key?: string; input_keys?: string[]; result_key: string }): void {
        const refusal = aiJobKeyRefusal({ promptKey: spec.prompt_key, inputKeys: spec.input_keys, outputKey: spec.result_key });
        if (refusal) throw new AiJobError(refusal.code, refusal.status, refusal.message);
    }

    /**
     * The fields go with the op (op.ts): an unknown op, an image with no prompt or with `json`, a
     * transcription with no `audio_key`, and a field of one op given to another are refused. A pure
     * check, so it runs with the other pure checks at the top of the start.
     */
    private assertOpFields(input: StartAiJobInput | AiJobRecord): void {
        const why = aiOpRefusal(input);
        if (why) throw new AiJobError('INVALID_BODY', 400, why);
    }

    /**
     * The reads a job needs before it may queue, and what the runner is handed: the assembled prompt
     * for text and image, nothing for a transcription (whose audio is checked here and read again
     * when it runs, see run-op.ts). Used by the start and by the restart path, so both hold a job to
     * the same reads.
     */
    private async prepareInput(
        ownerGhii: string,
        spec: Pick<AiJobRecord, 'op' | 'prompt' | 'prompt_key' | 'input_keys' | 'audio_key' | 'started_by' | 'read_as'>,
    ): Promise<{ prompt: string; warnings?: AiJobClassificationWarnings }> {
        const deps = { storage: this.storage, config: this.config };
        // Which same-owner records and files the model may be handed (starter.ts jobReadViewer).
        const viewer = jobReadViewer(spec);
        if (aiOpOf(spec.op) === 'transcribe') {
            await assertAudioInReach(deps, ownerGhii, spec.audio_key ?? '', viewer);
            return { prompt: '' };
        }
        // The job reads as whoever started it; a job with no starter recorded reads as an unattended
        // AI run (starter.ts). The same reader at the start and when a restart rebuilds the prompt.
        const reader = jobReader(deps, { owner: ownerGhii, started_by: spec.started_by });
        const prompt = await assembleJobPrompt(deps, reader, ownerGhii, spec, viewer);
        // The warning-classified records the prompt holds go on the job, so the caller is told.
        const warnings = warningsNote(reader).classification_warnings;
        return { prompt, ...(warnings ? { warnings } : {}) };
    }

    /**
     * A callback may name only an extension installed by the job's OWN owner.
     *
     * Same wording whichever way it fails, deliberately: which extensions exist is not a stranger's
     * business, so "no such extension" and "that one is somebody else's" must read the same.
     */
    private async assertCallbackAllowed(ownerGhii: string, extensionName: string, actionId: string): Promise<void> {
        const ownerName = localAccountName(ownerGhii);
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
                // With result_version the answer was written and only the on_done action was cut
                // off: the answer stays readable (ctx.ai.result), so the message must not say lost.
                const message = job.result_version !== undefined
                    ? 'The node restarted while this job\'s on_done action was running. The answer was written and can be read; the action did not finish.'
                    : 'The node restarted while this job was running, so its answer was lost. Start it again.';
                await foldIntoLog(this.storage, {
                    ...job, state: 'failed', finished_at: new Date().toISOString(),
                    error: { code: 'node_restarted', message },
                });
                await removeFromActiveIndex(this.storage, this.config.nodeId, ref.jobId);
                failed++;
                continue;
            }

            if (job.state === 'queued') {
                try {
                    // Held to the start's rule about the keys first: a job queued before the rule
                    // existed must not come back reading or writing a record the node keeps.
                    this.assertKeysInReach(job);
                    this.assertOpFields(job);
                    // Re-assembled rather than carried: the assembled prompt lives in the dead
                    // process's heap, and the record has the fields it was built from.
                    const { prompt, warnings } = await this.prepareInput(job.owner, job);
                    if (warnings) job.classification_warnings = warnings;
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
