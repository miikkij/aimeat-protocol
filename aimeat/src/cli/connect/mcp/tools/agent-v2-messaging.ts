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
 *   2026-10-05 — aimeat_v2_message_list takes response_format and gives the catalog's concise view
 *     (secaudit 2026-10, M3).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V4).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, pickAgent } from './_registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor, shapeResponse } from '../../../../tool-catalog/shape.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

/** One node answer, as MCP content. A refusal keeps the node's own words and code. */
function answer(resp: { ok?: boolean; data?: unknown }) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }],
    ...(resp.ok === false ? { isError: true } : {}),
  };
}

export function registerAgentV2MessagingTools(mcp: McpServer, registry: AgentRegistry): void {
  mcp.tool('aimeat_v2_message_send', descriptionFor('aimeat_v2_message_send'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_v2_message_send') }, annotationsFor('aimeat_v2_message_send'), async ({ agent_name, to, parts, role, context_id, task_id, metadata }) => {
    const { client } = pickAgent(registry, agent_name);
    return answer(await client.post('/v1/agents/v2/messages', {
      to, parts, role, contextId: context_id, taskId: task_id, metadata,
    }));
  });

  mcp.tool('aimeat_v2_message_list', descriptionFor('aimeat_v2_message_list'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_v2_message_list') }, annotationsFor('aimeat_v2_message_list'), async ({ agent_name, context_id, task_id, to, from, since, limit, response_format }) => {
    const { client } = pickAgent(registry, agent_name);
    const q = new URLSearchParams();
    if (context_id) q.set('context_id', context_id);
    if (task_id) q.set('task_id', task_id);
    if (to) q.set('to', to);
    if (from) q.set('from', from);
    if (since) q.set('since', since);
    if (typeof limit === 'number') q.set('limit', String(limit));
    const qs = q.toString() ? `?${q.toString()}` : '';
    const resp = await client.get(`/v1/agents/v2/messages${qs}`);
    return answer(resp.ok === false ? resp : { ...resp, data: shapeResponse('aimeat_v2_message_list', response_format, resp.data) });
  });

  mcp.tool('aimeat_v2_push_set', descriptionFor('aimeat_v2_push_set'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_v2_push_set') }, annotationsFor('aimeat_v2_push_set'), async ({ agent_name, url, token, authentication, id, principal }) => {
    const { client } = pickAgent(registry, agent_name);
    return answer(await client.put('/v1/agents/v2/push-config', { url, token, authentication, id, principal }));
  });

  mcp.tool('aimeat_v2_push_list', descriptionFor('aimeat_v2_push_list'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_v2_push_list') }, annotationsFor('aimeat_v2_push_list'), async ({ agent_name, principal }) => {
    const { client } = pickAgent(registry, agent_name);
    const qs = principal ? `?principal=${encodeURIComponent(principal)}` : '';
    return answer(await client.get(`/v1/agents/v2/push-config${qs}`));
  });

  mcp.tool('aimeat_v2_push_delete', descriptionFor('aimeat_v2_push_delete'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_v2_push_delete') }, annotationsFor('aimeat_v2_push_delete'), async ({ agent_name, id }) => {
    const { client } = pickAgent(registry, agent_name);
    return answer(await client.delete(`/v1/agents/v2/push-config/${encodeURIComponent(id)}`));
  });
}
