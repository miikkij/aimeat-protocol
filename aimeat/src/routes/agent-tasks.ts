/**
 * @file agent-tasks.ts
 * @description REST endpoints for agent task CRUD, lifecycle, and event log.
 *   Supports creating tasks for agents, transitioning status (draft->queued->active->done|failed),
 *   appending event logs, and listing task events. Callers: owner sessions, same-owner agents, and
 *   (since v1.9.0) H-2 app grants holding task:read (list/get/events) or task:write (create/start),
 *   scoped strictly to the app's OWN owner's agents.
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
 *   v1.10.0 -- 2026-07-12 -- /start now emitDelivery's a `task_assigned` wake on owner approval
 *     (queued -> active), matching create-time auto-activation. Closes the "waits for polling" gap where
 *     a tunnel-parked daemon only picked an approved task up on its ~5-min safety-net re-list.
 *   v1.8.0 -- 2026-06-15 -- B7/B8: on /complete, also fire processAutomationAdvisories() to drain the
 *     owner's advisory outbox -- deliver immediately over the connector tunnel (no approval) or gate
 *     behind owner approval (best-effort, never blocks completion).
 *   v1.7.0 -- 2026-06-15 -- B6: on /complete, fire notifyAutomationTaskComplete() so an
 *     automation-recipe task with email:true emails the owner + stores an in-app report
 *     (best-effort, never blocks completion).
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
 *   v1.1.0 -- 2026-06-16 -- Record a public-activity-feed event on task completion when
 *     the agent published a PUBLIC deliverable.
 *   v1.9.0 -- 2026-07-07 -- TARGET-006 AGENCY: a same-owner H-2 app grant may create + start tasks
 *     (task:write) and list/get/read events (task:read via canReadTask) for its OWN owner's agents.
 *     Additive app-role branches on create/start/list/get/events; owner/agent paths unchanged; the
 *     write/lifecycle routes (PATCH/complete/fail/rate/...) stay owner/agent-only (canAccessTask).
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentTaskRecord } from '../storage/interface.js';
import { resolveIdentity, buildGAII } from '../utils/gaii.js';
import type { WebhookDispatcher, TaskBucket, TaskRouteHelpers } from './agent-tasks/helpers.js';
import { registerTaskCreateReadRoutes } from './agent-tasks/create-read.js';
import { registerTaskLifecycleRoutes } from './agent-tasks/lifecycle.js';
import { registerTaskCompletionRoutes } from './agent-tasks/completion.js';

const TASK_TERMINAL_STATUSES = new Set(['done', 'failed']);

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

  /** Wildcard-aware scope check for the current token (mirrors auth/middleware.ts requireScope). */
  function tokenHasScope(req: Express.Request, scope: string): boolean {
    const scopes = (req.auth!.scopes as string[] | undefined) ?? [];
    if (scopes.includes('*') || scopes.includes(scope)) return true;
    return scopes.includes(`${scope.split(':')[0]}:*`);
  }

  /**
   * Check if current session can access a task (owner or the task's agent). This is the gate for
   * ALL task routes incl. write/lifecycle ones — an app grant is deliberately NOT admitted here.
   * App access is granted narrowly, only on the read routes (canReadTask) and the two write actions
   * that check task:write explicitly (create + start).
   */
  function canAccessTask(req: Express.Request, task: AgentTaskRecord): boolean {
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    if (isOwnerSession) {
      const ownerGhii = `${req.auth!.owner}@${config.nodeId}`;
      return task.ownerGaii === ownerGhii;
    }
    // Agent session -- must match agent GAII
    return task.agentGaii === req.auth!.sub;
  }

  /**
   * Read access for the task-detail + events routes: owner/agent (canAccessTask) OR a same-owner
   * H-2 app grant holding task:read. Kept separate from canAccessTask so task:read never leaks into
   * the write/lifecycle routes that gate on canAccessTask.
   */
  function canReadTask(req: Express.Request, task: AgentTaskRecord): boolean {
    if (canAccessTask(req, task)) return true;
    if (req.auth!.roles.includes('app') && tokenHasScope(req, 'task:read')) {
      return task.ownerGaii === `${req.auth!.owner}@${config.nodeId}`;
    }
    return false;
  }

  // Bundle the helper closures (+ deriveTaskBucket + webhookDispatcher) so the extracted
  // route modules can reconstruct the local names and keep their handler bodies byte-identical.
  const helpers: TaskRouteHelpers = {
    resolve, resolveAgentGaii, tokenHasScope, canAccessTask, canReadTask, deriveTaskBucket, webhookDispatcher,
  };

  // Registration order preserves the original top-to-bottom route order (Express matches in order):
  // create/read (1-3) -> lifecycle (4-9) -> completion (10-17).
  registerTaskCreateReadRoutes(router, config, storage, helpers);
  registerTaskLifecycleRoutes(router, config, storage, helpers);
  registerTaskCompletionRoutes(router, config, storage, helpers);

  return router;
}
