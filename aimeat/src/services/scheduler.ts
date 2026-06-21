/**
 * @file scheduler.ts
 * @description Internal Scheduler System for AIMEAT — centralized cron-based job scheduler.
 *   Both core services and sandboxed extensions register jobs here.
 *   Supports special @activate trigger: runs on extension activation AND every server startup.
 *   Every execution creates an ExecutionLogEntry with timing, result, and memory I/O.
 * @version-history
 *   v1.0.0 — 2026-03-01 — Initial implementation with croner
 *   v2.0.0 — 2026-03-15 — Add @activate trigger, execution log, memory access tracking
 *   v2.1.0 — 2026-06-05 — executeJob/triggerNow return a JobOutcome so a manual
 *     "Run now" can report whether a task was created (and why not); agent_task
 *     overlap guard relaxed for manual triggers (only a genuinely running
 *     active/stalled occurrence defers it; archived tasks never block).
 *   v2.2.0 — 2026-06-15 — Add the `eco-capability` kind: invoke a connected ecosystem app's
 *     capability over the connect-tunnel each fire; an offline GEAI is a skip (no hot-loop).
 *   v2.3.0 — 2026-06-15 — Expose a public materialiseAgentTask() (extracted wake fan-out from
 *     executeAgentTaskJob) so the ecosystem-app automation recipe (feature B4) can spawn an agent
 *     task on a data publish without duplicating the dispatch machinery.
 *   v2.4.0 — 2026-06-15 — materialiseAgentTask() accepts an `automation` arg and stamps it onto the
 *     AgentTaskRecord (B5/B6): recipe provenance + organism routing + email/approval toggles.
 */
import { Cron } from 'croner';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, ScheduledJobRecord, ExecutionLogEntry, AgentTaskRecord, AgentTaskScope, ScheduleConstraint } from '../storage/interface.js';
import { executeExtensionAction, trackMemoryAccess } from './extension-runtime.js';
import type { ExtensionCtx } from './extension-runtime.js';
import type { EmailService } from './email.js';
import type { PushService } from './push.js';
import type { createWebhookDispatcher } from './webhook-dispatcher.js';
import { completeForOwner } from './ai-completion.js';
import { getActiveWorkflowEngine } from './workflow/engine.js';
import { getActiveConnectTunnelManager } from './connect-tunnel.js';
import { parseGaiiLoose, buildGEAI } from '../utils/gaii.js';
import { evaluateConstraints, applyAfterRun } from './schedule-constraints.js';
import { emitChange } from './event-bus.js';
import { emitResourceUpdated } from '../mcp/index.js';
import { logger } from '../utils/logger.js';

type WebhookDispatcher = ReturnType<typeof createWebhookDispatcher>;

/**
 * Process-wide handle to the active Scheduler. Set once during service init so
 * surfaces created per-request (e.g. the MCP server) can register/reschedule a
 * job on the live cron without threading the instance through every signature.
 */
let _activeScheduler: Scheduler | null = null;
export function setActiveScheduler(scheduler: Scheduler): void { _activeScheduler = scheduler; }
export function getActiveScheduler(): Scheduler | null { return _activeScheduler; }

export type JobTrigger = 'cron' | 'manual' | 'activate';

/** Result returned by a kind-specific executor (memory I/O + optional spawned task). */
interface JobRunResult {
  reads: string[];
  writes: string[];
  taskId?: string;
  /** The executor deliberately did nothing (e.g. an occurrence is still running). */
  skipped?: boolean;
  /** Human-readable explanation for a skip, surfaced to manual-trigger callers. */
  skipReason?: string;
}

/**
 * Outcome of one job execution, returned by triggerNow() so a manual "Run now"
 * can tell the owner what happened. `code` is a stable token the UI maps to a
 * localized message; `detail` carries the specific (English) explanation.
 *   created  — an agent_task occurrence was queued/activated (taskId set)
 *   ran      — a non-task job (ai/extension/core) executed successfully
 *   busy     — skipped: a previous occurrence is still running, or the job was
 *              already executing
 *   limited  — skipped by a constraint (daily_limit / max_runs / budget)
 *   error    — the job ran but failed (detail = error message)
 */
export interface JobOutcome {
  code: 'created' | 'ran' | 'busy' | 'limited' | 'error';
  taskId?: string;
  detail?: string;
}

export class Scheduler {
  private config: AimeatConfig;
  private storage: Storage;
  private cronJobs = new Map<string, Cron>();
  private coreHandlers = new Map<string, () => Promise<void>>();
  private running = false;
  private emailService?: EmailService;
  private webhookDispatcher?: WebhookDispatcher;
  private pushService?: PushService;
  /** Guards against overlapping fires of the same job (one run at a time). */
  private executing = new Set<string>();

