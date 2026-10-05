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
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.2.0 -- 2026-09-28 -- aimeat_ai_job_start declares and sends `role`, the AI role the call runs as.
 *   v1.1.0 -- 2026-09-28 -- System 2 plan, V5: aimeat_ai_job_start declares and sends `op`,
 *     `provider`, `audio_key`, `language` and `size`.
 *   v1.0.0 -- 2026-08-31 -- Initial.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerAiJobTools(mcp: McpServer, registry: AgentRegistry): void {
    const { client } = registry.resolve();
    const out = (resp: { data?: unknown; ok?: boolean }) =>
        ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

    mcp.tool('aimeat_ai_job_start', descriptionFor('aimeat_ai_job_start'), zodShapeFor('aimeat_ai_job_start'), annotationsFor('aimeat_ai_job_start'), async (a) => {
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
            ...(a.op !== undefined ? { op: a.op } : {}),
            ...(a.provider !== undefined ? { provider: a.provider } : {}),
            ...(a.role !== undefined ? { role: a.role } : {}),
            ...(a.audio_key !== undefined ? { audio_key: a.audio_key } : {}),
            ...(a.language !== undefined ? { language: a.language } : {}),
            ...(a.size !== undefined ? { size: a.size } : {}),
        }));
    });

    mcp.tool('aimeat_ai_job_list', descriptionFor('aimeat_ai_job_list'), zodShapeFor('aimeat_ai_job_list'), annotationsFor('aimeat_ai_job_list'), async (a) => {
        const q = new URLSearchParams();
        if (a.state) q.set('state', a.state);
        if (a.limit !== undefined) q.set('limit', String(a.limit));
        const qs = q.toString();
        return out(await client.get(`/v1/ai/jobs${qs ? `?${qs}` : ''}`));
    });

    mcp.tool('aimeat_ai_job_get', descriptionFor('aimeat_ai_job_get'), zodShapeFor('aimeat_ai_job_get'), annotationsFor('aimeat_ai_job_get'), async (a) => {
        return out(await client.get(`/v1/ai/jobs/${encodeURIComponent(a.job_id)}`));
    });

    mcp.tool('aimeat_ai_job_cancel', descriptionFor('aimeat_ai_job_cancel'), zodShapeFor('aimeat_ai_job_cancel'), annotationsFor('aimeat_ai_job_cancel'), async (a) => {
        return out(await client.post(`/v1/ai/jobs/${encodeURIComponent(a.job_id)}/cancel`, {}));
    });
}
