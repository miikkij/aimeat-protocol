import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { StatsCollector } from '../services/stats.js';
import { success, error } from '../middleware/envelope.js';

export function statsRouter(config: AimeatConfig, storage: Storage, stats: StatsCollector): Router {
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

    res.json(success(config.nodeId, {
      ...snap,
      active_owners: owners.length,
      active_agents: agents.length,
      // Push notification status (REQ-007)
      push_notifications: {
        enabled: config.pushEnabled && !!config.vapidPublicKey,
        personal_node_support: config.personalNodesEnabled,
      },
    }));
  });

  return router;
}
