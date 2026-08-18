/**
 * @file src/routes/matches.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Match API — endpoints for viewing and responding to AI-generated match suggestions
 *   between profiles, with per-partner consent checks that gate whether a matched profile's details
 *   are revealed.
 *
 * @structure
 *   - matchesRouter: builds the Express router (auth required)
 *   - GET /v1/matches: list the caller's own match suggestions (paginated, consent-filtered)
 *   - respond/status routes: accept/decline suggestions and update match state
 *   - param: helper normalizing string | string[] route params
 *
 * @version-history
 *   v1.1.0 — 2026-07-16 — GET /v1/matches enrichment batched (Phase 3 fan-out→IN): the per-match
 *     getGHII×2 + getAgentsByOwner + listConsents N+1 → one getGHIIsByGhiis + getAgentsByOwners +
 *     listConsentsForAgents. Same consent-gated redaction; a batch failure redacts all (safety).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { logger } from '../utils/logger.js';

function param(p: string | string[]): string {
  return Array.isArray(p) ? p[0] : p;
}

export function matchesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // ── GET /v1/matches — List own match suggestions (auth required) ──
  router.get('/v1/matches', requireAuth(), async (req, res) => {
    const callerGhii = req.auth!.sub;
    const status = req.query.status as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page as string, 10) || 10));

    // Get GHII for the caller — try to resolve from owner
    let ghii = callerGhii;
    try {
      // The caller might be an agent GAII; resolve to GHII via owner
      const ownerName = req.auth!.owner;
      const ghiiRecord = await storage.getGHIIByOwner(ownerName);
      if (ghiiRecord) {
        ghii = ghiiRecord.ghii;
      }
    } catch (err) {
      // Fall back to using the auth sub directly
      logger.warn('GET /v1/matches: continuing after a suppressed failure', { error: String(err) });
    }

    const matches = await storage.listMatchesByProfile(ghii, { status, page, perPage });

    // Batch the per-match enrichment that was an N+1 (getGHII TWICE + getAgentsByOwner + listConsents per
    // match): ONE GHII-by-ghii read → ONE agents-by-owners read → ONE consents-by-agents read, all shared
    // across the loop. A batch failure leaves the maps empty so every partner is redacted (the same
    // "can't verify consent → redact for safety" the per-match try/catch enforced).
    const matchedGhiis = [...new Set(matches.map(m => (m.profileA === ghii ? m.profileB : m.profileA)))];
    let ghiiRecords: Record<string, import('../storage/interface.js').GHIIRecord> = {};
    let agentsByOwner: Record<string, import('../storage/interface.js').AgentRecord[]> = {};
    let consentsByAgent: Record<string, Awaited<ReturnType<typeof storage.listConsents>>> = {};
    try {
      ghiiRecords = storage.getGHIIsByGhiis
        ? await storage.getGHIIsByGhiis(matchedGhiis)
        : Object.fromEntries((await Promise.all(matchedGhiis.map(g => storage.getGHII(g)))).filter((r): r is NonNullable<typeof r> => !!r).map(r => [r.ghii, r]));
      if (config.consentEnabled) {
        const owners = [...new Set(Object.values(ghiiRecords).map(r => r.ownerName))];
        agentsByOwner = await storage.getAgentsByOwners(owners);
        const allAgentGaiis = Object.values(agentsByOwner).flat().map(a => a.gaii);
        if (allAgentGaiis.length) consentsByAgent = await storage.listConsentsForAgents(allAgentGaiis, { status: 'active' });
      }
    } catch (err) {
      logger.warn('matches: suppressed failure, continuing', { error: String(err) });
      ghiiRecords = {}; agentsByOwner = {}; consentsByAgent = {};
    }

    // Whether a matched profile still has active matching consent (via any of its agents).
    const partnerConsentActiveFor = (matchedGhii: string): boolean => {
      if (!config.consentEnabled) return true;
      const rec = ghiiRecords[matchedGhii];
      if (!rec) return false;
      for (const a of (agentsByOwner[rec.ownerName] ?? [])) {
        if ((consentsByAgent[a.gaii] ?? []).some(c => c.purpose === 'matching' && c.status === 'active')) return true;
      }
      return false;
    };

    // Build the response with formatted match data, gating each partner's details on their consent.
    const formatted: Array<Record<string, unknown>> = [];
    for (const m of matches) {
      const matchedGhii = m.profileA === ghii ? m.profileB : m.profileA;

      if (!partnerConsentActiveFor(matchedGhii)) {
        // Partner revoked matching consent (or is unverifiable) — redact their details.
        formatted.push({
          id: m.id,
          matchedProfile: { ghii: '[redacted]', sharedInterests: [], distanceKm: null, consentRevoked: true },
          score: m.score,
          status: m.status,
          expiresAt: m.expiresAt,
          createdAt: m.createdAt,
        });
        continue;
      }

      formatted.push({
        id: m.id,
        matchedProfile: {
          ghii: matchedGhii,
          sharedInterests: m.breakdown.sharedInterests,
          distanceKm: m.breakdown.distanceKm,
          displayName: ghiiRecords[matchedGhii]?.displayName,
        },
        score: m.score,
        breakdown: m.breakdown,
        status: m.status,
        semantic: {
          '@context': { schema: 'https://schema.org/' },
          '@type': 'schema:RecommendAction',
          'schema:instrument': 'aimeat:MatchingEngine',
          'schema:object': { '@type': 'schema:Person' },
        },
        expiresAt: m.expiresAt,
        createdAt: m.createdAt,
      });
    }

    res.json(success(config.nodeId, {
      matches: formatted,
      total: formatted.length,
      page,
    }, [
      { description: 'Respond to a match', method: 'POST', url: '/v1/matches/{id}/respond' },
    ], { page, per_page: perPage }));
  });

  // ── GET /v1/matches/stats — Matching statistics (operator only) ──
  // Must be registered before /:id route
  router.get('/v1/matches/stats', requireAuth(), requireRole('operator'), async (_req, res) => {
    const allMatches = await storage.listAllMatches();

    const allStatuses = ['suggested', 'notified', 'accepted', 'dismissed', 'expired'] as const;
    const matchesByStatus: Record<string, number> = {};
    for (const status of allStatuses) {
      matchesByStatus[status] = 0;
    }

    let latestMatch: string | null = null;
    for (const m of allMatches) {
      if (matchesByStatus[m.status] !== undefined) {
        matchesByStatus[m.status]++;
      }
      if (!latestMatch || m.createdAt > latestMatch) {
        latestMatch = m.createdAt;
      }
    }

    // Count unique profiles involved in matches
    const uniqueProfiles = new Set<string>();
    for (const m of allMatches) {
      uniqueProfiles.add(m.profileA);
      uniqueProfiles.add(m.profileB);
    }

    res.json(success(config.nodeId, {
      lastRoundAt: latestMatch,
      profilesScanned: uniqueProfiles.size,
      totalMatchesCreated: allMatches.length,
      matchesByStatus,
    }, [
      { description: 'View your match suggestions', method: 'GET', url: '/v1/matches' },
    ]));
  });

  // ── POST /v1/matches/:id/respond — Accept or dismiss a match (auth required) ──
  router.post('/v1/matches/:id/respond', requireAuth(), async (req, res) => {
    const id = param(req.params.id);
    const { action } = req.body ?? {};

    if (!action || !['accept', 'dismiss'].includes(action)) {
      res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
        'Missing or invalid action. Must be "accept" or "dismiss"'));
      return;
    }

    const match = await storage.getMatch(id);
    if (!match) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Match not found: ${id}`));
      return;
    }

    // Verify the caller is one of the matched profiles
    const ownerName = req.auth!.owner;
    let callerGhii = req.auth!.sub;
    try {
      const ghiiRecord = await storage.getGHIIByOwner(ownerName);
      if (ghiiRecord) {
        callerGhii = ghiiRecord.ghii;
      }
    } catch (err) {
      // Fall back
      logger.warn('POST /v1/matches/:id/respond: continuing after a suppressed failure', { error: String(err) });
    }

    if (match.profileA !== callerGhii && match.profileB !== callerGhii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You are not part of this match'));
      return;
    }

    // Check status — can only respond to suggested or notified matches
    if (!['suggested', 'notified'].includes(match.status)) {
      res.status(409).json(error(config.nodeId, 'INVALID_STATUS',
        `Cannot respond to match with status "${match.status}"`));
      return;
    }

    const now = new Date().toISOString();
    const newStatus = action === 'accept' ? 'accepted' as const : 'dismissed' as const;

    const updated = await storage.updateMatch(id, {
      status: newStatus,
      respondedAt: now,
    });

    // If accepted, check if the other side also accepted
    if (newStatus === 'accepted') {
      const otherGhii = match.profileA === callerGhii ? match.profileB : match.profileA;

      // Check if there's a reverse match that's also accepted
      const reverseMatch = await storage.getMatchByPair(otherGhii, callerGhii);
      if (reverseMatch && reverseMatch.id !== match.id && reverseMatch.status === 'accepted') {
        // Both sides accepted — mutual match! Log it.
        // In a production system, this would trigger notifications to both parties.
        // For now, the match records themselves serve as the record of acceptance.
      }
    }

    res.json(success(config.nodeId, updated, [
      { description: 'View all match suggestions', method: 'GET', url: '/v1/matches' },
    ]));
    emitChange('matches');
  });

  return router;
}
