/**
 * @file src/services/classification/audit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The classification audit log (TARGET-082 V4). When content whose label has
 *   `audit: true` is SHOWN to an AI reader or USED in an AI call, one event is recorded: who, when,
 *   which item, which label, shown or used, and for what (capability and model). A REFUSAL (content
 *   hidden from or refused to a reader) and a label CHANGE are always recorded, whatever the label.
 *   Deciding which events to record is the caller's job; this module only records them.
 *
 *   BOUNDED FROM THE START, because the earlier per-read audit (services/consent-audit-buffer.ts)
 *   grew production to 1.2 million rows. Three limits:
 *   1. Recording is synchronous and returns void. It never awaits and never throws, so a slow
 *      database cannot slow a read. Rows wait in memory and are flushed in batches every 60 s.
 *   2. The same reader, the same item and the same action in the same minute is ONE row with a
 *      count. The queue merges on that address as events arrive, so the queue stays small too, and
 *      storage adds the count to a row that an earlier flush already wrote.
 *   3. Rows older than the operator's retention are pruned by the core job that prunes the consent
 *      audit (services/core-jobs.ts). The retention is a number of days, or null to keep everything.
 *
 *   A reader of the log gets the stored rows and the not-yet-flushed ones together
 *   (listClassificationAuditMerged), so an event is visible at once rather than after the flush.
 *   A failed flush puts its rows back for the next window, bounded by the queue cap; a hard kill
 *   loses at most one window.
 *
 *   EVIDENCE IS NEVER EVICTED (review of 2026-09-29). The buffer keeps two lists: routine rows
 *   (shown, used) and evidence (refused, changed). Past the cap the oldest ROUTINE row goes; evidence
 *   is kept up to a larger cap of its own, and past that a new evidence row is refused and logged
 *   rather than an older one dropped. Evidence is flushed first. A CHANGE is recorded to the
 *   millisecond (its `minute` is the exact time), so two changes of one item in one minute are two
 *   rows, each with its own from → to in `purpose`, and neither is merged into the other. The
 *   caller aggregates a long list of `shown` items into one row per label (reader.ts, key `*:<label>`
 *   and a `count`), so one AI list call cannot fill the buffer. `ownerGaii` is always the person:
 *   an agent's or an app's identity is collapsed to its owner, so the owner's log and the owner's
 *   erasure find the rows. purgeClassificationAudit drops the waiting rows of an erased person or a
 *   deleted organism, so the next flush does not write them back after the storage cascade.
 * @structure ClassificationAuditEvent · recordClassificationAudit · flushClassificationAudit ·
 *   initClassificationAudit · shutdownClassificationAudit · pendingClassificationAudit ·
 *   listClassificationAuditMerged · pruneClassificationAuditOlderThan · purgeClassificationAudit ·
 *   minuteOf · resetClassificationAudit
 * @usage
 *   import { recordClassificationAudit } from '../classification/audit.js';
 *   recordClassificationAudit({ scope, ownerGaii, kind: 'memory', key, label: 'luottamuksellinen',
 *     reader: 'claude#alice@node', readerKind: 'ai', action: 'used', purpose: 'chat:anthropic/claude' });
 * @version-history
 *   v1.1.0 — 2026-09-29 — Review fixes: evidence (refused, changed) is never evicted and flushes
 *     first; a change is its own row to the millisecond; an event may carry a count; ownerGaii is
 *     collapsed to the owner; purgeClassificationAudit for erasure and organism delete.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V4. Initial.
 */
import { randomUUID } from 'node:crypto';
import type {
  Storage, ClassificationAuditRow, ClassificationAuditFilter, ContentLabelKind,
  ClassificationAuditReaderKind, ClassificationAuditAction,
} from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { ownerGhiiOf } from '../../utils/gaii.js';

/** One thing that happened to one labelled item, or to `count` items at once. `at` defaults to now. */
export interface ClassificationAuditEvent {
  scope: string;
  ownerGaii: string | null;
  kind: ContentLabelKind;
  key: string;
  label: string;
  reader: string;
  readerKind: ClassificationAuditReaderKind;
  action: ClassificationAuditAction;
  purpose?: string | null;
  at?: string;
  /** How many events this one stands for (an aggregated `shown` row). Defaults to 1. */
  count?: number;
}

/** Flush cadence. The stored log is at most this far behind; the merged read never is. */
const FLUSH_INTERVAL_MS = 60_000;
/** Rows per storage call. A failed call puts back only its own rows, so no row is counted twice. */
const FLUSH_CHUNK = 500;
/** Hard cap on distinct rows waiting, so a stuck database cannot grow the queue without bound. */
const MAX_QUEUE = 10_000;
/** The cap on waiting evidence rows. Past it a NEW evidence row is refused; none is evicted. */
const MAX_EVIDENCE = 50_000;

