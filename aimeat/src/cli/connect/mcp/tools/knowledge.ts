/**
 * @file knowledge.ts
 * @description MCP tool registrations for knowledge package browsing,
 *   retrieval, contribution, and link discovery.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatClient } from '../../api-client.js';

export function registerKnowledgeTools(mcp: McpServer, client: AimeatClient): void {

  mcp.tool('aimeat_knowledge_list', 'List knowledge packages', {}, async () => {
    const resp = await client.get('/v1/catalogue/knowledge');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_knowledge_get', 'Get a knowledge package by ID', {
    id: z.string().describe('Knowledge package identifier'),
  }, async ({ id }) => {
    const resp = await client.get(`/v1/knowledge/${encodeURIComponent(id)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_knowledge_contribute', 'Contribute an entry to a knowledge package', {
    id: z.string().describe('Knowledge package identifier'),
    entry_key: z.string().describe('Entry key'),
    content: z.string().describe('Entry content'),
  }, async ({ id, entry_key, content }) => {
    const resp = await client.post(`/v1/knowledge/${encodeURIComponent(id)}/contribute`, { entry_key, content });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_knowledge_links', 'Get links for a knowledge package', {
    id: z.string().describe('Knowledge package identifier'),
  }, async ({ id }) => {
    const resp = await client.get(`/v1/knowledge/${encodeURIComponent(id)}/links`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
