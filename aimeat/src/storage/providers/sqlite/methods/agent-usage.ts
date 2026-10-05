/**
 * @file src/storage/providers/sqlite/methods/agent-usage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/agent-usage.ts (agentUsageMethods),
 *   so a fix in one provider finds its twin by file name. Bodies moved verbatim from the files named in the
 *   version history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure agentUsageMethods
 * @usage Object.assign(SqliteStorage.prototype, agentUsageMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — appendUsageEvent, incrementUsageDaily, queryUsageDaily, listUsageEvents,
 *     queryUsageDailyAllOwners moved here from capability-agents.ts so the file mirrors
 *     postgres-kysely/methods/agent-usage.ts (secaudit 2026-10, M8).
 */
import type {
  AgentUsageEvent, AgentUsageDailyRecord, UsageDailyFilter, UsageEventFilter, AdminUsageDailyFilter,
} from '../../../interface.js';
import type { SqliteStorage } from '../index.js';
import * as agentUsageRepo from '../repos/agent-usage.js';

export const agentUsageMethods = {

  // ══════════════════════════════════════════════════════════
  // ── Agent LLM Usage Ledger (LEDGER / TARGET-016) ──
  // ══════════════════════════════════════════════════════════

  async appendUsageEvent(this: SqliteStorage, event: AgentUsageEvent): Promise<void> {
    return agentUsageRepo.appendUsageEvent(this.db, event);
  },

  async incrementUsageDaily(this: SqliteStorage, delta: AgentUsageDailyRecord): Promise<void> {
    return agentUsageRepo.incrementUsageDaily(this.db, delta);
  },

  async queryUsageDaily(this: SqliteStorage, filter: UsageDailyFilter): Promise<AgentUsageDailyRecord[]> {
    return agentUsageRepo.queryUsageDaily(this.db, filter);
  },

  async listUsageEvents(this: SqliteStorage, filter: UsageEventFilter): Promise<AgentUsageEvent[]> {
    return agentUsageRepo.listUsageEvents(this.db, filter);
  },

  async queryUsageDailyAllOwners(this: SqliteStorage, filter: AdminUsageDailyFilter): Promise<AgentUsageDailyRecord[]> {
    return agentUsageRepo.queryUsageDailyAllOwners(this.db, filter);
  },
};
