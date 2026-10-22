/**
 * @file src/services/ai-jobs/types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an AI job IS: the record, the refusals, and the shape a caller asks with.
 *
 *   An AI job is a background model call with a handle. You start it, you get an id back
 *   immediately, it queues for a slot, it runs on this node with the owner's own key, and it writes
 *   its answer to a memory key you named. Nothing about the model call itself is new —
 *   `completeForOwner` already picks the key, enforces the daily budget and the per-app quota,
 *   records per-app usage and stamps provenance. What is new is the queue, the handle and the
 *   callback.
 * @structure AiJobState · AiJobRecord · AiJobStartedBy · AiJobLogEntry · AiJobViewer · StartAiJobInput ·
 *   AiJobError · AiJobResultRead · AiJobStarter
 * @usage import type { AiJobRecord } from './types.js';
 * @version-history
 *   v1.12.0 -- 2026-10-22 -- `read_as` on the record and `readAs` on the start context: the principal
 *     an extension's ctx.ai.start reads the owner scope as, when narrower than the owner (secaudit
 *     2026-10, v75).
 *   v1.11.0 — 2026-10-20 — `result_visibility` on the record is the level the answer was STORED at,
 *     which the shared memory write decides (a raise to public waiting for the owner keeps the level
 *     the record had; a closed node stores 'members'), and `started_by.federated` marks a visitor from another node
 *     (secaudit 2026-10, ai-jobs/service.ts:writeResult:raw-write-caller-chosen-visibility).
 *   v1.10.0 — 2026-10-20 — AiJobViewer: who is asking after a job, so a read or a cancel can be held to
 *     the jobs that principal started (secaudit 2026-10, ai-jobs.ts:jobs-keyed-by-owner-ghii).
 *   v1.9.0 — 2026-10-19 — `finish_reason` and `truncated` on the record of a text job, so job get and
 *     waitFor say when an answer was cut (wish ai-jobs-run-uncapped-and-report-a-cut-answer).
 *   v1.8.0 — 2026-10-18 — `result_version` on the record and `readResult` on AiJobStarter, so an
 *     extension reads the answer of a job it started without the answer being public (ctx.ai.result).
 *   v1.7.0 — 2026-10-08 — AiJobRecord.error carries `status` and `details` (aiprov plan, A11).
 *   v1.6.1 — 2026-10-06 — StartAiJobContext.limit is 'exempt' only for a chain's continuation
 *     (secaudit 2026-10 follow-up, A5).
 *   v1.6.0 — 2026-10-05 — The AI call limit is counted per account in the service, so the MCP tools share it (secaudit 2026-10, C5).
 *     StartAiJobContext.limit: 'exempt' for ctx.ai.start.
 *   v1.5.0 — 2026-10-05 — `started_by.app`: the app an app grant names, so the job's model call runs
 *     as that app (secaudit 2026-10, AI-3).
 *   v1.4.0 — 2026-09-30 — `classification_warnings` on the record and on the start answer: the
 *     warning-classified items the job gave its model (TARGET-082 review, item 2).
 *   v1.3.0 — 2026-09-29 — `started_by` on the record and `startedBy` on the start context: the
 *     starter's credential facts, so the job reads its inputs as that caller (TARGET-082 V4).
 *   v1.2.0 — 2026-09-28 — `role`, the AI role the job's call runs as, on the record and on the start input.
 *   v1.1.0 — 2026-09-28 — System 2 plan, V5: `op` (text, image, transcribe), `audio_key` and
 *     `language` for a transcription, `size` for an image, and `provider` for every operation, on the
 *     record and on the start input.
 *   v1.0.0 — 2026-08-31 — Initial.
 */
import type { AiOp } from './op.js';
import type { warningsNote } from '../classification/reader.js';
import type { AiCallLimitMark } from '../account-limits.js';
import type { MemoryRecord } from '../../storage/interface.js';

export type { AiOp as AiJobOp } from './op.js';

