import type { DisputeRecord, DisputeAuditEntry } from '../interface.js';

export interface DisputeRepository {
  createDispute(dispute: DisputeRecord): Promise<DisputeRecord>;
  getDispute(id: string): Promise<DisputeRecord | null>;
  getDisputeByTrackingCode(tc: string): Promise<DisputeRecord | null>;
  updateDispute(id: string, updates: Partial<DisputeRecord>): Promise<DisputeRecord | null>;
  addDisputeAuditEntry(disputeId: string, entry: DisputeAuditEntry): Promise<DisputeAuditEntry>;
  getDisputeAuditLog(disputeId: string): Promise<DisputeAuditEntry[]>;
  listDisputesByProvider(gaii: string): Promise<DisputeRecord[]>;
  listAllDisputes(limit?: number): Promise<DisputeRecord[]>;
}
