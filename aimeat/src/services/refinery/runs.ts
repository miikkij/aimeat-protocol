/**
 * @file src/services/refinery/runs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Refinery runs as the node keeps them while they work: start one in the background
 *   and answer at once with its id, then let the page, an agent or a schedule ask how far it is.
 *   A run lives in this process for an hour after it finishes; what lasts is written by the batch
 *   itself (the rows, the log rows, `<prefix>.cursor` and `<prefix>.runs`).
 *
 *   ONE RUN PER DEFINITION AT A TIME. A second start while one runs answers with the one running,
 *   so a page that is opened twice, or a schedule that fires during a person's batch, cannot read the
 *   same page of mail twice and race each other's cursor.
 * @structure startRun · getRun · runningFor
 * @usage const run = startRun(deps, caller, 'postinjalostamo', {}); … getRun(run.id, caller.ownerGhii)
 *
 *   A RUN THAT DOES NOT FINISH IS STALLED, NOT RUNNING. A batch still marked running STALL_MS after
 *   it started is marked failed as stalled when the next start asks, so a batch whose promise never
 *   settles cannot answer every later start with itself for the life of the process. If it settles
 *   afterwards, its late result does not overwrite the failed state.
 * @version-history
 *   2026-10-16 — A run still marked running STALL_MS (30 minutes) after its start is marked failed as
 *     stalled, and a new start begins a new run (QA audit E4-04).
 *   v1.0.0 — 2026-09-29 — Initial (wish aimeat-refinery).
 */
import { randomBytes } from 'node:crypto';
import { logger } from '../../utils/logger.js';
import { runBatch, RefineryError, type RefineryCaller, type RefineryDeps, type RunState } from './pipeline.js';

const KEEP_MS = 60 * 60 * 1000;
/** A batch still running this long after its start is stalled. The scheduler's refinery run limit is the same. */
export const STALL_MS = 30 * 60 * 1000;
const runs = new Map<string, { owner: string; state: RunState; finished?: number }>();

function sweep(): void {
  const now = Date.now();
  for (const [id, r] of runs) if (r.finished && now - r.finished > KEEP_MS) runs.delete(id);
}

/** The run of this owner's definition that is still working, if one is. A stalled one is marked failed. */
export function runningFor(ownerGhii: string, prefix: string): RunState | null {
  const now = Date.now();
  for (const r of runs.values()) {
    if (r.owner !== ownerGhii || r.state.prefix !== prefix || r.state.status !== 'running') continue;
    if (now - Date.parse(r.state.startedAt) <= STALL_MS) return r.state;
    r.state.status = 'failed';
    r.state.error = `stalled: the batch did not finish within ${STALL_MS / 60_000} minutes of its start`;
    r.state.finishedAt = new Date(now).toISOString();
    r.finished = now;
    logger.warn('refinery: a batch stalled and was marked failed', { prefix, run: r.state.id });
  }
  return null;
}

/**
 * Start a batch in the background. Returns the run at once; `done` settles when it finishes, for a
 * caller that wants to wait (the scheduler, an agent that asked to).
 */
export function startRun(
  deps: RefineryDeps, caller: RefineryCaller, prefix: string, opts: { messageIds?: string[]; by?: string },
): { run: RunState; done: Promise<RunState>; already: boolean } {
  sweep();
  const busy = runningFor(caller.ownerGhii, prefix);
  if (busy) return { run: busy, done: Promise.resolve(busy), already: true };
  const run: RunState = {
    id: 'rr-' + Date.now().toString(36) + '-' + randomBytes(3).toString('hex'),
    prefix, status: 'running', startedAt: new Date().toISOString(), n: 0, i: 0, step: '', subject: '',
    counts: { seen: 0, clear: 0, unclear: 0, bad: 0, skip: 0, skipped_seen: 0 }, rows: [],
    by: opts.by ?? (caller.appRef ? `app ${caller.appRef}` : caller.principal),
  };
  const entry: { owner: string; state: RunState; finished?: number } = { owner: caller.ownerGhii, state: run };
  runs.set(run.id, entry);
  const done = runBatch(deps, caller, prefix, { run, messageIds: opts.messageIds })
    .then((r) => {
      if (r.status !== 'running') return r;   // marked stalled before it settled; that state stands
      r.status = 'done'; r.step = ''; r.finishedAt = new Date().toISOString(); entry.finished = Date.now(); return r;
    })
    .catch((err: unknown) => {
      if (run.status !== 'running') return run;
      run.status = 'failed';
      run.error = err instanceof RefineryError ? `${err.code}: ${err.message}` : String((err as Error)?.message ?? err);
      run.finishedAt = new Date().toISOString();
      entry.finished = Date.now();
      logger.warn('refinery: a batch failed', { prefix, run: run.id, error: run.error });
      return run;
    });
  return { run, done, already: false };
}

/** A run by id, only to the owner it runs for. */
export function getRun(id: string, ownerGhii: string): RunState | null {
  const r = runs.get(id);
  return r && r.owner === ownerGhii ? r.state : null;
}
