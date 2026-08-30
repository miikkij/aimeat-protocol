/**
 * @file src/mcp/catalog/definitions/ai-jobs.ts
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
 * @usage imported by mcp/catalog/definitions.ts
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial.
 */
import { type AimeatToolDefinition, agentEverywhere } from './types.js';

export const aiJobTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_ai_job_start',
        description: 'Start a BACKGROUND model call and get a handle back in milliseconds. Use this instead of a normal completion whenever the answer may take minutes: the job queues for a slot, runs on this node with the owner\'s own key and budget, and writes its answer to the memory key you name in `result_key`. It answers at once with a job id and a queue position — never an ETA, because model latency is unknown — so read the job back with aimeat_ai_job_get, or just read `result_key` once it says done. Give it `prompt`, or `prompt_key` naming a record that holds the prompt text. `input_keys` names memory records that are READ AND PASTED INTO the prompt, labelled by key: the model has no tools and cannot fetch anything itself, and a record that does not exist is stated as missing rather than left as a silence it would fill in with an invention. `on_done` calls one of the owner\'s own extension actions when the answer has landed, which is how a chain of jobs is built; if that callback cannot run, the job ends failed rather than done. There is no token cap, on purpose.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            prompt: { type: 'string', description: 'The prompt. Required unless prompt_key names a record holding it.' },
            prompt_key: { type: 'string', description: 'An owner memory key holding the prompt text (a string, or an object with a `prompt` field), so changing the prompt is a memory write rather than a code change.' },
            input_keys: { type: 'array', description: 'Memory keys read and appended to the prompt, labelled by key. This is the ONLY way the model sees stored data — it has no tools.' },
            result_key: { type: 'string', required: true, description: 'Where the answer is written, in the owner\'s own namespace. A key naming another namespace, or one the server reads and trusts for behaviour, is refused.' },
            result_visibility: { type: 'string', description: 'Visibility of the record written at result_key. Default private.', enum: ['private', 'owner', 'public'] },
            model: { type: 'string', description: 'Explicit model id. Omit to use the owner\'s configured model.' },
            system_prompt: { type: 'string', description: 'Optional system prompt.' },
            json: { type: 'boolean', description: 'Parse the answer as JSON before storing it, so a malformed answer fails the job instead of becoming a string every reader has to re-parse.' },
            app_id: { type: 'string', description: 'App attribution — enables the owner\'s per-app allowlist and per-app daily quota.' },
            on_done: { type: 'object', description: '{ extension, action } — an extension action of the job\'s OWN owner, invoked with { job_id, state, result_key } when the job finishes.' },
        },
    },
    {
        name: 'aimeat_ai_job_list',
        description: 'List the owner\'s background AI jobs. Defaults to the LIVE ones (queued and running), which is what "what am I still waiting for" means. A finished job is folded into its day\'s log and shows up under state="all" or under its own state; its live record is deleted at that point, because one key per run would fill this node\'s per-account key ceiling within weeks. Use before starting another job to see whether the one you want is already running.',
        caller: 'agent',
        visibility: agentEverywhere,
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
        input: {
            job_id: { type: 'string', required: true, description: 'The job id from aimeat_ai_job_start.' },
        },
    },
    {
        name: 'aimeat_ai_job_cancel',
        description: 'Stop a background AI job. A queued one leaves the wait line and nothing is spent; a running one has its provider call torn down, so a stuck long call can be cleared instead of waited out. Whatever the provider had already billed stays recorded — a cancelled call is not a free call. A job that has already finished answers that there is nothing left to stop.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            job_id: { type: 'string', required: true, description: 'The job id to stop.' },
        },
    },
];
