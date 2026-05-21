/**
 * @file agent-activity.repository.ts
 * @description Repository interface for recording and querying agent activity metrics
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */

import type { AgentActivityRecord } from '../interface.js';

export interface AgentActivityRepository {
  recordActivity(record: AgentActivityRecord): Promise<void>;
  getActivityHistory(agentGaii: string, opts?: {
    days?: number;
    granularity?: 'daily' | 'hourly';
  }): Promise<AgentActivityRecord[]>;
}
