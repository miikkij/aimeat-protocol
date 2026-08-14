/**
 * @file src/services/usage/usage-buffer.ts
 * @description The one write door for the usage call stream. Every measured call anywhere in the
 *   node goes through `recordUsageCall`, which buffers in memory and flushes on an interval.
 *   Design: docs/internal/telemetria/02-design.md
 *
 *   WHY BUFFERED, AND WHY THIS IS NOT THE BILLING PATH. A call must never wait on a metrics write,
 *   and a metrics write must never be able to fail a call. That trade means at most one flush
 *   window is lost on a hard kill, which is fine for reporting and is exactly why the money paths
 *   (AgentUsageDaily, the budget alerts, the morsel settlement) stay synchronous and do not move
 *   behind this buffer. Reporting may be approximate at the edge; a ledger may not.
 *
 *   WHY IT IS SYNCHRONOUS AND RETURNS VOID. A door that could `await` this would eventually be
 *   written to `await` it inside a request path, and then a slow database would be a slow node. The
 *   signature refuses that: there is nothing to await and nothing to catch.
 * @structure
 *   - initUsageBuffer(storage)     -- wire storage + start the flush interval
 *   - recordUsageCall(input)       -- buffer one call (fire and forget, never throws)
 *   - pendingUsageCalls(filter)    -- the unflushed tail, so a just-made call is not invisible
 *   - flushUsageBuffer()           -- write the buffer out
 *   - shutdownUsageBuffer()        -- stop the interval + final flush
 * @usage
 *   import { recordUsageCall } from '../services/usage/usage-buffer.js';
 *   recordUsageCall({ ownerGhii, surface: 'mcp', coordinate: toolName, outcome: 'ok', durationMs });
 * @version-history
 *   v1.0.0 — 2026-08-14 — Initial: the buffered ingest door for the usage call stream.
 */
import { randomUUID } from 'node:crypto';
import type { Storage, UsageCallRecord, UsageCallInput, UsageCallFilter } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';

/** Flush cadence. A dashboard reading raw calls is at most this stale, plus the fold's own lag. */
const FLUSH_INTERVAL_MS = Number(process.env.AIMEAT_USAGE_BUFFER_MS) || 15_000;

/**
 * Hard ceiling on the unflushed buffer. If storage is down, telemetry must degrade rather than grow
 * until the process dies: past this, the OLDEST entries drop. Losing the oldest reporting rows is a
 * gap in a chart; running out of memory takes the node with it.
 */
const MAX_BUFFERED = 20_000;

let storageRef: Storage | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushing = false;
let buffer: UsageCallRecord[] = [];
let droppedSinceLastWarning = 0;

/**
 * Buffer one call. Never throws and never blocks: a door records what happened and gets on with
 * answering the request.
 */
export function recordUsageCall(input: UsageCallInput): void {
  try {
    buffer.push({
      id: randomUUID(),
      ts: input.ts ?? new Date().toISOString(),
      ownerGhii: input.ownerGhii,
      actorGaii: input.actorGaii ?? '',
      actorKind: input.actorKind ?? 'owner',
      surface: input.surface,
      coordinate: input.coordinate,
      appId: input.appId ?? '',
      counterpartyGhii: input.counterpartyGhii ?? '',
      outcome: input.outcome ?? 'ok',
      reason: input.reason ?? '',
      durationMs: Math.max(0, Math.round(input.durationMs ?? 0)),
      chargedUnits: Math.max(0, Math.round(input.chargedUnits ?? 0)),
      unit: input.unit ?? '',
      currency: input.currency ?? '',
      entitlementId: input.entitlementId ?? '',
      runId: input.runId ?? '',
      meta: input.meta ?? {},
    });

    if (buffer.length > MAX_BUFFERED) {
      const overflow = buffer.length - MAX_BUFFERED;
      buffer.splice(0, overflow);
      droppedSinceLastWarning += overflow;
    }
  } catch (err) {
    // Recording a call must never be able to fail the call. There is no retry that helps here:
    // whatever went wrong is in this process, and the row is not worth a second attempt.
    logger.warn('usage-buffer: dropped one call record', { error: String(err) });
  }
}

/**
 * The unflushed tail, filtered the same way `listUsageCalls` filters storage. Reader and writer
 * share a process, so there is no reason to make an operator wait out a flush interval to see a
 * call that has already happened: an empty view they cannot explain is what makes a UI look broken.
 */
export function pendingUsageCalls(filter: UsageCallFilter): UsageCallRecord[] {
  return buffer.filter(r =>
    (!filter.ownerGhii || r.ownerGhii === filter.ownerGhii)
    && (!filter.actorGaii || r.actorGaii === filter.actorGaii)
    && (!filter.surface || r.surface === filter.surface)
    && (!filter.appId || r.appId === filter.appId)
    && (!filter.outcome || r.outcome === filter.outcome)
    && (!filter.from || r.ts >= filter.from)
    && (!filter.to || r.ts <= filter.to));
}

/**
 * Write the buffer out. Snapshot-and-clear up front so calls arriving mid-flush accumulate for the
 * next window. At-most-once by choice: a failed write drops that window rather than risking a
 * double count, which matches what this stream is for.
 */
export async function flushUsageBuffer(): Promise<void> {
  if (!storageRef || flushing || buffer.length === 0) return;
  flushing = true;
  const batch = buffer;
  buffer = [];

  if (droppedSinceLastWarning > 0) {
    logger.warn('usage-buffer: dropped oldest records to stay under the memory ceiling', {
      dropped: droppedSinceLastWarning, ceiling: MAX_BUFFERED,
    });
    droppedSinceLastWarning = 0;
  }

  try {
    await storageRef.appendUsageCall(batch);
  } catch (err) {
    logger.warn('usage-buffer: flush failed, this window is lost', {
      count: batch.length, error: String(err),
    });
  } finally {
    flushing = false;
  }
}

/** Wire storage and start the flush interval. Idempotent. */
export function initUsageBuffer(storage: Storage): void {
  storageRef = storage;
  if (flushTimer) return;
  flushTimer = setInterval(() => { void flushUsageBuffer(); }, FLUSH_INTERVAL_MS);
  // Don't keep the process alive solely for the flush timer (matters for in-process tests).
  flushTimer.unref?.();
}

/** Stop the interval and perform one final flush. Called from graceful shutdown. */
export async function shutdownUsageBuffer(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flushUsageBuffer();
}

/** Test seam: drop everything in flight. Not used by the running node. */
export function resetUsageBuffer(): void {
  buffer = [];
  droppedSinceLastWarning = 0;
}
