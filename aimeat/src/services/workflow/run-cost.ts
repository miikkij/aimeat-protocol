/**
 * @file src/services/workflow/run-cost.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What one run's ai steps have spent on the owner's AI, and the per-run cap on it
 *   (WorkflowDef.maxCostUsd, in US dollars).
 *
 *   WHY DOLLARS. The cap used to be `costCapMorsels`, and nothing ever read it. It could not have
 *   worked if something had: a morsel paces what agents may store and signals what a person has
 *   contributed; it is not money and buys nothing. What an ai step spends is the provider's charge,
 *   which the node already records in US dollars for every completion (services/ai-completion.ts), so
 *   the cap is stated in the same unit as the thing it caps.
 *
 *   HOW IT STOPS. Each ai step keeps what its own model calls cost (`costUsd` on the run step), and the
 *   engine adds those up. Before it starts the next ai step, a run whose sum has reached the cap ends
 *   `stopped`: the steps not yet finished are skipped, and the run says which cap, how much was spent
 *   and which step did not start. The step that crossed the cap has already finished and keeps its
 *   result, because a call cannot be refused after the provider has answered it. A run with no cap is
 *   not touched.
 * @structure spendsAi(step) · spentUsd(run) · usd(amount) · stopAtCostCap(run, stepId, nowIso)
 * @usage
 *   if (spendsAi(step) && stopAtCostCap(run, step.id, now)) { stopped = true; break; }
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial.
 */
import type { WorkflowRun, WorkflowStep } from '../../models/workflow-schemas.js';

/** Does starting this step spend the owner's AI? An ai step calls the owner's model. */
export function spendsAi(step: Pick<WorkflowStep, 'action'>): boolean {
  return step.action?.kind === 'ai';
}

/** What the run's steps have recorded as their own AI cost, in US dollars. */
export function spentUsd(run: Pick<WorkflowRun, 'steps'>): number {
  let sum = 0;
  for (const rs of Object.values(run.steps)) {
    if (typeof rs.costUsd === 'number' && Number.isFinite(rs.costUsd) && rs.costUsd > 0) sum += rs.costUsd;
  }
  return sum;
}

/** An amount as a person reads it: two decimals, more only when a cent would hide the amount. */
export function usd(amount: number): string {
  return `$${amount.toFixed(4).replace(/(\.\d{2}\d*?)0+$/, '$1')}`;
}

/**
 * Stop the run at its cost cap, before the ai step `stepId` starts, when the run's ai steps have
 * already spent the cap. Returns whether it stopped. The steps not yet finished are skipped, as a
 * cancel skips them: a task an agent is still working on finds its step no longer waiting and ends
 * there.
 */
export function stopAtCostCap(run: WorkflowRun, stepId: string, nowIso: string): boolean {
  const cap = run.defSnapshot.maxCostUsd;
  if (typeof cap !== 'number' || !(cap > 0)) return false;
  const spent = spentUsd(run);
  if (spent < cap) return false;
  for (const rs of Object.values(run.steps)) {
    if (rs.state === 'pending' || rs.state === 'dispatched' || rs.state === 'waiting-human') {
      rs.state = 'skipped';
      rs.endedAt = nowIso;
    }
  }
  run.status = 'stopped';
  run.endedAt = nowIso;
  run.costCap = { capUsd: cap, spentUsd: spent, stoppedBefore: stepId };
  run.reason = `Stopped before step "${stepId}": the AI steps of this run had spent ${usd(spent)}, `
    + `and this workflow allows ${usd(cap)} per run (maxCostUsd).`;
  return true;
}
