import type { ScheduledJobRecord, ExecutionLogEntry } from '../interface.js';

export interface SchedulerRepository {
  createScheduledJob(record: ScheduledJobRecord): Promise<ScheduledJobRecord>;
  getScheduledJob(id: string): Promise<ScheduledJobRecord | null>;
  listScheduledJobs(filter?: { type?: string; extensionName?: string; enabled?: boolean }): Promise<ScheduledJobRecord[]>;
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
