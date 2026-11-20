/**
 * @file src/routes/organisms/apps-wall.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/organisms/:id/apps: an organism's own app wall, the apps its members opened to
 *   it (services/app/organism-wall.ts). For the organism's members and their agents; the MCP tool
 *   aimeat_organism_apps answers the same.
 * @structure registerOrganismAppsWallRoutes(router, config, storage)
 * @usage registerOrganismAppsWallRoutes(router, config, storage);   // from routes/organisms.ts
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-organisaation-oma-appisein-kollegoiden-apit-n-kyviin-eri-kul).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { organismWall } from '../../services/app/organism-wall.js';

export function registerOrganismAppsWallRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  // GET /v1/organisms/:id/apps?lang= — the apps opened to this organism, for its members.
  router.get('/v1/organisms/:id/apps', requireAuth(), requireScope('organism:read'), async (req, res) => {
    const out = await organismWall({ storage, config }, { sub: req.auth!.sub, owner: req.auth!.owner },
      req.params.id as string, String(req.query.lang ?? 'en'));
    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message));
      return;
    }
    res.json(success(config.nodeId, out.wall));
  });
}
