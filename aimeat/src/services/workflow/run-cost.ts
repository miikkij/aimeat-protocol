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
 *   WHAT IS SPENT. Each ai step keeps what its own model calls cost (`costUsd` on the run step), the
 *   node's `llm` judge keeps what it cost on the run (`signalCostUsd`, eval-context.ts), and the engine
 *   adds those up.
 *
 *   HOW THE CAP HOLDS WHEN STEPS RUN SIDE BY SIDE. What a call cost is known only when the provider
 *   answers, and the ai steps with no order between them start in the same pass. So before an ai step
 *   starts, the engine sets aside what the step is expected to cost (`reservedUsd` on the run step),
 *   and the step starts only when what the run has spent, what its running ai steps hold and that
 *   estimate stay within the cap. Steps that fit together still start together, and a step that fits
 *   starts even when one before it does not. A step that does not fit stays pending while another ai
 *   step runs, because that step's end gives back what it holds and puts its real cost in its place.
 *   With no ai step running, no room will come: the run ends `stopped`, the steps not yet finished
 *   are skipped, and the run says which cap, how much was spent, which step did not start and, when
 *   the step's estimate is what did not fit, that estimate. A reservation is held only while
 *   its step runs, and it is kept on the run record, so a restart does not lose it. A call that has
 *   started keeps its result, because a call cannot be refused after the provider has answered it.
 *   Past the cap the judge is not asked, and its leaf passes as it does when the judge is unavailable.
 *   A run with no cap is not touched.
 *
 *   THE ESTIMATE. The most the step cost in the workflow's last COST_HISTORY_RUNS finished runs that
 *   ran it with the same action, read once when the run starts and kept on the step (`estimateUsd`).
 *   A step's cost moves with its prompt, its input and its model; the highest recent cost is one that
 *   has already happened, and a changed action starts its history again. A step with no such run gets
 *   an equal share of the part of the cap nobody holds, split across the ai steps not yet started, so
 *   a first run can still spend past the cap by what its steps cost beyond their shares. Every step
 *   still running holds its own estimate, so a step that costs more than its estimate takes the run
 *   past the cap by that difference, never by a whole pass of steps.
 * @structure spendsAi(step) · capUsd(def) · spentUsd(run) · reservedUsd(run) · recordSignalCost(run,
 *   cost) · costCapReached(run) · usd(amount) · pinCostEstimates(def, steps, past) · admitAiStep(run,
 *   stepId) · stopWhenNoRoomComes(run, waitingIds, nowIso) · dropEndedReservations(run)
 * @usage
 *   if (spendsAi(step) && admitAiStep(run, step.id) === 'wait') { waiting.add(step.id); continue; }
 *   // after the pass: if (stopWhenNoRoomComes(run, [...waiting], now)) stopped = true;
 * @version-history
 *   v1.2.0 — 2026-09-26 — An ai step holds what it is expected to cost while it runs, and starts only
 *     when that fits under the cap beside what is spent and held; one that does not fit waits for the
 *     running ai steps, and the run stops when none is running (admitAiStep, stopWhenNoRoomComes,
 *     pinCostEstimates, reservedUsd, dropEndedReservations; secaudit 2026-09, A6-11).
 *   v1.1.0 — 2026-09-26 — What the node's model costs judging a run's `llm` signals counts toward the
 *     cap (recordSignalCost, costCapReached), and the judge is not asked past it (secaudit 2026-09,
 *     A6-11). The stop reason says what the run spent on AI rather than what its ai steps spent.
 *   v1.0.0 — 2026-09-25 — Initial.
 */
import type { WorkflowDef, WorkflowRun, WorkflowRunStep, WorkflowStep } from '../../models/workflow-schemas.js';
import { stableStringify } from '../../utils/stable-json.js';

/** How many of the workflow's latest finished runs an ai step's estimate is read from. */
export const COST_HISTORY_RUNS = 10;

/** The run statuses after which every step's cost is final. `refused` ran nothing. */
const FINISHED = new Set<WorkflowRun['status']>(['done', 'partial', 'red', 'stopped', 'cancelled']);

