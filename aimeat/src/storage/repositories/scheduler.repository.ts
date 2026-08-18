/**
 * @file src/storage/repositories/scheduler.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage-interface contract for scheduled jobs and their execution logs — the
 *   backend-agnostic repository shape each provider implements for the job scheduler.
 *
 * @structure
 *   - SchedulerRepository: CRUD + filtered listing for scheduled jobs
 *   - execution-log methods: create, filtered list/count, and prune-before-date retention
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { ScheduledJobRecord, ExecutionLogEntry } from '../interface.js';

export interface SchedulerRepository {
  createScheduledJob(record: ScheduledJobRecord): Promise<ScheduledJobRecord>;
  getScheduledJob(id: string): Promise<ScheduledJobRecord | null>;
  listScheduledJobs(filter?: { type?: string; extensionName?: string; enabled?: boolean; ownerScope?: string; agentGaii?: string }): Promise<ScheduledJobRecord[]>;
  updateScheduledJob(id: string, updates: Partial<ScheduledJobRecord>): Promise<ScheduledJobRecord | null>;
  deleteScheduledJob(id: string): Promise<boolean>;

  // Execution log
  createExecutionLog(entry: ExecutionLogEntry): Promise<ExecutionLogEntry>;
  listExecutionLogs(filter?: {
    jobId?: string;
    extensionName?: string;
    trigger?: string;
    result?: string;
    limit?: number;
    offset?: number;
  }): Promise<ExecutionLogEntry[]>;
  countExecutionLogs(filter?: {
    jobId?: string;
    extensionName?: string;
    trigger?: string;
    result?: string;
  }): Promise<number>;
  /** Prune entries older than given ISO date */
  pruneExecutionLogs(beforeDate: string): Promise<number>;
}
