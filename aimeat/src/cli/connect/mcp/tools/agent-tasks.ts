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

}
