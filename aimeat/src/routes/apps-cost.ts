/**
 * @file src/routes/apps-cost.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description G3 — the per-app COST & CONTRACTS surface for EXCHANGE (TARGET-045). One owner-scoped read
 *   that composes an app's priced dependencies so the app-catalog can show, per app: its active EXCHANGE
 *   contracts (entitlements), live consumption (spend + calls against each budget), an estimated
 *   per-call/per-remaining cost, and the billing posture (does the app recoup from end-users, and the
 *   platform rake). Read-only and generic — any app with priced dependencies uses it, not just EXCHANGE.
 *   Attribution is by the entitlement's `appId`; the caller only ever sees entitlements whose consumer is
 *   their own owner (strictly cross-owner, per resolveIdentity).
 *
 *   The view is built by appCostView() in services/app-cost.ts, which the MCP tool calls too; this
 *   file holds the auth and the envelope.
 *
 *   LLM-usage attribution (ledger) is intentionally out of scope for slice-1: the usage ledger has no
 *   appId dimension yet, so this composes the entitlement spend (which IS the per-app metered consumption
 *   record). The ledger fold is a later addition (an appId dimension on usage events).
 * @structure appsCostRouter — GET /v1/apps/cost?app_id=…
 * @usage
 *   import { appsCostRouter } from './routes/apps-cost.js';
 *   app.use(appsCostRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-07-20 — Initial per-app cost/contract surface (EXCHANGE G3): entitlements + budgets + rake.
 *   v1.0.1 — 2026-09-26 — ownerOf is localAccountName (utils/gaii.ts), which keeps an identity of
 *     another node whole, so it never names the local namesake (secaudit 2026-09, F-1).
 *   v1.1.0 — 2026-09-27 — toContractView, spendTotals, the entitlement filter and the roll-up moved
 *     unchanged to appCostView() in services/app-cost.ts, so the MCP tool calls the same code.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { appCostView } from '../services/app-cost.js';

export function appsCostRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /**
   * GET /v1/apps/cost?app_id=… — the app's EXCHANGE cost & contracts, for its OWNER. Composes every
   * entitlement attributed to this appId whose consumer is the requesting owner, plus roll-up totals.
   * `app_id` is a query param (app ids are "owner/filename" — a slash breaks a path segment).
   */
  router.get('/v1/apps/cost', requireAuth(), requireScope('exchange:read'), async (req: Request, res: Response) => {
    const appId = typeof req.query.app_id === 'string' ? req.query.app_id : '';
    const result = await appCostView(storage, config, {
      owner: req.auth!.owner,
      ownerGhii: resolveIdentity(req.auth!, config.nodeId),
      appId,
    });
    if (!result.ok) return res.status(result.status).json(error(config.nodeId, result.code, result.message));
    res.json(success(config.nodeId, result.view, result.links));
  });

  return router;
}
