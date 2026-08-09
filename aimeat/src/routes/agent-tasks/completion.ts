/**
 * @file src/routes/agent-tasks/completion.ts
 * @description Agent-task completion + review routes (event, complete, fail, rate, triage, todos, events, deliverables). Extracted from agent-tasks.ts to satisfy max-file-lines.
 * @version-history
 *   v1.1.0 — 2026-08-09 — /complete reclaims the runner's live-progress record (reclaimTaskLiveTrace).
 *     991 such keys had accumulated on aimeat.io, one per finished task, none ever removed. /fail
 *     deliberately keeps its record: on a failure that is the diagnosis.
 *   Task metadata limit 4 096 → 200 000 bytes — 2026-07-30 — metadata is JSON and 4 KB truncated real payloads.
 *   v1.0.0 — 2026-07-13 — Extracted from agent-tasks.ts (max-file-lines)
 */

import type { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentTaskRecord, AgentTaskRating, RaterType } from '../../storage/interface.js';
import { RATING_CONTEXTS_REQUIRING_GROUNDING } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { emitChange } from '../../services/event-bus.js';
import { recordPublicActivity } from '../../services/public-activity.js';
import { getActiveWorkflowEngine } from '../../services/workflow/engine.js';
import { logger } from '../../utils/logger.js';
import { recordTaskCompleted, recordTaskFailed } from '../../services/activity-recorder.js';
import { recomputeAndCacheStatistics } from '../../services/agent-statistics.js';
import { AgentTaskEventSchema, AgentTaskTodoUpdateSchema, AgentTaskRateSchema, AgentTaskTriageSchema } from '../../models/agent-task-schemas.js';
import { requireReadiness } from '../../middleware/readiness-gate.js';
import { notifyAutomationTaskComplete } from '../../services/ecosystem-automation-notify.js';
import { processAutomationAdvisories } from '../../services/ecosystem-automation-advisories.js';
import type { TaskRouteHelpers } from './helpers.js';
import { reclaimTaskLiveTrace } from './helpers.js';
import { closeItemsForTask } from '../../services/open-items.js';

export function registerTaskCompletionRoutes(
  router: Router, config: AimeatConfig, storage: Storage, helpers: TaskRouteHelpers,
): void {
  const { resolve, canAccessTask, canReadTask } = helpers;

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
    emitChange('agent-tasks', resolve(req));
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

    // If this task came from the owner's intent pool, the intent closes here. The SERVER does it:
    // the agent never writes into the owner's namespace, so the pool's one indirect write is this,
    // and it happens on the evidence of a completed task rather than on the agent's say-so.
    // Best-effort and isolated — a pool that cannot be updated must not fail a real completion.
    void closeItemsForTask(storage, config, task)
      .catch(e => logger.error('switching off the open item behind a task failed', { taskId: id, error: String(e) }));

    res.json(success(config.nodeId, { task: updated }));
    emitChange('agent-tasks', resolve(req));
    // Public landing feed — only when the agent published a PUBLIC deliverable (a real material).
    if (deliverableKey) {
      void (async () => {
        const rec = await storage.getMemory(task.agentGaii, deliverableKey);
        if (rec?.visibility !== 'public') return;
        await recordPublicActivity(storage, config, {
          category: 'agents',
          actor: task.agentGaii,
          summary: `Agent ${task.agentGaii.split('#')[0]} completed "${task.title}"`,
          detail: message,
          link: `/v1/memory/${encodeURIComponent(task.agentGaii)}/${encodeURIComponent(deliverableKey)}`,
        });
      })().catch(e => logger.error('public activity (task deliverable) failed', { taskId: id, error: String(e) }));
    }
    // If this task was dispatched by a workflow, advance that run (output check → next step).
    getActiveWorkflowEngine()?.onTaskTerminal(task, 'done')
      .catch(e => logger.error('workflow advance on task done failed', { taskId: id, error: String(e) }));
    // The runner's live-progress record is spent now that the task is done: reclaim its key rather
    // than hold one per completed task forever. Safe to run concurrently with the workflow advance
    // above — a step's success signal globs the agent's DELIVERABLE keys, never this
    // `agents.{name}.tasks.{id}.` prefix, so the two never touch the same record.
    void reclaimTaskLiveTrace(storage, task);
    // B6 — if this task was materialised by an ecosystem-app automation recipe with email:true,
    // email the owner a short report + store an in-app report record. Best-effort + isolated:
    // pass the freshly-updated record (carries the deliverableKey the agent just set).
    void notifyAutomationTaskComplete(storage, config, updated ?? task, message)
      .catch(e => logger.error('automation completion notify failed', { taskId: id, error: String(e) }));
    // B7/B8 — drain the owner's advisory outbox for this app: deliver immediately (no approval) over
    // the connector tunnel, or gate behind owner approval. Best-effort + isolated (sibling to B6).
    void processAutomationAdvisories(storage, config, updated ?? task)
      .catch(e => logger.error('automation advisory drain failed', { taskId: id, error: String(e) }));
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
    emitChange('agent-tasks', resolve(req));
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
    if (metadata && JSON.stringify(metadata).length > 200_000) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'metadata too large (max 200000 bytes serialized)'));
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
    recomputeAndCacheStatistics(storage, task.agentGaii, config.nodeId).catch(err => { logger.warn('POST /v1/agents/:name/tasks/:id/rate: continuing after a suppressed failure', { error: String(err) }); });

    res.json(success(config.nodeId, { task: updated }));
    emitChange('agent-tasks', resolve(req));
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
    emitChange('agent-tasks', resolve(req));
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
    emitChange('agent-tasks', resolve(req));
  });

  /* ── GET /v1/agents/:name/tasks/:id/events -- List task events ── */
  router.get('/v1/agents/:name/tasks/:id/events', requireAuth(), async (req, res) => {
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
        // The offer this run came from (the Ask flow stamps scope.offer_id), so an Offers card can
        // pin its OWN run history by filtering this aggregate. null for non-offer tasks.
        offer_id: t.scope?.find(s => s.name === 'offer_id')?.value ?? null,
        verification: t.verification?.userExpects ?? null,
        rating: t.rating ?? null,
      }));
    res.json(success(config.nodeId, { deliverables, total: deliverables.length }));
  });
}
