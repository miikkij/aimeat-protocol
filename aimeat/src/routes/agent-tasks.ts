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
 *   - DELETE /v1/agents/:name/tasks/:id       -- Delete task (any non-active) + clean operational traces
 *   - POST   /v1/agents/:name/tasks/:id/start -- Start task (queued->active)
 *   - POST   /v1/agents/:name/tasks/:id/event -- Append event
 *   - POST   /v1/agents/:name/tasks/:id/complete -- Complete task (active->done)
 *   - POST   /v1/agents/:name/tasks/:id/fail  -- Fail task (active->failed)
 *   - POST   /v1/agents/:name/tasks/:id/rate  -- Review a done task's deliverable (Quality tab)
 *   - PATCH  /v1/agents/:name/tasks/:id/triage -- Move a task between Tasks-tab buckets (Recent/Keep/Archive)
 *   - PATCH  /v1/agents/:name/tasks/:id/todos/:todoId -- Update individual todo status
 *   - GET    /v1/agents/:name/tasks/:id/events -- List events
 * @version-history
 *   v1.6.0 -- 2026-06-05 -- DELETE now removes any non-active task (not just
 *     draft/queued) -- active tasks must be cancelled/paused first -- and cleans
 *     the task's operational memory traces (live-status keys + cancel marker)
 *     so a leftover can't disturb the runner; the deliverable is preserved.
 *   v1.5.0 -- 2026-06-01 -- Tasks-tab triage: PATCH /tasks/:id/triage (Keep/Archive/Restore) + GET /tasks gains bucket/q/updated_before/after params and per-bucket counts
 *   v1.4.1 -- 2026-05-31 -- /rate: add optional free-form `metadata` (temperature/tokens/cost) stored on the rating for later slicing (size-capped)
 *   v1.4.0 -- 2026-05-31 -- Add POST /tasks/:id/rate (Quality tab): per-context star rating with source-grounding hard gate; refreshes the public statistics cache
 *   v1.3.0 -- 2026-05-23 -- Add webhook dispatch for task.queued, task.approved, task.updated events
 *   v1.2.0 -- 2026-05-22 -- Add individual todo update endpoint (PATCH /todos/:todoId)
 *   v1.1.0 -- 2026-05-22 -- Fix: accumulate telemetry across events instead of overwriting; allow agent PATCH on queued tasks
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentTaskRecord, AgentTaskTodo, AgentTaskScope, AgentTaskRating, RaterType } from '../storage/interface.js';
import { RATING_CONTEXTS_REQUIRING_GROUNDING } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole, requireScope, agentNotFoundResponse } from '../auth/middleware.js';
import { resolveIdentity, buildGAII } from '../utils/gaii.js';
import { emitChange, emitDelivery } from '../services/event-bus.js';
import { getActiveWorkflowEngine } from '../services/workflow/engine.js';
import { logger } from '../utils/logger.js';
import { emitResourceUpdated } from '../mcp/index.js';
import { recordTaskStarted, recordTaskCompleted, recordTaskFailed } from '../services/activity-recorder.js';
import { recomputeAndCacheStatistics } from '../services/agent-statistics.js';
import { AgentTaskCreateSchema, AgentTaskUpdateSchema, AgentTaskEventSchema, AgentTaskTodoUpdateSchema, AgentTaskRequestChangesSchema, AgentTaskRateSchema, AgentTaskTriageSchema } from '../models/agent-task-schemas.js';
import type { AgentMessageRecord } from '../storage/interface.js';
import { requireReadiness } from '../middleware/readiness-gate.js';
import type { createWebhookDispatcher } from '../services/webhook-dispatcher.js';

type WebhookDispatcher = ReturnType<typeof createWebhookDispatcher>;

const TASK_TERMINAL_STATUSES = new Set(['done', 'failed']);
type TaskBucket = 'recent' | 'keep' | 'archive';

/**
 * Which Tasks-tab bucket a task falls in. See
 * docs/plans/agent-tasks-triage-plan.md §2:
 *   kept -> Keep · archived -> Archive · non-terminal -> Recent ·
 *   terminal+old+autoArchive -> Archive · otherwise -> Recent.
 */
