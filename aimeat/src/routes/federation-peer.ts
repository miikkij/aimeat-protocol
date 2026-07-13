/**
 * @file src/routes/federation-peer.ts
 * @description Federation peer routes — the public peer directory and node-to-node handshake surface:
 *   signed introduction, Ed25519 key exchange, heartbeat/presence, service-summary aggregation,
 *   peering-request CRUD, tier promotion/auto-admit policy evaluation, and the federation node book.
 *
 * @structure
 *   - federationPeerRouter(config, storage, peers): builds the router over the in-memory peer map,
 *     registering handler groups (in original declaration order) extracted into sibling modules:
 *       · ./federation-peer/introduce.ts   — directory, service-summary, introduce, peering-request, test
 *       · ./federation-peer/peers.ts       — admin peering decisions, activate, heartbeat, presence, peer CRUD, promote
 *       · ./federation-peer/policy-book.ts — network policy + federation book
 *       · ./federation-peer/lifecycle.ts   — de-peer, ping, key-exchange
 *       · ./federation-peer/promotion.ts   — promotionMetrics helper
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 *   v1.1.0 — 2026-07-13 — Split handler groups into ./federation-peer/* siblings (max-file-lines); order/behaviour preserved
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { registerIntroduceRoutes } from './federation-peer/introduce.js';
import { registerPeersRoutes } from './federation-peer/peers.js';
import { registerPolicyBookRoutes } from './federation-peer/policy-book.js';
import { registerLifecycleRoutes } from './federation-peer/lifecycle.js';

export function federationPeerRouter(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): Router {
    const router = Router();

    // Register handler groups in the original declaration order (Express matches top-to-bottom).
    registerIntroduceRoutes(router, config, storage, peers);
    registerPeersRoutes(router, config, storage, peers);
    registerPolicyBookRoutes(router, config, storage, peers);
    registerLifecycleRoutes(router, config, storage, peers);

    return router;
}
