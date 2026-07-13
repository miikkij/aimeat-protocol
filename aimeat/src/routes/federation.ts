/**
 * @file src/routes/federation.ts
 * @description Federation barrel router — composes the peer, sync, settlements, genesis, and auth
 *   sub-routers into one mountable router, and re-exports shared federation helpers for back-compat.
 *
 * @structure
 *   - federationRouter(config, storage, peers, networkDirectory?): mounts all federation sub-routers
 *   - Re-exports: peerKeyCache, performKeyExchange, PeerKeyEntry (from services/federation-helpers.js)
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import type { ServiceSummary } from '../utils/service-summary.js';
import { federationPeerRouter } from './federation-peer.js';
import { federationSyncRouter } from './federation-sync.js';
import { federationSettlementsRouter } from './federation-settlements.js';
import { federationGenesisRouter } from './federation-genesis.js';
import { federationAuthRouter } from './federation-auth.js';

// Re-export shared helpers for backward compatibility
export { peerKeyCache, performKeyExchange } from '../services/federation-helpers.js';
export type { PeerKeyEntry } from '../services/federation-helpers.js';

export function federationRouter(
    config: AimeatConfig,
    storage: Storage,
    peers: Map<string, PeerInfo>,
    networkDirectory?: Map<string, ServiceSummary>,
): Router {
    const router = Router();
    router.use(federationPeerRouter(config, storage, peers));
    router.use(federationSyncRouter(config, storage, peers));
    router.use(federationSettlementsRouter(config, storage, peers));
    router.use(federationGenesisRouter(config, storage, peers, networkDirectory));
    router.use(federationAuthRouter(config, storage));
    return router;
}
