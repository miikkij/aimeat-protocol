/**
 * @file src/storage/repositories/dispute.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage-interface segment for disputes — the CRUD + audit-log contract each backend
 *   implements for work disputes (create/get/lookup-by-tracking-code, update, append audit entries, list).
 *
 * @structure
 *   - DisputeRepository: interface with createDispute, getDispute, getDisputeByTrackingCode,
 *     updateDispute, addDisputeAuditEntry, getDisputeAuditLog, listDisputesByProvider, listAllDisputes
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
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
