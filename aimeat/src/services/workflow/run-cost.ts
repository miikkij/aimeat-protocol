/**
 * @file src/services/workflow/run-cost.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What one run has spent on the owner's AI, through its ai steps and through the node's
 *   model judging its `llm` signals, and the per-run cap on it (WorkflowDef.maxCostUsd, in US dollars).
 *
 *   WHY DOLLARS. The cap used to be `costCapMorsels`, and nothing ever read it. It could not have
 *   worked if something had: a morsel paces what agents may store and signals what a person has
 *   contributed; it is not money and buys nothing. What an ai step spends is the provider's charge,
 *   which the node already records in US dollars for every completion (services/ai-completion.ts), so
 *   the cap is stated in the same unit as the thing it caps.
 *
 *   HOW IT STOPS. Each ai step keeps what its own model calls cost (`costUsd` on the run step), the
 *   node's `llm` judge keeps what it cost on the run (`signalCostUsd`, eval-context.ts), and the engine
 *   adds those up. Before it starts the next ai step, a run whose sum has reached the cap ends
 *   `stopped`: the steps not yet finished are skipped, and the run says which cap, how much was spent
 *   and which step did not start. The call that crossed the cap has already been answered and keeps
 *   its result, because a call cannot be refused after the provider has answered it. Past the cap the
 *   judge is not asked, and its leaf passes as it does when the judge is unavailable. A run with no
 *   cap is not touched.
 * @structure spendsAi(step) · spentUsd(run) · recordSignalCost(run, cost) · costCapReached(run) ·
 *   usd(amount) · stopAtCostCap(run, stepId, nowIso)
 * @usage
 *   if (spendsAi(step) && stopAtCostCap(run, step.id, now)) { stopped = true; break; }
 * @version-history
 *   v1.1.0 — 2026-09-26 — What the node's model costs judging a run's `llm` signals counts toward the
 *     cap (recordSignalCost, costCapReached), and the judge is not asked past it (secaudit 2026-09,
 *     A6-11). The stop reason says what the run spent on AI rather than what its ai steps spent.
 *   v1.0.0 — 2026-09-25 — Initial.
 */
import type { WorkflowRun, WorkflowStep } from '../../models/workflow-schemas.js';

/** Does starting this step spend the owner's AI? An ai step calls the owner's model. */
export function spendsAi(step: Pick<WorkflowStep, 'action'>): boolean {
  return step.action?.kind === 'ai';
}

/** A recorded cost that is an amount, else nothing. */
const amount = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * What the run has spent on the owner's AI, in US dollars: what its steps recorded as their own model
 * calls, and what the node's model cost judging the run's `llm` signals.
 */
export function spentUsd(run: Pick<WorkflowRun, 'steps' | 'signalCostUsd'>): number {
  let sum = amount(run.signalCostUsd);
  for (const rs of Object.values(run.steps)) sum += amount(rs.costUsd);
  return sum;
}

/** Add what one call of the node's `llm` judge cost to the run. Anything that is not an amount is not kept. */
export function recordSignalCost(run: Pick<WorkflowRun, 'signalCostUsd'>, costUsd: unknown): void {
  const add = amount(costUsd);
  if (add > 0) run.signalCostUsd = (run.signalCostUsd ?? 0) + add;
}

/** Has the run spent its cap? False when the workflow sets none. */
export function costCapReached(run: Pick<WorkflowRun, 'steps' | 'signalCostUsd' | 'defSnapshot'>): boolean {
  const cap = run.defSnapshot.maxCostUsd;
  return typeof cap === 'number' && cap > 0 && spentUsd(run) >= cap;
}

/** An amount as a person reads it: two decimals, more only when a cent would hide the amount. */
export function usd(amount: number): string {
  return `$${amount.toFixed(4).replace(/(\.\d{2}\d*?)0+$/, '$1')}`;
}

/**
 * Stop the run at its cost cap, before the ai step `stepId` starts, when the run has already spent
 * the cap on AI. Returns whether it stopped. The steps not yet finished are skipped, as a
 * cancel skips them: a task an agent is still working on finds its step no longer waiting and ends
 * there.
 */
export function stopAtCostCap(run: WorkflowRun, stepId: string, nowIso: string): boolean {
  if (!costCapReached(run)) return false;
  const cap = run.defSnapshot.maxCostUsd as number;
  const spent = spentUsd(run);
  for (const rs of Object.values(run.steps)) {
    if (rs.state === 'pending' || rs.state === 'dispatched' || rs.state === 'waiting-human') {
      rs.state = 'skipped';
      rs.endedAt = nowIso;
    }
  }
  run.status = 'stopped';
  run.endedAt = nowIso;
  run.costCap = { capUsd: cap, spentUsd: spent, stoppedBefore: stepId };
  run.reason = `Stopped before step "${stepId}": this run had spent ${usd(spent)} on AI, `
    + `and this workflow allows ${usd(cap)} per run (maxCostUsd).`;
  return true;
}
