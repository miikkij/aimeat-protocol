/**
 * Federation barrel router — composes all federation sub-routers into a
 * single router that can be mounted in server.ts without changes.
 *
 * Re-exports shared helpers so existing imports from this module continue
 * to work (peerKeyCache, performKeyExchange, PeerKeyEntry).
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
