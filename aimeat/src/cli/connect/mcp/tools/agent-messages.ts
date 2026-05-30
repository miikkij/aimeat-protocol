/**
 * @file agent-messages.ts
 * @description MCP tool registrations for agent-to-agent messaging. Routes are
 *   scoped to the connected agent via /v1/agents/{name}/messages.
 * @version-history
 *   v1.1.0 -- 2026-05-28 -- Align send payload with the actual agent message API
 *   v2.0.0 -- 2026-05-29 -- Registry-driven, agent_name parameter
 *   v2.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v2.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v2.3.0 -- 2026-05-30 -- F10 drift reconciliation: message_send canonical on content (+thread_id);
 *     dropped the legacy body alias to match server MCP + REST AgentMessageCreateSchema.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, pickAgent } from './_registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

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
  }, annotationsFor('aimeat_message_send'), async ({ agent_name, content, thread_id, linked_task_id, metadata }) => {
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
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
