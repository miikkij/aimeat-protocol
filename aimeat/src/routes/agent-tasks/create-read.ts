/**
 * @file src/routes/agent-tasks/create-read.ts
 * @description Agent-task create + read routes (POST create, GET list, GET detail). Extracted from agent-tasks.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from agent-tasks.ts (max-file-lines)
 *   v1.1.0 — 2026-07-26 — resources.files: a task can be created WITH file attachments (checked against
 *     the creator's own read access, mime/size taken from the stored file), and the detail read returns
 *     each one as a presigned handle authorized for the reader. Before this, handing an agent a PDF
 *     meant sending a DM — the task, which is what file-shaped work actually is, could not carry it.
 */

import type { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentTaskRecord, AgentTaskTodo, AgentTaskScope } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, agentNotFoundResponse } from '../../auth/middleware.js';
import { emitChange, emitDelivery } from '../../services/event-bus.js';
import { getActiveWorkflowEngine } from '../../services/workflow/engine.js';
import { logger } from '../../utils/logger.js';
import { emitResourceUpdated } from '../../mcp/index.js';
import { AgentTaskCreateSchema } from '../../models/agent-task-schemas.js';
import { resolveTaskFileInputs, taskWithFileHandles } from '../../services/task-files.js';
import type { TaskRouteHelpers } from './helpers.js';

export function registerTaskCreateReadRoutes(
  router: Router, config: AimeatConfig, storage: Storage, helpers: TaskRouteHelpers,
): void {
  const { resolve, resolveAgentGaii, tokenHasScope, canReadTask, deriveTaskBucket, webhookDispatcher } = helpers;

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

    // Authorize: owner JWT, same-owner agent JWT, OR a same-owner app grant holding task:write.
    const callerRoles = req.auth!.roles as string[];
    const isOwner = callerRoles.includes('owner') && !callerRoles.includes('agent');
    const isAgent = callerRoles.includes('agent');
    const isApp = callerRoles.includes('app');
    if (!isOwner && !isAgent && !isApp) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only owners, agents, or granted apps may create tasks'));
      return;
    }
    if (isAgent && agent.owner !== req.auth!.owner) {
      res.status(403).json(error(
        config.nodeId, 'FORBIDDEN',
        `Agent '${req.auth!.sub}' cannot create tasks for '${agentName}' -- different owner`,
      ));
      return;
    }
    // H-2 app grant: needs task:write AND may only target its own owner's agents (never cross-owner).
    if (isApp) {
      if (!tokenHasScope(req, 'task:write')) {
        res.status(403).json(error(config.nodeId, 'SCOPE_DENIED', 'Scope "task:write" required to create tasks'));
        return;
      }
      if (agent.owner !== req.auth!.owner) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN',
          `App can only create tasks for its own owner's agents (agent '${agentName}' belongs to a different owner)`));
        return;
      }
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

    // Attachments are validated against the CREATOR's own read access — a task must not be a way to
    // slip a reference to data the creator cannot see into somebody's work queue.
    const fileResult = await resolveTaskFileInputs(storage, config, body.resources?.files, {
      gaii: resolve(req), sub: req.auth!.sub, owner: req.auth!.owner as string | undefined,
    });
    if ('error' in fileResult) {
      res.status(fileResult.error.status).json(error(config.nodeId, fileResult.error.code, fileResult.error.message));
      return;
    }

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
        ...(fileResult.files.length ? { files: fileResult.files } : {}),
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
    emitChange('agent-tasks', resolve(req));
    // Event-triggered workflows: a USER ordering an offer (the offers Ask flow tags the task with an
    // `offer_id` scope) may start a workflow. The workflow engine's OWN dispatched tasks go through
    // storage.createAgentTask directly (NOT this route) and use a different scope, so they don't fire
    // this — only genuine user/agent orders do.
    const orderedOfferId = record.scope?.find((s: AgentTaskScope) => s.name === 'offer_id')?.value;
    if (orderedOfferId) {
      getActiveWorkflowEngine()?.onOfferOrdered(record.ownerGaii, orderedOfferId)
        .catch(e => logger.error('workflow event trigger (offer.ordered) failed', { offerId: orderedOfferId, error: String(e) }));
    }
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
    // An H-2 app grant with task:read reads its OWN owner's tasks, so it takes the owner-scoped
    // path (listAgentTasksByOwner filters by the app's owner GHII — never another owner's tasks).
    const isAppReading = req.auth!.roles.includes('app') && tokenHasScope(req, 'task:read');
    const actAsOwner = isOwnerSession || isAppReading;

    const status = req.query.status as string | undefined;
    const bucket = req.query.bucket as string | undefined;
    const q = (req.query.q as string | undefined)?.trim().toLowerCase();
    const updatedAfter = req.query.updated_after as string | undefined;
    const updatedBefore = req.query.updated_before as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page as string || '20', 10)));

    // An app principal without task:read cannot list tasks (owner bypass never applies to it).
    if (req.auth!.roles.includes('app') && !isAppReading) {
      res.status(403).json(error(config.nodeId, 'SCOPE_DENIED', 'Scope "task:read" required to list tasks'));
      return;
    }

    // Authorize + resolve the target agent.
    const agentGaii = actAsOwner ? resolveAgentGaii(req, agentName) : req.auth!.sub;
    if (!actAsOwner && agentGaii !== resolveAgentGaii(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Agents can only access their own tasks'));
      return;
    }

    // Fast path (the hot path): a STATUS-filtered poll that needs no bucket counts — e.g. a crew
    // daemon listing queued/active/stalled every cycle. Query storage filtered + paged instead of
    // loading the agent's ENTIRE task history just to derive the UI counts. Counts/buckets are a
    // dashboard concern; a plain status poll (no bucket/q/date filter) skips them. Turns the per-call
    // cost from O(all the agent's tasks) into O(one page) — the load 40 polling agents were paying
    // every cycle.
    if (status && !bucket && !q && !updatedAfter && !updatedBefore) {
      const r = actAsOwner
        ? await storage.listAgentTasksByOwner(resolve(req), { agentGaii, status, page, perPage })
        : await storage.listAgentTasks(agentGaii, { status, page, perPage });
      res.json(success(config.nodeId, { tasks: r.tasks, total: r.total, counts: { recent: 0, keep: 0, archive: 0 }, page, per_page: perPage }));
      return;
    }

    // Fetch all of the agent's tasks (no status filter -- we need every task for
    // the bucket counts), paging through the storage layer.
    const all: AgentTaskRecord[] = [];
    for (let p = 1; ; p++) {
      const r = actAsOwner
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

    if (!canReadTask(req, task)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    // Attachments come back as presigned handles, authorized for THIS reader on THIS read.
    const withFiles = await taskWithFileHandles(storage, config, task, {
      gaii: resolve(req), sub: req.auth!.sub, owner: req.auth!.owner as string | undefined,
    });
    res.json(success(config.nodeId, { task: withFiles }));
  });
}
