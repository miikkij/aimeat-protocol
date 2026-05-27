/**
 * @file handbook.ts
 * @description MCP tool registration for retrieving the agent operating handbook,
 *   with optional module-level drill-down.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatClient } from '../../api-client.js';

export function registerHandbookTools(mcp: McpServer, client: AimeatClient): void {

  mcp.tool('aimeat_handbook_get', 'Get the agent operating handbook', {
    module: z.string().optional().describe('Specific handbook module to retrieve'),
  }, async ({ module }) => {
    const path = module
      ? `/v1/agents/me/handbook/${encodeURIComponent(module)}`
      : '/v1/agents/me/handbook';
    const resp = await client.get(path);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
