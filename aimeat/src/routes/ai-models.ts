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
 * @structure aiModelsRouter(config, storage) · modelView
 * @version-history
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
import { servesCapability } from '../services/ai/catalog/price.js';
import { CATALOG_TYPES, type CatalogModel, type CatalogType } from '../services/ai/catalog/types.js';
import { providersForOwner } from '../services/ai/provider-store.js';
import { TYPE_CAPABILITIES } from '../services/ai/providers.js';
import { loadPolicyDecision } from '../services/ai/policy-gate.js';
import { isAllowed } from '../services/ai/policy.js';
import type { AiCapability } from '../services/ai/types.js';
import { aiCallerOf } from './ai-policy.js';

const CAPABILITIES: readonly AiCapability[] = ['text', 'vision', 'files', 'image', 'speech', 'transcription', 'embed'];
const MAX_ROWS = 2000;

/** One model as the endpoint shows it; `ref` is what a call or a policy names. */
export function modelView(m: CatalogModel): Record<string, unknown> {
  return {
    ref: `${m.type}:${m.id}`, type: m.type, id: m.id, name: m.name,
    ...(m.family ? { family: m.family } : {}), ...(m.released ? { released: m.released } : {}),
    caps: m.caps, limits: m.limits, price: m.price, status: m.status,
    ...(m.retiresAt ? { retires_at: m.retiresAt } : {}),
    sources: m.sources,
  };
}

export function aiModelsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // ── GET /v1/ai/models ──
  router.get('/v1/ai/models', requireAuth(), requireScope('ai:use'), async (req: Request, res: Response) => {
    if (!assertAiUseAllowed(req, res, config.nodeId)) return;
    const q = req.query as Record<string, string | undefined>;
    const capability = q.capability as AiCapability | undefined;
    if (capability && !CAPABILITIES.includes(capability)) {
      return res.status(400).json(error(config.nodeId, 'INVALID_QUERY', `capability: one of ${CAPABILITIES.join(', ')}.`));
    }
    const type = q.type as CatalogType | undefined;
    if (type && !(CATALOG_TYPES as readonly string[]).includes(type)) {
      return res.status(400).json(error(config.nodeId, 'INVALID_QUERY', `type: one of ${CATALOG_TYPES.join(', ')}. A local server's models are not in the catalogue.`));
    }
    const status = q.status === 'all' ? null : (q.status ?? 'active,retiring').split(',');
    try {
      let models = catalogModels(type ? [type] : undefined)
        .filter(m => !status || status.includes(m.status))
        .filter(m => !capability || servesCapability(m, capability));
      if (q.allowed === 'true') {
        // What this caller can actually use: a provider of the model's type that serves the
        // capability, and a model the caller's policy allows.
        const { payer, agent } = aiPayerOf(resolveIdentity(req.auth!, config.nodeId));
        const cap = capability ?? 'text';
        const { node, owner } = await providersForOwner(storage, config, payer);
        const reachable = new Set([...owner, ...node].filter(p => !p.problem && p.capabilities[cap]?.enabled && TYPE_CAPABILITIES[p.type].includes(cap)).map(p => p.type as string));
        const policy = await loadPolicyDecision(storage, config, payer, {
          capability: cap, ...aiCallerOf(req, config.nodeId), ...(agent ? { agent } : {}),
        });
        models = models.filter(m => reachable.has(m.type) && isAllowed(policy.decision, `${m.type}:${m.id}`));
      }
      const total = models.length;
      const meta = catalogMeta();
      res.json(success(config.nodeId, {
        models: models.slice(0, MAX_ROWS).map(modelView), total, truncated: total > MAX_ROWS,
        snapshot: meta?.snapshot ?? null, refreshed_at: meta?.refreshedAt ?? null,
      }, [{ description: 'When the catalogue was refreshed, and from where', method: 'GET', url: '/v1/ai/catalog/meta' }]));
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
