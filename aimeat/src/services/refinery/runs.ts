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
 * @structure startRun · getRun · runningFor · runViewerOf · RunViewer
 * @usage const run = startRun(deps, caller, 'postinjalostamo', {}); … getRun(run.id, caller.ownerGhii, runViewerOf(caller))
 *
 *   A RUN THAT DOES NOT FINISH IS STALLED, NOT RUNNING. A batch still marked running STALL_MS after
 *   it started is marked failed as stalled when the next start asks, so a batch whose promise never
 *   settles cannot answer every later start with itself for the life of the process. If it settles
 *   afterwards, its late result does not overwrite the failed state.
 *
 *   A RUN IS SHOWN TO THE PRINCIPAL THAT STARTED IT, OR TO A CALLER THAT READS AS THE OWNER. A run's
 *   state copies the subject lines of the mail it read, and a batch reads only a mailbox its starter
 *   holds (pipeline.ts requireOwnConnection). So the run map keeps the starter, and a caller that did
 *   not start the run sees it only when it may read the owner's mailbox itself: the owner, an app
 *   grant of the owner, or an agent holding connections:read-as-owner (RunViewer, as AiJobViewer does
 *   for AI jobs). Any other caller gets NOT_FOUND from getRun, and from startRun a 409 BATCH_BUSY
 *   that carries no run, so the one-run-per-definition rule still holds without showing the run.
 * @version-history
 *   2026-10-20 — The run map keeps the starting principal; getRun and runningFor take a RunViewer,
 *     and a start that finds another principal's batch running is BATCH_BUSY with no run in it. Any
 *     agent of the owner read the owner's batch, with the subjects of the owner's mail (secaudit
 *     2026-10, v60).
 *   2026-10-16 — A run still marked running STALL_MS (30 minutes) after its start is marked failed as
 *     stalled, and a new start begins a new run (QA audit E4-04).
 *   v1.0.0 — 2026-09-29 — Initial (wish aimeat-refinery).
 */
import { randomBytes } from 'node:crypto';
import { logger } from '../../utils/logger.js';
import { scopeIsCovered } from '../../utils/scope-coverage.js';
import { CONNECTIONS_READ_AS_OWNER_SCOPE } from '../connections/access.js';
import { runBatch, RefineryError, type RefineryCaller, type RefineryDeps, type RunState } from './pipeline.js';

const KEEP_MS = 60 * 60 * 1000;
/** A batch still running this long after its start is stalled. The scheduler's refinery run limit is the same. */
export const STALL_MS = 30 * 60 * 1000;

interface RunEntry {
  owner: string;
  /** resolveIdentity's answer for the caller that started the batch: whose mailbox it reads. */
  starter: string;
  state: RunState;
  finished?: number;
}
const runs = new Map<string, RunEntry>();

/** Who is asking after a run. `all` sees every run of the owner; otherwise only the runs it started. */
export interface RunViewer {
  /** resolveIdentity's answer: the owner's GHII for the owner, an agent's own GAII. */
  principal: string;
  /** The owner, an app grant of the owner, or an agent holding connections:read-as-owner. */
  all: boolean;
}

/**
 * The viewer a refinery caller is. `all` is a caller that may read the owner's mailbox as the owner
 * does: the owner (in person or on an owner token), an app grant of the owner, and an agent holding
 * connections:read-as-owner, the word an agent needs to read its owner's mail (services/connections/
 * access.ts). An ecosystem app and every other agent see the runs they started.
 */
export function runViewerOf(
  caller: Pick<RefineryCaller, 'principal' | 'ownerGhii' | 'roles' | 'scopes' | 'isOwner' | 'appRef'>,
): RunViewer {
  const all = caller.isOwner
    || caller.principal === caller.ownerGhii
    || !!caller.appRef
    || caller.roles.includes('app')
    || scopeIsCovered(caller.scopes, CONNECTIONS_READ_AS_OWNER_SCOPE);
  return { principal: caller.principal, all };
}

const visibleTo = (r: RunEntry, viewer: RunViewer): boolean => viewer.all || r.starter === viewer.principal;

/** The refusal a start gets when another principal's batch of the definition is running. */
const BATCH_BUSY_MESSAGE = 'A batch of this definition is already running, started by the owner or by another of their '
  + 'agents or apps. Start it again when that batch has finished. Its progress is not shown to you, because it '
  + 'reads a mailbox you may not read.';

function sweep(): void {
  const now = Date.now();
  for (const [id, r] of runs) if (r.finished && now - r.finished > KEEP_MS) runs.delete(id);
}

/** The run entry of this owner's definition that is still working, if one is. A stalled one is marked failed. */
function runningEntry(ownerGhii: string, prefix: string): RunEntry | null {
  const now = Date.now();
  for (const r of runs.values()) {
    if (r.owner !== ownerGhii || r.state.prefix !== prefix || r.state.status !== 'running') continue;
    if (now - Date.parse(r.state.startedAt) <= STALL_MS) return r;
    r.state.status = 'failed';
    r.state.error = `stalled: the batch did not finish within ${STALL_MS / 60_000} minutes of its start`;
    r.state.finishedAt = new Date(now).toISOString();
    r.finished = now;
    logger.warn('refinery: a batch stalled and was marked failed', { prefix, run: r.state.id });
  }
  return null;
}

/**
 * The run of this owner's definition that is still working, as this viewer may see it: the run, or
 * 'busy' when one is working that the viewer did not start and may not see, or null when none is.
 */
export function runningFor(ownerGhii: string, prefix: string, viewer: RunViewer): RunState | 'busy' | null {
  const r = runningEntry(ownerGhii, prefix);
  if (!r) return null;
  return visibleTo(r, viewer) ? r.state : 'busy';
}

/**
 * Start a batch in the background. Returns the run at once; `done` settles when it finishes, for a
 * caller that wants to wait (the scheduler, an agent that asked to). When a batch of the definition
 * is already working, a caller that may see it gets it with `already: true`; any other caller gets
 * RefineryError BATCH_BUSY (409), which carries no part of the run.
 */
export function startRun(
  deps: RefineryDeps, caller: RefineryCaller, prefix: string, opts: { messageIds?: string[]; by?: string },
): { run: RunState; done: Promise<RunState>; already: boolean } {
  sweep();
  const busy = runningFor(caller.ownerGhii, prefix, runViewerOf(caller));
  if (busy === 'busy') throw new RefineryError('BATCH_BUSY', 409, BATCH_BUSY_MESSAGE);
  if (busy) return { run: busy, done: Promise.resolve(busy), already: true };
  const run: RunState = {
    id: 'rr-' + Date.now().toString(36) + '-' + randomBytes(3).toString('hex'),
    prefix, status: 'running', startedAt: new Date().toISOString(), n: 0, i: 0, step: '', subject: '',
    counts: { seen: 0, clear: 0, unclear: 0, bad: 0, skip: 0, skipped_seen: 0 }, rows: [],
    by: opts.by ?? (caller.appRef ? `app ${caller.appRef}` : caller.principal),
  };
  const entry: RunEntry = { owner: caller.ownerGhii, starter: caller.principal, state: run };
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

/**
 * A run by id, only to the owner it runs for, and within that owner only to the principal that
 * started it or a viewer that reads as the owner (runViewerOf). Null for every other caller, the
 * same answer as for an id that does not exist.
 */
export function getRun(id: string, ownerGhii: string, viewer: RunViewer): RunState | null {
  const r = runs.get(id);
  return r && r.owner === ownerGhii && visibleTo(r, viewer) ? r.state : null;
}
