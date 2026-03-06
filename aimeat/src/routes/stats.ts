import { Router } from 'express';
import type { Registry } from 'prom-client';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { StatsCollector } from '../services/stats.js';
import { success, error } from '../middleware/envelope.js';

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
      } catch { /* skip owners without consents */ }
    }

    res.json(success(config.nodeId, {
      ...snap,
      active_owners: owners.length,
      active_agents: agents.length,
      // Push notification status (REQ-007)
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
