/**
 * @file engine-inspector.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The inspection task a failed step raises: one task to the owner's
 *   `workflow-inspector` agent carrying the whole run's context, so a red step is diagnosed by
 *   somebody rather than only logged.
 * @structure dispatchInspector() — the only export; called by engine-steps.ts onStepFail()
 * @usage  imported by engine-steps.ts onStepFail(), best-effort: null when no inspector is installed
 * @version-history
 *   v1.0.0 — 2026-09-08 — Pure extraction from engine-steps.ts, which passed the 800-line cap.
 *     Body verbatim, same single caller. The one difference from engine-ai-step.ts, the sibling
 *     this follows: it names its own deps type instead of importing StepDeps back, because that
 *     import is a cycle and check:deps refuses a NEW one (the sibling's sits in the baseline).
 */
import { randomUUID } from 'node:crypto';
import type { Storage, AgentTaskRecord, AgentTaskScope } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { createWebhookDispatcher } from '../webhook-dispatcher.js';
import type { WorkflowRun, WorkflowRunStep } from '../../models/workflow-schemas.js';
import { buildGAII } from '../../utils/gaii.js';
import { runKey } from './store.js';
import { emitDelivery } from '../event-bus.js';

/**
 * What this module needs, named here rather than imported as engine-steps' StepDeps: engine-steps
 * imports this function, so taking its type back would be an import cycle and check:deps refuses a
 * new one. StepDeps satisfies this structurally, so the caller passes its own deps unchanged.
 */
export interface InspectorDeps {
  storage: Storage;
  config: AimeatConfig;
  webhookDispatcher?: ReturnType<typeof createWebhookDispatcher>;
}

/**
 * Queue a task to the owner's `workflow-inspector` agent (crew-owned) with full run context: the
 * run record (defSnapshot + every step's state + expected-vs-observed) is at a known memory key.
 * Tagged `workflow-inspect` (NOT `workflow-run`) so completing it never advances the run. Returns
 * the task id, or null when no inspector agent is installed.
 */
export async function dispatchInspector(deps: InspectorDeps, ownerGhii: string, ownerName: string, run: WorkflowRun, stepId: string, reason: WorkflowRunStep['state']): Promise<string | null> {
  const inspectorGaii = buildGAII('workflow-inspector', ownerName, deps.config.nodeId);
  const inspector = await deps.storage.getAgent(inspectorGaii);
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
  await deps.storage.createAgentTask(record);
  await deps.storage.appendTaskEvent({ id: randomUUID(), taskId: record.id, type: 'started', message: `Workflow inspection requested for "${run.workflowId}" step "${stepId}" (${reason})`, timestamp: now });
  deps.webhookDispatcher?.dispatchWebhookEvent(inspectorGaii, 'task.approved', {
    task_id: record.id, title: record.title, description: record.description ?? '',
    has_todos: false, todo_count: 0, scope_summary: scope.map(s => `${s.name}:${s.value}`),
    created_at: now, auto_activated: true, workflow_id: run.workflowId,
  });
  // The tunnel, the half engine-steps.ts had been missing at both of its creation points until
  // 2026-09-08. An inspection task exists because something already failed, so this is the one an
  // agent least deserves to sleep through. → pitfalls §58
  emitDelivery({ target: inspectorGaii, kind: 'task_assigned', id: record.id, payload: record });
  return record.id;
}
