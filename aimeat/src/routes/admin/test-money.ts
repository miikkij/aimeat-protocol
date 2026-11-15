/**
 * @file src/routes/admin/test-money.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The books of the test money handler (commerce/test-money-ledger.ts), for the operator,
 *   while test money is on: per buyer instrument what was charged, held and refunded, per seller what
 *   was paid out. With a real provider these books are the provider's dashboard; a test reads them to
 *   prove what a hold, a capture, a release, a refund or a payout did to the money. When test money is
 *   off the route answers 404 NOT_FOUND to everyone, as an address that does not exist.
 *   No MCP tool: it is a read for test runs on a node with test money on, and .claude/rules/tool-surfaces.md
 *   asks the node and connector MCP to offer the same tools, not one tool per route.
 * @structure adminTestMoneyRouter(config, storage)
 *   - GET /v1/admin/test-money/ledger?instrument=&seller=
 * @version-history
 *   2026-11-15 — Initial (test money keeps the books a real payment provider keeps; audit M139).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireOperator } from '../../auth/middleware.js';
import { testMoneyHandlerActive } from '../../utils/test-money-guard.js';
import { readLedger } from '../../commerce/test-money-ledger.js';

/** The longest instrument or seller a filter takes. */
const FILTER_MAX = 256;

export function adminTestMoneyRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /* ── GET /v1/admin/test-money/ledger — the test money provider's books ── */
  router.get('/v1/admin/test-money/ledger',
    (_req, res, next) => {
      if (testMoneyHandlerActive(config)) { next(); return; }
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Test money is off on this node, so it keeps no books'));
    },
    requireAuth(), requireOperator(storage),
    async (req, res) => {
      const filter: { instrument?: string; seller?: string } = {};
      for (const name of ['instrument', 'seller'] as const) {
        const v = req.query[name];
        if (v === undefined) continue;
        if (typeof v !== 'string' || !v || v.length > FILTER_MAX) {
          res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `${name} must be one non-empty string of at most ${FILTER_MAX} characters`));
          return;
        }
        filter[name] = v;
      }
      res.json(success(config.nodeId, await readLedger(storage, config, filter)));
    });

  return router;
}
