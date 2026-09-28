/**
 * @file src/services/ai-jobs/op.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What kind of model call a background AI job or a workflow `ai` step makes, and the
 *   one rule that says which fields go with which kind.
 *
 *   Three operations, one field `op`:
 *     - `text` (the default): a completion; the answer is text, or parsed JSON when `json` is set.
 *     - `image`: one picture from the assembled prompt; the result is the record
 *       `{ storage_key, url, mime_type, model }`, so `json` does not apply.
 *     - `transcribe`: speech-to-text over `audio_key`, a file in the caller's own storage; no prompt.
 *
 *   ONE RULE FOR EVERY CALLER. POST /v1/ai/jobs, the aimeat_ai_job_start MCP tool, ctx.ai.start and
 *   the workflow `ai` step all ask `aiOpRefusal`, so a field that does not apply to the operation is
 *   refused with a message on every code path. A field accepted and then ignored is a call that
 *   returns ok having done less than it was asked, which this repository has had to fix several
 *   times.
 *
 *   Pure: it reads no storage and imports nothing, so models/workflow-ai-step.ts can use it in the
 *   step's save-time schema.
 * @structure AiOp · AI_OPS · aiOpOf(op) · aiOpRefusal(spec) → string | null
 * @usage
 *   const why = aiOpRefusal(input);
 *   if (why) throw new AiJobError('INVALID_BODY', 400, why);
 * @version-history
 *   v1.1.0 — 2026-09-28 — `role`, the AI role the call runs as, on any op: a string of 1 to 300 characters.
 *   v1.0.0 — 2026-09-28 — Initial (System 2 plan, V5).
 */

export type AiOp = 'text' | 'image' | 'transcribe';

export const AI_OPS: readonly AiOp[] = ['text', 'image', 'transcribe'];

/** The fields the rule reads. Typed `unknown` because it runs before any caller's own type checks. */
export interface AiOpFields {
    op?: unknown;
    prompt?: unknown;
    prompt_key?: unknown;
    input_keys?: unknown;
    system_prompt?: unknown;
    json?: unknown;
    audio_key?: unknown;
    language?: unknown;
    size?: unknown;
    /** The AI role the call runs as (services/ai/roles.ts); any op. */
    role?: unknown;
}

/** The longest role name a job or a step may give; the same bound the AI routes hold (readCallRole). */
const ROLE_MAX_CHARS = 300;

/** The operation a request names, `text` when it names none. Call after aiOpRefusal accepted it. */
export function aiOpOf(op: unknown): AiOp {
    return typeof op === 'string' && (AI_OPS as readonly string[]).includes(op) ? op as AiOp : 'text';
}

const given = (v: unknown): boolean => v !== undefined && v !== null && v !== '';

/**
 * Why this combination of fields cannot run, or null when it can.
 *
 * What is refused: an unknown `op`; an image with no prompt; `json` or `system_prompt` on an image;
 * a transcription with no `audio_key`, or with a prompt (it has none to send); `audio_key` or
 * `language` on anything but a transcription; `size` on anything but an image. A text call with no
 * prompt is refused by the prompt assembly, as it was before `op` existed. On any op, a `role` that is
 * not a string of 1 to 300 characters.
 */
export function aiOpRefusal(spec: AiOpFields): string | null {
    const op = spec.op ?? 'text';
    if (typeof op !== 'string' || !(AI_OPS as readonly string[]).includes(op)) {
        return `op must be one of ${AI_OPS.join(', ')}; got ${JSON.stringify(op)}.`;
    }
    const hasPrompt = given(spec.prompt) || given(spec.prompt_key);

    if (op === 'image') {
        if (!hasPrompt) return 'An image needs prompt or prompt_key: the prompt describes the picture.';
        if (spec.json) return 'json does not apply to an image: the result is always the record { storage_key, url, mime_type, model }.';
        if (given(spec.system_prompt)) return 'system_prompt does not apply to an image: put the whole description in prompt.';
    }

    if (op === 'transcribe') {
        if (typeof spec.audio_key !== 'string' || !spec.audio_key.trim()) {
            return 'A transcription needs audio_key: the storage key of an audio file in your own storage.';
        }
        const inputKeys = Array.isArray(spec.input_keys) && spec.input_keys.length > 0;
        if (hasPrompt || inputKeys || given(spec.system_prompt)) {
            return 'A transcription sends the audio at audio_key and no prompt: leave out prompt, prompt_key, input_keys and system_prompt.';
        }
    }

    if (op !== 'transcribe' && (given(spec.audio_key) || given(spec.language))) {
        return 'audio_key and language apply only to op "transcribe".';
    }
    if (op !== 'image' && given(spec.size)) return 'size applies only to op "image".';
    if (spec.role !== undefined && spec.role !== null
        && (typeof spec.role !== 'string' || spec.role.length < 1 || spec.role.length > ROLE_MAX_CHARS)) {
        return `role must be a string of 1 to ${ROLE_MAX_CHARS} characters: one of your AI roles, or for an app a role it declares.`;
    }
    return null;
}