/** Slack for adding up dollar amounts in floating point: a billionth of a dollar. */
const EPSILON_USD = 1e-9;

/** Does starting this step spend the owner's AI? An ai step calls the owner's model. */
export function spendsAi(step: Pick<WorkflowStep, 'action'>): boolean {
  return step.action?.kind === 'ai';
}

/** A recorded cost that is an amount, else nothing. */
const amount = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** The workflow's cap in US dollars, or null when it sets none. */
export function capUsd(def: Pick<WorkflowDef, 'maxCostUsd'>): number | null {
  const cap = amount(def.maxCostUsd);
  return cap > 0 ? cap : null;
}

/**
 * What the run has spent on the owner's AI, in US dollars: what its steps recorded as their own model
 * calls, and what the node's model cost judging the run's `llm` signals.
 */
export function spentUsd(run: Pick<WorkflowRun, 'steps' | 'signalCostUsd'>): number {
  let sum = amount(run.signalCostUsd);
  for (const rs of Object.values(run.steps)) sum += amount(rs.costUsd);
  return sum;
}

/** What the run's running ai steps hold of the cap: the reservation of every step still dispatched. */
export function reservedUsd(run: Pick<WorkflowRun, 'steps'>): number {
  let sum = 0;
  for (const rs of Object.values(run.steps)) if (rs.state === 'dispatched') sum += amount(rs.reservedUsd);
  return sum;
}

/** Add what one call of the node's `llm` judge cost to the run. Anything that is not an amount is not kept. */
export function recordSignalCost(run: Pick<WorkflowRun, 'signalCostUsd'>, costUsd: unknown): void {
  const add = amount(costUsd);
  if (add > 0) run.signalCostUsd = (run.signalCostUsd ?? 0) + add;
}

/** Has the run spent its cap? False when the workflow sets none. What running steps hold is not spent. */
export function costCapReached(run: Pick<WorkflowRun, 'steps' | 'signalCostUsd' | 'defSnapshot'>): boolean {
  const cap = capUsd(run.defSnapshot);
  return cap !== null && spentUsd(run) >= cap;
}

/** An amount as a person reads it: two decimals, more only when a cent would hide the amount. */
export function usd(amount: number): string {
  return `$${amount.toFixed(4).replace(/(\.\d{2}\d*?)0+$/, '$1')}`;
}

/**
 * Give each ai step of a run about to start its estimate, when the workflow has a cap: the most the
 * step cost in the workflow's last COST_HISTORY_RUNS finished runs in which it had the same action.
 * `past` is the workflow's runs, newest first (store.ts listRuns). A step with no such run gets none.
 */
export function pinCostEstimates(
  def: Pick<WorkflowDef, 'maxCostUsd' | 'steps'>, steps: Record<string, WorkflowRunStep>, past: WorkflowRun[],
): void {
  if (capUsd(def) === null) return;
  const recent = past.filter(r => FINISHED.has(r.status)).slice(0, COST_HISTORY_RUNS);
  for (const step of def.steps) {
    if (!spendsAi(step) || !steps[step.id]) continue;
    const action = stableStringify(step.action);
    let most = 0;
    for (const r of recent) {
      const then = r.defSnapshot?.steps?.find(s => s.id === step.id);
      if (!then || stableStringify(then.action) !== action) continue;
      most = Math.max(most, amount(r.steps?.[step.id]?.costUsd));
    }
    if (most > 0) steps[step.id].estimateUsd = most;
  }
}

/** What ai step `stepId` is expected to cost: its estimate, else an equal share of the unheld cap. */
function expectedUsd(run: WorkflowRun, stepId: string, cap: number, spent: number, held: number): number {
  const estimate = amount(run.steps[stepId]?.estimateUsd);
  if (estimate > 0) return estimate;
  const free = cap - spent - held;
  if (free <= 0) return 0;
  const notStarted = run.defSnapshot.steps.filter(s => spendsAi(s) && run.steps[s.id]?.state === 'pending').length;
  return free / Math.max(1, notStarted);
}

