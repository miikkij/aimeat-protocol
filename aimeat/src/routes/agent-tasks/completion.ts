/**
 * @file src/routes/agent-tasks/completion.ts
 * @description Agent-task completion + review routes (event, complete, fail, rate, triage, todos, events, deliverables). Extracted from agent-tasks.ts to satisfy max-file-lines.
 * @version-history
 *   v1.4.0 — 2026-08-12 — /complete answers after the fan-out rather than before it. The response
 *     used to overtake the agent's own counters, so a caller reading them back saw the pre-completion
 *     numbers on Postgres and the post-completion ones on SQLite.
 *   v1.3.0 — 2026-08-11 — The event append and the single-todo update move to
 *     services/agent-task-write.ts. The event write is unchanged here; the todo update now bumps
 *     lastEventAt and appends the matching todo_completed / todo_failed event, which this door never
 *     did — a task worked through PATCH /todos/:todoId filled its plan in with nothing in its history
 *     to say when, and the stall detector counted a visibly working agent as gone quiet.
 *   v1.2.0 — 2026-08-11 — The completion and failure tails move to services/agent-task-fanout.ts,
 *     so the MCP door gets them too. Behaviour here is unchanged.
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
import { logger } from '../../utils/logger.js';
import { afterTaskCompleted, failTask } from '../../services/agent-task-fanout.js';
import { recomputeAndCacheStatistics } from '../../services/agent-statistics.js';
import { recordTaskEvent, setTodoStatus } from '../../services/agent-task-write.js';
import { AgentTaskRateSchema, AgentTaskTriageSchema } from '../../models/agent-task-schemas.js';
import { requireReadiness } from '../../middleware/readiness-gate.js';
import type { TaskRouteHelpers } from './helpers.js';

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

    // The stalled auto-resume, the state gate, the event and the telemetry roll-up are
    // services/agent-task-write.ts, because they belong to APPENDING AN EVENT rather than to this
    // door. aimeat_task_event wrote its own, and its telemetry OVERWROTE the task totals with the
    // last event's numbers instead of accumulating them.
    const result = await recordTaskEvent({ storage, config }, task, req.body, resolve(req));
    if (!result.ok) {
      res.status(result.status).json(error(config.nodeId, result.code, result.message));
      return;
    }

    res.status(201).json(success(config.nodeId, { event: result.event }));
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

    // Everything a completion sets off is services/agent-task-fanout.ts, because it belongs to
    // COMPLETING rather than to this door: the workflow run that dispatched the task advances, the
    // open item behind it closes, the agent's counters move, the runner's live-trace key is
    // reclaimed, the automation report is sent and its advisory outbox drained, and a public
    // deliverable reaches the feed. aimeat_task_complete did none of it.
    //
    // The door answers AFTER it. Only the agent's counters are awaited inside; the slow steps stay
    // fire-and-forget. Answering first made those counters a race against whatever the caller does
    // next, and the next thing is always a read: the Activity tab reloads on the change event, and
    // an agent that just finished asks for its own /capabilities. On SQLite the counter write landed
    // inside the same tick and the race was invisible; on Postgres every query is a round trip, the
    // read arrived first and activityStats came back null for a task the caller had been told was
    // done. The MCP door has always awaited this before replying — this is the same order.
    await afterTaskCompleted({ storage, config }, task, updated ?? null, message, deliverableKey, resolve(req));

    res.json(success(config.nodeId, { task: updated }));
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

    const message = typeof req.body?.message === 'string' ? req.body.message : 'Task failed';
    // services/agent-task-fanout.ts — aimeat_task_fail makes the same transition.
    const failed = await failTask({ storage, config }, task, message, resolve(req));
    if (!failed.ok) {
      res.status(failed.status).json(error(config.nodeId, failed.code, failed.message));
      return;
    }
    res.json(success(config.nodeId, { task: failed.task }));
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

    // The auto-resume, the state gate, the todo write and its event are services/agent-task-write.ts.
    // aimeat_task_todo wrote its own, and that copy carried two things this one did not: the
    // lastEventAt bump that keeps the stall detector off a visibly working agent, and the
    // todo_completed / todo_failed event the task history is read from.
    const result = await setTodoStatus({ storage, config }, task, todoId, req.body, resolve(req));
    if (!result.ok) {
      res.status(result.status).json(error(config.nodeId, result.code, result.message));
      return;
    }
    if (!result.task) {
      res.status(500).json(error(config.nodeId, 'UPDATE_FAILED', 'Failed to update todo'));
      return;
    }

    res.json(success(config.nodeId, { task: result.task, todo: result.todo }));
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
