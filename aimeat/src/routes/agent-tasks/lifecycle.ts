/**
 * @file src/routes/agent-tasks/lifecycle.ts
 * @description Agent-task lifecycle routes (update, delete, queue, start, propose-todos, request-changes, pause). Extracted from agent-tasks.ts to satisfy max-file-lines.
 * @version-history
 *   v1.3.0 — 2026-08-16 — POST .../queue: the exit a draft never had. Reported by crewaimeat-dev,
 *     who created a task over REST, got 'draft' from the body-schema default, and found nothing
 *     anywhere that could move it out again.
 *   v1.2.0 — 2026-08-11 — The propose-todos WRITE moves to services/agent-task-write.ts, so
 *     aimeat_task_propose_todos stops keeping its own copy of the plan build. Behaviour here is
 *     unchanged.
 *   v1.0.0 — 2026-07-13 — Extracted from agent-tasks.ts (max-file-lines)
 *   v1.1.0 — 2026-07-14 — propose-todos: allow the FIRST proposal on a plan-less active task
 *                          (auto-activated tasks are born active with zero todos — the 409 made
 *                          accept_test_task structurally impossible), and auto-activate a queued
 *                          task on proposal when the agent's mode is task-runner (zero-click
 *                          onboarding; matches the daemon's documented auto-approval promise).
 */

import type { Router } from 'express';
import { applyProposedPlan, type ProposedTodoInput } from '../../services/agent-task-write.js';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentTaskRecord, AgentTaskTodo, AgentMessageRecord } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireRole, requireScope } from '../../auth/middleware.js';
import { emitChange, emitDelivery } from '../../services/event-bus.js';
import { emitResourceUpdated } from '../../mcp/index.js';
import { recordTaskStarted } from '../../services/activity-recorder.js';
import { AgentTaskUpdateSchema, AgentTaskRequestChangesSchema } from '../../models/agent-task-schemas.js';
import { resolveAutoActivation, AUTO_ACTIVATED_EVENT_MESSAGE } from '../../services/agent-task-rules.js';
import { resolveTaskFileInputs } from '../../services/task-files.js';
import { requireReadiness } from '../../middleware/readiness-gate.js';
import type { TaskRouteHelpers } from './helpers.js';
import { logger } from '../../utils/logger.js';

