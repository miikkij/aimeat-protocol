/**
 * @file src/services/owner-export/job-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where a data export job lives. One record per account, `export.job` in the account's
 *   service namespace (`svc:<owner>@<node>`, the records this node's services keep for the account, so
 *   no memory route of the person's own lists it, the owner export carries it and erasure clears it).
 *   It is written over by the next export, so an account never holds more than one, whatever it does.
 *   The node's queue is one record, `export.queue` under `system@<node>`, a list of the jobs waiting in
 *   the order they were asked; the runner takes the first. Both are written on their version
 *   (updateRecord), so two requests at once never lose one.
 * @structure ExportJob · ExportJobState · readExportJob · claimExportJob · changeExportJob · readQueue ·
 *   enqueue · dequeue · EXPORT_JOB_KEY · EXPORT_QUEUE_KEY
 * @usage const job = await readExportJob(storage, ghii);
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-owner-data-export-as-a-chosen-parts-background-job).
 */
import type { Storage } from '../../storage/interface.js';
import { serviceNamespaceOf } from '../../utils/service-namespace.js';
import { serviceRecords } from '../service-records.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import type { ProcessRef } from '../process-lease.js';
import type { ExportPartId, PartSize } from './parts.js';
import type { ExportVolume } from './zip-volumes.js';

export const EXPORT_JOB_KEY = 'export.job';
export const EXPORT_QUEUE_KEY = 'export.queue';

/**
 * queued: waiting for its turn · running: being written · ready: the files wait for their download ·
 * failed: stopped with `error` · cancelled: the person stopped it · expired: the files were removed
 * after their days.
 */
export type ExportJobState = 'queued' | 'running' | 'ready' | 'failed' | 'cancelled' | 'expired';

export interface ExportJob {
  id: string;
  /** The account name. */
  owner: string;
  ghii: string;
  parts: ExportPartId[];
  state: ExportJobState;
  /** Who asked: the person, one of their agents, or the operator. */
  requested_by: string;
  /** The operator asked for another person's account; the person's feed was told. */
  by_operator?: boolean;
  requested_at: string;
  started_at?: string;
  finished_at?: string;
  /** When a ready export's files are removed. */
  expires_at?: string;
  /** The sizes measured when it was asked, per part. */
  estimate: Partial<Record<ExportPartId, PartSize>>;
  estimate_bytes: number;
  /** While running: the part being written and the bytes written so far. */
  progress?: { part: string; bytes: number };
  volumes?: ExportVolume[];
  /** When ready: how many records or files each part wrote. */
  written?: Partial<Record<ExportPartId | 'account', number>>;
  /** The folder under the export folder that holds the files: `<owner>/<id>`. */
  folder: string;
  /** The process that writes it, so a start after a stop knows whether its writer is gone. */
  by?: ProcessRef;
  /** Runs started; a job a stop interrupted runs once more, then fails. */
  attempts: number;
  error?: string;
}

interface QueueEntry { ghii: string; id: string; at: string }
interface Queue { entries: QueueEntry[] }

const systemOwner = (nodeId: string): string => `system@${nodeId}`;
const asJob = (v: unknown): ExportJob | null => (v && typeof v === 'object' && typeof (v as ExportJob).id === 'string' ? v as ExportJob : null);
const asQueue = (v: unknown): Queue => ({ entries: Array.isArray((v as Queue | null)?.entries) ? (v as Queue).entries : [] });

/** The account's job, through the one code path to a service record (services/service-records.ts). */
export async function readExportJob(storage: Storage, ghii: string): Promise<ExportJob | null> {
  return serviceRecords<ExportJob>(storage, 'export.', { parse: asJob }).get(ghii, 'job');
}

/**
 * Write a new job unless the account has one waiting or running: true when written. Two starts at the
 * same moment both read "none", and the version of the record lets exactly one of them write.
 */
export async function claimExportJob(storage: Storage, job: ExportJob): Promise<boolean> {
  let wrote = false;
  await updateRecord<ExportJob | null>(storage, serviceNamespaceOf(job.ghii), EXPORT_JOB_KEY, asJob, cur => {
    wrote = !(cur && (cur.state === 'queued' || cur.state === 'running'));
    return wrote ? job : UNCHANGED;
  }, { tag: 'export' });
  return wrote;
}

/**
 * Change the account's job when it is still job `id`: `change` answers the new record, or UNCHANGED.
 * Answers the record as stored, or null when the account's job is another one (or none).
 */
export async function changeExportJob(
  storage: Storage, ghii: string, id: string, change: (job: ExportJob) => ExportJob | typeof UNCHANGED,
): Promise<ExportJob | null> {
  let mine = false;
  const out = await updateRecord<ExportJob | null>(storage, serviceNamespaceOf(ghii), EXPORT_JOB_KEY, asJob, cur => {
    mine = !!cur && cur.id === id;
    if (!cur || !mine) return UNCHANGED;
    return change(cur);
  }, { tag: 'export' });
  return mine ? out : null;
}

export async function readQueue(storage: Storage, nodeId: string): Promise<QueueEntry[]> {
  return asQueue((await storage.getMemory(systemOwner(nodeId), EXPORT_QUEUE_KEY))?.value).entries;
}

/** Put a job at the end of the node's queue (once). Answers its place, 1 for the first. */
export async function enqueue(storage: Storage, nodeId: string, entry: QueueEntry): Promise<number> {
  const q = await updateRecord<Queue>(storage, systemOwner(nodeId), EXPORT_QUEUE_KEY, asQueue, cur => (
    cur.entries.some(e => e.id === entry.id) ? UNCHANGED : { entries: [...cur.entries, entry] }
  ), { tag: 'export' });
  return q.entries.findIndex(e => e.id === entry.id) + 1;
}

/** Take a job off the node's queue, wherever it is. */
export async function dequeue(storage: Storage, nodeId: string, id: string): Promise<void> {
  await updateRecord<Queue>(storage, systemOwner(nodeId), EXPORT_QUEUE_KEY, asQueue, cur => (
    cur.entries.some(e => e.id === id) ? { entries: cur.entries.filter(e => e.id !== id) } : UNCHANGED
  ), { tag: 'export' });
}
