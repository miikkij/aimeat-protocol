/**
 * @file src/storage/providers/sqlite/methods/usage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite method group for usage telemetry (UsageRepository). Thin async wrappers over
 *   ../repos/usage.ts, which holds the SQL. Its own group rather than an addition to
 *   capability-agents.ts: usage telemetry is a domain, and that file is already near the
 *   max-file-lines boundary.
 * @structure usageMethods — layer 1 append/list, layer 2 archive, layer 3 fold + read
 * @usage Object.assign(SqliteStorage.prototype, usageMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-08-14 — Initial: three-layer usage telemetry substrate.
 */
import type { SqliteStorage } from '../index.js';
import type {
  AgentUsageEvent,
  UsageCallRecord,
  UsageCallFilter,
  UsageRollupRow,
  UsageRollupDelta,
  UsageRollupFilter,
  UsageRollupCursor,
  UsageArchiveResult,
  UsageFoldCursor,
} from '../../../interface.js';
import * as usageRepo from '../repos/usage.js';

export const usageMethods = {
  async appendUsageCall(this: SqliteStorage, rows: UsageCallRecord[]): Promise<void> {
    return usageRepo.appendUsageCall(this.db, rows);
  },

  async listUsageCalls(this: SqliteStorage, filter: UsageCallFilter): Promise<UsageCallRecord[]> {
    return usageRepo.listUsageCalls(this.db, filter);
  },

  async listUsageCallsForFold(this: SqliteStorage, cursor: UsageFoldCursor): Promise<UsageCallRecord[]> {
    return usageRepo.listUsageCallsForFold(this.db, cursor);
  },

  async listUsageEventsForFold(this: SqliteStorage, cursor: UsageFoldCursor): Promise<AgentUsageEvent[]> {
    return usageRepo.listUsageEventsForFold(this.db, cursor);
  },

  async archiveUsageRows(
    this: SqliteStorage,
    args: { before: string; pruneHourBefore: string; batch: number },
  ): Promise<UsageArchiveResult> {
    return usageRepo.archiveUsageRows(this.db, args);
  },

  async pruneUsageArchive(this: SqliteStorage, before: string): Promise<{ usageCalls: number; usageEvents: number }> {
    return usageRepo.pruneUsageArchive(this.db, before);
  },

  async getUsageCursor(this: SqliteStorage, stream: 'llm' | 'call'): Promise<UsageRollupCursor | null> {
    return usageRepo.getUsageCursor(this.db, stream);
  },

  async setUsageCursor(this: SqliteStorage, stream: 'llm' | 'call', lastTs: string, lastId: string): Promise<void> {
    return usageRepo.setUsageCursor(this.db, stream, lastTs, lastId);
  },

  async advanceUsageRollup(
    this: SqliteStorage,
    args: { stream: 'llm' | 'call'; deltas: UsageRollupDelta[]; lastTs: string; lastId: string },
  ): Promise<void> {
    return usageRepo.advanceUsageRollup(this.db, args);
  },

  async queryUsageRollup(this: SqliteStorage, filter: UsageRollupFilter): Promise<UsageRollupRow[]> {
    return usageRepo.queryUsageRollup(this.db, filter);
  },

  async clearUsageRollupRange(
    this: SqliteStorage,
    args: { from?: string; to?: string; grain?: 'hour' | 'day' },
  ): Promise<number> {
    return usageRepo.clearUsageRollupRange(this.db, args);
  },
};