  constructor(config: AimeatConfig, storage: Storage, emailService?: EmailService) {
    this.config = config;
    this.storage = storage;
    this.emailService = emailService;
  }

  /** Inject the webhook dispatcher used to wake agents for `agent_task` fires. */
  setWebhookDispatcher(dispatcher: WebhookDispatcher): void {
    this.webhookDispatcher = dispatcher;
  }

  /** Inject the push service used to notify the owner on failed/auto-paused schedules. */
  setPushService(pushService: PushService): void {
    this.pushService = pushService;
  }

  /** Expose the notify services (push + email) for core handlers that send owner alerts. */
  getNotifyServices(): { push?: PushService; email?: EmailService } {
    return { push: this.pushService, email: this.emailService };
  }

  /**
   * Register a core handler function that can be referenced by scheduled jobs.
   * Must be called before start().
   */
  registerCoreHandler(id: string, fn: () => Promise<void>): void {
    this.coreHandlers.set(id, fn);
  }

  /**
   * Load all enabled jobs from storage and start scheduling them.
   * Also runs @activate jobs for all active extensions.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const jobs = await this.storage.listScheduledJobs({ enabled: true });
    const activateJobs: ScheduledJobRecord[] = [];

    for (const job of jobs) {
      if (job.cron === '@activate') {
        activateJobs.push(job);
      } else {
        this.scheduleJob(job);
      }
    }

    logger.info(`Scheduler started with ${jobs.length} enabled jobs (${activateJobs.length} @activate)`);

    // Run @activate jobs sequentially after scheduler is running
    if (activateJobs.length > 0) {
      this.runActivateJobsList(activateJobs).catch(err =>
        logger.error('Scheduler @activate jobs failed', { error: String(err) }));
    }
  }

  /**
   * Stop all scheduled jobs.
   */
  stop(): void {
    for (const [id, cron] of this.cronJobs) {
      cron.stop();
      logger.info(`Scheduler stopped job: ${id}`);
    }
    this.cronJobs.clear();
    this.running = false;
    logger.info('Scheduler stopped');
  }

  /**
   * Add a new job and start scheduling it if enabled.
   * @activate jobs are stored but not scheduled via cron (they run on demand).
   */
  addJob(record: ScheduledJobRecord): void {
    if (record.enabled && record.cron !== '@activate') {
      this.scheduleJob(record);
    }
  }

  /**
   * Remove a job from the scheduler (does not delete from storage).
   */
  removeJob(id: string): void {
    const existing = this.cronJobs.get(id);
    if (existing) {
      existing.stop();
      this.cronJobs.delete(id);
      logger.info(`Scheduler removed job: ${id}`);
    }
  }

  /**
   * Manually trigger a job immediately, regardless of its cron schedule.
   * Returns the outcome so the caller can tell the owner whether a task was
   * created (and, if not, why).
   */
  async triggerNow(id: string): Promise<JobOutcome> {
    const job = await this.storage.getScheduledJob(id);
    if (!job) throw new Error(`Job "${id}" not found`);
    return this.executeJob(job, 'manual');
  }

  /**
   * Run all @activate jobs for a specific extension (called after activation).
   * Jobs are executed sequentially in storage order.
   */
  async runActivateJobs(extensionName: string): Promise<void> {
    const jobs = await this.storage.listScheduledJobs({ extensionName, enabled: true });
    const activateJobs = jobs.filter(j => j.cron === '@activate');
    if (activateJobs.length === 0) return;

    logger.info(`Running ${activateJobs.length} @activate jobs for extension: ${extensionName}`);
    await this.runActivateJobsList(activateJobs);
  }

  /**
   * Update a job's schedule. Reschedules if enabled, removes if disabled.
   */
  async reschedule(id: string): Promise<void> {
    this.removeJob(id);
    const job = await this.storage.getScheduledJob(id);
    if (job && job.enabled && job.cron !== '@activate') {
      this.scheduleJob(job);
    }
  }

  // ── Private ────────────────────────────────────────────────────

  private async runActivateJobsList(jobs: ScheduledJobRecord[]): Promise<void> {
    for (const job of jobs) {
      try {
        await this.executeJob(job, 'activate');
      } catch (err) {
        // Log but don't abort remaining @activate jobs
        logger.error(`@activate job failed: ${job.id}`, { error: String(err) });
      }
    }
  }