/** The warning-classified items a model was given, as warningsNote (classification/reader.ts) names them. */
export type AiJobClassificationWarnings = NonNullable<ReturnType<typeof warningsNote>['classification_warnings']>;

export type AiJobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/** Why a chain stopped. Only ever one of the three enqueue REFUSALS: an action that threw, or an
 *  extension that had been uninstalled, fails the parent with an `error` instead. */
export type AiJobChainStop = 'queue_full' | 'chain_too_deep' | 'owner_limit';

export interface AiJobOnDone {
    extension: string;
    action: string;
}

export interface AiJobRecord {
    id: string;
    state: AiJobState;
    /** GHII whose key pays and whose namespace holds the result. */
    owner: string;
    /** For the per-app quota and the per-app usage row. `ext:<name>` for a job an extension started. */
    app_id?: string;
    /** Set when ctx.ai.start() created it. */
    extension?: string;

    prompt?: string;
    /** Owner-namespace key holding the prompt text. */
    prompt_key?: string;
    /** Records read and appended to the prompt, labelled by key. */
    input_keys?: string[];
    model?: string;
    system_prompt?: string;
    /** Which model call the job makes. Absent on a record written before V5, which means `text`. */
    op?: AiOp;
    /** A provider the job names, an id or a type. Naming one turns fallback off (route-plan.ts). */
    provider?: string;
    /** The AI role the job's call runs as (services/ai/roles.ts). A named model or provider wins over it. */
    role?: string;
    /** For `transcribe`: the storage key of the audio, in the job owner's own storage. */
    audio_key?: string;
    /** For `transcribe`: an ISO-639-1 hint. */
    language?: string;
    /** For `image`: a provider-specific size string, e.g. '1024x1024'. */
    size?: string;

    result_key: string;
    /** The level asked for until the answer is written, then the level it was STORED at: the shared
     *  memory write (services/memory-write.ts) keeps a raise to public at the level the record had
     *  (a new one: private) while the owner is asked, and stores 'members' on a node that shows its
     *  content to signed-in accounts only. */
    result_visibility: MemoryRecord['visibility'];
    /** The version of the record at `result_key` that this job wrote. Set once the answer is
     *  written, which is before `on_done` runs. `readResult` hands the answer out only while the
     *  record is still this version: a later write to the same key is somebody else's data. */
    result_version?: number;
    /** Parse the answer as JSON before storing it, so a malformed answer fails HERE rather than
     *  becoming a string every downstream reader has to re-parse and none of them validates. For a
     *  transcription it stores `{ text, language, seconds, model }` in place of the bare text. */
    json?: boolean;

    on_done?: AiJobOnDone;
    /** 0 for a job a human or an app started. */
    chain_depth: number;
    parent_job?: string;
    chain_stopped?: AiJobChainStop;

    queued_at: string;
    started_at?: string;
    finished_at?: string;
    cost_usd?: number;
    tokens?: number;
    /** For a `text` job, once the model answered: why the provider stopped ('stop', 'length',
     *  'content_filter', …), or null when it did not say. Absent on the other ops and on a job that
     *  never got an answer. */
    finish_reason?: string | null;
    /** For a `text` job, once the model answered: true when the answer was cut at a token limit
     *  (finish_reason 'length'), which a reader cannot otherwise tell from a finished answer. */
    truncated?: boolean;
    /** `status` and `details` are what the REST call would have answered (since 2026-10-08). */
    error?: { code: string; message: string; status?: number; details?: Record<string, unknown> };
    provenance_id?: string;
    /** The principal that asked for it. Audit, not authority — what a job may do is decided by
     *  `owner`, which is resolved server-side. */
    created_by: string;
    /** Who started it, as classification needs it to read the job's inputs as that caller
     *  (starter.ts jobReader). Absent on a job started before 2026-09-29, by an extension, or by a
     *  chain: such a job reads as an unattended AI run, the strictest reader. */
    started_by?: AiJobStartedBy;
    /** Who the job reads its prompt record, input records and audio file AS, when that is narrower
     *  than the owner: the principal that wrote an extension's code, on a run the owner narrowed to
     *  it or on that principal's own invoke (ext-capability.ts). Used only to decide which same-owner
     *  records and files the job may read (starter.ts jobReadViewer); who pays, who writes the answer
     *  and who may bind on_done still read `owner` and `started_by`. */
    read_as?: AiJobStartedBy;
    /** The warning-classified items the job gave its model: the prompt's records when the job was
     *  started, the audio when it ran. Absent when there were none. */
    classification_warnings?: AiJobClassificationWarnings;
}

