/**
 * @file src/routes/evals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Stored eval sets for a crew, a skill or a library pack (services/evals/):
 *   - PUT  /v1/evals/:kind/:name        write the cases (memory:write)
 *   - GET  /v1/evals/:kind/:name        the set and its runs (memory:read)
 *   - POST /v1/evals/:kind/:name/run    start a run, or { dry_run: true } for its cost (ai:use)
 *   The work and the who-may test are in services/evals/eval-ops.ts, which the MCP tools call too.
 * @structure evalsRouter(config, storage)
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-stored-eval-sets-for-crews-skills-and-library-packs-scored-p).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { callerOf } from '../middleware/caller.js';
import { validateBody } from '../models/schemas.js';
import { safeText } from '../models/input-limits.js';
import { getEvalFor, runEvalFor, setEvalFor } from '../services/evals/eval-ops.js';

const EvalSetBody = z.object({
  cases: z.array(z.object({
    id: safeText(40),
    prompt: safeText(2000),
    expect: z.array(z.object({ kind: z.enum(['contains', 'not_contains', 'judge']), value: safeText(2000) })).max(5),
  })).max(10),
  repeats: z.number().int().min(1).max(5).optional(),
});
const EvalRunBody = z.object({ dry_run: z.boolean().optional() });

export function evalsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const deps = { storage, config };
  const send = (res: Response, out: { ok: true; status?: number; data: Record<string, unknown> } | { ok: false; status: number; code: string; message: string }) => {
    if (out.ok) res.status(out.status ?? 200).json(success(config.nodeId, out.data));
    else res.status(out.status).json(error(config.nodeId, out.code, out.message));
  };
  const p = (req: Request) => ({ kind: String(req.params.kind ?? ''), name: decodeURIComponent(String(req.params.name ?? '')) });

  router.put('/v1/evals/:kind/:name', requireAuth(), requireScope('memory:write'), validateBody(EvalSetBody, config.nodeId), async (req, res) => {
    const { kind, name } = p(req);
    send(res, await setEvalFor(deps, callerOf(req, config.nodeId, storage), kind, name, req.body));
  });
  router.get('/v1/evals/:kind/:name', requireAuth(), requireScope('memory:read'), async (req, res) => {
    const { kind, name } = p(req);
    send(res, await getEvalFor(deps, callerOf(req, config.nodeId, storage), kind, name));
  });
  router.post('/v1/evals/:kind/:name/run', requireAuth(), requireScope('ai:use'), validateBody(EvalRunBody, config.nodeId), async (req, res) => {
    const { kind, name } = p(req);
    send(res, await runEvalFor(deps, callerOf(req, config.nodeId, storage), kind, name, req.body));
  });
  return router;
}
