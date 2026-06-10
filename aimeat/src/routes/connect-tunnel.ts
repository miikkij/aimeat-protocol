/**
 * @file connect-tunnel.ts
 * @description Read-only operator route exposing ConnectTunnelManager metrics
 *   for the Connector Forward Tunnel. The WS endpoint itself (`/v1/connect/
 *   tunnel`) is handled at the HTTP upgrade in `index.ts`, not here — this
 *   router only surfaces `getStats()` (active connection count, forward/deliver
 *   counters) so operators and the single-socket-invariant E2E can observe the
 *   tunnel's live state.
 * @structure connectTunnelRouter(config) -> Router; GET /v1/connect/tunnel/stats
 * @usage app.use(connectTunnelRouter(config));
 * @version-history
 *   v1.0.0 — 2026-06-10 — Phase 1: operator-only stats endpoint.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { getActiveConnectTunnelManager } from '../services/connect-tunnel.js';

export function connectTunnelRouter(config: AimeatConfig): Router {
  const router = Router();

  // Operator-only: live tunnel metrics (active connection count etc.).
  router.get('/v1/connect/tunnel/stats', requireAuth(), requireRole('operator'), (_req, res) => {
    const mgr = getActiveConnectTunnelManager();
    if (!mgr) {
      res.status(503).json(error(config.nodeId, 'TUNNEL_DISABLED', 'Connector forward tunnel is not enabled on this node'));
      return;
    }
    res.json(success(config.nodeId, { stats: mgr.getStats() }));
  });

  return router;
}
