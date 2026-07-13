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
 *   v1.1.0 -- 2026-07-14 -- Substitute {test_task_id} server-side from the accept_test_task step's
 *                            details.testTaskId (it was emitted as a literal placeholder, and the
 *                            hints no longer reliably carried the id -- connectors called
 *                            propose_todos with an empty task id).
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

/** Deep-substitute `{placeholder}` variables in every string within a JSON-ish value (returns a copy). */
function substituteVars<T>(value: T, vars: Record<string, string>): T {
  if (typeof value === 'string') {
    let out: string = value;
    for (const [key, replacement] of Object.entries(vars)) out = out.replaceAll(`{${key}}`, replacement);
    return out as unknown as T;
  }
  if (Array.isArray(value)) return value.map(v => substituteVars(v, vars)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = substituteVars(v, vars);
    return out as unknown as T;
  }
  return value;
}

/**
 * The real onboarding test task id, read from the accept_test_task step's details (stamped at
 * /start and at device-auth registration). undefined when the flow has no test task (workstation)
 * or the task has not been created yet -- then the `{test_task_id}` placeholder is left as-is.
 */
function testTaskIdFrom(steps: AgentOnboardingStep[]): string | undefined {
  const details = steps.find(s => s.id === 'accept_test_task')?.details as Record<string, unknown> | undefined;
  return typeof details?.testTaskId === 'string' ? details.testTaskId : undefined;
}

/** Resolve a step's howTo with `{name}` + `{test_task_id}` substituted, or null when the step id is unknown. */
function howToFor(stepId: string, agentName: string, testTaskId?: string): StepHowTo | null {
  const howTo = getStepHowTo(stepId);
  if (!howTo) return null;
  const vars: Record<string, string> = { name: agentName };
  if (testTaskId) vars.test_task_id = testTaskId;
  return substituteVars(howTo, vars);
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
  const testTaskId = testTaskIdFrom(steps);
  return steps.map(step => ({
    ...step,
    descriptionText: resolveText(step.description),
    howTo: howToFor(step.id, agentName, testTaskId),
  }));
}

/** Flow-scoped `{ [stepId]: StepHowTo }` -- only the steps in this agent's flow, `{name}` + `{test_task_id}`-substituted. */
export function buildStepGuide(steps: AgentOnboardingStep[], agentName: string): Record<string, StepHowTo> {
  const testTaskId = testTaskIdFrom(steps);
  const guide: Record<string, StepHowTo> = {};
  for (const step of steps) {
    const howTo = howToFor(step.id, agentName, testTaskId);
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
