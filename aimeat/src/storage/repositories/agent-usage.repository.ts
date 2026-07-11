/**
 * @file agent-usage.repository.ts
 * @description Repository interface for the agent LLM usage ledger (LEDGER / TARGET-016):
 *   append-only per-call usage events + upsert-incremented daily aggregates. Raw events
 *   are the source of truth (billing audit, TARGET-019); daily rows are a derived rollup
 *   the UI reads so aggregate queries stay fast as raw volume grows.
 * @structure
 *   - appendUsageEvent(event)     -- append one immutable usage event (source of truth)
 *   - incrementUsageDaily(delta)  -- upsert-increment the daily aggregate row
 *   - queryUsageDaily(filter)     -- read daily aggregates, owner-scoped
 *   - listUsageEvents(filter)     -- read raw events for per-run drill-down, owner-scoped
 * @usage
 *   import type { AgentUsageRepository } from './repositories/agent-usage.repository.js';
 * @version-history
 *   v1.0.0 -- 2026-07-10 -- Initial creation for LEDGER TARGET-016 substrate
 */

import type {
  AgentUsageEvent,
  AgentUsageDailyRecord,
  UsageDailyFilter,
  UsageEventFilter,
  AdminUsageDailyFilter,
} from '../interface.js';

export interface AgentUsageRepository {
  appendUsageEvent(event: AgentUsageEvent): Promise<void>;
  incrementUsageDaily(delta: AgentUsageDailyRecord): Promise<void>;
  queryUsageDaily(filter: UsageDailyFilter): Promise<AgentUsageDailyRecord[]>;
  listUsageEvents(filter: UsageEventFilter): Promise<AgentUsageEvent[]>;
  /**
   * OPERATOR-ONLY: daily aggregates across ALL owners in a date range (not owner-scoped).
   * The calling route MUST enforce the operator role — this method applies no caller restriction.
   */
  queryUsageDailyAllOwners(filter: AdminUsageDailyFilter): Promise<AgentUsageDailyRecord[]>;
}
