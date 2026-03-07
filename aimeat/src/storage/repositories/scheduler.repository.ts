import type { ScheduledJobRecord } from '../interface.js';

export interface SchedulerRepository {
  createScheduledJob(record: ScheduledJobRecord): Promise<ScheduledJobRecord>;
  getScheduledJob(id: string): Promise<ScheduledJobRecord | null>;
  listScheduledJobs(filter?: { type?: string; extensionName?: string; enabled?: boolean }): Promise<ScheduledJobRecord[]>;
  updateScheduledJob(id: string, updates: Partial<ScheduledJobRecord>): Promise<ScheduledJobRecord | null>;
  deleteScheduledJob(id: string): Promise<boolean>;
}
