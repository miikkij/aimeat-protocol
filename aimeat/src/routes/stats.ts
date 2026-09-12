/**
 * @file stats.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Stats and metrics route handlers. Serves node statistics at GET /v1/stats
 *   (with optional from/to time-range filtering) and Prometheus metrics at GET /v1/metrics.
 *
 *   THE PAYLOAD IS NOT BUILT HERE. services/stats-page.ts builds it, because the
 *   aimeat_admin_statistics tool makes the same read and a second copy of a payload this shape is
 *   how one tool name came to mean three different things on three surfaces. What stays here is
 *   what only a route can do: the feature switch, the access check, and the envelope.
 * @structure
 *   - statsRouter() -- Express router factory for /v1/stats and /v1/metrics
 * @usage
 *   import { statsRouter } from '../routes/stats.js';
 *   app.use(statsRouter(config, storage, stats, metricsRegistry));
 * @version-history
 *   v1.2.0 -- 2026-09-12 -- The payload moves to services/stats-page.ts, unchanged, so the MCP
 *     tool can make the same read. Pure extraction.
 *   v1.1.1 -- 2026-05-21 -- Fix range response to return same flat shape as full snapshot
 *   v1.1.0 -- 2026-05-21 -- Add time-range support (from/to query params), gauges, daily field
 *   v1.0.0 -- 2026-05-01 -- Initial stats route with consent permission breakdown
 */

import { Router } from 'express';
import type { Registry } from '@prometheus-io/client';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { StatsCollector } from '../services/stats.js';
import { success, error } from '../middleware/envelope.js';
import { buildStatsSnapshot } from '../services/stats-page.js';

export function statsRouter(
  config: AimeatConfig,
  storage: Storage,
  stats: StatsCollector,
  metricsRegistry?: Registry,
): Router {
  const router = Router();

  router.get('/v1/stats', async (req, res) => {
    if (!config.statsEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Statistics are disabled'));
      return;
    }

    // Access control based on config
    if (config.statsAccess === 'operator') {
      if (!req.auth?.roles?.includes('operator')) {
        res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Operator role required'));
        return;
      }
    } else if (config.statsAccess === 'authenticated') {
      if (!req.auth) {
        res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Authentication required'));
        return;
      }
    }
    // 'public' = no auth needed (default)

    // Both dates or neither: one of the two is a half-stated period, and answering it with the
    // node's whole life under a period's label is worse than ignoring it.
    const fromParam = req.query.from as string | undefined;
    const toParam = req.query.to as string | undefined;
    const range = fromParam && toParam ? { from: fromParam, to: toParam } : undefined;

    res.json(success(config.nodeId, await buildStatsSnapshot(config, storage, stats, range)));
  });

  router.get('/v1/metrics', async (req, res) => {
    if (!config.metricsEnabled || !metricsRegistry) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Usage figures are switched off on this node. Whoever runs it can turn them on.'));
      return;
    }

    // Access control (same pattern as /v1/stats)
    if (config.metricsAccess === 'operator') {
      if (!req.auth?.roles?.includes('operator')) {
        res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Operator role required'));
        return;
      }
    } else if (config.metricsAccess === 'authenticated') {
      if (!req.auth) {
        res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Authentication required'));
        return;
      }
    }

    res.set('Content-Type', metricsRegistry.contentType);
    res.end(await metricsRegistry.metrics());
  });

  return router;
}
