/**
 * @file src/routes/federation-peer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *       · ./federation-peer/link-invites.ts — one-time invitations that admit a node at a named tier
 *       · ./federation-peer/promotion.ts   — promotionMetrics helper
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 *   v1.2.0 — 2026-09-12 — registerOverviewRoutes: the Federation page's one read, through
 *     services/federation-overview.ts. The page had been assembling itself from five calls and
 *     working the answers out in the browser, and four of the facts it exists to show were in none
 *     of them.
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
import { registerLinkInviteRoutes } from './federation-peer/link-invites.js';
import { registerOverviewRoutes } from './federation-peer/overview.js';

export function federationPeerRouter(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): Router {
    const router = Router();

    // Register handler groups in the original declaration order (Express matches top-to-bottom).
    registerIntroduceRoutes(router, config, storage, peers);
    registerPeersRoutes(router, config, storage, peers);
    registerPolicyBookRoutes(router, config, storage, peers);
    registerLifecycleRoutes(router, config, storage, peers);
    registerLinkInviteRoutes(router, config, storage);
    // The Federation page in one read. Last, because it matches an exact path and nothing above it
    // is a prefix of that path; its place in the file is alphabetical, not load-bearing.
    registerOverviewRoutes(router, config, storage, peers);

    return router;
}
