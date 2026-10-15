/**
 * @file src/services/trust.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Trust scoring service — computes an agent's trust score (0–100) from a weighted blend
 *   of delivery success rate (0.30), positive ratings (0.25), account age (0.15), volume (0.15), and
 *   disputes lost (0.15), with anti-manipulation diversity tracking over unique counterparties.
 *
 *
 *   THE STATES ARE THE ONES THE ROUTES WRITE (feature-list audit #144). Failures were counted from
 *   `failed` and `rejected`, which no route writes, and a lost dispute only from a free-text verdict
 *   spelled exactly `requester_wins`. The work states and the dispute verdicts below are the ones
 *   routes/work.ts, services/work-lifecycle.ts, routes/disputes.ts and services/core-jobs.ts store.
 *
 *   THE STORED SCORE FOLLOWS THE EVENT. `AgentRecord.trustScore` is what listings, the catalogue and
 *   the agent prompts read. It was written only when somebody opened the agent's profile, so it lagged
 *   every delivery, rating and dispute. refreshTrustScore() is called where each of those happens.
 * @structure
 *   - calculateTrustScore(gaii, storage): aggregates work/dispute history into a TrustData score
 *   - refreshTrustScore(storage, gaii): recompute and store, after a work or dispute event
 *   - DELIVERED_WORK_STATES / FAILED_WORK_STATES / EXPIRED_WORK_STATES / LOST_DISPUTE_VERDICTS
 *   - TRUST_WEIGHTS / DISPUTE_PENALTY_PER_LOSS: scoring constants
 *   - TrustData: the computed score plus its component breakdown
 *
 * @version-history
 *   2026-10-15 — Counts the work states and dispute verdicts the routes write; refreshTrustScore() stores the score when a work item is delivered, rated, rejected or expires and when a dispute resolves (feature-list audit #144).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

/**
 * A delivered work item. A dispute opens only on `delivered` or `rated` work (routes/disputes.ts), and
 * every `settled` is written by a dispute resolution, so the dispute states are delivered work too:
 * the dispute's own outcome is counted separately, as a lost dispute.
 */
export const DELIVERED_WORK_STATES: ReadonlySet<string> = new Set(['delivered', 'rated', 'disputed', 'contested', 'escalated', 'settled']);
/** The provider declined a pending request: POST /v1/work/:tc/reject writes `cancelled`. */
export const FAILED_WORK_STATES: ReadonlySet<string> = new Set(['cancelled']);
/** Nobody delivered before the deadline: the work timeout job writes `expired`. */
export const EXPIRED_WORK_STATES: ReadonlySet<string> = new Set(['expired']);
/**
 * A dispute the provider lost: an operator ruled for the requester, the provider accepted fault
 * (recorded as `requester_wins` by POST /v1/work/:tc/accept-fault), or the escalated dispute ran out
 * its 30 days and the escrow went back to the requester (`timeout`, services/core-jobs.ts).
 */
export const LOST_DISPUTE_VERDICTS: ReadonlySet<string> = new Set(['requester_wins', 'timeout']);

/** Trust score component weights (must sum to 1.0) */
const TRUST_WEIGHTS = {
  successRate: 0.30,
  positiveRatings: 0.25,
  accountAge: 0.15,
  volume: 0.15,
  disputes: 0.15,
} as const;

/** Points deducted per lost dispute (from a base of 100) */
const DISPUTE_PENALTY_PER_LOSS = 33;

export interface TrustData {
  score: number;
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  expiredDeliveries: number;
  successRate: number;
  positiveRatings: number;
  negativeRatings: number;
  avgDeliveryTimeSeconds: number;
  ageDays: number;
  disputesLost: number;
}

