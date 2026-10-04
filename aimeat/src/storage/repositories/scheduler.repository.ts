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
 *   v1.1.0 — 2026-10-04 — claimScheduledFire: one cron fire runs once when two processes share a database.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { ScheduledJobRecord, ExecutionLogEntry } from '../interface.js';

export interface SchedulerRepository {
  createScheduledJob(record: ScheduledJobRecord): Promise<ScheduledJobRecord>;
  getScheduledJob(id: string): Promise<ScheduledJobRecord | null>;
  listScheduledJobs(filter?: { type?: string; extensionName?: string; enabled?: boolean; ownerScope?: string; agentGaii?: string }): Promise<ScheduledJobRecord[]>;
  updateScheduledJob(id: string, updates: Partial<ScheduledJobRecord>): Promise<ScheduledJobRecord | null>;
  deleteScheduledJob(id: string): Promise<boolean>;
  /**
   * Claim one cron fire of a job for this process: true when the job's last claimed fire is older
   * than `fireAt` (or none), and that claim is now `fireAt`; false when another process already
   * claimed this fire or a later one, or the job does not exist. One conditional update, so two
   * node processes on one database cannot both win. `fireAt` is the fire's scheduled time as an ISO
   * string (services/scheduler-fire-claim.ts).
   */
  claimScheduledFire(id: string, fireAt: string): Promise<boolean>;

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
