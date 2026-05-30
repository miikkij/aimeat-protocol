/**
 * @file handbook.ts
 * @description MCP tool registration for retrieving the agent operating handbook,
 *   with optional module-level drill-down.
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.1.0 -- 2026-05-29 -- Per-call agent routing via pickAgent so the handbook
 *     is fetched on behalf of whichever agent the caller named (was: always
 *     primary). The /v1/agents/me/handbook endpoint resolves "me" from the
 *     bearer token, so the routed token must match the agent the caller meant.
 *   v1.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';
import { agentNameSchema, pickAgent } from './_registry.js';

export function registerHandbookTools(mcp: McpServer, registry: AgentRegistry): void {
  mcp.tool('aimeat_handbook_get', descriptionFor('aimeat_handbook_get'), {
    agent_name: agentNameSchema,
    module: z.string().optional().describe('Specific handbook module to retrieve'),
  }, annotationsFor('aimeat_handbook_get'), async ({ agent_name, module }) => {
    const { client } = pickAgent(registry, agent_name);
    const path = module
      ? `/v1/agents/me/handbook/${encodeURIComponent(module)}`
      : '/v1/agents/me/handbook';
    const resp = await client.get(path);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
