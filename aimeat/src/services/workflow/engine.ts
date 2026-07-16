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
 *   v1.3.0 — 2026-07-05 — Re-run freshness. resolveVars injects built-in {run}/{date} template vars so
 *     deliverable keys can be run-scoped (a re-run then never sees a prior run's output — the
 *     non-destructive default). Opt-in WorkflowDef.fresh clears the workflow's produced keys ONCE at
 *     run start (clearRunOutputs) so an idempotent skip-existing crew regenerates the SAME keys each
 *     run instead of no-op-ing on stale output. Cleared up front (not per-step) so parallel steps
 *     sharing an output namespace can't wipe each other's fresh output.
 *   v1.4.0 — 2026-07-06 — Opt-in WorkflowDef.skip_done: tick checks a ready step's success_signal and,
 *     if already satisfied, greens it WITHOUT dispatching the crew — a re-run continues from the not-
 *     yet-done steps (and re-running one step = clear its output + run). tick is now a fixpoint loop so
 *     a skip-greened step's dependents advance in the same tick.
 *   v1.5.0 — 2026-07-06 — agent-offline handling. isAgentReachable (webhook-healthy OR fresh lastSeen);
 *     tick fires a heads-up notification when it dispatches to an offline agent; the sweep fast-fails a
 *     no-progress step whose agent is unreachable at the offline grace (AGENT_OFFLINE_GRACE_MS) into the
 *     new `agent-offline` state — instead of waiting the full timeout_min for a generic timed-out.
 *   v1.6.0 — 2026-07-16 — human-input steps. tick parks a reached human-input step in 'waiting-human'
 *     (askHumanInput delivers the question; the run stays 'waiting-step'); onHumanAnswer (the analog of
 *     onPushTerminal, called from the answer route) validates picks against the PINNED question, writes
 *     the answer JSON to answer_to_key (keyPrefix-honoring — sandbox-safe), greens the step, and ticks.
 *     The sweep applies the on_timeout policy (fail | skip | default) after timeout_min (default 24h
 *     for human steps); cancelRun skips parked human steps. Restart-safe by construction — the parked
 *     state lives in the persisted run record.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentTaskRecord } from '../../storage/interface.js';
import type { createWebhookDispatcher } from '../webhook-dispatcher.js';
import type { PushService } from '../push.js';
import type { EmailService } from '../email.js';
import { emitChange } from '../event-bus.js';
import { logger } from '../../utils/logger.js';
import { evaluateSignal, extractProgress, globToRegExp, type SignalEvalCtx } from './signal-eval.js';
import { buildEvalCtx } from './eval-context.js';
import { getWorkflow, validateWorkflow, runKey, type ResolvedStep } from './store.js';
import { readEventTriggers, readEcosystemEventTriggers, readActiveRuns, reconcileActiveRun } from './lifecycle.js';
import { template } from './engine-util.js';
import { isAgentStep, anyAgentReachable, AGENT_OFFLINE_GRACE_MS } from './engine-reachability.js';
import {
  dispatchStep, askHumanInput, maybeAlertAgentOffline, onStepFail, onRunFinished, clearRunOutputs, type StepDeps,
} from './engine-steps.js';
import { validateHumanAnswer, applyHumanAnswer } from './engine-human.js';
import type {
  WorkflowDef, WorkflowRun, WorkflowRunStep, WorkflowStep, Signal,
} from '../../models/workflow-schemas.js';

export { isAgentReachable } from './engine-reachability.js';

type WebhookDispatcher = ReturnType<typeof createWebhookDispatcher>;

let _active: WorkflowEngine | null = null;
export function setActiveWorkflowEngine(e: WorkflowEngine): void { _active = e; }
export function getActiveWorkflowEngine(): WorkflowEngine | null { return _active; }

const TERMINAL_STEP_STATES = new Set<WorkflowRunStep['state']>(['green', 'input-red', 'output-red', 'timed-out', 'skipped', 'agent-offline']);