  private scheduleJob(job: ScheduledJobRecord): void {
    // Stop any existing cron for this job
    const existing = this.cronJobs.get(job.id);
    if (existing) existing.stop();

    try {
      // Pass IANA timezone through to croner so "every morning" stays correct
      // across DST. Omitted when unset → server-local interpretation (unchanged).
      const cronOpts: { name: string; timezone?: string } = { name: job.id };
      if (job.timezone) cronOpts.timezone = job.timezone;
      const cron = new Cron(job.cron, cronOpts, async () => {
        await this.executeJob(job, 'cron');
      });

      this.cronJobs.set(job.id, cron);

      // Update nextRunAt
      const next = cron.nextRun();
      if (next) {
        this.storage.updateScheduledJob(job.id, {
          nextRunAt: next.toISOString(),
          updatedAt: new Date().toISOString(),
        }).catch(err => logger.error('Failed to update nextRunAt', { jobId: job.id, error: (err as Error).message }));
      }

      logger.info(`Scheduler scheduled job: ${job.id} (${job.cron})`);
    } catch (err) {
      logger.error(`Scheduler failed to parse cron for job: ${job.id}`, {
        cron: job.cron,
        error: (err as Error).message,
      });
    }
  }

  private async executeJob(job: ScheduledJobRecord, trigger: JobTrigger): Promise<JobOutcome> {
    // ── Overlap guard: never run two fires of the same job concurrently ──
    if (this.executing.has(job.id)) {
      logger.warn(`Scheduler skipped overlapping fire: ${job.id}`);
      await this.writeLog(job, trigger, 'skipped', { errorMessage: 'previous run still in progress', durationMs: 0, reads: [], writes: [] });
      return { code: 'busy', detail: 'A previous run is still in progress.' };
    }

    // ── Pre-fire budget/run guards (opt-in; only when constraints are attached) ──
    if (job.constraints?.length) {
      try {
        const agent = job.agentGaii ? await this.storage.getAgent(job.agentGaii) : null;
        const verdict = await evaluateConstraints(job, { storage: this.storage, config: this.config, ownerGaii: job.ownerScope, agent });
        if (!verdict.allow) {
          logger.info(`Scheduler skipped ${job.id}: ${verdict.reason}`);
          await this.writeLog(job, trigger, 'skipped', { errorMessage: verdict.reason, durationMs: 0, reads: [], writes: [] });
          if (verdict.disable) await this.autoDisable(job, verdict.reason ?? 'constraint reached');
          return { code: 'limited', detail: verdict.reason ?? 'a run limit was reached' };
        }
      } catch (err) {
        logger.error(`Scheduler constraint check failed for ${job.id}`, { error: String(err) });
      }
    }

    this.executing.add(job.id);
    const startTime = Date.now();
    logger.info(`Scheduler executing job: ${job.id} (${job.name}) [${trigger}]`);

    let result: ExecutionLogEntry['result'] = 'success';
    let errorMessage: string | undefined;
    let run: JobRunResult = { reads: [], writes: [] };

    try {
      if (job.type === 'core') {
        await this.executeCoreJob(job);
      } else if (job.type === 'extension') {
        run = await this.executeExtensionJob(job);
      } else if (job.type === 'ai') {
        run = await this.executeAiJob(job);
      } else if (job.type === 'agent_task') {
        run = await this.executeAgentTaskJob(job, trigger);
      } else if (job.type === 'workflow') {
        run = await this.executeWorkflowJob(job);
      } else if (job.type === 'eco-capability') {
        run = await this.executeEcoCapabilityJob(job);
      }
    } catch (err) {
      result = 'error';
      errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this.executing.delete(job.id);
    }

    const durationMs = Date.now() - startTime;

    // ── Executor declined to act (e.g. an occurrence is still running) ──
    // Treat like the constraint skip: record it in the run log but leave the
    // schedule's last-run state and runCount untouched (nothing actually ran).
    if (run.skipped) {
      logger.info(`Scheduler job skipped: ${job.id} [${trigger}] — ${run.skipReason ?? 'no-op'}`);
      await this.writeLog(job, trigger, 'skipped', { errorMessage: run.skipReason, durationMs, reads: run.reads, writes: run.writes });
      return { code: 'busy', detail: run.skipReason };
    }

    const cron = this.cronJobs.get(job.id);
    const nextRun = cron?.nextRun();

    // On success, advance runCount + apply post-run constraint state.
    let newRunCount = job.runCount ?? 0;
    let updatedConstraints: ScheduleConstraint[] | undefined;
    if (result === 'success') {
      newRunCount = (job.runCount ?? 0) + 1;
      job.runCount = newRunCount;
      try {
        const agent = job.agentGaii ? await this.storage.getAgent(job.agentGaii) : null;
        updatedConstraints = await applyAfterRun(job, { storage: this.storage, config: this.config, ownerGaii: job.ownerScope, agent });
      } catch { /* non-fatal */ }
    }

    await this.storage.updateScheduledJob(job.id, {
      lastRunAt: new Date().toISOString(),
      lastRunResult: result === 'error' ? 'error' : 'success',
      lastRunError: errorMessage,
      lastRunDurationMs: durationMs,
      nextRunAt: nextRun ? nextRun.toISOString() : undefined,
      runCount: newRunCount,
      ...(updatedConstraints ? { constraints: updatedConstraints } : {}),
      updatedAt: new Date().toISOString(),
    }).catch(() => { /* don't let update failure mask original error */ });

    // Core jobs run every 1-5 minutes; a successful (usually no-op) tick carries no
    // information and would dominate the execution log. Skip success rows for core jobs —
    // errors are still logged, and the per-job last-run status is persisted on the
    // ScheduledJob record above. User schedules keep full per-run logging.
    if (!(result === 'success' && job.type === 'core')) {
      await this.writeLog(job, trigger, result, {
        errorMessage, durationMs, reads: run.reads, writes: run.writes, taskId: run.taskId,
      });
    }

    if (result === 'error') {
      logger.error(`Scheduler job failed: ${job.id}`, { error: errorMessage, durationMs, trigger });
      this.notifyOwner(job, 'Schedule failed', errorMessage ?? 'Unknown error');
      return { code: 'error', detail: errorMessage };
    }

    logger.info(`Scheduler job completed: ${job.id} (${durationMs}ms) [${trigger}]`, {
      memoryReads: run.reads.length,
      memoryWrites: run.writes.length,
    });
    // Stop the cron proactively when a max_runs cap is now reached.
    await this.maybeAutoDisableMaxRuns(job, newRunCount);

    // agent_task that materialised a task → 'created'; otherwise a non-task job ran.
    if (run.taskId) return { code: 'created', taskId: run.taskId };
    return { code: 'ran' };
  }

