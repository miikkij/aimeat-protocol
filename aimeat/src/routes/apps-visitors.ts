/**
 * @file src/routes/apps-visitors.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who opened one of my apps, when, and from where: the REST door on
 *   services/app-visitors.ts. The App Catalog's Visitors section and the two MCP tools
 *   (aimeat_app_visitors, aimeat_app_visitors_measure) answer from the same service.
 *
 *   ONLY THE APP'S OWN ACCOUNT. The report is built from a usage cut keyed by the VISITOR, read
 *   with no visitor pinned, so the ownership check here is the whole reason that read is safe: the
 *   app id's owner half must be the account the caller acts in, and a second owner asking about
 *   this app gets 403 before anything is read. What gets through is scope-gated like the signals
 *   door it sits beside: `signals:read` to look, `signals:write` to switch measurement.
 *
 *   `app_id` IS A QUERY PARAMETER, as on /v1/apps/cost: an app id is "owner/filename", and a slash
 *   breaks a path segment.
 * @structure appsVisitorsRouter — GET /v1/apps/visitors · PUT /v1/apps/visitors/measurement
 * @usage
 *   import { appsVisitorsRouter } from './routes/apps-visitors.js';
 *   app.use(appsVisitorsRouter(config, storage));   // before appsRouter, like appsCostRouter
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial: the Visitors section of the App Catalog.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { resolveIdentity } from '../utils/gaii.js';
import { SIGNAL_GEO_LEVELS } from '../models/signal-schemas.js';
import {
  AppVisitorsError, clampDays, parseAppId, readAppVisitors, setAppMeasurement, type AppRef,
} from '../services/app-visitors.js';

const MeasurementSchema = z.object({
  app_id: z.string().min(3).max(300).optional(),
  filename: z.string().min(1).max(200).optional(),
  on: z.boolean(),
  geo: z.enum(SIGNAL_GEO_LEVELS).optional(),
}).strict();

export function appsVisitorsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /**
   * The app this caller may ask about, or an answer already sent. The owner half of the id is
   * compared with the account the caller acts in, never taken as the account to read from.
   */
  function ownApp(req: Request, res: Response, named: { appId?: unknown; filename?: unknown }): AppRef | null {
    // A bare `filename` means "my own app", which is how an agent names it: it acts in one account
    // and has no reason to spell that account out. It resolves to the same id and the same check.
    const appId = typeof named.appId === 'string' && named.appId
      ? named.appId
      : (typeof named.filename === 'string' && named.filename ? `${req.auth!.owner}/${named.filename}` : '');
    const ref = parseAppId(appId);
    if (!ref) {
      res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'Name the app: app_id as "owner/filename", or filename for one of your own'));
      return null;
    }
    if (ref.owner !== req.auth!.owner) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Visitor numbers are shown to the app\'s own account only'));
      return null;
    }
    return ref;
  }

  function sendErr(res: Response, e: unknown): boolean {
    if (e instanceof AppVisitorsError) {
      res.status(e.statusCode).json(error(config.nodeId, e.code, e.message));
      return true;
    }
    return false;
  }

  /** GET /v1/apps/visitors?app_id=owner/file.html&days=30 (or ?filename=file.html) — days 0-360, 0 is today only. */
  router.get('/v1/apps/visitors', requireAuth(), requireScope('signals:read'), async (req: Request, res: Response) => {
    const ref = ownApp(req, res, { appId: req.query.app_id, filename: req.query.filename });
    if (!ref) return;
    try {
      const report = await readAppVisitors(storage, {
        app: ref, days: clampDays(req.query.days),
        geoAvailable: config.geoHeaders, geoAttribution: config.geoAttribution,
      });
      res.json(success(config.nodeId, report, [
        { description: 'Switch measurement on or off, and choose how precisely a place is kept', method: 'PUT', url: '/v1/apps/visitors/measurement' },
      ]));
    } catch (e) {
      if (!sendErr(res, e)) throw e;
    }
  });

  /** PUT /v1/apps/visitors/measurement { app_id, on, geo? } — off keeps what was collected. */
  router.put('/v1/apps/visitors/measurement', requireAuth(), requireScope('signals:write'), async (req: Request, res: Response) => {
    const parsed = MeasurementSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.error.message));
      return;
    }
    const ref = ownApp(req, res, { appId: parsed.data.app_id, filename: parsed.data.filename });
    if (!ref) return;
    try {
      const out = await setAppMeasurement(storage, { app: ref, on: parsed.data.on, geo: parsed.data.geo });
      emitChange('signals', resolveIdentity(req.auth!, config.nodeId));
      res.json(success(config.nodeId, { app: `${ref.owner}/${ref.filename}`, ...out, geo_available: config.geoHeaders }, [
        { description: 'Read who opened this app', method: 'GET', url: `/v1/apps/visitors?app_id=${encodeURIComponent(`${ref.owner}/${ref.filename}`)}` },
      ]));
    } catch (e) {
      if (!sendErr(res, e)) throw e;
    }
  });

  return router;
}
