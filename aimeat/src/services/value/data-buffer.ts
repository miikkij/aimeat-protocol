/**
 * @file src/services/value/data-buffer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What data passes through the node, without the data: each write is counted by its kind,
 *   source, direction, size class, classification label and content class into the day counts
 *   (storage DataDaily). No key, title, file name, field value or content is stored; the key is held
 *   in memory only until the flush has read the record's label, and is then dropped.
 *
 *   WHERE THE WRITES COME FROM. Memory and workspace records through the write tally's entry point
 *   (data-map/write-tally-buffer.ts recordMemoryTouch), stored files through writeStorageFile, row
 *   space rows through the row service's append, and the content class through the content intake
 *   when it decides one (services/content/intake.ts). DATA_ENDPOINTS names them for a reader.
 *
 *   SYNCHRONOUS AND RETURNS VOID, like every write buffer here; the flush runs on a timer and reads the
 *   labels of the batch's memory records in one query per scope.
 * @structure DATA_ENDPOINTS · sizeBucketOf · sourceOf · recordDataWrite · recordDataClass ·
 *   flushDataCounts · holdDataCountsForErasure · initDataCounts · shutdownDataCounts · resetDataCounts
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, phase 2).
 */
import type { Storage } from '../../storage/interface.js';
import type { DataDailyDelta } from '../../storage/types/value.js';
import { parseGAII, ownerGhiiOf } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { ErasureHolds, type ErasedAccount } from '../erasure/holds.js';

/** What the data counts cover, in the words a person would use. */
export const DATA_ENDPOINTS = [
  'records and workspace documents written through any memory endpoint',
  'files stored through any upload endpoint',
  'rows appended to a workspace row space',
  'the content class the content inspection gives an item',
] as const;

const DEFAULT_FLUSH_INTERVAL_MS = 15_000;
const MAX_PENDING = 50_000;

export type DataKind = 'memory' | 'workspace' | 'row' | 'file';

interface Pending {
  ownerGaii: string;
  /** Only to read the label at the flush; never stored. */
  key?: string;
  kind: DataKind;
  source: string;
  direction: string;
  sizeBucket: string;
  contentClass: string;
  bytes: number;
  at: string;
}

let storageRef: Storage | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushing = false;
let pending: Pending[] = [];
let dropped = 0;
const erasing = new ErasureHolds();

/** The size class of a value: under 1 kB, under 100 kB, under 10 MB, larger, or unknown. */
export function sizeBucketOf(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return 'unknown';
  if (bytes < 1024) return 'lt1k';
  if (bytes < 100 * 1024) return 'lt100k';
  if (bytes < 10 * 1024 * 1024) return 'lt10m';
  return 'gte10m';
}

/** Who wrote it, as a kind: a person, an agent, an app, an extension, an automation or another node. */
export function sourceOf(principal: string, ownerGaii: string): string {
  const host = (p: string): string => p.slice(p.lastIndexOf('@') + 1);
  if (principal.includes('@') && ownerGaii.includes('@') && host(principal) !== host(ownerGaii)) return 'federation';
  if (principal.startsWith('schedule:') || principal.startsWith('receiver:')) return 'automation';
  if (principal.startsWith('ext:')) return 'extension';
  if (principal.startsWith('eco:')) return 'app';
  if (parseGAII(principal)) return 'agent';
  return 'person';
}

function push(p: Pending): void {
  try {
    if (!p.ownerGaii) return;
    if (erasing.covers(p.ownerGaii)) return;
    if (pending.length >= MAX_PENDING) { pending.shift(); dropped++; }
    pending.push(p);
  } catch (err) {
    logger.warn('data-counts: refused to let a bookkeeping failure reach a request', { error: String(err) });
  }
}

/** A principal wrote data. `key` is read once for the label and never stored. */
export function recordDataWrite(t: { ownerGaii: string; key?: string; principal: string; kind: DataKind; bytes?: number; at?: string }): void {
  const kind: DataKind = t.kind === 'memory' && t.key?.startsWith('organism.') ? 'workspace' : t.kind;
  push({
    ownerGaii: t.ownerGaii, ...(t.key ? { key: t.key } : {}), kind,
    source: sourceOf(t.principal, t.ownerGaii),
    direction: t.key?.startsWith('organism.') || kind === 'row' ? 'shared' : 'in',
    sizeBucket: sizeBucketOf(t.bytes), contentClass: '', bytes: t.bytes ?? 0,
    at: t.at ?? new Date().toISOString(),
  });
}

