/**
 * @file engine.ts
 * @description The Agent Workflows engine — the deterministic, node-owned run loop. A workflow run
 *   is an ASYNC persisted state machine (NOT a synchronous loop): the node dispatches an agent_task
 *   and parks; the run advances when that task reaches a terminal state (the agent-tasks route calls
 *   onTaskTerminal) or when a step times out (the watchdog sweep). State + recovery live in the run
 *   record in owner memory, so a restart resumes in-flight runs. Per-step input/output signals are
 *   evaluated deterministically (signal-eval.ts); the `llm` leaf uses the node OpenRouter only when
 *   the workflow's owner has approved it AND a key is configured. Run-fail policy = PARTIAL: a RED
 *   step fails its dependent subtree, independent branches finish, the run ends `partial`. See
 *   docs/plans/2026-06-13-agent-workflows-node-plan.md §4.
 * @structure
 *   - WorkflowEngine — startRun / onTaskTerminal / sweep / resumeInflight / start / stop
 *   - setActiveWorkflowEngine / getActiveWorkflowEngine — process-wide handle (so the task route +
 *     scheduler reach the live engine without threading it through every signature)
 *   - computeReadySteps / runOutcome — pure decision helpers (exported for tests)
 * @usage
 *   const engine = new WorkflowEngine(config, storage);
 *   setActiveWorkflowEngine(engine); engine.setWebhookDispatcher(d); await engine.start();
 * @version-history
 *   v1.0.0 — 2026-06-13 — Phase 4: state machine (signals-only + full-live), dispatch, task-terminal
 *     advance, notBefore-backoff retry + timeout via the watchdog sweep, restart recovery.
 *   v1.1.0 — 2026-06-15 — Finish notification: terminal full-live runs of a notify_on_finish workflow
 *     drop an in-app + (when configured) email notification with outcome + per-step log, once.
 *   v1.2.0 — 2026-07-05 — Resume-on-retry / re-evaluate-against-reality. The watchdog now RE-CHECKS a
 *     dispatched step's success_signal against current memory before failing it (a slow step whose
 *     leaves finished late recovers to green instead of timing out), tracks fill progress, and only
 *     times out after timeout_min of NO progress (slide, don't restart-and-skip). Under the opt-in
 *     WorkflowDef.resume, a downstream step gates on its own required_to_function (via
 *     computeReadySteps + failDownstream) rather than parent success. Terminal paths trust the signal
 *     over the crew's self-report (output present ⇒ green even if the task reported failed).
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentTaskRecord, AgentTaskScope } from '../../storage/interface.js';
import type { createWebhookDispatcher } from '../webhook-dispatcher.js';
import type { PushService } from '../push.js';
import type { EmailService } from '../email.js';
import { buildGAII } from '../../utils/gaii.js';
import { emitChange } from '../event-bus.js';
import { notify } from '../notify.js';
import { logger } from '../../utils/logger.js';
import { evaluateSignal, extractProgress, globToRegExp, type SignalEvalCtx } from './signal-eval.js';
import { buildEvalCtx } from './eval-context.js';
import { getWorkflow, validateWorkflow, runKey, type ResolvedStep } from './store.js';
import { readEventTriggers, readEcosystemEventTriggers, readActiveRuns, reconcileActiveRun } from './lifecycle.js';
import { getActiveConnectTunnelManager } from '../connect-tunnel.js';
import type {
  WorkflowDef, WorkflowRun, WorkflowRunStep, WorkflowStep, Signal, LocalizedString,
} from '../../models/workflow-schemas.js';

type WebhookDispatcher = ReturnType<typeof createWebhookDispatcher>;

let _active: WorkflowEngine | null = null;
export function setActiveWorkflowEngine(e: WorkflowEngine): void { _active = e; }
export function getActiveWorkflowEngine(): WorkflowEngine | null { return _active; }

/** Pick a display string from a localized value (prefers en_US, else fi_FI, else first). */
function loc(s: LocalizedString | undefined): string {
  if (!s) return '';
  if (typeof s === 'string') return s;
  return s.en_US ?? s.fi_FI ?? Object.values(s)[0] ?? '';
}

const TERMINAL_STEP_STATES = new Set<WorkflowRunStep['state']>(['green', 'input-red', 'output-red', 'timed-out', 'skipped']);

/**
 * The steps that may start now: pending, past any retry backoff, and their `after` deps satisfied.
 * "Satisfied" depends on the workflow's resume policy:
 *   - default: every `after` dep must be GREEN (a failed dep blocks the subtree — restart-and-skip).
 *   - resume:  every `after` dep must be TERMINAL (green OR failed) — `after` is ordering only; the
 *     step's OWN required_to_function (evaluated in tick) becomes the real gate, so a dependent whose
 *     input is present runs even when a parent timed out / went red.
 * Pure — operates on the def + the current run-step map.
 */
export function computeReadySteps(def: WorkflowDef, steps: Record<string, WorkflowRunStep>, now: string): WorkflowStep[] {
  const resume = def.resume === true;
  return def.steps.filter(s => {
    const rs = steps[s.id];
    if (!rs || rs.state !== 'pending') return false;
    if (rs.notBefore && rs.notBefore > now) return false;
    return (s.after ?? []).every(dep => {
      const st = steps[dep]?.state;
      return resume ? !!st && TERMINAL_STEP_STATES.has(st) : st === 'green';
    });
  });
}

