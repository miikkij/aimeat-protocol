/**
 * @file src/services/ai-jobs/on-done.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The callback: a finished job invokes ONE of its owner's own extension actions with
 *   `{ job_id, state, result_key }`, and that action reads the results and may start more jobs.
 *
 *   WHO MAY BE CALLED: only an extension installed by the JOB'S OWN OWNER, checked TWICE — once at
 *   enqueue (services/ai-jobs/service.ts) and again here at fire time. Twice rather than once
 *   because `installedBy` is decided at install, and a delete-and-reinstall by a different owner
 *   outlives the first check. The workflow `extension` step names this exact case in its own comment
 *   and checks it in both places for the same reason: pointing one at somebody else's extension is
 *   an unlimited standing call on their capability, their API keys and their quota. The fire-time
 *   check is not written here — it belongs to `runExtensionActionAsSystem`, which has refused a
 *   cross-owner extension since it was extracted, and which is the reason this file calls that
 *   function rather than the sandbox directly.
 *
 *   A BROKEN CHAIN IS A FAILURE, NOT A SUCCESS. If `on_done` cannot run — the extension was
 *   uninstalled, the action threw, or the next job it tried to start was refused — the parent job
 *   ends `failed`, and when the reason was one of the three enqueue refusals it also records
 *   `chain_stopped`. This is the whole lesson of the input_keys/keyPrefix defect fixed in
 *   engine-ai-step.ts v1.2.0 on 2026-08-30: a step went green while its downstream read the wrong
 *   data, and nothing anywhere said so. Green and wrong is the worst available outcome, and a
 *   half-finished chain reporting success is the same shape.
 * @structure OnDoneOutcome · fireOnDone(deps, job)
 * @usage const outcome = await fireOnDone({ storage, config, service, emailService }, job);
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { EmailService } from '../email.js';
import { runExtensionActionAsSystem } from '../extension-system-run.js';
import { parseGAII } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { buildExtensionAi } from './ext-capability.js';
import type { AiJobRecord, AiJobChainStop, AiJobStarter } from './types.js';

export interface OnDoneDeps {
    storage: Storage;
    config: AimeatConfig;
    service: AiJobStarter;
    emailService?: EmailService;
}

/**
 * What the callback did. `ok: false` fails the parent job; `chainStopped` is set only when the
 * reason was one of the three enqueue refusals, because "the queue was full" and "your action threw"
 * are different things to whoever reads the record afterwards.
 */
export type OnDoneOutcome =
    | { ok: true }
    | { ok: false; chainStopped?: AiJobChainStop; error: { code: string; message: string } };

export async function fireOnDone(deps: OnDoneDeps, job: AiJobRecord): Promise<OnDoneOutcome> {
    const { storage, config, service, emailService } = deps;
    if (!job.on_done) return { ok: true };

    const ownerName = parseGAII(job.owner)?.owner ?? job.owner.split('@')[0];

    // Where a refusal of the NEXT job lands. Filled in by ctx.ai.start while the action is running,
    // read after it returns — an action may swallow the decision it was handed, and the chain still
    // stopped.
    let chainStopped: AiJobChainStop | undefined;

    try {
        await runExtensionActionAsSystem({ storage, config, emailService }, {
            extensionName: job.on_done.extension,
            actionId: job.on_done.action,
            input: { job_id: job.id, state: job.state, result_key: job.result_key },
            // The owner's own name rather than a machine's: this call acts in their name, on their
            // extension, with their key behind it, and naming them is more honest.
            callerGaii: job.owner,
            ownerName,
            storageOwnerGhii: job.owner,
            logLabel: `ai-job:${job.id.slice(0, 8)}`,
            producerKind: 'extension',
            producerRef: `${job.on_done.extension}/${job.on_done.action}`,
            ai: buildExtensionAi({
                service,
                extName: job.on_done.extension,
                ownerGhii: job.owner,
                createdBy: job.owner,
                chain: {
                    parentJob: job.id,
                    parentDepth: job.chain_depth,
                    onRefused: (reason) => { chainStopped = reason; },
                },
            }),
        });
    } catch (err) {
        const message = (err as Error).message || 'the on_done action failed';
        logger.warn(`[ai-jobs] on_done failed for job ${job.id}`, {
            owner: job.owner, extension: job.on_done.extension, action: job.on_done.action, error: message,
        });
        return { ok: false, error: { code: 'AI_JOB_CALLBACK_FAILED', message } };
    }

    if (chainStopped) {
        return {
            ok: false,
            chainStopped,
            error: {
                code: 'AI_JOB_CHAIN_STOPPED',
                message: `The on_done action ran, but the job it tried to start next was refused (${chainStopped}). The chain did not finish.`,
            },
        };
    }

    return { ok: true };
}
