/**
 * @file src/routes/help/admin.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's side of Ask someone who knows over REST: the reports about what people
 *   asked and the month so far. The same functions as aimeat_help_report_data and
 *   aimeat_help_report_write (services/help/report.ts). The settings themselves are config rows
 *   (help.*), written through the admin config routes like every other setting.
 *
 *   - GET  /v1/admin/help/reports         — one report's figures and the writer's instructions (?id=, or ?make=monthly|weekly)
 *   - POST /v1/admin/help/reports/:id     — store the written text and suggestions, or decide suggestions
 *   - GET  /v1/admin/help/status          — the month so far, not stored
 * @usage app.use(helpAdminRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import { Router, type Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { callerOf } from '../../middleware/caller.js';
import { validateBody } from '../../models/schemas.js';
import { HelpReportWriteBody } from '../../models/help-schemas.js';
import { OPERATOR_ADMIN_SCOPE } from '../../utils/scope-coverage.js';
import { reportData, writeReportText, liveStatus } from '../../services/help/report.js';
import type { HelpResult } from '../../services/help/rules.js';

export function helpAdminRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const deps = { storage, config };
  const gate = [requireAuth(), requireScope(OPERATOR_ADMIN_SCOPE)];
  const send = <T>(res: Response, r: HelpResult<T>, status = 200): void => {
    if (!r.ok) { res.status(r.status).json(error(config.nodeId, r.code, r.message)); return; }
    res.status(status).json(success(config.nodeId, r.data));
  };

  router.get('/v1/admin/help/reports', ...gate, async (req, res) => {
    const make = req.query.make === 'monthly' || req.query.make === 'weekly' ? req.query.make : undefined;
    const id = typeof req.query.id === 'string' ? req.query.id : undefined;
    send(res, await reportData(deps, callerOf(req, config.nodeId, storage), { ...(id ? { id } : {}), ...(make ? { make } : {}) }));
  });

  router.post('/v1/admin/help/reports/:id', ...gate, validateBody(HelpReportWriteBody, config.nodeId), async (req, res) => {
    send(res, await writeReportText(deps, callerOf(req, config.nodeId, storage), String(req.params.id ?? ''), req.body ?? {}));
  });

  router.get('/v1/admin/help/status', ...gate, async (req, res) => {
    send(res, await liveStatus(deps, callerOf(req, config.nodeId, storage)));
  });

  return router;
}