/** The terminal run status given the step states: done if all green, else partial; running otherwise. */
export function runOutcome(steps: Record<string, WorkflowRunStep>): 'done' | 'partial' | 'running' {
  const all = Object.values(steps);
  if (all.some(s => !TERMINAL_STEP_STATES.has(s.state))) return 'running';
  return all.every(s => s.state === 'green') ? 'done' : 'partial';
}

export interface StartRunOpts {
  // full-sandbox dispatches like full-live but namespaces every key under `wf-test.<runId>.` so a
  // test run never clobbers production keys (the dispatched step is told the prefix so a cooperating
  // agent writes there; signal eval reads/writes under it).
  mode: 'signals-only' | 'full-live' | 'full-sandbox';
  vars?: Record<string, string>;
}

export class WorkflowEngine {
  private config: AimeatConfig;
  private storage: Storage;
  private webhookDispatcher?: WebhookDispatcher;
  private pushService?: PushService;
  private emailService?: EmailService;
  /** Per-run serialization: advancing the same run from two task completions is a RMW race. */
  private locks = new Map<string, Promise<void>>();
  private sweepTimer?: ReturnType<typeof setInterval>;

  constructor(config: AimeatConfig, storage: Storage) {
    this.config = config;
    this.storage = storage;
  }

  setWebhookDispatcher(d: WebhookDispatcher): void { this.webhookDispatcher = d; }
  setPushService(p: PushService): void { this.pushService = p; }
  setEmailService(e: EmailService): void { this.emailService = e; }

  /** Start the watchdog (timeouts + due retries). Idempotent; the timer is unref'd. */
  async start(): Promise<void> {
    await this.resumeInflight();
    if (!this.sweepTimer) {
      this.sweepTimer = setInterval(() => { this.sweep().catch(err => logger.error('workflow sweep failed', { error: String(err) })); }, 60_000);
      this.sweepTimer.unref?.();
    }
  }

  stop(): void { if (this.sweepTimer) { clearInterval(this.sweepTimer); this.sweepTimer = undefined; } }

  /** Run a single run's mutation under its lock (serializes concurrent advances). */
  private async withLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(runId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    this.locks.set(runId, prev.then(() => gate));
    await prev;
    try { return await fn(); }
    finally { release(); if (this.locks.get(runId) === prev.then(() => gate)) this.locks.delete(runId); }
  }

  // ── start a run ──────────────────────────────────────────────────────────────
  async startRun(ownerGhii: string, ownerName: string, workflowId: string, opts: StartRunOpts): Promise<{ runId: string } | { error: string[] }> {
    const def = await getWorkflow(this.storage, ownerGhii, workflowId);
    if (!def) return { error: [`workflow "${workflowId}" not found`] };

    const v = await validateWorkflow(this.storage, this.config, ownerName, def);
    if (!v.ok || !v.resolved) return { error: v.errors };

    // Overlap guard: a full run that dispatches agents must not run twice at once (the steps share
    // templated keys). If one is already in flight for this workflow, return it instead of starting a
    // second. signals-only is read-only, so it always runs fresh.
    if (opts.mode === 'full-live') {
      const active = await readActiveRuns(this.storage, this.config.nodeId);
      const inFlight = active.find(a => a.workflowId === workflowId && a.ownerGhii === ownerGhii);
      if (inFlight) {
        logger.info(`workflow "${workflowId}": a run is already in flight (${inFlight.runId}); skipping this start`);
        return { runId: inFlight.runId };
      }
    }

    const runId = randomUUID();
    const vars = this.resolveVars(def, opts.vars);
    const now = new Date().toISOString();
    const steps: Record<string, WorkflowRunStep> = {};
    for (const s of def.steps) steps[s.id] = { state: 'pending', attempt: 0, reads: [], writes: [] };

    const run: WorkflowRun = {
      runId, workflowId, defSnapshot: def, resolved: v.resolved, vars,
      mode: opts.mode, keyPrefix: opts.mode === 'full-sandbox' ? `wf-test.${runId}.` : '',
      status: 'running', steps, startedAt: now,
    };

    if (opts.mode === 'signals-only') {
      await this.runSignalsOnly(ownerGhii, run);
    } else {
      await this.persist(ownerGhii, run);
      // Under the run lock: an ecosystem action step's async reply (onPushTerminal, which also locks)
      // must not advance the run before this initial tick has persisted the 'dispatched' state.
      await this.withLock(runId, () => this.tick(ownerGhii, run));
    }
    return { runId };
  }

  /** The pinned per-step resolved signals (from start time) as a lookup. No mid-run re-resolution. */
  private resolvedMap(run: WorkflowRun): Map<string, ResolvedStep> {
    return new Map((run.resolved ?? []).map(r => [r.stepId, r as ResolvedStep]));
  }

  /** signals-only: evaluate every step's input + output against existing memory; no dispatch. */
  private async runSignalsOnly(ownerGhii: string, run: WorkflowRun): Promise<void> {
    const resolved = this.resolvedMap(run);
    const ctx = buildEvalCtx(this.storage, this.config, ownerGhii, run);
    for (const step of run.defSnapshot.steps) {
      const r = resolved.get(step.id);
      const rs = run.steps[step.id];
      const reads = new Set<string>();
      // input
      const input = await this.evalSignal(r?.required_to_function, ctx, reads);
      if (!input.ok) { rs.state = 'input-red'; rs.inputObserved = input.observed; rs.reads = [...reads]; continue; }
      // output
      const output = await this.evalSignal(r?.success_signal, ctx, reads);
      rs.outputObserved = output.observed;
      rs.reads = [...reads];
      rs.state = output.ok ? 'green' : 'output-red';
    }
    run.status = runOutcome(run.steps);
    run.endedAt = new Date().toISOString();
    await this.persist(ownerGhii, run);
    emitChange('workflows');
  }

