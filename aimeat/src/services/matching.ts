/**
 * @file src/services/matching.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AI Matching Engine — automatically scores and pairs user profiles by shared interests
 *   (0.40), geographic proximity (0.25), activity (0.20), and compatibility (0.15), persisting match
 *   records and optionally emailing suggestions. Runs on demand or on a schedule.
 *
 * @structure
 *   - createMatchingEngine(...): builds the engine (score profiles, generate + store matches)
 *   - startMatchingScheduler(...): periodic auto-matching runner
 *   - ProfileData / MatchScore: input profile and per-pair score breakdown types
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 *   v1.1.0 — 2026-07-16 — batch owner-agents + consents in the matchable-profile pre-pass
 */

import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, MatchRecord } from '../storage/interface.js';
import type { DirectoryService, DirectoryEntry } from './directory.js';
import type { EmailService } from './email.js';
import { logger } from '../utils/logger.js';

// ── Exported interfaces ──────────────────────────────────────

export interface ProfileData {
  ghii: string;
  displayName: string;
  interests: string[];
  seeking?: string[];
  city?: string;
  area?: string;
  country?: string;
  lat?: number;
  lon?: number;
  lastActivityAt?: string;
}

export interface MatchScore {
  score: number;
  breakdown: {
    sharedInterests: string[];
    distanceKm: number | null;
    activityDays: number;
    sharedInterestsScore: number;
    distanceScore: number;
    activityScore: number;
    compatibilityScore: number;
  };
}

export interface MatchingRoundResult {
  profilesScanned: number;
  matchesCreated: number;
  durationMs: number;
  timestamp: string;
}

export interface MatchingEngine {
  runMatchingRound(): Promise<MatchingRoundResult>;
  calculateMatchScore(profileA: ProfileData, profileB: ProfileData, maxDistanceKm: number): MatchScore;
  getSuggestionsForProfile(ghii: string): Promise<MatchRecord[]>;
}

// ── Haversine distance ───────────────────────────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Score calculation ────────────────────────────────────────

function calculateMatchScoreImpl(
  profileA: ProfileData,
  profileB: ProfileData,
  maxDistanceKm: number,
): MatchScore {
  // 1. Shared interests score: min(shared_count / 3, 1.0)
  const lowerB = profileB.interests.map(i => i.toLowerCase());
  const sharedInterests: string[] = [];
  for (const interest of profileA.interests) {
    if (lowerB.includes(interest.toLowerCase())) {
      sharedInterests.push(interest);
    }
  }
  const sharedInterestsScore = Math.min(sharedInterests.length / 3, 1.0);

  // 2. Distance score: max(1.0 - (distance_km / max_distance_km), 0)
  let distanceKm: number | null = null;
  let distanceScore = 0.5; // default when location is unknown
  if (
    profileA.lat !== undefined && profileA.lon !== undefined &&
    profileB.lat !== undefined && profileB.lon !== undefined
  ) {
    distanceKm = haversineKm(profileA.lat, profileA.lon, profileB.lat, profileB.lon);
    distanceScore = Math.max(1.0 - (distanceKm / maxDistanceKm), 0);
  }

  // 3. Activity score: max(1.0 - (days_since_last_activity / 90), 0)
  let activityDays = 90; // default: assume inactive
  if (profileB.lastActivityAt) {
    const daysSince = (Date.now() - new Date(profileB.lastActivityAt).getTime()) / 86_400_000;
    activityDays = Math.round(daysSince);
  }
  const activityScore = Math.max(1.0 - (activityDays / 90), 0);

  // 4. Compatibility score: seeking_match_ratio
  let compatibilityScore = 0.5; // default when no seeking data
  if (profileA.seeking && profileA.seeking.length > 0) {
    const seekingLower = profileA.seeking.map(s => s.toLowerCase());
    // How well does profileB match what profileA is seeking?
    const matchCount = seekingLower.filter(s =>
      lowerB.includes(s) ||
      (profileB.city?.toLowerCase() === s) ||
      (profileB.area?.toLowerCase() === s) ||
      (profileB.country?.toLowerCase() === s)
    ).length;
    compatibilityScore = Math.min(matchCount / profileA.seeking.length, 1.0);
  }

  // Weighted sum
  const score =
    (0.40 * sharedInterestsScore) +
    (0.25 * distanceScore) +
    (0.20 * activityScore) +
    (0.15 * compatibilityScore);

  return {
    score: Math.round(score * 1000) / 1000, // 3 decimal places
    breakdown: {
      sharedInterests,
      distanceKm: distanceKm !== null ? Math.round(distanceKm * 10) / 10 : null,
      activityDays,
      sharedInterestsScore: Math.round(sharedInterestsScore * 1000) / 1000,
      distanceScore: Math.round(distanceScore * 1000) / 1000,
      activityScore: Math.round(activityScore * 1000) / 1000,
      compatibilityScore: Math.round(compatibilityScore * 1000) / 1000,
    },
  };
}

