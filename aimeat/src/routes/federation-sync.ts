/**
 * @file federation-sync.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Federation sync routes — memory replication, catalogue sync,
 *   trust advisories, cross-node query routing, GAII resolution,
 *   cross-node work submission, and cross-node template sharing.
 *
 *   Handler groups are extracted into sibling modules under ./federation-sync/ (registered in the
 *   original declaration order): messaging (replicate/message/broadcast/receipt/storage-grant),
 *   catalogue-trust (catalogue-sync/trust-advisory), routing (route/resolve/cross-node-work),
 *   templates (templates/templates-sync/memory-list).
 *
 * @version-history
 *   v1.0.0 — 2026-03-15 — Initial federation sync routes
 *   v1.1.0 — 2026-03-20 — Add federation template endpoints (GET /v1/federation/templates, POST /v1/federation/templates/sync)
 *   v1.2.0 — 2026-05-22 — Add POST /v1/federation/memory/list for peer-to-peer memory browsing
 *   v1.3.0 — 2026-06-19 — Trust advisory: a `suspend` demotes a member peer back to the visiting
 *     tier (strips elevated flags); `ban` now also purges the peer from storage (Phase B).
 *   v1.4.0 — 2026-07-13 — Split handler groups into ./federation-sync/* siblings (max-file-lines); order/behaviour preserved
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { registerMessagingRoutes } from './federation-sync/messaging.js';
import { registerCatalogueTrustRoutes } from './federation-sync/catalogue-trust.js';
import { registerRoutingRoutes } from './federation-sync/routing.js';
import { registerTemplatesRoutes } from './federation-sync/templates.js';

export function federationSyncRouter(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): Router {
    const router = Router();

    // Register handler groups in the original declaration order (Express matches top-to-bottom).
    registerMessagingRoutes(router, config, storage, peers);
    registerCatalogueTrustRoutes(router, config, storage, peers);
    registerRoutingRoutes(router, config, storage, peers);
    registerTemplatesRoutes(router, config, storage, peers);

    return router;
}
