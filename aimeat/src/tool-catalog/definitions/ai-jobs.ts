/**
 * @file src/tool-catalog/definitions/ai-jobs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalog entries for the four AI-job tools: start one, list them, read one, stop one.
 *
 *   These four exist on THREE surfaces — the node MCP (src/mcp/ai-jobs.ts), the connector MCP
 *   (src/cli/connect/mcp/tools/ai-jobs.ts) and the CLI dispatch behind /local/call
 *   (src/cli/connect/tool-call-defs-ai-jobs.ts) — and this file is the one description each of them
 *   reads through `descriptionFor()`. `check:mcp-tools` proves the NAMES match, `check:mcp-schemas`
 *   proves the PARAMETERS match, and test/unit/cli-tool-param-forwarding.test.ts proves every
 *   parameter published here actually leaves the process on the third surface, which is the one a
 *   fleet daemon calls and the one a parameter has three times been silently dropped on.
 * @structure aiJobTools -- AimeatToolDefinition[]
 * @usage imported by tool-catalog/definitions.ts
 * @version-history
 *   2026-10-05 — The group is declared `as const satisfies`, its exact field schemas are here, and each
 *     definition carries its annotations, scope and surfaces (secaudit 2026-10, M3).
 *   v1.3.0 — 2026-09-28 — aimeat_ai_job_start takes `role`, the AI role the call runs as.
 *   v1.2.0 — 2026-09-28 — System 2 plan, V5: aimeat_ai_job_start takes `op` (text, image,
 *     transcribe), `provider`, `audio_key`, `language` and `size`.
 *   v1.1.0 — 2026-09-26 — input_keys and result_key say a record the node keeps for itself is
 *     refused with RESERVED_KEY (services/ai-job-keys.ts).
 *   v1.0.0 — 2026-08-31 — Initial.
 */
import { z } from 'zod';
import { type AimeatToolDefinition, agentEverywhere } from './types.js';
import { AI_ROLE_PARAM } from './ai-models.js';