  // ── the advance loop (full-live) ──────────────────────────────────────────────
  private async tick(ownerGhii: string, run: WorkflowRun): Promise<void> {
    const resolved = this.resolvedMap(run);
    const now = new Date().toISOString();
    const ctx = buildEvalCtx(this.storage, this.config, ownerGhii, run);
    let dispatchedAny = false;

    for (const step of computeReadySteps(run.defSnapshot, run.steps, now)) {
      const r = resolved.get(step.id);
      const rs = run.steps[step.id];
      const reads = new Set<string>();
      const input = await this.evalSignal(r?.required_to_function, ctx, reads);
      rs.reads = [...reads];
      if (!input.ok) {
        rs.state = 'input-red'; rs.inputObserved = input.observed; rs.endedAt = now;
        this.failDownstream(run, step.id);
        await this.onStepFail(ownerGhii, run, step.id, 'input-red');
        continue;
      }
      // dispatch
      const taskIds = await this.dispatchStep(ownerGhii, run, step, r);
      rs.state = 'dispatched'; rs.taskIds = taskIds; rs.startedAt = now; rs.notBefore = undefined;
      dispatchedAny = true;
    }

    const outcome = runOutcome(run.steps);
    if (outcome !== 'running') {
      run.status = outcome; run.endedAt = new Date().toISOString();
    } else {
      run.status = Object.values(run.steps).some(s => s.state === 'dispatched') ? 'waiting-step' : 'running';
    }
    await this.persist(ownerGhii, run);
    if (dispatchedAny || outcome !== 'running') emitChange('workflows');
  }

  // ── task terminal → advance ────────────────────────────────────────────────────
  async onTaskTerminal(task: AgentTaskRecord, outcome: 'done' | 'failed'): Promise<void> {
    const scope = task.scope?.find(s => s.name === 'workflow-run');
    if (!scope?.value) return;
    const [workflowId, runId] = scope.value.split('/');
    const stepId = scope.description;
    if (!workflowId || !runId || !stepId) return;
    const ownerGhii = task.ownerGaii;

    await this.withLock(runId, async () => {
      const rec = await this.storage.getMemory(ownerGhii, runKey(workflowId, runId));
      if (!rec) return;
      const run = rec.value as WorkflowRun;
      const rs = run.steps[stepId];
      if (!rs || rs.state !== 'dispatched') return; // already resolved / not awaiting

      // Wait until every task of this step is terminal (a step may fan out to several agents).
      for (const tid of rs.taskIds ?? []) {
        const t = await this.storage.getAgentTask(tid);
        if (t && t.status !== 'done' && t.status !== 'failed') return; // still in flight
      }

      // Use the signals PINNED at start time (not current offers) — a mid-run offer edit/delete must
      // not silently turn this output check into a false pass.
      const r = this.resolvedMap(run).get(stepId);
      const ctx = buildEvalCtx(this.storage, this.config, ownerGhii, run);
      const reads = new Set<string>(rs.reads);

      const output = await this.evalSignal(r?.success_signal, ctx, reads);
      const now = new Date().toISOString();
      rs.outputObserved = output.observed;
      rs.reads = [...reads];
      this.recordProgress(rs, output.observed);
      if (r?.deliverableKey) rs.writes = [...new Set([...rs.writes, this.template(r.deliverableKey, run.vars)])];

      const stepDef = run.defSnapshot.steps.find(s => s.id === stepId)!;
      if (output.ok) {
        // Reality check wins: if the leaves are present, the step is green even when the crew task
        // reported `failed` — a slow/partial crew that ultimately filled the keys still produced.
        rs.state = 'green'; rs.endedAt = now;
      } else if (stepDef.retry && rs.attempt < stepDef.retry.max) {
        // Deterministic retry with backoff: back to pending, gated by notBefore; the sweep re-ticks.
        // Idempotent crew stages make the re-dispatch a gap-fill (only absent keys get written).
        rs.attempt += 1; rs.state = 'pending'; rs.taskIds = undefined;
        rs.notBefore = new Date(Date.now() + stepDef.retry.backoff_min * 60_000).toISOString();
      } else {
        rs.state = 'output-red'; rs.endedAt = now;
        this.failDownstream(run, stepId);
        await this.onStepFail(ownerGhii, run, stepId, 'output-red');
      }

      await this.tick(ownerGhii, run);
    });
  }

  // ── watchdog: timeouts + due retries ─────────────────────────────────────────────
  async sweep(): Promise<void> {
    for (const e of await readActiveRuns(this.storage, this.config.nodeId)) {
      const rec = await this.storage.getMemory(e.ownerGhii, runKey(e.workflowId, e.runId));
      if (!rec) { continue; }
      await this.sweepRun(e.ownerGhii, rec.value as WorkflowRun);
    }
  }

