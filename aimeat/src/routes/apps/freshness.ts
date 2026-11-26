/**
 * @file src/routes/apps/freshness.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/apps/:owner/:filename/freshness: what beside the app (design spec, acceptance
 *   criteria, data map, bound skills) is behind the app as it is now. The work is in
 *   services/app/freshness.ts, which aimeat_app_manage { action: "freshness" } calls too.
 * @structure registerFreshnessRoutes(router, config, storage)
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-one-freshness-answer-per-app-spec-skill-pitfalls-behind-the-).
 */
import type { Router, Request } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { appFreshnessFor } from '../../services/app/freshness.js';
import { sendAppOp } from '../app-op-answer.js';

const refOf = (req: Request) => ({ owner: String(req.params.owner ?? ''), filename: String(req.params.filename ?? '') });

export function registerFreshnessRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
    // app:write, as the design spec read asks: it names the documents only the app's builders read.
    router.get('/v1/apps/:owner/:filename/freshness', requireAuth(), requireScope('app:write'), async (req, res) =>
        sendAppOp(res, config.nodeId, await appFreshnessFor(storage, config, req.auth!, refOf(req))));
}