/** Default wait for a human-input step's answer — humans sleep; 24h, not the agent-step 60 min. */
export const HUMAN_TIMEOUT_MIN_DEFAULT = 1440;

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

  /** Bundle the engine's services for the extracted step/notification helpers (engine-steps.ts). */
  private stepDeps(): StepDeps {
    return {
      storage: this.storage, config: this.config,
      webhookDispatcher: this.webhookDispatcher,
      pushService: this.pushService, emailService: this.emailService,
    };
  }

  /** Delegates to the extracted helper; kept as a method so callers (tick/onTaskTerminal/sweep) are unchanged. */
  private async onStepFail(ownerGhii: string, run: WorkflowRun, stepId: string, reason: WorkflowRunStep['state']): Promise<void> {
    return onStepFail(this.stepDeps(), ownerGhii, run, stepId, reason);
  }

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
    const vars = this.resolveVars(def, opts.vars, runId);
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
      await this.withLock(runId, async () => {
        // fresh mode: wipe the workflow's prior-run output ONCE, before any step dispatches, so an
        // idempotent skip-existing crew regenerates it (parallel shared-namespace steps can't clobber).
        if (run.defSnapshot.fresh) await clearRunOutputs(this.stepDeps(), ownerGhii, run);
        await this.tick(ownerGhii, run);
      });
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
    let mutated = false;

    // Fixpoint: a step reaching a TERMINAL state this tick (green via skip-done, or input-red) can
    // unblock its dependents, so keep re-computing ready steps until only dispatched (non-terminal)
    // steps remain. Each step is processed at most once (once non-pending it leaves computeReadySteps),
    // so this terminates in ≤ N passes.
    for (;;) {
      const ready = computeReadySteps(run.defSnapshot, run.steps, now);
      if (ready.length === 0) break;
      let advancedTerminal = false;
      for (const step of ready) {
        const r = resolved.get(step.id);
        const rs = run.steps[step.id];
        const reads = new Set<string>();
        const input = await this.evalSignal(r?.required_to_function, ctx, reads);
        rs.reads = [...reads];
        if (!input.ok) {
          rs.state = 'input-red'; rs.inputObserved = input.observed; rs.endedAt = now;
          this.failDownstream(run, step.id);
          await this.onStepFail(ownerGhii, run, step.id, 'input-red');
          advancedTerminal = true; mutated = true;
          continue;
        }
        // skip-if-done (opt-in): if the deliverable is already present, mark the step green WITHOUT
        // dispatching the crew — a re-run then continues from the not-yet-done steps instead of
        // redoing completed work. (fresh cleared outputs at run start, so it never skips there.)
        if (run.defSnapshot.skip_done) {
          const outReads = new Set<string>(rs.reads);
          const output = await this.evalSignal(r?.success_signal, ctx, outReads);
          rs.reads = [...outReads];
          if (output.ok) {
            rs.state = 'green'; rs.startedAt = rs.startedAt ?? now; rs.endedAt = now;
            rs.outputObserved = output.observed;
            this.recordProgress(rs, output.observed);
            if (r?.deliverableKey) rs.writes = [...new Set([...rs.writes, template(r.deliverableKey, run.vars)])];
            advancedTerminal = true; mutated = true;
            continue;
          }
        }
        // human-input: ask the owner and PARK — no dispatch, no task. Advances via onHumanAnswer
        // (the answer route) or the sweep's on_timeout policy. Non-terminal, so the run stays open.
        if (step.action?.kind === 'human-input') {
          rs.human = await askHumanInput(this.stepDeps(), ownerGhii, run, step, step.action);
          rs.state = 'waiting-human'; rs.startedAt = now; rs.notBefore = undefined;
          mutated = true;
          continue;
        }
        // dispatch (fresh-mode output clearing happens ONCE at run start — see clearRunOutputs)
        const taskIds = await dispatchStep(this.stepDeps(), ownerGhii, run, step, r, (o, w, rid, s, ok) => this.onPushTerminal(o, w, rid, s, ok));
        rs.state = 'dispatched'; rs.taskIds = taskIds; rs.startedAt = now; rs.notBefore = undefined;
        dispatchedAny = true; mutated = true;
        // Heads-up if we just dispatched to an offline agent (the sweep fails it after the grace).
        await maybeAlertAgentOffline(this.stepDeps(), ownerGhii, run, step);
      }
      // Only dispatched (non-terminal) steps remained this pass ⇒ nothing new can be unblocked now.
      if (!advancedTerminal) break;
    }

    const outcome = runOutcome(run.steps);
    if (outcome !== 'running') {
      run.status = outcome; run.endedAt = new Date().toISOString();
    } else {
      run.status = Object.values(run.steps).some(s => s.state === 'dispatched' || s.state === 'waiting-human') ? 'waiting-step' : 'running';
    }
    await this.persist(ownerGhii, run);
    if (mutated || dispatchedAny || outcome !== 'running') emitChange('workflows');
  }

  // ── task terminal → advance ────────────────────────────────────────────────────
  async onTaskTerminal(task: AgentTaskRecord, _outcome: 'done' | 'failed'): Promise<void> {
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
      if (r?.deliverableKey) rs.writes = [...new Set([...rs.writes, template(r.deliverableKey, run.vars)])];

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
      const ownerName = ownerGhii.split('@')[0];
      const resolved = this.resolvedMap(r);
      const ctx = buildEvalCtx(this.storage, this.config, ownerGhii, r);
      let changed = false;

      for (const step of r.defSnapshot.steps) {
        const rs = r.steps[step.id];

        // waiting-human: no progress tracking, no offline logic — just the on_timeout policy once
        // timeout_min (default 24h for human steps) has elapsed since the question was asked.
        if (rs.state === 'waiting-human' && rs.human) {
          const action = step.action?.kind === 'human-input' ? step.action : undefined;
          const deadline = new Date(rs.human.askedAt).getTime() + (step.timeout_min ?? HUMAN_TIMEOUT_MIN_DEFAULT) * 60_000;
          if (now < deadline) continue;
          const policy = action?.on_timeout ?? 'fail';
          if (policy === 'default' && action?.default_option) {
            await applyHumanAnswer(this.storage, ownerGhii, r, step.id, {
              picks: [action.default_option], pick: action.default_option, by: 'timeout-default',
            });
          } else if (policy === 'skip') {
            rs.state = 'skipped'; rs.endedAt = nowIso;
          } else {
            rs.state = 'timed-out'; rs.endedAt = nowIso;
            this.failDownstream(r, step.id);
            await this.onStepFail(ownerGhii, r, step.id, 'timed-out');
          }
          changed = true;
          continue;
        }

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
          if (rdef?.deliverableKey) rs.writes = [...new Set([...rs.writes, template(rdef.deliverableKey, r.vars)])];
          changed = true;
          continue;
        }
        rs.outputObserved = output.observed;

        // agent-offline fast-fail: an agent step that has produced NOTHING and whose agent is
        // unreachable won't complete — fail it at the offline grace (not the full timeout_min) with a
        // distinct state. A step that made ANY progress, or whose agent is reachable (working but slow),
        // falls through to the timeout policy below.
        const producedNothing = (rs.progress?.count ?? 0) === 0;
        const sinceDispatch = now - new Date(rs.startedAt).getTime();
        if (isAgentStep(step) && producedNothing && sinceDispatch >= AGENT_OFFLINE_GRACE_MS
            && !(await anyAgentReachable(this.storage, this.config, ownerName, step))) {
          rs.state = 'agent-offline'; rs.endedAt = nowIso;
          this.failDownstream(r, step.id);
          await this.onStepFail(ownerGhii, r, step.id, 'agent-offline');
          changed = true;
          continue;
        }

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
        if (rs.state === 'pending' || rs.state === 'dispatched' || rs.state === 'waiting-human') { rs.state = 'skipped'; rs.endedAt = now; }
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

  private resolveVars(def: WorkflowDef, overrides: Record<string, string> | undefined, runId: string): Record<string, string> {
    const today = new Date().toISOString().slice(0, 10);
    const out: Record<string, string> = {};
    for (const v of def.vars) {
      const override = overrides?.[v.name];
      const def0 = v.default === '<run-date>' ? today : v.default;
      out[v.name] = override ?? def0 ?? '';
    }
    // Built-in run-scoping vars (available to key templates WITHOUT declaration; a declared var of the
    // same name wins). `{run}` = this run's id (unique per invocation); `{date}` = the run date. Templating
    // deliverable keys with one of these gives each run its OWN keyspace — so a re-run never sees a prior
    // run's output (no stale false-green, no wasted crew re-run over already-present keys) and history is
    // preserved. See docs — this is the recommended alternative to the destructive `fresh` clear.
    if (!('run' in out)) out.run = runId;
    if (!('date' in out)) out.date = today;
    return out;
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
   * The human completion path for human-input steps — the parallel of onTaskTerminal/onPushTerminal,
   * called from the answer route (or an MCP relay). Validates the picks against the question PINNED
   * at ask time, applies the answer (memory write + green — engine-human.ts), and ticks the run
   * forward. Approve/decline branching happens downstream via deterministic json_field gates on the
   * answer key — ANY valid answer greens the human step itself.
   */
  async onHumanAnswer(
    ownerGhii: string, workflowId: string, runId: string, stepId: string,
    answer: { picks: string[]; other?: string; by: string },
  ): Promise<{ ok: true } | { ok: false; code: 'NOT_FOUND' | 'NOT_WAITING' | 'BAD_ANSWER'; error: string }> {
    return this.withLock(runId, async () => {
      const rec = await this.storage.getMemory(ownerGhii, runKey(workflowId, runId));
      if (!rec) return { ok: false as const, code: 'NOT_FOUND' as const, error: `run "${runId}" not found` };
      const run = rec.value as WorkflowRun;
      const rs = run.steps[stepId];
      if (!rs || rs.state !== 'waiting-human' || !rs.human) {
        return { ok: false as const, code: 'NOT_WAITING' as const, error: `step "${stepId}" is not waiting for human input` };
      }
      const bad = validateHumanAnswer(rs.human.question, answer);
      if (bad) return { ok: false as const, code: 'BAD_ANSWER' as const, error: bad };
      await applyHumanAnswer(this.storage, ownerGhii, run, stepId, {
        picks: answer.picks, pick: answer.picks[0] ?? '', other: answer.other, by: answer.by,
      });
      await this.tick(ownerGhii, run);
      logger.info(`workflow ${workflowId} run ${runId}: step "${stepId}" answered by ${answer.by}`);
      return { ok: true as const };
    });
  }

  private async persist(ownerGhii: string, run: WorkflowRun): Promise<void> {
    // Terminal-run finish notification (owner opt-in) — mutates run.notifiedFinish so it's persisted
    // below and fires exactly once across every terminal path (tick / cancelRun / sweep).
    await onRunFinished(this.stepDeps(), ownerGhii, run);
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