  private async sweepRun(ownerGhii: string, run: WorkflowRun): Promise<void> {
    await this.withLock(run.runId, async () => {
      const fresh = await this.storage.getMemory(ownerGhii, runKey(run.workflowId, run.runId));
      if (!fresh) return;
      const r = fresh.value as WorkflowRun;
      if (r.status !== 'running' && r.status !== 'waiting-step') return;
      const now = Date.now();
      const nowIso = new Date().toISOString();
      const resolved = this.resolvedMap(r);
      const ctx = buildEvalCtx(this.storage, this.config, ownerGhii, r);
      let changed = false;

      for (const step of r.defSnapshot.steps) {
        const rs = r.steps[step.id];
        if (rs.state !== 'dispatched' || !rs.startedAt) continue;

        // Re-evaluate the success signal against CURRENT memory. The task-runner crew runs on its own
        // clock and does not abort when we stop waiting — a merely-slow step may have filled its
        // leaves after we parked. Re-check-before-failing recovers it instead of discarding the work.
        const rdef = resolved.get(step.id);
        const reads = new Set<string>(rs.reads);
        const output = await this.evalSignal(rdef?.success_signal, ctx, reads);
        rs.reads = [...reads];

        // Track fill progress (count_nonempty leaves). A rising count = the crew is still filling
        // keys (in-progress); a flat count = stuck.
        const increased = this.recordProgress(rs, output.observed);
        if (increased) changed = true;

        if (output.ok) {
          // Recovered: the deliverable is present. Green retroactively; tick un-blocks dependents so a
          // slow edition's downstream (features/editorial) runs instead of being skipped.
          rs.state = 'green'; rs.endedAt = nowIso; rs.outputObserved = output.observed;
          if (rdef?.deliverableKey) rs.writes = [...new Set([...rs.writes, this.template(rdef.deliverableKey, r.vars)])];
          changed = true;
          continue;
        }
        rs.outputObserved = output.observed;

        // Not satisfied yet — slow (still progressing) vs stuck (no new keys for timeout_min). The
        // no-progress deadline slides to lastProgressAt + timeout_min; a step that never progressed
        // anchors at startedAt, so it times out exactly as before.
        const anchorIso = rs.progress?.lastProgressAt ?? rs.startedAt;
        const stallDeadline = new Date(anchorIso).getTime() + (step.timeout_min ?? 60) * 60_000;
        if (now < stallDeadline) continue; // still within the wait window — keep waiting.

        // Stalled past timeout_min with no new keys → the existing retry-or-timed-out policy.
        if (step.retry && rs.attempt < step.retry.max) {
          // Re-dispatch; idempotent crew stages make this a gap-fill (only absent keys get written).
          rs.attempt += 1; rs.state = 'pending'; rs.taskIds = undefined;
          rs.notBefore = new Date(now + step.retry.backoff_min * 60_000).toISOString();
        } else {
          rs.state = 'timed-out'; rs.endedAt = nowIso;
          this.failDownstream(r, step.id);
          await this.onStepFail(ownerGhii, r, step.id, 'timed-out');
        }
        changed = true;
      }
      // re-tick (fires any now-due pending retries + dispatches steps un-blocked by a recovery),
      // using the run's pinned resolved signals.
      if (changed) await this.persist(ownerGhii, r);
      await this.tick(ownerGhii, r);
    });
  }

  // ── event triggers (Phase 8) ──────────────────────────────────────────────────
  // The descriptor's `trigger.kind:'event'` is registered in a system-namespace index
  // (lifecycle.ts). These hooks are called from the write/order sites; a match starts a run.
  // Loop guard: skip if the workflow already has an in-flight run (so a workflow that produces a
  // key it also listens on doesn't re-trigger itself).

  async onMemoryWrite(ownerGhii: string, key: string): Promise<void> {
    await this.fireEventTriggers('memory.write', ownerGhii, t => {
      const pat = t.match.key;
      return !!pat && globToRegExp(pat).test(key);
    });
  }

  async onOfferOrdered(ownerGhii: string, offerId: string): Promise<void> {
    await this.fireEventTriggers('offer.ordered', ownerGhii, t => {
      const pat = t.match.offer;
      return !!pat && globToRegExp(pat).test(offerId);
    });
  }

  /**
   * Inbound ecosystem event (a GEAI emitted `on` for `app`). Fires every `ecosystem.event` trigger
   * the owner authored that matches {app, on}, whose pinned MAJOR `version` equals the incoming
   * event's major (fail-safe: a major mismatch does NOT fire), and whose optional `match` globs pass
   * against the event payload. Same owner-scoped loop guard as the other event triggers.
   */
  async onEcosystemEvent(app: string, on: string, version: number, ownerGhii: string, data: Record<string, unknown>): Promise<void> {
    let triggers;
    try { triggers = await readEcosystemEventTriggers(this.storage, this.config.nodeId); }
    catch (err) { logger.error('readEcosystemEventTriggers failed', { app, on, error: String(err) }); return; }
    const hits = triggers.filter(t =>
      t.ownerGhii === ownerGhii && t.app === app && t.on === on &&
      t.version === version &&                                   // fail-safe: skip on major mismatch
      this.ecoMatchPasses(t.match, data));
    if (hits.length === 0) return;
    const active = await readActiveRuns(this.storage, this.config.nodeId);
    for (const t of hits) {
      if (active.some(a => a.workflowId === t.workflowId && a.ownerGhii === t.ownerGhii)) continue; // loop/overlap guard
      this.startRun(ownerGhii, ownerGhii.split('@')[0], t.workflowId, { mode: 'full-live' })
        .catch(err => logger.error('ecosystem-event-triggered workflow run failed', { workflowId: t.workflowId, error: String(err) }));
    }
  }

  /** Each match entry is a glob tested against the same-named field in the event payload (string-coerced). */
  private ecoMatchPasses(match: Record<string, string> | undefined, data: Record<string, unknown>): boolean {
    if (!match) return true;
    for (const [field, pat] of Object.entries(match)) {
      const val = data[field];
      if (val === undefined || val === null) return false;
      if (!globToRegExp(pat).test(String(val))) return false;
    }
    return true;
  }

