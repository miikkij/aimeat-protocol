/**
 * @file src/services/scheduler-run-limit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The time limit on one scheduled run. A handler whose promise never settles (a query
 *   the database never answers, a remote call with no timeout of its own) used to hold its job in
 *   Scheduler.executing for the life of the process: every later fire was written as skipped with
 *   "previous run still in progress" and the job row kept its last success. Now the run ends as an
 *   error when the limit passes, the job is freed, and the next fire runs.
 *
 *   THE LATE PROMISE. The handler cannot be cancelled, so it may settle after the limit. The run's
 *   result is decided by the race, and nothing the handler returns afterwards reaches the job row or
 *   the execution log; a late rejection is caught here so it is not an unhandled rejection.
 * @structure RUN_LIMIT_MS · runLimitFor(type, overrides) · RunTimeoutError · withRunLimit(work, ms) · describeMs(ms)
 * @usage const run = await withRunLimit(handler(), runLimitFor(job.type));
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit E4-04).
 */
import type { ScheduledJobRecord } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

type JobKind = ScheduledJobRecord['type'];

/**
 * The default limit per kind. Core jobs are the node's own maintenance and may walk large tables, so
 * they get ten minutes. A refinery batch reads up to fifty messages and asks a model about each, so
 * it gets thirty, the same as the stalled-batch limit in services/refinery/runs.ts. An `ai` run is
 * one model call that may be slow. The other kinds start something and return (a task, a workflow
 * run, a capability call, an extension action), so five minutes is generous.
 */
export const RUN_LIMIT_MS: Readonly<Record<JobKind | 'default', number>> = {
  core: 10 * 60_000,
  refinery: 30 * 60_000,
  ai: 10 * 60_000,
  extension: 5 * 60_000,
  agent_task: 5 * 60_000,
  workflow: 5 * 60_000,
  'eco-capability': 5 * 60_000,
  'connections-publish': 5 * 60_000,
  default: 5 * 60_000,
};

/** The limit for a kind: an override (tests, a later setting) first, then the default. */
export function runLimitFor(type: JobKind, overrides?: Partial<Record<JobKind | 'default', number>>): number {
  return overrides?.[type] ?? overrides?.default ?? RUN_LIMIT_MS[type] ?? RUN_LIMIT_MS.default;
}

/** A run that passed its limit. The message is what the run log and the owner see. */
export class RunTimeoutError extends Error {
  constructor(public readonly limitMs: number) {
    super(`The run did not finish and was stopped after ${describeMs(limitMs)}. The next run happens at its time.`);
    this.name = 'RunTimeoutError';
  }
}

/** A duration as a person reads it: "10 minutes", "45 seconds". */
export function describeMs(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) { const m = ms / 60_000; return `${m} minute${m === 1 ? '' : 's'}`; }
  if (ms >= 1000) { const s = Math.round(ms / 1000); return `${s} second${s === 1 ? '' : 's'}`; }
  return `${ms} ms`;
}

/**
 * Settle with the work, or reject with RunTimeoutError when `ms` passes first. The timer is cleared
 * when the work settles in time, and it does not keep the process alive.
 */
export function withRunLimit<T>(work: Promise<T>, ms: number, label = 'scheduled run'): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { timedOut = true; reject(new RunTimeoutError(ms)); }, ms);
    timer.unref?.();
  });
  // A rejection that arrives after the limit has no one waiting for it; it is logged, not thrown.
  work.catch((err: unknown) => {
    if (timedOut) logger.warn(`${label}: the run failed after its time limit had already ended it`, { error: String(err) });
  });
  return Promise.race([work, limit]).finally(() => { if (timer) clearTimeout(timer); });
}
