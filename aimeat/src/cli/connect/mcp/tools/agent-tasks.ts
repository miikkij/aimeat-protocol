/**
 * @file agent-tasks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tool registrations for agent task management. Routes are
 *   scoped to the connected agent via /v1/agents/{name}/tasks. In multi-agent
 *   mode, each tool accepts an optional `agent_name` parameter; if omitted, the
 *   registry's primary agent is used.
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   2026-10-04 — aimeat_task_decline: the agent refuses a task with its reason (POST …/decline).
 *   2026-10-02 — aimeat_agent_scope_narrow (ruling C).
 *   2026-10-02 — aimeat_task_create takes `start`, propose_todos takes `effects` per todo, and
 *     aimeat_task_start / aimeat_agent_task_start_set: parity with the server MCP surface.
 *   2026-08-16 — aimeat_task_complete takes `deliverable_key`. It had been on the REST route and the
 *     server MCP tool and missing here, so zod stripped it from every connector call: the completion
 *     succeeded and the pointer to the agent's own output was gone. Found by crewaimeat-dev, who
 *     spent an afternoon proving the node had lost a value the client never sent.
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
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, pickAgent, envelopeResult } from './_registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { provenanceEchoedResult } from '../../../../tool-dispatch/ai-provenance-carry.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerAgentTasksTools(mcp: McpServer, registry: AgentRegistry): void {

  mcp.tool('aimeat_task_list', descriptionFor('aimeat_task_list'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_task_list') }, annotationsFor('aimeat_task_list'), async ({ agent_name, status, page, per_page }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    const enc = encodeURIComponent(agent);
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (page !== undefined) params.set('page', String(page));
    if (per_page !== undefined) params.set('per_page', String(per_page));
    const qs = params.toString() ? `?${params.toString()}` : '';
    const resp = await client.get(`/v1/agents/${enc}/tasks${qs}`);
    return envelopeResult(resp);
  });

  mcp.tool(
    'aimeat_task_create',
    descriptionFor('aimeat_task_create'),
    { agent_name: agentNameSchema, ...zodShapeFor('aimeat_task_create') },
    annotationsFor('aimeat_task_create'),
    async ({ agent_name, target_agent, title, description, status, files, scope, start }) => {
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
      if (start) body.start = start;
      const resp = await client.post(`/v1/agents/${encodeURIComponent(target_agent)}/tasks`, body);
      return envelopeResult(resp);
    },
  );

  mcp.tool('aimeat_task_get', descriptionFor('aimeat_task_get'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_task_get') }, annotationsFor('aimeat_task_get'), async ({ agent_name, task_id }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    const enc = encodeURIComponent(agent);
    const resp = await client.get(`/v1/agents/${enc}/tasks/${encodeURIComponent(task_id)}`);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_task_propose_todos', descriptionFor('aimeat_task_propose_todos'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_task_propose_todos') }, annotationsFor('aimeat_task_propose_todos'), async ({ agent_name, task_id, todos }) => {
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
        ...(todo.effects?.length ? { effects: todo.effects } : {}),
      })),
    };
    const resp = await client.post(`/v1/agents/${enc}/tasks/${encodeURIComponent(task_id)}/propose-todos`, payload);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_task_start', descriptionFor('aimeat_task_start'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_task_start') }, annotationsFor('aimeat_task_start'), async ({ agent_name, task_id }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    // The route reads the task by id; the name segment is the caller's own and decides nothing.
    const resp = await client.post(`/v1/agents/${encodeURIComponent(agent)}/tasks/${encodeURIComponent(task_id)}/start`, {});
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_agent_scope_narrow', descriptionFor('aimeat_agent_scope_narrow'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_agent_scope_narrow') }, annotationsFor('aimeat_agent_scope_narrow'), async ({ agent_name, target_agent_name }) => {
    const { client } = pickAgent(registry, agent_name);
    const resp = await client.post(`/v1/agents/${encodeURIComponent(target_agent_name)}/scope-narrowing`, {});
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_agent_task_start_set', descriptionFor('aimeat_agent_task_start_set'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_agent_task_start_set') }, annotationsFor('aimeat_agent_task_start_set'), async ({ agent_name, target_agent_name, task_start }) => {
    const { client } = pickAgent(registry, agent_name);
    const resp = await client.patch(`/v1/agents/${encodeURIComponent(target_agent_name)}/task-start`, { task_start });
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_task_request_changes', descriptionFor('aimeat_task_request_changes'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_task_request_changes') }, annotationsFor('aimeat_task_request_changes'), async ({ agent_name, task_id, message }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    const enc = encodeURIComponent(agent);
    const resp = await client.post(`/v1/agents/${enc}/tasks/${encodeURIComponent(task_id)}/request-changes`, { message });
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_task_event', descriptionFor('aimeat_task_event'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_task_event') }, annotationsFor('aimeat_task_event'), async ({ agent_name, task_id, type, message, details }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    const enc = encodeURIComponent(agent);
    const body: Record<string, unknown> = { type, message };
    if (details) body.details = details;
    const resp = await client.post(`/v1/agents/${enc}/tasks/${encodeURIComponent(task_id)}/event`, body);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_task_todo', descriptionFor('aimeat_task_todo'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_task_todo') }, annotationsFor('aimeat_task_todo'), async ({ agent_name, task_id, todo_id, status }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    const enc = encodeURIComponent(agent);
    const resp = await client.patch(
      `/v1/agents/${enc}/tasks/${encodeURIComponent(task_id)}/todos/${encodeURIComponent(todo_id)}`,
      { status },
    );
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_task_complete', descriptionFor('aimeat_task_complete'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_task_complete') }, annotationsFor('aimeat_task_complete'), async ({ agent_name, task_id, message, deliverable_key, ai_provenance, ai_provenance_id }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    const enc = encodeURIComponent(agent);
    const body: Record<string, unknown> = {};
    if (message) body.message = message;
    if (deliverable_key) body.deliverable_key = deliverable_key;
    const resp = await client.post(`/v1/agents/${enc}/tasks/${encodeURIComponent(task_id)}/complete`, body);
    return provenanceEchoedResult(client,
      { tool: 'aimeat_task_complete', declared: ai_provenance, declaredId: ai_provenance_id }, resp);
  });

  mcp.tool('aimeat_task_fail', descriptionFor('aimeat_task_fail'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_task_fail') }, annotationsFor('aimeat_task_fail'), async ({ agent_name, task_id, reason }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    const enc = encodeURIComponent(agent);
    // REST /fail reads `message`; server MCP exposes this as `reason`.
    const resp = await client.post(`/v1/agents/${enc}/tasks/${encodeURIComponent(task_id)}/fail`, { message: reason });
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_task_decline', descriptionFor('aimeat_task_decline'), { agent_name: agentNameSchema, ...zodShapeFor('aimeat_task_decline') }, annotationsFor('aimeat_task_decline'), async ({ agent_name, task_id, reason }) => {
    const { client, agent } = pickAgent(registry, agent_name);
    const enc = encodeURIComponent(agent);
    const resp = await client.post(`/v1/agents/${enc}/tasks/${encodeURIComponent(task_id)}/decline`, { reason });
    return envelopeResult(resp);
  });
}