  /** Write one ExecutionLogEntry (best-effort). */
  private async writeLog(
    job: ScheduledJobRecord, trigger: JobTrigger, result: ExecutionLogEntry['result'],
    opts: { errorMessage?: string; durationMs: number; reads: string[]; writes: string[]; taskId?: string },
  ): Promise<void> {
    const entry: ExecutionLogEntry = {
      id: randomUUID(),
      jobId: job.id,
      jobName: job.name,
      type: job.type,
      extensionName: job.extensionName,
      actionId: job.actionId,
      trigger,
      result,
      errorMessage: opts.errorMessage,
      durationMs: opts.durationMs,
      memoryReads: opts.reads,
      memoryWrites: opts.writes,
      taskId: opts.taskId,
      createdAt: new Date().toISOString(),
    };
    await this.storage.createExecutionLog(entry).catch(err =>
      logger.error('Failed to write execution log', { jobId: job.id, error: String(err) }));
  }

  /** Disable a schedule (stop the cron, persist enabled:false) and notify the owner. */
  private async autoDisable(job: ScheduledJobRecord, reason: string): Promise<void> {
    this.removeJob(job.id);
    job.enabled = false;
    await this.storage.updateScheduledJob(job.id, { enabled: false, updatedAt: new Date().toISOString() }).catch(() => {});
    emitChange('scheduler');
    this.notifyOwner(job, 'Schedule auto-paused', reason);
    logger.info(`Scheduler auto-disabled job ${job.id}: ${reason}`);
  }

  /** After a successful run, disable the schedule if a max_runs cap is now reached. */
  private async maybeAutoDisableMaxRuns(job: ScheduledJobRecord, runCount: number): Promise<void> {
    for (const c of job.constraints ?? []) {
      if (!c.enabled || c.type !== 'max_runs') continue;
      const limit = typeof c.params?.limit === 'number' ? c.params.limit : undefined;
      if (limit !== undefined && limit > 0 && runCount >= limit) {
        await this.autoDisable(job, `max_runs reached (${runCount}/${limit})`);
        return;
      }
    }
  }

  /** Send an owner push notification (best-effort; no-op if push disabled). */
  private notifyOwner(job: ScheduledJobRecord, title: string, body: string): void {
    if (!this.pushService?.enabled || !job.ownerScope) return;
    const ownerName = job.ownerScope.split('@')[0];
    const label = job.displayName || job.name;
    this.pushService.sendNotification(ownerName, {
      title,
      body: `${label}: ${body}`,
      url: '/v1/profile?tab=scheduler',
      tag: `schedule:${job.id}`,
    }).catch(() => { /* push best-effort */ });
  }

