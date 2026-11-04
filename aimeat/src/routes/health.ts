/**
 * @file health.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/health: the node's health (Tier 0, no auth), with the site load balancer,
 *   tunnel, mailbox and storage subsystems and the build the node runs. It answers 200 also when
 *   degraded, and costs 1 storage read, plus 1 + 2 per personal node when personal nodes are on.
 *   GET /v1/health/live (no I/O) and GET /v1/health/ready (one storage read; 503 while starting,
 *   draining or without storage) are the probes a process manager or load balancer acts on.
 *
 *   Extracted from bootstrap.ts unchanged when that file passed the 800-line ceiling. A pure move:
 *   the handler, its comments and its behaviour are the same, and the tests that proved it still do.
 *
 * @structure
 *   - mountHealthRoute(router, config, storage, tunnelManager) — registers GET /v1/health,
 *     /v1/health/live and /v1/health/ready
 * @usage mountHealthRoute(router, config, storage, tunnelManager);
 * @version-history
 *   v1.1.0 — 2026-11-04 — GET /v1/health/live and GET /v1/health/ready, constant cost; /v1/health
 *     answers as before (codebase analysis 2026-11-03, HA stage 1).
 *   v1.0.0 — 2026-10-28 — Extracted from bootstrap.ts (line ceiling), when a merge of main into the
 *     round-8 branch took that file to 803 lines.
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { TunnelManager } from '../services/personal-tunnel.js';
import { success, error } from '../middleware/envelope.js';
import { nodePhase } from '../services/node-lifecycle.js';
import { getSiteSyncState } from '../services/site-sync.js';
import { logger } from '../utils/logger.js';
import { runningBuild } from '../utils/build-stamp.js';
import { getSoftwareVersion } from '../utils/version.js';

/** How long GET /v1/health waits for the storage probe before it answers degraded (QA audit E6-07). */
const HEALTH_STORAGE_PROBE_MS = 5_000;

/** How long GET /v1/health/ready waits for its storage read; shorter than a load balancer's probe timeout. */
const READY_STORAGE_PROBE_MS = 2_000;

/** Why a process is not ready, in words for the person reading the probe. */
const NOT_READY_MESSAGE: Record<'starting' | 'draining' | 'storage', string> = {
  starting: 'This process is still starting. Send requests to another process, or ask again in a few seconds.',
  draining: 'This process is stopping and takes no new requests. Send requests to another process; the stop finishes on its own.',
  storage: 'This process cannot reach its database. Check the database server; the process answers ready again as soon as the database does.',
};

/** Register GET /v1/health, GET /v1/health/live and GET /v1/health/ready on the given router. */
export function mountHealthRoute(router: Router, config: AimeatConfig, storage: Storage, tunnelManager?: TunnelManager): void {
  // GET /v1/health/live: the process runs and its event loop answers. No I/O at all, so a probe
  // costs the same on every node and a slow database never makes a process manager restart a
  // process that is alive.
  router.get('/v1/health/live', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(success(config.nodeId, { status: 'live', uptime_seconds: Math.floor(process.uptime()) }));
  });

  // GET /v1/health/ready: whether this process should get traffic. 503 before the boot finished,
  // while it drains on its way out (index-start.ts), and when one keyed storage read fails or takes
  // longer than READY_STORAGE_PROBE_MS. One read whatever the node holds, unlike GET /v1/health,
  // which lists the personal nodes and reads two rows per node.
  router.get('/v1/health/ready', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    const phase = nodePhase();
    if (phase !== 'ready') {
      res.status(503).json(error(config.nodeId, 'NOT_READY', NOT_READY_MESSAGE[phase], 503, { phase }));
      return;
    }
    let probeTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        storage.getOwner('__health_probe__'),
        new Promise((_, reject) => { probeTimer = setTimeout(() => reject(new Error(`storage did not answer within ${READY_STORAGE_PROBE_MS} ms`)), READY_STORAGE_PROBE_MS); }),
      ]);
    } catch (err) {
      logger.warn('health/ready: the storage probe failed; answering not ready', { error: String(err) });
      res.status(503).json(error(config.nodeId, 'NOT_READY', NOT_READY_MESSAGE.storage, 503, { phase, storage: 'unreachable' }));
      return;
    } finally {
      clearTimeout(probeTimer);
    }
    res.json(success(config.nodeId, { status: 'ready' }));
  });


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
