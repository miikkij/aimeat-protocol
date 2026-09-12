/**
 * @file src/routes/federation-peer/overview.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Federation page's one read: GET /v1/admin/federation/overview.
 *
 *   The page used to assemble itself from five calls and work the answers out in the browser — the
 *   peer list, the peering requests, the node config, the federation book and the network
 *   directory. Four of the five facts an operator actually opens this page for were not in any of
 *   them: a peer approved and never switched on, whether the sign-in policy reaches anybody, how
 *   far behind a version is and behind what, and how old the book is. They are computed once, in a
 *   service, so the MCP tool answers the same question with the same arithmetic.
 *   → services/federation-overview.ts
 * @structure registerOverviewRoutes(router, config, storage, peers)
 * @usage registerOverviewRoutes(router, config, storage, peers);
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the Federation page's rebuild.
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { success } from '../../middleware/envelope.js';
import type { PeerInfo } from '../../services/federation.js';
import { buildFederationOverview } from '../../services/federation-overview.js';

export function registerOverviewRoutes(
  router: Router,
  config: AimeatConfig,
  storage: Storage,
  peers: Map<string, PeerInfo>,
): void {
  router.get('/v1/admin/federation/overview', requireAuth(), requireRole('operator'), async (_req, res) => {
    res.json(success(config.nodeId, await buildFederationOverview(config, storage, peers)));
  });
}
