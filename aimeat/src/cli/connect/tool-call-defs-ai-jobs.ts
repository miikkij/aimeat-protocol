/**
 * @file cli/connect/tool-call-defs-ai-jobs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The four AI-job tools for the shell / local-call dispatch: start one, list them,
 *   read one, stop one.
 *
 *   THIS IS THE THIRD SURFACE, and it is the one a fleet daemon actually calls. A parameter added to
 *   the node MCP and the connector MCP does not exist here until it is written here, and until 2026
 *   it was dropped in silence rather than refused — the call succeeded having done less than it was
 *   asked, which nobody investigates. Every field below is forwarded, and
 *   test/unit/cli-tool-param-forwarding.test.ts invokes each handler against a recording client to
 *   prove it left the process.
 * @structure aiJobTools[] -- the shell handler table, registered by tool-call.ts
 * @usage import { aiJobTools } from './tool-call-defs-ai-jobs.js';
 * @version-history
 *   v1.0.0 -- 2026-08-31 -- Initial.
 */
import type { ConnectCliToolDefinition, JsonObject } from './tool-call-helpers.js';
import {
    requiredString, optionalString, optionalNumber, optionalBoolean, optionalArray, optionalRecord,
} from './tool-call-helpers.js';

export const aiJobTools: ConnectCliToolDefinition[] = [
    {
        // → POST /v1/ai/jobs — 202, and it returns before the model call starts.
        name: 'aimeat_ai_job_start',
        description: 'Start a background AI job: a model call with a handle. Answers at once with a job id and a queue position; the answer lands at `result_key` when it is done.',
        input: {
            prompt: { type: 'string', description: 'The prompt. Required unless prompt_key names a record holding it.' },
            prompt_key: { type: 'string', description: 'An owner memory key holding the prompt text.' },
            input_keys: { type: 'array', description: 'Memory keys read and pasted into the prompt, labelled by key.' },
            result_key: { type: 'string', required: true, description: 'Where the answer is written, in the owner\'s own namespace.' },
            result_visibility: { type: 'string', description: 'private | owner | public (default private).' },
            model: { type: 'string', description: 'Explicit model id; omit for the owner\'s configured model.' },
            system_prompt: { type: 'string', description: 'Optional system prompt.' },
            json: { type: 'boolean', description: 'Parse the answer as JSON before storing it.' },
            app_id: { type: 'string', description: 'App attribution — per-app allowlist and daily quota.' },
            on_done: { type: 'object', description: '{ extension, action } of the job\'s OWN owner, invoked when it finishes.' },
        },
        handler: ({ client }, input) => {
            const inputKeys = optionalArray(input, 'input_keys');
            const onDone = optionalRecord(input, 'on_done');
            const json = optionalBoolean(input, 'json');
            const body: JsonObject = { result_key: requiredString(input, 'result_key') };
            const prompt = optionalString(input, 'prompt');
            const promptKey = optionalString(input, 'prompt_key');
            const visibility = optionalString(input, 'result_visibility');
            const model = optionalString(input, 'model');
            const systemPrompt = optionalString(input, 'system_prompt');
            const appId = optionalString(input, 'app_id');
            if (prompt !== undefined) body.prompt = prompt;
            if (promptKey !== undefined) body.prompt_key = promptKey;
            if (inputKeys) body.input_keys = inputKeys.filter((k): k is string => typeof k === 'string');
            if (visibility !== undefined) body.result_visibility = visibility;
            if (model !== undefined) body.model = model;
            if (systemPrompt !== undefined) body.system_prompt = systemPrompt;
            if (json !== undefined) body.json = json;
            if (appId !== undefined) body.app_id = appId;
            if (onDone) body.on_done = onDone;
            return client.post('/v1/ai/jobs', body);
        },
    },
    {
        // → GET /v1/ai/jobs — the live ones by default.
        name: 'aimeat_ai_job_list',
        description: 'List the owner\'s background AI jobs. Defaults to the live ones (queued + running).',
        input: {
            state: { type: 'string', description: 'queued | running | done | failed | cancelled | live | all. Default live.' },
            limit: { type: 'number', description: 'How many to return (1-500, default 50).' },
        },
        handler: ({ client }, input) => {
            const q = new URLSearchParams();
            const state = optionalString(input, 'state');
            const limit = optionalNumber(input, 'limit');
            if (state) q.set('state', state);
            if (limit !== undefined) q.set('limit', String(limit));
            const qs = q.toString();
            return client.get(`/v1/ai/jobs${qs ? `?${qs}` : ''}`);
        },
    },
    {
        // → GET /v1/ai/jobs/:id
        name: 'aimeat_ai_job_get',
        description: 'Read one background AI job: its state, cost, where its answer went, and why it failed if it did.',
        input: { job_id: { type: 'string', required: true, description: 'The job id.' } },
        handler: ({ client }, input) =>
            client.get(`/v1/ai/jobs/${encodeURIComponent(requiredString(input, 'job_id'))}`),
    },
    {
        // → POST /v1/ai/jobs/:id/cancel
        name: 'aimeat_ai_job_cancel',
        description: 'Stop a background AI job, queued or running.',
        input: { job_id: { type: 'string', required: true, description: 'The job id to stop.' } },
        handler: ({ client }, input) =>
            client.post(`/v1/ai/jobs/${encodeURIComponent(requiredString(input, 'job_id'))}/cancel`, {}),
    },
];