/** Is an ai step of the run running, its model call not yet answered? */
function aiStepRunning(run: WorkflowRun): boolean {
  return run.defSnapshot.steps.some(s => spendsAi(s) && run.steps[s.id]?.state === 'dispatched');
}

/**
 * May the ai step `stepId`, ready to start, start now? `start`: yes, and under a cap it now holds its
 * estimate (`reservedUsd`). `wait`: its estimate does not fit beside what the run has spent and what
 * its running ai steps hold; the step stays pending. The engine asks every ready step first, so a
 * step that fits starts even when one before it does not, and then asks stopWhenNoRoomComes.
 */
export function admitAiStep(run: WorkflowRun, stepId: string): 'start' | 'wait' {
  const cap = capUsd(run.defSnapshot);
  if (cap === null) return 'start';
  const spent = spentUsd(run);
  const held = reservedUsd(run);
  const expected = expectedUsd(run, stepId, cap, spent, held);
  if (spent + held < cap && spent + held + expected <= cap + EPSILON_USD) {
    run.steps[stepId].reservedUsd = expected;
    return 'start';
  }
  return 'wait';
}

/**
 * The ai steps `waitingIds` are waiting for room under the cap. While another ai step runs, its end
 * gives back what it holds, so they keep waiting. With none running no room will come, and the run
 * stops at its cap before the first of them in the definition's order. Returns whether it stopped.
 */
export function stopWhenNoRoomComes(run: WorkflowRun, waitingIds: readonly string[], nowIso: string): boolean {
  const cap = capUsd(run.defSnapshot);
  const first = run.defSnapshot.steps.find(s => waitingIds.includes(s.id));
  if (cap === null || !first || aiStepRunning(run)) return false;
  const spent = spentUsd(run);
  // With nothing held, only a step's own estimate can fail to fit before the cap is spent.
  const needed = spent < cap ? amount(run.steps[first.id]?.estimateUsd) : 0;
  stopAtCostCap(run, first.id, nowIso, cap, spent, needed > 0 ? needed : undefined);
  return true;
}

/**
 * End the run at its cost cap, before the ai step `stepId` starts. The steps not yet finished are
 * skipped, as a cancel skips them: a task an agent is still working on finds its step no longer
 * waiting and ends there. `neededUsd` is the step's estimate when that is what did not fit.
 */
function stopAtCostCap(run: WorkflowRun, stepId: string, nowIso: string, cap: number, spent: number, neededUsd?: number): void {
  for (const rs of Object.values(run.steps)) {
    if (rs.state === 'pending' || rs.state === 'dispatched' || rs.state === 'waiting-human') {
      rs.state = 'skipped';
      rs.endedAt = nowIso;
    }
  }
  run.status = 'stopped';
  run.endedAt = nowIso;
  run.costCap = { capUsd: cap, spentUsd: spent, stoppedBefore: stepId, ...(neededUsd ? { neededUsd } : {}) };
  run.reason = neededUsd
    ? `Stopped before step "${stepId}": it was expected to cost ${usd(neededUsd)}, the most it cost in this `
      + `workflow's recent runs. This run had spent ${usd(spent)} on AI, and this workflow allows ${usd(cap)} `
      + 'per run (maxCostUsd), so the step did not fit.'
    : `Stopped before step "${stepId}": this run had spent ${usd(spent)} on AI, `
      + `and this workflow allows ${usd(cap)} per run (maxCostUsd).`;
}

/**
 * A reservation is held only while its step runs. Drop the one of every step that is no longer
 * dispatched, whatever ended it: its own end, a retry, a timeout, a cancel or a stop. The engine calls
 * this each time it saves a run, so a finished, cancelled or stopped run holds none.
 */
export function dropEndedReservations(run: Pick<WorkflowRun, 'steps'>): void {
  for (const rs of Object.values(run.steps)) if (rs.state !== 'dispatched' && rs.reservedUsd !== undefined) delete rs.reservedUsd;
}
