/**
 * @file src/storage/repositories/usage.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Repository interface for usage telemetry's three layers: the hot call stream, the
 *   archive sweep, and the discriminated serving rollup with its fold watermark.
 *   Design: docs/internal/telemetria/02-design.md
 *
 *   WHY `advanceUsageRollup` TAKES BOTH THE DELTAS AND THE CURSOR. The fold is exactly-once only if
 *   the deltas and the watermark that accounts for them commit together. Two separate methods and a
 *   caller-side transaction would work on Postgres and would be one refactor away from not working,
 *   so the contract itself is "apply these and move the cursor", and the provider owns the atomicity.
 * @structure
 *   - appendUsageCall / listUsageCalls          -- layer 1
 *   - archiveUsageRows                          -- layer 2, one bounded sweep
 *   - getUsageCursor / advanceUsageRollup       -- layer 3 write, transactional
 *   - queryUsageRollup / clearUsageRollupRange  -- layer 3 read + rebuild
 *   - listUsageEventsForFold / listUsageCallsForFold -- raw cursor reads the fold consumes
 * @usage
 *   import type { UsageRepository } from './repositories/usage.repository.js';
 * @version-history
 *   v1.0.0 — 2026-08-14 — Initial: three-layer usage telemetry substrate.
 */

import type {
  AgentUsageEvent,
  UsageCallRecord,
  UsageCallFilter,
  UsageRollupRow,
  UsageRollupDelta,
  UsageRollupFilter,
  UsageRollupCursor,
  UsageArchiveResult,
} from '../interface.js';

/** A fold cursor position. '' for both fields means "from the beginning of the stream". */
export interface UsageFoldCursor {
  lastTs: string;
  lastId: string;
  limit: number;
}

export interface UsageRepository {
  // ── Layer 1: hot raw ──
  /** Append one call. Batched by the caller (services/usage/usage-buffer.ts), never per request. */
  appendUsageCall(rows: UsageCallRecord[]): Promise<void>;
  /**
   * OPERATOR-ONLY when `ownerGhii` is absent: this applies no caller restriction, so the route must
   * gate it on the operator role and record its own inspection (design: the audit rule).
   */
  listUsageCalls(filter: UsageCallFilter): Promise<UsageCallRecord[]>;

  // ── The fold's raw reads: strictly ordered by (ts, id), strictly after the cursor ──
  listUsageCallsForFold(cursor: UsageFoldCursor): Promise<UsageCallRecord[]>;
  listUsageEventsForFold(cursor: UsageFoldCursor): Promise<AgentUsageEvent[]>;

  // ── Layer 2: archive ──
  /**
   * Move raw rows older than `before` (ISO) into the archive tables, and prune hour-grain rollups
   * older than `pruneHourBefore` (bucket string). Bounded by `batch` per table so one sweep cannot
   * hold a long transaction. Returns what it moved; a caller loops until it returns zeroes.
   */
  archiveUsageRows(args: { before: string; pruneHourBefore: string; batch: number }): Promise<UsageArchiveResult>;
  /**
   * Destroy archived rows older than `before` (ISO). NOT called by any scheduled job: these rows
   * are what answers a billing dispute or a legal question months later, so destroying them is an
   * explicit operator action with an explicit date. Returns what it deleted.
   */
  pruneUsageArchive(before: string): Promise<{ usageCalls: number; usageEvents: number }>;

  // ── Layer 3: serving ──
  getUsageCursor(stream: 'llm' | 'call'): Promise<UsageRollupCursor | null>;
  /**
   * Apply every delta as an upsert-add and advance the stream's cursor, ATOMICALLY. This is the
   * method the fold's exactly-once property rests on; splitting it makes a crash between the two
   * halves double-count or lose a batch.
   */
  advanceUsageRollup(args: {
    stream: 'llm' | 'call';
    deltas: UsageRollupDelta[];
    lastTs: string;
    lastId: string;
  }): Promise<void>;
  queryUsageRollup(filter: UsageRollupFilter): Promise<UsageRollupRow[]>;
  /** Rebuild support: drop a (cut-less) bucket range before re-folding it, since the fold adds. */
  clearUsageRollupRange(args: { from?: string; to?: string; grain?: 'hour' | 'day' }): Promise<number>;
  /** Rebuild support: rewind a stream's cursor so the fold reprocesses from `lastTs`. */
  setUsageCursor(stream: 'llm' | 'call', lastTs: string, lastId: string): Promise<void>;
}
