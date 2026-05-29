/**
 * @file ai.ts
 * @description App-level AI completion endpoint. Sibling of /v1/openrouter/complete
 *   but without the project-id gate: any logged-in owner (or agent with `ai:use`
 *   scope) can call it from a sandboxed app or extension. Spend is bounded by:
 *     - per-user daily USD budget (default $1, configurable in
 *       openrouter.settings.daily_budget_usd)
 *     - optional per-app daily USD quota
 *       (openrouter.settings.app_quotas[app_id].daily_usd, default $0.10)
 *     - optional app allowlist (openrouter.settings.app_allowlist) — if set,
 *       only listed apps may call.
 *   The user's encrypted OpenRouter (or compatible) key from
 *   /v1/openrouter/settings is reused unchanged.
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
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../auth/middleware.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { decrypt, getEncryptionKey } from '../services/encryption.js';
import { logger } from '../utils/logger.js';
import { complete } from '../services/openrouter.js';

type ProviderType = 'openrouter' | 'lmstudio' | 'custom';
const DEFAULT_BASE_URLS: Record<ProviderType, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  lmstudio: 'http://localhost:1234/v1',
  custom: '',
};

/**
 * Rough cost estimate when the provider didn't report one (LM Studio, custom).
 * Claude Sonnet-ish pricing as a ceiling — apps relying on this exact number
 * are doing it wrong (the user's OpenRouter dashboard is authoritative).
 * Budgets exist to prevent runaways, not to bill.
 */
const FALLBACK_PROMPT_COST_PER_TOKEN = 0.000005;
const FALLBACK_COMPLETION_COST_PER_TOKEN = 0.000015;

/** Defaults applied when the user hasn't set explicit values. */
const DEFAULT_DAILY_BUDGET_USD = 1.0;
const DEFAULT_APP_DAILY_USD = 0.10;
// No hard server-side max_tokens ceiling: the user already controls cost via
// the daily USD budget + per-app quota, and capping tokens silently truncated
// long responses (e.g. translating a whole comic episode) which the model
// would then return as malformed JSON.

interface UsageRecord {
  /** ISO date key (YYYY-MM-DD). */
  date: string;
  total_cost_usd: number;
  total_calls: number;
  total_tokens: number;
  per_app: Record<string, { cost_usd: number; calls: number; tokens: number }>;
  updated_at: string;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function estimateCostUsd(promptTokens: number, completionTokens: number): number {
  return promptTokens * FALLBACK_PROMPT_COST_PER_TOKEN
    + completionTokens * FALLBACK_COMPLETION_COST_PER_TOKEN;
}

export function aiRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const resolve = (req: Request) => resolveIdentity(req.auth!, config.nodeId);
  // Reuse the openrouter rate limit bucket — same provider, same spend concerns.
  const aiRateLimit = rateLimit(config.rateLimits.openrouter);

