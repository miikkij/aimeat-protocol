/**
 * @file knowledge.ts
 * @description MCP tool registrations for knowledge package browsing,
 *   retrieval, contribution, and link discovery.
 * @version-history
 *   v1.3.0 -- 2026-08-01 -- TARGET-058 Phase 11: aimeat_knowledge_contribute carries
 *     `ai_provenance` / `ai_provenance_id` and echoes what was recorded.
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.2.0 -- 2026-05-30 -- F10 drift reconciliation: rename id->package_id (get/contribute/links),
 *     add direction filter to links to match server/REST.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';
import { aiProvenanceInputs } from '../../../../mcp/ai-provenance-input.js';
import { provenanceEchoedResult } from '../../ai-provenance-carry.js';

export function registerKnowledgeTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_knowledge_list', descriptionFor('aimeat_knowledge_list'), {}, annotationsFor('aimeat_knowledge_list'), async () => {
    const resp = await client.get('/v1/catalogue/knowledge');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_knowledge_get', descriptionFor('aimeat_knowledge_get'), {
    package_id: z.string().describe('Knowledge package identifier'),
  }, annotationsFor('aimeat_knowledge_get'), async ({ package_id }) => {
    const resp = await client.get(`/v1/knowledge/${encodeURIComponent(package_id)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_knowledge_contribute', descriptionFor('aimeat_knowledge_contribute'), {
    package_id: z.string().describe('Knowledge package identifier'),
    entry_key: z.string().describe('Entry key'),
    content: z.string().describe('Entry content'),
    ...aiProvenanceInputs,
  }, annotationsFor('aimeat_knowledge_contribute'), async ({ package_id, entry_key, content, ai_provenance, ai_provenance_id }) => {
    const resp = await client.post(`/v1/knowledge/${encodeURIComponent(package_id)}/contribute`, { entry_key, content });
    return provenanceEchoedResult(client,
      { tool: 'aimeat_knowledge_contribute', declared: ai_provenance, declaredId: ai_provenance_id }, resp);
  });

  mcp.tool('aimeat_knowledge_links', descriptionFor('aimeat_knowledge_links'), {
    package_id: z.string().describe('Knowledge package identifier'),
    direction: z.enum(['outgoing', 'incoming', 'both']).optional().describe('Link direction (default: both)'),
  }, annotationsFor('aimeat_knowledge_links'), async ({ package_id, direction }) => {
    const query = direction ? `?direction=${encodeURIComponent(direction)}` : '';
    const resp = await client.get(`/v1/knowledge/${encodeURIComponent(package_id)}/links${query}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
