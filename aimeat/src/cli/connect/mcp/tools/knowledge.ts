/**
 * @file knowledge.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tool registrations for knowledge package browsing,
 *   retrieval, contribution, and link discovery.
 * @structure registerKnowledgeTools() -- list, get, contribute, links. The contribute tool is
 *   registered and refuses: the capability has no HTTP route for the connector to proxy.
 * @usage registerKnowledgeTools(mcp, registry);
 * @version-history
 *   v1.5.0 -- 2026-08-11 -- aimeat_knowledge_contribute stops posting {entry_key, content} to
 *     POST /v1/knowledge/:id/contribute, which is the organism-sharing route and answered
 *     400 MISSING_FIELDS for every call. It now serves the one refusal in tool-call-defs-core.ts,
 *     which names where the entry write actually lives.
 *   v1.4.0 -- 2026-08-01 -- TARGET-058 Phase 11b: aimeat_knowledge_get folds meta.provenance.
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
import { readPayloadWithProvenance } from '../../ai-provenance-carry.js';
import { knowledgeContributeUnreachable, KNOWLEDGE_CONTRIBUTE_CONNECTOR_NOTE } from '../../tool-call-defs-core.js';

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
    // The package manifest read serves its record on meta.provenance — see core.ts memory_read.
    return { content: [{ type: 'text' as const, text: JSON.stringify(readPayloadWithProvenance(resp), null, 2) }] };
  });

  // The parameters stay as the catalog declares them, so an agent reading the tool list sees the same
  // capability it sees on the node. The call refuses, because the node keeps this one behind MCP and
  // the connector has no route to forward it to. The description says so before an agent spends a call.
  mcp.tool('aimeat_knowledge_contribute', descriptionFor('aimeat_knowledge_contribute') + KNOWLEDGE_CONTRIBUTE_CONNECTOR_NOTE, {
    package_id: z.string().describe('Knowledge package identifier'),
    entry_key: z.string().describe('Entry key'),
    content: z.string().describe('Entry content'),
    ...aiProvenanceInputs,
  }, annotationsFor('aimeat_knowledge_contribute'), () => {
    const refusal = knowledgeContributeUnreachable();
    return { content: [{ type: 'text' as const, text: JSON.stringify(refusal, null, 2) }], isError: true };
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