  function requireEncryption(res: Response): Buffer | null {
    const key = getEncryptionKey(config);
    if (!key) {
      res.status(503).json(error(config.nodeId, 'ENCRYPTION_NOT_CONFIGURED',
        'Encryption key not configured. Set AIMEAT_ENCRYPTION_KEY or AIMEAT_TOTP_ENCRYPTION_KEY.'));
      return null;
    }
    return key;
  }

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

      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'prompt is required.'));
      }
      if (prompt.length > 200_000) {
        return res.status(400).json(error(config.nodeId, 'PROMPT_TOO_LONG', 'prompt exceeds 200k characters.'));
      }

      // ── Load settings + today's usage + decrypt key ──
      const [apiKeyRecord, prefsRecord, usageRecord] = await Promise.all([
        storage.getMemory(gaii, 'openrouter.apikey'),
        storage.getMemory(gaii, 'openrouter.settings'),
        storage.getMemory(gaii, `ai-usage.${gaii}.${todayKey()}`),
      ]);
      const prefs = (prefsRecord?.value as Record<string, unknown>) ?? {};
      const provider = (prefs.provider as ProviderType) || 'openrouter';
      const baseUrl = (prefs.baseUrl as string) || DEFAULT_BASE_URLS[provider];

      // ── App allowlist check (if configured) ──
      const allowlist = Array.isArray(prefs.app_allowlist) ? (prefs.app_allowlist as string[]) : null;
      if (allowlist && app_id && !allowlist.includes(app_id)) {
        return res.status(403).json(error(config.nodeId, 'APP_NOT_ALLOWED',
          `App "${app_id}" is not in your AI allowlist. Enable it from Settings.`));
      }
      if (allowlist && !app_id) {
        // If user has an allowlist but the call has no app_id, refuse — we
        // can't attribute it to anything they've approved.
        return res.status(403).json(error(config.nodeId, 'APP_ID_REQUIRED',
          'app_id is required because you have configured an AI app allowlist.'));
      }

      // ── Decrypt key (optional for non-openrouter providers) ──
      let decryptedKey: string | undefined;
      const encrypted = (apiKeyRecord?.value as { encrypted?: string } | undefined)?.encrypted;
      if (encrypted) {
        const encKey = requireEncryption(res);
        if (!encKey) return;
        decryptedKey = decrypt(encrypted, encKey);
      } else if (provider === 'openrouter') {
        return res.status(400).json(error(config.nodeId, 'NO_API_KEY',
          'No OpenRouter API key configured. Set one in Settings.'));
      }

      // ── Budget check ──
      const usage = (usageRecord?.value as UsageRecord | undefined) ?? {
        date: todayKey(), total_cost_usd: 0, total_calls: 0, total_tokens: 0,
        per_app: {}, updated_at: new Date().toISOString(),
      };
      const dailyBudget = typeof prefs.daily_budget_usd === 'number'
        ? prefs.daily_budget_usd
        : DEFAULT_DAILY_BUDGET_USD;
      if (usage.total_cost_usd >= dailyBudget) {
        return res.status(402).json(error(config.nodeId, 'QUOTA_EXHAUSTED',
          `Daily AI budget hit ($${usage.total_cost_usd.toFixed(4)} / $${dailyBudget}). Raise it in Settings or wait until midnight UTC.`));
      }
      // Per-app quota
      const appQuotas = (prefs.app_quotas as Record<string, { daily_usd?: number }> | undefined) ?? {};
      if (app_id) {
        const appQuota = appQuotas[app_id]?.daily_usd ?? DEFAULT_APP_DAILY_USD;
        const appSpent = usage.per_app[app_id]?.cost_usd ?? 0;
        if (appSpent >= appQuota) {
          return res.status(402).json(error(config.nodeId, 'APP_QUOTA_EXHAUSTED',
            `Daily AI quota for "${app_id}" hit ($${appSpent.toFixed(4)} / $${appQuota}). Raise it in Settings.`));
        }
      }

      // ── Model selection ──
      let selectedModel: string;
      if (typeof modelOverride === 'string' && modelOverride) {
        selectedModel = modelOverride;
      } else if (modelRole === 'reasoning' && prefs.reasoningModel) {
        selectedModel = prefs.reasoningModel as string;
      } else if (modelRole === 'execution' && prefs.executionModel) {
        selectedModel = prefs.executionModel as string;
      } else {
        selectedModel = (prefs.model as string)
          || (prefs.executionModel as string)
          || (prefs.reasoningModel as string)
          || 'anthropic/claude-sonnet-4';
      }

      // Pass max_tokens through unchanged when set. Most apps should leave it
      // unset so the model picks its own ceiling (budget is the real guardrail).
      const options = {
        temperature: temperature ?? (typeof prefs.temperature === 'number' ? prefs.temperature : undefined),
        top_p: top_p ?? (typeof prefs.top_p === 'number' ? prefs.top_p : undefined),
        max_tokens: typeof max_tokens === 'number' && max_tokens > 0
          ? (max_tokens | 0)
          : (typeof prefs.max_tokens === 'number' ? (prefs.max_tokens as number) : undefined),
      };

      try {
        const result = await complete(decryptedKey, selectedModel, prompt, systemPrompt, baseUrl, options);
        const promptTok = result.usage?.prompt_tokens ?? 0;
        const completionTok = result.usage?.completion_tokens ?? 0;
        const totalTok = result.usage?.total_tokens ?? (promptTok + completionTok);
        const costUsd = typeof result.usage?.cost_usd === 'number'
          ? result.usage.cost_usd
          : estimateCostUsd(promptTok, completionTok);

        // ── Record usage (idempotent within the day) ──
        const updated: UsageRecord = {
          date: todayKey(),
          total_cost_usd: usage.total_cost_usd + costUsd,
          total_calls: usage.total_calls + 1,
          total_tokens: usage.total_tokens + totalTok,
          per_app: { ...usage.per_app },
          updated_at: new Date().toISOString(),
        };
        const appKey = app_id || '_unknown';
        const existing = updated.per_app[appKey] ?? { cost_usd: 0, calls: 0, tokens: 0 };
        updated.per_app[appKey] = {
          cost_usd: existing.cost_usd + costUsd,
          calls: existing.calls + 1,
          tokens: existing.tokens + totalTok,
        };
        await upsertMemory(gaii, `ai-usage.${gaii}.${todayKey()}`, updated, ['ai', 'usage']);

        logger.info(`[ai] gaii=${gaii} app=${app_id ?? '_unknown'} model=${result.model} tokens=${totalTok} cost=$${costUsd.toFixed(4)} day_total=$${updated.total_cost_usd.toFixed(4)}`);

        res.json(success(config.nodeId, {
          content: result.content,
          model: result.model,
          usage: {
            prompt_tokens: promptTok,
            completion_tokens: completionTok,
            total_tokens: totalTok,
            cost_usd: costUsd,
            cost_exact: typeof result.usage?.cost_usd === 'number',
          },
          budget: {
            daily_budget_usd: dailyBudget,
            spent_today_usd: updated.total_cost_usd,
            remaining_usd: Math.max(0, dailyBudget - updated.total_cost_usd),
          },
        }));
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 401) {
          return res.status(401).json(error(config.nodeId, 'INVALID_API_KEY', 'API key was rejected by the provider.'));
        }
        if (status === 429) {
          return res.status(429).json(error(config.nodeId, 'RATE_LIMITED', 'Provider rate limit hit. Try again later.'));
        }
        return res.status(502).json(error(config.nodeId, 'PROVIDER_ERROR', (e as Error).message));
      }
    });

  // ── GET /v1/ai/usage ── today's spend breakdown
  router.get('/v1/ai/usage',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const gaii = resolve(req);
      const rec = await storage.getMemory(gaii, `ai-usage.${gaii}.${todayKey()}`);
      const usage = (rec?.value as UsageRecord | undefined) ?? {
        date: todayKey(), total_cost_usd: 0, total_calls: 0, total_tokens: 0, per_app: {}, updated_at: new Date().toISOString(),
      };
      const prefsRecord = await storage.getMemory(gaii, 'openrouter.settings');
      const prefs = (prefsRecord?.value as Record<string, unknown>) ?? {};
      const dailyBudget = typeof prefs.daily_budget_usd === 'number'
        ? prefs.daily_budget_usd
        : DEFAULT_DAILY_BUDGET_USD;
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
        daily_budget_usd: typeof prefs.daily_budget_usd === 'number' ? prefs.daily_budget_usd : DEFAULT_DAILY_BUDGET_USD,
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