  private async fireEventTriggers(on: 'memory.write' | 'offer.ordered', ownerGhii: string, matches: (t: { match: Record<string, string> }) => boolean): Promise<void> {
    let triggers;
    try { triggers = await readEventTriggers(this.storage, this.config.nodeId); }
    catch (err) { logger.error('readEventTriggers failed', { on, error: String(err) }); return; }
    const hits = triggers.filter(t => t.on === on && t.ownerGhii === ownerGhii && matches(t));
    if (hits.length === 0) return;
    const active = await readActiveRuns(this.storage, this.config.nodeId);
    for (const t of hits) {
      if (active.some(a => a.workflowId === t.workflowId && a.ownerGhii === t.ownerGhii)) continue; // loop/overlap guard (owner-scoped)
      this.startRun(ownerGhii, ownerGhii.split('@')[0], t.workflowId, { mode: 'full-live' })
        .catch(err => logger.error('event-triggered workflow run failed', { workflowId: t.workflowId, error: String(err) }));
    }
  }

  /**
   * Cancel an in-flight run: mark its still-open steps skipped, set the run `cancelled`, and drop it
   * from the active-run index so the watchdog stops touching it. Already-dispatched agent tasks are
   * left alone — if one later finishes, onTaskTerminal finds the step no longer `dispatched` and
   * no-ops (no resurrection). Returns false if the run is unknown or already terminal.
   */
  async cancelRun(ownerGhii: string, workflowId: string, runId: string): Promise<boolean> {
    return this.withLock(runId, async () => {
      const rec = await this.storage.getMemory(ownerGhii, runKey(workflowId, runId));
      if (!rec) return false;
      const run = rec.value as WorkflowRun;
      if (run.status !== 'running' && run.status !== 'waiting-step') return false;
      const now = new Date().toISOString();
      for (const rs of Object.values(run.steps)) {
        if (rs.state === 'pending' || rs.state === 'dispatched') { rs.state = 'skipped'; rs.endedAt = now; }
      }
      run.status = 'cancelled';
      run.endedAt = now;
      await this.persist(ownerGhii, run);
      emitChange('workflows');
      logger.info(`workflow ${workflowId} run ${runId} cancelled by owner`);
      return true;
    });
  }

  /**
   * On boot, re-sync in-flight runs: a step's task may have reached done/failed during the restart
   * gap (after the HTTP response, before the fire-and-forget onTaskTerminal ran), leaving the step
   * stuck `dispatched`. Re-check each dispatched step's tasks and advance any that already finished —
   * otherwise the watchdog would wrongly TIME OUT a step whose task actually succeeded. Remaining
   * in-flight runs are then carried by live task events + the watchdog.
   */
  async resumeInflight(): Promise<void> {
    const active = await readActiveRuns(this.storage, this.config.nodeId);
    if (!active.length) return;
    logger.info(`WorkflowEngine: re-syncing ${active.length} in-flight run(s) after restart`);
    for (const a of active) {
      try {
        const rec = await this.storage.getMemory(a.ownerGhii, runKey(a.workflowId, a.runId));
        if (!rec) continue;
        const run = rec.value as WorkflowRun;
        for (const [, rs] of Object.entries(run.steps)) {
          if (rs.state !== 'dispatched') continue;
          for (const tid of rs.taskIds ?? []) {
            const task = await this.storage.getAgentTask(tid);
            if (task && (task.status === 'done' || task.status === 'failed')) {
              await this.onTaskTerminal(task, task.status); // advances the run (re-checks all step tasks)
              break;
            }
          }
        }
      } catch (err) {
        logger.error('resumeInflight re-sync failed', { runId: a.runId, error: String(err) });
      }
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────────────

  private resolveVars(def: WorkflowDef, overrides?: Record<string, string>): Record<string, string> {
    const today = new Date().toISOString().slice(0, 10);
    const out: Record<string, string> = {};
    for (const v of def.vars) {
      const override = overrides?.[v.name];
      const def0 = v.default === '<run-date>' ? today : v.default;
      out[v.name] = override ?? def0 ?? '';
    }
    return out;
  }

  private template(tmpl: string, vars: Record<string, string>): string {
    return tmpl.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, n: string) => vars[n] ?? `{${n}}`);
  }

  /** Evaluate a signal (or 'none'/undefined → pass), accumulating the keys it reads. */
  private async evalSignal(signal: Signal | 'none' | undefined, ctx: SignalEvalCtx, reads: Set<string>): Promise<{ ok: boolean; observed: unknown }> {
    if (!signal || signal === 'none') return { ok: true, observed: { skipped: 'none' } };
    // wrap ctx.read/listGlob to record reads
    const tracking: SignalEvalCtx = {
      ...ctx,
      read: async (k) => { reads.add(k); return ctx.read(k); },
      listGlob: async (g) => { reads.add(g); return ctx.listGlob(g); },
    };
    return evaluateSignal(signal, tracking);
  }

  /** Mark every step that (transitively) depends on a failed step as skipped (partial-fail policy). */
  private skipSubtree(run: WorkflowRun, failedId: string): void {
    const dependents = (id: string): string[] => run.defSnapshot.steps.filter(s => (s.after ?? []).includes(id)).map(s => s.id);
    const queue = [...dependents(failedId)];
    while (queue.length) {
      const id = queue.shift()!;
      const rs = run.steps[id];
      if (rs && rs.state === 'pending') { rs.state = 'skipped'; queue.push(...dependents(id)); }
    }
  }

