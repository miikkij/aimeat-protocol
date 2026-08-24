/**
 * @file onboarding-guide.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   - buildStuckHint()         -- failed steps / missing test task → support@operators + self-heal
 * @usage
 *   import { enrichSteps, buildStepGuide, buildOnboardingSummary } from '../services/onboarding-guide.js';
 * @version-history
 *   v1.2.0 -- 2026-08-24 -- buildStuckHint(): the escalation hint moves here from the REST route
 *                            (the MCP status tool never had it) and gains the pending-jam shape: an
 *                            accept_test_task step whose task does not exist can never pass, and
 *                            until now the status said 'pending' forever and named nobody to ask.
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

/**
 * The "you are stuck, and here is who to ask" hint, shared by the REST GET and the MCP status tool
 * so neither surface can drift.
 *
 * Two conditions produce it. A step with status 'failed' is where an agent starts inventing
 * remedies: it has tried, it has been told no, and without this nothing in the response said there
 * was anyone to ask. And a PENDING accept_test_task with no task behind it is the same jam without
 * the status ever saying so — the server failed to create the test task (or the task was deleted),
 * the step can never pass, and the agent polls an empty queue forever. That second shape is exactly
 * where the first organisation node's connector agent sat on 2026-08-24, with no escalation address
 * anywhere in what it read.
 *
 * `testTaskMissing` is the caller's verdict (it has already fetched the task record when the step
 * details carry an id): true when the accept step is pending and either no testTaskId exists or the
 * task it names is gone.
 *
 * Returns null when nothing is stuck, so callers can spread it conditionally.
 */
export function buildStuckHint(
  steps: AgentOnboardingStep[],
  agentName: string,
  testTaskMissing: boolean,
): Record<string, unknown> | null {
  const failed = steps.filter(s => s.status === 'failed').map(s => s.id);
  if (failed.length === 0 && !testTaskMissing) return null;
  return {
    ...(failed.length > 0 ? { steps: failed } : {}),
    ...(testTaskMissing
      ? {
          missing_test_task: true,
          self_heal: `The test task this flow requires does not exist, so accept_test_task can never pass as-is. POST /v1/agents/${agentName}/onboarding/start recreates it; steps already passed keep their status.`,
        }
      : {}),
    ask: 'support@operators',
    how: 'POST /v1/messages { "to": "support@operators", "subject": "<the step that will not pass>", "body": "<what you tried and what the node answered>" }, or aimeat_dm_send with the same fields. It reaches everyone who runs this node in one thread they answer in.',
  };
}
