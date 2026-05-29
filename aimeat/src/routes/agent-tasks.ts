/**
 * @file agent-tasks.ts
 * @description REST endpoints for agent task CRUD, lifecycle, and event log.
 *   Supports creating tasks for agents, transitioning status (draft->queued->active->done|failed),
 *   appending event logs, and listing task events.
 * @structure
 *   - POST   /v1/agents/:name/tasks           -- Create task
 *   - GET    /v1/agents/:name/tasks           -- List tasks
 *   - GET    /v1/agents/:name/tasks/:id       -- Get task detail
 *   - PATCH  /v1/agents/:name/tasks/:id       -- Update task
 *   - DELETE /v1/agents/:name/tasks/:id       -- Delete task (draft/queued only)
 *   - POST   /v1/agents/:name/tasks/:id/start -- Start task (queued->active)
 *   - POST   /v1/agents/:name/tasks/:id/event -- Append event
 *   - POST   /v1/agents/:name/tasks/:id/complete -- Complete task (active->done)
 *   - POST   /v1/agents/:name/tasks/:id/fail  -- Fail task (active->failed)
 *   - PATCH  /v1/agents/:name/tasks/:id/todos/:todoId -- Update individual todo status
 *   - GET    /v1/agents/:name/tasks/:id/events -- List events
 * @version-history
 *   v1.3.0 -- 2026-05-23 -- Add webhook dispatch for task.queued, task.approved, task.updated events
 *   v1.2.0 -- 2026-05-22 -- Add individual todo update endpoint (PATCH /todos/:todoId)
 *   v1.1.0 -- 2026-05-22 -- Fix: accumulate telemetry across events instead of overwriting; allow agent PATCH on queued tasks
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentTaskRecord, AgentTaskTodo, AgentTaskScope } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole, requireScope, agentNotFoundResponse } from '../auth/middleware.js';
import { resolveIdentity, buildGAII } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import { emitResourceUpdated } from '../mcp/index.js';
import { recordTaskStarted, recordTaskCompleted, recordTaskFailed } from '../services/activity-recorder.js';
import { AgentTaskCreateSchema, AgentTaskUpdateSchema, AgentTaskEventSchema, AgentTaskTodoUpdateSchema } from '../models/agent-task-schemas.js';
import { requireReadiness } from '../middleware/readiness-gate.js';
import type { createWebhookDispatcher } from '../services/webhook-dispatcher.js';

type WebhookDispatcher = ReturnType<typeof createWebhookDispatcher>;

export function agentTasksRouter(config: AimeatConfig, storage: Storage, webhookDispatcher?: WebhookDispatcher): Router {
  const router = Router();

  /** Resolve effective identity -- owner sessions use GHII, agents use GAII */
  const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

  /** Build GAII for the named agent under the authenticated owner */
  function resolveAgentGaii(req: Express.Request, agentName: string): string {
    const owner = req.auth!.owner as string;
    return buildGAII(agentName, owner, config.nodeId);
  }

  /** Check if current session can access a task (owner or the task's agent) */
  function canAccessTask(req: Express.Request, task: AgentTaskRecord): boolean {
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    if (isOwnerSession) {
      const ownerGhii = `${req.auth!.owner}@${config.nodeId}`;
      return task.ownerGaii === ownerGhii;
    }
    // Agent session -- must match agent GAII
    return task.agentGaii === req.auth!.sub;
  }

  /* ── POST /v1/agents/:name/tasks -- Create a task for an agent ──
   *
   * Authorization (since 1.14.0):
   *   - Owner JWT  -> always allowed (any of the owner's agents can be targeted)
   *   - Agent JWT  -> allowed if the calling agent and the target agent share
   *                   the same owner. Lets one agent (e.g. Claude Desktop, an
   *                   orchestrator agent) queue work for a same-owner crew
   *                   agent (e.g. demo-crew) without going through the browser
   *                   or generating an owner token. The owner remains in
   *                   charge: any caller still must be one of the owner's
   *                   registered agents.
   *   - Anything else -> 403.
   *
   * The created task's ownerGaii is always the OWNER's GHII, never the
   * calling agent's GAII. So the task appears in the owner's profile
   * dashboard exactly as if the owner had queued it themselves.
   */
  router.post('/v1/agents/:name/tasks', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    const agentGaii = resolveAgentGaii(req, agentName);

    // Verify agent exists. Use agentNotFoundResponse so that an agent whose
    // local token outlived its server record gets a clear AGENT_NOT_REGISTERED
    // hint instead of generic NOT_FOUND -- without that hint the connector
    // looks healthy (token validates) while every action 404s.
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      const notFound = agentNotFoundResponse(req, agentName, agentGaii, { nodeId: config.nodeId, baseUrl: config.baseUrl });
      res.status(notFound.status).json(error(config.nodeId, notFound.code, notFound.message));
      return;
    }

    // Authorize: owner JWT OR same-owner agent JWT.
    const callerRoles = req.auth!.roles as string[];
    const isOwner = callerRoles.includes('owner') && !callerRoles.includes('agent');
    const isAgent = callerRoles.includes('agent');
    if (!isOwner && !isAgent) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only owners or agents may create tasks'));
      return;
    }
    if (isAgent && agent.owner !== req.auth!.owner) {
      res.status(403).json(error(
        config.nodeId, 'FORBIDDEN',
        `Agent '${req.auth!.sub}' cannot create tasks for '${agentName}' -- different owner`,
      ));
      return;
    }

    // ownerGaii is always the OWNER's GHII (not the calling agent's GAII),
    // so the task surfaces in the owner's dashboard the same way regardless
    // of who actually queued it.
    const ownerGaii = `${agent.owner}@${config.nodeId}`;

    // Validate body
    const parsed = AgentTaskCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }

    const body = parsed.data;
    const now = new Date().toISOString();
    const id = randomUUID();

    // Convert snake_case body to camelCase for storage
    const todos: AgentTaskTodo[] = body.todos.map(t => ({
      id: t.id,
      order: t.order,
      title: t.title,
      description: t.description,
      environment: t.environment,
      environmentReason: t.environment_reason,
      verification: t.verification,
      estimateMinutes: t.estimate_minutes,
      status: t.status,
    }));

    // Auto-active for task-runner mode (since 1.14.4): if the target agent's
    // mode is 'task-runner', tasks created in 'queued' status are flipped to
    // 'active' immediately so the agent's autonomous daemon can pick them up
    // without manual owner approval. 'task-runner' is the explicit signal that
    // the owner has pre-authorized this agent to start work without per-task
    // gating; interactive/autonomous/coordinator modes still go through the
    // standard queued -> (owner /start) -> active gate.
    const autoActivated = body.status === 'queued' && agent.mode === 'task-runner';
    const effectiveStatus: AgentTaskRecord['status'] = autoActivated ? 'active' : body.status;

    const record: AgentTaskRecord = {
      id,
      agentGaii,
      ownerGaii,
      title: body.title.trim(),
      description: body.description.trim(),
      scope: body.scope,
      rules: body.rules,
      verification: {
        userExpects: body.verification.user_expects,
        technicalChecks: body.verification.technical_checks,
      },
      resources: body.resources ? {
        knowledgePackages: body.resources.knowledge_packages,
        memoryKeys: body.resources.memory_keys,
        memoryPrefixes: body.resources.memory_prefixes,
      } : undefined,
      todos,
      status: effectiveStatus,
      parentTaskId: body.parent_task_id,
      createdAt: now,
      updatedAt: now,
      lastEventAt: autoActivated ? now : undefined,
    };

    const created = await storage.createAgentTask(record);

    // Append the matching 'started' event so the task history shows the same
    // transition that POST /start would have appended. Keeps auto-activated
    // tasks indistinguishable from owner-approved tasks in event reports.
    if (autoActivated) {
      await storage.appendTaskEvent({
        id: randomUUID(),
        taskId: record.id,
        type: 'started',
        message: 'Task auto-activated (agent mode: task-runner)',
        timestamp: now,
      });
    }

    // Push: webhook + MCP notification (parallel, fire-and-forget). Both
    // 'queued' and auto-activated 'active' creations notify the agent so the
    // daemon polls without waiting for the next interval. Auto-activated tasks
    // share the same webhook event name as owner-approved tasks (task.approved)
    // because subscribers usually want to react to "this task is now runnable"
    // regardless of which gate flipped it.
    if (record.status === 'queued' || autoActivated) {
      const eventName = autoActivated ? 'task.approved' : 'task.queued';
      if (webhookDispatcher) {
        webhookDispatcher.dispatchWebhookEvent(agentGaii, eventName, {
          task_id: record.id,
          title: record.title,
          description: record.description ?? '',
          has_todos: (record.todos?.length ?? 0) > 0,
          todo_count: record.todos?.length ?? 0,
          scope_summary: (record.scope ?? []).slice(0, 5).map((s: AgentTaskScope) => `${s.type || s.name}:${s.value}`),
          created_at: record.createdAt,
          auto_activated: autoActivated,
        });
      }
      try { emitResourceUpdated(agentGaii, `aimeat://agents/${agentName}/tasks`); } catch { /* MCP not connected */ }
    }

    res.status(201).json(success(config.nodeId, { task: created }, [
      { description: 'View task', method: 'GET', url: `/v1/agents/${agentName}/tasks/${id}` },
      { description: 'Start task', method: 'POST', url: `/v1/agents/${agentName}/tasks/${id}/start` },
      { description: 'List events', method: 'GET', url: `/v1/agents/${agentName}/tasks/${id}/events` },
    ]));
    emitChange('agent-tasks');
  });

  /* ── GET /v1/agents/:name/tasks -- List tasks for an agent ── */
  router.get('/v1/agents/:name/tasks', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');

    const status = req.query.status as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page as string || '20', 10)));

    if (isOwnerSession) {
      const ownerGaii = resolve(req);
      const agentGaii = resolveAgentGaii(req, agentName);
      const result = await storage.listAgentTasksByOwner(ownerGaii, {
        status,
        agentGaii,
        page,
        perPage,
      });
      res.json(success(config.nodeId, { tasks: result.tasks, total: result.total, page, per_page: perPage }));
    } else {
      // Agent session -- must be the named agent
      const agentGaii = req.auth!.sub;
      const expectedGaii = resolveAgentGaii(req, agentName);
      if (agentGaii !== expectedGaii) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Agents can only access their own tasks'));
        return;
      }
      const result = await storage.listAgentTasks(agentGaii, { status, page, perPage });
      res.json(success(config.nodeId, { tasks: result.tasks, total: result.total, page, per_page: perPage }));
    }
  });

  /* ── GET /v1/agents/:name/tasks/:id -- Get task detail ── */
  router.get('/v1/agents/:name/tasks/:id', requireAuth(), async (req, res) => {
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

    res.json(success(config.nodeId, { task }));
  });

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
    if (!isOwnerSession && !['queued', 'active'].includes(task.status)) {
      res.status(409).json(error(config.nodeId, 'INVALID_STATE',
        `Agent can only update queued or active tasks (current: ${task.status})`));
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
      updates.resources = {
        knowledgePackages: body.resources.knowledge_packages,
        memoryKeys: body.resources.memory_keys,
        memoryPrefixes: body.resources.memory_prefixes,
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
    emitChange('agent-tasks');
    try { emitResourceUpdated(resolveAgentGaii(req, req.params.name as string), `aimeat://agents/${req.params.name as string}/tasks`); } catch { /* MCP not connected */ }
  });

  /* ── DELETE /v1/agents/:name/tasks/:id -- Delete task (draft/queued only) ── */
  router.delete('/v1/agents/:name/tasks/:id', requireAuth(), requireRole('owner'), async (req, res) => {
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

    const deleted = await storage.deleteAgentTask(id);
    if (!deleted) {
      res.status(409).json(error(config.nodeId, 'INVALID_STATE',
        'Only draft or queued tasks can be deleted'));
      return;
    }

    res.json(success(config.nodeId, { deleted: true }));
    emitChange('agent-tasks');
  });

  /* ── POST /v1/agents/:name/tasks/:id/start -- Start task (queued|paused|stalled -> active) ── */
  router.post('/v1/agents/:name/tasks/:id/start', requireAuth(), async (req, res) => {
    // Owner-only: agents must not self-start tasks (propose-before-start rule)
    const isOwner = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    if (!isOwner) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the owner can start tasks'));
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
    try { emitResourceUpdated(task.agentGaii, `aimeat://agents/${req.params.name as string}/tasks`); } catch { /* MCP not connected */ }

    res.json(success(config.nodeId, { task: updated }));
    emitChange('agent-tasks');
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
    try { emitResourceUpdated(task.agentGaii, `aimeat://agents/${req.params.name as string}/tasks`); } catch { /* MCP not connected */ }

    res.json(success(config.nodeId, { task: updated }));
    emitChange('agent-tasks');
  });

  /* ── POST /v1/agents/:name/tasks/:id/event -- Append event ── */
  router.post('/v1/agents/:name/tasks/:id/event', requireAuth(), requireReadiness('standard', config, storage), async (req, res) => {
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

    // Stalled tasks are reactivated automatically when an event arrives:
    // the stall-detector marks tasks as stalled when no events come in for
    // a while, but if the agent posts an event now, it's evidently back and
    // the task should resume. This avoids needing a separate "restart"
    // endpoint for the common case of an agent that briefly crashed or lost
    // connectivity and then recovered.
    if (task.status === 'stalled') {
      const resumeNow = new Date().toISOString();
      await storage.updateAgentTask(id, { status: 'active', lastEventAt: resumeNow, updatedAt: resumeNow });
      await storage.appendTaskEvent({
        id: randomUUID(),
        taskId: id,
        type: 'started',
        message: 'Task auto-resumed from stalled (agent posted a new event)',
        timestamp: resumeNow,
      });
      task.status = 'active';
    }

    if (task.status !== 'active') {
      res.status(409).json(error(config.nodeId, 'INVALID_STATE',
        `Events can only be appended to active tasks (current: ${task.status})`));
      return;
    }

    const parsed = AgentTaskEventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }

    const body = parsed.data;
    const now = new Date().toISOString();

    const event = await storage.appendTaskEvent({
      id: randomUUID(),
      taskId: id,
      type: body.type,
      message: body.message,
      details: body.details,
      timestamp: now,
    });

    // Update lastEventAt and optionally telemetry
    const taskUpdates: Partial<AgentTaskRecord> = {
      lastEventAt: now,
      updatedAt: now,
    };
    if (body.details?.telemetry) {
      const tel = body.details.telemetry as Record<string, unknown>;
      const prev = task.telemetry;
      taskUpdates.telemetry = {
        aiCalls: (prev?.aiCalls ?? 0) + (typeof tel.ai_calls === 'number' ? tel.ai_calls : 0),
        tokensIn: (prev?.tokensIn ?? 0) + (typeof tel.tokens_in === 'number' ? tel.tokens_in : 0),
        tokensOut: (prev?.tokensOut ?? 0) + (typeof tel.tokens_out === 'number' ? tel.tokens_out : 0),
        durationSeconds: (prev?.durationSeconds ?? 0) + (typeof tel.duration_seconds === 'number' ? tel.duration_seconds : 0),
      };
    }
    await storage.updateAgentTask(id, taskUpdates);

    res.status(201).json(success(config.nodeId, { event }));
    emitChange('agent-tasks');
  });

  /* ── POST /v1/agents/:name/tasks/:id/complete -- Complete task (active -> done) ── */
  router.post('/v1/agents/:name/tasks/:id/complete', requireAuth(), requireReadiness('standard', config, storage), async (req, res) => {
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

    // Allow completing from 'stalled' as well: if the agent comes back with
    // a deliverable after a stall, accept it -- a late deliverable is more
    // useful than rejecting the agent's work because the stall detector flipped
    // the state. Active -> done and stalled -> done are both valid completion
    // paths; failed/done/draft/queued/paused are not (those need explicit
    // owner-driven transitions, e.g. /start, before they can complete).
    if (task.status !== 'active' && task.status !== 'stalled') {
      res.status(409).json(error(config.nodeId, 'INVALID_STATE',
        `Only active or stalled tasks can be completed (current: ${task.status})`));
      return;
    }

    const now = new Date().toISOString();
    const message = typeof req.body?.message === 'string' ? req.body.message : 'Task completed';

    const updated = await storage.updateAgentTask(id, {
      status: 'done',
      completedAt: now,
      lastEventAt: now,
      updatedAt: now,
    });

    await storage.appendTaskEvent({
      id: randomUUID(),
      taskId: id,
      type: 'completed',
      message,
      timestamp: now,
    });

    await recordTaskCompleted(storage, task.agentGaii, task.telemetry);

    res.json(success(config.nodeId, { task: updated }));
    emitChange('agent-tasks');
  });

  /* ── POST /v1/agents/:name/tasks/:id/fail -- Fail task (active -> failed) ── */
  router.post('/v1/agents/:name/tasks/:id/fail', requireAuth(), async (req, res) => {
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

    // Stalled tasks can also be marked failed -- e.g. the agent realises it
    // can't recover and explicitly reports failure rather than letting the
    // task linger in stalled state forever.
    if (task.status !== 'active' && task.status !== 'stalled') {
      res.status(409).json(error(config.nodeId, 'INVALID_STATE',
        `Only active or stalled tasks can be failed (current: ${task.status})`));
      return;
    }

    const now = new Date().toISOString();
    const message = typeof req.body?.message === 'string' ? req.body.message : 'Task failed';

    const updated = await storage.updateAgentTask(id, {
      status: 'failed',
      completedAt: now,
      lastEventAt: now,
      updatedAt: now,
    });

    await storage.appendTaskEvent({
      id: randomUUID(),
      taskId: id,
      type: 'failed',
      message,
      timestamp: now,
    });

    await recordTaskFailed(storage, task.agentGaii);

    res.json(success(config.nodeId, { task: updated }));
    emitChange('agent-tasks');
  });

  /* ── PATCH /v1/agents/:name/tasks/:id/todos/:todoId -- Update individual todo ── */
  router.patch('/v1/agents/:name/tasks/:id/todos/:todoId', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const todoId = req.params.todoId as string;

    const task = await storage.getAgentTask(id);
    if (!task) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Task not found'));
      return;
    }

    if (!canAccessTask(req, task)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    // Stalled tasks accept todo updates too: same auto-resume semantics as
    // events -- if the agent is updating todos, it's clearly back.
    if (task.status === 'stalled') {
      const resumeNow = new Date().toISOString();
      await storage.updateAgentTask(id, { status: 'active', lastEventAt: resumeNow, updatedAt: resumeNow });
      await storage.appendTaskEvent({
        id: randomUUID(),
        taskId: id,
        type: 'started',
        message: 'Task auto-resumed from stalled (agent updated a todo)',
        timestamp: resumeNow,
      });
      task.status = 'active';
    }

    if (task.status !== 'active') {
      res.status(409).json(error(config.nodeId, 'INVALID_STATE',
        `Todo updates are only allowed on active tasks (current: ${task.status})`));
      return;
    }

    const parsed = AgentTaskTodoUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }

    const todos = task.todos || [];
    const todoIndex = todos.findIndex(t => t.id === todoId);
    if (todoIndex === -1) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Todo '${todoId}' not found in task`));
      return;
    }

    const body = parsed.data;
    const now = new Date().toISOString();
    const updatedTodos = [...todos];
    updatedTodos[todoIndex] = {
      ...updatedTodos[todoIndex],
      status: body.status,
      ...(body.completed_at ? { completedAt: body.completed_at } : body.status === 'done' ? { completedAt: now } : {}),
    };

    const updated = await storage.updateAgentTask(id, {
      todos: updatedTodos,
      updatedAt: now,
    });

    if (!updated) {
      res.status(500).json(error(config.nodeId, 'UPDATE_FAILED', 'Failed to update todo'));
      return;
    }

    res.json(success(config.nodeId, { task: updated, todo: updatedTodos[todoIndex] }));
    emitChange('agent-tasks');
  });

  /* ── GET /v1/agents/:name/tasks/:id/events -- List task events ── */
  router.get('/v1/agents/:name/tasks/:id/events', requireAuth(), async (req, res) => {
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

    const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page as string || '20', 10)));

    const result = await storage.listTaskEvents(id, { page, perPage });

    res.json(success(config.nodeId, {
      events: result.events,
      total: result.total,
      page,
      per_page: perPage,
    }));
  });

  return router;
}
