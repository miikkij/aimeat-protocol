/**
 * @file agent-messages.ts
 * @description MCP tool registrations for agent-to-agent messaging. Routes are
 *   scoped to the connected agent via /v1/agents/{name}/messages.
 * @version-history v1.1.0 -- 2026-05-28 -- Align send payload with the actual agent message API.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatClient } from '../../api-client.js';

export function registerAgentMessagesTools(mcp: McpServer, client: AimeatClient, agentName?: string): void {
  const enc = encodeURIComponent(agentName!);

  mcp.tool('aimeat_message_inbox', 'Get pending inbound messages', {}, async () => {
    const resp = await client.get(`/v1/agents/${enc}/messages/inbox`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_message_send', 'Send an outbound message from the connected agent to the owner conversation', {
    content: z.string().optional().describe('Message content'),
    body: z.string().optional().describe('Message content alias for older callers'),
    linked_task_id: z.string().optional().describe('Optional linked task identifier'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Optional metadata key-value pairs'),
  }, async ({ content, body, linked_task_id, metadata }) => {
    const message = content ?? body;
    if (!message) {
      return { content: [{ type: 'text' as const, text: 'Message content is required. Provide content or body.' }] };
    }
    const payload: Record<string, unknown> = { content: message, direction: 'outbound' };
    if (linked_task_id) payload.linked_task_id = linked_task_id;
    if (metadata) payload.metadata = metadata;
    const resp = await client.post(`/v1/agents/${enc}/messages`, payload);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
