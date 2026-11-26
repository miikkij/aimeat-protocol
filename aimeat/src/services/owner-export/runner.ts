/**
 * @file src/services/owner-export/runner.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Runs the node's data export queue, ONE EXPORT AT A TIME ON THE WHOLE NODE (Jouni,
 *   2026-11-26): an export reads every record and file of an account, so two at once would load the
 *   database and the disk for everybody, and a queue of many would only wait longer. The process that
 *   holds the lease `lease.owner-export` runs the queue; any other process leaves it be.
 *
 *   A JOB'S LIFE. queued → running → ready (files wait `exportKeepDays`, then expired) | failed |
 *   cancelled. When a job is ready the person is told in their notifications and the page hears an
 *   `owner-export` change on the event stream. The node logs the export as an answered data subject
 *   request (GDPR art. 15 and 20), as the JSON export does.
 *
 *   A STOP OF THE NODE. A job left `running` by a process that is gone runs once more from the start
 *   (its folder is emptied first); a job interrupted twice fails, so a job that brings the process down
 *   cannot loop.
 *
 *   AN ERASED ACCOUNT's export stops and its folder is removed at once (onErased).
 *
 *   THE SWEEP (hourly, and once after boot): a ready export past its days is removed and marked
 *   expired; a folder no job names is removed; and the queue is started again in case a job waits.
 * @structure kickExports · cancelRunning · sweepExports · scheduleOwnerExports
 * @usage kickExports(deps);  // after a job is queued
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-owner-data-export-as-a-chosen-parts-background-job).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { emitChange, onAccountErasedEvent } from '../event-bus.js';
import { notify } from '../notify.js';
import { appendRequest } from '../compliance/docs.js';
import { UNCHANGED } from '../record-cas.js';
import { claimedSweep, holderAlive, releaseHeldLease, takeHeldLease, thisProcess } from '../process-lease.js';
import { buildExport, ExportStopped } from './build.js';
import { changeExportJob, dequeue, readExportJob, readQueue, type ExportJob } from './job-store.js';
import { ensureExportFolder, listJobFolders, removeAccountFolder, removeExportFolder } from './folders.js';

export interface RunnerDeps { storage: Storage; config: AimeatConfig }

const LEASE = 'owner-export';
/** Runs a job gets: the first, and one more after a stop of the node. */
const MAX_ATTEMPTS = 2;
/** The running job's progress is written at most this often. */
const PROGRESS_MS = 5_000;
const SWEEP_MS = 3_600_000;

/** The domain the page listens for: the account's export changed. Owner sessions only. */
export const EXPORT_DOMAIN = 'owner-export';

// The job this process is writing, per node, so a second kick does not start another and a cancel can
// stop it. Another process learns of a cancel from the job record (state cancelled).
// process-local: one queue per process; the lease owner-export lets one process run it.
const running = new Map<string, { id: string; ghii?: string; abort: AbortController }>();

/** Stop the job this process is writing, when it is `id`. */
export function cancelRunning(config: Pick<AimeatConfig, 'nodeId'>, id: string): boolean {
  const r = running.get(config.nodeId);
  if (!r || r.id !== id) return false;
  r.abort.abort();
  return true;
}

const changed = (ghii: string): void => emitChange(EXPORT_DOMAIN, ghii);

/** Start the queue when this process may run it and is not already; answers at once. */
export function kickExports(deps: RunnerDeps): void {
  if (running.has(deps.config.nodeId)) return;
  void runQueue(deps).catch(err => logger.error('owner export: the queue stopped', { error: String(err) }));
}

