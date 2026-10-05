/**
 * @file connect-tunnel.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Read-only operator route exposing ConnectTunnelManager metrics
 *   for the Connector Forward Tunnel. The WS endpoint itself (`/v1/connect/
 *   tunnel`) is handled at the HTTP upgrade in `index.ts`, not here — this
 *   router only surfaces `getStats()` (active connection count, forward/deliver
 *   counters) so operators and the single-socket-invariant E2E can observe the
 *   tunnel's live state.
 * @structure connectTunnelRouter(config, storage) -> Router; GET /v1/connect/tunnel/stats
 * @usage app.use(connectTunnelRouter(config, storage));
 * @version-history
 *   v1.1.0 — 2026-10-05 — The operator routes ask requireOperator (askOperator with operator:admin), so the operator's agent holding operator:admin passes as on MCP (secaudit 2026-10, C2). The router takes storage for that check.
 *   v1.0.0 — 2026-06-10 — Phase 1: operator-only stats endpoint.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireOperator } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { getActiveConnectTunnelManager } from '../services/connect-tunnel.js';

export function connectTunnelRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // Operator-only: live tunnel metrics (active connection count etc.).
  router.get('/v1/connect/tunnel/stats', requireAuth(), requireOperator(storage), (_req, res) => {
    const mgr = getActiveConnectTunnelManager();
    if (!mgr) {
      res.status(503).json(error(config.nodeId, 'TUNNEL_DISABLED', 'Connector forward tunnel is not enabled on this node'));
      return;
    }
    res.json(success(config.nodeId, { stats: mgr.getStats() }));
  });

  return router;
}
