/**
 * @file src/routes/admin-key-reencrypt.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's view and start of the data key's re-encrypt job
 *   (services/key-reencrypt/job.ts): GET /v1/admin/encryption/reencrypt answers the key ring, the last
 *   run and whether the other key may be removed; POST starts a run. The MCP tool
 *   aimeat_admin_key_reencrypt and its CLI twin call the same functions. No key material is accepted
 *   or answered here: the keys are set in the environment only.
 * @structure adminKeyReencryptRouter
 * @usage router.use(adminKeyReencryptRouter(config, storage)) in routes/admin.ts
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 4a of 2026-11-05).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireOperator } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { reencryptStatus, startReencrypt } from '../services/key-reencrypt/job.js';
import { recordOperatorNodeAct } from '../services/operator-access-audit.js';
import { resolveIdentity, ownerGhiiOf } from '../utils/gaii.js';

export function adminKeyReencryptRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();

    router.get('/v1/admin/encryption/reencrypt', requireAuth(), requireOperator(storage), async (_req, res) => {
        res.json(success(config.nodeId, await reencryptStatus(storage, config)));
    });

    router.post('/v1/admin/encryption/reencrypt', requireAuth(), requireOperator(storage), async (req, res) => {
        const actorGaii = resolveIdentity(req.auth!, config.nodeId);
        const out = await startReencrypt(storage, config, actorGaii);
        if (!out.ok) {
            res.status(out.status).json(error(config.nodeId, out.code, out.message, undefined, undefined,
                [{ description: 'Read the key ring and the last run.', method: 'GET', url: '/v1/admin/encryption/reencrypt' }]));
            return;
        }
        if (out.started) recordOperatorNodeAct({ operatorGhii: ownerGhiiOf(actorGaii), actorGaii, area: 'encryption', action: 'reencrypt', meta: { target_key: out.status.ring.current } });
        res.status(out.started ? 202 : 200).json(success(config.nodeId, { started: out.started, ...out.status }));
    });

    return router;
}