export function registerTaskLifecycleRoutes(
  router: Router, config: AimeatConfig, storage: Storage, helpers: TaskRouteHelpers,
): void {
  const { resolve, resolveAgentGaii, tokenHasScope, canAccessTask, webhookDispatcher } = helpers;

  /* ── PATCH /v1/agents/:name/tasks/:id -- Update task ── */
  router.patch('/v1/agents/:name/tasks/:id', requireAuth(), requireReadiness('standard', config, storage), async (req, res) => {
    const id = req.params.id as string;

    const task = await storage.getAgentTask(id);
    if (!task) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Task not found'));
      return;
    }

    if (!canAccessTask(req, task)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');

    // Owners can update draft/queued tasks; agents can update queued (propose todos) and active (execute todos)
    if (isOwnerSession && !['draft', 'queued'].includes(task.status)) {
      res.status(409).json(error(config.nodeId, 'INVALID_STATE',
        `Owner can only update draft or queued tasks (current: ${task.status})`));
      return;
    }
    if (!isOwnerSession && !['queued', 'revision_requested', 'active'].includes(task.status)) {
      res.status(409).json(error(config.nodeId, 'INVALID_STATE',
        `Agent can only update queued, revision_requested, or active tasks (current: ${task.status})`));
      return;
    }

    const parsed = AgentTaskUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }

    const body = parsed.data;
    const now = new Date().toISOString();

    // Build partial update object (convert snake_case to camelCase)
    const updates: Partial<AgentTaskRecord> = { updatedAt: now };
    if (body.title !== undefined) updates.title = body.title.trim();
    if (body.description !== undefined) updates.description = body.description.trim();
    if (body.scope !== undefined) updates.scope = body.scope;
    if (body.rules !== undefined) updates.rules = body.rules;
    if (body.verification !== undefined) {
      updates.verification = {
        userExpects: body.verification.user_expects,
        technicalChecks: body.verification.technical_checks,
      };
    }
    if (body.resources !== undefined) {
      // Same create-time rule for attachments: the caller must be able to read what it attaches.
      const fileResult = await resolveTaskFileInputs(storage, config, body.resources.files, {
        gaii: resolve(req), sub: req.auth!.sub, owner: req.auth!.owner as string | undefined,
      });
      if ('error' in fileResult) {
        res.status(fileResult.error.status).json(error(config.nodeId, fileResult.error.code, fileResult.error.message));
        return;
      }
      updates.resources = {
        knowledgePackages: body.resources.knowledge_packages,
        memoryKeys: body.resources.memory_keys,
        memoryPrefixes: body.resources.memory_prefixes,
        ...(fileResult.files.length ? { files: fileResult.files } : {}),
      };
    }
    if (body.todos !== undefined) {
      updates.todos = body.todos.map(t => ({
        id: t.id,
        order: t.order,
        title: t.title,
        description: t.description,
        environment: t.environment,
        environmentReason: t.environment_reason,
        verification: t.verification,
        estimateMinutes: t.estimate_minutes,
        status: t.status,
        completedAt: t.completed_at,
      }));
    }

    const updated = await storage.updateAgentTask(id, updates);
    if (!updated) {
      res.status(500).json(error(config.nodeId, 'UPDATE_FAILED', 'Failed to update task'));
      return;
    }

    // Dispatch webhook when owner edits a task (fire-and-forget)
    if (webhookDispatcher && isOwnerSession) {
      const changedFields: string[] = [];
      if (body.title !== undefined) changedFields.push('title');
      if (body.description !== undefined) changedFields.push('description');
      if (body.scope !== undefined) changedFields.push('scope');
      if (body.rules !== undefined) changedFields.push('rules');
      if (body.todos !== undefined) changedFields.push('todos');
      if (body.verification !== undefined) changedFields.push('verification');
      if (body.resources !== undefined) changedFields.push('resources');
      if (changedFields.length > 0) {
        const agentGaii = resolveAgentGaii(req, req.params.name as string);
        webhookDispatcher.dispatchWebhookEvent(agentGaii, 'task.updated', {
          task_id: updated.id,
          title: updated.title,
          status: updated.status,
          changed_fields: changedFields,
          todo_count: updated.todos?.length ?? 0,
          pending_todo_count: (updated.todos ?? []).filter((t: AgentTaskTodo) => t.status === 'pending').length,
          updated_at: new Date().toISOString(),
        });
      }
    }

    res.json(success(config.nodeId, { task: updated }));
    emitChange('agent-tasks', resolve(req));
    try { emitResourceUpdated(resolveAgentGaii(req, req.params.name as string), `aimeat://agents/${req.params.name as string}/tasks`); } catch (err) { logger.warn('pending_todo_count: MCP not connected', { error: String(err) }); }
  });

  /* ── DELETE /v1/agents/:name/tasks/:id -- Delete a task + clean its traces ──
   *
   * Owner-only. Deletable in any state EXCEPT 'active' -- a running task must be
   * cancelled or paused first so we don't orphan a live runner mid-execution.
   * Everything else (draft/queued/revision_requested/paused/stalled/done/failed)
   * can be removed.
   *
   * Trace cleanup (best-effort, after the task + its event log are gone):
   *   - the live-status memory keys the agent wrote under its own namespace
   *     (`agents.<name>.tasks.<id>.*`)
   *   - the owner-written cancel marker (`agents.cancel.task.<id>`) that the
   *     runner daemon scans on every poll
   * The agent's actual deliverable/output memory is intentionally preserved.
   */
  router.delete('/v1/agents/:name/tasks/:id', requireAuth(), requireRole('owner'), async (req, res) => {
    const id = req.params.id as string;
    const agentName = req.params.name as string;

    const task = await storage.getAgentTask(id);
    if (!task) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Task not found'));
      return;
    }

    if (!canAccessTask(req, task)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    if (task.status === 'active') {
      res.status(409).json(error(config.nodeId, 'INVALID_STATE',
        'Active tasks cannot be deleted -- cancel or pause the task first, then delete it'));
      return;
    }

    const deleted = await storage.deleteAgentTask(id);
    if (!deleted) {
      res.status(409).json(error(config.nodeId, 'INVALID_STATE',
        'Task could not be deleted (it may have just become active)'));
      return;
    }

    // Clean the task's operational memory traces so a leftover doesn't confuse
    // the runner or the per-task memory view. Best-effort: a cleanup failure
    // must not fail the delete (the task itself is already gone).
    try {
      const livePrefix = `agents.${agentName}.tasks.${id}.`;
      const liveEntries = await storage.listMemory(task.agentGaii, { prefix: livePrefix });
      for (const m of liveEntries) await storage.deleteMemory(task.agentGaii, m.key);
    } catch (err) { logger.warn('DELETE /v1/agents/:name/tasks/:id: best-effort trace cleanup', { error: String(err) }); }
    try {
      await storage.deleteMemory(task.ownerGaii, `agents.cancel.task.${id}`);
    } catch (err) { logger.warn('DELETE /v1/agents/:name/tasks/:id: best-effort trace cleanup', { error: String(err) }); }

    res.json(success(config.nodeId, { deleted: true }));
    emitChange('agent-tasks', resolve(req));
    try { emitResourceUpdated(task.agentGaii, `aimeat://agents/${agentName}/tasks`); } catch (err) { logger.warn('DELETE /v1/agents/:name/tasks/:id: MCP not connected', { error: String(err) }); }
  });

  /* ── POST /v1/agents/:name/tasks/:id/queue -- Release a draft to the agent (draft -> queued) ──
   *
   * THE EXIT DRAFT NEVER HAD. A draft is the owner's "let me look at this before the agent sees
   * it", and until this route there was no way to finish that sentence: PATCH carries no status
   * field, /start refuses anything that is not queued|paused|stalled, and no other route or service
   * moved an existing task to queued. A draft was therefore permanent, and the only thing that kept
   * it from being obvious was that every in-house caller passed status:'queued' at create time.
   *
   * Owner or a same-owner app holding task:write, matching /start: releasing work to an agent is the
   * same authority as starting it, and the agent the task is FOR must not be able to let itself off
   * the leash.
   *
   * A task-runner agent goes straight to 'active' here, for the same reason it does at create time —
   * the owner has already pre-authorised that agent to begin without per-task gating, and making the
   * release path the one exception would mean a draft released to a runner sat waiting for a second
   * click that no other route asks for.
   */
  // The scope sits in MIDDLEWARE rather than in the handler, unlike its neighbours. requireScope
  // waves an owner session straight through (owners act for all their agents), so this costs the
  // owner path nothing and refuses an app-grant token that never held `task:write` at the door,
  // before any of the reads below. /start and the rest of this file do the same test by hand and
  // are on the seeded route-scope exemption list because of it; that list may only shrink, so a
  // route added today does not join it.
  router.post('/v1/agents/:name/tasks/:id/queue', requireAuth(), requireScope('task:write'), async (req, res) => {
    const queueRoles = req.auth!.roles;
    const isOwner = queueRoles.includes('owner') && !queueRoles.includes('agent');
    const isApp = queueRoles.includes('app');
    if (!isOwner && !isApp) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the owner or a granted app can release a draft task'));
      return;
    }

    const id = req.params.id as string;
    const task = await storage.getAgentTask(id);
    if (!task) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Task not found'));
      return;
    }

    const appOwnsTask = isApp && task.ownerGaii === `${req.auth!.owner}@${config.nodeId}`;
    if (!appOwnsTask && !canAccessTask(req, task)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    if (task.status !== 'draft') {
      res.status(409).json(error(config.nodeId, 'INVALID_STATE',
        `Only a draft task can be released to the agent (current: ${task.status})`));
      return;
    }

    const targetAgent = await storage.getAgent(task.agentGaii);
    const { autoActivated, effectiveStatus } = resolveAutoActivation(targetAgent, 'queued');

    const now = new Date().toISOString();
    const updated = await storage.updateAgentTask(id, {
      status: effectiveStatus,
      lastEventAt: now,
      updatedAt: now,
    });

    if (autoActivated) {
      await storage.appendTaskEvent({
        id: randomUUID(), taskId: id, type: 'started',
        message: AUTO_ACTIVATED_EVENT_MESSAGE, timestamp: now,
      });
      await recordTaskStarted(storage, task.agentGaii);
    }

    res.json(success(config.nodeId, { task: updated, auto_activated: autoActivated }));
    emitChange('agent-tasks', resolve(req));
    try { emitResourceUpdated(task.agentGaii, `aimeat://agents/${req.params.name as string}/tasks`); } catch (err) { logger.warn('POST /v1/agents/:name/tasks/:id/queue: MCP not connected', { error: String(err) }); }
    // Only a task that is RUNNABLE wakes the daemon. A plain queued task is waiting for the owner's
    // /start, and pushing it would have the agent pick up work nobody released to it yet.
    if (autoActivated) emitDelivery({ target: task.agentGaii, kind: 'task_assigned', id: updated!.id, payload: updated });
  });

  /* ── POST /v1/agents/:name/tasks/:id/start -- Start task (queued|paused|stalled -> active) ── */
  router.post('/v1/agents/:name/tasks/:id/start', requireAuth(), async (req, res) => {
    // Owner OR a same-owner app grant holding task:write may start a task; agents must not
    // self-start (propose-before-start rule).
    const startRoles = req.auth!.roles;
    const isOwner = startRoles.includes('owner') && !startRoles.includes('agent');
    const isApp = startRoles.includes('app');
    if (!isOwner && !isApp) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the owner or a granted app can start tasks'));
      return;
    }
    if (isApp && !tokenHasScope(req, 'task:write')) {
      res.status(403).json(error(config.nodeId, 'SCOPE_DENIED', 'Scope "task:write" required to start tasks'));
      return;
    }

    const id = req.params.id as string;

    const task = await storage.getAgentTask(id);
    if (!task) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Task not found'));
      return;
    }

    // Owner-match: an app (task:write) may only start its OWN owner's task.
    const appOwnsTask = isApp && task.ownerGaii === `${req.auth!.owner}@${config.nodeId}`;
    if (!appOwnsTask && !canAccessTask(req, task)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    // Allow recovery from 'stalled': the stall detector marks tasks as stalled
    // when they go quiet for too long, but a stalled task is not a failed task
    // -- the agent may have crashed, been killed, or have lost its tokens. The
    // owner can re-start a stalled task to give the agent another chance
    // (typical scenario: onboarding test task stalls because the agent
    // subprocess died mid-flow; the owner fixes the subprocess and re-starts).
    if (task.status !== 'queued' && task.status !== 'paused' && task.status !== 'stalled') {
      res.status(409).json(error(config.nodeId, 'INVALID_STATE',
        `Only queued, paused, or stalled tasks can be started (current: ${task.status})`));
      return;
    }

    const now = new Date().toISOString();
    const updated = await storage.updateAgentTask(id, {
      status: 'active',
      lastEventAt: now,
      updatedAt: now,
    });

    // Append 'started' event
    await storage.appendTaskEvent({
      id: randomUUID(),
      taskId: id,
      type: 'started',
      message: 'Task started',
      timestamp: now,
    });

    await recordTaskStarted(storage, task.agentGaii);

    // Push: webhook + MCP notification (parallel, fire-and-forget)
    if (webhookDispatcher) {
      webhookDispatcher.dispatchWebhookEvent(task.agentGaii, 'task.approved', {
        task_id: task.id,
        title: task.title,
        status: 'active',
        todo_count: task.todos?.length ?? 0,
        pending_todo_count: (task.todos ?? []).filter((t: AgentTaskTodo) => t.status === 'pending').length,
        approved_at: now,
      });
    }
    try { emitResourceUpdated(task.agentGaii, `aimeat://agents/${req.params.name as string}/tasks`); } catch (err) { logger.warn('pending_todo_count: MCP not connected', { error: String(err) }); }
    // Connector forward tunnel: realtime reverse delivery of the now-active task. Owner approval
    // (queued -> active) is a runnable-state transition just like create-time auto-activation, so it
    // must push the same `task_assigned` wake — otherwise a daemon parked on the /local/tasks/next
    // long-poll only picks the task up on its ~5-min safety-net re-list (the "waits for polling" gap).
    // If the agent is offline the task stays 'active' in the store and is replayed via backlog-on-connect.
    emitDelivery({ target: task.agentGaii, kind: 'task_assigned', id: updated!.id, payload: updated });

    res.json(success(config.nodeId, { task: updated }));
    emitChange('agent-tasks', resolve(req));
  });

  /* ── POST /v1/agents/:name/tasks/:id/propose-todos -- Agent proposes (or re-proposes) a TODO plan ──
   *
   * The merge-aware companion to PATCH /tasks/:id. Use this endpoint instead
   * of raw PATCH when the agent wants to propose todos -- the server handles
   * the queued/revision_requested state machine and preserves the outdated
   * history correctly.
   *
   *  queued (no todos)        -> set todos = body.todos (status pending), no state change*
   *  queued (has pending)     -> replace pending todos with new ones (outdated preserved)*
   *  revision_requested        -> mark all current non-outdated todos as 'outdated',
   *                              APPEND new todos with status 'pending', flip task
   *                              status back to 'queued' so the owner can /start
   *                              (or /request-changes again).
   *  active (no live plan)     -> set todos = body.todos (status pending), stays active.
   *                              Auto-activated tasks (task-runner create, the Hello
   *                              Integration test task) are born 'active' with zero todos;
   *                              the agent's FIRST proposal must not 409 -- there is no
   *                              mid-execution plan to protect yet.
   *  active (has live plan)    -> 409 (mid-execution re-proposal goes through PATCH)
   *  anything else             -> 409
   *
   *  *task-runner auto-approval: when the target agent's mode is 'task-runner', a proposal
   *   on a plain 'queued' task also flips it to 'active' (started event + task_assigned
   *   push, same as create-time auto-activation) -- the owner pre-authorized this agent to
   *   start work without per-task gating, and a queued task that predates the mode switch
   *   (e.g. the registration-time onboarding test task) must not wait for a manual click.
   *   Revision cycles still return to 'queued': the owner explicitly asked to review.
   *
   * Owner can also call this endpoint (useful for owner-driven planning), but
   * the typical caller is the agent via aimeat_task_propose_todos MCP tool.
   */
  router.post('/v1/agents/:name/tasks/:id/propose-todos', requireAuth(), async (req, res) => {
    const id = req.params.id as string;

    const task = await storage.getAgentTask(id);
    if (!task) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Task not found'));
      return;
    }
    if (!canAccessTask(req, task)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }
    // The whole acceptance — the live-plan guard, the preserved history, the renumbering, the status
    // move and the auto-activation tail — is services/agent-task-write.ts, because it belongs to
    // ACCEPTING A PLAN rather than to this door. aimeat_task_propose_todos wrote its own copy.
    const proposeBody = req.body as { todos?: ProposedTodoInput[] };
    const result = await applyProposedPlan(
      { storage, config, webhook: webhookDispatcher }, task, proposeBody?.todos, resolve(req),
    );
    if (!result.ok) {
      res.status(result.status).json(error(config.nodeId, result.code, result.message));
      return;
    }
    try { emitResourceUpdated(task.agentGaii, `aimeat://agents/${req.params.name as string}/tasks`); } catch (err) { logger.warn('POST /v1/agents/:name/tasks/:id/propose-todos: MCP not connected', { error: String(err) }); }

    res.json(success(config.nodeId, { task: result.task }));
  });

  /* ── POST /v1/agents/:name/tasks/:id/request-changes -- Owner asks agent to revise the proposed TODOs ──
   *
   * Owner-only. Allowed only when the task is 'queued' AND has at least one
   * pending todo (i.e. the agent has already proposed something to revise).
   * The endpoint marks all non-outdated todos as 'outdated', flips the task
   * status to 'revision_requested', appends a 'revision_requested' task event
   * carrying the owner's free-text message, and pushes a linked inbound agent
   * message so the agent's inbox surfaces the request. The agent then calls
   * aimeat_task_propose_todos (or POST /propose-todos) with the revised plan;
   * that endpoint flips the task back to 'queued' for owner review.
   */
  router.post('/v1/agents/:name/tasks/:id/request-changes', requireAuth(), async (req, res) => {
    // Owner-session only -- agents inherit the owner role in their JWT (see
    // /v1/auth/token), so requireRole('owner') alone would let an agent
    // self-request-changes on its own proposed plan, which makes no sense.
    // The same pattern as /start gates this: ['owner'] AND NOT ['agent'].
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    if (!isOwnerSession) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the owner can request changes on a task'));
      return;
    }

    const id = req.params.id as string;
    const agentName = req.params.name as string;

    const task = await storage.getAgentTask(id);
    if (!task) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Task not found'));
      return;
    }
    if (!canAccessTask(req, task)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    if (task.status !== 'queued') {
      res.status(409).json(error(config.nodeId, 'INVALID_STATE',
        `Changes can only be requested on queued tasks (current: ${task.status})`));
      return;
    }
    const activeTodos = (task.todos ?? []).filter(t => t.status !== 'outdated');
    if (activeTodos.length === 0) {
      res.status(409).json(error(config.nodeId, 'INVALID_STATE',
        'Cannot request changes on a task with no proposed todos yet -- wait for the agent to propose a plan first'));
      return;
    }

    const parsed = AgentTaskRequestChangesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    const { message } = parsed.data;

    const now = new Date().toISOString();
    const retiredCount = activeTodos.length;
    const newTodos = (task.todos ?? []).map(t => t.status === 'outdated' ? t : { ...t, status: 'outdated' as const });

    const updated = await storage.updateAgentTask(id, {
      status: 'revision_requested',
      todos: newTodos,
      lastEventAt: now,
      updatedAt: now,
    });

    await storage.appendTaskEvent({
      id: randomUUID(),
      taskId: id,
      type: 'revision_requested',
      message,
      details: { outdated_count: retiredCount },
      timestamp: now,
    });

    // Push the change request to the agent's inbox as a linked message so the
    // agent can pick it up without separately polling task events. Owner is
    // the sender; direction='inbound' (user -> agent); status='pending' so
    // the agent sees it in /messages/inbox until processed.
    const messageRecord: AgentMessageRecord = {
      id: randomUUID(),
      agentGaii: task.agentGaii,
      threadId: randomUUID(),
      direction: 'inbound',
      senderGaii: `${req.auth!.owner}@${config.nodeId}`,
      content: message,
      status: 'pending',
      linkedTaskId: id,
      createdAt: now,
    };
    await storage.createMessage(messageRecord);

    if (webhookDispatcher) {
      webhookDispatcher.dispatchWebhookEvent(task.agentGaii, 'task.updated', {
        task_id: task.id,
        title: task.title,
        status: 'revision_requested',
        changed_fields: ['status', 'todos'],
        todo_count: newTodos.length,
        pending_todo_count: 0,
        updated_at: now,
      });
      webhookDispatcher.dispatchWebhookEvent(task.agentGaii, 'message.inbound', {
        message_id: messageRecord.id,
        thread_id: messageRecord.threadId,
        linked_task_id: id,
        preview: message.substring(0, 200),
        has_proposed_task: false,
        created_at: now,
      });
    }
    try { emitResourceUpdated(task.agentGaii, `aimeat://agents/${agentName}/tasks`); } catch (err) { logger.warn('newTodos: MCP not connected', { error: String(err) }); }
    try { emitResourceUpdated(task.agentGaii, `aimeat://agents/${agentName}/messages`); } catch (err) { logger.warn('newTodos: MCP not connected', { error: String(err) }); }

    res.json(success(config.nodeId, { task: updated, message: messageRecord }));
    emitChange('agent-tasks', resolve(req));
    emitChange('agent-messages', resolve(req));
  });

  /* ── POST /v1/agents/:name/tasks/:id/pause -- Pause task (active -> paused) ── */
  router.post('/v1/agents/:name/tasks/:id/pause', requireAuth(), async (req, res) => {
    // Owner-only: agents cannot pause tasks
    const isOwner = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    if (!isOwner) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the owner can pause tasks'));
      return;
    }

    const id = req.params.id as string;

    const task = await storage.getAgentTask(id);
    if (!task) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Task not found'));
      return;
    }

    if (!canAccessTask(req, task)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    if (task.status !== 'active') {
      res.status(409).json(error(config.nodeId, 'INVALID_STATE',
        `Only active tasks can be paused (current: ${task.status})`));
      return;
    }

    const now = new Date().toISOString();
    const updated = await storage.updateAgentTask(id, {
      status: 'paused',
      lastEventAt: now,
      updatedAt: now,
    });

    await storage.appendTaskEvent({
      id: randomUUID(),
      taskId: id,
      type: 'message',
      message: 'Task paused by owner',
      timestamp: now,
    });

    // Push: webhook + MCP notification (parallel, fire-and-forget)
    if (webhookDispatcher) {
      webhookDispatcher.dispatchWebhookEvent(task.agentGaii, 'task.paused', {
        task_id: task.id,
        title: task.title,
        status: 'paused',
        paused_at: now,
      });
    }
    try { emitResourceUpdated(task.agentGaii, `aimeat://agents/${req.params.name as string}/tasks`); } catch (err) { logger.warn('POST /v1/agents/:name/tasks/:id/pause: MCP not connected', { error: String(err) }); }

    res.json(success(config.nodeId, { task: updated }));
    emitChange('agent-tasks', resolve(req));
  });
}
