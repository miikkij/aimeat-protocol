/**
 * @file agent-messages.ts
 * @description MCP tool registrations for agent-to-agent messaging. Routes are
 *   scoped to the connected agent via /v1/agents/{name}/messages.
 * @version-history
 *   v2.5.0 -- 2026-08-01 -- TARGET-058 Phase 11: aimeat_message_send carries `ai_provenance` /
 *     `ai_provenance_id` and echoes what was recorded.
 *   v1.1.0 -- 2026-05-28 -- Align send payload with the actual agent message API
 *   v2.0.0 -- 2026-05-29 -- Registry-driven, agent_name parameter
 *   v2.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v2.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v2.3.0 -- 2026-05-30 -- F10 drift reconciliation: message_send canonical on content (+thread_id);
 *     dropped the legacy body alias to match server MCP + REST AgentMessageCreateSchema.
 *   v2.4.0 -- 2026-05-30 -- Add aimeat_message_history (full thread context via GET /messages?thread_id).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, pickAgent } from './_registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';
import { aiProvenanceInputs } from '../../../../mcp/ai-provenance-input.js';
import { provenanceEchoedResult } from '../../ai-provenance-carry.js';

export function registerAgentMessagesTools(mcp: McpServer, registry: AgentRegistry): void {

  mcp.tool('aimeat_message_inbox', descriptionFor('aimeat_message_inbox'), {
    agent_name: agentNameSchema,
  }, annotationsFor('aimeat_message_inbox'), async ({ agent_name }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    const enc = encodeURIComponent(agent);
    const resp = await client.get(`/v1/agents/${enc}/messages/inbox`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_message_send', descriptionFor('aimeat_message_send'), {
    agent_name: agentNameSchema,
    content: z.string().describe('Message content (markdown supported)'),
    thread_id: z.string().optional().describe('Thread ID to reply in (omit to start a new conversation)'),
    linked_task_id: z.string().optional().describe('Optional linked task identifier'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Optional metadata key-value pairs'),
    ...aiProvenanceInputs,
  }, annotationsFor('aimeat_message_send'), async ({ agent_name, content, thread_id, linked_task_id, metadata, ai_provenance, ai_provenance_id }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    const enc = encodeURIComponent(agent);
    if (!content) {
      return { content: [{ type: 'text' as const, text: 'Message content is required.' }] };
    }
    const payload: Record<string, unknown> = { content, direction: 'outbound' };
    if (thread_id) payload.thread_id = thread_id;
    if (linked_task_id) payload.linked_task_id = linked_task_id;
    if (metadata) payload.metadata = metadata;
    const resp = await client.post(`/v1/agents/${enc}/messages`, payload);
    return provenanceEchoedResult(client,
      { tool: 'aimeat_message_send', declared: ai_provenance, declaredId: ai_provenance_id }, resp);
  });

  mcp.tool('aimeat_message_history', descriptionFor('aimeat_message_history'), {
    agent_name: agentNameSchema,
    thread_id: z.string().optional().describe('Conversation thread to read (omit for recent messages across all threads)'),
    page: z.number().int().positive().optional().describe('Page number (default 1)'),
    per_page: z.number().int().positive().max(100).optional().describe('Messages per page (default 20, max 100)'),
  }, annotationsFor('aimeat_message_history'), async ({ agent_name, thread_id, page, per_page }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    const enc = encodeURIComponent(agent);
    const params = new URLSearchParams();
    if (thread_id) params.set('thread_id', thread_id);
    if (page) params.set('page', String(page));
    if (per_page) params.set('per_page', String(per_page));
    const qs = params.toString();
    const resp = await client.get(`/v1/agents/${enc}/messages${qs ? '?' + qs : ''}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