  /**
   * On a step failure, decide the fate of its dependents. Default policy skips the whole subtree.
   * Under `resume`, skip NOTHING here: computeReadySteps lets each dependent become ready once its
   * deps are terminal, and tick re-evaluates the dependent's OWN required_to_function against current
   * memory — so a dependent whose input the crew actually produced runs, and one whose input is
   * genuinely missing goes input-red (which cascades the same way). This is the "re-evaluate against
   * reality" contract; it is safe only when crew stages are idempotent, hence opt-in.
   */
  private failDownstream(run: WorkflowRun, failedId: string): void {
    if (run.defSnapshot.resume) return;
    this.skipSubtree(run, failedId);
  }

  /**
   * Sample a dispatched step's fill progress from its success-signal `observed` (count_nonempty
   * leaves). Records rs.progress and returns whether the count rose since the last sample — the
   * watchdog treats a rising count as "still filling" (slides the no-progress deadline) and a flat
   * one as "stuck". No-op (returns false) for signals with no countable leaf.
   */
  private recordProgress(rs: WorkflowRunStep, observed: unknown): boolean {
    const prog = extractProgress(observed);
    if (!prog) return false;
    // Baseline 0 (not -1): a step sitting at 0 keys must NOT read as "progressed" on its first sample,
    // else a genuinely-stuck step would slide its deadline forever instead of timing out.
    const prevCount = rs.progress?.count ?? 0;
    const increasing = prog.count > prevCount;
    const nowIso = new Date().toISOString();
    rs.progress = {
      count: prog.count,
      min: prog.min,
      increasing,
      lastProgressAt: increasing ? nowIso : (rs.progress?.lastProgressAt ?? rs.startedAt ?? nowIso),
    };
    return increasing;
  }

  /** Dispatch a step's agent task(s); tag with the workflow-run scope for onTaskTerminal. */
  private async dispatchStep(ownerGhii: string, run: WorkflowRun, step: WorkflowStep, resolved?: ResolvedStep): Promise<string[]> {
    // Ecosystem action steps push to / invoke a GEAI over the tunnel; completion arrives via the
    // async onPushTerminal path, never an agent task. They record no task ids.
    if (step.action && step.action.kind !== 'agent') {
      this.dispatchEcosystemStep(ownerGhii, run, step, step.action);
      return [];
    }
    const ownerName = ownerGhii.split('@')[0];
    const agents = Array.isArray(step.agent) ? step.agent : (step.agent ? [step.agent] : []);
    const now = new Date().toISOString();
    const ids: string[] = [];
    for (const agentName of agents) {
      const agentGaii = buildGAII(agentName, ownerName, this.config.nodeId);
      const scope: AgentTaskScope[] = [
        { name: 'workflow-run', value: `${run.workflowId}/${run.runId}`, type: 'text', description: step.id },
        { name: 'offer', value: step.offer ?? '', type: 'text', description: loc(step.description) },
      ];
      // Sandbox run: tell the agent the key prefix to write under (signals read under it too), so a
      // test run doesn't clobber production keys. A cooperating agent honors it; the node can't force it.
      if (run.keyPrefix) scope.push({ name: 'wf-key-prefix', value: run.keyPrefix, type: 'text', description: 'prefix all deliverable keys with this' });
      const record: AgentTaskRecord = {
        id: randomUUID(), agentGaii, ownerGaii: ownerGhii,
        title: loc(step.description) || `${run.workflowId} · ${step.id}`,
        description: loc(run.defSnapshot.description),
        scope, rules: [], verification: { userExpects: '', technicalChecks: [] },
        todos: [], status: 'active', createdAt: now, updatedAt: now, lastEventAt: now,
      };
      await this.storage.createAgentTask(record);
      await this.storage.appendTaskEvent({ id: randomUUID(), taskId: record.id, type: 'started', message: `Dispatched by workflow "${run.workflowId}" step "${step.id}"`, timestamp: now });
      this.webhookDispatcher?.dispatchWebhookEvent(agentGaii, 'task.approved', {
        task_id: record.id, title: record.title, description: record.description ?? '',
        has_todos: false, todo_count: 0, scope_summary: scope.map(s => `${s.type}:${s.value}`),
        created_at: now, auto_activated: true, workflow_id: run.workflowId,
      });
      ids.push(record.id);
    }
    void resolved;
    return ids;
  }

  /**
   * Fire an ecosystem action step (export-out / trigger-geai) over the connect-tunnel and route its
   * reply into onPushTerminal. Fire-and-forget: the run was already marked 'dispatched' + persisted
   * under the lock by tick(), so onPushTerminal (which also locks) advances it safely on the reply.
   * The workflow owner is the caller GHII (the human pays / is the AIMEAT-side principal).
   */
  private dispatchEcosystemStep(ownerGhii: string, run: WorkflowRun, step: WorkflowStep, action: Exclude<WorkflowStep['action'], undefined | { kind: 'agent' }>): void {
    const { workflowId, runId } = run;
    const stepId = step.id;
    const fire = async (): Promise<boolean> => {
      const mgr = getActiveConnectTunnelManager();
      if (!mgr) return false;
      if (action.kind === 'trigger-geai') {
        const reply = await mgr.invokeOnPrincipal(action.geai, { capability: action.capability, input: action.input ?? {}, caller: ownerGhii });
        return reply.ok;
      }
      // export-out: read the owner-namespace `from` key and push it to the GEAI's ingest capability.
      const fromKey = this.template(action.from, run.vars);
      const rec = await this.storage.getMemory(ownerGhii, fromKey);
      const reply = await mgr.invokeOnPrincipal(action.geai, {
        capability: action.capability ?? '__deposit__',
        input: { from: fromKey, data: rec?.value ?? null },
        caller: ownerGhii,
      });
      return reply.ok;
    };
    fire()
      .then(ok => this.onPushTerminal(ownerGhii, workflowId, runId, stepId, ok))
      .catch(() => this.onPushTerminal(ownerGhii, workflowId, runId, stepId, false));
  }

