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
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentTaskRecord, AgentTaskScope } from '../../storage/interface.js';
import type { createWebhookDispatcher } from '../webhook-dispatcher.js';
import type { PushService } from '../push.js';
import { buildGAII } from '../../utils/gaii.js';
import { emitChange } from '../event-bus.js';
import { logger } from '../../utils/logger.js';
import { evaluateSignal, type SignalEvalCtx } from './signal-eval.js';
import { buildEvalCtx } from './eval-context.js';
import { getWorkflow, validateWorkflow, runKey, type ResolvedStep } from './store.js';
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
 * The steps that may start now: pending, all `after` deps green, and past any retry backoff.
 * Pure — operates on the def + the current run-step map.
 */
export function computeReadySteps(def: WorkflowDef, steps: Record<string, WorkflowRunStep>, now: string): WorkflowStep[] {
  return def.steps.filter(s => {
    const rs = steps[s.id];
    if (!rs || rs.state !== 'pending') return false;
    if (rs.notBefore && rs.notBefore > now) return false;
    return (s.after ?? []).every(dep => steps[dep]?.state === 'green');
  });
}

/** The terminal run status given the step states: done if all green, else partial; running otherwise. */
export function runOutcome(steps: Record<string, WorkflowRunStep>): 'done' | 'partial' | 'running' {
  const all = Object.values(steps);
  if (all.some(s => !TERMINAL_STEP_STATES.has(s.state))) return 'running';
  return all.every(s => s.state === 'green') ? 'done' : 'partial';
}

export interface StartRunOpts {
  mode: 'signals-only' | 'full-live';
  vars?: Record<string, string>;
}

export class WorkflowEngine {
  private config: AimeatConfig;
  private storage: Storage;
  private webhookDispatcher?: WebhookDispatcher;
  private pushService?: PushService;
  /** Per-run serialization: advancing the same run from two task completions is a RMW race. */
  private locks = new Map<string, Promise<void>>();
  private sweepTimer?: ReturnType<typeof setInterval>;
  /** Cross-owner index of in-flight runs (memory is per-owner, so the watchdog needs a roster). */
  private readonly systemGhii: string;
  private static readonly ACTIVE_KEY = 'workflows.active';

  constructor(config: AimeatConfig, storage: Storage) {
    this.config = config;
    this.storage = storage;
    this.systemGhii = `system@${config.nodeId}`;
  }

  setWebhookDispatcher(d: WebhookDispatcher): void { this.webhookDispatcher = d; }
  setPushService(p: PushService): void { this.pushService = p; }

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
    const resolved = new Map(v.resolved.map(r => [r.stepId, r]));

    const runId = randomUUID();
    const vars = this.resolveVars(def, opts.vars);
    const now = new Date().toISOString();
    const steps: Record<string, WorkflowRunStep> = {};
    for (const s of def.steps) steps[s.id] = { state: 'pending', attempt: 0, reads: [], writes: [] };

    const run: WorkflowRun = {
      runId, workflowId, defSnapshot: def, vars,
      mode: opts.mode, keyPrefix: '', status: 'running', steps, startedAt: now,
    };