async function runQueue(deps: RunnerDeps): Promise<void> {
  const { storage, config } = deps;
  if (running.has(config.nodeId)) return;
  // Marked before the first await, so a second kick in this process does not start another queue.
  running.set(config.nodeId, { id: '', abort: new AbortController() });
  if (!await takeHeldLease(storage, config, LEASE)) {
    running.delete(config.nodeId);
    return;
  }
  try {
    for (;;) {
      const head = (await readQueue(storage, config.nodeId))[0];
      if (!head) return;
      const job = await readExportJob(storage, head.ghii);
      if (!job || job.id !== head.id || (job.state !== 'queued' && job.state !== 'running')) {
        await dequeue(storage, config.nodeId, head.id);
        continue;
      }
      if (job.state === 'running' && job.by && await holderAlive(storage, config, job.by)) {
        // Another live process writes it (a node of several processes that lost the lease meanwhile).
        return;
      }
      await runOne(deps, job);
      await dequeue(storage, config.nodeId, job.id);
    }
  } finally {
    running.delete(config.nodeId);
    await releaseHeldLease(storage, config, LEASE);
  }
}

async function runOne(deps: RunnerDeps, queued: ExportJob): Promise<void> {
  const { storage, config } = deps;
  if (queued.attempts >= MAX_ATTEMPTS) {
    await finishFailed(deps, queued, 'The node stopped twice while this export was being written, so it was stopped. Start it again.');
    return;
  }
  const abort = new AbortController();
  running.set(config.nodeId, { id: queued.id, ghii: queued.ghii, abort });
  const job = await changeExportJob(storage, queued.ghii, queued.id, j => (j.state === 'queued' || j.state === 'running'
    ? { ...j, state: 'running', by: thisProcess(config), attempts: j.attempts + 1, started_at: new Date().toISOString(), progress: { part: 'account', bytes: 0 } }
    : UNCHANGED));
  if (!job || job.state !== 'running') return;
  changed(job.ghii);

  let lastWrite = 0;
  const onProgress = (part: string, bytes: number): void => {
    const now = Date.now();
    if (now - lastWrite < PROGRESS_MS) return;
    lastWrite = now;
    void changeExportJob(storage, job.ghii, job.id, j => (j.state === 'running' ? { ...j, progress: { part, bytes } } : UNCHANGED))
      .then(j => {
        // A cancel written by another process ends this run at its next check.
        if (j?.state === 'cancelled') abort.abort();
        changed(job.ghii);
      })
      .catch(err => logger.warn('owner export: progress not written', { id: job.id, error: String(err) }));
  };

  try {
    await ensureExportFolder(config, job.folder);
    const { volumes, written } = await buildExport(deps, job, abort.signal, onProgress);
    const finished = new Date();
    const expires = new Date(finished.getTime() + config.exportKeepDays * 86_400_000);
    const done = await changeExportJob(storage, job.ghii, job.id, j => (j.state === 'running'
      ? { ...j, state: 'ready', volumes, finished_at: finished.toISOString(), expires_at: expires.toISOString(), progress: { part: 'done', bytes: volumes.reduce((s, v) => s + v.bytes, 0) }, written }
      : UNCHANGED));
    if (done?.state !== 'ready') {
      // Cancelled while the last volume was closed: nothing of it stays.
      await removeExportFolder(config, job.folder);
      return;
    }
    changed(job.ghii);
    await appendRequest(storage, config.nodeId, { kind: 'node' }, {
      kind: 'portability', subject: job.owner, receivedAt: job.requested_at, status: 'done', closedAt: finished.toISOString(),
      channel: 'node', auto: true, ...(job.by_operator ? { notes: 'Exported by the operator.' } : {}),
    }).catch(err => logger.warn('owner export: not logged as a data subject request', { owner: job.owner, error: String(err) }));
    const gb = (volumes.reduce((s, v) => s + v.bytes, 0) / 1e9).toFixed(2);
    await notify(storage, job.ghii, {
      type: 'owner_export_ready', link: '/v1/profile#dataWallet',
      title: 'Your data export is ready to download',
      body: `Size ${gb} GB. Download it on the Data Wallet page within ${config.exportKeepDays} days; then the server removes it.`,
      i18n: { key: 'owner_export_ready', vars: { files: String(volumes.length), gb, days: String(config.exportKeepDays) } },
    });
  } catch (err) {
    await removeExportFolder(config, job.folder).catch(e => logger.warn('owner export: the stopped export\'s folder was not removed', { id: job.id, error: String(e) }));
    if (err instanceof ExportStopped && err.reason === 'cancelled') {
      await changeExportJob(storage, job.ghii, job.id, j => (j.state === 'running' || j.state === 'cancelled'
        ? { ...j, state: 'cancelled', finished_at: new Date().toISOString(), progress: undefined } : UNCHANGED));
      changed(job.ghii);
      return;
    }
    logger.error('owner export: the export failed', { id: job.id, owner: job.owner, error: String(err) });
    await finishFailed(deps, job, err instanceof ExportStopped ? err.message : 'The export failed on the node. Try again; if it fails again, tell the operator.');
  }
}

