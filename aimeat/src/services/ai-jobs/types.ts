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
 * @structure AiJobState · AiJobRecord · AiJobLogEntry · StartAiJobInput · AiJobError
 * @usage import type { AiJobRecord } from './types.js';
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial.
 */

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

    result_key: string;
    result_visibility: 'private' | 'owner' | 'public';
    /** Parse the answer as JSON before storing it, so a malformed answer fails HERE rather than
     *  becoming a string every downstream reader has to re-parse and none of them validates. */
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
    error?: { code: string; message: string };
    provenance_id?: string;
    /** The principal that asked for it. Audit, not authority — what a job may do is decided by
     *  `owner`, which is resolved server-side. */
    created_by: string;
}

/**
 * A finished job, folded into `ai.jobs.log.<YYYY-MM-DD>`.
 *
 * The prompt and the input keys are deliberately NOT carried over: the log is a record of what
 * happened and what it cost, the answer itself is at `result_key`, and a day's worth of full
 * prompts would outgrow the 1024 kB a memory value may hold.
 */
export type AiJobLogEntry = Omit<AiJobRecord, 'prompt' | 'input_keys' | 'system_prompt'>;

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
    /** Set when ctx.ai.start() created it. */
    extension?: string;
    parentJob?: string;
    chainDepth?: number;
    onRefused?: (reason: AiJobChainStop) => void;
}

/**
 * The one method the extension capability needs, named as an interface so services/ai-jobs/
 * ext-capability.ts does not have to import the service that imports it back.
 */
export interface AiJobStarter {
    startJob(input: StartAiJobInput, ctx: StartAiJobContext): Promise<StartAiJobResult>;
}
