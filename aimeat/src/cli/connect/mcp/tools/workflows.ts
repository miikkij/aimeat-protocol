/**
 * @file workflows.ts
 * @description Connector MCP registrations for the Agent Workflows tools — parity with the server
 *   MCP (src/mcp/workflows.ts) so `aimeat connect serve --surface agent` exposes the same
 *   save/get/run tools locally. Thin REST wrappers over /v1/workflows.
 * @version-history
 *   v1.0.0 -- 2026-06-13 -- Close the connector-surface gap for workflow_save/get/run.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerWorkflowTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  mcp.tool('aimeat_workflow_save', descriptionFor('aimeat_workflow_save'), {
    id: z.string().describe('Workflow id (lowercase slug); existing id = update.'),
    definition: z.record(z.string(), z.unknown()).describe('The workflow descriptor: { title, description, trigger, vars[], steps[], on_step_fail:"inspect", llm?{approved} }. Validated against the offer contract + DAG on save.'),
  }, annotationsFor('aimeat_workflow_save'), async ({ id, definition }) => {
    return out(await client.put(`/v1/workflows/${encodeURIComponent(id)}`, definition as Record<string, unknown>));
  });

  mcp.tool('aimeat_workflow_get', descriptionFor('aimeat_workflow_get'), {
    id: z.string().optional().describe('Omit to list all your workflows; pass an id for its definition + derived blueprint + recent runs.'),
  }, annotationsFor('aimeat_workflow_get'), async ({ id }) => {
    if (!id) return out(await client.get('/v1/workflows'));
    const enc = encodeURIComponent(id);
    const [def, bp, runs] = await Promise.all([
      client.get(`/v1/workflows/${enc}`),
      client.get(`/v1/workflows/${enc}/blueprint`),
      client.get(`/v1/workflows/${enc}/runs`),
    ]);
    const recentRuns = (((runs.data as { runs?: unknown[] } | undefined)?.runs) ?? []).slice(0, 5);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ definition: def.data ?? def, blueprint: bp.ok === false ? null : (bp.data ?? null), recentRuns }, null, 2) }],
      ...(def.ok === false ? { isError: true } : {}),
    };
  });

  mcp.tool('aimeat_workflow_run', descriptionFor('aimeat_workflow_run'), {
    id: z.string().describe('The workflow id.'),
    mode: z.enum(['signals-only', 'full']).describe('signals-only = evaluate each step\'s signals against existing memory (no dispatch — an instant health check); full = execute the steps live.'),
  }, annotationsFor('aimeat_workflow_run'), async ({ id, mode }) => {
    return out(await client.post(`/v1/workflows/${encodeURIComponent(id)}/run`, { mode }));
  });
}