  /**
   * `ai` kind: gather predefined input memory keys, compose the prompt, run a
   * server-side completion on the owner's OpenRouter key, and store the result
   * to the owner's output key. Zero agent involvement; runs even when offline.
   */
  private async executeAiJob(job: ScheduledJobRecord): Promise<JobRunResult> {
    const owner = job.ownerScope;
    if (!owner) throw new Error(`AI job "${job.id}" missing ownerScope`);
    const cfg = (job.input ?? {}) as {
      inputKeys?: string[]; inputNamespaces?: string[]; prompt?: string;
      systemPrompt?: string; model?: string; outputKey?: string;
      outputVisibility?: 'private' | 'owner' | 'public';
    };
    if (!cfg.prompt || typeof cfg.prompt !== 'string') {
      throw new Error(`AI job "${job.id}" missing prompt`);
    }

    const inputKeys = Array.isArray(cfg.inputKeys) ? cfg.inputKeys : [];
    const reads: string[] = [];
    const parts: string[] = [cfg.prompt];
    for (let i = 0; i < inputKeys.length; i++) {
      const key = inputKeys[i];
      const ns = cfg.inputNamespaces?.[i] || owner;
      const rec = await this.storage.getMemory(ns, key);
      reads.push(ns === owner ? key : `${ns}::${key}`);
      const valueText = rec == null
        ? '(empty)'
        : (typeof rec.value === 'string' ? rec.value : JSON.stringify(rec.value, null, 2));
      parts.push(`\n--- INPUT: ${key} ---\n${valueText}`);
    }
    const composedPrompt = parts.join('\n');

    const result = await completeForOwner(this.storage, this.config, owner, {
      prompt: composedPrompt,
      systemPrompt: cfg.systemPrompt,
      model: cfg.model,
      appId: `schedule:${job.id}`,
    });

    const outputKey = cfg.outputKey || `scheduler.${job.id}.output`;
    const now = new Date().toISOString();
    const existing = await this.storage.getMemory(owner, outputKey);
    await this.storage.setMemory({
      key: outputKey,
      ownerGaii: owner,
      value: result.content,
      visibility: cfg.outputVisibility || 'private',
      tags: ['scheduler', 'ai-output'],
      ttlHours: null,
      version: existing ? existing.version + 1 : 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    return { reads, writes: [outputKey] };
  }

  /**
   * `agent_task` kind: materialise an AgentTaskRecord into the target agent's
   * queue and wake it via the existing webhook/MCP/SSE fan-out. The schedule is
   * the parent (parentTaskId); offline agents pick it up on reconnect.
   */
  private async executeAgentTaskJob(job: ScheduledJobRecord, trigger: JobTrigger): Promise<JobRunResult> {
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

    // Overlap guard: don't pile up occurrences of the same schedule. A task the
    // owner has set aside — `paused` (manual only) or any `archived` task — never
    // blocks, which fixes the trap where a paused/archived occurrence silently
    // swallowed every "Run now".
    //  - Manual "Run now": defer only to an occurrence that is pending or running
    //    on its own (queued/draft/revision_requested/active/stalled). A paused
    //    one was deliberately stopped, so an explicit run gets a fresh occurrence.
    //  - Cron/@activate: keep the stricter guard so unfinished occurrences don't
    //    accumulate (anything not done/failed defers the next fire).
    const { tasks } = await this.storage.listAgentTasks(agentGaii, { perPage: 200 });
    const TERMINAL = ['done', 'failed'];
    const blocks = trigger === 'manual'
      ? (t: AgentTaskRecord) => t.status !== 'paused' && !TERMINAL.includes(t.status)
      : (t: AgentTaskRecord) => !TERMINAL.includes(t.status);
    const inFlight = tasks.find(t => t.parentTaskId === job.id && t.triage !== 'archived' && blocks(t));
    if (inFlight) {
      logger.info(`agent_task ${job.id}: occurrence ${inFlight.id} still ${inFlight.status}; skipping this fire [${trigger}]`);
      return {
        reads: [], writes: [], skipped: true,
        skipReason: `A previous run is still ${inFlight.status}; finish, fail, or delete it to run again.`,
      };
    }

    const agent = await this.storage.getAgent(agentGaii);
    const autoActivated = agent?.mode === 'task-runner';
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
    const created = await this.storage.createAgentTask(record);

    if (autoActivated) {
      await this.storage.appendTaskEvent({
        id: randomUUID(),
        taskId: record.id,
        type: 'started',
        message: `Task auto-activated from schedule "${job.displayName || job.name}"`,
        timestamp: now,
      });
    }

    // Wake fan-out — same channels a normally-created task uses.
    const eventName = autoActivated ? 'task.approved' : 'task.queued';
    if (this.webhookDispatcher) {
      this.webhookDispatcher.dispatchWebhookEvent(agentGaii, eventName, {
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
    try { emitResourceUpdated(agentGaii, `aimeat://agents/${agentName}/tasks`); } catch { /* MCP not connected */ }
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
  async materialiseAgentTask(args: {
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
    const agent = await this.storage.getAgent(args.agentGaii);
    const autoActivated = agent?.mode === 'task-runner';
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
    const created = await this.storage.createAgentTask(record);

    if (autoActivated) {
      await this.storage.appendTaskEvent({
        id: randomUUID(),
        taskId: record.id,
        type: 'started',
        message: `Task auto-activated from automation recipe "${args.parentRef}"`,
        timestamp: now,
      }).catch(() => { /* best-effort */ });
    }

    const eventName = autoActivated ? 'task.approved' : 'task.queued';
    if (this.webhookDispatcher) {
      this.webhookDispatcher.dispatchWebhookEvent(args.agentGaii, eventName, {
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
    try { emitResourceUpdated(args.agentGaii, `aimeat://agents/${args.agentName}/tasks`); } catch { /* MCP not connected */ }
    emitChange('agent-tasks');

    return created.id;
  }

  /**
   * `workflow` kind: fire one Agent Workflow run. The schedule is just the trigger; the deterministic
   * engine owns the run loop (dispatch + two-sided signal checks + advance). `input.workflowId`
   * names the workflow; `ownerScope` is the owner GHII it belongs to.
   */
  private async executeWorkflowJob(job: ScheduledJobRecord): Promise<JobRunResult> {
    const owner = job.ownerScope;
    const workflowId = (job.input as { workflowId?: string } | undefined)?.workflowId;
    if (!owner || !workflowId) throw new Error(`workflow job "${job.id}" missing ownerScope/workflowId`);
    const engine = getActiveWorkflowEngine();
    if (!engine) return { reads: [], writes: [], skipped: true, skipReason: 'workflow engine not started' };
    const result = await engine.startRun(owner, owner.split('@')[0], workflowId, { mode: 'full-live' });
    if ('error' in result) throw new Error(`workflow run failed to start: ${result.error.join('; ')}`);
    return { reads: [], writes: [`workflows.run.${workflowId}.${result.runId}`] };
  }

  /**
   * `eco-capability` kind: invoke a connected ecosystem app's (GEAI) capability over the
   * connect-tunnel on each fire. `input` is `{ app, capability_id, input? }`; `ownerScope` is the
   * owner GHII whose binding to drive. AIMEAT authenticates the owner as caller; the ecosystem
   * enforces its OWN ACL. When the GEAI is offline at fire time the run is SKIPPED (not an error) so
   * it does not hot-loop — the next scheduled fire retries.
   */
  private async executeEcoCapabilityJob(job: ScheduledJobRecord): Promise<JobRunResult> {
    const owner = job.ownerScope;
    if (!owner) throw new Error(`eco-capability job "${job.id}" missing ownerScope`);
    const cfg = (job.input ?? {}) as { app?: string; capability_id?: string; input?: Record<string, unknown> };
    const app = cfg.app;
    const capabilityId = cfg.capability_id;
    if (!app || !capabilityId) {
      throw new Error(`eco-capability job "${job.id}" missing app/capability_id in input`);
    }

    const ownerName = parseGaiiLoose(owner).owner;
    const geai = buildGEAI(app, ownerName, this.config.nodeId);
    const caller = `${ownerName}@${this.config.nodeId}`;

    const mgr = getActiveConnectTunnelManager();
    if (!mgr) {
      // No tunnel server running — skip rather than error (nothing to invoke against).
      return { reads: [], writes: [], skipped: true, skipReason: 'connect-tunnel unavailable' };
    }

    try {
      const reply = await mgr.invokeOnPrincipal(geai, { capability: capabilityId, input: cfg.input ?? {}, caller });
      if (!reply.ok) {
        throw new Error(`Ecosystem app "${app}" refused or failed capability "${capabilityId}"`);
      }
      return { reads: [], writes: [`eco.${app}.${capabilityId}`] };
    } catch (err) {
      // The GEAI being offline at fire time is a SKIP, not an error — don't hot-loop; retry next fire.
      const code = (err as { code?: string }).code;
      if (code === 'ECOSYSTEM_OFFLINE') {
        return { reads: [], writes: [], skipped: true, skipReason: `app "${app}" offline` };
      }
      throw err;
    }
  }

  private async executeCoreJob(job: ScheduledJobRecord): Promise<void> {
    if (!job.coreHandler) {
      throw new Error(`Core job "${job.id}" has no coreHandler defined`);
    }

    const handler = this.coreHandlers.get(job.coreHandler);
    if (!handler) {
      throw new Error(`Core handler "${job.coreHandler}" not registered`);
    }

    await handler();
  }

  private async executeExtensionJob(job: ScheduledJobRecord): Promise<{ reads: string[]; writes: string[] }> {
    if (!job.extensionName || !job.actionId) {
      throw new Error(`Extension job "${job.id}" missing extensionName or actionId`);
    }

    const ext = await this.storage.getExtension(job.extensionName);
    if (!ext) {
      throw new Error(`Extension "${job.extensionName}" not found`);
    }
    if (ext.status !== 'active') {
      throw new Error(`Extension "${job.extensionName}" is not active`);
    }

    const action = ext.actions.find(a => a.id === job.actionId);
    if (!action) {
      throw new Error(`Action "${job.actionId}" not found in extension "${job.extensionName}"`);
    }

    // Build the extension context — scheduler runs as a system caller
    const extMemoryOwner = job.instanceId
      ? `ext:${ext.name}.${job.instanceId}`
      : `ext:${ext.name}`;

    const baseCtx: ExtensionCtx = {
      memory: {
        get: async (key) => {
          const record = await this.storage.getMemory(extMemoryOwner, key);
          return record ? record.value : null;
        },
        set: async (key, value) => {
          const existing = await this.storage.getMemory(extMemoryOwner, key);
          const now = new Date().toISOString();
          await this.storage.setMemory({
            key,
            ownerGaii: extMemoryOwner,
            value,
            visibility: 'public',
            tags: [],
            ttlHours: null,
            version: existing ? existing.version + 1 : 1,
            createdAt: existing ? existing.createdAt : now,
            updatedAt: now,
          });
        },
        search: async (prefix) => {
          const records = await this.storage.listMemory(extMemoryOwner, { prefix });
          return records.map(r => ({ key: r.key, value: r.value }));
        },
        delete: async (key) => this.storage.deleteMemory(extMemoryOwner, key),
        getPublic: async (namespace, key) => {
          // Try direct namespace lookup first
          let record = await this.storage.getMemory(namespace, key);
          // If not found and namespace looks like an owner name (no @ or #),
          // resolve to the owner's default agent GAII and retry
          if (!record && !namespace.includes('@') && !namespace.includes('#') && !namespace.startsWith('ext:')) {
            const agents = await this.storage.getAgentsByOwner(namespace);
            for (const agent of agents) {
              record = await this.storage.getMemory(agent.gaii, key);
              if (record) break;
            }
          }
          return (record && record.visibility === 'public') ? record.value : null;
        },
      },
      fetch: async (url, opts) => {
        const resp = await fetch(url, {
          method: opts?.method || 'GET',
          headers: opts?.headers,
          body: opts?.body,
          signal: AbortSignal.timeout(30_000),
        });
        // Always read raw bytes first so we can detect charset from multiple sources
        const buf = await resp.arrayBuffer();
        const ct = resp.headers.get('content-type') || '';
        const ctCharsetMatch = /charset=([^\s;]+)/i.exec(ct);
        let charset = ctCharsetMatch ? ctCharsetMatch[1].toLowerCase() : '';

        // If Content-Type didn't specify charset, peek at XML/HTML prolog for encoding declaration
        if (!charset) {
          const peek = new TextDecoder('ascii').decode(buf.slice(0, 512));
          const xmlMatch = /encoding=['"]([^'"]+)['"]/i.exec(peek);
          const metaMatch = /<meta[^>]+charset=["']?([^\s"';>]+)/i.exec(peek);
          charset = (xmlMatch?.[1] || metaMatch?.[1] || 'utf-8').toLowerCase();
        }

        // Guard against mislabeled encoding: if declared non-UTF-8 but bytes are valid
        // UTF-8 multibyte (e.g. Cloudflare transcoding), trust the bytes over the label
        if (charset && charset !== 'utf-8' && charset !== 'utf8') {
          const bytes = new Uint8Array(buf);
          let hasMultibyte = false;
          for (let i = 0; i < bytes.length - 1; i++) {
            if (bytes[i] >= 0xC2 && bytes[i] <= 0xDF && (bytes[i + 1] & 0xC0) === 0x80) {
              hasMultibyte = true; break;
            }
            if (bytes[i] >= 0xE0 && bytes[i] <= 0xEF && i + 2 < bytes.length &&
                (bytes[i + 1] & 0xC0) === 0x80 && (bytes[i + 2] & 0xC0) === 0x80) {
              hasMultibyte = true; break;
            }
          }
          if (hasMultibyte) charset = 'utf-8';
        }

        const decoder = new TextDecoder(charset === 'utf8' ? 'utf-8' : charset);
        const text = decoder.decode(buf);
        const headers: Record<string, string> = {};
        resp.headers.forEach((v, k) => { headers[k] = v; });
        return { status: resp.status, ok: resp.ok, text, headers };
      },
      wallet: {
        // Scheduler jobs run as system — no wallet operations
      },
      consent: {
        check: async (gaii, scope) => {
          const consents = await this.storage.listConsents(gaii, { status: 'active' });
          return consents.some(c => c.purpose === scope);
        },
        require: async (gaii, scope) => {
          const consents = await this.storage.listConsents(gaii, { status: 'active' });
          if (!consents.some(c => c.purpose === scope)) {
            throw new Error(`CONSENT_REQUIRED: ${scope}`);
          }
        },
      },
      trust: {
        getScore: async (gaii: string) => {
          const agent = await this.storage.getAgent(gaii);
          return agent?.trustScore ?? 0;
        },
      },
      caller: {
        gaii: `scheduler@${this.config.nodeId}`,
        owner: ext.installedBy,
        roles: ['operator'],
      },
      config: ext.config,
      instance: job.instanceId ? {
        id: job.instanceId,
        config: job.input ?? {},
      } : undefined,
      log: {
        info: (msg, data) => logger.info(`[ext:${ext.name}:scheduler] ${msg}`, data),
        warn: (msg, data) => logger.warn(`[ext:${ext.name}:scheduler] ${msg}`, data),
        error: (msg, data) => logger.error(`[ext:${ext.name}:scheduler] ${msg}`, data),
      },
      notify: async (message, opts) => {
        const key = `notifications.${ext.installedBy}`;
        const existing = await this.storage.getMemory(ext.installedBy, key);
        const list = Array.isArray(existing?.value) ? existing.value : [];
        list.push({
          id: randomUUID(),
          message,
          title: opts?.title || ext.name,
          priority: opts?.priority || 'normal',
          channel: opts?.channel || 'extension',
          source: ext.name,
          read: false,
          createdAt: new Date().toISOString(),
        });
        // Keep last 100 notifications
        const trimmed = list.slice(-100);
        await this.storage.setMemory({
          key, ownerGaii: ext.installedBy, value: trimmed,
          visibility: 'private', tags: ['notifications'], ttlHours: null,
          version: (existing?.version || 0) + 1,
          createdAt: existing?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        return true;
      },
      email: async (to, subject, body) => {
        if (!this.emailService?.enabled) {
          logger.warn(`[ext:${ext.name}] Email not available (SMTP not configured)`);
          return false;
        }
        // Tier 2: operator-granted unrestricted
        if (ext.config?.emailPolicy === 'unrestricted') {
          return this.emailService.sendNotification(to, subject, body);
        }
        const ownerGhii = `${ext.installedBy}@${this.config.nodeId}`;
        const ghiiRec = await this.storage.getGHII(ownerGhii);
        // Tier 0: self-only (installer's own verified email)
        if (ghiiRec?.notificationEmail === to && ghiiRec.emailVerifiedAt) {
          return this.emailService.sendNotification(to, subject, body);
        }
        // Tier 1: check consent
        const consents = await this.storage.listConsents(ownerGhii, { status: 'active' });
        if (consents.some(c => c.purpose === 'extension_email' && c.dataPattern === `ext:${ext.name}`)) {
          return this.emailService.sendNotification(to, subject, body);
        }
        logger.warn(`[ext:${ext.name}] Scheduled email blocked: no authorization for recipient`);
        return false;
      },
    };

    // Wrap with memory access tracking
    const { ctx, accessLog } = trackMemoryAccess(baseCtx);

    // Validate input is a plain object — reject non-serializable values
    const rawInput = job.input ?? {};
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(JSON.stringify(rawInput)) as Record<string, unknown>;
    } catch {
      throw new Error(`Scheduled job "${job.id}" has non-serializable input`);
    }
    await executeExtensionAction(action.scriptContent, ctx, input, ext.limits);

    return { reads: accessLog.reads, writes: accessLog.writes };
  }
}