export const aiJobTools = [
    {
        name: 'aimeat_ai_job_start',
        description: 'Start a BACKGROUND model call and get a handle back in milliseconds. Use this instead of a normal completion whenever the answer may take minutes: the job queues for a slot, runs on this node with the owner\'s own key and budget, and writes its answer to the memory key you name in `result_key`. It answers at once with a job id and a queue position — never an ETA, because model latency is unknown — so read the job back with aimeat_ai_job_get, or just read `result_key` once it says done. Give it `prompt`, or `prompt_key` naming a record that holds the prompt text. `input_keys` names memory records that are READ AND PASTED INTO the prompt, labelled by key: the model has no tools and cannot fetch anything itself, and a record that does not exist is stated as missing rather than left as a silence it would fill in with an invention. `on_done` calls one of the owner\'s own extension actions when the answer has landed, which is how a chain of jobs is built; if that callback cannot run, the job ends failed rather than done. There is no token cap, on purpose. `op` picks the kind of call: "text" (the default) writes the answer; "image" makes one picture from the prompt, stores it in the owner\'s storage and writes the record { storage_key, url, mime_type, model }; "transcribe" turns the audio file at `audio_key` (in your own storage) into text and writes the transcript, or { text, language, seconds, model } with `json`. A field that does not apply to the op is refused before anything is written.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Start AI Job', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        // Background AI jobs. The same word as every other door that spends the owner's AI budget --
        // starting one IS a completion, only with a handle instead of a held request. Reading and
        // cancelling take it too: a job is the owner's own AI activity, and the routes admit exactly
        // who assertAiUseAllowed admits.
        scope: 'ai:use',
        surfaces: ['appdev', 'agent'],
        input: {
            prompt: { type: 'string', description: 'The prompt. Required unless prompt_key names a record holding it.' },
            prompt_key: { type: 'string', description: 'An owner memory key holding the prompt text (a string, or an object with a `prompt` field), so changing the prompt is a memory write rather than a code change.' },
            input_keys: { type: 'array', description: 'Memory keys read and appended to the prompt, labelled by key. This is the ONLY way the model sees stored data — it has no tools. A key naming a record this node keeps for itself (an AI key, a payout setting, a spend limit) is refused with RESERVED_KEY, because everything read goes to the model provider.', zod: z.array(z.string()) },
            result_key: { type: 'string', required: true, description: 'Where the answer is written, in the owner\'s own namespace. A key naming another namespace is refused, and so is a record this node keeps for itself (RESERVED_KEY).' },
            result_visibility: { type: 'string', description: 'Visibility of the record written at result_key. Default private.', enum: ['private', 'owner', 'public'] },
            model: { type: 'string', description: 'Explicit model id. Omit to use the owner\'s configured model.' },
            system_prompt: { type: 'string', description: 'Optional system prompt.' },
            json: { type: 'boolean', description: 'Parse the answer as JSON before storing it, so a malformed answer fails the job instead of becoming a string every reader has to re-parse.' },
            app_id: { type: 'string', description: 'App attribution — enables the owner\'s per-app allowlist and per-app daily quota.' },
            on_done: { type: 'object', description: '{ extension, action } — an extension action of the job\'s OWN owner, invoked with { job_id, state, result_key } when the job finishes.', zod: z.object({ extension: z.string(), action: z.string() }) },
            op: { type: 'string', description: 'The kind of model call. "text" (default): a completion. "image": one picture from the prompt; json does not apply. "transcribe": speech-to-text over audio_key; no prompt.', enum: ['text', 'image', 'transcribe'] },
            provider: { type: 'string', description: 'A provider to use, by id or by type. Naming one turns fallback to another provider off. Omit to let the owner\'s rules choose.' },
            audio_key: { type: 'string', description: 'For op "transcribe" (required there): the storage key of an audio file in your own storage. A key that is not there is refused with NOT_FOUND before the job is written.' },
            language: { type: 'string', description: 'For op "transcribe": an ISO-639-1 language hint, e.g. "fi". Omit to use the owner\'s setting or auto-detect.' },
            size: { type: 'string', description: 'For op "image": a provider-specific size, e.g. "1024x1024".' },
            role: { type: 'string', description: AI_ROLE_PARAM, zod: z.string().min(1).max(300) },
        },
    },
    {
        name: 'aimeat_ai_job_list',
        description: 'List the owner\'s background AI jobs. Defaults to the LIVE ones (queued and running), which is what "what am I still waiting for" means. A finished job is folded into its day\'s log and shows up under state="all" or under its own state; its live record is deleted at that point, because one key per run would fill this node\'s per-account key ceiling within weeks. Use before starting another job to see whether the one you want is already running.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List AI Jobs', readOnlyHint: true },
        scope: 'ai:use',
        surfaces: ['appdev', 'agent'],
        input: {
            state: { type: 'string', description: 'Which jobs to list. "live" (the default) is queued + running.', enum: ['queued', 'running', 'done', 'failed', 'cancelled', 'live', 'all'] },
            limit: { type: 'number', description: 'How many to return (1-500, default 50).' },
        },
    },
    {
        name: 'aimeat_ai_job_get',
        description: 'Read one background AI job: its state, what it cost, where its answer went, and — when it failed — the code and message saying why. A job that ended `failed` with `chain_stopped` set is one whose on_done callback could not continue the chain, which is deliberately NOT reported as success. Only the owner\'s own jobs are reachable; anything else is simply not found.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Get AI Job', readOnlyHint: true },
        scope: 'ai:use',
        surfaces: ['appdev', 'agent'],
        input: {
            job_id: { type: 'string', required: true, description: 'The job id from aimeat_ai_job_start.' },
        },
    },
    {
        name: 'aimeat_ai_job_cancel',
        description: 'Stop a background AI job. A queued one leaves the wait line and nothing is spent; a running one has its provider call torn down, so a stuck long call can be cleared instead of waited out. Whatever the provider had already billed stays recorded — a cancelled call is not a free call. A job that has already finished answers that there is nothing left to stop.',
        caller: 'agent',
        visibility: agentEverywhere,
        // Destructive: it stops work the owner asked for, and a cancelled job cannot be resumed.
        annotations: { title: 'Cancel AI Job', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'ai:use',
        surfaces: ['appdev', 'agent'],
        input: {
            job_id: { type: 'string', required: true, description: 'The job id to stop.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