/**
 * The starter's credential facts, taken from the verified credential when the job is created, never
 * from the request body. Only what a reader is rebuilt from: never a token, and nothing here grants
 * the job anything (what it may do is still decided by `owner`).
 */
export interface AiJobStartedBy {
    /** The resolved identity (resolveIdentity): an owner's GHII, an agent's GAII. */
    principal: string;
    /** The bare account name the credential acts for (`req.auth.owner`). */
    owner: string;
    roles: string[];
    scopes: string[];
    /** 'pat' when the credential was made from a personal access token (auth/jwt.ts). */
    via?: string;
    /** The app an app grant names (`owner/file.html`), when an app started the job. The job's
     *  model call then runs as that app, under the owner's rules for it (secaudit 2026-10, AI-3). */
    app?: string;
    /** A session from another node (isForeignPrincipal): a visitor is never the owner in person,
     *  whatever its role list says. */
    federated?: boolean;
}

/**
 * A finished job, folded into `ai.jobs.log.<YYYY-MM-DD>`.
 *
 * The prompt and the input keys are deliberately NOT carried over: the log is a record of what
 * happened and what it cost, the answer itself is at `result_key`, and a day's worth of full
 * prompts would outgrow the 1024 kB a memory value may hold.
 */
export type AiJobLogEntry = Omit<AiJobRecord, 'prompt' | 'input_keys' | 'system_prompt'>;

/**
 * Who is asking after a job, on a surface that looks the owner's namespace up rather than the
 * caller's own. A live job record carries `prompt` and `system_prompt`, so a read is not a neutral
 * act: an agent of the owner sees and stops only the jobs it started itself, which is what the REST
 * routes already do by resolving the principal (routes/ai-jobs.ts). `all` is the owner in person, an
 * app grant of the owner, and an agent holding `memory:read-as-owner`, the one word that lets a
 * scoped agent read the owner's and its siblings' private records (services/owner-scope-read.ts).
 *
 * Omitting the viewer reads everything in the namespace. That is right for the callers whose key IS
 * the principal (the REST routes) and for the node's own paths (restart reconciliation, log pruning,
 * an extension's ctx.ai.result, which fences on the job's own extension instead).
 */
export interface AiJobViewer {
    /** The principal asking: an agent's GAII, or the owner's GHII for the owner in person. */
    principal: string;
    /** True when this caller sees every job of the owner and of the owner's agents. */
    all: boolean;
}

/** What a caller asks for. `owner` and `created_by` are resolved server-side and are never read
 *  from a request body — see the routes and services/ai-jobs/service.ts. */
export interface StartAiJobInput {
    prompt?: string;
    prompt_key?: string;
    input_keys?: string[];
    result_key: string;
    result_visibility?: 'private' | 'owner' | 'public';
    model?: string;
    system_prompt?: string;
    json?: boolean;
    app_id?: string;
    on_done?: AiJobOnDone;
    /** Any string here: the start checks it against AI_OPS (op.ts) and refuses an unknown one. */
    op?: AiOp | string;
    provider?: string;
    role?: string;
    audio_key?: string;
    language?: string;
    size?: string;
}

