/**
 * @file src/routes/usage-reports.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's own usage reports, read entirely from the precomputed serving layer.
 *   Design: docs/internal/telemetria/02-design.md
 *
 *   NOT routes/usage.ts, which is the owner's QUOTA summary (`/v1/owner/usage`) and the profile
 *   home composite. Two different meanings of "usage" sitting in one file would be the same
 *   one-word-two-senses trap the rest of this project keeps out of its vocabulary.
 *
 *   EVERY READ HERE IS OWNER-SCOPED BY CONSTRUCTION. The identity comes from
 *   resolveIdentity(req.auth!, nodeId) and is handed to a cut that carries ownerGhii; there is no
 *   parameter on this router that can name another owner. Cross-owner reads live behind
 *   /v1/admin/usage and the operator role.
 *
 *   IT TOUCHES NO RAW TABLE. That is the point of the layer: a report is a bounded read of
 *   pre-aggregated rows, whatever the node's traffic has grown to. Raw drill-down is an operator
 *   capability with its own audit trail, not something a chart does on the way past.
 * @structure
 *   - GET /v1/usage/summary   -- one named report, grouped and totalled
 *   - GET /v1/usage/reports   -- what may be asked for, so a client does not guess
 * @usage
 *   import { usageReportsRouter } from './routes/usage-reports.js';
 *   app.use(usageReportsRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-08-14 — Initial: the owner-facing usage reports.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity, ownerGhiiOf } from '../utils/gaii.js';
import {
  readUsageReport, OWNER_REPORTS, UnknownReportError, dayNDaysAgo,
} from '../services/usage/usage-read.js';

/** One sentence per report, so a client (or an agent) can pick without reading this file. */
const REPORT_HELP: Record<string, string> = {
  day: 'AI spend per day',
  model: 'which models you use most, and what each costs',
  app: 'AI spend per app',
  agent: 'AI spend per agent',
  tool: 'which tools you call, and which of them refuse or fail',
  surface: 'how you work: MCP, the web, apps',
  'apps-used': 'which apps you actually open',
  activity: 'your call volume over time',
  sold: 'what others bought from you, and what you refused',
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What an agent or a connected app needs before it may read this owner's usage.
 *
 * A usage report is the owner's spend and activity history for their whole account, which is the
 * same sensitivity class as their balance and transactions — so it takes the same word rather than a
 * new one. Without a gate, an app the owner approved for `memory:read` alone could read every model
 * they use, every app they open and everything they were charged for, which is exactly the widening
 * the route-scope invariant exists to catch.
 *
 * Owner sessions bypass scopes (requireScope's own rule), so a person reading their own reports in
 * the web app is unaffected; this binds agents, ecosystem apps and app grants.
 *
 * WORTH REVISITING: the activity reports (tool, surface, apps-used) are not money, and an app that
 * wants only those still has to be granted money-read. Erring toward the stricter word is the safe
 * direction, but a `usage:read` of its own would fit the vocabulary better.
 */
const USAGE_READ_SCOPE = 'wallet:read';

export function usageReportsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // ── GET /v1/usage/reports ── the menu. Cheap, static, and it means a client never guesses a name.
  router.get('/v1/usage/reports', requireAuth(), requireScope(USAGE_READ_SCOPE), (_req: Request, res: Response) => {
    res.json(success(config.nodeId, {
      reports: Object.keys(OWNER_REPORTS).map(name => ({
        name, describes: REPORT_HELP[name] ?? '',
      })),
      grains: ['day', 'hour'],
      note: 'Reports read a precomputed layer refreshed every few minutes; `computed_through` on each answer says how fresh it is.',
    }));
  });

  // ── GET /v1/usage/summary ── one report over a window.
  router.get('/v1/usage/summary', requireAuth(), requireScope(USAGE_READ_SCOPE), async (req: Request, res: Response) => {
    const report = typeof req.query.report === 'string' ? req.query.report : 'day';
    const from = typeof req.query.from === 'string' ? req.query.from : dayNDaysAgo(30);
    const to = typeof req.query.to === 'string' ? req.query.to : dayNDaysAgo(0);
    if (!ISO_DAY.test(from) || !ISO_DAY.test(to)) {
      return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'from and to must be YYYY-MM-DD'));
    }
    const grain = req.query.grain === 'hour' ? 'hour' : 'day';

    // The owner behind ANY session shape — an owner login, their agent, an app grant. The same
    // resolution the ledger uses, so a person sees one consistent account whichever door they came
    // through, and no door can ask for someone else's.
    const ownerGhii = ownerGhiiOf(resolveIdentity(req.auth!, config.nodeId));

    try {
      const data = await readUsageReport(storage, {
        report, scope: 'owner', ownerGhii, from, to, grain,
        series: req.query.series !== 'false',
        limit: Number(req.query.limit) || undefined,
      });
      res.json(success(config.nodeId, data, [
        { description: 'Available reports', method: 'GET', url: '/v1/usage/reports' },
        { description: 'Per-run LLM drill-down', method: 'GET', url: '/v1/ledger/usage/runs' },
      ]));
    } catch (err) {
      if (err instanceof UnknownReportError) {
        return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', err.message));
      }
      throw err;
    }
  });

  return router;
}
