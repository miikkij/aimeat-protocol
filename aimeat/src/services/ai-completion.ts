/**
 * @file ai-completion.ts
 * @description Reusable server-side AI completion for a single owner, using the
 *   owner's encrypted OpenRouter (or compatible) key + budget settings stored in
 *   memory. Extracted from routes/ai.ts so both the HTTP route (/v1/ai/complete)
 *   and the scheduler's `ai`-kind jobs share ONE code path: key decrypt, model
 *   selection, daily-budget + per-app-quota enforcement, provider call, and
 *   per-day usage accounting (ai-usage.<gaii>.<day>). The scheduler's daily_limit
 *   constraint reads the same usage record via getTodayUsage().
 * @structure
 *   - completeForOwner(storage, config, gaii, opts) — runs one completion
 *   - getTodayUsage(storage, gaii) — read today's spend record (constraints/UI)
 *   - getDailyBudgetUsd(prefs) / todayKey() — small shared helpers
 *   - AiCompletionError — typed error carrying { code, status } for the route
 * @usage
 *   import { completeForOwner, AiCompletionError } from '../services/ai-completion.js';
 *   const r = await completeForOwner(storage, config, gaii, { prompt });
 * @version-history
 *   v1.0.0 — 2026-06-03 — Extracted from routes/ai.ts for reuse by the scheduler
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { decrypt, getEncryptionKey } from './encryption.js';
import { complete } from './openrouter.js';
import { logger } from '../utils/logger.js';

type ProviderType = 'openrouter' | 'lmstudio' | 'custom';
const DEFAULT_BASE_URLS: Record<ProviderType, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  lmstudio: 'http://localhost:1234/v1',
  custom: '',
};

/**
 * Rough cost estimate when the provider didn't report one (LM Studio, custom).
 * The user's OpenRouter dashboard is authoritative — budgets exist to prevent
 * runaways, not to bill.
 */
const FALLBACK_PROMPT_COST_PER_TOKEN = 0.000005;
const FALLBACK_COMPLETION_COST_PER_TOKEN = 0.000015;

/** Defaults applied when the user hasn't set explicit values. */
export const DEFAULT_DAILY_BUDGET_USD = 1.0;
export const DEFAULT_APP_DAILY_USD = 0.10;

export interface UsageRecord {
  /** ISO date key (YYYY-MM-DD). */
  date: string;
  total_cost_usd: number;
  total_calls: number;
  total_tokens: number;
  per_app: Record<string, { cost_usd: number; calls: number; tokens: number }>;
  updated_at: string;
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function estimateCostUsd(promptTokens: number, completionTokens: number): number {
  return promptTokens * FALLBACK_PROMPT_COST_PER_TOKEN
    + completionTokens * FALLBACK_COMPLETION_COST_PER_TOKEN;
}

export function getDailyBudgetUsd(prefs: Record<string, unknown>): number {
  return typeof prefs.daily_budget_usd === 'number' ? prefs.daily_budget_usd : DEFAULT_DAILY_BUDGET_USD;
}

/** Typed error so the HTTP route can map to a status/code and the scheduler can log it. */
export class AiCompletionError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'AiCompletionError';
    this.code = code;
    this.status = status;
  }
}

export interface CompleteForOwnerOptions {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  modelRole?: 'reasoning' | 'execution';
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  /** Optional app/source attribution — enables allowlist + per-app quota. */
  appId?: string;
}

export interface CompleteForOwnerResult {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    costExact: boolean;
  };
  budget: {
    dailyBudgetUsd: number;
    spentTodayUsd: number;
    remainingUsd: number;
  };
}

const emptyUsage = (): UsageRecord => ({
  date: todayKey(), total_cost_usd: 0, total_calls: 0, total_tokens: 0,
  per_app: {}, updated_at: new Date().toISOString(),
});

