/**
 * @file onboarding-test-task.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one place the Hello Integration test task is created. Every path that creates an
 *   onboarding whose flow carries `accept_test_task` calls this, because the paths that built the
 *   task inline drifted (queued vs active) and the paths that forgot it entirely stranded the agent:
 *   an agent registered through POST /v1/agents (the OAuth-consent "create agent" path) got the
 *   twelve-step flow with a required step 9 and an empty task queue, and sat there with nothing to
 *   accept and nothing telling it why.
 * @structure
 *   - createOnboardingTestTask(storage, agentGaii, ownerGhii, steps, titles?) — creates the task,
 *     stamps its id into the accept step's details, returns the id (null when the flow has no
 *     accept step).
 *   - isOnboardingTestTask(storage, task) — is this task THE smoke test of its agent's onboarding
 * @usage
 *   const steps = createDefaultSteps(mode);
 *   await createOnboardingTestTask(storage, gaii, `${owner}@${config.nodeId}`, steps);
 *   await storage.createOnboarding({ agentGaii: gaii, status: 'in_progress', startedAt: now, steps });
 * @version-history
 *   v1.1.0 — 2026-08-24 — isOnboardingTestTask(), for the completion guard in
 *     services/agent-task-fanout.ts. Reason on the function.
 *   v1.0.0 — 2026-08-24 — Extracted from routes/agent-onboarding.ts (onboarding/start) so the two
 *     registration paths that created onboarding without a test task can stop doing that.
 */
import { randomUUID } from 'node:crypto';
import type { Storage, AgentTaskRecord } from '../storage/interface.js';
import type { AgentOnboardingStep } from '../storage/interface.js';

/**
 * Create the Hello Integration smoke-test task and stamp its id into the `accept_test_task` step.
 *
 * The task is created `active` for EVERY mode: the owner-approval gate (queued → owner /start →
 * active) exists to guard REAL tasks, and the onboarding smoke test is a throwaway the agent should
 * be able to propose todos on, execute and complete without the owner clicking anything. The
 * `started` event is appended so the task's history matches an owner-approved start.
 *
 * Mutates `steps` in place (details.testTaskId) and returns the task id, or null when the flow
 * carries no `accept_test_task` step (nothing is created then).
 */
export async function createOnboardingTestTask(
  storage: Storage,
  agentGaii: string,
  ownerGhii: string,
  steps: AgentOnboardingStep[],
  titles?: { title: string; description: string },
): Promise<string | null> {
  const acceptStep = steps.find(s => s.id === 'accept_test_task');
  if (!acceptStep) return null;

  const testTaskId = randomUUID();
  const now = new Date().toISOString();
  await storage.createAgentTask({
    id: testTaskId,
    agentGaii,
    ownerGaii: ownerGhii,
    title: titles?.title ?? 'Onboarding verification',
    description: titles?.description
      ?? 'This is a test task created during Hello Integration. Propose todos, get approval, execute, and complete.',
    status: 'active',
    scope: [],
    rules: [],
    todos: [],
    verification: {
      userExpects: 'Agent completes the onboarding test task successfully',
      technicalChecks: [],
    },
    createdAt: now,
    updatedAt: now,
    lastEventAt: now,
  });
  await storage.appendTaskEvent({
    id: randomUUID(),
    taskId: testTaskId,
    type: 'started',
    message: 'Onboarding test task auto-started (Hello Integration smoke test — no owner approval needed)',
    timestamp: now,
  });
  acceptStep.details = { testTaskId };
  return testTaskId;
}

/**
 * Is `task` the Hello Integration smoke test of the agent it belongs to?
 *
 * The id is stamped in one place — the `accept_test_task` step's `details.testTaskId`, written by
 * the function above — so that stamp is the only thing that answers this. Nothing on the task record
 * marks it, deliberately: a flag there would be a second copy of the same fact, on the storage
 * layer, needing both providers and a migration to say what one read already says.
 *
 * Called only on the plan-less completion path (services/agent-task-fanout.ts), so a normal
 * completion pays nothing for it.
 */
export async function isOnboardingTestTask(
  storage: Storage,
  task: Pick<AgentTaskRecord, 'id' | 'agentGaii'>,
): Promise<boolean> {
  const onboarding = await storage.getOnboarding(task.agentGaii);
  if (!onboarding) return false;
  const details = onboarding.steps.find(s => s.id === 'accept_test_task')?.details as
    Record<string, unknown> | undefined;
  return details?.testTaskId === task.id;
}
