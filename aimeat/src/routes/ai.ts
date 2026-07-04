/**
 * @file ai.ts
 * @description App-level AI completion endpoint. Sibling of /v1/openrouter/complete
 *   but without the project-id gate: any logged-in owner (or agent with `ai:use`
 *   scope) can call it from a sandboxed app or extension. The actual completion,
 *   budget enforcement, key decrypt, and usage accounting live in the shared
 *   services/ai-completion.ts module (also used by the scheduler's `ai` jobs);
 *   this router is a thin HTTP wrapper + the owner-only settings/usage endpoints.
 * @structure
 *   - POST /v1/ai/complete   — owner or any token with ai:use scope, runs one completion
 *   - GET  /v1/ai/available  — owner or ai:use token, boolean "is AI configured?" probe
 *   - GET  /v1/ai/usage      — owner-only, today's spend per-app breakdown
 *   - POST /v1/ai/settings   — owner-only, update budget/quotas/allowlist
 *   - GET  /v1/ai/settings   — owner-only, read budget/quotas/allowlist
 * @usage
 *   import { aiRouter } from './routes/ai.js';
 *   app.use(aiRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-05-29 — Initial: app-level AI calls with budget enforcement
 *   v1.1.0 — 2026-06-03 — Delegate completion to services/ai-completion.ts (shared
 *     with the scheduler); route is now a thin wrapper.
 *   v1.2.0 — 2026-06-24 — Accept an optional `images` array (data:/https URLs) on
 *     /v1/ai/complete for vision-capable models (Secretary doc/image intake).
 *   v1.3.0 — 2026-06-25 — Gate is role-agnostic on the ai:use scope so app-grant tokens
 *     (sandboxed apps on the isolated app origin) can spend the owner's AI budget; add
 *     GET /v1/ai/available so such apps can gate their UI without owner-only settings.
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
  DEFAULT_DAILY_BUDGET_USD,
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
   * Either the caller is an owner JWT (role=owner) OR any scoped principal
   * (agent JWT, or an app-grant token from a sandboxed app) carrying the
   * `ai:use` scope. The scope check is role-agnostic so a browser app running
   * on the isolated app origin — which holds an app-grant token (role 'app'),
   * never an owner session — can still spend the owner's AI budget once the
   * owner granted `ai:use`. Reject anything else.
   */
  function gateOwnerOrAiUseAgent(req: Request, res: Response): boolean {
    const roles = req.auth?.roles ?? [];
    if (roles.includes('owner')) return true;
    const scopes = (req.auth as { scopes?: string[] } | undefined)?.scopes ?? [];
    if (scopes.includes('ai:use') || scopes.includes('*')) return true;
    res.status(403).json(error(config.nodeId, 'FORBIDDEN',
      'AI completion requires an owner session or a token with the ai:use scope.'));
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
        temperature, top_p, max_tokens, app_id, images,
      } = req.body as {
        prompt?: string; systemPrompt?: string; model?: string;
        modelRole?: 'reasoning' | 'execution';
        temperature?: number; top_p?: number; max_tokens?: number;
        app_id?: string; images?: string[];
      };

      // Bound the image payload (vision attachments) — keep a runaway request from ballooning.
      let imageList: string[] | undefined;
      if (images !== undefined) {
        if (!Array.isArray(images) || images.some((u) => typeof u !== 'string')) {
          return res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'images must be an array of URL strings.'));
        }
        if (images.length > 8) {
          return res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'images: at most 8 attachments per request.'));
        }
        imageList = images.filter((u) => u.length > 0);
      }

      try {
        const r = await completeForOwner(storage, config, gaii, {
          prompt: prompt as string, systemPrompt, model: modelOverride, modelRole,
          temperature, topP: top_p, maxTokens: max_tokens, appId: app_id, images: imageList,
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

  // ── GET /v1/ai/available ── lightweight "can I run AI?" probe.
  // Owner-only `/v1/ai/settings` (which exposes hasApiKey) is NOT reachable by an app-grant
  // token, so a sandboxed app cannot use it to decide whether to show its AI affordances. This
  // endpoint answers just the boolean, gated identically to /complete (owner OR ai:use scope), so
  // an app can gate its UI without owner privileges. Resolves the owner from the caller's identity
  // (app tokens resolve to the owner GHII), matching the key completeForOwner will actually read.
  router.get('/v1/ai/available',
    requireAuth(), aiRateLimit,
    async (req: Request, res: Response) => {
      if (!gateOwnerOrAiUseAgent(req, res)) return;
      const gaii = resolve(req);
      const [apiKeyRecord, prefsRecord] = await Promise.all([
        storage.getMemory(gaii, 'openrouter.apikey'),
        storage.getMemory(gaii, 'openrouter.settings'),
      ]);
      const encrypted = (apiKeyRecord?.value as { encrypted?: string } | undefined)?.encrypted;
      const provider = ((prefsRecord?.value as Record<string, unknown> | undefined)?.provider as string) || 'openrouter';
      // openrouter needs a key; self-hosted providers (lmstudio/custom) can run keyless.
      const available = !!encrypted || provider !== 'openrouter';
      res.json(success(config.nodeId, { available }));
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
          // null = an app defaults to the whole daily budget; app_quotas.<app> overrides it.
          per_app_daily_usd: null,
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
