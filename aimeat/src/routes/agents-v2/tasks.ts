/**
 * @file src/routes/agents-v2/tasks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Agent v2 task doors: the handle a caller holds while work runs.
 *
 *     POST /v1/agents/v2/tasks               ask a principal on this account to do something
 *     GET  /v1/agents/v2/tasks               the roster, by assignee, caller, context or status
 *     GET  /v1/agents/v2/tasks/:taskId       one task, with its A2A state beside its MCP status
 *     POST /v1/agents/v2/tasks/:taskId/status   the assignee reports where it has got to
 *     POST /v1/agents/v2/tasks/:taskId/cancel   the caller changes its mind
 *
 *   THE DASHBOARD TASKS ARE A DIFFERENT THING AND ARE UNTOUCHED. `/v1/agents/:name/tasks` is the
 *   owner's work item with a title, todos, approval and an SLA. This is the polling handle MCP
 *   defines and A2A reads. Both exist; the reasoning is in storage/types/agent-v2-tasks.ts.
 *
 *   THIS FILE IS A SHAPE, NOT A DECISION. Who may move a task, what a terminal task refuses and how
 *   a race is resolved all live in services/agent-v2-tasks-ops.ts, which the MCP and CLI doors call
 *   too. A rule written here would be a rule the other three doors do not have.
 *
 * @structure registerAgentV2TaskRoutes(router, config, storage)
 * @usage registerAgentV2TaskRoutes(router, config, storage);
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V5).
 */
import type { Router, Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { publicTask } from '../../models/agent-v2-task.js';
import { createTask, listTasks, getTask, setTaskStatus, cancelTask } from '../../services/agent-v2-tasks-ops.js';
import type { OpResult } from '../../services/agent-v2-messaging-ops.js';

function refuse(res: Response, nodeId: string, out: Extract<OpResult<unknown>, { ok: false }>): void {
  res.status(out.status).json(error(nodeId, out.code, out.message, undefined, out.details));
}

export function registerAgentV2TaskRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  // `task:write` is the word the existing task routes take, and this is the same act: creating work
  // on this account. Two words for one authority would mean an owner granting both to mean one.
  router.post('/v1/agents/v2/tasks', requireAuth(), requireScope('task:write'), async (req, res) => {
    const out = await createTask(storage, config, req.auth!, req.body);
    if (!out.ok) { refuse(res, config.nodeId, out); return; }
    res.status(201).json(success(config.nodeId, { task: publicTask(out.value) }, [
      { description: 'Poll it', method: 'GET', url: `/v1/agents/v2/tasks/${encodeURIComponent(out.value.taskId)}` },
    ]));
  });

  router.get('/v1/agents/v2/tasks', requireAuth(), async (req, res) => {
    const out = await listTasks(storage, req.auth!, {
      context_id: req.query.context_id as string | undefined,
      assigned_to: req.query.assigned_to as string | undefined,
      created_by: req.query.created_by as string | undefined,
      status: req.query.status as string | undefined,
      limit: req.query.limit === undefined ? undefined : Number(req.query.limit),
    });
    if (!out.ok) { refuse(res, config.nodeId, out); return; }
    res.json(success(config.nodeId, { tasks: out.value.map(publicTask), count: out.value.length }));
  });

  router.get('/v1/agents/v2/tasks/:taskId', requireAuth(), async (req, res) => {
    const out = await getTask(storage, req.auth!, req.params.taskId as string);
    if (!out.ok) { refuse(res, config.nodeId, out); return; }
    res.json(success(config.nodeId, { task: publicTask(out.value) }));
  });

  router.post('/v1/agents/v2/tasks/:taskId/status', requireAuth(), requireScope('task:write'), async (req, res) => {
    const out = await setTaskStatus(storage, config, req.auth!, req.params.taskId as string, req.body);
    if (!out.ok) { refuse(res, config.nodeId, out); return; }
    res.json(success(config.nodeId, { task: publicTask(out.value) }));
  });

  router.post('/v1/agents/v2/tasks/:taskId/cancel', requireAuth(), requireScope('task:write'), async (req, res) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const out = await cancelTask(storage, config, req.auth!, req.params.taskId as string, reason);
    if (!out.ok) { refuse(res, config.nodeId, out); return; }
    res.json(success(config.nodeId, { task: publicTask(out.value) }));
  });
}
