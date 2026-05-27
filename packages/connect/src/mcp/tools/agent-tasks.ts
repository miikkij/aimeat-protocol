/**
 * @file agent-tasks.ts
 * @description MCP tool registrations for agent task management. All routes
 *   are scoped to the connected agent via /v1/agents/{name}/tasks.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatClient } from '../../lib/api-client.js';

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

  mcp.tool('aimeat_task_start', 'Start a queued task', {
    task_id: z.string().describe('Task identifier'),
  }, async ({ task_id }) => {
    const resp = await client.post(`/v1/agents/${enc}/tasks/${encodeURIComponent(task_id)}/start`);
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
    summary: z.string().optional().describe('Completion summary'),
  }, async ({ task_id, summary }) => {
    const body: Record<string, unknown> = {};
    if (summary) body.summary = summary;
    const resp = await client.post(`/v1/agents/${enc}/tasks/${encodeURIComponent(task_id)}/complete`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_task_fail', 'Fail a task with a reason', {
    task_id: z.string().describe('Task identifier'),
    reason: z.string().describe('Failure reason'),
  }, async ({ task_id, reason }) => {
    const resp = await client.post(`/v1/agents/${enc}/tasks/${encodeURIComponent(task_id)}/fail`, { reason });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
