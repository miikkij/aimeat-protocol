/**
 * @file src/services/scheduler-types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The scheduler's result types: what triggered a run, what a kind's executor returns,
 *   and the outcome a manual "Run now" reports. Moved out of scheduler.ts by pure extraction when
 *   that file reached the 800-line limit; scheduler.ts re-exports them, so no importer changes.
 * @structure JobTrigger · JobRunResult · JobOutcome
 * @usage import type { JobRunResult } from './scheduler.js';
 * @version-history
 *   v1.1.1 -- 2026-10-25 -- Outcome `stopped` also names a deactivated account's skipped fire (secaudit2026oct22).
 *   v1.1.0 — 2026-10-11 — Outcome `stopped` and `skipCode`, for a run skipped because the agent is stopped.
 *   v1.0.0 — 2026-10-02 — Extracted from scheduler.ts (max-file-lines), bodies verbatim.
 */

export type JobTrigger = 'cron' | 'manual' | 'activate';

/** Result returned by a kind-specific executor (memory I/O + optional spawned task). */
export interface JobRunResult {
  reads: string[];
  writes: string[];
  taskId?: string;
  /** The executor deliberately did nothing (e.g. an occurrence is still running). */
  skipped?: boolean;
  /** Human-readable explanation for a skip, surfaced to manual-trigger callers. */
  skipReason?: string;
  /** Why it was skipped, when the reason is not "a previous run is still going": the agent is stopped. */
  skipCode?: 'stopped';
}

/**
 * Outcome of one job execution, returned by triggerNow() so a manual "Run now"
 * can tell the owner what happened. `code` is a stable token the UI maps to a
 * localized message; `detail` carries the specific (English) explanation.
 *   created  — an agent_task occurrence was queued/activated (taskId set)
 *   ran      — a non-task job (ai/extension/core) executed successfully
 *   busy     — skipped: a previous occurrence is still running, or the job was
 *              already executing
 *   stopped  — skipped: the agent the schedule gives work to is stopped (services/agent-stop.ts).
 *              Nothing is queued for later; the next run happens at its time once it is started.
 *              Also: the account the job acts for is deactivated (services/account-deactivated.ts);
 *              the next run happens at its time once the account is reactivated
 *   limited  — skipped by a constraint (daily_limit / max_runs / budget)
 *   error    — the job ran but failed (detail = error message)
 */
export interface JobOutcome {
  code: 'created' | 'ran' | 'busy' | 'stopped' | 'limited' | 'error';
  taskId?: string;
  detail?: string;
}
