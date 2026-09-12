/**
 * @file src/server-bootstrap/realtime-mount.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Mounts the realtime rooms router and decides whether this node opens a WebSocket.
 *   Extracted from routes-loader.ts, which sits at the 800-line ceiling, when the two halves of
 *   this decision stopped being one line each.
 *
 * @structure mountRealtime(app, config, storage, peers) → the manager, or null when realtime is off
 * @usage called by mountRoutes() in routes-loader.ts; the manager it returns is what index-start.ts
 *   registers the /v1/realtime/ws upgrade handler on.
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial (pure extraction from routes-loader.ts v1.15.0).
 */
import type { Express } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { RealtimeManager } from '../services/realtime-manager.js';
import { realtimeRouter } from '../routes/realtime.js';
import { logger } from '../utils/logger.js';

/**
 * THE ROUTER IS MOUNTED WHETHER OR NOT THE FEATURE IS ON, so its own refusals are what a caller
 * gets. Mounting it only when enabled made the `if (!config.realtimeEnabled)` guard at the top of
 * all ten routes dead code: a caller on a node with realtime off got 404 NOT_FOUND from the
 * fallthrough, not the documented 503 FEATURE_DISABLED, and the admin overview could not say
 * "switched off" at all. The manager it takes is untouched while the feature is off, because every
 * route refuses before it reaches one.
 *
 * What stays conditional is the manager this RETURNS: index-start.ts registers the WebSocket
 * upgrade handler on it, so a disabled node hands back null and opens no socket.
 */
export function mountRealtime(
  app: Express,
  config: AimeatConfig,
  storage: Storage,
  peers: Map<string, PeerInfo>,
): RealtimeManager | null {
  const manager = new RealtimeManager(config, storage);
  app.use(realtimeRouter(config, storage, manager, peers));

  if (!config.realtimeEnabled) return null;

  manager.startCleanupJob();
  logger.info('Realtime P2P rooms enabled', { maxRooms: config.realtimeMaxRooms });
  return manager;
}