  /**
   * The non-task completion path for ecosystem action steps — the parallel of onTaskTerminal that
   * reuses the same lock + success_signal evaluation + partial-fail + tick. `ok` is whether the
   * push-ack / capability-response succeeded; a step is green iff ok AND its success_signal (if any)
   * passes.
   */
  async onPushTerminal(ownerGhii: string, workflowId: string, runId: string, stepId: string, ok: boolean): Promise<void> {
    await this.withLock(runId, async () => {
      const rec = await this.storage.getMemory(ownerGhii, runKey(workflowId, runId));
      if (!rec) return;
      const run = rec.value as WorkflowRun;
      const rs = run.steps[stepId];
      if (!rs || rs.state !== 'dispatched') return; // already resolved / not awaiting

      const r = this.resolvedMap(run).get(stepId);
      const ctx = buildEvalCtx(this.storage, this.config, ownerGhii, run);
      const reads = new Set<string>(rs.reads);
      const output = await this.evalSignal(r?.success_signal, ctx, reads);
      const now = new Date().toISOString();
      rs.outputObserved = output.observed;
      rs.reads = [...reads];
      this.recordProgress(rs, output.observed);

      const stepDef = run.defSnapshot.steps.find(s => s.id === stepId)!;
      if (ok && output.ok) {
        rs.state = 'green'; rs.endedAt = now;
      } else if (stepDef.retry && rs.attempt < stepDef.retry.max) {
        rs.attempt += 1; rs.state = 'pending'; rs.taskIds = undefined;
        rs.notBefore = new Date(Date.now() + stepDef.retry.backoff_min * 60_000).toISOString();
      } else {
        rs.state = 'output-red'; rs.endedAt = now;
        this.failDownstream(run, stepId);
        await this.onStepFail(ownerGhii, run, stepId, 'output-red');
      }
      await this.tick(ownerGhii, run);
    });
  }

  /**
   * On a RED step: GUARANTEE the owner sees it (push — node-owned, never silent), then best-effort
   * dispatch the crew `workflow-inspector` agent for diagnosis/repair. The push is the contract; the
   * inspector is enrichment, so a missing/offline inspector never hides the failure.
   */
  private async onStepFail(ownerGhii: string, run: WorkflowRun, stepId: string, reason: WorkflowRunStep['state']): Promise<void> {
    const ownerName = ownerGhii.split('@')[0];
    logger.warn(`workflow ${run.workflowId} run ${run.runId}: step "${stepId}" ${reason}`);
    // 1. Guaranteed owner alert (deterministic, node-owned).
    if (this.pushService?.enabled) {
      this.pushService.sendNotification(ownerName, {
        title: 'Workflow step failed',
        body: `${loc(run.defSnapshot.title) || run.workflowId}: step "${stepId}" → ${reason}`,
        url: '/v1/profile?tab=workflows',
        tag: `workflow:${run.workflowId}`,
      }).catch(() => { /* push best-effort */ });
    }
    // 2. Best-effort inspector dispatch (crew-owned; absent ⇒ skip silently, the push already fired).
    const taskId = await this.dispatchInspector(ownerGhii, ownerName, run, stepId, reason);
    if (taskId) {
      run.inspections = [...(run.inspections ?? []), { stepId, taskId, reason, at: new Date().toISOString() }];
    }
  }

  /**
   * Queue a task to the owner's `workflow-inspector` agent (crew-owned) with full run context: the
   * run record (defSnapshot + every step's state + expected-vs-observed) is at a known memory key.
   * Tagged `workflow-inspect` (NOT `workflow-run`) so completing it never advances the run. Returns
   * the task id, or null when no inspector agent is installed.
   */
  private async dispatchInspector(ownerGhii: string, ownerName: string, run: WorkflowRun, stepId: string, reason: WorkflowRunStep['state']): Promise<string | null> {
    const inspectorGaii = buildGAII('workflow-inspector', ownerName, this.config.nodeId);
    const inspector = await this.storage.getAgent(inspectorGaii);
    if (!inspector) return null;

    const rk = runKey(run.workflowId, run.runId);
    const failing = run.steps[stepId];
    const failingAgents = (run.defSnapshot.steps.find(s => s.id === stepId)?.agent) ?? '';
    const now = new Date().toISOString();
    const scope: AgentTaskScope[] = [
      { name: 'workflow-inspect', value: `${run.workflowId}/${run.runId}`, type: 'text', description: stepId },
    ];
    const record: AgentTaskRecord = {
      id: randomUUID(), agentGaii: inspectorGaii, ownerGaii: ownerGhii,
      title: `Inspect workflow "${run.workflowId}" — step "${stepId}" ${reason}`,
      description: [
        `A workflow step failed (${reason}).`,
        `Read the full run record at owner memory key "${rk}" — it carries defSnapshot, every step's`,
        `state (green / input-red / output-red / timed-out / skipped), and per-leaf expected-vs-observed.`,
        `Failing step: "${stepId}" (agent: ${Array.isArray(failingAgents) ? failingAgents.join(', ') : failingAgents}).`,
        `Observed: ${JSON.stringify(failing?.outputObserved ?? failing?.inputObserved ?? {}).slice(0, 1000)}.`,
        `Diagnose, auto-run any safe deterministic repairs, and report recommendations.`,
      ].join(' '),
      scope, rules: [], verification: { userExpects: '', technicalChecks: [] },
      resources: { memoryKeys: [rk] },
      todos: [], status: 'active', createdAt: now, updatedAt: now, lastEventAt: now,
    };
    await this.storage.createAgentTask(record);
    await this.storage.appendTaskEvent({ id: randomUUID(), taskId: record.id, type: 'started', message: `Workflow inspection requested for "${run.workflowId}" step "${stepId}" (${reason})`, timestamp: now });
    this.webhookDispatcher?.dispatchWebhookEvent(inspectorGaii, 'task.approved', {
      task_id: record.id, title: record.title, description: record.description ?? '',
      has_todos: false, todo_count: 0, scope_summary: scope.map(s => `${s.name}:${s.value}`),
      created_at: now, auto_activated: true, workflow_id: run.workflowId,
    });
    return record.id;
  }

