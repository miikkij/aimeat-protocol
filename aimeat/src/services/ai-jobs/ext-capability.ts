/**
 * @file src/services/ai-jobs/ext-capability.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `ctx.ai.start` — the sandbox's door to a background model call.
 *
 *   WHAT MOVES OUT OF THE EXTENSION IS THE WAITING, NOT THE WORK. The sandbox is still the only
 *   place on this node that runs the owner's own branching server-side logic, and that does not
 *   change. But a model call can take twenty or thirty minutes, and a sandbox waiting that long
 *   holds a QuickJS runtime and an HTTP request for nothing. So the extension starts a job, gets an
 *   id back in milliseconds, and returns; the job runs on the node and, if the extension asked for
 *   it, calls one of the extension's own actions when it is done. The chain logic stays in the
 *   extension's code — there is no engine interpreting a graph.
 *
 *   WHOSE BUDGET: THE EXTENSION'S INSTALLER, NEVER THE CALLER. `ctx.buy` settled this question in
 *   the same context, in words that transfer exactly: billed to the extension's OWNER, because the
 *   caller has no relationship with the supplier and should not acquire one by using the app. The
 *   owner comes from `ctx.extension.owner`, resolved server-side from `ExtensionRecord.installedBy`,
 *   which nothing a caller sends can reach. An extension whose road does not know its record gets NO
 *   `ctx.ai` at all: there is no honest answer to who pays.
 *
 *   IT RETURNS A DECISION, NEVER A THROW. Also `ctx.buy`'s shape and its stated reason: the
 *   extension can degrade instead of dying when the queue is full or a chain has gone too deep.
 * @structure buildExtensionAi(deps) → ExtensionCtx['ai']
 * @usage
 *   const ctx = buildExtensionCtx({ …, ai: buildExtensionAi({ service, extName: ext.name,
 *       ownerGhii, nodeId }) });
 * @version-history
 *   v1.0.1 — 2026-09-05 — ExtensionCtx comes from extension-ctx-contract.ts, the leaf the runtime
 *     re-exports it from; a type import of the runtime itself is an edge the dependency cruiser
 *     counts.
 *   v1.0.0 — 2026-08-31 — Initial.
 */
import type { ExtensionCtx } from '../extension-ctx-contract.js';
import { logger } from '../../utils/logger.js';
import { AiJobError } from './types.js';
import type { AiJobStarter, AiJobChainStop, StartAiJobInput } from './types.js';

export interface ExtensionAiDeps {
    service: AiJobStarter;
    /** The extension's name — becomes `app_id: ext:<name>`, so the spend shows up per app. */
    extName: string;
    /** The INSTALLER's GHII. Whose key pays and whose namespace holds the result. */
    ownerGhii: string;
    /** The principal recorded as having asked. Audit, not authority. */
    createdBy: string;
    /** Present only when this run IS the continuation of a job: its id and depth, and where a
     *  refusal of the next job must be reported. */
    chain?: {
        parentJob: string;
        parentDepth: number;
        onRefused: (reason: AiJobChainStop) => void;
    };
}

/**
 * The live-call convenience: build `ctx.ai` for an ordinary action invocation, or answer `undefined`
 * when this node has no AI-job service running (a build with the routes not mounted, or a test).
 *
 * Deliberately not exported from index.ts's flat surface as "the way to get ctx.ai": every road that
 * calls it must already have the extension RECORD in hand, because `extOwner` is
 * `ExtensionRecord.installedBy` and nothing a caller sends may reach it.
 */
export function maybeExtensionAi(args: {
    service: AiJobStarter | null;
    extName: string;
    /** Bare owner name from the record's `installedBy`. */
    extOwner: string;
    nodeId: string;
    /** The principal that invoked the action, recorded for audit only. */
    createdBy: string;
}): ExtensionCtx['ai'] | undefined {
    if (!args.service) return undefined;
    return buildExtensionAi({
        service: args.service,
        extName: args.extName,
        ownerGhii: `${args.extOwner}@${args.nodeId}`,
        createdBy: args.createdBy,
    });
}

/** The three refusals that mean "the chain could not continue", as opposed to "that request was
 *  wrong". Only these are reported back to the parent job. */
const CHAIN_STOPS: Record<string, AiJobChainStop> = {
    AI_JOB_QUEUE_FULL: 'queue_full',
    AI_JOB_LIMIT_REACHED: 'owner_limit',
    AI_JOB_CHAIN_TOO_DEEP: 'chain_too_deep',
};

export function buildExtensionAi(deps: ExtensionAiDeps): NonNullable<ExtensionCtx['ai']> {
    const { service, extName, ownerGhii, createdBy, chain } = deps;

    return {
        start: async (opts) => {
            const input: StartAiJobInput = {
                ...(typeof opts?.prompt === 'string' ? { prompt: opts.prompt } : {}),
                ...(typeof opts?.prompt_key === 'string' ? { prompt_key: opts.prompt_key } : {}),
                ...(Array.isArray(opts?.input_keys) ? { input_keys: opts.input_keys.filter(k => typeof k === 'string') } : {}),
                result_key: String(opts?.result_key ?? ''),
                ...(opts?.result_visibility ? { result_visibility: opts.result_visibility } : {}),
                ...(typeof opts?.model === 'string' ? { model: opts.model } : {}),
                ...(typeof opts?.system_prompt === 'string' ? { system_prompt: opts.system_prompt } : {}),
                ...(opts?.json ? { json: true } : {}),
                // Per app, so the existing charts and the existing per-app quota already cover it.
                app_id: `ext:${extName}`,
                ...(opts?.on_done ? { on_done: { extension: String(opts.on_done.extension), action: String(opts.on_done.action) } } : {}),
            };

            try {
                const started = await service.startJob(input, {
                    ownerGhii,
                    createdBy,
                    extension: extName,
                    ...(chain ? { parentJob: chain.parentJob, chainDepth: chain.parentDepth + 1 } : {}),
                    ...(chain ? { onRefused: chain.onRefused } : {}),
                });
                return { ok: true, job_id: started.job_id, queue_position: started.queue_position };
            } catch (err) {
                if (err instanceof AiJobError) {
                    // A refusal the PARENT has to know about. The extension is told too, so it can
                    // degrade, but the parent job is what decides whether the chain was completed —
                    // and a chain that stopped here is not a success. See on-done.ts.
                    const stop = CHAIN_STOPS[err.code];
                    if (stop && chain) chain.onRefused(stop);
                    return {
                        ok: false, code: err.code, message: err.message,
                        ...(err.retryAfterSeconds !== undefined ? { retry_after_s: err.retryAfterSeconds } : {}),
                    };
                }
                logger.warn(`[ext:${extName}] ctx.ai.start failed`, { error: String(err) });
                return { ok: false, code: 'AI_JOB_START_FAILED', message: (err as Error).message };
            }
        },
    };
}
