/**
 * @file scheduler.ts
 * @description Internal Scheduler System for AIMEAT — centralized cron-based job scheduler.
 *   Both core services and sandboxed extensions register jobs here.
 *   Supports special @activate trigger: runs on extension activation AND every server startup.
 *   Every execution creates an ExecutionLogEntry with timing, result, and memory I/O.
 * @version-history
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
import { getEncryptionKey } from './encryption.js';
import { getExtSecretKeys, getInstanceSecretKeys, decryptSecretFields } from './extension-secrets.js';
import type { EmailService } from './email.js';
import type { PushService } from './push.js';
import type { createWebhookDispatcher } from './webhook-dispatcher.js';
import { completeForOwner } from './ai-completion.js';
import { getActiveWorkflowEngine } from './workflow/engine.js';
import { getActiveConnectTunnelManager } from './connect-tunnel.js';
import { parseGaiiLoose, buildGEAI } from '../utils/gaii.js';
import { evaluateConstraints, applyAfterRun } from './schedule-constraints.js';
import { classifySecretaryActions, hasWorkToDo, ledgerSpentToday, budgetExceeded, bumpLedger, routeTickNote, deriveRoutineActions, actionItemKey, type AutonomousLedger, type RoutedAction, type RoutableContext, type RoutingCorrections, type RoutineLike, type ActionItem } from './secretary-tick.js';
import type { AgentMessageRecord } from '../storage/interface.js';
import { emitChange } from './event-bus.js';
import { emitResourceUpdated } from '../mcp/index.js';
import { logger } from '../utils/logger.js';

type WebhookDispatcher = ReturnType<typeof createWebhookDispatcher>;

/** Best-effort parse of a JSON object embedded in model output (tolerates prose/fences around it). */
function extractJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    return obj && typeof obj === 'object' ? obj as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** Shape of one Secretary context (the subset the autonomous tick reads). */
interface SecretaryContextPolicy { stopSpending?: boolean; dailyMorselBudget?: number | null; bands?: Record<string, string>; }
interface SecretaryContext {
  id: string;
  name?: string;
  brain?: { purpose?: string; rules?: Array<{ description?: string }> };
  organismId?: string | null;
  organismName?: string | null;
  workspaces?: Array<{ name?: string; purpose?: string }>;
  policy?: SecretaryContextPolicy;
  // B2/B5: Routines the Secretary runs + the follow-up action-items the tick derives (authored by the
  // view; the tick advances act-band routine steps + appends action-items). Loosely typed — see
  // RoutineLike/ActionItem in services/secretary-tick.ts and the frontend hooks for the full shape.
  routines?: RoutineLike[];
  actionItems?: ActionItem[];
}
interface SecretaryConfig {
  contexts?: SecretaryContext[];
  activeContextId?: string;
  pendingDecisions?: Record<string, unknown>;
  autonomousLedger?: AutonomousLedger;
}

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
      } else if (job.type === 'secretary') {
        run = await this.executeSecretaryJob(job);
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
   * `secretary` kind: the autonomous tick (Secretary feature Phase 4 → P1 action loop). Loads the
   * owner's `secretary.config`, picks the active context, and — unless a cost guard trips — turns the
   * context's open goals + a bounded self-organism slice into a STRUCTURED action list, routes each
   * action through the context's autonomy bands (act → file a note / append a feed entry; draft|ask →
   * post an inbox decision card; off|unsupported → drop), and appends a human-readable briefing.
   * Cost guards (in order): (1) HARD stop-spending skips all paid work; (2) SOFT per-day morsel budget
   * (P1-C) skips + notifies on trip; (3) cheap "anything to do?" pre-check (P1-B) skips the paid call
   * when there are no open goals and no due decisions. Runs server-side as the owner (no JWT needed).
   * Pure routing/guard math lives in services/secretary-tick.ts.
   */
  private async executeSecretaryJob(job: ScheduledJobRecord): Promise<JobRunResult> {
    const owner = job.ownerScope;
    if (!owner) throw new Error(`secretary job "${job.id}" missing ownerScope`);
    const cfgRec = await this.storage.getMemory(owner, 'secretary.config');
    const cfg = (cfgRec?.value ?? {}) as SecretaryConfig;
    const contexts = Array.isArray(cfg.contexts) ? cfg.contexts : [];
    const active = contexts.find((c) => c.id === cfg.activeContextId) || contexts[0];
    if (!active) {
      return { reads: ['secretary.config'], writes: [], skipped: true, skipReason: 'no secretary context configured' };
    }
    // (1) Hard cost guard: stop-spending pauses ALL paid work (the owner can re-enable it any time).
    if (active.policy?.stopSpending) {
      return { reads: ['secretary.config'], writes: [], skipped: true, skipReason: 'stop-spending is on' };
    }

    // (2) Soft cost guard (P1-C): the per-day morsel budget caps autonomous spend. One paid autonomous
    // AI operation (a decision review, or the per-tick action generation) = 1 morsel. On trip, skip the
    // paid work and notify once — degrading to no paid actions until midnight or the next day's reset.
    const today = new Date().toISOString().slice(0, 10);
    const budget = typeof active.policy?.dailyMorselBudget === 'number' ? active.policy.dailyMorselBudget : null;
    const spentToday = ledgerSpentToday(cfg.autonomousLedger, active.id, today);
    if (budget !== null && budgetExceeded(spentToday, budget)) {
      this.notifyOwner(job, 'Secretary paused for today', `daily budget reached (${spentToday}/${budget} morsels)`);
      return { reads: ['secretary.config'], writes: [], skipped: true, skipReason: `daily morsel budget reached (${spentToday}/${budget})` };
    }

    // (3) Cheap "anything to do?" pre-check (P1-B): no open goals + no due decisions → skip the paid call.
    const goalRecs = await this.storage.listMemory(owner, { prefix: 'secretary.goal.' });
    const openGoals = goalRecs
      .map((r) => (r.value ?? {}) as Record<string, unknown>)
      .filter((g) => g.status === 'open' && (!g.contextId || g.contextId === active.id));
    const decRecs = await this.storage.listMemory(owner, { prefix: 'secretary.decision.' });
    const nowMs = Date.now();
    const dueDecisions = decRecs
      .map((r) => (r.value ?? {}) as Record<string, unknown>)
      .filter((d) => d.status === 'open' && typeof d.revisitWhen === 'string' && Date.parse(d.revisitWhen as string) <= nowMs);
    // (3b) B5: band-driven routine advancement (FREE — no AI). Decide, from each active routine's next
    // step band, what the tick should auto-run (act-band file steps) vs surface as a follow-up action-item.
    const routineActions = deriveRoutineActions(active);
    const hasRoutineWork = routineActions.items.length > 0 || routineActions.runFileSteps.length > 0;
    if (!hasWorkToDo({ openGoals: openGoals.length, dueDecisions: dueDecisions.length, pendingIntake: hasRoutineWork ? 1 : 0 })) {
      return { reads: ['secretary.config', 'secretary.goal.*', 'secretary.decision.*'], writes: [], skipped: true, skipReason: 'nothing to do (no open goals, decisions due, or routine steps)' };
    }

    const ownerName = owner.split('@')[0];
    const writes: string[] = [];
    const newPending: Record<string, unknown> = {};
    // B5: routine step completions (act-band file steps the tick ran) + the action-items it derived.
    const stepCompletions: Array<{ routineId: string; stepId: string; status: string; summary: string }> = [];
    let newActionItems: ActionItem[] = [];
    let paidMorsels = 0;

    try {
      // Learning loop (Phase 5): score any decisions whose revisit time passed (each = 1 morsel).
      const reviewed = await this.reviewOpenDecisions(owner, active, job.id);
      paidMorsels += reviewed.length;
      if (reviewed.length) {
        const summary = reviewed.map((r) => `• ${r.decision} — ${r.score}/100`).join('\n');
        await this.appendFeed(owner, { kind: 'review', contextId: active.id, contextName: active.name || '', text: `Reviewed ${reviewed.length} decision(s):\n${summary}` });
        writes.push(...reviewed.map((r) => `secretary.decision.${r.id}`));
      }

      const wsList = await this.loadContextWorkspaces(owner, active);

      // B5 routine pass (FREE — no AI): auto-run each act-band file step (file a note + mark the step
      // done), and stamp the derived follow-up action-items. draft/ask/delegate steps were already turned
      // into action-items by deriveRoutineActions — the owner handles those from the dashboard.
      const nowIso = new Date().toISOString();
      for (const fs of routineActions.runFileSteps) {
        const routine = (active.routines || []).find((r) => r.id === fs.routineId);
        const step = (routine?.steps || []).find((s) => s.id === fs.stepId);
        if (!step) continue;
        const a: RoutedAction = { capability: String(step.capability), summary: String(step.summary || ''), payload: { note: String(step.summary || '') }, kind: 'note', band: 'act' };
        writes.push(...await this.performSecretaryAct(owner, active, a, wsList));
        stepCompletions.push({ routineId: fs.routineId as string, stepId: fs.stepId as string, status: 'done', summary: `Filed: ${String(step.summary || '')}`.slice(0, 200) });
      }
      newActionItems = routineActions.items.map((it) => ({
        id: 'ai-' + randomUUID().slice(0, 8), text: it.text, suggestedAction: it.suggestedAction, source: it.source, createdAt: nowIso, status: 'open' as const,
      }));

      // Action generation (P1-A): ask the model for a STRUCTURED action list tied to the open goals +
      // a bounded slice of the self-organism (the context's workspaces). 1 paid morsel.
      const { systemPrompt, prompt } = this.buildTickPrompt(ownerName, active, openGoals, wsList);
      const result = await completeForOwner(this.storage, this.config, owner, { prompt, systemPrompt, appId: `schedule:${job.id}` });
      paidMorsels += 1;

      const parsed = extractJsonObject(result.content);
      const briefingText = (parsed && typeof parsed.briefing === 'string' && parsed.briefing.trim())
        ? parsed.briefing.trim()
        : result.content; // parse failure → fall back to the raw text as the briefing (never hard-fail)

      // Route each proposed action through the context's bands and carry it out.
      const { acts, asks, dropped } = classifySecretaryActions(parsed?.actions, active.policy?.bands);
      // G1 (§22 Phase-4): no user is present, so a note-filing act must be auto-routed across ALL the
      // owner's contexts (cheap, corrections-biased) — a clear non-active match files into THAT context;
      // an ambiguous one becomes an Ask card instead of silently filing into the active context.
      const corrections = await this.loadRoutingCorrections(owner);
      for (const a of acts) {
        if (a.kind === 'note' && contexts.length > 1) {
          const noteText = String(a.payload.note ?? a.summary).trim();
          const decision = routeTickNote(noteText, contexts as RoutableContext[], active.id, corrections);
          if (decision.action === 'file-routed') {
            const target = contexts.find((c) => c.id === decision.targetContextId);
            if (target && target.organismId) {
              const targetWs = await this.loadContextWorkspaces(owner, target);
              writes.push(...await this.performSecretaryAct(owner, target, a, targetWs, active.name || active.id));
              continue;
            }
          } else if (decision.action === 'ask') {
            const card = await this.postSecretaryAskCard(owner, ownerName, active, a, wsList);
            if (card) { newPending[card.id] = card.pending; writes.push('agent-message'); }
            continue;
          }
        }
        writes.push(...await this.performSecretaryAct(owner, active, a, wsList));
      }
      for (const a of asks) {
        const card = await this.postSecretaryAskCard(owner, ownerName, active, a, wsList);
        if (card) { newPending[card.id] = card.pending; writes.push('agent-message'); }
      }

      // Always append a human-readable briefing (+ what was asked/deferred), as before.
      const deferred = [...asks.map((a) => `· asked: ${a.summary}`), ...dropped.map((a) => `· noted: ${a.summary}`)];
      const feedText = deferred.length ? `${briefingText}\n\n${deferred.join('\n')}` : briefingText;
      await this.appendFeed(owner, { kind: 'briefing', contextId: active.id, contextName: active.name || '', text: feedText });
      writes.push('secretary.feed');
    } finally {
      // Persist the spend ledger (+ any new pending decisions, routine step completions, and derived
      // action-items) even if generation threw mid-way, so the soft budget reflects what was actually
      // spent. Read-modify-write a fresh config to avoid clobber.
      if (paidMorsels > 0 || Object.keys(newPending).length || stepCompletions.length || newActionItems.length) {
        await this.persistTickState(owner, active.id, today, paidMorsels, newPending, stepCompletions, newActionItems);
        writes.push('secretary.config');
      }
    }

    if (Object.keys(newPending).length) emitChange('agent-messages');
    if (stepCompletions.length || newActionItems.length) emitChange('agent-tasks', owner);
    return { reads: ['secretary.config', 'secretary.goal.*', 'secretary.decision.*'], writes };
  }

  /** Read the active context's workspaces (id + name) from its self-organism registry. */
  private async loadContextWorkspaces(owner: string, active: SecretaryContext): Promise<Array<{ id: string; name: string }>> {
    if (!active.organismId) return [];
    const rec = await this.storage.getMemory(owner, `organism.${active.organismId}.meta.workspaces`);
    const list = ((rec?.value as { workspaces?: Array<{ id?: string; name?: string }> } | undefined)?.workspaces) ?? [];
    return list.filter((w) => w && w.id).map((w) => ({ id: w.id as string, name: w.name || (w.id as string) }));
  }

  /** Build the tick's system + user prompt asking for a STRUCTURED action list (P1-A). */
  private buildTickPrompt(
    ownerName: string, active: SecretaryContext,
    openGoals: Array<Record<string, unknown>>, wsList: Array<{ id: string; name: string }>,
  ): { systemPrompt: string; prompt: string } {
    const rules = (active.brain?.rules || []).map((r) => '- ' + (r.description || '')).join('\n');
    const systemPrompt = `You are ${ownerName}'s personal Secretary, working in the "${active.name || 'personal'}" context.\n${active.brain?.purpose || ''}\n\nOperating rules:\n${rules || '(none)'}\n\nYou are doing an autonomous check-in for the owner (they are not present). Reply in the owner's language. Return ONLY a JSON object — no prose around it.`;
    const goalLines = openGoals.length
      ? openGoals.map((g) => `- ${String(g.title || '')}${g.why ? ` (why: ${String(g.why)})` : ''}`).join('\n')
      : '(no open goals)';
    const wsNames = wsList.map((w) => w.name).join(', ') || '(none yet)';
    const prompt = `Open goals in this context:\n${goalLines}\n\nThe owner's filing space "${active.organismName || active.name}" has these workspaces: ${wsNames}.\n\nDecide what to do for the owner right now. Return a JSON object EXACTLY like:\n{\n  "briefing": "2-4 sentence check-in: what to focus on and anything needing attention",\n  "actions": [\n    { "capability": "file_intake", "summary": "short label", "payload": { "workspace": "<an existing workspace name>", "note": "the text to file" } },\n    { "capability": "reminders", "summary": "a concrete reminder for the owner", "payload": {} }\n  ]\n}\nRules for actions: propose 0-3 CONCRETE actions that move the open goals forward. Only use these capabilities: "file_intake"/"curate_knowledge" (file a note into a workspace — set payload.workspace to an existing workspace name and payload.note to the text) and "reminders"/"briefing" (surface a note to the owner — payload may be empty). Do not invent other capabilities. If nothing concrete is warranted, return an empty actions array.`;
    return { systemPrompt, prompt };
  }

  /** Best-match a workspace by (possibly fuzzy) name; falls back to the first workspace. */
  private pickWorkspace(wsList: Array<{ id: string; name: string }>, name: unknown): { id: string; name: string } | null {
    if (!wsList.length) return null;
    const want = String(name ?? '').trim().toLowerCase();
    if (want) {
      const exact = wsList.find((w) => w.name.toLowerCase() === want);
      if (exact) return exact;
      const partial = wsList.find((w) => w.name.toLowerCase().includes(want) || want.includes(w.name.toLowerCase()));
      if (partial) return partial;
    }
    return wsList[0];
  }

  /**
   * Perform an `act`-band action: file a note (note kind) or append a feed entry (feed kind). `ctx` is
   * the destination context — normally the active context, but for a G1 auto-routed note it is the
   * non-active context the note was classified into; `routedFrom` (the source/active context name) makes
   * the feed entry say it was routed there.
   */
  private async performSecretaryAct(
    owner: string, ctx: SecretaryContext, a: RoutedAction, wsList: Array<{ id: string; name: string }>,
    routedFrom?: string,
  ): Promise<string[]> {
    if (a.kind === 'note') {
      const ws = this.pickWorkspace(wsList, a.payload.workspace);
      const noteText = String(a.payload.note ?? a.summary).trim();
      if (ctx.organismId && ws && noteText) {
        const id = 'note-' + randomUUID().slice(0, 8);
        const key = `organism.${ctx.organismId}.w.${ws.id}.notes.${id}`;
        const now = new Date().toISOString();
        await this.storage.setMemory({
          key, ownerGaii: owner, value: { id, title: noteText.split('\n')[0].slice(0, 80), body: noteText, createdAt: now, via: 'secretary-tick' },
          visibility: 'private', tags: ['secretary', 'note', ctx.id], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
        });
        const text = routedFrom
          ? `Routed a note to ${ctx.name || ctx.id} → ${ws.name}: ${a.summary}`
          : `Filed a note → ${ws.name}: ${a.summary}`;
        await this.appendFeed(owner, { kind: 'act', contextId: ctx.id, contextName: ctx.name || '', text });
        return [key, 'secretary.feed'];
      }
    }
    // feed kind (or a note with no resolvable workspace): surface it in the feed as a performed action.
    await this.appendFeed(owner, { kind: 'act', contextId: ctx.id, contextName: ctx.name || '', text: a.summary });
    return ['secretary.feed'];
  }

  /** Load the owner's persisted cross-context routing corrections (G1). Empty map when none exist. */
  private async loadRoutingCorrections(owner: string): Promise<RoutingCorrections> {
    const rec = await this.storage.getMemory(owner, 'secretary.routing.corrections');
    const map = (rec?.value as { map?: Record<string, string> } | undefined)?.map;
    return (map && typeof map === 'object') ? map : {};
  }

  /**
   * Post a draft/ask-band action as an inbox decision card (reusing the Phase-3b prompt rails) and
   * return the stashed pending action keyed by promptId. Note actions reuse the existing `file-note`
   * shape (workspace options) so the Secretary view's applyDecision files them on the owner's answer;
   * other actions use a yes/no `tick-note` shape. Returns null if the Secretary agent isn't provisioned.
   */
  private async postSecretaryAskCard(
    owner: string, ownerName: string, active: SecretaryContext, a: RoutedAction, wsList: Array<{ id: string; name: string }>,
  ): Promise<{ id: string; pending: Record<string, unknown> } | null> {
    const secretaryGaii = `secretary#${ownerName}@${this.config.nodeId}`;
    const agent = await this.storage.getAgent(secretaryGaii);
    if (!agent) return null;
    const promptId = 'tick-' + randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    let question: string; let options: string[]; let pending: Record<string, unknown>;
    if (a.kind === 'note' && wsList.length >= 1 && active.organismId) {
      const noteText = String(a.payload.note ?? a.summary).trim();
      question = 'Which workspace should I file this into?';
      options = wsList.slice(0, 8).map((w) => w.name);
      pending = { type: 'file-note', body: noteText, organismId: active.organismId, question, createdAt: now };
    } else {
      question = 'Should I do this?';
      options = ['Yes, add it', 'No'];
      pending = { type: 'tick-note', text: a.summary, contextId: active.id, contextName: active.name || '', question, createdAt: now };
    }
    const record: AgentMessageRecord = {
      id: randomUUID(),
      agentGaii: secretaryGaii,
      threadId: randomUUID(),
      direction: 'outbound',
      senderGaii: owner,
      content: a.summary,
      status: 'delivered',
      metadata: { prompt: { promptId, question, options, allowOther: false } },
      createdAt: now,
    };
    await this.storage.createMessage(record);
    return { id: promptId, pending };
  }

  /**
   * Read-modify-write secretary.config to persist the day's spend ledger + any new pending decisions,
   * plus (B5) routine step completions the tick performed and the action-items it derived. Applied to a
   * FRESH read (targeted by routine/step id) to avoid clobbering concurrent view edits.
   */
  private async persistTickState(
    owner: string, contextId: string, today: string, morsels: number, newPending: Record<string, unknown>,
    stepCompletions: Array<{ routineId: string; stepId: string; status: string; summary: string }> = [],
    newActionItems: ActionItem[] = [],
  ): Promise<void> {
    const rec = await this.storage.getMemory(owner, 'secretary.config');
    const cfg = (rec?.value ?? {}) as SecretaryConfig;
    const ledger = morsels > 0 ? bumpLedger(cfg.autonomousLedger, contextId, today, morsels) : cfg.autonomousLedger;
    const pending = Object.keys(newPending).length ? { ...(cfg.pendingDecisions ?? {}), ...newPending } : cfg.pendingDecisions;
    const now = new Date().toISOString();
    // B5: apply routine step completions + merge derived action-items into the active context.
    let contexts = cfg.contexts;
    if ((stepCompletions.length || newActionItems.length) && Array.isArray(cfg.contexts)) {
      contexts = cfg.contexts.map((c) => {
        if (c.id !== contextId) return c;
        let routines: RoutineLike[] | undefined = c.routines;
        if (stepCompletions.length && Array.isArray(routines)) {
          routines = routines.map((r) => {
            const comps = stepCompletions.filter((sc) => sc.routineId === r.id);
            if (!comps.length) return r;
            const steps = (r.steps || []).map((s) => {
              const comp = comps.find((x) => x.stepId === s.id);
              return comp ? { ...s, status: comp.status, result: { summary: comp.summary, ts: now } } : s;
            });
            // B4 fix: a 'delegated' step is NOT settled (its task is still out) — the routine stays active.
            const settled = steps.every((s) => s.status !== 'pending' && s.status !== 'running' && s.status !== 'delegated');
            const results = [...comps.map((x) => ({ ts: now, summary: x.summary })), ...(r.results || [])].slice(0, 20);
            return { ...r, steps, results, lastRunAt: now, status: settled ? 'done' : r.status };
          });
        }
        let actionItems: ActionItem[] | undefined = c.actionItems;
        if (newActionItems.length) {
          const existing = Array.isArray(c.actionItems) ? c.actionItems : [];
          const seenOpen = new Set(existing.filter((a) => a.status === 'open').map((a) => actionItemKey(a)));
          const fresh = newActionItems.filter((a) => !seenOpen.has(actionItemKey(a)));
          actionItems = [...fresh, ...existing].slice(0, 50);
        }
        return { ...c, routines, actionItems };
      });
    }
    const next = { ...cfg, contexts, autonomousLedger: ledger, pendingDecisions: pending };
    await this.storage.setMemory({
      key: 'secretary.config', ownerGaii: owner, value: next, visibility: 'private', tags: ['secretary', 'config'],
      ttlHours: null, version: rec ? rec.version + 1 : 1, createdAt: rec?.createdAt ?? now, updatedAt: now,
    });
  }

  /** Append one entry to the owner's Home feed (`secretary.feed`, newest first, capped at 50). */
  private async appendFeed(owner: string, entry: { kind: string; contextId: string; contextName: string; text: string }): Promise<void> {
    const feedKey = 'secretary.feed';
    const existing = await this.storage.getMemory(owner, feedKey);
    const list = Array.isArray((existing?.value as { items?: unknown[] } | undefined)?.items)
      ? (existing!.value as { items: unknown[] }).items : [];
    const now = new Date().toISOString();
    const items = [{ id: randomUUID(), ts: now, ...entry }, ...list].slice(0, 50);
    await this.storage.setMemory({
      key: feedKey, ownerGaii: owner, value: { items }, visibility: 'private', tags: ['secretary', 'feed'],
      ttlHours: null, version: existing ? existing.version + 1 : 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
    });
  }

  /**
   * Learning-loop review sweep (Phase 5): find open decision-log contracts whose `revisitWhen` has
   * passed, ask the model (on the owner's key) to assess actual-vs-expected and score 0–100, and
   * advance open→reviewed. Bounded per tick to cap cost; a per-decision failure leaves the record open
   * with `lastError` for retry on the next sweep. See docs/specs/secretary-decision-contract.md.
   */
  private async reviewOpenDecisions(owner: string, active: { id: string; name?: string }, jobId: string): Promise<Array<{ id: string; decision: string; score: number }>> {
    const MAX_PER_TICK = 5;
    const recs = await this.storage.listMemory(owner, { prefix: 'secretary.decision.' });
    const nowMs = Date.now();
    const due = recs
      .map((r) => ({ rec: r, d: (r.value ?? {}) as Record<string, unknown> }))
      .filter(({ d }) => d.status === 'open' && typeof d.revisitWhen === 'string' && Date.parse(d.revisitWhen as string) <= nowMs)
      .slice(0, MAX_PER_TICK);

    const done: Array<{ id: string; decision: string; score: number }> = [];
    for (const { rec, d } of due) {
      const decision = String(d.decision || '');
      const systemPrompt = `You are reviewing a past decision for quality, on behalf of the owner. Be honest and concise; reply in the owner's language. Return ONLY a JSON object: {"actualOutcome": string, "score": number (0-100, 100=excellent), "verdict": string (one line)}.`;
      const prompt = `Decision: ${decision}\nChosen: ${String(d.chosen || '')}\nRationale: ${String(d.rationale || '')}\nExpected outcome: ${String(d.expectedOutcome || '')}\nLogged at: ${String(d.createdAt || '')}\n\nAssess how it actually turned out versus what was expected and score the decision's quality. If you lack information, say so in actualOutcome and give a tentative score.`;
      const now = new Date().toISOString();
      try {
        const out = await completeForOwner(this.storage, this.config, owner, { prompt, systemPrompt, appId: `schedule:${jobId}:review` });
        const parsed = extractJsonObject(out.content);
        const score = Math.max(0, Math.min(100, Math.round(Number(parsed?.score ?? 0)) || 0));
        const updated = { ...d, status: 'reviewed', actualOutcome: String(parsed?.actualOutcome ?? out.content).slice(0, 2000), score, verdict: String(parsed?.verdict ?? '').slice(0, 300), reviewedAt: now, attempts: Number(d.attempts ?? 0) + 1, lastError: null };
        await this.storage.setMemory({
          key: rec.key, ownerGaii: owner, value: updated, visibility: 'private', tags: ['secretary', 'decision', 'reviewed', active.id],
          ttlHours: null, version: rec.version + 1, createdAt: rec.createdAt, updatedAt: now,
        });
        done.push({ id: String(d.id || rec.key), decision, score });
      } catch (err) {
        const updated = { ...d, attempts: Number(d.attempts ?? 0) + 1, lastError: (err as Error).message };
        await this.storage.setMemory({
          key: rec.key, ownerGaii: owner, value: updated, visibility: 'private', tags: ['secretary', 'decision', 'open', active.id],
          ttlHours: null, version: rec.version + 1, createdAt: rec.createdAt, updatedAt: now,
        });
      }
    }
    return done;
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

    // For an instance-scoped job, load the instance and decrypt its secret config so a scheduled
    // sync gets the same bring-your-own-key config a live instance action would. `type: 'secret'`
    // fields are decrypted just before the VM (see services/extension-secrets.ts).
    const encKey = getEncryptionKey(this.config);
    let instanceCtx: { id: string; config: Record<string, unknown> } | undefined;
    if (job.instanceId) {
      const inst = await this.storage.getExtensionInstance(ext.name, job.instanceId);
      instanceCtx = {
        id: job.instanceId,
        config: inst
          ? decryptSecretFields(inst.config, getInstanceSecretKeys(ext), encKey)
          : (job.input ?? {}),
      };
    }

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
      config: decryptSecretFields(ext.config, getExtSecretKeys(ext), encKey),
      instance: instanceCtx,
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
