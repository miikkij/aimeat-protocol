/**
 * @file usage.ts
 * @description Owner account-summary routes. `GET /v1/owner/usage` returns the owner's quota usage
 *   (memory, storage, micro-memory), resource counts and morsel balance from a 60s cache. `GET
 *   /v1/owner/home` is the composite profile-Home dashboard: it replaces the shell's 8-request stats-bar
 *   fan-out plus the Usage and Agents cards' separate polls with ONE call, resolving the owner's agent
 *   list a single time (the redesign's aggregate-over-domain-services pattern — see
 *   services/db/home-dashboard-service.ts). Generic account-summary data — any dashboard client can
 *   consume it.
 * @structure
 *   - GET /v1/owner/usage — cached usage summary for the authenticated owner
 *   - GET /v1/owner/home  — composite home dashboard (stats + usage + agents) in one call
 * @version-history
 *   v1.0.0 — 2026-06-22 — Initial owner usage summary endpoint (backs the profile Home usage card).
 *   v1.1.0 — 2026-07-15 — Phase 3: add GET /v1/owner/home composite (HomeDashboardService).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { getOwnerUsageSummary } from '../services/usage-summary.js';
import { createHomeDashboardService } from '../services/db/index.js';

export function usageRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const homeDashboard = createHomeDashboardService(config, storage);

  // GET /v1/owner/usage — quota usage + resource counts + morsel balance for the caller's owner.
  // Both owner and agent sessions resolve to the same owner (req.auth.owner). Cached 60s per owner.
  router.get('/v1/owner/usage', requireAuth(), async (req, res) => {
    const ownerName = req.auth!.owner as string | undefined;
    if (!ownerName) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'No owner associated with this session'));
      return;
    }
    const summary = await getOwnerUsageSummary(config, storage, ownerName);
    res.json(success(config.nodeId, summary, [
      { description: 'Wallet balance + transactions', method: 'GET', url: '/v1/wallet' },
      { description: 'List memory (metadata only)', method: 'GET', url: '/v1/memory?include=meta' },
    ]));
  });

  // GET /v1/owner/home — the whole profile Home dashboard in one call: the stats-bar counts, the cached
  // usage summary, and the agents list, with the owner's agent list resolved ONCE and shared across all
  // three (IdentityMap). Owner + agent sessions both resolve to the same owner (req.auth.owner).
  router.get('/v1/owner/home', requireAuth(), async (req, res) => {
    const ownerName = req.auth!.owner as string | undefined;
    if (!ownerName) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'No owner associated with this session'));
      return;
    }
    const home = await homeDashboard.load(ownerName);
    res.json(success(config.nodeId, home, [
      { description: 'Full usage summary', method: 'GET', url: '/v1/owner/usage' },
      { description: 'Manage agents', method: 'GET', url: '/v1/agents' },
    ]));
  });

  return router;
}
