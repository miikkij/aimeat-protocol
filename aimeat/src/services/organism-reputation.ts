/**
 * @file src/services/organism-reputation.ts
 * @description Organism reputation calculation service (Phase 3.4) — computes a weighted 0–1
 *   reputation score for an organism from member count, activity, trust, age, and flags, using
 *   log/cap normalization constants.
 *
 * @structure
 *   - createOrganismReputationService(config, storage): factory returning { calculateReputation }
 *   - calculateReputation(organismId): loads organism + active members and blends the weighted factors
 *   - WEIGHT_* / normalization constants: member/activity/trust/age/flags weights and caps
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

// Phase 3.4 — Organism Reputation Calculation Service

import type { AimeatConfig } from '../config.js';
import type { Storage, OrganismReputationRecord } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

// ── Weights ─────────────────────────────────────────────────────────
const WEIGHT_MEMBERS  = 0.20;
const WEIGHT_ACTIVITY = 0.25;
const WEIGHT_TRUST    = 0.25;
const WEIGHT_AGE      = 0.15;
const WEIGHT_FLAGS    = 0.15;

// ── Normalization constants ─────────────────────────────────────────
const MAX_MEMBERS_REFERENCE  = 1000;   // log10(members) / log10(1000)
const ACTIVITY_CAP_PER_WEEK  = 50;     // 50 posts/week = 1.0
const AGE_MATURITY_DAYS      = 365;    // 1 year = fully mature

export interface OrganismReputationService {
  calculateReputation(organismId: string): Promise<OrganismReputationRecord | null>;
}

export function createOrganismReputationService(
  _config: AimeatConfig,
  storage: Storage,
): OrganismReputationService {

  async function calculateReputation(organismId: string): Promise<OrganismReputationRecord | null> {
    // 1. Load organism
    const organism = await storage.getOrganism(organismId);
    if (!organism) {
      logger.warn('organism-reputation: organism not found', { organismId });
      return null;
    }

    // 2. Get active members
    const members = await storage.listMembers(organismId, { status: 'active' });
    const memberCount = members.length;

    // ── Member count score ──────────────────────────────────────────
    // log10(members) / log10(max_members), clamped to [0, 1]
    const memberScore = memberCount > 0
      ? Math.min(Math.log10(memberCount) / Math.log10(MAX_MEMBERS_REFERENCE), 1.0)
      : 0;

    // ── Activity score ──────────────────────────────────────────────
    // Use organism's board to count recent posts. If the board lookup
    // is not viable, fall back to a member-count proxy.
    let activityScore = 0;
    try {
      const board = await storage.getBoard(organism.boardId);
      if (board) {
        const posts = await storage.listPosts(board.id, {});
        // Count posts from the last 28 days (4 weeks)
        const fourWeeksAgo = Date.now() - 28 * 24 * 60 * 60 * 1000;
        const recentPosts = posts.filter(p => new Date(p.createdAt).getTime() >= fourWeeksAgo);
        const postsPerWeek = recentPosts.length / 4;
        activityScore = Math.min(postsPerWeek / ACTIVITY_CAP_PER_WEEK, 1.0);
      }
    } catch {
      // Fallback: use member count as a rough proxy for activity
      activityScore = Math.min(memberCount / 100, 1.0);
      logger.debug('organism-reputation: board activity lookup failed, using member proxy', { organismId });
    }

    // ── Member trust average ────────────────────────────────────────
    // Look up each member's GHII record for trustScore (0-100)
    let trustScoreAvg = 0;
    if (memberCount > 0) {
      let totalTrust = 0;
      let counted = 0;
      for (const member of members) {
        const ghiiRecord = await storage.getGHII(member.ghii);
        if (ghiiRecord && typeof ghiiRecord.trustScore === 'number') {
          totalTrust += ghiiRecord.trustScore;
          counted++;
        }
      }
      // Normalize to 0-1 (trustScore is 0-100)
      trustScoreAvg = counted > 0 ? (totalTrust / counted) / 100 : 0;
    }

    // ── Age score ───────────────────────────────────────────────────
    // min(age_days / 365, 1.0)
    const ageDays = (Date.now() - new Date(organism.createdAt).getTime()) / (24 * 60 * 60 * 1000);
    const ageScore = Math.min(ageDays / AGE_MATURITY_DAYS, 1.0);

    // ── Flag history score ──────────────────────────────────────────
    // max(1.0 - (total_flags / (members * 0.1)), 0)
    // We don't track organism-level flags separately yet, so total_flags = 0
    const totalFlags = 0;
    const flagDenominator = memberCount * 0.1;
    const flagScore = flagDenominator > 0
      ? Math.max(1.0 - (totalFlags / flagDenominator), 0)
      : 1.0;  // No members = no flag penalty

    // ── Final weighted score (0-100) ────────────────────────────────
    const rawScore =
      (memberScore  * WEIGHT_MEMBERS  +
       activityScore * WEIGHT_ACTIVITY +
       trustScoreAvg * WEIGHT_TRUST    +
       ageScore      * WEIGHT_AGE      +
       flagScore     * WEIGHT_FLAGS) * 100;

    const score = Math.max(0, Math.min(100, Math.round(rawScore * 100) / 100));

    const record: OrganismReputationRecord = {
      organismId,
      score,
      breakdown: {
        memberScore:   Math.round(memberScore * 10000) / 10000,
        activityScore: Math.round(activityScore * 10000) / 10000,
        trustScore:    Math.round(trustScoreAvg * 10000) / 10000,
        ageScore:      Math.round(ageScore * 10000) / 10000,
        flagScore:     Math.round(flagScore * 10000) / 10000,
      },
      calculatedAt: new Date().toISOString(),
    };

    // Persist
    await storage.setOrganismReputation(record);

    logger.info('organism-reputation: calculated', {
      organismId,
      score,
      members: memberCount,
    });

    return record;
  }

  return { calculateReputation };
}
