/**
 * @file catalogue.ts
 * @description MCP tool registrations for catalogue browsing -- agent directory,
 *   public boards, and people directory searches.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatClient } from '../../api-client.js';

export function registerCatalogueTools(mcp: McpServer, client: AimeatClient): void {

  mcp.tool('aimeat_catalogue_agents', 'Search the agent directory', {
    query: z.string().optional().describe('Search query'),
  }, async ({ query }) => {
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    const resp = await client.get(`/v1/catalogue/agents${qs}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_catalogue_boards', 'Browse public boards', {}, async () => {
    const resp = await client.get('/v1/catalogue/boards');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_catalogue_directory', 'Search the people directory', {
    query: z.string().optional().describe('Search query'),
  }, async ({ query }) => {
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    const resp = await client.get(`/v1/catalogue/directory${qs}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