    if (opts.mode === 'signals-only') {
      await this.runSignalsOnly(ownerGhii, run, resolved);
    } else {
      await this.persist(ownerGhii, run);
      await this.tick(ownerGhii, run, resolved);
    }
    return { runId };
  }

  /** signals-only: evaluate every step's input + output against existing memory; no dispatch. */
  private async runSignalsOnly(ownerGhii: string, run: WorkflowRun, resolved: Map<string, ResolvedStep>): Promise<void> {
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
  private async tick(ownerGhii: string, run: WorkflowRun, resolved: Map<string, ResolvedStep>): Promise<void> {
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
        this.skipSubtree(run, step.id);
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

      const v = await validateWorkflow(this.storage, this.config, ownerGhii.split('@')[0], run.defSnapshot);
      const resolved = new Map((v.resolved ?? []).map(r => [r.stepId, r]));
      const r = resolved.get(stepId);
      const ctx = buildEvalCtx(this.storage, this.config, ownerGhii, run);
      const reads = new Set<string>(rs.reads);

      const output = await this.evalSignal(r?.success_signal, ctx, reads);
      const now = new Date().toISOString();
      rs.outputObserved = output.observed;
      rs.reads = [...reads];
      if (r?.deliverableKey) rs.writes = [...new Set([...rs.writes, this.template(r.deliverableKey, run.vars)])];

      const stepDef = run.defSnapshot.steps.find(s => s.id === stepId)!;
      if (output.ok && outcome === 'done') {
        rs.state = 'green'; rs.endedAt = now;
      } else if (stepDef.retry && rs.attempt < stepDef.retry.max) {
        // Deterministic retry with backoff: back to pending, gated by notBefore; the sweep re-ticks.
        rs.attempt += 1; rs.state = 'pending'; rs.taskIds = undefined;
        rs.notBefore = new Date(Date.now() + stepDef.retry.backoff_min * 60_000).toISOString();
      } else {
        rs.state = 'output-red'; rs.endedAt = now;
        this.skipSubtree(run, stepId);
        await this.onStepFail(ownerGhii, run, stepId, 'output-red');
      }

      await this.tick(ownerGhii, run, resolved);
    });
  }

  // ── active-run index (the cross-owner roster the watchdog + resume read) ────────────
  private async listActive(): Promise<Array<{ ownerGhii: string; workflowId: string; runId: string }>> {
    const rec = await this.storage.getMemory(this.systemGhii, WorkflowEngine.ACTIVE_KEY);
    const arr = rec?.value as Array<{ ownerGhii: string; workflowId: string; runId: string }> | undefined;
    return Array.isArray(arr) ? arr : [];
  }

  private async writeActive(entries: Array<{ ownerGhii: string; workflowId: string; runId: string }>): Promise<void> {
    const existing = await this.storage.getMemory(this.systemGhii, WorkflowEngine.ACTIVE_KEY);
    const now = new Date().toISOString();
    await this.storage.setMemory({
      key: WorkflowEngine.ACTIVE_KEY, ownerGaii: this.systemGhii, value: entries,
      visibility: 'private', tags: ['workflow-index'], ttlHours: null,
      version: existing ? existing.version + 1 : 1,
      createdAt: existing?.createdAt ?? now, updatedAt: now,
    });
  }

  /** Reconcile one run's presence in the active-run index based on its status. */
  private async reconcileActive(ownerGhii: string, run: WorkflowRun): Promise<void> {
    const inFlight = run.status === 'running' || run.status === 'waiting-step';
    const entries = await this.listActive();
    const has = entries.some(e => e.runId === run.runId);
    if (inFlight && !has) {
      await this.writeActive([...entries, { ownerGhii, workflowId: run.workflowId, runId: run.runId }]);
    } else if (!inFlight && has) {
      await this.writeActive(entries.filter(e => e.runId !== run.runId));
    }
  }

  // ── watchdog: timeouts + due retries ─────────────────────────────────────────────
  async sweep(): Promise<void> {
    for (const e of await this.listActive()) {
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
      let changed = false;
      // timeouts on dispatched steps
      for (const step of r.defSnapshot.steps) {
        const rs = r.steps[step.id];
        if (rs.state === 'dispatched' && rs.startedAt) {
          const deadline = new Date(rs.startedAt).getTime() + step.timeout_min * 60_000;
          if (now >= deadline) {
            if (step.retry && rs.attempt < step.retry.max) {
              rs.attempt += 1; rs.state = 'pending'; rs.taskIds = undefined;
              rs.notBefore = new Date(now + step.retry.backoff_min * 60_000).toISOString();
            } else {
              rs.state = 'timed-out'; rs.endedAt = new Date().toISOString();
              this.skipSubtree(r, step.id);
              await this.onStepFail(ownerGhii, r, step.id, 'timed-out');
            }
            changed = true;
          }
        }
      }
      // re-tick (fires any now-due pending retries)
      const v = await validateWorkflow(this.storage, this.config, ownerGhii.split('@')[0], r.defSnapshot);
      const resolved = new Map((v.resolved ?? []).map(x => [x.stepId, x]));
      if (changed) await this.persist(ownerGhii, r);
      await this.tick(ownerGhii, r, resolved);
    });
  }

  /** On boot, in-flight runs are advanced by task events + the watchdog; the index survives restart. */
  async resumeInflight(): Promise<void> {
    const active = await this.listActive();
    if (active.length) logger.info(`WorkflowEngine: ${active.length} in-flight run(s) will be advanced by task events + the watchdog`);
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

  /** Dispatch a step's agent task(s); tag with the workflow-run scope for onTaskTerminal. */
  private async dispatchStep(ownerGhii: string, run: WorkflowRun, step: WorkflowStep, resolved?: ResolvedStep): Promise<string[]> {
    const ownerName = ownerGhii.split('@')[0];
    const agents = Array.isArray(step.agent) ? step.agent : [step.agent];
    const now = new Date().toISOString();
    const ids: string[] = [];
    for (const agentName of agents) {
      const agentGaii = buildGAII(agentName, ownerName, this.config.nodeId);
      const scope: AgentTaskScope[] = [
        { name: 'workflow-run', value: `${run.workflowId}/${run.runId}`, type: 'text', description: step.id },
        { name: 'offer', value: step.offer, type: 'text', description: loc(step.description) },
      ];
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

  private async persist(ownerGhii: string, run: WorkflowRun): Promise<void> {
    const key = runKey(run.workflowId, run.runId);
    const existing = await this.storage.getMemory(ownerGhii, key);
    const now = new Date().toISOString();
    await this.storage.setMemory({
      key, ownerGaii: ownerGhii, value: run,
      visibility: 'private', tags: ['workflow-run'], ttlHours: null,
      version: existing ? existing.version + 1 : 1,
      createdAt: existing?.createdAt ?? now, updatedAt: now,
    });
    await this.reconcileActive(ownerGhii, run);
  }
}
