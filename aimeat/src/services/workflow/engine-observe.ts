/**
 * @file src/services/workflow/engine-observe.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a step's signals observed: a signal evaluated with the keys it read recorded,
 *   a dispatched step's fill progress sampled from what its success signal saw, and a signals-only
 *   run's verdicts. Moved out of engine.ts unchanged to satisfy max-file-lines.
 * @structure evalSignal(signal, ctx, reads) · recordProgress(rs, observed) · evalRunSignals(…)
 * @usage  imported by engine.ts: `const out = await evalSignal(r?.success_signal, ctx, reads);`
 * @version-history
 *   v1.1.0 — 2026-09-26 — evalRunSignals: the loop of engine.ts runSignalsOnly, moved here unchanged
 *     (max-file-lines). The engine saves the run after it, as before.
 *   v1.0.0 — 2026-09-25 — Moved from engine.ts (the private evalSignal and recordProgress), to make
 *     room there for the run's cost cap and the trigger's check of who saved the workflow.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { evaluateSignal, extractProgress, type SignalEvalCtx } from './signal-eval.js';
import { buildEvalCtx } from './eval-context.js';
import { runOutcome } from './engine-readiness.js';
import type { ResolvedStep } from './store.js';
import type { Signal, WorkflowRun, WorkflowRunStep } from '../../models/workflow-schemas.js';

/** Evaluate a signal (or 'none'/undefined → pass), accumulating the keys it reads. */
export async function evalSignal(signal: Signal | 'none' | undefined, ctx: SignalEvalCtx, reads: Set<string>): Promise<{ ok: boolean; observed: unknown }> {
  if (!signal || signal === 'none') return { ok: true, observed: { skipped: 'none' } };
  // wrap ctx.read/listGlob to record reads
  const tracking: SignalEvalCtx = {
    ...ctx,
    read: async (k) => { reads.add(k); return ctx.read(k); },
    listGlob: async (g) => { reads.add(g); return ctx.listGlob(g); },
  };
  return evaluateSignal(signal, tracking);
}

/**
 * Sample a dispatched step's fill progress from its success-signal `observed` (count_nonempty
 * leaves). Records rs.progress and returns whether the count rose since the last sample — the
 * watchdog treats a rising count as "still filling" (slides the no-progress deadline) and a flat
 * one as "stuck". No-op (returns false) for signals with no countable leaf.
 */
export function recordProgress(rs: WorkflowRunStep, observed: unknown): boolean {
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
 * signals-only: evaluate every step's input + output against existing memory; no dispatch. Sets each
 * step's verdict and the run's outcome; engine.ts runSignalsOnly saves the run after it.
 */
export async function evalRunSignals(storage: Storage, config: AimeatConfig, ownerGhii: string, run: WorkflowRun, resolved: Map<string, ResolvedStep>): Promise<void> {
  const ctx = buildEvalCtx(storage, config, ownerGhii, run);
  for (const step of run.defSnapshot.steps) {
    const r = resolved.get(step.id);
    const rs = run.steps[step.id];
    const reads = new Set<string>();
    // input
    const input = await evalSignal(r?.required_to_function, ctx, reads);
    if (!input.ok) { rs.state = 'input-red'; rs.inputObserved = input.observed; rs.reads = [...reads]; continue; }
    // output
    const output = await evalSignal(r?.success_signal, ctx, reads);
    rs.outputObserved = output.observed;
    rs.reads = [...reads];
    rs.state = output.ok ? 'green' : 'output-red';
  }
  run.status = runOutcome(run.steps);
  run.endedAt = new Date().toISOString();
}
