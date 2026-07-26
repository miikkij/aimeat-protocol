/**
 * @file gate-expiry.ts
 * @description Durable-pause expiry for gate PendingApprovals. A pending approval may carry a
 *   `deadline`; once it passes, the default escalation is **abort** (fail-closed): the approval is
 *   marked `rejected` with note "expired" so nothing auto-proceeds on a stale, undecided gate
 *   (research #3 "deadline → null/abort"). Applied two ways: lazily on read (so the behavior is
 *   observable without waiting for a timer) and via a periodic backstop job.
 * @structure
 *   - isOverdue() — pure predicate (pending + past deadline)
 *   - expireApproval() — mark one overdue approval rejected
 *   - expireOverdueApprovals() — sweep all overdue (used by the job + lazily by the list route)
 *   - startGateExpiryJob() — periodic backstop (10 min)
 * @usage
 *   import { expireOverdueApprovals, startGateExpiryJob } from '../services/gate-expiry.js';
 * @version-history
 *   v1.0.0 -- 2026-06-07 -- Phase 4: durable pause — abort-on-deadline.
 */
import type { Storage, PendingApprovalRecord } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

export function isOverdue(a: PendingApprovalRecord, nowIso: string): boolean {
  return a.status === 'pending' && !!a.deadline && a.deadline < nowIso;
}

export async function expireApproval(storage: Storage, approvalId: string, nowIso: string): Promise<void> {
  await storage.updatePendingApproval(approvalId, {
    status: 'rejected',
    decidedBy: 'system',
    decidedAt: nowIso,
    resolutionNote: 'expired: deadline passed',
    updatedAt: nowIso,
  });
}

/** Sweep every overdue pending approval to rejected. Returns how many were expired. */
export async function expireOverdueApprovals(storage: Storage, nowIso: string): Promise<number> {
  const overdue = await storage.listOverduePendingApprovals(nowIso);
  for (const a of overdue) await expireApproval(storage, a.id, nowIso);
  return overdue.length;
}

/** Periodic backstop (every 10 minutes), mirroring the consent-expiry job. */
export function startGateExpiryJob(storage: Storage): NodeJS.Timeout {
  return setInterval(() => {
    expireOverdueApprovals(storage, new Date().toISOString()).catch(err => { logger.warn('startGateExpiryJob: background', { error: String(err) }); });
  }, 10 * 60 * 1000);
}
