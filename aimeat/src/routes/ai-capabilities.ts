/**
 * @file ai-capabilities.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the caller can do with AI, and embeddings (System 2 plan, V5; docs/internal/
 *   llmproviderintegrations/07 sections 2 and 5, 12).
 *
 *     GET  /v1/ai/capabilities   per capability: on or off, the model and provider a call would use,
 *                                its price, and for one that is off the reason and the fix. For the
 *                                caller: an owner, an agent (its own key and lists count) or an app
 *                                (its grant and its meta count). `app_id` names the app a caller
 *                                acts for, as on every AI call.
 *     POST /v1/ai/embed          vectors for a list of texts (services/ai-embed.ts).
 *
 *   Both need `ai:use` (an owner session passes), as every AI route does (auth/ai-gate.ts).
 * @structure aiCapabilitiesRouter(config, storage)
 * @version-history
 *   v1.1.0 — 2026-09-28 — POST /v1/ai/embed takes `role`, the AI role the call runs as (readCallRole).
 *   v1.0.0 — 2026-09-28 — Initial (V5 of the System 2 plan).
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { assertAiUseAllowed } from '../auth/ai-gate.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { aiPayerOf } from '../services/agent-ai-keys.js';
import { AiCompletionError } from '../services/ai/errors.js';
import { aiCapabilitiesView } from '../services/ai/capabilities.js';
import { embedForOwner } from '../services/ai-embed.js';
import { readCallRole } from '../services/ai-call-guards.js';
import { aiCallerOf } from './ai-policy.js';

export function aiCapabilitiesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const aiRateLimit = rateLimit(config.rateLimits.openrouter);
  const fail = (res: Response, e: unknown) => {
    if (e instanceof AiCompletionError) return res.status(e.status).json(error(config.nodeId, e.code, e.message, e.status, e.details));
    return res.status(502).json(error(config.nodeId, 'PROVIDER_ERROR', (e as Error).message));
  };

  // ── GET /v1/ai/capabilities ──
  router.get('/v1/ai/capabilities', requireAuth(), requireScope('ai:use'), async (req: Request, res: Response) => {
    if (!assertAiUseAllowed(req, res, config.nodeId)) return;
    const { payer, agent } = aiPayerOf(resolveIdentity(req.auth!, config.nodeId));
    const appId = typeof req.query.app_id === 'string' && req.query.app_id ? req.query.app_id.slice(0, 200) : undefined;
    try {
      const view = await aiCapabilitiesView(storage, config, payer, {
        ...aiCallerOf(req, config.nodeId), ...(agent ? { agent } : {}), ...(appId ? { appId } : {}),
      });
      res.json(success(config.nodeId, view, [
        { description: 'The guide for building with these capabilities', method: 'GET', url: '/v1/skills/aimeat-ai-capabilities?scope=node' },
        { description: 'The models each capability can use', method: 'GET', url: '/v1/ai/models?allowed=true' },
      ]));
    } catch (e) { fail(res, e); }
  });

  // ── POST /v1/ai/embed ──
  router.post('/v1/ai/embed', requireAuth(), requireScope('ai:use'), aiRateLimit, async (req: Request, res: Response) => {
    if (!assertAiUseAllowed(req, res, config.nodeId)) return;
    req.setTimeout(180_000);
    res.setTimeout(180_000);
    const { payer, agent } = aiPayerOf(resolveIdentity(req.auth!, config.nodeId));
    const { input, model, app_id, provider, fallback, role: roleField } = (req.body ?? {}) as {
      input?: unknown; model?: string; app_id?: string; provider?: string; fallback?: boolean; role?: unknown;
    };
    const texts = typeof input === 'string' ? [input] : input;
    try {
      // The AI role the call runs as (services/ai/roles.ts), 1 to 300 characters or absent.
      const role = readCallRole(roleField);
      const r = await embedForOwner(storage, config, payer, {
        input: texts as string[], appId: typeof app_id === 'string' ? app_id : undefined,
        ...(typeof model === 'string' && model ? { model } : {}),
        ...(agent ? { agent } : {}), ...aiCallerOf(req, config.nodeId),
        ...(typeof provider === 'string' && provider ? { provider } : {}),
        ...(typeof fallback === 'boolean' ? { fallback } : {}),
        ...(role ? { role } : {}),
      });
      res.json(success(config.nodeId, {
        embeddings: r.embeddings, model: r.model, dimensions: r.dimensions, route: r.route,
        usage: { prompt_tokens: r.usage.promptTokens, cost_usd: r.usage.costUsd, cost_exact: r.usage.costExact },
        budget: { daily_budget_usd: r.budget.dailyBudgetUsd, spent_today_usd: r.budget.spentTodayUsd, remaining_usd: r.budget.remainingUsd },
      }));
    } catch (e) { fail(res, e); }
  });

  return router;
}
