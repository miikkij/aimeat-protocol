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
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial (wish aimeat-refinery).
 */
import { randomBytes } from 'node:crypto';
import { logger } from '../../utils/logger.js';
import { runBatch, RefineryError, type RefineryCaller, type RefineryDeps, type RunState } from './pipeline.js';

const KEEP_MS = 60 * 60 * 1000;
const runs = new Map<string, { owner: string; state: RunState; finished?: number }>();

function sweep(): void {
  const now = Date.now();
  for (const [id, r] of runs) if (r.finished && now - r.finished > KEEP_MS) runs.delete(id);
}

/** The run of this owner's definition that is still working, if one is. */
export function runningFor(ownerGhii: string, prefix: string): RunState | null {
  for (const r of runs.values()) if (r.owner === ownerGhii && r.state.prefix === prefix && r.state.status === 'running') return r.state;
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
    .then((r) => { r.status = 'done'; r.step = ''; r.finishedAt = new Date().toISOString(); entry.finished = Date.now(); return r; })
    .catch((err: unknown) => {
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
