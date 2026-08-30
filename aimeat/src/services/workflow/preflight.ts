/**
 * @file src/services/workflow/preflight.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a person is told before a run starts (design canvas "AIMEAT Työnkulkujen sivu",
 *   the confirmation): which agents get a task, which steps are already satisfied in memory and
 *   will be skipped, how long the run may take, what the last real run took, and the variables the
 *   run would resolve to. The signals are evaluated against memory now, the way a check does, but
 *   nothing is persisted: a preflight is a question, not a run and not a check.
 * @structure preflightWorkflow
 * @usage const p = await preflightWorkflow({ storage, config, engine }, ownerGhii, ownerName, id, vars);
 * @version-history
 *   v1.0.0 — 2026-08-30 — Initial.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { WorkflowEngine } from './engine.js';
import type { WorkflowRun, WorkflowRunStep } from '../../models/workflow-schemas.js';
import { getWorkflow, validateWorkflow, listRuns } from './store.js';
import { buildEvalCtx } from './eval-context.js';
import { evaluateSignal } from './signal-eval.js';

export interface PreflightStep {
  id: string;
  kind: string;
  agents: string[];
  offer: string;
  after: string[];
  timeoutMin: number;
  /** What memory says now: green = already produced, input-red = its input is missing, output-red = not produced. */
  now: 'green' | 'input-red' | 'output-red';
  /** True when skip_done is on and the step is green now, so a run would not dispatch it. */
  willSkip: boolean;
}

export interface Preflight {
  workflowId: string;
  vars: Record<string, string>;
  agents: string[];
  steps: PreflightStep[];
  willRun: string[];
  skipDone: boolean;
  /** The longest chain of step timeouts along the after-edges: the most a run may take before every step has timed out. */
  maxMinutes: number;
  lastRun: { startedAt: string; endedAt?: string; status: string; durationMs?: number } | null;
}

export type PreflightResult = { ok: true; preflight: Preflight } | { ok: false; errors: string[] };

const HUMAN_TIMEOUT_MIN = 1440;

export async function preflightWorkflow(
  deps: { storage: Storage; config: AimeatConfig; engine: WorkflowEngine },
  ownerGhii: string,
  ownerName: string,
  workflowId: string,
  varOverrides?: Record<string, string>,
): Promise<PreflightResult> {
  const { storage, config, engine } = deps;
  const def = await getWorkflow(storage, ownerGhii, workflowId);
  if (!def) return { ok: false, errors: [`workflow "${workflowId}" not found`] };
  const v = await validateWorkflow(storage, config, ownerName, def);
  if (!v.ok || !v.resolved) return { ok: false, errors: v.errors };

  // The same run object startRun builds, minus the persist: the eval context reads memory through it.
  const runId = randomUUID();
  const vars = engine.resolveVars(def, varOverrides, runId);
  const steps: Record<string, WorkflowRunStep> = {};
  for (const s of def.steps) steps[s.id] = { state: 'pending', attempt: 0, reads: [], writes: [] };
  const run: WorkflowRun = {
    runId, workflowId, defSnapshot: def, resolved: v.resolved, vars,
    mode: 'signals-only', keyPrefix: '', status: 'running', steps, startedAt: new Date().toISOString(),
  };
  const ctx = buildEvalCtx(storage, config, ownerGhii, run);
  const resolved = new Map(v.resolved.map(r => [r.stepId, r]));

  const out: PreflightStep[] = [];
  for (const step of def.steps) {
    const r = resolved.get(step.id);
    const kind = step.action?.kind ?? 'agent';
    const timeoutMin = step.timeout_min ?? (kind === 'human-input' ? HUMAN_TIMEOUT_MIN : 60);
    let now: PreflightStep['now'] = 'output-red';
    const input = r?.required_to_function && r.required_to_function !== 'none'
      ? await evaluateSignal(r.required_to_function, ctx) : { ok: true };
    if (!input.ok) now = 'input-red';
    else if (r?.success_signal) now = (await evaluateSignal(r.success_signal, ctx)).ok ? 'green' : 'output-red';
    const agents = r?.agents ?? (Array.isArray(step.agent) ? step.agent : step.agent ? [step.agent] : []);
    out.push({
      id: step.id, kind, agents, offer: step.offer ?? kind, after: step.after ?? [], timeoutMin, now,
      willSkip: !!def.skip_done && now === 'green',
    });
  }

  // The longest timeout chain along the after-edges, in definition order (the graph is a DAG, and
  // save-time validation put every dependency before its dependents).
  const chain = new Map<string, number>();
  for (const s of out) {
    const before = Math.max(0, ...s.after.map(a => chain.get(a) ?? 0));
    chain.set(s.id, before + (s.willSkip ? 0 : s.timeoutMin));
  }
  const last = (await listRuns(storage, ownerGhii, workflowId))[0] ?? null;
  return {
    ok: true,
    preflight: {
      workflowId, vars,
      agents: [...new Set(out.filter(s => !s.willSkip).flatMap(s => s.agents))],
      steps: out,
      willRun: out.filter(s => !s.willSkip).map(s => s.id),
      skipDone: !!def.skip_done,
      maxMinutes: Math.max(0, ...chain.values()),
      lastRun: last ? {
        startedAt: last.startedAt, endedAt: last.endedAt, status: last.status,
        durationMs: last.endedAt ? new Date(last.endedAt).getTime() - new Date(last.startedAt).getTime() : undefined,
      } : null,
    },
  };
}
