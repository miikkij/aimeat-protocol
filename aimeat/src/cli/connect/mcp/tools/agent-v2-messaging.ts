/**
 * @file agent-v2-messaging.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP tools for Agent v2 messaging: a turn between two principals of one
 *   account, and the delivery target that reaches a principal which is not connected.
 *
 *   Thin proxies to the node's own doors (/v1/agents/v2/messages, /v1/agents/v2/push-config), so
 *   every gate is the one the node already applies and this file adds no rule of its own. Mirrors
 *   the server MCP surface (src/mcp/agent-v2-messaging.ts) parameter for parameter, which is what
 *   `pnpm check:mcp-schemas` proves.
 *
 *   Distinct from agent-messages.ts (this agent and its own owner) and dm-messages.ts (a person
 *   reaching another person). Both keep working exactly as they did.
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V4).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, pickAgent } from './_registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

/** One node answer, as MCP content. A refusal keeps the node's own words and code. */
function answer(resp: { ok?: boolean; data?: unknown }) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }],
    ...(resp.ok === false ? { isError: true } : {}),
  };
}

export function registerAgentV2MessagingTools(mcp: McpServer, registry: AgentRegistry): void {
  mcp.tool('aimeat_v2_message_send', descriptionFor('aimeat_v2_message_send'), {
    agent_name: agentNameSchema,
    to: z.string().describe('The recipient principal on this account: an agent GAII, an ecosystem app, or the owner GHII.'),
    parts: z.array(z.record(z.string(), z.unknown()))
      .describe('Ordered parts. Each is {kind:"text",text} or {kind:"file",file:{uri,name?,mimeType?}} or {kind:"data",data:{...}}.'),
    role: z.enum(['user', 'agent']).optional().describe('"user" if you are asking, "agent" if you are answering. Default "user".'),
    context_id: z.string().optional().describe('The exchange this turn belongs to. Omit on the first turn.'),
    task_id: z.string().optional().describe('The task this turn belongs to, if there is one.'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Carried along, never read by the node.'),
  }, annotationsFor('aimeat_v2_message_send'), async ({ agent_name, to, parts, role, context_id, task_id, metadata }) => {
    const { client } = pickAgent(registry, agent_name);
    return answer(await client.post('/v1/agents/v2/messages', {
      to, parts, role, contextId: context_id, taskId: task_id, metadata,
    }));
  });

  mcp.tool('aimeat_v2_message_list', descriptionFor('aimeat_v2_message_list'), {
    agent_name: agentNameSchema,
    context_id: z.string().optional().describe('One exchange.'),
    task_id: z.string().optional().describe('The turns of one task.'),
    to: z.string().optional().describe('Turns addressed to this principal.'),
    from: z.string().optional().describe('Turns sent by this principal.'),
    since: z.string().optional().describe('ISO timestamp, exclusive: turns created after it.'),
    limit: z.number().optional().describe('Max turns to return (default 50, max 200).'),
  }, annotationsFor('aimeat_v2_message_list'), async ({ agent_name, context_id, task_id, to, from, since, limit }) => {
    const { client } = pickAgent(registry, agent_name);
    const q = new URLSearchParams();
    if (context_id) q.set('context_id', context_id);
    if (task_id) q.set('task_id', task_id);
    if (to) q.set('to', to);
    if (from) q.set('from', from);
    if (since) q.set('since', since);
    if (typeof limit === 'number') q.set('limit', String(limit));
    const qs = q.toString() ? `?${q.toString()}` : '';
    return answer(await client.get(`/v1/agents/v2/messages${qs}`));
  });

  mcp.tool('aimeat_v2_push_set', descriptionFor('aimeat_v2_push_set'), {
    agent_name: agentNameSchema,
    url: z.string().describe('The https address to POST a turn to.'),
    token: z.string().optional().describe('An opaque string echoed back inside every delivery.'),
    authentication: z.record(z.string(), z.unknown()).optional().describe('{ schemes: ["Bearer"], credentials: "…" }. The credentials are stored and sent, never returned.'),
    id: z.string().optional().describe('Replace this existing target. Must be one already registered on this account.'),
    principal: z.string().optional().describe('Whose deliveries these are. Defaults to you.'),
  }, annotationsFor('aimeat_v2_push_set'), async ({ agent_name, url, token, authentication, id, principal }) => {
    const { client } = pickAgent(registry, agent_name);
    return answer(await client.put('/v1/agents/v2/push-config', { url, token, authentication, id, principal }));
  });

  mcp.tool('aimeat_v2_push_list', descriptionFor('aimeat_v2_push_list'), {
    agent_name: agentNameSchema,
    principal: z.string().optional().describe('Account holder only: whose targets to list.'),
  }, annotationsFor('aimeat_v2_push_list'), async ({ agent_name, principal }) => {
    const { client } = pickAgent(registry, agent_name);
    const qs = principal ? `?principal=${encodeURIComponent(principal)}` : '';
    return answer(await client.get(`/v1/agents/v2/push-config${qs}`));
  });

  mcp.tool('aimeat_v2_push_delete', descriptionFor('aimeat_v2_push_delete'), {
    agent_name: agentNameSchema,
    id: z.string().describe('The target id, from aimeat_v2_push_list.'),
  }, annotationsFor('aimeat_v2_push_delete'), async ({ agent_name, id }) => {
    const { client } = pickAgent(registry, agent_name);
    return answer(await client.delete(`/v1/agents/v2/push-config/${encodeURIComponent(id)}`));
  });
}