/** The content inspection gave an item a content class. */
export function recordDataClass(t: { ownerGaii: string; kind: DataKind; contentClass: string; at?: string }): void {
  if (!t.contentClass) return;
  push({
    ownerGaii: t.ownerGaii, kind: t.kind, source: 'classified', direction: 'in', sizeBucket: 'unknown',
    contentClass: t.contentClass.slice(0, 64), bytes: 0, at: t.at ?? new Date().toISOString(),
  });
}

const WORKSPACE_KEY = /^organism\.([^.]+)\./;

/** The label each memory item of the batch carries, '' where none: one query per scope. */
async function labelsOf(storage: Storage, batch: Pending[]): Promise<Map<Pending, string>> {
  const out = new Map<Pending, string>();
  const byScope = new Map<string, Pending[]>();
  for (const p of batch) {
    if (!p.key || (p.kind !== 'memory' && p.kind !== 'workspace')) continue;
    const org = WORKSPACE_KEY.exec(p.key)?.[1];
    const scope = org ? `organism:${org}` : p.ownerGaii;
    const list = byScope.get(scope) ?? [];
    list.push(p);
    byScope.set(scope, list);
  }
  for (const [scope, items] of byScope) {
    const keys = [...new Set(items.map(i => i.key!))].slice(0, 1000);
    const rows = await storage.getContentLabels('memory', scope, keys).catch((err: unknown) => {
      logger.warn('data-counts: a label read failed, those items count without a label', { error: String(err) });
      return [];
    });
    const byKey = new Map(rows.map(r => [r.key, r.label ?? '']));
    for (const i of items) out.set(i, byKey.get(i.key!) ?? '');
  }
  return out;
}

/** Write the waiting counts out. Snapshot-and-clear first. */
export async function flushDataCounts(): Promise<void> {
  if (!storageRef || flushing || pending.length === 0) return;
  flushing = true;
  const batch = pending;
  pending = [];
  if (dropped > 0) {
    logger.warn('data-counts: dropped the oldest writes to stay under the memory ceiling', { dropped, ceiling: MAX_PENDING });
    dropped = 0;
  }
  const storage = storageRef;
  try {
    await erasing.track((async () => {
      const labels = await labelsOf(storage, batch);
      const rows: DataDailyDelta[] = batch.map(p => ({
        day: p.at.slice(0, 10), ownerGhii: ownerGhiiOf(p.ownerGaii), kind: p.kind, source: p.source,
        direction: p.direction, sizeBucket: p.sizeBucket, level: labels.get(p) ?? '',
        contentClass: p.contentClass, count: 1, bytes: p.bytes,
      }));
      await storage.upsertDataDaily(rows);
    })());
  } catch (err) {
    logger.warn('data-counts: flush failed, this window of counts is lost', { count: batch.length, error: String(err) });
  } finally {
    flushing = false;
  }
}

/** An account erasure, before its cascade: its waiting counts go and no new one is kept until release. */
export async function holdDataCountsForErasure(account: ErasedAccount): Promise<() => void> {
  const release = erasing.hold(account);
  await erasing.writesSettled();
  pending = pending.filter(p => !ErasureHolds.isOf(p.ownerGaii, account));
  await flushDataCounts();
  return release;
}

export function initDataCounts(storage: Storage, flushIntervalMs: number = DEFAULT_FLUSH_INTERVAL_MS): void {
  storageRef = storage;
  if (flushTimer) return;
  flushTimer = setInterval(() => { void flushDataCounts(); }, Math.max(100, flushIntervalMs));
  flushTimer.unref?.();
}

export async function shutdownDataCounts(): Promise<void> {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  await flushDataCounts();
}

/** Test seam: drop everything in flight. */
export function resetDataCounts(): void {
  pending = [];
  dropped = 0;
}
