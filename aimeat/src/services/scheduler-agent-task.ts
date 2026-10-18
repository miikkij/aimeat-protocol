/**
 * @file src/services/scheduler-agent-task.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The scheduler's `agent_task` kind and the public materialiseAgentTask path: put an
 *   AgentTaskRecord in an agent's queue and wake the agent on every channel a created task uses.
 *   Moved out of scheduler.ts by pure extraction when that file reached the 800-line limit; the
 *   bodies are unchanged except that `this.storage` became a parameter and the two wake channels
 *   (`this.webhookDispatcher` and the MCP resource notice) arrive as `wake`; the Scheduler methods of
 *   the same names call these.
 * @structure TaskWake · runAgentTaskJob(storage, wake, job, trigger) · materialiseAgentTask(storage, wake, args)
 * @usage import { runAgentTaskJob, materialiseAgentTask } from './scheduler-agent-task.js';
 * @version-history
 *   v1.1.0 — 2026-10-18 — TaskWake carries the node's config, and both paths read the agent through
 *     startFactsOf (services/scope-auto-narrow.ts): a `*` agent whose record is ready is narrowed to
 *     what it used before its scheduled task is decided, instead of the task waiting for the owner.
 *   v1.0.0 — 2026-10-16 — Extracted from scheduler.ts (max-file-lines), bodies verbatim (QA audit E4-03/E4-04/E4-07 grew that file).
 */
