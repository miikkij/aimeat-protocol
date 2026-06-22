/**
 * @file usage.ts
 * @description Owner usage/quota dashboard route. Returns the owner's quota usage (memory, storage,
 *   micro-memory), resource counts (agents, organisms, apps, extensions, cortexes, services) and
 *   morsel balance in ONE call, served from a 60s in-memory cache so the profile Home page doesn't
 *   re-scan the owner's whole keyspace on every visit. Generic account-summary data — any dashboard
 *   client can consume it.
 * @structure
 *   - GET /v1/owner/usage — cached usage summary for the authenticated owner
 * @version-history
 *   v1.0.0 — 2026-06-22 — Initial owner usage summary endpoint (backs the profile Home usage card).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { getOwnerUsageSummary } from '../services/usage-summary.js';

export function usageRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

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

  return router;
}
