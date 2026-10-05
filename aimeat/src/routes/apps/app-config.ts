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
 *   v1.2.0 — 2026-10-05 — Operator checks ask isOperatorCaller/operatorOverride: the operator's agent holding operator:admin passes as on MCP, and a pass in another person's account writes the operator trail (secaudit 2026-10, C2).
 *   v1.1.0 — 2026-10-05 — The read applies the app's own gates: an operator-hidden app is not found,
 *     and an access-coded app's workspace ids need the code (?code or X-Access-Code), the unlock token
 *     (?access), or the owner or an operator (secaudit 2026-10, APP-6).
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 2).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireScope, optionalAuth } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { resolveIdentity, ownerGhiiOf, localAccountName } from '../../utils/gaii.js';
import { getAppConfig, setAppConfig } from '../../services/app-config.js';
import { isOperatorCaller } from '../../services/operator-override.js';

export function registerAppConfigRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
    router.get('/v1/apps/:owner/:filename/config', optionalAuth(), async (req, res) => {
        const ownerName = localAccountName(req.params.owner as string);
        // The app's own gates (secaudit 2026-10, APP-6): the owner, an agent of theirs and an operator
        // pass them; anyone else brings the access code or the unlock token, as for the app itself.
        const auth = req.auth && req.auth.anonymous !== true ? req.auth : null;
        const ownerOrOperator = !!auth && (localAccountName(ownerGhiiOf(resolveIdentity(auth, config.nodeId))) === ownerName
            || await isOperatorCaller(storage, auth));
        const header = (name: string) => (typeof req.headers[name] === 'string' ? req.headers[name] as string : undefined);
        const out = await getAppConfig(storage, ownerName, req.params.filename as string, {
            ownerOrOperator,
            code: typeof req.query.code === 'string' ? req.query.code : header('x-access-code'),
            accessToken: typeof req.query.access === 'string' ? req.query.access : undefined,
        });
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
