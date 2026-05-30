/**
 * @file knowledge.ts
 * @description MCP tool registrations for knowledge package browsing,
 *   retrieval, contribution, and link discovery.
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerKnowledgeTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_knowledge_list', descriptionFor('aimeat_knowledge_list'), {}, annotationsFor('aimeat_knowledge_list'), async () => {
    const resp = await client.get('/v1/catalogue/knowledge');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_knowledge_get', descriptionFor('aimeat_knowledge_get'), {
    id: z.string().describe('Knowledge package identifier'),
  }, annotationsFor('aimeat_knowledge_get'), async ({ id }) => {
    const resp = await client.get(`/v1/knowledge/${encodeURIComponent(id)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_knowledge_contribute', descriptionFor('aimeat_knowledge_contribute'), {
    id: z.string().describe('Knowledge package identifier'),
    entry_key: z.string().describe('Entry key'),
    content: z.string().describe('Entry content'),
  }, annotationsFor('aimeat_knowledge_contribute'), async ({ id, entry_key, content }) => {
    const resp = await client.post(`/v1/knowledge/${encodeURIComponent(id)}/contribute`, { entry_key, content });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_knowledge_links', descriptionFor('aimeat_knowledge_links'), {
    id: z.string().describe('Knowledge package identifier'),
  }, annotationsFor('aimeat_knowledge_links'), async ({ id }) => {
    const resp = await client.get(`/v1/knowledge/${encodeURIComponent(id)}/links`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
