import type { WorkRecord } from '../interface.js';

export interface WorkRepository {
  createWork(work: WorkRecord): Promise<WorkRecord>;
  getWork(trackingCode: string): Promise<WorkRecord | null>;
  updateWork(trackingCode: string, updates: Partial<WorkRecord>): Promise<WorkRecord | null>;
  listWorkByProvider(gaii: string): Promise<WorkRecord[]>;
  listWorkByRequester(gaii: string): Promise<WorkRecord[]>;
  listAllWork(limit?: number): Promise<WorkRecord[]>;
}