/**
 * A refusal with the code and status the door reports.
 *
 * The four job-specific ones mean four different things and only one of them is normal:
 *   AI_JOB_QUEUE_FULL     503 — the node's wait line is full. Busy; come back shortly.
 *   AI_JOB_LIMIT_REACHED  429 — THIS owner has too many queued. Something is probably looping.
 *   AI_JOB_CHAIN_TOO_DEEP 422 — a chain called itself too many times and was stopped.
 *   AI_JOB_PROMPT_TOO_LARGE 413 — the assembled inputs came to more than the cap.
 * They join the named-code family the SDK already exposes (QUOTA_EXHAUSTED, APP_QUOTA_EXHAUSTED,
 * RATE_LIMITED, SPEND_CANCELLED, JSON_SCHEMA_MISMATCH).
 */
export class AiJobError extends Error {
    code: string;
    status: number;
    /** Seconds, for the one refusal that means "try again" — sent as Retry-After. */
    retryAfterSeconds?: number;

    constructor(code: string, status: number, message: string, retryAfterSeconds?: number) {
        super(message);
        this.name = 'AiJobError';
        this.code = code;
        this.status = status;
        if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
    }
}

/** What a start answers with. `queue_position` and never an ETA: model latency is unknown, so a
 *  number of seconds would be invented. */
export interface StartAiJobResult {
    job_id: string;
    state: AiJobState;
    queue_position: number;
    /** The warning-classified records the assembled prompt holds. Absent when there were none. */
    classification_warnings?: AiJobClassificationWarnings;
}

/**
 * Everything about a start that the CALLER does not get to decide.
 *
 * `owner` is resolved server-side through resolveIdentity and is whose key pays; `createdBy` names
 * the principal that asked, for the audit trail and for nothing else. A chain adds its parent and
 * its depth, and `onRefused` is how a refusal of the NEXT job reaches the parent that tried to start
 * it — see services/ai-jobs/on-done.ts for why a chain that could not continue must not be green.
 */
export interface StartAiJobContext {
    ownerGhii: string;
    createdBy: string;
    /** The starter's credential facts (REST and MCP starts). Omitted: the job reads as an AI. */
    startedBy?: AiJobStartedBy;
    /** Set when ctx.ai.start() created it. */
    extension?: string;
    /** The principal the extension's code reads as, when narrower than the owner (AiJobRecord.read_as). */
    readAs?: AiJobStartedBy;
    parentJob?: string;
    chainDepth?: number;
    onRefused?: (reason: AiJobChainStop) => void;
    /** 'exempt' for a start that continues a chain (ctx.ai.start in an on_done callback), whose first
     *  start was counted; absent, the start counts against the account's AI call limit
     *  (services/account-limits.ts). */
    limit?: AiCallLimitMark;
}

/**
 * What `ctx.ai.result(job_id)` answers. `value` is present once the answer is written, which is
 * already true inside the job's own `on_done` action, while `state` still reads `running` there.
 * A job this extension did not start, or one of another owner, is `AI_JOB_NOT_FOUND`, the same
 * answer a job that does not exist gets. `AI_JOB_RESULT_GONE`: the record at `result_key` was
 * deleted or written again after the job wrote it.
 */
export type AiJobResultRead =
    | { ok: true; job_id: string; state: AiJobState; result_key: string; value?: unknown }
    | { ok: false; code: 'AI_JOB_NOT_FOUND' | 'AI_JOB_RESULT_GONE' | 'AI_JOB_RESULT_FAILED'; message: string };

/**
 * The two methods the extension capability needs, named as an interface so services/ai-jobs/
 * ext-capability.ts does not have to import the service that imports it back.
 */
export interface AiJobStarter {
    startJob(input: StartAiJobInput, ctx: StartAiJobContext): Promise<StartAiJobResult>;
    /** The answer of a job `extension` started (or names as its `on_done`) for `ownerGhii`. */
    readResult(ownerGhii: string, jobId: string, extension: string): Promise<AiJobResultRead>;
}
