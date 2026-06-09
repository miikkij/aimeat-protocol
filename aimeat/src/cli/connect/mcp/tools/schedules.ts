/**
 * @file schedules.ts
 * @description Connector MCP registrations for the agent schedule tools — parity with the server
 *   MCP (src/mcp/agent-schedules.ts) so `aimeat connect serve --surface agent` exposes the same
 *   scheduling tools locally. Thin REST wrappers over /v1/schedules; aimeat_schedule_report_internal
 *   has no dedicated REST route (it is a structured memory write), so it writes the
 *   `agents.<name>.scheduler` mirror via /v1/memory.
 * @version-history
 *   v1.0.0 -- 2026-06-09 -- Initial: close the connector-surfaces gap for schedule_* (create/list/
 *     update/delete/report_internal).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerSchedulesTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client, agent } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  mcp.tool('aimeat_schedule_create', descriptionFor('aimeat_schedule_create'), {
    kind: z.enum(['ai', 'agent_task', 'extension']).describe('ai = server-side OpenRouter completion; agent_task = queue a task each fire; extension = run an installed extension action.'),
    cron: z.string().describe('Cron expression, e.g. "0 7 * * *".'),
    display_name: z.string().describe('Human-readable label.'),
    timezone: z.string().optional().describe('IANA timezone, e.g. "Europe/Helsinki".'),
    description: z.string().optional(),
    purpose: z.string().optional(),
    target_agent: z.string().optional().describe('agent_task only: target agent name (defaults to yourself).'),
    prompt: z.string().optional().describe('ai: the instruction applied to the input memory values.'),
    input_keys: z.array(z.string()).optional().describe('ai: owner memory keys fed in as context.'),
    system_prompt: z.string().optional(),
    model: z.string().optional(),
    output_key: z.string().optional(),
    task_title: z.string().optional().describe('agent_task: title of the task created each fire.'),
    task_description: z.string().optional(),
    extension_name: z.string().optional(),
    action_id: z.string().optional(),
  }, annotationsFor('aimeat_schedule_create'), async (a) => {
    return out(await client.post('/v1/schedules', a as Record<string, unknown>));
  });

  mcp.tool('aimeat_schedule_list', descriptionFor('aimeat_schedule_list'), {}, annotationsFor('aimeat_schedule_list'), async () => {
    return out(await client.get('/v1/schedules'));
  });

  mcp.tool('aimeat_schedule_update', descriptionFor('aimeat_schedule_update'), {
    schedule_id: z.string(),
    enabled: z.boolean().optional().describe('false = pause, true = resume.'),
    cron: z.string().optional(),
    timezone: z.string().optional(),
    display_name: z.string().optional(),
  }, annotationsFor('aimeat_schedule_update'), async ({ schedule_id, ...rest }) => {
    return out(await client.patch(`/v1/schedules/${encodeURIComponent(schedule_id)}`, rest as Record<string, unknown>));
  });

  mcp.tool('aimeat_schedule_delete', descriptionFor('aimeat_schedule_delete'), {
    schedule_id: z.string(),
  }, annotationsFor('aimeat_schedule_delete'), async ({ schedule_id }) => {
    return out(await client.delete(`/v1/schedules/${encodeURIComponent(schedule_id)}`));
  });

  // No dedicated REST route: the internal-scheduler mirror is a structured memory record under
  // `agents.<name>.scheduler` (matches the server MCP tool). Write it via /v1/memory.
  mcp.tool('aimeat_schedule_report_internal', descriptionFor('aimeat_schedule_report_internal'), {
    entries: z.array(z.object({
      id: z.string().optional(),
      name: z.string(),
      description: z.string().optional(),
      purpose: z.string().optional(),
      cron: z.string().optional(),
      timezone: z.string().optional(),
      schedule: z.string().optional().describe('Human-readable schedule if no cron, e.g. "Every day 07:00".'),
      status: z.enum(['active', 'paused']).optional(),
      kind: z.string().optional(),
    })).describe('Your full set of internal schedules (replaces the previous report).'),
  }, annotationsFor('aimeat_schedule_report_internal'), async ({ entries }) => {
    const key = `agents.${agent}.scheduler`;
    const value = { version: 1, updatedAt: new Date().toISOString(), entries: entries.map(e => ({ id: e.id ?? randomUUID(), ...e })) };
    const resp = await client.post('/v1/memory', { key, value, visibility: 'owner', tags: ['scheduler', 'internal'] });
    return { content: [{ type: 'text' as const, text: JSON.stringify({ reported: true, count: entries.length, key, result: resp.data ?? resp }, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) };
  });
}