async function finishFailed(deps: RunnerDeps, job: ExportJob, message: string): Promise<void> {
  const { storage, config } = deps;
  await removeExportFolder(config, job.folder).catch(e => logger.warn('owner export: the failed export\'s folder was not removed', { id: job.id, error: String(e) }));
  await changeExportJob(storage, job.ghii, job.id, j => ({ ...j, state: 'failed', error: message, finished_at: new Date().toISOString(), progress: undefined }));
  changed(job.ghii);
  await notify(storage, job.ghii, {
    type: 'owner_export_failed', link: '/v1/profile#dataWallet',
    title: 'Your data export stopped', body: message,
    i18n: { key: 'owner_export_failed', vars: { reason: message } },
  });
}

/**
 * Remove what has outlived its days: a ready export past `expires_at` (marked expired), and a folder
 * that no waiting, running or ready job names. Then start the queue, in case a job waits.
 */
export async function sweepExports(deps: RunnerDeps): Promise<number> {
  const { storage, config } = deps;
  let removed = 0;
  const now = Date.now();
  for (const folder of await listJobFolders(config)) {
    const [owner, id] = folder.split('/');
    const ghii = (await storage.getGHIIByOwner(owner))?.ghii;
    const job = ghii ? await readExportJob(storage, ghii) : null;
    const live = !!job && job.id === id && (job.state === 'queued' || job.state === 'running' || job.state === 'ready');
    const expired = !!job && live && job.state === 'ready' && !!job.expires_at && Date.parse(job.expires_at) <= now;
    if (live && !expired) continue;
    await removeExportFolder(config, folder);
    removed += 1;
    if (expired && ghii) {
      await changeExportJob(storage, ghii, id, j => (j.state === 'ready' ? { ...j, state: 'expired', volumes: [] } : UNCHANGED));
      changed(ghii);
    }
  }
  kickExports(deps);
  return removed;
}

/**
 * An account was erased: its running export stops, its queue entry goes, and its folder with every file
 * in it is removed at once. The job record went with the account's service namespace.
 */
async function onErased(deps: RunnerDeps, owner: string): Promise<void> {
  const ghii = `${owner}@${deps.config.nodeId}`;
  const r = running.get(deps.config.nodeId);
  if (r?.ghii === ghii) r.abort.abort();
  for (const e of await readQueue(deps.storage, deps.config.nodeId)) {
    if (e.ghii === ghii) await dequeue(deps.storage, deps.config.nodeId, e.id);
  }
  await removeAccountFolder(deps.config, owner);
}

/** At boot: the hourly sweep (claimed by one process), and the queue once, so a job a stop left waits no longer. */
export function scheduleOwnerExports(deps: RunnerDeps): void {
  onAccountErasedEvent(evt => {
    if (evt.nodeId !== deps.config.nodeId) return;
    onErased(deps, evt.owner).catch(err => logger.warn('owner export: the erased account\'s export was not removed', { owner: evt.owner, error: String(err) }));
  });
  const sweep = claimedSweep(deps.storage, deps.config, 'owner-export', SWEEP_MS, () => {
    sweepExports(deps).catch(err => logger.warn('owner export sweep failed', { error: String(err) }));
  });
  setTimeout(sweep, 30_000);
  // process-local: nothing; each process ticks, and claimedSweep lets one of them run the sweep.
  setInterval(sweep, SWEEP_MS);
}
