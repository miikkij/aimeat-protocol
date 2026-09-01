/**
 * @file src/mcp/agent-v2-tasks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The five Agent v2 task tools on the node's MCP surface.
 *
 *   EVERY ONE OF THEM CALLS services/agent-v2-tasks-ops.ts, the same functions the REST doors call.
 *   Nothing here decides who may move a task, what a terminal task refuses, or how a race between a
 *   completer and a canceller resolves.
 *
 *   A SESSION HERE IS AN AGENT, so the principal carries `roles: ['agent']` and the ops apply the
 *   assignee rule and the caller rule to it exactly as they would on any other door.
 *
 * @structure registerAgentV2TaskTools(mcp, storage, config, getAgentGaii, getOwner)
 * @usage registerAgentV2TaskTools(mcp, storage, config, () => agentGaii, () => owner);
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V5).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { publicTask } from '../models/agent-v2-task.js';
import { createTask, listTasks, getTask, setTaskStatus, cancelTask } from '../services/agent-v2-tasks-ops.js';
import type { Principal, OpResult } from '../services/agent-v2-messaging-ops.js';

function reply<T>(out: OpResult<T>, shape: (value: T) => unknown) {
  if (!out.ok) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ code: out.code, message: out.message, details: out.details }, null, 2) }],
      isError: true,
    };
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(shape(out.value), null, 2) }] };
}

const partsSchema = z.array(z.record(z.string(), z.unknown()))
  .describe('Parts: {kind:"text",text} or {kind:"file",file:{uri,name?,mimeType?}} or {kind:"data",data:{...}}.');

export function registerAgentV2TaskTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
  getOwner: () => string,
): void {
  const principal = (): Principal => ({ sub: getAgentGaii(), owner: getOwner(), roles: ['agent'] });

  mcp.tool(
    'aimeat_v2_task_create',
    descriptionFor('aimeat_v2_task_create'),
    {
      assigned_to: z.string().describe('The principal that is to do this.'),
      input: partsSchema,
      context_id: z.string().optional().describe('The exchange this work belongs to.'),
      status_message: z.string().optional().describe('One line for a person about what this is.'),
      ttl_ms: z.number().optional().describe('How long the result stays worth reading, in milliseconds.'),
      poll_interval_ms: z.number().optional().describe('How often you intend to poll, in milliseconds.'),
      metadata: z.record(z.string(), z.unknown()).optional().describe('Carried along, never read by the node.'),
    },
    annotationsFor('aimeat_v2_task_create'),
    async (args) => reply(
      await createTask(storage, config, principal(), args),
      (task) => ({ task: publicTask(task) }),
    ),
  );

  mcp.tool(
    'aimeat_v2_task_list',
    descriptionFor('aimeat_v2_task_list'),
    {
      assigned_to: z.string().optional().describe('Tasks given to this principal.'),
      created_by: z.string().optional().describe('Tasks this principal asked for.'),
      context_id: z.string().optional().describe('Tasks in one exchange.'),
      status: z.string().optional().describe('One status or a comma-separated list.'),
      limit: z.number().optional().describe('Max tasks to return (default 50, max 200).'),
    },
    annotationsFor('aimeat_v2_task_list'),
    async (args) => reply(
      await listTasks(storage, principal(), args),
      (tasks) => ({ tasks: tasks.map(publicTask), count: tasks.length }),
    ),
  );

  mcp.tool(
    'aimeat_v2_task_get',
    descriptionFor('aimeat_v2_task_get'),
    { task_id: z.string().describe('The task id.') },
    annotationsFor('aimeat_v2_task_get'),
    async (args) => reply(
      await getTask(storage, principal(), args.task_id),
      (task) => ({ task: publicTask(task) }),
    ),
  );

  mcp.tool(
    'aimeat_v2_task_status',
    descriptionFor('aimeat_v2_task_status'),
    {
      task_id: z.string().describe('The task id.'),
      status: z.enum(['working', 'input_required', 'completed', 'failed']).describe('Where it has got to.'),
      status_message: z.string().optional().describe('One line for a person.'),
      result: partsSchema.optional().describe('What came back. Required when completing.'),
      error: z.record(z.string(), z.unknown()).optional().describe('{ code, message }. Required when failing.'),
      ttl_ms: z.number().optional().describe('How long the result stays worth reading, in milliseconds.'),
      poll_interval_ms: z.number().optional().describe('How often the caller should poll from here.'),
    },
    annotationsFor('aimeat_v2_task_status'),
    async (args) => reply(
      await setTaskStatus(storage, config, principal(), args.task_id, args),
      (task) => ({ task: publicTask(task) }),
    ),
  );

  mcp.tool(
    'aimeat_v2_task_cancel',
    descriptionFor('aimeat_v2_task_cancel'),
    {
      task_id: z.string().describe('The task id.'),
      reason: z.string().optional().describe('Why, in one line.'),
    },
    annotationsFor('aimeat_v2_task_cancel'),
    async (args) => reply(
      await cancelTask(storage, config, principal(), args.task_id, args.reason),
      (task) => ({ task: publicTask(task) }),
    ),
  );
}