let storageRef: Storage | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushing = false;
/** Waiting rows, by address, in insertion order (a Map keeps it), so the oldest go first.
 *  `routine` holds shown and used, `evidence` holds refused and changed. */
let routine = new Map<string, ClassificationAuditRow>();
let evidence = new Map<string, ClassificationAuditRow>();
let dropped = 0;
let refusedEvidence = 0;

const isEvidence = (a: ClassificationAuditAction) => a === 'refused' || a === 'changed';
const waitingRows = (): ClassificationAuditRow[] => [...evidence.values(), ...routine.values()];

/** The ISO timestamp of the minute `at` falls in, in UTC. An unreadable `at` counts as now. */
export function minuteOf(at: string): string {
  const d = new Date(at);
  const t = Number.isNaN(d.getTime()) ? new Date() : d;
  t.setUTCSeconds(0, 0);
  return t.toISOString();
}

function addressOf(r: Pick<ClassificationAuditRow, 'minute' | 'reader' | 'action' | 'scope' | 'kind' | 'key'>): string {
  return [r.minute, r.reader, r.action, r.scope, r.kind, r.key].join('\u0000');
}

/** Fold `r` into `into`, the way storage folds a row into the table: the later row's label wins. */
function mergeInto(into: ClassificationAuditRow, r: ClassificationAuditRow): void {
  into.count += r.count;
  if (r.firstAt < into.firstAt) into.firstAt = r.firstAt;
  if (r.lastAt >= into.lastAt) {
    into.lastAt = r.lastAt;
    into.label = r.label;
    into.readerKind = r.readerKind;
  }
  if (r.purpose) into.purpose = r.purpose;
  if (r.ownerGaii) into.ownerGaii = r.ownerGaii;
}

/**
 * Put a row in the buffer, merging on its address. Past the cap the oldest routine row is evicted;
 * evidence is never evicted, and past its own cap a new evidence row is refused and logged.
 */
function enqueue(r: ClassificationAuditRow): void {
  const address = addressOf(r);
  const into = isEvidence(r.action) ? evidence : routine;
  const had = into.get(address);
  if (had) { mergeInto(had, r); return; }
  if (into === evidence && evidence.size >= MAX_EVIDENCE) {
    refusedEvidence++;
    if (refusedEvidence === 1 || refusedEvidence % 100 === 0) {
      logger.warn(`classification-audit: ${MAX_EVIDENCE} refusals and changes wait for storage; this one is not recorded (storage down?)`, { refusedEvidence });
    }
    return;
  }
  if (routine.size + evidence.size >= MAX_QUEUE) {
    const oldest = routine.keys().next().value;
    if (oldest === undefined && into === routine) {
      // Everything waiting is evidence: the new routine row is the one that goes.
      dropped++;
      return;
    }
    if (oldest !== undefined) routine.delete(oldest);
    dropped++;
    if (dropped === 1 || dropped % 100 === 0) {
      logger.warn(`classification-audit buffer over ${MAX_QUEUE} rows; dropping the oldest shown or used row (storage slow or down?)`, { dropped });
    }
  }
  into.set(address, r);
}

/**
 * Record one event. In memory only: never awaits, never throws. An event without a reader, a scope
 * or a key is ignored, because a row that cannot say who or what is not evidence.
 */
export function recordClassificationAudit(e: ClassificationAuditEvent): void {
  try {
    if (!e || !e.reader || !e.scope || !e.key || !e.action) return;
    const at = e.at && !Number.isNaN(new Date(e.at).getTime()) ? new Date(e.at).toISOString() : new Date().toISOString();
    const count = typeof e.count === 'number' && Number.isFinite(e.count) && e.count >= 1 ? Math.floor(e.count) : 1;
    enqueue({
      id: randomUUID(),
      // A change is an event, not a count: to the millisecond, so a second change is a second row.
      minute: e.action === 'changed' ? at : minuteOf(at),
      scope: e.scope,
      // The person, never their agent or app: the owner's log and erasure read this column.
      ownerGaii: e.ownerGaii ? ownerGhiiOf(e.ownerGaii) : null,
      kind: e.kind,
      key: e.key,
      label: e.label,
      reader: e.reader,
      readerKind: e.readerKind,
      action: e.action,
      purpose: e.purpose ?? null,
      count,
      firstAt: at,
      lastAt: at,
    });
  } catch (err) {
    logger.warn('classification-audit: an event could not be recorded', { error: String(err) });
  }
}

/**
 * Drop the waiting rows of an erased person (`owner`, their GHII) or of a deleted scope (`scope`,
 * such as `organism:<id>`), so the next flush does not write back what the storage cascade removed.
 * Call it next to the storage delete. Answers how many waiting rows were dropped.
 */