function deriveTaskBucket(
  task: AgentTaskRecord, nowMs: number, autoArchive: boolean, windowHours: number,
): TaskBucket {
  if (task.triage === 'kept') return 'keep';
  if (task.triage === 'archived') return 'archive';
  if (!TASK_TERMINAL_STATUSES.has(task.status)) return 'recent';
  if (!autoArchive) return 'recent';
  const ageHours = (nowMs - new Date(task.updatedAt).getTime()) / 3_600_000;
  return ageHours > windowHours ? 'archive' : 'recent';
}

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
      // Connector forward tunnel: realtime reverse delivery. If the agent holds
      // an open tunnel, the ConnectTunnelManager pushes the full task down the
      // socket immediately (zero round-trip); if offline, the task stays in the
      // store and is replayed via backlog-on-connect. No-op when no tunnel.
      emitDelivery({ target: agentGaii, kind: 'task_assigned', id: record.id, payload: created });
    }

    res.status(201).json(success(config.nodeId, { task: created }, [
      { description: 'View task', method: 'GET', url: `/v1/agents/${agentName}/tasks/${id}` },
      { description: 'Start task', method: 'POST', url: `/v1/agents/${agentName}/tasks/${id}/start` },
      { description: 'List events', method: 'GET', url: `/v1/agents/${agentName}/tasks/${id}/events` },
    ]));
    emitChange('agent-tasks');
  });

  /* ── GET /v1/agents/:name/tasks -- List tasks for an agent ──
   *
   * Query params:
   *   status                 -- filter by task status (sub-filter within a bucket)
   *   bucket                 -- recent | keep | archive (Tasks-tab triage bucket)
   *   q                      -- case-insensitive substring over title + description
   *   updated_after/_before  -- ISO timestamps (the time filter)
   *   page / per_page        -- paginate the filtered result
   *
   * Returns { tasks, total, counts: { recent, keep, archive }, page, per_page }.
   * Bucket/search/time are applied in the handler; per-agent task counts are
   * bounded so fetching the agent's tasks and filtering here stays cheap. Callers
   * that pass no bucket get every task (backward-compatible). `counts` are the
   * bucket totals (NOT narrowed by status/q) for the tab badges.
   */
  router.get('/v1/agents/:name/tasks', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');

    const status = req.query.status as string | undefined;
    const bucket = req.query.bucket as string | undefined;
    const q = (req.query.q as string | undefined)?.trim().toLowerCase();
    const updatedAfter = req.query.updated_after as string | undefined;
    const updatedBefore = req.query.updated_before as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page as string || '20', 10)));

    // Authorize + resolve the target agent.
    const agentGaii = isOwnerSession ? resolveAgentGaii(req, agentName) : req.auth!.sub;
    if (!isOwnerSession && agentGaii !== resolveAgentGaii(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Agents can only access their own tasks'));
      return;
    }

    // Fetch all of the agent's tasks (no status filter -- we need every task for
    // the bucket counts), paging through the storage layer.
    const all: AgentTaskRecord[] = [];
    for (let p = 1; ; p++) {
      const r = isOwnerSession
        ? await storage.listAgentTasksByOwner(resolve(req), { agentGaii, page: p, perPage: 200 })
        : await storage.listAgentTasks(agentGaii, { page: p, perPage: 200 });
      all.push(...r.tasks);
      if (all.length >= r.total || r.tasks.length === 0) break;
    }

    const now = Date.now();
    const autoArchive = config.taskAutoArchive;
    const windowHours = config.taskArchiveAfterHours;
    const counts = { recent: 0, keep: 0, archive: 0 };
    for (const t of all) counts[deriveTaskBucket(t, now, autoArchive, windowHours)]++;

    let filtered = all;
    if (bucket === 'recent' || bucket === 'keep' || bucket === 'archive') {
      filtered = filtered.filter(t => deriveTaskBucket(t, now, autoArchive, windowHours) === bucket);
    }
    if (status) filtered = filtered.filter(t => t.status === status);
    if (q) filtered = filtered.filter(t =>
      (t.title || '').toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q));
    if (updatedAfter) filtered = filtered.filter(t => t.updatedAt >= updatedAfter);
    if (updatedBefore) filtered = filtered.filter(t => t.updatedAt <= updatedBefore);

    filtered.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));

    const total = filtered.length;
    const startIdx = (page - 1) * perPage;
    const paged = filtered.slice(startIdx, startIdx + perPage);

    res.json(success(config.nodeId, { tasks: paged, total, counts, page, per_page: perPage }));
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
    } catch { /* best-effort trace cleanup */ }
    try {
      await storage.deleteMemory(task.ownerGaii, `agents.cancel.task.${id}`);
    } catch { /* best-effort trace cleanup */ }

    res.json(success(config.nodeId, { deleted: true }));
    emitChange('agent-tasks');
    try { emitResourceUpdated(task.agentGaii, `aimeat://agents/${agentName}/tasks`); } catch { /* MCP not connected */ }
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

  /* ── POST /v1/agents/:name/tasks/:id/propose-todos -- Agent proposes (or re-proposes) a TODO plan ──
   *
   * The merge-aware companion to PATCH /tasks/:id. Use this endpoint instead
   * of raw PATCH when the agent wants to propose todos -- the server handles
   * the queued/revision_requested state machine and preserves the outdated
   * history correctly.
   *
   *  queued (no todos)        -> set todos = body.todos (status pending), no state change
   *  queued (has pending)     -> replace pending todos with new ones (outdated preserved)
   *  revision_requested        -> mark all current non-outdated todos as 'outdated',
   *                              APPEND new todos with status 'pending', flip task
   *                              status back to 'queued' so the owner can /start
   *                              (or /request-changes again).
   *  active                    -> 409 (mid-execution re-proposal goes through PATCH)
   *  anything else             -> 409
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
    if (task.status !== 'queued' && task.status !== 'revision_requested') {
      res.status(409).json(error(config.nodeId, 'INVALID_STATE',
        `TODOs can only be proposed on queued or revision_requested tasks (current: ${task.status})`));
      return;
    }

    const proposeBody = req.body as { todos?: Array<{
      id?: string; order?: number; title: string; description?: string;
      environment?: 'aimeat' | 'agent'; environment_reason?: string;
      verification?: string; estimate_minutes?: number;
    }>; };
    const incoming = Array.isArray(proposeBody?.todos) ? proposeBody.todos : [];
    if (incoming.length === 0) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'todos must be a non-empty array'));
      return;
    }

    const now = new Date().toISOString();

    // Preserve outdated todos from previous revision cycles. When the task is
    // revision_requested, also retire the still-pending todos to outdated so
    // the next owner view shows them as history rather than as the active plan.
    const preserved: AgentTaskTodo[] = (task.todos ?? []).flatMap(t => {
      if (t.status === 'outdated') return [t];
      if (task.status === 'revision_requested') return [{ ...t, status: 'outdated' as const }];
      return [];
    });

    // Number new todos AFTER the preserved ones so order is stable across history.
    const baseOrder = preserved.length;
    const newTodos: AgentTaskTodo[] = incoming.map((t, index) => ({
      id: t.id ?? `todo-${baseOrder + index + 1}`,
      order: t.order ?? baseOrder + index + 1,
      title: t.title,
      description: t.description ?? '',
      environment: t.environment ?? 'agent',
      environmentReason: t.environment_reason,
      verification: t.verification ?? '',
      estimateMinutes: t.estimate_minutes,
      status: 'pending',
    }));

    const updated = await storage.updateAgentTask(id, {
      todos: [...preserved, ...newTodos],
      // Revision cycle: agent's new proposal moves the task back to 'queued' so
      // the owner can review again. Plain queued stays queued.
      status: task.status === 'revision_requested' ? 'queued' : task.status,
      lastEventAt: now,
      updatedAt: now,
    });

    await storage.appendTaskEvent({
      id: randomUUID(),
      taskId: id,
      type: 'progress',
      message: task.status === 'revision_requested'
        ? 'Revised TODO plan proposed'
        : 'TODO plan proposed',
      details: {
        todo_count: newTodos.length,
        outdated_count: preserved.length,
      },
      timestamp: now,
    });

    if (webhookDispatcher) {
      webhookDispatcher.dispatchWebhookEvent(task.agentGaii, 'task.updated', {
        task_id: task.id,
        title: task.title,
        status: updated?.status ?? task.status,
        changed_fields: ['todos', 'status'],
        todo_count: (updated?.todos ?? []).length,
        pending_todo_count: (updated?.todos ?? []).filter((t: AgentTaskTodo) => t.status === 'pending').length,
        updated_at: now,
      });
    }
    try { emitResourceUpdated(task.agentGaii, `aimeat://agents/${req.params.name as string}/tasks`); } catch { /* MCP not connected */ }

    res.json(success(config.nodeId, { task: updated }));
    emitChange('agent-tasks');
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
    try { emitResourceUpdated(task.agentGaii, `aimeat://agents/${agentName}/tasks`); } catch { /* MCP not connected */ }
    try { emitResourceUpdated(task.agentGaii, `aimeat://agents/${agentName}/messages`); } catch { /* MCP not connected */ }

    res.json(success(config.nodeId, { task: updated, message: messageRecord }));
    emitChange('agent-tasks');
    emitChange('agent-messages');
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
    // Optional: the memory key (under the agent's namespace) where the agent
    // published the deliverable. Lets the owner UI link straight to the output.
    const rawDeliverable = req.body?.deliverable_key;
    const deliverableKey = (typeof rawDeliverable === 'string' && rawDeliverable.trim())
      ? rawDeliverable.trim().slice(0, 256)
      : undefined;

    const updated = await storage.updateAgentTask(id, {
      status: 'done',
      completedAt: now,
      lastEventAt: now,
      updatedAt: now,
      ...(deliverableKey ? { deliverableKey } : {}),
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
    // If this task was dispatched by a workflow, advance that run (output check → next step).
    getActiveWorkflowEngine()?.onTaskTerminal(task, 'done')
      .catch(e => logger.error('workflow advance on task done failed', { taskId: id, error: String(e) }));
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
    getActiveWorkflowEngine()?.onTaskTerminal(task, 'failed')
      .catch(e => logger.error('workflow advance on task fail failed', { taskId: id, error: String(e) }));
  });

  /* ── POST /v1/agents/:name/tasks/:id/rate -- Review a completed task's deliverable ──
   *
   * The Quality tab's core write. Attaches a per-context star rating (1–5) to a
   * DONE task. Authorization: the task's owner (human) OR a SAME-OWNER agent
   * (e.g. the parent orchestrator that delegated the work). An agent may not
   * rate its OWN deliverable (no self-rating).
   *
   * Source-grounding hard gate: for the factual family
   * (factual/research/code/summarization) an AGENT rater must set
   * source_grounded=true — otherwise the stars measure showiness, not
   * faithfulness (POC-proven). Human owners are exempt; `creative` accepts an
   * output-alone craft rating.
   */
  router.post('/v1/agents/:name/tasks/:id/rate', requireAuth(), async (req, res) => {
    const id = req.params.id as string;

    const task = await storage.getAgentTask(id);
    if (!task) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Task not found'));
      return;
    }

    // Authorize: caller must share the task's owner.
    const callerRoles = req.auth!.roles as string[];
    const isOwnerSession = callerRoles.includes('owner') && !callerRoles.includes('agent');
    const ownerGhii = `${req.auth!.owner}@${config.nodeId}`;
    if (task.ownerGaii !== ownerGhii) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }
    // No self-rating: an agent cannot rate the deliverable it produced.
    if (!isOwnerSession && req.auth!.sub === task.agentGaii) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN',
        'An agent cannot rate its own deliverable'));
      return;
    }

    if (task.status !== 'done') {
      res.status(409).json(error(config.nodeId, 'INVALID_STATE',
        `Only completed (done) tasks can be rated (current: ${task.status})`));
      return;
    }

    const parsed = AgentTaskRateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    const { stars, context, comment, source_grounded, unsupported, evaluated_model, metadata } = parsed.data;

    // Cap the free-form metadata so it can't be used to bloat the rating blob.
    if (metadata && JSON.stringify(metadata).length > 4096) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'metadata too large (max 4096 bytes serialized)'));
      return;
    }

    // Source-grounding hard gate (factual family + agent rater must be grounded).
    if (RATING_CONTEXTS_REQUIRING_GROUNDING.has(context) && !isOwnerSession && !source_grounded) {
      res.status(422).json(error(config.nodeId, 'GROUNDING_REQUIRED',
        `Ratings in context '${context}' must be source-grounded (checked against inputs/sources). ` +
        `Set source_grounded=true, or have a human owner rate it.`));
      return;
    }

    const raterType: RaterType = isOwnerSession
      ? 'human-owner'
      : (source_grounded ? 'source-grounded-agent' : 'agent');

    const now = new Date().toISOString();
    const rating: AgentTaskRating = {
      stars,
      context,
      ...(comment ? { comment } : {}),
      ratedBy: resolve(req),
      raterType,
      sourceGrounded: source_grounded,
      ...(typeof unsupported === 'number' ? { unsupported } : {}),
      ...(evaluated_model ? { evaluatedModel: evaluated_model } : {}),
      ...(metadata ? { metadata } : {}),
      ratedAt: now,
    };

    const updated = await storage.updateAgentTask(id, { rating, updatedAt: now });

    await storage.appendTaskEvent({
      id: randomUUID(),
      taskId: id,
      type: 'rating',
      message: `Rated ${stars}★ (${context})`,
      details: { stars, context, raterType, sourceGrounded: source_grounded },
      timestamp: now,
    });

    // Refresh the public statistics cache. Best-effort: a failure here must not
    // fail the rating write — the rollup is recomputable on demand anyway.
    recomputeAndCacheStatistics(storage, task.agentGaii, config.nodeId).catch(() => {});

    res.json(success(config.nodeId, { task: updated }));
    emitChange('agent-tasks');
  });

  /* ── PATCH /v1/agents/:name/tasks/:id/triage -- Move a task between Tasks-tab buckets ──
   *
   * Owner-only. body { triage: 'kept' | 'archived' | null }. 'kept' -> Keep tab
   * (never auto-archived), 'archived' -> Archive tab, null -> back to default
   * (Recent / auto-archive). Bumps updatedAt so a restored (null) task gets a
   * fresh Recent window instead of immediately re-archiving by age.
   */
  router.patch('/v1/agents/:name/tasks/:id/triage', requireAuth(), requireRole('owner'), async (req, res) => {
    const id = req.params.id as string;

    const task = await storage.getAgentTask(id);
    if (!task) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Task not found'));
      return;
    }
    const ownerGhii = `${req.auth!.owner}@${config.nodeId}`;
    if (task.ownerGaii !== ownerGhii) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const parsed = AgentTaskTriageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    const { triage } = parsed.data;
    const now = new Date().toISOString();

    const updated = await storage.updateAgentTask(id, { triage: triage ?? undefined, updatedAt: now });
    await storage.appendTaskEvent({
      id: randomUUID(),
      taskId: id,
      type: 'message',
      message: `Triage: ${triage ?? 'recent'}`,
      details: { triage },
      timestamp: now,
    });

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

  /* ── GET /v1/deliverables — the Offers "Inbox": everything that came back, across ALL agents ──
   * Owner aggregate of non-draft tasks (queued/active/done/failed/…), newest first, with provenance
   * (agent, status, timestamps), the deliverable key, the verification expectation, and any existing
   * rating. The follow-up half of the Offers surface — check + rate without clicking through agents.
   * Failures are included AS failures (status='failed'); rate the deliverable via the locked
   * POST /v1/agents/:name/tasks/:id/rate. */
  router.get('/v1/deliverables', requireAuth(), requireRole('owner'), async (req, res) => {
    const owner = resolve(req);
    const all: AgentTaskRecord[] = [];
    for (let p = 1; p <= 10; p++) {
      const r = await storage.listAgentTasksByOwner(owner, { page: p, perPage: 200 });
      all.push(...r.tasks);
      if (r.tasks.length < 200) break;
    }
    const deliverables = all
      .filter(t => t.status !== 'draft')
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, 100)
      .map(t => ({
        task_id: t.id,
        agent: t.agentGaii.split('#')[0],
        agent_gaii: t.agentGaii,   // full GAII so the Inbox can read the agent's memory namespace
        title: t.title,
        status: t.status,
        completed_at: t.completedAt ?? null,
        updated_at: t.updatedAt,
        deliverable_key: t.deliverableKey ?? null,
        verification: t.verification?.userExpects ?? null,
        rating: t.rating ?? null,
      }));
    res.json(success(config.nodeId, { deliverables, total: deliverables.length }));
  });

  return router;
}