// ── DirectoryEntry to ProfileData conversion ─────────────────

function entryToProfile(entry: DirectoryEntry, lastActivityAt?: string): ProfileData {
  return {
    ghii: entry.ghii,
    displayName: entry.displayName,
    interests: entry.interests,
    city: entry.city,
    area: entry.area,
    country: entry.country,
    lat: entry.lat,
    lon: entry.lon,
    lastActivityAt,
  };
}

// ── Factory ──────────────────────────────────────────────────

export function createMatchingEngine(
  config: AimeatConfig,
  storage: Storage,
  directoryService: DirectoryService,
  emailService: EmailService,
): MatchingEngine {
  async function runMatchingRound(): Promise<MatchingRoundResult> {
    const startTime = Date.now();
    let matchesCreated = 0;

    try {
      // 1. Rebuild directory index to get latest data
      await directoryService.rebuildIndex();

      // 2. Get all profiles with consent for matching
      const allEntries = (await directoryService.search({ perPage: 10000 })).entries;

      // Filter to profiles with matching consent
      const matchableProfiles: Array<{ entry: DirectoryEntry; agentGaii: string }> = [];

      // Pre-resolve each entry's owner, then batch the owner-agents + consents fan-out into
      // two IN queries (was O(entries×agents) listConsents calls).
      const ownerByGhii = new Map<string, string>();
      for (const entry of allEntries) {
        try {
          const rec = await storage.getGHII(entry.ghii);
          if (rec) ownerByGhii.set(entry.ghii, rec.ownerName);
        } catch (err) { logger.warn('allEntries: skip profiles we cant resolve', { error: String(err) }); }
      }
      const agentsByOwner = await storage.getAgentsByOwners([...new Set(ownerByGhii.values())]);
      const consentsByAgent = await storage.listConsentsForAgents(
        Object.values(agentsByOwner).flat().map(a => a.gaii), { status: 'active' },
      );

      for (const entry of allEntries) {
        const ownerName = ownerByGhii.get(entry.ghii);
        if (!ownerName) continue;

        const agents = agentsByOwner[ownerName] ?? [];
        let hasMatchingConsent = false;
        let consentAgentGaii = '';

        for (const agent of agents) {
          const consents = consentsByAgent[agent.gaii] ?? [];
          const matchConsent = consents.find(
            c => c.purpose === 'matching' && c.status === 'active',
          );
          if (matchConsent) {
            hasMatchingConsent = true;
            consentAgentGaii = agent.gaii;
            break;
          }
        }

        if (hasMatchingConsent) {
          matchableProfiles.push({ entry, agentGaii: consentAgentGaii });
        }
      }

      const profilesScanned = matchableProfiles.length;
      logger.info('Matching round: scanning profiles', { count: profilesScanned });

      // 3. For each profile, find potential matches
      const cooldownMs = config.matchCooldownDays * 86_400_000;

      for (const { entry: profileA, agentGaii: agentA } of matchableProfiles) {
        const profileDataA = entryToProfile(profileA);

        // Load seeking data from memory
        const ghiiA = await storage.getGHII(profileA.ghii);
        if (ghiiA) {
          const seekingMemory = await storage.getMemory(agentA, `profile.${ghiiA.username}.seeking`);
          if (seekingMemory?.value) {
            if (Array.isArray(seekingMemory.value)) {
              profileDataA.seeking = seekingMemory.value as string[];
            } else if (typeof seekingMemory.value === 'object' && seekingMemory.value !== null) {
              const val = seekingMemory.value as Record<string, unknown>;
              if (Array.isArray(val.items)) profileDataA.seeking = val.items as string[];
              if (Array.isArray(val.seeking)) profileDataA.seeking = val.seeking as string[];
            }
          }
        }

        const candidates: Array<{ score: MatchScore; entry: DirectoryEntry }> = [];

        for (const { entry: profileB } of matchableProfiles) {
          // Skip self
          if (profileB.ghii === profileA.ghii) continue;

          // Check cooldown: skip if already suggested recently
          const existingMatch = await storage.getMatchByPair(profileA.ghii, profileB.ghii);
          if (existingMatch) {
            const matchAge = Date.now() - new Date(existingMatch.createdAt).getTime();
            // Skip if within cooldown and not dismissed/expired
            if (matchAge < cooldownMs && !['dismissed', 'expired'].includes(existingMatch.status)) {
              continue;
            }
            // Skip if recently dismissed (within cooldown)
            if (existingMatch.status === 'dismissed' && matchAge < cooldownMs) {
              continue;
            }
          }

          const profileDataB = entryToProfile(profileB);
          const score = calculateMatchScoreImpl(profileDataA, profileDataB, config.matchMaxDistanceKm);

          // Only include matches above threshold
          if (score.score >= config.matchThreshold) {
            candidates.push({ score, entry: profileB });
          }
        }

        // Sort by score descending, take top N
        candidates.sort((a, b) => b.score.score - a.score.score);
        const topCandidates = candidates.slice(0, config.matchMaxSuggestions);

        // 4. Create MatchRecords
        for (const { score, entry: profileB } of topCandidates) {
          const now = new Date().toISOString();
          const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString(); // 30 days

          const matchRecord: MatchRecord = {
            id: `match-${randomBytes(8).toString('hex')}`,
            profileA: profileA.ghii,
            profileB: profileB.ghii,
            score: score.score,
            breakdown: score.breakdown,
            status: 'suggested',
            notifiedAt: null,
            respondedAt: null,
            expiresAt,
            createdAt: now,
          };

          await storage.createMatch(matchRecord);
          matchesCreated++;

          // 5. Send email notification if enabled
          if (emailService.enabled) {
            try {
              const ghiiRecordA = await storage.getGHII(profileA.ghii);
              if (ghiiRecordA?.emailHash) {
                // Look up email from verification records
                const verifications = await storage.getEmailVerificationsByOwner?.(ghiiRecordA.ownerName);
                const verified = verifications?.find(v => v.status === 'verified');
                if (verified) {
                  // Update status to notified
                  await storage.updateMatch(matchRecord.id, {
                    status: 'notified',
                    notifiedAt: new Date().toISOString(),
                  });

                  logger.info('Match notification would send', {
                    recipientGhii: profileA.ghii,
                    matchedGhii: profileB.ghii,
                    score: score.score,
                  });
                }
              }
            } catch (err) {
              // Failed to send notification — match still created
              logger.warn('allEntries: continuing after a suppressed failure', { error: String(err) });
            }
          }
        }
      }

      // 6. Clean up expired matches
      const expired = await storage.deleteExpiredMatches();
      if (expired > 0) {
        logger.info('Matching round: cleaned expired matches', { count: expired });
      }

      const result: MatchingRoundResult = {
        profilesScanned,
        matchesCreated,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };

      logger.info('Matching round complete', result);
      return result;
    } catch (err) {
      logger.error('Matching round failed', { error: String(err) });
      return {
        profilesScanned: 0,
        matchesCreated: 0,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  function calculateMatchScore(
    profileA: ProfileData,
    profileB: ProfileData,
    maxDistanceKm: number,
  ): MatchScore {
    return calculateMatchScoreImpl(profileA, profileB, maxDistanceKm);
  }

  async function getSuggestionsForProfile(ghii: string): Promise<MatchRecord[]> {
    return storage.listMatchesByProfile(ghii, { status: 'suggested' });
  }

  return {
    runMatchingRound,
    calculateMatchScore,
    getSuggestionsForProfile,
  };
}

// ── Scheduler ────────────────────────────────────────────────

export function startMatchingScheduler(
  config: AimeatConfig,
  matchingEngine: MatchingEngine,
): NodeJS.Timeout | null {
  if (!config.matchingEnabled) {
    logger.info('AI Matching engine disabled');
    return null;
  }

  const intervalMs = config.matchIntervalHours * 3_600_000;

  const timer = setInterval(() => {
    matchingEngine.runMatchingRound().catch(err => {
      logger.error('Scheduled matching round failed', { error: String(err) });
    });
  }, intervalMs);

  // Run first matching round after a delay to let directory index build
  setTimeout(() => {
    matchingEngine.runMatchingRound().catch(err => {
      logger.error('Initial matching round failed', { error: String(err) });
    });
  }, 60_000); // 1 minute delay

  logger.info('AI Matching scheduler started', {
    intervalHours: config.matchIntervalHours,
    threshold: config.matchThreshold,
    maxSuggestions: config.matchMaxSuggestions,
    maxDistanceKm: config.matchMaxDistanceKm,
    cooldownDays: config.matchCooldownDays,
  });

  return timer;
}
