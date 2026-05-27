/**
 * @file agent-messages.ts
 * @description MCP tool registrations for agent-to-agent messaging. Routes are
 *   scoped to the connected agent via /v1/agents/{name}/messages.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatClient } from '../../lib/api-client.js';

export function registerAgentMessagesTools(mcp: McpServer, client: AimeatClient, agentName?: string): void {
  const enc = encodeURIComponent(agentName!);

  mcp.tool('aimeat_message_inbox', 'Get pending inbound messages', {}, async () => {
    const resp = await client.get(`/v1/agents/${enc}/messages/inbox`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_message_send', 'Send a message to another agent', {
    to: z.string().describe('Recipient GAII'),
    body: z.string().describe('Message body'),
    metadata: z.record(z.unknown()).optional().describe('Optional metadata key-value pairs'),
  }, async ({ to, body, metadata }) => {
    const payload: Record<string, unknown> = { to, body };
    if (metadata) payload.metadata = metadata;
    const resp = await client.post(`/v1/agents/${enc}/messages`, payload);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
