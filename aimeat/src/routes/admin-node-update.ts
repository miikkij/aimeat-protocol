/**
 * @file src/routes/admin-node-update.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/admin/node-update: whether npm has a newer AIMEAT than this node runs, when it
 *   was released, what is new in it, and the prompt that updates the node. Operator only. The site
 *   header asks it for an operator and shows a notice when `updateAvailable` is true; the dialog
 *   behind the notice renders the rest.
 *
 *   Thin over services/node-update-check.ts, which the aimeat_admin_node_update MCP tool calls too.
 *   `?refresh=true` skips the six-hour cache, for the dialog's "check again".
 * @structure adminNodeUpdateRouter(config, storage)
 * @usage router.use(adminNodeUpdateRouter(config, storage));   // in routes/admin.ts
 * @version-history
 *   v1.1.0 — 2026-10-05 — The operator routes ask requireOperator (askOperator with operator:admin), so the operator's agent holding operator:admin passes as on MCP (secaudit 2026-10, C2). The factory takes storage for that check.
 *   v1.0.0 — 2026-09-30 — Initial.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireOperator } from '../auth/middleware.js';
import { success } from '../middleware/envelope.js';
import { getNodeUpdateStatus } from '../services/node-update-check.js';

export function adminNodeUpdateRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();

    router.get('/v1/admin/node-update', requireAuth(), requireOperator(storage), async (req, res) => {
        const status = await getNodeUpdateStatus(config, { refresh: req.query.refresh === 'true' });
        res.json(success(config.nodeId, status, status.updateAvailable
            ? [{ description: 'Switch this check off', method: 'PUT', url: '/v1/admin/config' }]
            : []));
    });

    return router;
}
