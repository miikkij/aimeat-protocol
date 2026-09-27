/**
 * @file src/services/workflow/engine-answer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How a step whose work runs on the node reports its outcome to the engine. The ai,
 *   extension and datapackage steps, and the reply of an ecosystem step, call the engine's
 *   onPushTerminal through reportOutcome, the one function that tells a failure of the step's own
 *   work from an error inside the engine.
 * @structure reportOutcome(work, done, failed, label)
 * @usage  engine-steps.ts and engine-ai-step.ts:
 *   reportOutcome(fire(), () => onPushTerminal(…, true), err => onPushTerminal(…, false), label);
 * @version-history
 *   v1.0.0 — 2026-09-26 — reportOutcome: only a failure of the step's own work fails the attempt, and
 *     an error inside the engine while it takes an answer in is logged as the engine's (secaudit
 *     2026-09, R4).
 */
import { logger } from '../../utils/logger.js';

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
