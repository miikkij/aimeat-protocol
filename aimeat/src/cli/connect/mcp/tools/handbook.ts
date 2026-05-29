/**
 * @file handbook.ts
 * @description MCP tool registration for retrieving the agent operating handbook,
 *   with optional module-level drill-down.
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';

export function registerHandbookTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_handbook_get', 'Get the agent operating handbook', {
    module: z.string().optional().describe('Specific handbook module to retrieve'),
  }, annotationsFor('aimeat_handbook_get'), async ({ module }) => {
    const path = module
      ? `/v1/agents/me/handbook/${encodeURIComponent(module)}`
      : '/v1/agents/me/handbook';
    const resp = await client.get(path);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