export async function calculateTrustScore(gaii: string, storage: Storage): Promise<TrustData> {
  const agent = await storage.getAgent(gaii);
  if (!agent) {
    return defaultTrust();
  }

  const providerWork = await storage.listWorkByProvider(gaii);

  let delivered = 0, failed = 0, expired = 0;
  let positiveRatings = 0, negativeRatings = 0;
  let totalDeliveryTime = 0;

  // Track unique counterparties for diversity check (anti-manipulation)
  const uniqueCounterparties = new Set<string>();

  // Track disputes lost from actual dispute data
  const disputes = await storage.listDisputesByProvider(gaii);
  const disputesLost = disputes.filter(d =>
    d.status === 'resolved' && LOST_DISPUTE_VERDICTS.has(d.ruling?.ruling ?? '')
  ).length;

  for (const w of providerWork) {
    // SECURITY: Skip self-work (defense in depth — should be blocked at creation)
    if (w.requesterGaii === gaii) continue;

    if (DELIVERED_WORK_STATES.has(w.status)) {
      delivered++;
      uniqueCounterparties.add(w.requesterGaii);
      if (w.rating) {
        if (w.rating.score >= 4) positiveRatings++;
        else negativeRatings++;
      }
      // Estimate delivery time from timestamps
      const created = new Date(w.createdAt).getTime();
      const updated = new Date(w.updatedAt).getTime();
      totalDeliveryTime += (updated - created) / 1000;
    } else if (FAILED_WORK_STATES.has(w.status)) {
      failed++;
    } else if (EXPIRED_WORK_STATES.has(w.status)) {
      expired++;
    }
  }

  const totalAttempts = delivered + failed + expired;
  const successRate = totalAttempts > 0 ? (delivered / totalAttempts) * 100 : 0;

  const totalRatings = positiveRatings + negativeRatings;
  const positiveRatingRatio = totalRatings > 0 ? (positiveRatings / totalRatings) * 100 : 50;

  const ageDays = Math.floor((Date.now() - new Date(agent.createdAt).getTime()) / 86_400_000);
  const ageFactor = Math.min(100, Math.log2(ageDays + 1) * 15);
  const volumeFactor = Math.min(100, Math.log2(delivered + 1) * 11);
  const disputePenalty = Math.max(0, 100 - disputesLost * DISPUTE_PENALTY_PER_LOSS);

  let score = Math.floor(
    successRate * TRUST_WEIGHTS.successRate +
    positiveRatingRatio * TRUST_WEIGHTS.positiveRatings +
    ageFactor * TRUST_WEIGHTS.accountAge +
    volumeFactor * TRUST_WEIGHTS.volume +
    disputePenalty * TRUST_WEIGHTS.disputes,
  );

  // SECURITY: Require minimum 3 unique counterparties for meaningful trust score
  // Prevents trust inflation through repeated work with a single colluding party
  if (uniqueCounterparties.size < 3) {
    score = Math.min(score, 40);
  }

  // Inactivity decay: -1 per 30 days with no transactions
  if (agent.lastSeen) {
    const daysSinceActive = Math.floor((Date.now() - new Date(agent.lastSeen).getTime()) / 86_400_000);
    const decayPeriods = Math.floor(daysSinceActive / 30);
    score = Math.max(0, score - decayPeriods);
  }

  // New agent cap: max 65 for first 7 days
  if (ageDays < 7 && score > 65) {
    score = 65;
  }

  score = Math.max(0, Math.min(100, score));

  const avgDeliveryTimeSeconds = delivered > 0 ? Math.round(totalDeliveryTime / delivered) : 0;

  return {
    score,
    totalDeliveries: delivered,
    successfulDeliveries: delivered,
    failedDeliveries: failed,
    expiredDeliveries: expired,
    successRate: totalAttempts > 0 ? delivered / totalAttempts : 0,
    positiveRatings,
    negativeRatings,
    avgDeliveryTimeSeconds,
    ageDays,
    disputesLost,
  };
}

/**
 * Recompute an agent's score and store it on the agent record, after an event that changes it: work
 * delivered, rated, rejected or expired, a dispute resolved. A provider that is not an agent (a person
 * delivering in person) has no stored score and is left alone. Never throws: the event has already
 * happened, and a stale score is not worth failing it for.
 */
export async function refreshTrustScore(storage: Storage, gaii: string): Promise<void> {
  try {
    const agent = await storage.getAgent(gaii);
    if (!agent) return;
    const trust = await calculateTrustScore(gaii, storage);
    if (trust.score !== agent.trustScore) await storage.updateAgent(gaii, { trustScore: trust.score });
  } catch (err) {
    logger.warn('trust: could not store the recomputed score', { gaii, error: String(err) });
  }
}

function defaultTrust(): TrustData {
  return {
    score: 50,
    totalDeliveries: 0,
    successfulDeliveries: 0,
    failedDeliveries: 0,
    expiredDeliveries: 0,
    successRate: 0,
    positiveRatings: 0,
    negativeRatings: 0,
    avgDeliveryTimeSeconds: 0,
    ageDays: 0,
    disputesLost: 0,
  };
}
