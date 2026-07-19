/**
 * @file appdev-overview.ts
 * @description GET /v1/appdev/overview — the authenticated "big picture" research surface for
 *   building apps ON AIMEAT (services/appdev-overview.ts). Query params: ?model= (indicative
 *   model filter for proofs + learned pitfalls), ?sections=apps,library_packs,... (partial
 *   fetch for token economy). Read-only; identity via resolveIdentity (owner or agent session).
 * @structure appdevOverviewRouter(config, storage) → Router
 * @usage app.use(appdevOverviewRouter(config, storage)) from the routes loader.
 * @version-history
 *   v1.0.0 — 2026-07-19 — initial (AppDev KB Phase 5).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success } from '../middleware/envelope.js';
import { requireAuth } from '../auth/middleware.js';
import { resolveIdentity } from '../utils/gaii.js';
import { buildAppdevOverview } from '../services/appdev-overview.js';

export function appdevOverviewRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  router.get('/v1/appdev/overview', requireAuth(), async (req, res) => {
    const identity = resolveIdentity(req.auth!, config.nodeId);
    const model = typeof req.query.model === 'string' ? req.query.model : undefined;
    const sections = typeof req.query.sections === 'string'
      ? req.query.sections.split(',').map(s => s.trim()).filter(Boolean)
      : undefined;
    const overview = await buildAppdevOverview(storage, config, identity, { model, sections });
    res.json(success(config.nodeId, overview, [
      { description: 'Curated pitfalls', method: 'GET', url: '/v1/appdev/pitfalls' },
      { description: 'Library pack detail', method: 'GET', url: '/v1/library-packs/{id}' },
      { description: 'App template detail', method: 'GET', url: '/v1/app-templates/{id}' },
      { description: 'The canonical build spec', method: 'GET', url: '/v1/prompts/build-app' },
    ]));
  });

  return router;
}
