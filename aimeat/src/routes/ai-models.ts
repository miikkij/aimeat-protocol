/**
 * @file ai-models.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The model catalogue over HTTP (System 2 plan, V4; docs/internal/llmproviderintegrations/
 *   06, section 8). The catalogue itself is services/ai/catalog/.
 *
 *     GET  /v1/ai/models          the catalogue, filtered by capability, type and status; with
 *                                 `allowed=true` only the models the caller's model policy allows on
 *                                 a provider the caller can use. An owner, an agent or an app with ai:use.
 *     GET  /v1/ai/catalog/meta    when the catalogue was refreshed and what each source answered. Public:
 *                                 nothing in it is anybody's.
 *     POST /v1/admin/ai/catalog/refresh   the operator refreshes now, whatever the cadence says.
 * @structure aiModelsRouter(config, storage)
 * @version-history
 *   v1.1.0 — 2026-09-28 — The filtering moved to services/ai/catalog/query.ts, which aimeat_ai_models
 *     calls too (V5). The answer is unchanged.
 *   v1.0.0 — 2026-09-28 — Initial (V4 of the System 2 plan).
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../auth/middleware.js';
import { assertAiUseAllowed } from '../auth/ai-gate.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { aiPayerOf } from '../services/agent-ai-keys.js';
import { AiCompletionError } from '../services/ai/errors.js';
import { catalogMeta, catalogModels } from '../services/ai/catalog/store.js';
import { refreshCatalog } from '../services/ai/catalog/refresh.js';
import { queryModels } from '../services/ai/catalog/query.js';
import { CATALOG_TYPES } from '../services/ai/catalog/types.js';
import { aiCallerOf } from './ai-policy.js';

export function aiModelsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // ── GET /v1/ai/models ──
  router.get('/v1/ai/models', requireAuth(), requireScope('ai:use'), async (req: Request, res: Response) => {
    if (!assertAiUseAllowed(req, res, config.nodeId)) return;
    const q = req.query as Record<string, string | undefined>;
    try {
      const { payer, agent } = aiPayerOf(resolveIdentity(req.auth!, config.nodeId));
      const answer = await queryModels(storage, config, { payer, ...(agent ? { agent } : {}), ...aiCallerOf(req, config.nodeId) }, {
        ...(q.capability ? { capability: q.capability } : {}), ...(q.type ? { type: q.type } : {}),
        ...(q.status ? { status: q.status } : {}), allowed: q.allowed === 'true',
      });
      res.json(success(config.nodeId, answer,
        [{ description: 'When the catalogue was refreshed, and from where', method: 'GET', url: '/v1/ai/catalog/meta' }]));
    } catch (e) {
      if (e instanceof AiCompletionError) return res.status(e.status).json(error(config.nodeId, e.code, e.message, e.status, e.details));
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', (e as Error).message));
    }
  });

  // ── GET /v1/ai/catalog/meta ── public
  router.get('/v1/ai/catalog/meta', (_req: Request, res: Response) => {
    const meta = catalogMeta();
    res.json(success(config.nodeId, {
      snapshot: meta?.snapshot ?? null, refreshed_at: meta?.refreshedAt ?? null, origin: meta?.origin ?? null,
      sources: meta?.sources ?? {}, sizes: meta?.sizes ?? {}, cadence: config.aiCatalogRefresh,
      counts: Object.fromEntries(CATALOG_TYPES.map(t => [t, catalogModels([t]).length])),
    }));
  });

  // ── POST /v1/admin/ai/catalog/refresh ── the operator, now
  router.post('/v1/admin/ai/catalog/refresh', requireAuth(), requireRole('operator'), async (_req: Request, res: Response) => {
    const r = await refreshCatalog(storage, config);
    const meta = catalogMeta();
    res.json(success(config.nodeId, { written: r.written, sources: r.sources, snapshot: meta?.snapshot ?? null }));
  });

  return router;
}
