/**
 * @file src/services/trust.ts
 * @description Trust scoring service — computes an agent's trust score (0–100) from a weighted blend
 *   of delivery success rate (0.30), positive ratings (0.25), account age (0.15), volume (0.15), and
 *   disputes lost (0.15), with anti-manipulation diversity tracking over unique counterparties.
 *
 * @structure
 *   - calculateTrustScore(gaii, storage): aggregates work/dispute history into a TrustData score
 *   - TRUST_WEIGHTS / DISPUTE_PENALTY_PER_LOSS: scoring constants
 *   - TrustData: the computed score plus its component breakdown
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { Storage } from '../storage/interface.js';

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
    d.status === 'resolved' && d.ruling?.ruling === 'requester_wins'
  ).length;

  for (const w of providerWork) {
    // SECURITY: Skip self-work (defense in depth — should be blocked at creation)
    if (w.requesterGaii === gaii) continue;

    if (w.status === 'delivered' || w.status === 'rated') {
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
    } else if (w.status === 'failed' || w.status === 'rejected') {
      failed++;
    } else if (w.status === 'expired') {
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
