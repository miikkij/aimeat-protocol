/**
 * @file src/services/cross-node-matching.ts
 * @description Cross-node community matching service. Produces anonymized interest/location
 *   profiles (only for GHIIs that granted community-discovery consent) and scores similarity
 *   between two profiles, for privacy-preserving federated match discovery.
 *
 * @structure
 *   - AnonymizedProfile / CrossMatchRequest: data shapes for anonymized discovery
 *   - createCrossNodeMatchingService(config, storage): getAnonymizedProfiles + calculateCrossMatchScore
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';

export interface AnonymizedProfile {
  hash: string;
  interests: string[];
  city?: string;
  country?: string;
}

export interface CrossMatchRequest {
  id: string;
  sourceNodeId: string;
  profileHash: string;
  interests: string[];
  city?: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
}

export interface CrossNodeMatchingService {
  getAnonymizedProfiles(): Promise<AnonymizedProfile[]>;
  calculateCrossMatchScore(profileA: AnonymizedProfile, profileB: AnonymizedProfile): number;
}

export function createCrossNodeMatchingService(config: AimeatConfig, storage: Storage): CrossNodeMatchingService {
  return {
    async getAnonymizedProfiles() {
      const profiles: AnonymizedProfile[] = [];
      const ghiis = await storage.listGHIIs();

      for (const ghii of ghiis) {
        // Only include profiles with community-discovery consent
        const consents = await storage.listConsents(ghii.ghii, { status: 'active' });
        const hasDiscoveryConsent = consents.some(c =>
          c.purpose === 'community-discovery' &&
          (c.scope === 'federation' || c.scope === 'dmz')
        );
        if (!hasDiscoveryConsent) continue;

        // Get interest data from profile memory keys
        const agents = await storage.getAgentsByOwner(ghii.ownerName);
        let interests: string[] = [];
        let city: string | undefined;
        let country: string | undefined;

        for (const agent of agents) {
          const memories = await storage.listMemory(agent.gaii, { prefix: 'profile.' });
          for (const mem of memories) {
            if (mem.key.includes('interests') && Array.isArray(mem.value)) {
              interests = mem.value as string[];
            }
            if (mem.key.includes('location')) {
              const loc = mem.value as Record<string, string>;
              city = loc.city;
              country = loc.country;
            }
          }
        }

        if (interests.length === 0) continue;

        // Generate anonymous hash (cannot be reverse-mapped to GHII)
        const hash = createHash('sha256')
          .update(ghii.ghii + config.nodeId + 'cross-match-salt')
          .digest('hex')
          .slice(0, 16);

        profiles.push({ hash, interests, city, country });
      }

      return profiles;
    },

    calculateCrossMatchScore(profileA, profileB) {
      // Interest overlap (0-1)
      const sharedInterests = profileA.interests.filter(i =>
        profileB.interests.map(b => b.toLowerCase()).includes(i.toLowerCase())
      );
      const interestScore = sharedInterests.length /
        Math.max(Math.min(profileA.interests.length, profileB.interests.length), 1);

      // Location bonus
      let locationBonus = 0;
      if (profileA.city && profileB.city &&
          profileA.city.toLowerCase() === profileB.city.toLowerCase()) {
        locationBonus = 0.2;
      } else if (profileA.country && profileB.country &&
                 profileA.country.toLowerCase() === profileB.country.toLowerCase()) {
        locationBonus = 0.1;
      }

      return Math.min(interestScore * 0.8 + locationBonus, 1.0);
    },
  };
}
