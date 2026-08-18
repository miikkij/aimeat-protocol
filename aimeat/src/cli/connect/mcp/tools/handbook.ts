/**
 * @file handbook.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v1.3.0 -- 2026-05-30 -- Add `surface` param → fetches the v2 per-role surface handbook.
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
    surface: z.enum(['appdev', 'agent', 'service', 'admin']).optional().describe('Return the v2 purpose-scoped surface handbook for this role (use the surface you serve, e.g. "agent") instead of a module.'),
  }, annotationsFor('aimeat_handbook_get'), async ({ agent_name, module, surface }) => {
    const { client } = pickAgent(registry, agent_name);
    const path = surface
      ? `/v1/agents/me/handbook/surface/${encodeURIComponent(surface)}`
      : module
        ? `/v1/agents/me/handbook/${encodeURIComponent(module)}`
        : '/v1/agents/me/handbook';
    const resp = await client.get(path);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
