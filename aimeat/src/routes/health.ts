/**
 * @file health.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/health: the liveness and readiness check (Tier 0, no auth), with the site
 *   load balancer, tunnel, mailbox and storage subsystems and the build the node runs.
 *
 *   Extracted from bootstrap.ts unchanged when that file passed the 800-line ceiling. A pure move:
 *   the handler, its comments and its behaviour are the same, and the tests that proved it still do.
 *
 * @structure
 *   - mountHealthRoute(router, config, storage, tunnelManager) — registers GET /v1/health
 * @usage mountHealthRoute(router, config, storage, tunnelManager);
 * @version-history
 *   v1.0.0 — 2026-10-28 — Extracted from bootstrap.ts (line ceiling), when a merge of main into the
 *     round-8 branch took that file to 803 lines.
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { TunnelManager } from '../services/personal-tunnel.js';
import { success } from '../middleware/envelope.js';
import { getSiteSyncState } from '../services/site-sync.js';
import { logger } from '../utils/logger.js';
import { runningBuild } from '../utils/build-stamp.js';
import { getSoftwareVersion } from '../utils/version.js';

/** How long GET /v1/health waits for the storage probe before it answers degraded (QA audit E6-07). */
const HEALTH_STORAGE_PROBE_MS = 5_000;

/** Register GET /v1/health on the given router. */
export function mountHealthRoute(router: Router, config: AimeatConfig, storage: Storage, tunnelManager?: TunnelManager): void {
  // GET /v1/health — simple liveness/readiness check (Tier 0, no auth)
  router.get('/v1/health', async (_req, res) => {
    const healthData: Record<string, unknown> = {
      status: 'healthy',
      uptime_seconds: Math.floor(process.uptime()),
      memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    };

    let degraded = false;
    const subsystems: Record<string, unknown> = {};

    // Site LB (existing — keep as-is)
    if (config.siteLbEnabled) {
      const syncState = getSiteSyncState();
      const lastSyncAge = syncState.lastSync
        ? (Date.now() - new Date(syncState.lastSync).getTime()) / 1000
        : Infinity;
      const syncHealthy = syncState.lastError === null && lastSyncAge < config.siteLbSyncIntervalMin * 60 * 2;
      if (!syncHealthy) degraded = true;
      healthData.site_lb = {
        enabled: true,
        origin_url: config.siteLbOriginUrl,
        last_sync: syncState.lastSync,
        sync_healthy: syncHealthy,
      };
    }

    // The personal nodes, listed once for the tunnel and the mailbox subsystems (secaudit2026oct26).
    // Both readers await it inside their own try, the mailbox one always.
    const personalNodes = config.personalNodesEnabled ? storage.listPersonalNodes() : null;

    // Tunnel subsystem
    if (personalNodes && tunnelManager) {
      const tunnelSub: Record<string, unknown> = {
        healthy: true,
        connections_active: tunnelManager.getOnlineCount(),
      };
      // Find most recent connection timestamp from online nodes
      try {
        const nodes = await personalNodes;
        let newest: string | null = null;
        for (const n of nodes) {
          if (n.lastSeen && (!newest || n.lastSeen > newest)) newest = n.lastSeen;
        }
        if (newest) tunnelSub.last_connection_at = newest;
      } catch (err) { logger.warn('GET /v1/health: ignore — non-critical', { error: String(err) }); }
      subsystems.tunnel = tunnelSub;
    }

    // Mailbox subsystem
    if (personalNodes) {
      try {
        const nodes = await personalNodes;
        let totalItems = 0;
        let totalBytes = 0;
        let oldestAge = 0;

        for (const node of nodes) {
          const mbStats = await storage.getMailboxStats(node.nodeId);
          totalItems += mbStats.count;
          totalBytes += mbStats.totalBytes;
          // Ordered oldest first, so the first item is the oldest; one is all this reads.
          const items = await storage.listMailboxItems(node.nodeId, { limit: 1 });
          if (items.length > 0) {
            const age = Math.floor((Date.now() - new Date(items[0].createdAt).getTime()) / 1000);
            if (age > oldestAge) oldestAge = age;
          }
        }

        subsystems.mailbox = {
          healthy: true,
          items_total: totalItems,
          bytes_total: totalBytes,
          oldest_item_age_seconds: oldestAge,
        };
      } catch (err) {
        logger.warn('bootstrap: suppressed failure, continuing', { error: String(err) });
        subsystems.mailbox = { healthy: false };
        degraded = true;
      }
    }

    // Storage health probe, with its own time limit: a database that stops answering made this
    // request wait without end, so the health check did not answer at all (QA audit E6-07). The
    // pool's own limits end the query later; the probe answers degraded first. The probe is one keyed
    // read of a name no account can hold: listing every account made each unsigned call cost as much as
    // the node has accounts (secaudit2026oct26).
    let probeTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        storage.getOwner('__health_probe__'),
        new Promise((_, reject) => { probeTimer = setTimeout(() => reject(new Error(`storage did not answer within ${HEALTH_STORAGE_PROBE_MS} ms`)), HEALTH_STORAGE_PROBE_MS); }),
      ]);
      subsystems.storage = { healthy: true };
    } catch (err) {
      logger.warn('health: the storage probe failed; answering degraded', { error: String(err) });
      subsystems.storage = { healthy: false };
      degraded = true;
    } finally {
      clearTimeout(probeTimer);
    }

    if (Object.keys(subsystems).length > 0) {
      healthData.subsystems = subsystems;
    }

    if (degraded) {
      healthData.status = 'degraded';
    }

    // Which code answers, so "is the fix deployed" is read here and not inferred from the uptime
    // (utils/build-stamp.ts runningBuild; GET /v1/build carries the same with the build id).
    const running = runningBuild();
    healthData.build = {
      version: getSoftwareVersion(), commit: running.commit, commit_source: running.commit_source,
      dirty: running.dirty, built_at: running.built_at, state: running.state,
    };

    res.json(success(config.nodeId, healthData));
  });
}
