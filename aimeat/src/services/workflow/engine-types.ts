/**
 * @file src/services/workflow/engine-types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What startRun takes and what it answers. Moved out of engine.ts on 2026-10-13 to
 *   stay under max-file-lines; engine.ts exports both again, so every import of them is unchanged.
 * @structure StartRunOpts · StartRunResult
 * @usage import type { StartRunOpts, StartRunResult } from './engine.js';
 * @version-history
 *   v1.0.0 — 2026-10-13 — Moved from engine.ts, plus StartRunOpts.event.
 */
import type { WorkflowCaller } from './step-authority.js';
import type { WorkflowEvent } from './workflow-event.js';

export interface StartRunOpts {
  // full-sandbox dispatches like full-live but namespaces every key under `wf-test.<runId>.` so a
  // test run never clobbers production keys (the dispatched step is told the prefix so a cooperating
  // agent writes there; signal eval reads/writes under it).
  mode: 'signals-only' | 'full-live' | 'full-sandbox';
  vars?: Record<string, string>;
  /** The principal starting the run, which answers for its steps (step-authority.ts). Absent for a
   *  run the workflow's own trigger starts: that answers to whoever saved it (trigger-authority.ts). */
  caller?: WorkflowCaller;
  /** The event a trigger starts this run for. It becomes the run's `event_*` variables, and where
   *  the definition says `coalesce` it waits when a run is already in flight (workflow-event.ts). */
  event?: WorkflowEvent;
}

/**
 * What startRun answers. `skipped: true` means NOTHING STARTED: a live run of this workflow is
 * already in flight, the definition does not set `parallel`, and `runId` is that run's id, not a
 * new one. Every door passes the flag on, because a skip that looks like a start is the failure no
 * metric shows (a partner's intake logged a case as started on exactly that, 2026-09-09). With
 * `refused`, nothing started either: a trigger's start found its saver gone or short of a word, and
 * `runId` is the refusal's record.
 */
export type StartRunResult =
  | { runId: string; skipped: boolean; refused?: string }
  | { error: string[]; denied?: { needed: string[]; message: string } };
