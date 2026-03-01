import type { AimeatConfig } from '../config.js';
import type { Storage, OrganismReputationRecord } from '../storage/interface.js';

export interface OrganismReputationService {
  calculateReputation(organismId: string): Promise<OrganismReputationRecord | null>;
}

export function createOrganismReputationService(config: AimeatConfig, storage: Storage): OrganismReputationService {
  return {
    async calculateReputation(organismId: string) {
      const organism = await storage.getOrganism(organismId);
      if (!organism) return null;

      // Component weights
      const WEIGHT_MEMBERS = 0.20;
      const WEIGHT_ACTIVITY = 0.25;
      const WEIGHT_TRUST = 0.25;
      const WEIGHT_AGE = 0.15;
      const WEIGHT_FLAGS = 0.15;

      // 1. Member score: log10(members) / log10(max_members)
      const memberCount = organism.members.length;
      const maxMembers = organism.maxMembers || 100;
      const memberScore = maxMembers > 1 ? (Math.log10(Math.max(memberCount, 1)) / Math.log10(maxMembers)) : 0;

      // 2. Activity score: based on board posts in last month
      let activityScore = 0;
      try {
        const board = await storage.getBoard(organism.boardId);
        if (board) {
          const posts = await storage.listPosts(organism.boardId, { limit: 1000 });
          const oneMonthAgo = Date.now() - 30 * 24 * 3600_000;
          const recentPosts = posts.filter(p => new Date(p.createdAt).getTime() > oneMonthAgo);
          const postsPerWeek = recentPosts.length / 4.3; // ~4.3 weeks per month
          activityScore = Math.min(postsPerWeek / 10, 1.0); // 10+ posts/week = 1.0
        }
      } catch { /* no board */ }

      // 3. Trust score: average trust of members
      let trustScore = 0;
      let trustSum = 0;
      let trustCount = 0;
      for (const ghii of organism.members) {
        const ghiiRecord = await storage.getGHII(ghii);
        if (ghiiRecord) {
          // Use verification level as trust proxy (0-2, normalized to 0-1)
          trustSum += ghiiRecord.verificationLevel / 2;
          trustCount++;
        }
      }
      if (trustCount > 0) trustScore = trustSum / trustCount;

      // 4. Age score: min(age_days / 365, 1.0)
      const ageDays = (Date.now() - new Date(organism.createdAt).getTime()) / (24 * 3600_000);
      const ageScore = Math.min(ageDays / 365, 1.0);

      // 5. Flag score: max(1.0 - (total_flags / (members * 0.1)), 0)
      let totalFlags = 0;
      try {
        const flags = await storage.listFlags({ targetType: 'board_post' });
        // Count flags related to this organism's board
        totalFlags = flags.filter(f => f.targetId.startsWith(organism.boardId)).length;
      } catch { /* no flags */ }
      const flagDivisor = Math.max(memberCount * 0.1, 1);
      const flagScore = Math.max(1.0 - (totalFlags / flagDivisor), 0);

      // Calculate total score (0-100)
      const rawScore =
        memberScore * WEIGHT_MEMBERS +
        activityScore * WEIGHT_ACTIVITY +
        trustScore * WEIGHT_TRUST +
        ageScore * WEIGHT_AGE +
        flagScore * WEIGHT_FLAGS;

      const score = Math.round(rawScore * 100);

      const record: OrganismReputationRecord = {
        organismId,
        score,
        breakdown: {
          memberScore: Math.round(memberScore * 100),
          activityScore: Math.round(activityScore * 100),
          trustScore: Math.round(trustScore * 100),
          ageScore: Math.round(ageScore * 100),
          flagScore: Math.round(flagScore * 100),
        },
        calculatedAt: new Date().toISOString(),
      };

      await storage.setOrganismReputation(record);
      return record;
    },
  };
}
