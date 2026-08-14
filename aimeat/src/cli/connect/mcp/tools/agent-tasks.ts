/**
 * @file agent-tasks.ts
 * @description MCP tool registrations for agent task management. Routes are
 *   scoped to the connected agent via /v1/agents/{name}/tasks. In multi-agent
 *   mode, each tool accepts an optional `agent_name` parameter; if omitted, the
 *   registry's primary agent is used.
 * @version-history
 *   2026-08-14 — aimeat_task_create takes `scope`, parity with the server MCP surface.
 *   v2.4.0 -- 2026-08-01 -- TARGET-058 Phase 11: aimeat_task_complete carries `ai_provenance` /
 *     `ai_provenance_id` and echoes what was recorded.
 *   v1.1.0 -- 2026-05-28 -- Add TODO proposal tool for Hello Integration
 *   v1.1.1 -- 2026-05-28 -- Remove owner-only task start tool from agent MCP surface
 *   v1.1.2 -- 2026-05-28 -- Send task complete/fail messages with the REST API field name
 *   v2.0.0 -- 2026-05-29 -- Registry-driven, agent_name parameter, multi-agent support
 *   v2.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v2.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v2.3.0 -- 2026-05-30 -- F10 drift reconciliation: task_list +page/per_page; task_event +details;
 *     task_complete canonical on message (dropped summary alias); task_fail canonical on reason (dropped
 *     message alias) to match server MCP. REST /fail still receives the value as `message`.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, pickAgent } from './_registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';
import { aiProvenanceInputs } from '../../../../mcp/ai-provenance-input.js';
import { provenanceEchoedResult } from '../../ai-provenance-carry.js';

export function registerAgentTasksTools(mcp: McpServer, registry: AgentRegistry): void {

  mcp.tool('aimeat_task_list', descriptionFor('aimeat_task_list'), {
    agent_name: agentNameSchema,
    status: z.string().optional().describe('Filter by task status'),
    page: z.number().optional().describe('Page number (default 1)'),
    per_page: z.number().optional().describe('Results per page (default 20, max 100)'),
  }, annotationsFor('aimeat_task_list'), async ({ agent_name, status, page, per_page }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    const enc = encodeURIComponent(agent);
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (page !== undefined) params.set('page', String(page));
    if (per_page !== undefined) params.set('per_page', String(per_page));
    const qs = params.toString() ? `?${params.toString()}` : '';
    const resp = await client.get(`/v1/agents/${enc}/tasks${qs}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool(
    'aimeat_task_create',
    descriptionFor('aimeat_task_create'),
    {
      agent_name: agentNameSchema,
      target_agent: z.string().describe('Name of the agent the task is FOR. Must be owned by the same owner as the calling agent. Example: "demo-crew".'),
      title: z.string().describe('Short human-readable title for the task. Shows up in the owner\'s dashboard. Example: "Research 2026 agent orchestration trends".'),
      description: z.string().describe('The actual prompt / instruction for the target agent. This is what its liaison / runtime will read and act on.'),
      status: z.enum(['draft', 'queued']).optional().describe('Default "queued" (visible to the target agent immediately). Use "draft" if you want the owner to review before it goes live.'),
      files: z.array(z.string()).max(20).optional().describe('Files the target agent needs, by REFERENCE: "<owner@node>/<storage key>" each (a bare key means a file the calling agent owns). The caller must be able to read each file itself; the target agent gets a presigned download_url from aimeat_task_get.'),
      scope: z.array(z.object({
        name: z.string().describe('Field name the receiving runner reads, e.g. "kind", "memory_key", "app_id".'),
        value: z.string(),
        type: z.enum(['text', 'url', 'memory_key', 'number', 'cron']).optional().describe('How to read the value. Defaults to "text".'),
        description: z.string().optional(),
      })).max(20).optional().describe('Named parameters the receiving runner DISPATCHES on, as opposed to the description, which is prose for a model. A fleet runner recognises work by a `kind` entry here and takes its pointers from the others.'),
    },
    annotationsFor('aimeat_task_create'),
    async ({ agent_name, target_agent, title, description, status, files, scope }) => {
      const { client } = pickAgent(registry, agent_name);
      const body: Record<string, unknown> = {
        title,
        description,
        status: status ?? 'queued',
        // Minimal task shape -- server schema requires verification block + todos array
        // but they accept defaults. Caller can use aimeat_task_propose_todos later if needed.
        verification: { user_expects: '', technical_checks: [] },
        todos: [],
      };
      if (scope?.length) body.scope = scope.map(sc => ({ ...sc, type: sc.type ?? 'text' }));
      if (files?.length) body.resources = { files: files.map(ref => ({ ref })) };
      const resp = await client.post(`/v1/agents/${encodeURIComponent(target_agent)}/tasks`, body);
      return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
    },
  );

  mcp.tool('aimeat_task_get', descriptionFor('aimeat_task_get'), {
    agent_name: agentNameSchema,
    task_id: z.string().describe('Task identifier'),
  }, annotationsFor('aimeat_task_get'), async ({ agent_name, task_id }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    const enc = encodeURIComponent(agent);
    const resp = await client.get(`/v1/agents/${enc}/tasks/${encodeURIComponent(task_id)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_task_propose_todos', descriptionFor('aimeat_task_propose_todos'), {
    agent_name: agentNameSchema,
    task_id: z.string().describe('Task identifier'),
    todos: z.array(z.object({
      title: z.string().describe('TODO title'),
      description: z.string().optional().describe('TODO details'),
      verification: z.string().optional().describe('How completion can be verified'),
      estimate_minutes: z.number().optional().describe('Estimated work time in minutes'),
    })).describe('Proposed TODO plan'),
  }, annotationsFor('aimeat_task_propose_todos'), async ({ agent_name, task_id, todos }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    const enc = encodeURIComponent(agent);
    // Dedicated endpoint handles the queued/revision_requested state machine
    // and merges new todos with the outdated history -- a raw PATCH would
    // clobber the outdated entries the owner can see in the dashboard.
    const payload = {
      todos: todos.map((todo) => ({
        title: todo.title,
        description: todo.description ?? '',
        environment: 'agent',
        verification: todo.verification ?? '',
        estimate_minutes: todo.estimate_minutes,
      })),
    };
    const resp = await client.post(`/v1/agents/${enc}/tasks/${encodeURIComponent(task_id)}/propose-todos`, payload);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_task_request_changes', descriptionFor('aimeat_task_request_changes'), {
    agent_name: agentNameSchema,
    task_id: z.string().describe('Task identifier (must be a queued task that already has proposed todos)'),
    message: z.string().describe("Owner's free-text change request explaining how the plan should be revised"),
  }, annotationsFor('aimeat_task_request_changes'), async ({ agent_name, task_id, message }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    const enc = encodeURIComponent(agent);
    const resp = await client.post(`/v1/agents/${enc}/tasks/${encodeURIComponent(task_id)}/request-changes`, { message });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_task_event', descriptionFor('aimeat_task_event'), {
    agent_name: agentNameSchema,
    task_id: z.string().describe('Task identifier'),
    type: z.string().describe('Event type'),
    message: z.string().describe('Event message'),
    details: z.record(z.string(), z.unknown()).optional().describe('Optional event details (may include telemetry)'),
  }, annotationsFor('aimeat_task_event'), async ({ agent_name, task_id, type, message, details }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    const enc = encodeURIComponent(agent);
    const body: Record<string, unknown> = { type, message };
    if (details) body.details = details;
    const resp = await client.post(`/v1/agents/${enc}/tasks/${encodeURIComponent(task_id)}/event`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_task_todo', descriptionFor('aimeat_task_todo'), {
    agent_name: agentNameSchema,
    task_id: z.string().describe('Task identifier'),
    todo_id: z.string().describe('TODO item identifier'),
    status: z.string().describe('New status for the TODO item'),
  }, annotationsFor('aimeat_task_todo'), async ({ agent_name, task_id, todo_id, status }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    const enc = encodeURIComponent(agent);
    const resp = await client.patch(
      `/v1/agents/${enc}/tasks/${encodeURIComponent(task_id)}/todos/${encodeURIComponent(todo_id)}`,
      { status },
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_task_complete', descriptionFor('aimeat_task_complete'), {
    agent_name: agentNameSchema,
    task_id: z.string().describe('Task identifier'),
    message: z.string().optional().describe('Completion message'),
    ...aiProvenanceInputs,
  }, annotationsFor('aimeat_task_complete'), async ({ agent_name, task_id, message, ai_provenance, ai_provenance_id }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    const enc = encodeURIComponent(agent);
    const body: Record<string, unknown> = {};
    if (message) body.message = message;
    const resp = await client.post(`/v1/agents/${enc}/tasks/${encodeURIComponent(task_id)}/complete`, body);
    return provenanceEchoedResult(client,
      { tool: 'aimeat_task_complete', declared: ai_provenance, declaredId: ai_provenance_id }, resp);
  });

  mcp.tool('aimeat_task_fail', descriptionFor('aimeat_task_fail'), {
    agent_name: agentNameSchema,
    task_id: z.string().describe('Task identifier'),
    reason: z.string().describe('Reason for failure'),
  }, annotationsFor('aimeat_task_fail'), async ({ agent_name, task_id, reason }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    const enc = encodeURIComponent(agent);
    // REST /fail reads `message`; server MCP exposes this as `reason`.
    const resp = await client.post(`/v1/agents/${enc}/tasks/${encodeURIComponent(task_id)}/fail`, { message: reason });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
