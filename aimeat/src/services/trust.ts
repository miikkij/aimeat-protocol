import type { Storage } from '../storage/interface.js';

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
  const disputesLost = 0; // TODO: implement disputes tracking

  for (const w of providerWork) {
    if (w.status === 'delivered' || w.status === 'rated') {
      delivered++;
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
  const disputePenalty = Math.max(0, 100 - disputesLost * 33);

  let score = Math.floor(
    successRate * 0.30 +
    positiveRatingRatio * 0.25 +
    ageFactor * 0.15 +
    volumeFactor * 0.15 +
    disputePenalty * 0.15,
  );

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
