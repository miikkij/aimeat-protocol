/**
 * @file worksheet.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Worksheet's one door: POST /v1/worksheet/evaluate, a sheet in and an answer per
 *   cell out. It reads no storage and reaches no network — a sheet is a record the caller already
 *   holds, and this route only works it out — so it needs no scope beyond being signed in, and one
 *   owner's request can tell nothing about another's.
 *
 *   WHY A DOOR AND NOT A BROWSER LIBRARY. The unit rules are the part that is quietly easy to get
 *   wrong (an unknown unit is silent, a mismatch does not throw, a difference of two Celsius readings
 *   is not a Celsius reading), so they live in one place and every surface — this route, the Worksheet
 *   page, the mosaic block, the MCP App — calls it. A second copy in the browser would be a second
 *   set of those rules to keep in step.
 * @structure worksheetRouter() — POST /v1/worksheet/evaluate
 * @usage app.use(worksheetRouter(config));
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial (wish-tyokirja-tieteellinen-laskenta, stage 1).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { EvaluateRequestSchema } from '../models/worksheet-schemas.js';
import { evaluateSheet } from '../services/worksheet/evaluate.js';

export function worksheetRouter(config: AimeatConfig): Router {
  const router = Router();

  // POST /v1/worksheet/evaluate — work out every cell of a sheet.
  //
  // The body carries the sheet itself rather than a key to one, so a surface can evaluate a sheet a
  // person is still typing, an agent can try one before writing it anywhere, and the route stays
  // free of any question about who may read what: it is handed the thing and hands back the answer.
  router.post('/v1/worksheet/evaluate', requireAuth(), (req, res) => {
    const parsed = EvaluateRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_WORKSHEET', parsed.error.issues[0]?.message ?? 'The worksheet could not be read.', 400, { issues: parsed.error.issues.slice(0, 10) }));
      return;
    }
    const { sheet, values, locale } = parsed.data;
    const answer = evaluateSheet(sheet, { values, locale });
    res.json(success(config.nodeId, answer, [
      { description: 'Keep the sheet', method: 'PUT', url: '/v1/memory/science.sheet.<id>' },
    ]));
  });

  return router;
}
