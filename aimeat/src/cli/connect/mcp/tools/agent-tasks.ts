/**
 * @file agent-tasks.ts
 * @description MCP tool registrations for agent task management. All routes
 *   are scoped to the connected agent via /v1/agents/{name}/tasks.
 * @version-history v1.1.0 -- 2026-05-28 -- Add TODO proposal tool for Hello Integration.
 * @version-history v1.1.1 -- 2026-05-28 -- Remove owner-only task start tool from agent MCP surface.
 * @version-history v1.1.2 -- 2026-05-28 -- Send task complete/fail messages with the REST API field name.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatClient } from '../../api-client.js';

export function registerAgentTasksTools(mcp: McpServer, client: AimeatClient, agentName?: string): void {
  const enc = encodeURIComponent(agentName!);

  mcp.tool('aimeat_task_list', 'List tasks for the connected agent', {
    status: z.string().optional().describe('Filter by task status'),
  }, async ({ status }) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    const resp = await client.get(`/v1/agents/${enc}/tasks${qs}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_task_get', 'Get task detail', {
    task_id: z.string().describe('Task identifier'),
  }, async ({ task_id }) => {
    const resp = await client.get(`/v1/agents/${enc}/tasks/${encodeURIComponent(task_id)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_task_propose_todos', 'Propose TODOs for a queued task before owner approval or onboarding auto-start', {
    task_id: z.string().describe('Task identifier'),
    todos: z.array(z.object({
      title: z.string().describe('TODO title'),
      description: z.string().optional().describe('TODO details'),
      verification: z.string().optional().describe('How completion can be verified'),
      estimate_minutes: z.number().optional().describe('Estimated work time in minutes'),
    })).describe('Proposed TODO plan'),
  }, async ({ task_id, todos }) => {
    const payload = {
      todos: todos.map((todo, index) => ({
        id: `todo-${index + 1}`,
        order: index + 1,
        title: todo.title,
        description: todo.description ?? '',
        environment: 'agent',
        environment_reason: 'The connected agent can perform this onboarding verification step through AIMEAT MCP tools.',
        verification: todo.verification ?? '',
        estimate_minutes: todo.estimate_minutes,
        status: 'pending',
      })),
    };
    const resp = await client.patch(`/v1/agents/${enc}/tasks/${encodeURIComponent(task_id)}`, payload);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_task_event', 'Append a progress event to a task', {
    task_id: z.string().describe('Task identifier'),
    type: z.string().describe('Event type'),
    message: z.string().describe('Event message'),
  }, async ({ task_id, type, message }) => {
    const resp = await client.post(`/v1/agents/${enc}/tasks/${encodeURIComponent(task_id)}/event`, { type, message });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_task_todo', 'Update a TODO item status within a task', {
    task_id: z.string().describe('Task identifier'),
    todo_id: z.string().describe('TODO item identifier'),
    status: z.string().describe('New status for the TODO item'),
  }, async ({ task_id, todo_id, status }) => {
    const resp = await client.patch(
      `/v1/agents/${enc}/tasks/${encodeURIComponent(task_id)}/todos/${encodeURIComponent(todo_id)}`,
      { status },
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_task_complete', 'Complete a task', {
    task_id: z.string().describe('Task identifier'),
    message: z.string().optional().describe('Completion message'),
    summary: z.string().optional().describe('Completion message alias for older callers'),
  }, async ({ task_id, message, summary }) => {
    const body: Record<string, unknown> = {};
    if (message ?? summary) body.message = message ?? summary;
    const resp = await client.post(`/v1/agents/${enc}/tasks/${encodeURIComponent(task_id)}/complete`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_task_fail', 'Fail a task with a reason', {
    task_id: z.string().describe('Task identifier'),
    reason: z.string().describe('Failure reason alias for message'),
    message: z.string().optional().describe('Failure message'),
  }, async ({ task_id, reason, message }) => {
    const resp = await client.post(`/v1/agents/${enc}/tasks/${encodeURIComponent(task_id)}/fail`, { message: message ?? reason });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