import { randomUUID } from 'node:crypto';
import type { Storage, ScheduledJobRecord, AgentTaskRecord, AgentTaskScope } from '../storage/interface.js';
import { isTerminalTaskStatus } from '../storage/interface.js';
import type { createWebhookDispatcher } from './webhook-dispatcher.js';
import { emitChange, emitDelivery } from './event-bus.js';
import { decideTaskStart, taskWakeId, AUTO_START_MARK } from './agent-task-rules.js';
import { isStopped } from './agent-stop-rules.js';
import { startFactsOf } from './scope-auto-narrow.js';
import type { AimeatConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import type { JobTrigger, JobRunResult } from './scheduler-types.js';

type WebhookDispatcher = ReturnType<typeof createWebhookDispatcher>;

/**
 * The wake channels a created task is announced on. The MCP resource notice is passed in by
 * scheduler.ts, which already imports mcp/resource-events.ts, so this service module does not.
 */
export interface TaskWake {
  webhookDispatcher?: WebhookDispatcher;
  emitResourceUpdated: (agentGaii: string, uri: string) => void;
  /** The node's config, for the narrowing a start decision may make (services/scope-auto-narrow.ts). */
  config: AimeatConfig;
}

/**
 * `agent_task` kind: materialise an AgentTaskRecord into the target agent's
 * queue and wake it via the existing webhook/MCP/SSE fan-out. The schedule is
 * the parent (parentTaskId); offline agents pick it up on reconnect.
 */
export async function runAgentTaskJob(
  storage: Storage, wake: TaskWake, job: ScheduledJobRecord, trigger: JobTrigger,
): Promise<JobRunResult> {
  const owner = job.ownerScope;
  const agentGaii = job.agentGaii;
  const agentName = job.agentName;
  if (!owner || !agentGaii || !agentName) {
    throw new Error(`agent_task job "${job.id}" missing ownerScope/agentGaii/agentName`);
  }
  const cfg = (job.input ?? {}) as {
    taskTemplate?: {
      title?: string; description?: string; scope?: AgentTaskScope[]; rules?: string[];
      verification?: { userExpects?: string; technicalChecks?: string[] };
      resources?: { knowledgePackages?: string[]; memoryKeys?: string[]; memoryPrefixes?: string[] };
    };
  };
  const tmpl = cfg.taskTemplate;
  if (!tmpl?.title) throw new Error(`agent_task job "${job.id}" missing taskTemplate.title`);

  // A STOPPED AGENT'S RUN IS SKIPPED, NOT QUEUED (Jouni, 2026-10-11). An agent stopped for a week with
  // an hourly schedule must not find 168 runs waiting when it is started. Before the overlap guard,
  // so a "Run now" on a stopped agent says the agent is stopped and not that a run is still going.
  const agent = await storage.getAgent(agentGaii);
  if (isStopped(agent)) {
    return { reads: [], writes: [], skipped: true, skipCode: 'stopped',
      skipReason: `${agent?.displayName ?? agentName} is stopped, so this run was skipped. Start the agent, and the next run happens at its time.` };
  }

  // Overlap guard: don't pile up occurrences of the same schedule. A task the
  // owner has set aside — `paused` (manual only) or any `archived` task — never
  // blocks, which fixes the trap where a paused/archived occurrence silently
  // swallowed every "Run now".
  //  - Manual "Run now": defer only to an occurrence that is pending or running
  //    on its own (queued/draft/revision_requested/active/stalled). A paused
  //    one was deliberately stopped, so an explicit run gets a fresh occurrence.
  //  - Cron/@activate: keep the stricter guard so unfinished occurrences don't
  //    accumulate (anything not done/failed/declined defers the next fire).
  const { tasks } = await storage.listAgentTasks(agentGaii, { perPage: 200 });
  const blocks = trigger === 'manual'
    ? (t: AgentTaskRecord) => t.status !== 'paused' && !isTerminalTaskStatus(t.status)
    : (t: AgentTaskRecord) => !isTerminalTaskStatus(t.status);
  const inFlight = tasks.find(t => t.parentTaskId === job.id && t.triage !== 'archived' && blocks(t));
  if (inFlight) {
    logger.info(`agent_task ${job.id}: occurrence ${inFlight.id} still ${inFlight.status}; skipping this fire [${trigger}]`);
    return {
      reads: [], writes: [], skipped: true,
      skipReason: `A previous run is still ${inFlight.status}; finish, fail, or delete it to run again.`,
    };
  }

  // The same start decision every created task gets (services/agent-task-rules.ts): the agent's
  // own answer, never past the permission floor. It read `mode === 'task-runner'` inline until
  // 2026-10-02, a copy of the old rule that would have kept a concierge's schedules waiting.
  const autoActivated = decideTaskStart(await startFactsOf({ storage, config: wake.config }, agent)).startsNow;
  const now = new Date().toISOString();
  const scheduleScope: AgentTaskScope = {
    name: 'schedule', value: job.cron, type: 'cron', description: job.displayName || job.name,
  };
  const record: AgentTaskRecord = {
    id: randomUUID(),
    agentGaii,
    ownerGaii: owner,
    title: tmpl.title,
    description: tmpl.description ?? '',
    scope: [...(tmpl.scope ?? []), scheduleScope],
    rules: tmpl.rules ?? [],
    verification: {
      userExpects: tmpl.verification?.userExpects ?? '',
      technicalChecks: tmpl.verification?.technicalChecks ?? [],
    },
    resources: tmpl.resources,
    todos: [],
    status: autoActivated ? 'active' : 'queued',
    parentTaskId: job.id,
    createdAt: now,
    updatedAt: now,
    lastEventAt: autoActivated ? now : undefined,
  };
  const created = await storage.createAgentTask(record);

  if (autoActivated) {
    await storage.appendTaskEvent({
      id: randomUUID(),
      taskId: record.id,
      type: 'started',
      message: `Task auto-activated from schedule "${job.displayName || job.name}"`,
      details: { started_by: AUTO_START_MARK },
      timestamp: now,
    });
  }

  // Wake fan-out — same channels a normally-created task uses.
  const eventName = autoActivated ? 'task.approved' : 'task.queued';
  if (wake.webhookDispatcher) {
    wake.webhookDispatcher.dispatchWebhookEvent(agentGaii, eventName, {
      task_id: record.id,
      title: record.title,
      description: record.description ?? '',
      has_todos: false,
      todo_count: 0,
      scope_summary: record.scope.slice(0, 5).map(s => `${s.type || s.name}:${s.value}`),
      created_at: record.createdAt,
      auto_activated: autoActivated,
      schedule_id: job.id,
    });
  }
  // The connector tunnel, which the line above's "same channels a normally-created task uses"
  // claimed and did not deliver. A webhook subscriber heard about a scheduled task and an agent
  // holding a socket did not, so the task waited for whatever polled next. Same miss as the
  // workflow engine's, found in the same sweep. → pitfalls §58
  emitDelivery({ target: agentGaii, kind: 'task_assigned', id: taskWakeId(record.id, record.status, now), payload: created });
  try { wake.emitResourceUpdated(agentGaii, `aimeat://agents/${agentName}/tasks`); } catch (err) { logger.warn('cfg: MCP not connected', { error: String(err) }); }
  emitChange('agent-tasks');

  return { reads: [], writes: [], taskId: created.id };
}

/**
 * Materialise a one-off AgentTaskRecord into an agent's queue and wake it via the same
 * webhook/MCP/SSE fan-out a scheduled `agent_task` uses. Public so other triggers (e.g. the
 * ecosystem-app automation recipe, feature B4) can reuse the exact wake path without duplicating
 * the dispatch machinery. `parentRef` is recorded as the task's parentTaskId (a recipe id here) so
 * the lineage is visible; unlike the scheduled path there is NO overlap guard — each trigger
 * deposit produces a fresh task occurrence. Best-effort wake (offline agents pick it up on
 * reconnect). Returns the created task id.
 */
export async function materialiseAgentTask(storage: Storage, wake: TaskWake, args: {
  owner: string;            // owner GHII (e.g. alice@node)
  agentGaii: string;        // the target agent's full GAII
  agentName: string;        // the agent's bare name (for the MCP resource URI)
  parentRef: string;        // recorded as parentTaskId (the recipe id) for lineage
  title: string;
  description?: string;
  scope?: AgentTaskScope[];
  rules?: string[];
  verification?: { userExpects?: string; technicalChecks?: string[] };
  resources?: { knowledgePackages?: string[]; memoryKeys?: string[]; memoryPrefixes?: string[] };
  /** Ecosystem-app recipe provenance/routing (B5/B6). Stamped onto the task so the agent
   *  knows WHERE to write its report (organism) and the completion hook knows whether to
   *  email the owner / gate the output. Omitted for non-automation triggers. */
  automation?: AgentTaskRecord['automation'];
}): Promise<string> {
  const agent = await storage.getAgent(args.agentGaii);
  const autoActivated = decideTaskStart(await startFactsOf({ storage, config: wake.config }, agent)).startsNow;
  const now = new Date().toISOString();
  const record: AgentTaskRecord = {
    id: randomUUID(),
    agentGaii: args.agentGaii,
    ownerGaii: args.owner,
    title: args.title,
    description: args.description ?? '',
    scope: args.scope ?? [],
    rules: args.rules ?? [],
    verification: {
      userExpects: args.verification?.userExpects ?? '',
      technicalChecks: args.verification?.technicalChecks ?? [],
    },
    resources: args.resources,
    todos: [],
    status: autoActivated ? 'active' : 'queued',
    parentTaskId: args.parentRef,
    createdAt: now,
    updatedAt: now,
    lastEventAt: autoActivated ? now : undefined,
    ...(args.automation ? { automation: args.automation } : {}),
  };
  const created = await storage.createAgentTask(record);

  if (autoActivated) {
    await storage.appendTaskEvent({
      id: randomUUID(),
      taskId: record.id,
      type: 'started',
      message: `Task auto-activated from automation recipe "${args.parentRef}"`,
      details: { started_by: AUTO_START_MARK },
      timestamp: now,
    }).catch(err => { logger.warn('cfg: best-effort', { error: String(err) }); });
  }

  const eventName = autoActivated ? 'task.approved' : 'task.queued';
  if (wake.webhookDispatcher) {
    wake.webhookDispatcher.dispatchWebhookEvent(args.agentGaii, eventName, {
      task_id: record.id,
      title: record.title,
      description: record.description ?? '',
      has_todos: false,
      todo_count: 0,
      scope_summary: record.scope.slice(0, 5).map(s => `${s.type || s.name}:${s.value}`),
      created_at: record.createdAt,
      auto_activated: autoActivated,
    });
  }
  // Same pair. This method's own doc says callers reuse it to get "the exact wake path without
  // duplicating the dispatch machinery", so the path it hands them has to be the whole one.
  emitDelivery({ target: args.agentGaii, kind: 'task_assigned', id: taskWakeId(record.id, record.status, now), payload: created });
  try { wake.emitResourceUpdated(args.agentGaii, `aimeat://agents/${args.agentName}/tasks`); } catch (err) { logger.warn('cfg: MCP not connected', { error: String(err) }); }
  emitChange('agent-tasks');

  return created.id;
}
