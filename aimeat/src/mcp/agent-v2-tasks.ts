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
 *   A SESSION HERE IS AN AGENT, so the principal is the session caller with the agent role and the ops apply the
 *   assignee rule and the caller rule to it exactly as they would on any other door.
 *
 * @structure registerAgentV2TaskTools(mcp, storage, config, getAgentGaii, getOwner, caller?)
 * @usage registerAgentV2TaskTools(mcp, storage, config, () => agentGaii, () => owner, caller);
 * @version-history
 *   2026-10-05 — The caller is the session's CallerContext (services/caller-context.ts) instead of an object built here (secaudit 2026-10, C9).
 *   2026-10-05 — aimeat_v2_task_list takes response_format and gives the catalog's concise view
 *     (secaudit 2026-10, M3).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V5).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor, shapeResponse } from '../tool-catalog/shape.js';
import { publicTask } from '../models/agent-v2-task.js';
import { createTask, listTasks, getTask, setTaskStatus, cancelTask } from '../services/agent-v2-tasks-ops.js';
import type { Principal, OpResult } from '../services/agent-v2-messaging-ops.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { agentSessionCaller, type CallerContext } from '../services/caller-context.js';

function reply<T>(out: OpResult<T>, shape: (value: T) => unknown) {
  if (!out.ok) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ code: out.code, message: out.message, details: out.details }, null, 2) }],
      isError: true,
    };
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(shape(out.value), null, 2) }] };
}

export function registerAgentV2TaskTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
  getOwner: () => string,
  /** The session's caller (services/caller-context.ts). register-all.ts passes it; a caller that does
   *  not (test/unit/v2-list-concise.test.ts) gets the same agent built from the arguments above. */
  caller: () => CallerContext = () => agentSessionCaller(getAgentGaii(), getOwner(), [], config.nodeId, storage),
): void {
  const principal = (): Principal => caller().auth;

  mcp.tool(
    'aimeat_v2_task_create',
    descriptionFor('aimeat_v2_task_create'),
    zodShapeFor('aimeat_v2_task_create'),
    annotationsFor('aimeat_v2_task_create'),
    async (args) => reply(
      await createTask(storage, config, principal(), args),
      (task) => ({ task: publicTask(task) }),
    ),
  );

  mcp.tool(
    'aimeat_v2_task_list',
    descriptionFor('aimeat_v2_task_list'),
    zodShapeFor('aimeat_v2_task_list'),
    annotationsFor('aimeat_v2_task_list'),
    async ({ response_format, ...args }) => reply(
      await listTasks(storage, principal(), args),
      // The catalog's concise view: each task's id, status, who it is for and who asked, and when it moved.
      (tasks) => shapeResponse('aimeat_v2_task_list', response_format, { tasks: tasks.map(publicTask), count: tasks.length }),
    ),
  );

  mcp.tool(
    'aimeat_v2_task_get',
    descriptionFor('aimeat_v2_task_get'),
    zodShapeFor('aimeat_v2_task_get'),
    annotationsFor('aimeat_v2_task_get'),
    async (args) => reply(
      await getTask(storage, principal(), args.task_id),
      (task) => ({ task: publicTask(task) }),
    ),
  );

  mcp.tool(
    'aimeat_v2_task_status',
    descriptionFor('aimeat_v2_task_status'),
    zodShapeFor('aimeat_v2_task_status'),
    annotationsFor('aimeat_v2_task_status'),
    async (args) => reply(
      await setTaskStatus(storage, config, principal(), args.task_id, args),
      (task) => ({ task: publicTask(task) }),
    ),
  );

  mcp.tool(
    'aimeat_v2_task_cancel',
    descriptionFor('aimeat_v2_task_cancel'),
    zodShapeFor('aimeat_v2_task_cancel'),
    annotationsFor('aimeat_v2_task_cancel'),
    async (args) => reply(
      await cancelTask(storage, config, principal(), args.task_id, args.reason),
      (task) => ({ task: publicTask(task) }),
    ),
  );
}
