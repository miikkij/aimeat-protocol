/**
 * @file gate-expiry.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Durable-pause expiry for gate PendingApprovals. A pending approval may carry a
 *   `deadline`; once it passes, the default escalation is **abort** (fail-closed): the approval is
 *   marked `rejected` with note "expired" so nothing auto-proceeds on a stale, undecided gate
 *   (research #3 "deadline → null/abort"). Applied two ways: lazily on read (so the behavior is
 *   observable without waiting for a timer) and via the scheduled job core:gate-expiry
 *   (services/core-jobs.ts, every 10 minutes).
 * @structure
 *   - isOverdue() — pure predicate (pending + past deadline)
 *   - expireApproval() — mark one overdue approval rejected
 *   - expireOverdueApprovals() — sweep all overdue (used by the scheduled job + lazily by the list route)
 * @usage
 *   import { expireOverdueApprovals } from '../services/gate-expiry.js';
 * @version-history
 *   2026-10-15 — The sweep runs as the scheduled job core:gate-expiry. startGateExpiryJob(), a
 *     setInterval nothing ever started, is removed: a proposal expired only when somebody opened
 *     the list or the decision (feature-list audit #59).
 *   v1.0.0 -- 2026-06-07 -- Phase 4: durable pause — abort-on-deadline.
 *   v1.1.0 -- 2026-09-25 -- The sweep tells the member whose suggested workspace change expired
 *     (services/workspace-suggestion-notices.ts): a suggestion is an approval that somebody is
 *     waiting on, and an expiry nobody hears of reads as an admin who never answered.
 */
import type { Storage, PendingApprovalRecord } from '../storage/interface.js';
import { isMemberChangeAction, noticeRequester } from './workspace-suggestion-notices.js';

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
  for (const a of overdue) {
    await expireApproval(storage, a.id, nowIso);
    if (isMemberChangeAction(a.action)) await noticeRequester(storage, a, 'expired');
  }
  return overdue.length;
}
