/**
 * @file scheduler.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Internal Scheduler System for AIMEAT — centralized cron-based job scheduler.
 *   Both core services and sandboxed extensions register jobs here.
 *   Supports special @activate trigger: runs on extension activation AND every server startup.
 *   Every execution creates an ExecutionLogEntry with timing, result, and memory I/O.
 * @version-history
 *   v2.13.1 — 2026-07-03 — Execution log line shows the human-readable job label (displayName when set,
 *     falling back to name) plus the job type, instead of only the machine name `schedule:<id>`.
 *   v2.13.0 — 2026-07-01 — Light-vs-heavy seam: the tick no longer cheap-authors content (the one-shot
 *     authoring in the now-removed secretary-authoring.ts hallucinated). It now detects STRUCTURAL gaps
 *     (empty/thin workspaces, stale content, off-target KPIs) and proposes grounded Work Briefs a Builder
 *     (a connected big AI via the appdev MCP tools) executes — proposeWorkBriefs in services/
 *     secretary-workbrief.ts (deterministic, no paid call, deduped against open briefs). The cheap
 *     Secretary watches + hands off; it never authors structure/data.
 *   v2.12.0 — 2026-06-30 — Learning loop closes: (A) selectLessons threads the highest-signal reviewed-
 *     decision scores into the tick's briefing/action prompt (repeat what worked, avoid what didn't);
 *     (B) proposeLearnedRule — when a cluster of reviewed decisions scored poorly, the tick asks for ONE
 *     durable operating rule and posts it as a GATED inbox card (brain-rule) the owner approves; never
 *     auto-applied. Source decisions flagged proposalUsed so a cluster doesn't re-propose.
 *   v2.11.0 — 2026-06-30 — Secretary autonomous authoring: a band-gated phase (`author_content`) fills
 *     the active context's EMPTY workspaces — document spaces first, then records — toward the focus
 *     milestone (services/secretary-authoring.ts). act → write + publish · draft/ask → leave drafts ·
 *     off (default) → skip. Metered per workspace, capped by the same per-day morsel budget.
 *   v2.10.0 — 2026-06-28 — Secretary Strategy: the tick reads the active context's optional `strategy`
 *     (current → target + principles/risks + ordered milestones) and steers the briefing toward the
 *     current focus milestone (first not-yet-reached), respecting the principles + flagging risks.
 *   v2.9.0 — 2026-06-28 — Secretary bound triggers: a fired trigger can carry out a BOUND action —
 *     start an Agent Workflow run, or queue + run a specialist task (its prompt) node-side this tick —
 *     instead of only posting a reminder (fireBoundTriggerAction). Gated by the existing spend guards.
 *   v2.8.0 — 2026-06-24 — Secretary P5 (S-C): scheduled extension jobs decrypt `type: secret` config
 *     before the sandbox VM, and an instance-scoped job loads the instance's (decrypted) config so a
 *     cron sync uses the same bring-your-own-key secret a live action would. See extension-secrets.ts.
 *   v2.7.0 — 2026-06-24 — Secretary P1: the `secretary` tick is now a real action loop. Each working
 *     fire runs a cheap "anything to do?" pre-check (skips the paid call when there are no open goals /
 *     due decisions), enforces the soft per-day `dailyMorselBudget` (skip + notify on trip), loads the
 *     active context's open goals + a bounded self-organism slice, asks the model for a STRUCTURED action
 *     list, and routes each action through the context's autonomy bands (act → file a note / append a
 *     feed entry; draft|ask → post an inbox decision card; off|unsupported → drop). Pure routing/guard
 *     math lives in services/secretary-tick.ts. The hard stop-spending guard + review sweep are unchanged.
 *   v2.6.0 — 2026-06-24 — Secretary Phase 5 (learning loop): the `secretary` tick now runs a decision
 *     review sweep (reviewOpenDecisions) before the briefing — scores open decision-log contracts whose
 *     revisitWhen has passed (actual-vs-expected, 0–100) and advances open→reviewed; cost-guarded by
 *     stop-spending. Feed-append extracted to appendFeed().
 *   v2.5.0 — 2026-06-24 — Add the `secretary` kind: the Secretary's autonomous tick (Phase 4) — runs
 *     the active context's brain on the owner's key and appends a briefing to `secretary.feed`;
 *     stop-spending skips the paid call.
 *   v2.5.1 — 2026-06-29 — Secretary tick: pre-flight AI-availability guard — when the owner has no usable
 *     AI key, skip the tick gracefully (like stop-spending/budget) instead of erroring every run once the
 *     "daily check-in always briefs" change removed the idle early-out.
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
import type { EmailService } from './email.js';
import type { PushService } from './push.js';
import type { createWebhookDispatcher } from './webhook-dispatcher.js';
import { evaluateConstraints, applyAfterRun } from './schedule-constraints.js';
import { emitChange } from './event-bus.js';
import { emitResourceUpdated } from '../mcp/index.js';
import { logger } from '../utils/logger.js';
import { runExtensionJob } from './scheduler-extension-job.js';
import { runAiJob, runWorkflowJob, runEcoCapabilityJob } from './scheduler-remote-jobs.js';

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
export interface JobRunResult {
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

  // Boot-memory trace 2026-08-17: a cron tick launched 13 jobs in the same second, several of
  // them extension jobs that each open a QuickJS WASM sandbox (external memory spiked to
  // ~570 MB), and the concurrent peak becomes the process's permanent RSS floor via the native
  // allocator. Extension jobs now take one of two slots and queue behind them; core jobs are
  // cheap reads and stay unthrottled. The slot holder chain is the queue, so order is FIFO.
  private static readonly EXT_JOB_SLOTS = 2;
  private extJobsRunning = 0;
  private extJobWaiters: Array<() => void> = [];

  private async acquireExtSlot(): Promise<void> {
    if (this.extJobsRunning < Scheduler.EXT_JOB_SLOTS) { this.extJobsRunning++; return; }
    await new Promise<void>(resolve => this.extJobWaiters.push(resolve));
    this.extJobsRunning++;
  }

  private releaseExtSlot(): void {
    this.extJobsRunning--;
    const next = this.extJobWaiters.shift();
    if (next) next();
  }

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

    const isExtension = job.type === 'extension';
    if (isExtension) await this.acquireExtSlot();

    this.executing.add(job.id);
    const startTime = Date.now();
    // Boot-memory trace 2026-08-17 round 3: the boot flood survived the cron gate, so every
    // job now reports its own RSS delta — the completion line names the eaters directly.
    const rssBeforeMb = Math.round(process.memoryUsage.rss() / 1048576);
    logger.info(`Scheduler executing job: ${job.id} (${job.displayName || job.name}) [${job.type}/${trigger}]`);

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
      } else if (job.type === 'connections-publish') {
        run = await this.executeConnectionsPublishJob(job);
      } else {
        // A kind with no branch used to fall through here and be recorded as a SUCCESSFUL run that
        // did nothing — a scheduled post that never leaves and a green run log saying it did. Caught
        // by the LÄHETIN e2e when a new kind's dispatch was missed; failing loudly is the only way
        // the next added kind cannot repeat it.
        throw new Error(`scheduler has no executor for job type "${job.type}"`);
      }
    } catch (err) {
      result = 'error';
      errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this.executing.delete(job.id);
      if (isExtension) this.releaseExtSlot();
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
      } catch (err) { logger.warn('error: non-fatal', { error: String(err) }); }
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
    }).catch(err => { logger.warn('error: dont let update failure mask original error', { error: String(err) }); });

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
      logger.error(`Scheduler job failed: ${job.id} (${job.displayName || job.name})`, { error: errorMessage, durationMs, trigger });
      this.notifyOwner(job, 'Schedule failed', errorMessage ?? 'Unknown error');
      return { code: 'error', detail: errorMessage };
    }

    const rssAfterMb = Math.round(process.memoryUsage.rss() / 1048576);
    logger.info(`Scheduler job completed: ${job.id} (${job.displayName || job.name}, ${durationMs}ms) [${trigger}]`, {
      memoryReads: run.reads.length,
      memoryWrites: run.writes.length,
      rssMb: rssAfterMb,
      rssDeltaMb: rssAfterMb - rssBeforeMb,
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
    await this.storage.updateScheduledJob(job.id, { enabled: false, updatedAt: new Date().toISOString() }).catch(err => { logger.warn('error: continuing after a suppressed failure', { error: String(err) }); });
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
    }).catch(err => { logger.warn('error: push best-effort', { error: String(err) }); });
  }

  /**
   * `ai` kind: gather predefined input memory keys, compose the prompt, run a
   * server-side completion on the owner's OpenRouter key, and store the result
   * to the owner's output key. Zero agent involvement; runs even when offline.
   */
  private async executeAiJob(job: ScheduledJobRecord): Promise<JobRunResult> {
    return runAiJob(this.storage, this.config, job);
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
    try { emitResourceUpdated(agentGaii, `aimeat://agents/${agentName}/tasks`); } catch (err) { logger.warn('cfg: MCP not connected', { error: String(err) }); }
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
      }).catch(err => { logger.warn('cfg: best-effort', { error: String(err) }); });
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
    try { emitResourceUpdated(args.agentGaii, `aimeat://agents/${args.agentName}/tasks`); } catch (err) { logger.warn('cfg: MCP not connected', { error: String(err) }); }
    emitChange('agent-tasks');

    return created.id;
  }

  /**
   * `workflow` kind: fire one Agent Workflow run. The schedule is just the trigger; the deterministic
   * engine owns the run loop (dispatch + two-sided signal checks + advance). `input.workflowId`
   * names the workflow; `ownerScope` is the owner GHII it belongs to.
   */
  private async executeWorkflowJob(job: ScheduledJobRecord): Promise<JobRunResult> {
    return runWorkflowJob(job);
  }

  /**
   * `eco-capability` kind: invoke a connected ecosystem app's (GEAI) capability over the
   * connect-tunnel on each fire. `input` is `{ app, capability_id, input? }`; `ownerScope` is the
   * owner GHII whose binding to drive. AIMEAT authenticates the owner as caller; the ecosystem
   * enforces its OWN ACL. When the GEAI is offline at fire time the run is SKIPPED (not an error) so
   * it does not hot-loop — the next scheduled fire retries.
   */
  private async executeEcoCapabilityJob(job: ScheduledJobRecord): Promise<JobRunResult> {
    return runEcoCapabilityJob(this.config, job);
  }

  /**
   * `connections-publish` kind: post to one of the owner's own connected accounts.
   *
   * The clock, the one-shot (max_runs), the DST-correct IANA timezone and the run log all come from
   * THIS scheduler — the kind adds only "what to publish". The publish itself takes the same
   * idempotency-gated path a person pressing send takes, so a schedule racing an impatient human
   * produces one post rather than two.
   */
  private async executeConnectionsPublishJob(job: ScheduledJobRecord): Promise<JobRunResult> {
    const { runConnectionsPublishJob } = await import('./connections/scheduled-publish-job.js');
    return runConnectionsPublishJob(this.storage, this.config, job);
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
    return runExtensionJob(this.storage, this.config, this.emailService, job);
  }
}
