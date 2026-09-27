/**
 * @file src/services/workflow/engine-answer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How a step whose work runs on the node reports its outcome to the engine. The ai,
 *   extension and datapackage steps, and the reply of an ecosystem step, call the engine's
 *   onPushTerminal through reportOutcome, the one function that tells a failure of the step's own
 *   work from an error inside the engine. The write an answer makes (a result key, a package
 *   version) is passed with the answer as a ResultWrite, and the engine makes it through writeResult
 *   only while the step still waits for an answer. When the engine fails while it takes an answer in,
 *   settleAnswer still saves what the answer cost and releases its hold.
 * @structure reportOutcome(work, done, failed, label) · ResultWrite · writeResult(write, label) ·
 *   settleAnswer(run, label, stepId, costUsd, call)
 * @usage  engine-steps.ts and engine-ai-step.ts:
 *   reportOutcome(fire(), write => onPushTerminal(…, true, …, write), err => onPushTerminal(…, false), label);
 * @version-history
 *   v1.2.0 — 2026-09-26 — settleAnswer: after an error inside the engine, the answer's cost and the
 *     release of its hold are saved on their own; when that save fails too, one error line names the
 *     run, the step and the amount (secaudit 2026-09, R4).
 *   v1.1.0 — 2026-09-26 — ResultWrite and writeResult: the write an answer makes, which the engine
 *     makes only while the step still waits for an answer (secaudit 2026-09, R4).
 *   v1.0.0 — 2026-09-26 — reportOutcome: only a failure of the step's own work fails the attempt, and
 *     an error inside the engine while it takes an answer in is logged as the engine's (secaudit
 *     2026-09, R4).
 */
import { logger } from '../../utils/logger.js';
import { aiCallAnswered, usd } from './run-cost.js';
import type { WorkflowRun } from '../../models/workflow-schemas.js';

/**
 * The write an answer makes: an ai or extension step's result key, or a datapackage step's new
 * version. The engine runs it under the run's lock, and only while the step still waits for an
 * answer (engine.ts onPushTerminal). Once the step has ended, an answer settles its cost and hold
 * and writes nothing.
 */
export type ResultWrite = () => Promise<void>;

/**
 * Make an answer's write, for a step that still waits for an answer. True when it was written, or
 * when there is nothing to write. False when the write failed: that fails the answer, and the reason
 * is logged here, as the step's.
 */
export async function writeResult(write: ResultWrite | undefined, label: string): Promise<boolean> {
  if (!write) return true;
  try {
    await write();
    return true;
  } catch (err) {
    logger.warn(`${label}: writing the step's answer failed`, { error: String(err) });
    return false;
  }
}

/**
 * After an error inside the engine while it took an answer in: read the run as last saved, and save
 * only that answer's cost and the release of its hold, when the saved run still marks the answer's
 * call as open. The mark goes in the same save as the cost, so the cost is counted once. When this
 * save fails too, one error line names the run, the step and the amount. The caller holds the run's
 * lock.
 */
export async function settleAnswer(
  run: { read: () => Promise<WorkflowRun | undefined>; save: (run: WorkflowRun) => Promise<void> },
  label: string, stepId: string, costUsd: number | undefined, call: number | undefined,
): Promise<void> {
  try {
    const saved = await run.read();
    const rs = saved?.steps[stepId];
    if (!saved || !rs || call === undefined || !(rs.openCalls ?? []).some(open => open.attempt === call)) return;
    aiCallAnswered(rs, call, costUsd);
    await run.save(saved);
  } catch (err) {
    logger.error(`${label}: the answer's cost of ${usd(costUsd ?? 0)} and the release of its hold were not saved`, { error: String(err) });
  }
}

/**
 * Report what a step's dispatched work did to the engine. `work` is the step's own work. When it
 * succeeds, `done` passes its value to the engine; when it fails, `failed` reports the attempt as
 * failed, and only that failure fails the attempt. An error inside the engine while it takes an
 * answer in is the engine's own: it is logged as the engine's, and the step stays as the engine last
 * saved it, for the watchdog to decide by the step's output or its timeout.
 */
export function reportOutcome<T>(
  work: Promise<T>,
  done: (value: T) => void | Promise<void>,
  failed: (err: unknown) => void | Promise<void>,
  label: string,
): void {
  work.then(done, failed).catch(err => {
    logger.error(`${label}: the engine failed while taking in the step's answer`, { error: String(err) });
  });
}