export function purgeClassificationAudit(what: { owner?: string; scope?: string }): number {
  const owner = what.owner ? ownerGhiiOf(what.owner) : null;
  const scope = what.scope ?? null;
  if (!owner && !scope) return 0;
  let n = 0;
  for (const m of [routine, evidence]) {
    for (const [address, r] of m) {
      const hit = (scope && r.scope === scope)
        || (owner && (r.ownerGaii === owner || ownerGhiiOf(r.scope) === owner));
      if (hit) { m.delete(address); n++; }
    }
  }
  return n;
}

/**
 * Write the waiting rows to storage. The queue is swapped out first, so events arriving during the
 * flush wait for the next one. A chunk that fails goes back into the queue, merged by address.
 */
export async function flushClassificationAudit(): Promise<void> {
  if (!storageRef || flushing || routine.size + evidence.size === 0) return;
  flushing = true;
  const storage = storageRef;
  // Evidence first, so a failing store loses routine rows before it loses a refusal or a change.
  const batch = waitingRows();
  routine = new Map();
  evidence = new Map();
  const failed: ClassificationAuditRow[] = [];
  try {
    for (let i = 0; i < batch.length; i += FLUSH_CHUNK) {
      const part = batch.slice(i, i + FLUSH_CHUNK);
      try {
        await storage.addClassificationAudit(part);
      } catch (err) {
        if (failed.length === 0) logger.warn('classification-audit flush: write failed, will retry next window', { error: String(err) });
        failed.push(...part);
      }
    }
  } finally {
    if (failed.length > 0) {
      // Put the failed rows back ahead of what arrived meanwhile, so they are the first to go
      // when the cap is reached rather than the newest.
      const arrived = waitingRows();
      routine = new Map();
      evidence = new Map();
      for (const r of failed) enqueue(r);
      for (const r of arrived) enqueue(r);
    }
    flushing = false;
  }
}

/** Wire storage and start the flush interval. Idempotent; a second call only swaps the storage. */
export function initClassificationAudit(storage: Storage): void {
  storageRef = storage;
  if (flushTimer) return;
  flushTimer = setInterval(() => { void flushClassificationAudit(); }, FLUSH_INTERVAL_MS);
  flushTimer.unref?.();
}

/** Stop the interval and flush once more. Called from graceful shutdown. */
export async function shutdownClassificationAudit(): Promise<void> {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  await flushClassificationAudit();
}

function matches(r: ClassificationAuditRow, f: ClassificationAuditFilter): boolean {
  return (!f.ownerGaii || r.ownerGaii === f.ownerGaii)
    && (!f.scope || r.scope === f.scope)
    && (!f.since || r.lastAt >= f.since)
    && (!f.action || r.action === f.action);
}

/** Copies of the rows not yet flushed that match the filter. */
export function pendingClassificationAudit(filter: { ownerGaii?: string; scope?: string } = {}): ClassificationAuditRow[] {
  const out: ClassificationAuditRow[] = [];
  for (const r of waitingRows()) if (matches(r, filter)) out.push({ ...r });
  return out;
}

/**
 * The stored rows and the waiting rows together, newest first by lastAt, at most `limit` (default
 * 200, cap 1000). A waiting row with the same address as a stored one is shown as one row with the
 * two counts added, which is what the table will hold after the next flush.
 */
export async function listClassificationAuditMerged(storage: Storage, filter: ClassificationAuditFilter): Promise<ClassificationAuditRow[]> {
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000);
  const stored = await storage.listClassificationAudit({ ...filter, limit });
  const byAddress = new Map<string, ClassificationAuditRow>();
  for (const r of stored) byAddress.set(addressOf(r), { ...r });
  for (const r of waitingRows()) {
    if (!matches(r, filter)) continue;
    const address = addressOf(r);
    const had = byAddress.get(address);
    if (had) mergeInto(had, r); else byAddress.set(address, { ...r });
  }
  return [...byAddress.values()]
    .sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0))
    .slice(0, limit);
}

/**
 * Remove stored rows whose lastAt is more than `days` days before `now`. `days` comes from the
 * node's classification policy; null, zero or a negative number keeps everything. Returns the
 * number of rows removed.
 */
export async function pruneClassificationAuditOlderThan(storage: Storage, days: number | null, now: Date = new Date()): Promise<number> {
  if (days === null || !Number.isFinite(days) || days <= 0) return 0;
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
  return storage.pruneClassificationAudit(cutoff);
}

/** Test seam: drop everything waiting and forget the storage. Not used by the running node. */
export function resetClassificationAudit(): void {
  routine = new Map();
  evidence = new Map();
  dropped = 0;
  refusedEvidence = 0;
  storageRef = null;
}
