/**
 * @file ai-jobs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registrations for the four AI-job tools — parity with the server MCP
 *   (src/mcp/ai-jobs.ts) so `aimeat connect serve` exposes the same start/list/get/cancel locally.
 *   Thin REST wrappers over /v1/ai/jobs.
 *
 *   The PARAMETER LIST here is the thing to keep honest, not just the tool names: a parameter added
 *   to the node MCP and not to this door is dropped in silence, and the call comes back ok having
 *   done less than it was asked. `check:mcp-schemas` compares this surface against the node's on
 *   every commit for exactly that reason.
 * @structure registerAiJobTools(mcp, registry)
 * @usage imported by mcp/tools/index.ts
 * @version-history
 *   v1.0.0 -- 2026-08-31 -- Initial.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerAiJobTools(mcp: McpServer, registry: AgentRegistry): void {
    const { client } = registry.resolve();
    const out = (resp: { data?: unknown; ok?: boolean }) =>
        ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

    mcp.tool('aimeat_ai_job_start', descriptionFor('aimeat_ai_job_start'), {
        prompt: z.string().optional().describe('The prompt. Required unless prompt_key names a record holding it.'),
        prompt_key: z.string().optional().describe('An owner memory key holding the prompt text (a string, or an object with a `prompt` field).'),
        input_keys: z.array(z.string()).optional().describe('Memory keys read and pasted into the prompt, labelled by key. The model has no tools; this is the only way it sees stored data. A missing record is stated as missing rather than left for it to invent.'),
        result_key: z.string().describe('Where the answer is written, in the owner\'s own namespace.'),
        result_visibility: z.enum(['private', 'owner', 'public']).optional().describe('Visibility of the record written at result_key. Default private.'),
        model: z.string().optional().describe('Explicit model id. Omit to use the owner\'s configured model.'),
        system_prompt: z.string().optional().describe('Optional system prompt.'),
        json: z.boolean().optional().describe('Parse the answer as JSON before storing it.'),
        app_id: z.string().optional().describe('App attribution — enables the per-app allowlist and per-app daily quota.'),
        on_done: z.object({ extension: z.string(), action: z.string() }).optional()
            .describe('An extension action of the job\'s OWN owner, invoked with { job_id, state, result_key } when the job finishes.'),
    }, annotationsFor('aimeat_ai_job_start'), async (a) => {
        return out(await client.post('/v1/ai/jobs', {
            ...(a.prompt !== undefined ? { prompt: a.prompt } : {}),
            ...(a.prompt_key !== undefined ? { prompt_key: a.prompt_key } : {}),
            ...(a.input_keys ? { input_keys: a.input_keys } : {}),
            result_key: a.result_key,
            ...(a.result_visibility ? { result_visibility: a.result_visibility } : {}),
            ...(a.model !== undefined ? { model: a.model } : {}),
            ...(a.system_prompt !== undefined ? { system_prompt: a.system_prompt } : {}),
            ...(a.json !== undefined ? { json: a.json } : {}),
            ...(a.app_id !== undefined ? { app_id: a.app_id } : {}),
            ...(a.on_done ? { on_done: a.on_done } : {}),
        }));
    });

    mcp.tool('aimeat_ai_job_list', descriptionFor('aimeat_ai_job_list'), {
        state: z.enum(['queued', 'running', 'done', 'failed', 'cancelled', 'live', 'all']).optional()
            .describe('Which jobs to list. "live" (the default) is queued + running.'),
        limit: z.number().optional().describe('How many to return (1-500, default 50).'),
    }, annotationsFor('aimeat_ai_job_list'), async (a) => {
        const q = new URLSearchParams();
        if (a.state) q.set('state', a.state);
        if (a.limit !== undefined) q.set('limit', String(a.limit));
        const qs = q.toString();
        return out(await client.get(`/v1/ai/jobs${qs ? `?${qs}` : ''}`));
    });

    mcp.tool('aimeat_ai_job_get', descriptionFor('aimeat_ai_job_get'), {
        job_id: z.string().describe('The job id from aimeat_ai_job_start.'),
    }, annotationsFor('aimeat_ai_job_get'), async (a) => {
        return out(await client.get(`/v1/ai/jobs/${encodeURIComponent(a.job_id)}`));
    });

    mcp.tool('aimeat_ai_job_cancel', descriptionFor('aimeat_ai_job_cancel'), {
        job_id: z.string().describe('The job id to stop.'),
    }, annotationsFor('aimeat_ai_job_cancel'), async (a) => {
        return out(await client.post(`/v1/ai/jobs/${encodeURIComponent(a.job_id)}/cancel`, {}));
    });
}
