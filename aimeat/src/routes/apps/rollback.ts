/**
 * @file src/routes/apps/rollback.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description POST /v1/apps/:owner/:filename/rollback { version, note }: publish an earlier
 *   version of an app again as its newest version, in one call. The work, the who-may test and the
 *   audit row are in services/app/rollback-ops.ts, which aimeat_app_manage { action: "rollback" }
 *   calls too.
 * @structure registerRollbackRoutes(router, config, storage)
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-app-rollback-in-one-call-and-a-count-of-failed-changes-per-a).
 */
import type { Router, Request } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { z } from 'zod';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { validateBody } from '../../models/schemas.js';
import { safeText } from '../../models/input-limits.js';
import { rollbackAppFor } from '../../services/app/rollback-ops.js';
import { sendAppOp } from '../app-op-answer.js';

/** The shape and bounds of a rollback; that the version is earlier than the live one is the service's. */
const RollbackSchema = z.object({
    version: z.number().int().min(1),
    note: safeText(400),
});

/** The app this request names: `:owner` (`me` for the caller's own) and `:filename`. */
const refOf = (req: Request) => ({ owner: String(req.params.owner ?? ''), filename: String(req.params.filename ?? '') });

export function registerRollbackRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
    // app:write, the word every publish asks: a rollback is a publish of bytes the app already had.
    router.post('/v1/apps/:owner/:filename/rollback', requireAuth(), requireScope('app:write'), validateBody(RollbackSchema, config.nodeId), async (req, res) =>
        sendAppOp(res, config.nodeId, await rollbackAppFor(storage, config, req.auth!, refOf(req), req.body)));
}
