/**
 * @file catalogue.ts
 * @description MCP tool registrations for catalogue browsing -- agent directory,
 *   public boards, and people directory searches.
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';

export function registerCatalogueTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_catalogue_agents', 'Search the agent directory', {
    query: z.string().optional().describe('Search query'),
  }, annotationsFor('aimeat_catalogue_agents'), async ({ query }) => {
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    const resp = await client.get(`/v1/catalogue/agents${qs}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_catalogue_boards', 'Browse public boards', {}, annotationsFor('aimeat_catalogue_boards'), async () => {
    const resp = await client.get('/v1/catalogue/boards');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_catalogue_directory', 'Search the people directory', {
    query: z.string().optional().describe('Search query'),
  }, annotationsFor('aimeat_catalogue_directory'), async ({ query }) => {
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    const resp = await client.get(`/v1/catalogue/directory${qs}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
