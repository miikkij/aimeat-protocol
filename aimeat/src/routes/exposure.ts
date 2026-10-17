/**
 * @file src/routes/exposure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The exposure report over REST (plan doc-mvcn6c7e4e5q, V6.3): what of the caller's own
 *   content someone outside can read (strangers, any signed-in account, the members of one
 *   organisation), with how to close each, and the operator's node-wide numbers. Both are
 *   services/exposure/exposure-report.ts, which the MCP tool aimeat_exposure_report calls too.
 *
 *   WHO MAY READ /mine. The person in person, and their own agent holding memory:read, the word that
 *   reads what the report lists. The report is always the caller's own account: there is no
 *   parameter naming another one, so another person's agent reads its own person's report. An app
 *   grant and an ecosystem app are refused: the report spans the whole account, and an app is
 *   fenced to its own data areas. A session from another node has no account here.
 * @structure exposureRouter(config, storage): GET /v1/exposure/mine · GET /v1/admin/exposure
 * @usage app.use(exposureRouter(config, storage));
 * @version-history
 *   v1.0.1 — 2026-10-18 — A report no source could be read for answers 503 STORAGE_UNAVAILABLE.
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V6.3).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope, requireOperator } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { callerOf } from '../middleware/caller.js';
import { createExposureContext } from '../services/exposure/exposure-types.js';
import { buildExposureReport, buildNodeExposureReport, exposureUnreadable, EXPOSURE_UNREADABLE_MESSAGE } from '../services/exposure/exposure-report.js';
import { readerFor } from '../services/classification/reader.js';

export function exposureRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  router.get('/v1/exposure/mine', requireAuth(), requireScope('memory:read'), async (req, res) => {
    const caller = callerOf(req, config.nodeId, storage);
    if (caller.visitor) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'A session from another node has no account here, so it has no exposure report.'));
      return;
    }
    if (caller.kind !== 'owner' && caller.kind !== 'agent') {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'The exposure report covers the whole account; the person or their own agent reads it, an app does not.'));
      return;
    }
    const report = await buildExposureReport(createExposureContext(storage, config), caller.owner,
      readerFor({ storage, config }, req.auth));
    if (exposureUnreadable(report)) {
      res.status(503).json(error(config.nodeId, 'STORAGE_UNAVAILABLE', EXPOSURE_UNREADABLE_MESSAGE));
      return;
    }
    res.json(success(config.nodeId, report, [
      { description: 'Share or stop sharing a workspace page', method: 'PUT', url: '/v1/organisms/{id}/workspace/share' },
      { description: 'Change who reads a memory record', method: 'PATCH', url: '/v1/memory/{key}' },
    ]));
  });

  router.get('/v1/admin/exposure', requireAuth(), requireOperator(storage), async (_req, res) => {
    res.json(success(config.nodeId, await buildNodeExposureReport(createExposureContext(storage, config))));
  });

  return router;
}
