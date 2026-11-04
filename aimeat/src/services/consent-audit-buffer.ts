/**
 * @file consent-audit-buffer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description In-memory write buffer for consent-audit entries. The consent layer used to
 *   write one ConsentAudit row synchronously on EVERY data-access check (read/list/search),
 *   on the request hot path — which both slowed every read and grew the collection without
 *   bound (1.2M+ rows in prod). We now (1) only audit the events worth keeping — access
 *   DENIALS and consent MUTATIONS (grant/revoke) — and (2) write them off the request path
 *   via this buffer, flushed in batches within a second of the first entry, with a 60 s interval
 *   as the safety net. A separate core job prunes old rows (config.consentAuditRetentionDays).
 *
 *   WHY A SECOND AND NOT AT ONCE. Measured on 2026-11-04 (SQLite file, 500 rows): an awaited write
 *   costs 0.045 ms median, 0.12 ms p95, against 0.005 ms for the in-memory record; on PostgreSQL it
 *   is a network round trip and a commit per row. Writing within a second keeps the request free of
 *   it and batches a burst, and a process that ends without stopping loses at most that second
 *   instead of the 60 s it lost before (codebase analysis 2026-11-03, HA stage 1 item 1.6).
 * @structure
 *   - bufferConsentAudit(entry)      -- enqueue an entry (no DB write, never throws)
 *   - flushConsentAudit()            -- write the queued entries to storage
 *   - initConsentAuditBuffer(storage)-- wire storage + start the flush interval
 *   - shutdownConsentAuditBuffer()   -- stop the interval + final flush (graceful exit)
 * @usage
 *   import { bufferConsentAudit } from './consent-audit-buffer.js';
 * @version-history
 *   v1.1.0 -- 2026-11-04 -- An entry is written within a second (flushSoon), not up to 60 s later, so a
 *     crash loses at most that second (codebase analysis 2026-11-03, HA stage 1 item 1.6).
 *   v1.0.0 -- 2026-06-21 -- Initial: batched off-request-path consent-audit writes.
 */
import type { Storage, ConsentAuditEntry } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

/** The safety net: retries a failed write and catches anything the soon-flush missed. */
const FLUSH_INTERVAL_MS = 60_000;
/** How soon a recorded entry is written. The most a process that ends without stopping can lose;
 *  a stop (SIGTERM) loses nothing. Entries recorded within it go in one flush. */
const FLUSH_SOON_MS = 1_000;
/** Hard cap so a wedged DB can't grow the queue unbounded; oldest entries drop first. */
const MAX_QUEUE = 10_000;

let storageRef: Storage | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
// process-local: the timer that writes this process's own buffered rows within 1 s; nothing is shared.
let soonTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let queue: ConsentAuditEntry[] = [];
let dropped = 0;

/** Write what waits within FLUSH_SOON_MS, once: entries arriving meanwhile join that flush. */
function flushSoon(): void {
  if (!storageRef || soonTimer) return;
  soonTimer = setTimeout(() => { soonTimer = null; void flushConsentAudit(); }, FLUSH_SOON_MS);
  soonTimer.unref?.();
}

/** Enqueue a consent-audit entry. In-memory only — never blocks the request, never throws. */
export function bufferConsentAudit(entry: ConsentAuditEntry): void {
  flushSoon();
  queue.push(entry);
  if (queue.length > MAX_QUEUE) {
    queue.splice(0, queue.length - MAX_QUEUE);
    dropped++;
    if (dropped === 1 || dropped % 100 === 0) {
      logger.warn(`consent-audit buffer over ${MAX_QUEUE}; dropping oldest entries (storage slow/down?)`, { dropped });
    }
  }
}

/** Current queued-entry count (used by tests / introspection). */
export function pendingConsentAuditCount(): number {
  return queue.length;
}

/**
 * Not-yet-flushed entries for an owner, matching the same filters as listConsentAudit. The
 * audit endpoint merges these with the persisted rows so a just-made denial/mutation is
 * visible immediately rather than after the next flush.
 */
export function getPendingConsentAudit(
  ownerGaii: string,
  opts?: { days?: number; consentId?: string; accessorGaii?: string },
): ConsentAuditEntry[] {
  const cutoff = opts?.days ? Date.now() - opts.days * 86400000 : null;
  return queue.filter(e =>
    e.ownerGaii === ownerGaii &&
    (!opts?.consentId || e.consentId === opts.consentId) &&
    (!opts?.accessorGaii || e.accessorGaii === opts.accessorGaii) &&
    (cutoff === null || new Date(e.timestamp).getTime() >= cutoff),
  );
}

/**
 * Write queued entries to storage. Snapshot-and-clear first so new entries accumulate for the
 * next window. Entries that fail to write are returned to the queue (audit denials/mutations
 * matter more than perfect timing), bounded by MAX_QUEUE.
 */
export async function flushConsentAudit(): Promise<void> {
  if (!storageRef || flushing || queue.length === 0) return;
  flushing = true;
  const storage = storageRef;
  const batch = queue;
  queue = [];

  const failed: ConsentAuditEntry[] = [];
  try {
    for (const entry of batch) {
      try {
        await storage.addConsentAuditEntry(entry);
      } catch (err) {
        failed.push(entry);
        if (failed.length === 1) logger.warn('consent-audit flush: write failed, will retry next window', { error: String(err) });
      }
    }
  } finally {
    if (failed.length > 0) queue.unshift(...failed);
    flushing = false;
    // What arrived during this flush goes soon too; a failed write waits for the interval.
    if (failed.length === 0 && queue.length > 0) flushSoon();
  }
}

/** Wire storage and start the flush interval. Idempotent. */
export function initConsentAuditBuffer(storage: Storage): void {
  storageRef = storage;
  if (flushTimer) return;
  flushTimer = setInterval(() => { void flushConsentAudit(); }, FLUSH_INTERVAL_MS);
  flushTimer.unref?.();
}

/** Stop the interval and perform one final flush. Called from graceful shutdown. */
export async function shutdownConsentAuditBuffer(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  if (soonTimer) {
    clearTimeout(soonTimer);
    soonTimer = null;
  }
  await flushConsentAudit();
}
