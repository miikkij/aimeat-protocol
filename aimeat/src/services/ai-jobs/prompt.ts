/**
 * @file src/services/ai-jobs/prompt.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Turning what a caller asked for into the one string the model will actually see, and
 *   refusing it when that string is too big.
 *
 *   AN AGENT COULD GO AND READ WHAT IT NEEDED. This model cannot: the prompt string is everything it
 *   will ever see. So the records named in `input_keys` are read HERE and appended, labelled by key,
 *   and a MISSING record is stated out loud rather than left as a silence the model fills in with an
 *   invention. That sentence is not decoration — the first version of the workflow `ai` step asked
 *   the model to read three memory records it had no way to read, and it invented a whole product
 *   with every field plausible (engine-ai-step.ts v1.1.0). This is that fix, in the other place that
 *   needed it.
 *
 *   THE SIZE CAP IS THE REAL BRAKE. One memory value may be 1024 kB, so an unbounded assembly is
 *   megabytes of live heap held for the whole call, multiplied by however many jobs are running. The
 *   socket is nothing next to it.
 * @structure assembleJobPrompt(deps, ownerGhii, spec) → string (throws AI_JOB_PROMPT_TOO_LARGE)
 * @usage const prompt = await assembleJobPrompt({ storage, config }, ownerGhii, job);
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { getOwnerScopeMemory } from '../owner-memory.js';
import { parseGAII } from '../../utils/gaii.js';
import { AiJobError } from './types.js';

export interface PromptSpec {
    prompt?: string;
    prompt_key?: string;
    input_keys?: string[];
}

const asText = (value: unknown): string =>
    typeof value === 'string' ? value : JSON.stringify(value, null, 2);

/**
 * Read a record the way the rest of the owner's own tools read one: owner scope, so a key an agent
 * of theirs wrote is found as readily as one they wrote themselves.
 */
async function readOwnerRecord(
    storage: Storage, nodeId: string, ownerGhii: string, key: string,
): Promise<unknown | undefined> {
    const ownerName = parseGAII(ownerGhii)?.owner ?? ownerGhii.split('@')[0];
    const rec = await getOwnerScopeMemory(storage, nodeId, ownerName, key);
    return rec?.value;
}

/**
 * Build the whole prompt, and refuse it if the result is over the node's cap.
 *
 * `prompt_key` names a record holding the prompt text, so changing a prompt is a memory write rather
 * than a code change. A record whose value is an object carrying `prompt` is accepted too, which is
 * the shape a prompt record usually has once it grows a title.
 */
export async function assembleJobPrompt(
    deps: { storage: Storage; config: AimeatConfig },
    ownerGhii: string,
    spec: PromptSpec,
): Promise<string> {
    const { storage, config } = deps;

    let prompt = typeof spec.prompt === 'string' ? spec.prompt : '';

    if (spec.prompt_key) {
        const value = await readOwnerRecord(storage, config.nodeId, ownerGhii, spec.prompt_key);
        const fromRecord = typeof value === 'string'
            ? value
            : (value && typeof value === 'object' && typeof (value as { prompt?: unknown }).prompt === 'string'
                ? (value as { prompt: string }).prompt
                : '');
        if (!fromRecord) {
            throw new AiJobError('INVALID_BODY', 400, `prompt_key "${spec.prompt_key}" holds no prompt text.`);
        }
        prompt = fromRecord;
    }

    if (!prompt) {
        throw new AiJobError('INVALID_BODY', 400, 'A job needs prompt or prompt_key.');
    }

    if (spec.input_keys?.length) {
        const parts: string[] = [];
        for (const key of spec.input_keys) {
            const value = await readOwnerRecord(storage, config.nodeId, ownerGhii, key);
            // The missing case, stated. Copied deliberately, wording and all, from the workflow ai
            // step: a model asked to use a record it cannot see will make one up, and every field of
            // the invention will look right.
            parts.push(value === undefined
                ? `### ${key}\n(no such record — do not invent its contents)`
                : `### ${key}\n${asText(value)}`);
        }
        prompt += `\n\n---\nINPUT DATA. This is the whole of what you have been given; anything not\nstated here is unknown, and unknown is reported, never filled in.\n\n${parts.join('\n\n')}\n`;
    }

    const bytes = Buffer.byteLength(prompt, 'utf8');
    if (bytes > config.aiJobMaxPromptBytes) {
        const mb = (n: number) => `${(n / 1_048_576).toFixed(2)} MB`;
        throw new AiJobError('AI_JOB_PROMPT_TOO_LARGE', 413,
            `The prompt and its inputs came to ${mb(bytes)}; the limit on this node is ${mb(config.aiJobMaxPromptBytes)}. Read fewer records, or read a smaller one.`);
    }

    return prompt;
}
