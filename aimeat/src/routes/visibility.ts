/**
 * @file src/routes/visibility.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AI visibility over REST: the owner's report (where people came from, which AIs
 *   fetched what, who read the discovery files, which purchases followed) and the owner's switch.
 *   The MCP tools `aimeat_visibility_report` and `aimeat_visibility_settings_set` call the same
 *   service functions (services/visibility/), so the panel and the owner's AI read one answer.
 *
 *   Also the middleware that counts the node's OWN discovery files on the apex (llms.txt,
 *   AGENTS.md, the MCP server card, the UCP profile) for the place's operator. It only counts and
 *   always calls next(), so the routes that serve those files are unchanged.
 * @structure visibilityRouter (GET /v1/visibility/report, GET|PUT /v1/visibility/settings) · countApexDocs
 * @usage app.use(visibilityRouter(config, storage)); router.use(countApexDocs(config, storage));
 * @version-history
 *   v1.1.0 — 2026-10-08 — The settings take the owner's Clarity project id and GA4 measurement id
 *     (layer B), and answer in one view shared with the MCP tool.
 *   v1.0.0 — 2026-10-08 — Initial, for AI visibility (layer A).
 */
import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { z } from 'zod';
import type { AimeatConfig } from '../config-types.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { callerOf } from '../middleware/caller.js';
import { logger } from '../utils/logger.js';
import { visitSignals } from '../utils/visit-signals.js';
import type { VisibilityDoc } from '../models/visibility-schemas.js';
import { countVisit, nodeCountsVisibility, resolvePlaceOwner } from '../services/visibility/visibility-counter.js';
import { getVisibilitySettings, setVisibilitySettings, VisibilitySettingsError } from '../services/visibility/visibility-settings.js';
import { visibilitySettingsView } from '../services/visibility/analytics-tags.js';
import { readVisibilityReport } from '../services/visibility/visibility-report.js';

/** Every field optional: only what is given changes. A null id removes it. */
const SettingsSchema = z.object({
  enabled: z.boolean().optional(),
  clarity_project_id: z.string().max(40).nullable().optional(),
  ga4_measurement_id: z.string().max(40).nullable().optional(),
}).strict();

/** The node's own discovery files, by the paths they are served on. */
const APEX_DOCS: Record<string, VisibilityDoc> = {
  '/llms.txt': 'llms.txt',
  '/llms-full.txt': 'llms-full.txt',
  '/AGENTS.md': 'AGENTS.md',
  '/agents.md': 'AGENTS.md',
  '/.well-known/mcp.json': 'mcp.json',
  '/.well-known/mcp/server-card.json': 'mcp.json',
  '/.well-known/ucp': 'ucp',
};

/**
 * Count a fetch of one of the node's own discovery files for the place's operator. Mounted ahead
 * of the routes that serve them; an app origin's own files are counted where they are served
 * (routes/subdomain-origin-docs.ts), so this skips every subdomain.
 */
export function countApexDocs(config: AimeatConfig, storage: Storage): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.method === 'GET' && !req.subdomain && !req.appOrigin && !req.portfolioOrigin && !req.coOrigin
      && Object.hasOwn(APEX_DOCS, req.path) && nodeCountsVisibility(config)) {
      const doc = APEX_DOCS[req.path]!;
      // No utm_source: a discovery file is read by a program, and its channel is not counted.
      const visit = visitSignals((n) => req.get(n), undefined, req.hostname, config.baseUrl);
      const target = req.path;
      resolvePlaceOwner(storage, config)
        .then((owner) => { if (owner) countVisit(storage, config, { ownerGaii: owner, target, doc, ...visit }); })
        .catch((e) => { logger.warn('visibility: the place owner could not be read', { error: String(e) }); });
    }
    next();
  };
}

export function visibilityRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /** The account whose report this is. A visitor from another node has none here. */
  function ownerOf(req: Request, res: Response): string | null {
    const caller = callerOf(req, config.nodeId, storage);
    if (caller.visitor) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'A session from another node has no visibility report here.'));
      return null;
    }
    return caller.ownerGhii;
  }

  router.get('/v1/visibility/report', requireAuth(), requireScope('signals:read'), async (req, res) => {
    const owner = ownerOf(req, res);
    if (!owner) return;
    const report = await readVisibilityReport(storage, config, owner, { days: req.query.days });
    res.json(success(config.nodeId, report, [
      { description: 'Switch counting off or on', method: 'PUT', url: '/v1/visibility/settings' },
    ]));
  });

  router.get('/v1/visibility/settings', requireAuth(), requireScope('signals:read'), async (req, res) => {
    const owner = ownerOf(req, res);
    if (!owner) return;
    res.json(success(config.nodeId, visibilitySettingsView(config, await getVisibilitySettings(storage, owner))));
  });

  router.put('/v1/visibility/settings', requireAuth(), requireScope('signals:write'), async (req, res) => {
    const parsed = SettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.error.message));
      return;
    }
    const owner = ownerOf(req, res);
    if (!owner) return;
    let settings;
    try {
      settings = await setVisibilitySettings(storage, owner, {
        enabled: parsed.data.enabled,
        clarityProjectId: parsed.data.clarity_project_id,
        ga4MeasurementId: parsed.data.ga4_measurement_id,
      });
    } catch (e) {
      if (e instanceof VisibilitySettingsError) {
        res.status(400).json(error(config.nodeId, e.code, e.message));
        return;
      }
      throw e;
    }
    res.json(success(config.nodeId, visibilitySettingsView(config, settings), [
      { description: 'Read the report', method: 'GET', url: '/v1/visibility/report' },
    ]));
  });

  return router;
}
