/**
 * @file src/mcp/ai-jobs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The four AI-job tools on the node's own MCP surface: start one, list them, read one,
 *   stop one. An agent can do what a person can do here, which is the point — a background model
 *   call is the thing an agent needs most and the thing a chat session can hold open least.
 *
 *   NONE OF THESE DOES THE WORK. Each calls the same service function the REST routes call
 *   (services/ai-jobs/), so the queue, the refusals, the budget and the provenance happen where they
 *   were written once. A tool that reached storage itself would be a second implementation, which is
 *   how the same defect came to be fixed three separate times inside aimeat_memory_write.
 *
 *   The tools are declared on THREE surfaces, and this is one of them. See the catalog entry
 *   (mcp/catalog/definitions/ai-jobs.ts) for the other two and for the gates that keep them in step.
 * @structure registerAiJobTools(mcp, storage, config, getAgentGaii)
 * @usage registerAiJobTools(mcp, storage, config, () => agentGaii);
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { parseGAII } from '../utils/gaii.js';
import { AiJobError, getActiveAiJobService } from '../services/ai-jobs/index.js';
import type { AiJobState } from '../services/ai-jobs/types.js';

export function registerAiJobTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
): void {
    const agentGaii = getAgentGaii();
    const owner = parseGAII(agentGaii)?.owner ?? '';
    const ownerGhii = `${owner}@${config.nodeId}`;

    const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
    const err = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true });
    const failed = (e: unknown) => err(e instanceof AiJobError ? `${e.code}: ${e.message}` : String((e as Error).message ?? e));

    /** Resolved per call, not at registration: the service belongs to the process and the tool
     *  surface is built per session. A node with no service running says so instead of throwing. */
    const service = () => {
        const s = getActiveAiJobService();
        if (!s) throw new AiJobError('AI_JOBS_UNAVAILABLE', 503, 'Background AI jobs are not running on this node.');
        return s;
    };

    // ── aimeat_ai_job_start ──
    mcp.tool(
        'aimeat_ai_job_start',
        descriptionFor('aimeat_ai_job_start'),
        {
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
        },
        annotationsFor('aimeat_ai_job_start'),
        async (a) => {
            if (!owner) return err('Could not resolve caller owner');
            try {
                const started = await service().startJob({
                    ...(a.prompt !== undefined ? { prompt: a.prompt } : {}),
                    ...(a.prompt_key !== undefined ? { prompt_key: a.prompt_key } : {}),
                    ...(a.input_keys ? { input_keys: a.input_keys } : {}),
                    result_key: a.result_key,
                    ...(a.result_visibility ? { result_visibility: a.result_visibility } : {}),
                    ...(a.model !== undefined ? { model: a.model } : {}),
                    ...(a.system_prompt !== undefined ? { system_prompt: a.system_prompt } : {}),
                    ...(a.json ? { json: true } : {}),
                    ...(a.app_id !== undefined ? { app_id: a.app_id } : {}),
                    ...(a.on_done ? { on_done: a.on_done } : {}),
                }, { ownerGhii, createdBy: agentGaii });
                return text(started);
            } catch (e) {
                return failed(e);
            }
        },
    );

    // ── aimeat_ai_job_list ──
    mcp.tool(
        'aimeat_ai_job_list',
        descriptionFor('aimeat_ai_job_list'),
        {
            state: z.enum(['queued', 'running', 'done', 'failed', 'cancelled', 'live', 'all']).optional()
                .describe('Which jobs to list. "live" (the default) is queued + running.'),
            limit: z.number().optional().describe('How many to return (1-500, default 50).'),
        },
        annotationsFor('aimeat_ai_job_list'),
        async (a) => {
            try {
                const jobs = await service().listJobs(ownerGhii, {
                    ...(a.state ? { state: a.state as AiJobState | 'live' | 'all' } : {}),
                    ...(a.limit !== undefined ? { limit: a.limit } : {}),
                });
                return text({ jobs, count: jobs.length });
            } catch (e) {
                return failed(e);
            }
        },
    );

    // ── aimeat_ai_job_get ──
    mcp.tool(
        'aimeat_ai_job_get',
        descriptionFor('aimeat_ai_job_get'),
        { job_id: z.string().describe('The job id from aimeat_ai_job_start.') },
        annotationsFor('aimeat_ai_job_get'),
        async (a) => {
            try {
                const job = await service().getJob(ownerGhii, a.job_id);
                // Not found and not-yours read the same, deliberately: whose jobs exist is not a
                // stranger's business, and a different message would answer that question.
                if (!job) return err('No such job.');
                return text(job);
            } catch (e) {
                return failed(e);
            }
        },
    );

    // ── aimeat_ai_job_cancel ──
    mcp.tool(
        'aimeat_ai_job_cancel',
        descriptionFor('aimeat_ai_job_cancel'),
        { job_id: z.string().describe('The job id to stop.') },
        annotationsFor('aimeat_ai_job_cancel'),
        async (a) => {
            try {
                return text(await service().cancelJob(ownerGhii, a.job_id));
            } catch (e) {
                return failed(e);
            }
        },
    );

    void storage;
}
