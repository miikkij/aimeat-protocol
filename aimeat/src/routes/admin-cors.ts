/**
 * @file admin-cors.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's CORS page in one read: the default list, the cookie doors, the people
 *   and agents with a list of their own, the records that carry one, and the order the lists rank
 *   in. Calls services/cors-overview.ts, which the aimeat_admin_cors_overview tool calls too. The
 *   two writes stay where they were, PUT /v1/admin/ghii/:ghii/cors and PUT /v1/admin/agents/:gaii/cors,
 *   and go through the same service's setCorsList.
 * @structure adminCorsRouter(config, storage)
 *   - GET /v1/admin/cors/overview
 * @version-history
 *   v1.0.0 -- 2026-09-08 -- Initial: the CORS page in the poster face.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { buildCorsOverview } from '../services/cors-overview.js';

export function adminCorsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /* ── GET /v1/admin/cors/overview — the CORS page in one read ── */
  router.get('/v1/admin/cors/overview', requireAuth(), requireRole('operator'), async (_req, res) => {
    res.json(success(config.nodeId, await buildCorsOverview(config, storage)));
  });

  return router;
}
