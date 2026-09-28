/**
 * @file src/routes/apps/app-config.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app's config over REST: the fields it declares, their values with the defaults
 *   filled in, and which required ones are still empty; and the owner's change to them. The work is
 *   services/app-config.ts, which the node MCP tool calls too.
 *
 *   READ IS PUBLIC, because the app reads its owner's values in the browser of whoever opened it,
 *   signed in or not (AIMEAT.data.appConfig()). Nothing secret can be there: publish refuses a
 *   config field marked secret. WRITE IS THE OWNER'S, and the agents acting for them.
 * @structure registerAppConfigRoutes(router, config, storage)
 *   GET /v1/apps/:owner/:filename/config · PUT /v1/apps/:owner/:filename/config
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 2).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { resolveIdentity, ownerGhiiOf, localAccountName } from '../../utils/gaii.js';
import { getAppConfig, setAppConfig } from '../../services/app-config.js';

export function registerAppConfigRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
    router.get('/v1/apps/:owner/:filename/config', async (req, res) => {
        const out = await getAppConfig(storage, localAccountName(req.params.owner as string), req.params.filename as string);
        if (!out.ok) {
            res.status(out.status).json(error(config.nodeId, out.code, out.message));
            return;
        }
        res.json(success(config.nodeId, out.view));
    });

    router.put('/v1/apps/:owner/:filename/config', requireAuth(), requireScope('app:write'), async (req, res) => {
        const out = await setAppConfig(storage, {
            callerOwnerGhii: ownerGhiiOf(resolveIdentity(req.auth!, config.nodeId)),
            ownerName: localAccountName(req.params.owner as string),
            filename: req.params.filename as string,
            values: (req.body ?? {}).values,
        });
        if (!out.ok) {
            res.status(out.status).json(error(config.nodeId, out.code, out.message, out.status, out.details));
            return;
        }
        res.json(success(config.nodeId, out.view));
    });
}
