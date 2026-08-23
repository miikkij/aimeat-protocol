/**
 * @file src/routes/compliance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An account's own compliance slice: what it did with AI here, and which of the
 *   operator's use-case entries name it.
 *
 *   WHY AN ACCOUNT NEEDS THIS AND NOT ONLY THE OPERATOR. Most publishing here is done by accounts,
 *   and the duty follows whoever publishes. An account that cannot see its own exposure cannot act
 *   on it, and the operator's report is not theirs to read. The same argument the per-owner AI
 *   transparency view was built on, one layer up.
 *
 *   THE SCOPE COMES FROM THE TOKEN, NEVER FROM THE REQUEST. resolveIdentity() decides whose slice
 *   this is; there is no `?owner=` and adding one would be the whole point of the route undone. Any
 *   authenticated principal may ask, and what it gets back is its own owner's — an agent asking on
 *   behalf of its owner sees exactly what the owner sees, which is what an agent acting in someone's
 *   name should see.
 *
 *   IT IS NOT THE OPERATOR REPORT NARROWED. `not_covered` says different things here, because three
 *   of the operator's sentences would be false said to an account: they operate nothing, they set no
 *   retention window, and the register they are measured against is somebody else's. Handing them
 *   the operator's wording would claim a reach the reader does not have.
 * @structure
 *   - complianceRouter(config, storage)
 *   - GET /v1/compliance/report/mine — your own slice
 * @usage
 *   import { complianceRouter } from './routes/compliance.js';
 *   app.use(complianceRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-08-23 — BR-02, the per-owner slice.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity, ownerGhiiOf } from '../utils/gaii.js';
import { buildComplianceReport, MONTH_RE } from '../services/compliance-report.js';

/**
 * The word this repo already uses for reading an owner's own activity ledger.
 *
 * `wallet:read` gates GET /v1/usage/reports and /v1/usage/summary, and it is the word the sibling
 * route GET /v1/ai-transparency/mine is recorded as wanting (security/route-scope-exemptions.json).
 * This report is the same material one level up — how much AI ran under this account — so it takes
 * the same word rather than inventing a second one for the same sensitivity class.
 *
 * A person reading their own card passes without it: requireScope() lets an owner session through,
 * because an owner acts for all their own agents. An agent needs the tick, which is the point.
 */
const OWN_ACTIVITY_SCOPE = 'wallet:read';

export function complianceRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  router.get('/v1/compliance/report/mine', requireAuth(), requireScope(OWN_ACTIVITY_SCOPE), async (req: Request, res: Response) => {
    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    if (month && !MONTH_RE.test(month)) {
      res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
        'The month has to look like 2026-08. Leave it out to get a rolling window instead.'));
      return;
    }
    const sinceDays = Number.parseInt(String(req.query.since_days ?? ''), 10);
    // The owner behind whatever is calling: an owner session is itself, an agent or an ecosystem app
    // resolves to the human it acts for. Never req.query, and never req.auth.sub raw.
    const ownerGhii = ownerGhiiOf(resolveIdentity(req.auth!, config.nodeId));

    const report = await buildComplianceReport(storage, config, {
      ownerGhii,
      month,
      sinceDays: Number.isFinite(sinceDays) ? sinceDays : undefined,
    });

    res.json(success(config.nodeId, report, [
      { description: 'What you published with a model in it, item by item', method: 'GET', url: '/v1/ai-transparency/mine' },
      { description: 'What is logged about a model call, and for how long', method: 'GET', url: '/v1/ai-transparency/logging-policy' },
    ]));
  });

  return router;
}