  private static readonly TERMINAL_RUN = new Set<WorkflowRun['status']>(['done', 'partial', 'red', 'cancelled']);
  private static readonly FAILED_STEP = new Set<WorkflowRunStep['state']>(['input-red', 'output-red', 'timed-out']);

  /**
   * Finish-notification (Rule: owner opt-in). When a full-live run reaches a terminal state AND the
   * owner ticked `notify_on_finish` on the workflow, drop a single notification — the in-app inbox
   * always, plus an email when the owner has a notification email and SMTP is configured — telling
   * them whether the run succeeded or failed and a per-step log of how it went. Fires for BOTH
   * outcomes (success and failure). Idempotent via run.notifiedFinish; fully best-effort so a
   * notification/email problem never disturbs the run. Returns whether the run was mutated (so the
   * caller persists the notifiedFinish flag).
   */
  private async onRunFinished(ownerGhii: string, run: WorkflowRun): Promise<boolean> {
    if (run.mode !== 'full-live') return false;
    if (!run.defSnapshot.notify_on_finish) return false;
    if (run.notifiedFinish) return false;
    if (!WorkflowEngine.TERMINAL_RUN.has(run.status)) return false;
    run.notifiedFinish = true;

    const name = loc(run.defSnapshot.title) || run.workflowId;
    const succeeded = run.status === 'done';
    const outcome = succeeded ? 'succeeded'
      : run.status === 'cancelled' ? 'was cancelled'
      : 'finished with failures';
    const title = `Workflow "${name}" ${succeeded ? 'succeeded' : run.status === 'cancelled' ? 'cancelled' : 'failed'}`;

    // Per-step log + a short header (duration, failed-step roster).
    const stepLog = run.defSnapshot.steps
      .map(s => `• ${s.id}: ${run.steps[s.id]?.state ?? 'unknown'}`)
      .join('\n');
    const failedSteps = run.defSnapshot.steps
      .filter(s => WorkflowEngine.FAILED_STEP.has(run.steps[s.id]?.state))
      .map(s => s.id);
    const durMin = run.endedAt && run.startedAt
      ? Math.max(0, Math.round((new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()) / 60_000))
      : null;
    const header = [
      `Workflow "${name}" ${outcome}.`,
      durMin !== null ? `Duration: ~${durMin} min.` : null,
      failedSteps.length ? `Failed steps: ${failedSteps.join(', ')}.` : null,
    ].filter(Boolean).join(' ');
    const body = `${header}\n\nRun log:\n${stepLog}`;
    const link = '/v1/profile?tab=workflows';

    // 1. In-app inbox (the notification system) — always, best-effort (never throws).
    await notify(this.storage, ownerGhii, {
      type: succeeded ? 'workflow_finished' : 'workflow_failed',
      title, body, link,
    });

    // 2. Email — only when configured AND the owner set a notification email.
    try {
      if (this.emailService?.enabled) {
        const ghii = await this.storage.getGHII(ownerGhii);
        if (ghii?.notificationEmail) {
          await this.emailService.sendNotification(ghii.notificationEmail, title, body);
        }
      }
    } catch (err) {
      logger.warn('workflow finish email failed', { workflowId: run.workflowId, runId: run.runId, error: String(err) });
    }
    return true;
  }

  private async persist(ownerGhii: string, run: WorkflowRun): Promise<void> {
    // Terminal-run finish notification (owner opt-in) — mutates run.notifiedFinish so it's persisted
    // below and fires exactly once across every terminal path (tick / cancelRun / sweep).
    await this.onRunFinished(ownerGhii, run);
    const key = runKey(run.workflowId, run.runId);
    const existing = await this.storage.getMemory(ownerGhii, key);
    const now = new Date().toISOString();
    await this.storage.setMemory({
      key, ownerGaii: ownerGhii, value: run,
      visibility: 'private', tags: ['workflow-run'], ttlHours: null,
      version: existing ? existing.version + 1 : 1,
      createdAt: existing?.createdAt ?? now, updatedAt: now,
    });
    await reconcileActiveRun(this.storage, this.config.nodeId, ownerGhii, run);
  }
}
