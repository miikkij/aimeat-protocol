/**
 * @file onboarding-guide.ts
 * @description Builds the machine-readable Hello Integration guidance attached to the
 *   onboarding status payload: per-step `descriptionText` + `howTo`, a flow-scoped
 *   `step_guide`, and a reachability `summary`. A connector drives onboarding from this
 *   (calling the exact tool named per pending step) instead of fabricating
 *   `aimeat_onboarding_<stepId>`. Single source so the REST GET and MCP status surfaces
 *   never drift.
 * @structure
 *   - enrichSteps()            -- per-step descriptionText + howTo (on a copy, never persisted)
 *   - buildStepGuide()         -- { [stepId]: StepHowTo } for the steps in this agent's flow
 *   - buildOnboardingSummary() -- required/optional counts + completable + next_required_step
 * @usage
 *   import { enrichSteps, buildStepGuide, buildOnboardingSummary } from '../services/onboarding-guide.js';
 * @version-history
 *   v1.0.0 -- 2026-06-30 -- Initial creation: deterministic Hello Integration completion guidance.
 */

import type { AgentOnboardingStep } from '../storage/interface.js';
import { getStepHowTo, type StepHowTo } from '../models/agent-onboarding-schemas.js';

export interface EnrichedStep extends AgentOnboardingStep {
  /** Localised, human-readable resolution of `description` (which is an i18n key). */
  descriptionText: string;
  /** How to complete this step (tool + args), or null when the step id has no mapping. */
  howTo: StepHowTo | null;
}

export interface OnboardingSummary {
  required_total: number;
  required_passed: number;
  required_remaining: number;
  optional_total: number;
  optional_passed: number;
  optional_remaining: number;
  /** true once every required step has passed -- the agent can stop here. */
  completable: boolean;
  /** First not-yet-passed required step id (pending or failed), or null when none remain. */
  next_required_step: string | null;
  /** Ids of pending optional steps (these never block completion). */
  optional_pending: string[];
}

/** Deep-substitute `{name}` in every string within a JSON-ish value (returns a copy). */
function substituteName<T>(value: T, name: string): T {
  if (typeof value === 'string') return value.replaceAll('{name}', name) as unknown as T;
  if (Array.isArray(value)) return value.map(v => substituteName(v, name)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = substituteName(v, name);
    return out as unknown as T;
  }
  return value;
}

/** Resolve a step's howTo with `{name}` substituted, or null when the step id is unknown. */
function howToFor(stepId: string, agentName: string): StepHowTo | null {
  const howTo = getStepHowTo(stepId);
  return howTo ? substituteName(howTo, agentName) : null;
}

/**
 * Returns a COPY of `steps` with `descriptionText` (resolved via `resolveText`) and `howTo`
 * attached. Never mutates the input -- the persisted onboarding record is untouched.
 */
export function enrichSteps(
  steps: AgentOnboardingStep[],
  resolveText: (key: string) => string,
  agentName: string,
): EnrichedStep[] {
  return steps.map(step => ({
    ...step,
    descriptionText: resolveText(step.description),
    howTo: howToFor(step.id, agentName),
  }));
}

/** Flow-scoped `{ [stepId]: StepHowTo }` -- only the steps in this agent's flow, `{name}`-substituted. */
export function buildStepGuide(steps: AgentOnboardingStep[], agentName: string): Record<string, StepHowTo> {
  const guide: Record<string, StepHowTo> = {};
  for (const step of steps) {
    const howTo = howToFor(step.id, agentName);
    if (howTo) guide[step.id] = howTo;
  }
  return guide;
}

/**
 * Reachability summary. Completion gates ONLY on required steps; optional steps (declare_services +
 * the offers ladder) never block. All counts derive from the actual step list, so reduced
 * task-runner/workstation flows report their own totals.
 */
export function buildOnboardingSummary(steps: AgentOnboardingStep[]): OnboardingSummary {
  const required = steps.filter(s => s.required);
  const optional = steps.filter(s => !s.required);
  const requiredPassed = required.filter(s => s.status === 'passed').length;
  const optionalPassed = optional.filter(s => s.status === 'passed').length;
  return {
    required_total: required.length,
    required_passed: requiredPassed,
    required_remaining: required.length - requiredPassed,
    optional_total: optional.length,
    optional_passed: optionalPassed,
    optional_remaining: optional.length - optionalPassed,
    completable: required.every(s => s.status === 'passed'),
    next_required_step: required.find(s => s.status !== 'passed')?.id ?? null,
    optional_pending: optional.filter(s => s.status === 'pending').map(s => s.id),
  };
}
