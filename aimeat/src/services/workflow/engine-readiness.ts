/**
 * @file src/services/workflow/engine-readiness.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which steps may start now, whether a human gate has anything to decide about, and
 *   what a run's step states add up to. Pure decision helpers, extracted from engine.ts to satisfy
 *   max-file-lines; a move, with no change to what any of them answers.
 * @structure TERMINAL_STEP_STATES · isHumanGate · gateHasSomethingToDecide · computeReadySteps ·
 *   runOutcome
 * @usage  imported by engine.ts, which re-exports computeReadySteps and runOutcome for its tests
 * @version-history
 *   v1.0.0 — 2026-09-04 — Extracted when the human-gate rule pushed engine.ts past 800 lines.
 */
import type { WorkflowDef, WorkflowRunStep, WorkflowStep } from '../../models/workflow-schemas.js';

export const TERMINAL_STEP_STATES = new Set<WorkflowRunStep['state']>(
  ['green', 'input-red', 'output-red', 'timed-out', 'skipped', 'agent-offline'],
);

/**
 * A HUMAN GATE IS ASKED WHENEVER THERE IS SOMETHING TO DECIDE ABOUT.
 *
 * Its `after` list says "ask once these have finished", not "ask only if they all succeeded". A
 * person is the one member of a run who can act on partial material, and a run where one producer
 * failed is exactly when their decision matters most. Reported from a real run on 2026-09-04: the
 * image step went red on a script that legitimately asked for no images, the whole subtree was
 * skipped, and the owner's final approval gate went with it. Every piece had been written and
 * nobody could approve any of it.
 *
 * "At least one green" is the whole rule, and it is what separates this from `resume`. When every
 * producer failed there is nothing to show, and a gate asked about nothing is worse than a gate
 * skipped: it asks a person to choose an angle from an empty list.
 */
export function isHumanGate(s: WorkflowStep): boolean { return s.action?.kind === 'human-input'; }

export function gateHasSomethingToDecide(s: WorkflowStep, steps: Record<string, WorkflowRunStep>): boolean {
  const deps = s.after ?? [];
  // A gate that waits for nothing is asked at once, exactly as before — it opens the run rather
  // than judging it, so there is no producer whose outcome could qualify it.
  if (!deps.length) return true;
  return deps.every(d => { const st = steps[d]?.state; return !!st && TERMINAL_STEP_STATES.has(st); })
    && deps.some(d => steps[d]?.state === 'green');
}

/**
 * The steps that may start now: pending, past any retry backoff, and their `after` deps satisfied.
 * "Satisfied" depends on the workflow's resume policy:
 *   - default: every `after` dep must be GREEN (a failed dep blocks the subtree — restart-and-skip).
 *   - resume:  every `after` dep must be TERMINAL (green OR failed) — `after` is ordering only; the
 *     step's OWN required_to_function (evaluated in tick) becomes the real gate, so a dependent whose
 *     input is present runs even when a parent timed out / went red.
 *   - a human gate: terminal deps AND at least one of them green, whatever the resume policy — see
 *     the note above. It consumes nothing, so there is no required_to_function to fall back on.
 * Pure — operates on the def + the current run-step map.
 */
export function computeReadySteps(def: WorkflowDef, steps: Record<string, WorkflowRunStep>, now: string): WorkflowStep[] {
  const resume = def.resume === true;
  return def.steps.filter(s => {
    const rs = steps[s.id];
    if (!rs || rs.state !== 'pending') return false;
    if (rs.notBefore && rs.notBefore > now) return false;
    if (isHumanGate(s) && !resume) return gateHasSomethingToDecide(s, steps);
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
