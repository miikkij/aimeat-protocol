/**
 * @file agent-v2-tasks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP tools for Agent v2 tasks: the handle a caller holds while work runs.
 *
 *   Thin proxies to the node's own doors (/v1/agents/v2/tasks), so every gate is the one the node
 *   applies and this file adds no rule of its own. Mirrors the server MCP surface
 *   (src/mcp/agent-v2-tasks.ts) parameter for parameter, which is what `pnpm check:mcp-schemas`
 *   proves.
 *
 *   Distinct from agent-tasks.ts, which is the owner's dashboard work item and is untouched.
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V5).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, pickAgent } from './_registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

function answer(resp: { ok?: boolean; data?: unknown }) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }],
    ...(resp.ok === false ? { isError: true } : {}),
  };
}

const partsSchema = z.array(z.record(z.string(), z.unknown()))
  .describe('Parts: {kind:"text",text} or {kind:"file",file:{uri,name?,mimeType?}} or {kind:"data",data:{...}}.');

export function registerAgentV2TaskTools(mcp: McpServer, registry: AgentRegistry): void {
  mcp.tool('aimeat_v2_task_create', descriptionFor('aimeat_v2_task_create'), {
    agent_name: agentNameSchema,
    assigned_to: z.string().describe('The principal that is to do this.'),
    input: partsSchema,
    context_id: z.string().optional().describe('The exchange this work belongs to.'),
    status_message: z.string().optional().describe('One line for a person about what this is.'),
    ttl_ms: z.number().optional().describe('How long the result stays worth reading, in milliseconds.'),
    poll_interval_ms: z.number().optional().describe('How often you intend to poll, in milliseconds.'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Carried along, never read by the node.'),
  }, annotationsFor('aimeat_v2_task_create'), async (args) => {
    const { client } = pickAgent(registry, args.agent_name);
    return answer(await client.post('/v1/agents/v2/tasks', {
      assignedTo: args.assigned_to, input: args.input, contextId: args.context_id,
      statusMessage: args.status_message, ttlMs: args.ttl_ms, pollIntervalMs: args.poll_interval_ms,
      metadata: args.metadata,
    }));
  });

  mcp.tool('aimeat_v2_task_list', descriptionFor('aimeat_v2_task_list'), {
    agent_name: agentNameSchema,
    assigned_to: z.string().optional().describe('Tasks given to this principal.'),
    created_by: z.string().optional().describe('Tasks this principal asked for.'),
    context_id: z.string().optional().describe('Tasks in one exchange.'),
    status: z.string().optional().describe('One status or a comma-separated list.'),
    limit: z.number().optional().describe('Max tasks to return (default 50, max 200).'),
  }, annotationsFor('aimeat_v2_task_list'), async (args) => {
    const { client } = pickAgent(registry, args.agent_name);
    const q = new URLSearchParams();
    if (args.assigned_to) q.set('assigned_to', args.assigned_to);
    if (args.created_by) q.set('created_by', args.created_by);
    if (args.context_id) q.set('context_id', args.context_id);
    if (args.status) q.set('status', args.status);
    if (typeof args.limit === 'number') q.set('limit', String(args.limit));
    const qs = q.toString() ? `?${q.toString()}` : '';
    return answer(await client.get(`/v1/agents/v2/tasks${qs}`));
  });

  mcp.tool('aimeat_v2_task_get', descriptionFor('aimeat_v2_task_get'), {
    agent_name: agentNameSchema,
    task_id: z.string().describe('The task id.'),
  }, annotationsFor('aimeat_v2_task_get'), async ({ agent_name, task_id }) => {
    const { client } = pickAgent(registry, agent_name);
    return answer(await client.get(`/v1/agents/v2/tasks/${encodeURIComponent(task_id)}`));
  });

  mcp.tool('aimeat_v2_task_status', descriptionFor('aimeat_v2_task_status'), {
    agent_name: agentNameSchema,
    task_id: z.string().describe('The task id.'),
    status: z.enum(['working', 'input_required', 'completed', 'failed']).describe('Where it has got to.'),
    status_message: z.string().optional().describe('One line for a person.'),
    result: partsSchema.optional().describe('What came back. Required when completing.'),
    error: z.record(z.string(), z.unknown()).optional().describe('{ code, message }. Required when failing.'),
    ttl_ms: z.number().optional().describe('How long the result stays worth reading, in milliseconds.'),
    poll_interval_ms: z.number().optional().describe('How often the caller should poll from here.'),
  }, annotationsFor('aimeat_v2_task_status'), async (args) => {
    const { client } = pickAgent(registry, args.agent_name);
    return answer(await client.post(`/v1/agents/v2/tasks/${encodeURIComponent(args.task_id)}/status`, {
      status: args.status, statusMessage: args.status_message, result: args.result,
      error: args.error, ttlMs: args.ttl_ms, pollIntervalMs: args.poll_interval_ms,
    }));
  });

  mcp.tool('aimeat_v2_task_cancel', descriptionFor('aimeat_v2_task_cancel'), {
    agent_name: agentNameSchema,
    task_id: z.string().describe('The task id.'),
    reason: z.string().optional().describe('Why, in one line.'),
  }, annotationsFor('aimeat_v2_task_cancel'), async ({ agent_name, task_id, reason }) => {
    const { client } = pickAgent(registry, agent_name);
    return answer(await client.post(`/v1/agents/v2/tasks/${encodeURIComponent(task_id)}/cancel`, { reason }));
  });
}
