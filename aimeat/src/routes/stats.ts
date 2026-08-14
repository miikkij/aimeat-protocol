/**
 * @file stats.ts
 * @description Stats and metrics route handlers. Serves node statistics at GET /v1/stats
 *   (with optional from/to time-range filtering) and Prometheus metrics at GET /v1/metrics.
 * @structure
 *   - statsRouter() -- Express router factory for /v1/stats and /v1/metrics
 * @usage
 *   import { statsRouter } from '../routes/stats.js';
 *   app.use(statsRouter(config, storage, stats, metricsRegistry));
 * @version-history
 *   v1.0.0 -- 2026-05-01 -- Initial stats route with consent permission breakdown
 *   v1.1.0 -- 2026-05-21 -- Add time-range support (from/to query params), gauges, daily field
 *   v1.1.1 -- 2026-05-21 -- Fix range response to return same flat shape as full snapshot
 */

import { Router } from 'express';
import type { Registry } from 'prom-client';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { StatsCollector } from '../services/stats.js';
import { success, error } from '../middleware/envelope.js';
import { readActiveRuns, readEventTriggers } from '../services/workflow/lifecycle.js';
import { cacheStats } from '../services/cache.js';
import { logger } from '../utils/logger.js';

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

    const snap = stats.snapshot();
    const owners = await storage.listOwners();
    const agents = await storage.listAgents();

    // Consent permission breakdown (for admin dashboard)
    const permStats = { active_rules: 0, by_gaii: 0, by_ghii: 0, by_organism: 0, by_domain: 0, by_node: 0, by_wildcard: 0, unique_patterns: new Set<string>() };
    for (const o of owners) {
      const gaii = (o as { gaii?: string }).gaii || `${(o as { name?: string }).name || ''}@${config.nodeId}`;
      try {
        const consents = await storage.listConsents(gaii, { status: 'active' });
        for (const c of consents) {
          permStats.active_rules++;
          const r = c.recipient || '';
          if (r === '*') permStats.by_wildcard++;
          else if (r.startsWith('ghii:')) permStats.by_ghii++;
          else if (r.startsWith('organism.')) permStats.by_organism++;
          else if (r.startsWith('domain:')) permStats.by_domain++;
          else if (r.startsWith('node:')) permStats.by_node++;
          else permStats.by_gaii++;
          permStats.unique_patterns.add(c.dataPattern);
        }
      } catch (err) { logger.warn('gaii: skip owners without consents', { error: String(err) }); }
    }

    // Agent Workflows — node-global gauges, cheaply read from the system-namespace indexes
    // (in-flight runs + registered event triggers). Best-effort: never block the stats response.
    let workflowStats = { runs_active: 0, event_triggers: 0 };
    try {
      const [activeRuns, eventTriggers] = await Promise.all([
        readActiveRuns(storage, config.nodeId),
        readEventTriggers(storage, config.nodeId),
      ]);
      workflowStats = { runs_active: activeRuns.length, event_triggers: eventTriggers.length };
    // eslint-disable-next-line aimeat/no-silent-catch -- indexes absent / unreadable — leave zeros
    } catch { /* indexes absent / unreadable — leave zeros */ }

    // Shared fields included in both response paths
    const shared = {
      active_owners: owners.length,
      active_agents: agents.length,
      workflows: workflowStats,
      push_notifications: {
        enabled: config.pushEnabled && !!config.vapidPublicKey,
        personal_node_support: config.personalNodesEnabled,
      },
      consent_permissions: {
        active_rules: permStats.active_rules,
        by_gaii: permStats.by_gaii,
        by_ghii: permStats.by_ghii,
        by_organism: permStats.by_organism,
        by_domain: permStats.by_domain,
        by_node: permStats.by_node,
        by_wildcard: permStats.by_wildcard,
        unique_patterns: permStats.unique_patterns.size,
      },
    };

    // Point-in-time gauges (always from current snapshot, not summable)
    const cache = cacheStats();
    const gauges = {
      tunnel_connections_active: snap.tunnel.connections_active,
      mailbox_items_total: snap.mailbox.items_total,
      mailbox_bytes_total: snap.mailbox.bytes_total,
      mailbox_oldest_item_age_seconds: snap.mailbox.oldest_item_age_seconds,
      // Generic read-cache health (services/cache.ts): live entry/tag counts + lifetime evictions.
      cache_entries: cache.entries,
      cache_tags: cache.tags,
      cache_evictions_total: cache.evictions,
    };

    // Time-range filtering: if both from and to are provided, return range data
    const fromParam = req.query.from as string | undefined;
    const toParam = req.query.to as string | undefined;

    if (fromParam && toParam) {
      const range = stats.snapshotForRange(fromParam, toParam);

      // Return the same flat shape as the full snapshot so the frontend
      // can render both responses identically.  Counter fields default to
      // 0 for the range (no activity = 0, not the cumulative total).
      // Live state (tunnel, mailbox, uptime) comes from the full snapshot.
      const rangeCounters: Record<string, unknown> = {
        requests_total: 0,
        memory_writes: 0,
        memory_reads: 0,
        consent_grants: 0,
        consent_revocations: 0,
        schema_validations: 0,
        schema_validation_failures: 0,
        auth_failures_total: 0,
        rate_limit_hits_total: 0,
        scope_denials_total: 0,
        ...range.totals,
      };

      res.json(success(config.nodeId, {
        node_id: config.nodeId,
        from: fromParam,
        to: toParam,
        uptime_seconds: snap.uptime_seconds,
        started_at: snap.started_at,
        requests_by_method: snap.requests_by_method,
        requests_by_status: snap.requests_by_status,
        tunnel: snap.tunnel,
        mailbox: snap.mailbox,
        ...rangeCounters,
        daily_history: range.daily,
        daily: range.daily,
        gauges,
        ...shared,
      }));
      return;
    }

    // Default: full snapshot (backward compatible) with gauges and daily
    const dailyCutoff = new Date();
    dailyCutoff.setDate(dailyCutoff.getDate() - 30);
    const dailyCutoffStr = dailyCutoff.toISOString().split('T')[0];
    const daily: Record<string, Record<string, number>> = {};
    for (const [day, counters] of Object.entries(snap.daily_history)) {
      if (day >= dailyCutoffStr) daily[day] = counters;
    }

    res.json(success(config.nodeId, {
      node_id: config.nodeId,
      ...snap,
      gauges,
      daily,
      ...shared,
    }));
  });

  router.get('/v1/metrics', async (req, res) => {
    if (!config.metricsEnabled || !metricsRegistry) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Metrics endpoint is disabled'));
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
