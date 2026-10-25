/**
 * @file src/storage/repositories/dispute.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage-interface segment for disputes — the CRUD + audit-log contract each backend
 *   implements for work disputes (create/get/lookup-by-tracking-code, update, append audit entries, list).
 *
 * @structure
 *   - DisputeRepository: interface with createDispute, getDispute, getDisputeByTrackingCode,
 *     updateDispute, transitionDisputeStatus, addDisputeAuditEntry, getDisputeAuditLog,
 *     listDisputesByProvider, listAllDisputes
 *
 * @version-history
 *   v1.1.0 — 2026-10-25 — transitionDisputeStatus: the conditional status move a resolution claims the
 *     dispute with before a refund moves (secaudit2026oct22, dispute-resolution-without-cas).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { DisputeRecord, DisputeAuditEntry } from '../interface.js';

export interface DisputeRepository {
  createDispute(dispute: DisputeRecord): Promise<DisputeRecord>;
  getDispute(id: string): Promise<DisputeRecord | null>;
  getDisputeByTrackingCode(tc: string): Promise<DisputeRecord | null>;
  updateDispute(id: string, updates: Partial<DisputeRecord>): Promise<DisputeRecord | null>;
  /**
   * Move a dispute to `to` only while its status is one of `from`, in one conditional UPDATE, and
   * answer whether this call moved it. A resolution claims the dispute this way before any morsel
   * moves, so concurrent resolutions move the refund once. Inside storage.transaction the row stays
   * locked until commit.
   */
  transitionDisputeStatus(id: string, from: readonly string[], to: string, updatedAt: string): Promise<boolean>;
  addDisputeAuditEntry(disputeId: string, entry: DisputeAuditEntry): Promise<DisputeAuditEntry>;
  getDisputeAuditLog(disputeId: string): Promise<DisputeAuditEntry[]>;
  listDisputesByProvider(gaii: string): Promise<DisputeRecord[]>;
  listAllDisputes(limit?: number): Promise<DisputeRecord[]>;
}