/** Read today's usage record for an owner (used by the daily_limit constraint + the usage route). */
export async function getTodayUsage(storage: Storage, gaii: string): Promise<UsageRecord> {
  const rec = await storage.getMemory(gaii, `ai-usage.${gaii}.${todayKey()}`);
  return (rec?.value as UsageRecord | undefined) ?? emptyUsage();
}

async function upsertUsage(storage: Storage, gaii: string, value: UsageRecord): Promise<void> {
  const key = `ai-usage.${gaii}.${todayKey()}`;
  const existing = await storage.getMemory(gaii, key);
  const now = new Date().toISOString();
  await storage.setMemory({
    key, ownerGaii: gaii, value, visibility: 'private', tags: ['ai', 'usage'],
    ttlHours: null,
    version: existing ? existing.version + 1 : 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

/**
 * Run one AI completion on behalf of an owner. Loads the owner's key + budget
 * settings, enforces the daily budget (and per-app quota/allowlist if appId is
 * given), calls the provider, and records usage. Throws AiCompletionError on any
 * gated/failure condition.
 */
export async function completeForOwner(
  storage: Storage,
  config: AimeatConfig,
  gaii: string,
  opts: CompleteForOwnerOptions,
): Promise<CompleteForOwnerResult> {
  if (!opts.prompt || typeof opts.prompt !== 'string') {
    throw new AiCompletionError('INVALID_BODY', 400, 'prompt is required.');
  }
  if (opts.prompt.length > 200_000) {
    throw new AiCompletionError('PROMPT_TOO_LONG', 400, 'prompt exceeds 200k characters.');
  }

  const [apiKeyRecord, prefsRecord, usageRecord] = await Promise.all([
    storage.getMemory(gaii, 'openrouter.apikey'),
    storage.getMemory(gaii, 'openrouter.settings'),
    storage.getMemory(gaii, `ai-usage.${gaii}.${todayKey()}`),
  ]);
  const prefs = (prefsRecord?.value as Record<string, unknown>) ?? {};
  const provider = (prefs.provider as ProviderType) || 'openrouter';
  const baseUrl = (prefs.baseUrl as string) || DEFAULT_BASE_URLS[provider];

  // ── App allowlist (only when an appId is supplied / configured) ──
  const allowlist = Array.isArray(prefs.app_allowlist) ? (prefs.app_allowlist as string[]) : null;
  if (allowlist && opts.appId && !allowlist.includes(opts.appId)) {
    throw new AiCompletionError('APP_NOT_ALLOWED', 403,
      `App "${opts.appId}" is not in your AI allowlist. Enable it from Settings.`);
  }
  if (allowlist && !opts.appId) {
    throw new AiCompletionError('APP_ID_REQUIRED', 403,
      'app_id is required because you have configured an AI app allowlist.');
  }

  // ── Decrypt key (optional for non-openrouter providers) ──
  let decryptedKey: string | undefined;
  const encrypted = (apiKeyRecord?.value as { encrypted?: string } | undefined)?.encrypted;
  if (encrypted) {
    const encKey = getEncryptionKey(config);
    if (!encKey) {
      throw new AiCompletionError('ENCRYPTION_NOT_CONFIGURED', 503,
        'Encryption key not configured. Set AIMEAT_ENCRYPTION_KEY or AIMEAT_TOTP_ENCRYPTION_KEY.');
    }
    decryptedKey = decrypt(encrypted, encKey);
  } else if (provider === 'openrouter') {
    throw new AiCompletionError('NO_API_KEY', 400,
      'No OpenRouter API key configured. Set one in Settings.');
  }

  // ── Budget check ──
  const usage = (usageRecord?.value as UsageRecord | undefined) ?? emptyUsage();
  const dailyBudget = getDailyBudgetUsd(prefs);
  if (usage.total_cost_usd >= dailyBudget) {
    throw new AiCompletionError('QUOTA_EXHAUSTED', 402,
      `Daily AI budget hit ($${usage.total_cost_usd.toFixed(4)} / $${dailyBudget}). Raise it in Settings or wait until midnight UTC.`);
  }
  const appQuotas = (prefs.app_quotas as Record<string, { daily_usd?: number }> | undefined) ?? {};
  if (opts.appId) {
    const appQuota = appQuotas[opts.appId]?.daily_usd ?? DEFAULT_APP_DAILY_USD;
    const appSpent = usage.per_app[opts.appId]?.cost_usd ?? 0;
    if (appSpent >= appQuota) {
      throw new AiCompletionError('APP_QUOTA_EXHAUSTED', 402,
        `Daily AI quota for "${opts.appId}" hit ($${appSpent.toFixed(4)} / $${appQuota}). Raise it in Settings.`);
    }
  }

  // ── Model selection ──
  let selectedModel: string;
  if (typeof opts.model === 'string' && opts.model) {
    selectedModel = opts.model;
  } else if (opts.modelRole === 'reasoning' && prefs.reasoningModel) {
    selectedModel = prefs.reasoningModel as string;
  } else if (opts.modelRole === 'execution' && prefs.executionModel) {
    selectedModel = prefs.executionModel as string;
  } else {
    selectedModel = (prefs.model as string)
      || (prefs.executionModel as string)
      || (prefs.reasoningModel as string)
      || 'anthropic/claude-sonnet-4';
  }

  const options = {
    temperature: opts.temperature ?? (typeof prefs.temperature === 'number' ? prefs.temperature : undefined),
    top_p: opts.topP ?? (typeof prefs.top_p === 'number' ? prefs.top_p : undefined),
    max_tokens: typeof opts.maxTokens === 'number' && opts.maxTokens > 0
      ? (opts.maxTokens | 0)
      : (typeof prefs.max_tokens === 'number' ? (prefs.max_tokens as number) : undefined),
  };

  let result;
  try {
    result = await complete(decryptedKey, selectedModel, opts.prompt, opts.systemPrompt, baseUrl, options);
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401) throw new AiCompletionError('INVALID_API_KEY', 401, 'API key was rejected by the provider.');
    if (status === 429) throw new AiCompletionError('RATE_LIMITED', 429, 'Provider rate limit hit. Try again later.');
    throw new AiCompletionError('PROVIDER_ERROR', 502, (e as Error).message);
  }

  const promptTok = result.usage?.prompt_tokens ?? 0;
  const completionTok = result.usage?.completion_tokens ?? 0;
  const totalTok = result.usage?.total_tokens ?? (promptTok + completionTok);
  const costExact = typeof result.usage?.cost_usd === 'number';
  const costUsd = costExact ? result.usage!.cost_usd! : estimateCostUsd(promptTok, completionTok);

  // ── Record usage (idempotent within the day) ──
  const updated: UsageRecord = {
    date: todayKey(),
    total_cost_usd: usage.total_cost_usd + costUsd,
    total_calls: usage.total_calls + 1,
    total_tokens: usage.total_tokens + totalTok,
    per_app: { ...usage.per_app },
    updated_at: new Date().toISOString(),
  };
  const appKey = opts.appId || '_unknown';
  const existing = updated.per_app[appKey] ?? { cost_usd: 0, calls: 0, tokens: 0 };
  updated.per_app[appKey] = {
    cost_usd: existing.cost_usd + costUsd,
    calls: existing.calls + 1,
    tokens: existing.tokens + totalTok,
  };
  await upsertUsage(storage, gaii, updated);

  logger.info(`[ai] gaii=${gaii} app=${appKey} model=${result.model} tokens=${totalTok} cost=$${costUsd.toFixed(4)} day_total=$${updated.total_cost_usd.toFixed(4)}`);

  return {
    content: result.content,
    model: result.model,
    usage: { promptTokens: promptTok, completionTokens: completionTok, totalTokens: totalTok, costUsd, costExact },
    budget: {
      dailyBudgetUsd: dailyBudget,
      spentTodayUsd: updated.total_cost_usd,
      remainingUsd: Math.max(0, dailyBudget - updated.total_cost_usd),
    },
  };
}
