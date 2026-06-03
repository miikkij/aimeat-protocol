/**
 * @file ai.ts
 * @description App-level AI completion endpoint. Sibling of /v1/openrouter/complete
 *   but without the project-id gate: any logged-in owner (or agent with `ai:use`
 *   scope) can call it from a sandboxed app or extension. The actual completion,
 *   budget enforcement, key decrypt, and usage accounting live in the shared
 *   services/ai-completion.ts module (also used by the scheduler's `ai` jobs);
 *   this router is a thin HTTP wrapper + the owner-only settings/usage endpoints.
 * @structure
 *   - POST /v1/ai/complete — owner or agent(ai:use), runs one completion
 *   - GET  /v1/ai/usage     — owner-only, today's spend per-app breakdown
 *   - POST /v1/ai/settings  — owner-only, update budget/quotas/allowlist
 *   - GET  /v1/ai/settings  — owner-only, read budget/quotas/allowlist
 * @usage
 *   import { aiRouter } from './routes/ai.js';
 *   app.use(aiRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-05-29 — Initial: app-level AI calls with budget enforcement
 *   v1.1.0 — 2026-06-03 — Delegate completion to services/ai-completion.ts (shared
 *     with the scheduler); route is now a thin wrapper.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import {
  completeForOwner, AiCompletionError, getTodayUsage, getDailyBudgetUsd,
  DEFAULT_DAILY_BUDGET_USD, DEFAULT_APP_DAILY_USD,
} from '../services/ai-completion.js';

export function aiRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const resolve = (req: Request) => resolveIdentity(req.auth!, config.nodeId);
  // Reuse the openrouter rate limit bucket — same provider, same spend concerns.
  const aiRateLimit = rateLimit(config.rateLimits.openrouter);

  async function upsertMemory(gaii: string, key: string, value: unknown, tags: string[]): Promise<void> {
    const now = new Date().toISOString();
    const existing = await storage.getMemory(gaii, key);
    await storage.setMemory({
      key, ownerGaii: gaii, value, visibility: 'private', tags,
      ttlHours: null,
      version: existing ? existing.version + 1 : 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  /**
   * Either the caller is an owner JWT (role=owner) OR an agent JWT with the
   * `ai:use` scope. Reject any other shape.
   */
  function gateOwnerOrAiUseAgent(req: Request, res: Response): boolean {
    const roles = req.auth?.roles ?? [];
    if (roles.includes('owner')) return true;
    if (roles.includes('agent')) {
      const scopes = (req.auth as { scopes?: string[] } | undefined)?.scopes ?? [];
      if (scopes.includes('ai:use') || scopes.includes('*')) return true;
      res.status(403).json(error(config.nodeId, 'SCOPE_REQUIRED',
        'Agent JWT missing required scope: ai:use'));
      return false;
    }
    res.status(403).json(error(config.nodeId, 'FORBIDDEN',
      'AI completion requires owner or agent(ai:use) authentication.'));
    return false;
  }

  // ── POST /v1/ai/complete ──
  router.post('/v1/ai/complete',
    requireAuth(), aiRateLimit,
    async (req: Request, res: Response) => {
      if (!gateOwnerOrAiUseAgent(req, res)) return;
      req.setTimeout(1_800_000);
      res.setTimeout(1_800_000);

      const gaii = resolve(req);
      const {
        prompt, systemPrompt, model: modelOverride, modelRole,
        temperature, top_p, max_tokens, app_id,
      } = req.body as {
        prompt?: string; systemPrompt?: string; model?: string;
        modelRole?: 'reasoning' | 'execution';
        temperature?: number; top_p?: number; max_tokens?: number;
        app_id?: string;
      };

      try {
        const r = await completeForOwner(storage, config, gaii, {
          prompt: prompt as string, systemPrompt, model: modelOverride, modelRole,
          temperature, topP: top_p, maxTokens: max_tokens, appId: app_id,
        });
        res.json(success(config.nodeId, {
          content: r.content,
          model: r.model,
          usage: {
            prompt_tokens: r.usage.promptTokens,
            completion_tokens: r.usage.completionTokens,
            total_tokens: r.usage.totalTokens,
            cost_usd: r.usage.costUsd,
            cost_exact: r.usage.costExact,
          },
          budget: {
            daily_budget_usd: r.budget.dailyBudgetUsd,
            spent_today_usd: r.budget.spentTodayUsd,
            remaining_usd: r.budget.remainingUsd,
          },
        }));
      } catch (e) {
        if (e instanceof AiCompletionError) {
          return res.status(e.status).json(error(config.nodeId, e.code, e.message));
        }
        return res.status(502).json(error(config.nodeId, 'PROVIDER_ERROR', (e as Error).message));
      }
    });

  // ── GET /v1/ai/usage ── today's spend breakdown
  router.get('/v1/ai/usage',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const usage = await getTodayUsage(storage, gaii);
      const prefsRecord = await storage.getMemory(gaii, 'openrouter.settings');
      const prefs = (prefsRecord?.value as Record<string, unknown>) ?? {};
      const dailyBudget = getDailyBudgetUsd(prefs);
      res.json(success(config.nodeId, {
        date: usage.date,
        daily_budget_usd: dailyBudget,
        spent_today_usd: usage.total_cost_usd,
        remaining_usd: Math.max(0, dailyBudget - usage.total_cost_usd),
        total_calls: usage.total_calls,
        total_tokens: usage.total_tokens,
        per_app: usage.per_app,
      }));
    });

  // ── GET /v1/ai/settings ──
  router.get('/v1/ai/settings',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const prefsRecord = await storage.getMemory(gaii, 'openrouter.settings');
      const prefs = (prefsRecord?.value as Record<string, unknown>) ?? {};
      res.json(success(config.nodeId, {
        daily_budget_usd: getDailyBudgetUsd(prefs),
        app_quotas: (prefs.app_quotas as Record<string, unknown>) ?? {},
        app_allowlist: Array.isArray(prefs.app_allowlist) ? prefs.app_allowlist : null,
        defaults: {
          daily_budget_usd: DEFAULT_DAILY_BUDGET_USD,
          per_app_daily_usd: DEFAULT_APP_DAILY_USD,
          max_tokens_ceiling: null,
        },
      }));
    });

  // ── POST /v1/ai/settings ── update budget/quotas/allowlist
  router.post('/v1/ai/settings',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const { daily_budget_usd, app_quotas, app_allowlist } = req.body as {
        daily_budget_usd?: number;
        app_quotas?: Record<string, { daily_usd?: number }>;
        app_allowlist?: string[] | null;
      };
      const prefsRecord = await storage.getMemory(gaii, 'openrouter.settings');
      const prefs = { ...(prefsRecord?.value as Record<string, unknown> ?? {}) };
      if (typeof daily_budget_usd === 'number') {
        if (daily_budget_usd < 0 || daily_budget_usd > 1000) {
          return res.status(400).json(error(config.nodeId, 'INVALID_BUDGET', 'daily_budget_usd must be between 0 and 1000.'));
        }
        prefs.daily_budget_usd = daily_budget_usd;
      }
      if (app_quotas !== undefined) prefs.app_quotas = app_quotas;
      if (app_allowlist !== undefined) prefs.app_allowlist = app_allowlist;
      await upsertMemory(gaii, 'openrouter.settings', prefs, ['openrouter', 'settings']);
      res.json(success(config.nodeId, { saved: true }));
    });

  return router;
}
