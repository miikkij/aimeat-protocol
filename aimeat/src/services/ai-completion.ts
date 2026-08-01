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
 *   - getUsageHistory(storage, gaii, days) — per-day series + 24h/7d/30d rollups (charts)
 *   - getDailyBudgetUsd(prefs) / todayKey() — small shared helpers
 *   - AiCompletionError — typed error carrying { code, status } for the route
 * @usage
 *   import { completeForOwner, AiCompletionError } from '../services/ai-completion.js';
 *   const r = await completeForOwner(storage, config, gaii, { prompt });
 * @version-history
 *   v1.0.0 — 2026-06-03 — Extracted from routes/ai.ts for reuse by the scheduler
 *   v1.1.0 — 2026-06-24 — Optional `images` (data:/https URLs) threaded to the
 *     provider for vision-capable completions (used by the Secretary doc/image
 *     intake). Text-only callers are unaffected.
 *   v1.2.0 — 2026-06-24 — When a request carries images, prefer the owner's
 *     configured `visionModel` (e.g. qwen-2.5-VL) over the (possibly text-only)
 *     default, so image intake works without an explicit model override.
 *   v1.3.0 — 2026-07-01 — Vendor-neutral default: replace the hardcoded anthropic/claude-sonnet-4
 *     fallback with OpenRouter's free-models router 'openrouter/free' (no specific vendor hardcoded).
 *   v1.4.0 — 2026-07-05 — Per-app quota default is now the owner's daily budget, not a separate
 *     hidden $0.10 cap. "AI apps daily budget" IS what an app may spend; a per-app override in
 *     app_quotas throttles a single app below it when wanted. Removed DEFAULT_APP_DAILY_USD.
 *   v1.5.0 — 2026-07-05 — Add getUsageHistory(): reads back the retained per-day usage records
 *     (never surfaced before) as a series + 24h/7d/30d rollups for the AI-spend charts.
 *   v1.7.0 — 2026-08-01 — Mint an AI provenance record for every completion (TARGET-058). This is
 *     THE mint point for observed generation: the node saw the model produce these exact bytes, so it
 *     stamps observed:true with the model, provider, principal, node id, timestamp and content hash.
 *     The result gains an OPTIONAL `provenance` — every existing caller keeps working unchanged.
 *   v1.6.0 — 2026-07-10 — Enforce config.aiProviderAllowlist: on a public node, a decrypted AI key
 *     may only be sent to an allowlisted provider host, so a poisoned owner/app baseUrl can't
 *     exfiltrate it. Empty allowlist = any host (unchanged default).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { decrypt, getEncryptionKey } from './encryption.js';
import { complete, DEFAULT_BASE_URLS, type ProviderType } from './openrouter.js';
import { mintProvenance } from './ai-provenance.js';
import type { AiProvenanceRecordRow } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

/**
 * Rough cost estimate when the provider didn't report one (LM Studio, custom).
 * The user's OpenRouter dashboard is authoritative — budgets exist to prevent
 * runaways, not to bill.
 */
const FALLBACK_PROMPT_COST_PER_TOKEN = 0.000005;
const FALLBACK_COMPLETION_COST_PER_TOKEN = 0.000015;

/** Default applied when the owner hasn't set an explicit daily budget. A per-app cap defaults to
 *  this same budget (an app may spend the whole "AI apps daily budget"); set app_quotas.<app> to
 *  throttle a single app below it. */
export const DEFAULT_DAILY_BUDGET_USD = 1.0;

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
  /** Optional image attachments (data: or https URLs) for vision-capable models. */
  images?: string[];
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
  /**
   * The provenance record minted for THIS completion (TARGET-058). Optional so no existing caller
   * breaks, and absent when AIMEAT_AI_PROVENANCE is off or minting failed — a failure to record
   * must never fail a completion the owner has already paid for.
   *
   * `id` resolves at GET /v1/provenance/:id and `record.attestation.contentHash` is the SHA-256 of
   * `content`, which is what the public hash lookup is keyed on.
   */
  provenance?: AiProvenanceRecordRow;
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

/** A rolled-up spend window (today / 7d / 30d) — same per-app shape as a day, summed. */
export interface UsageWindow {
  cost_usd: number;
  tokens: number;
  calls: number;
  per_app: Record<string, { cost_usd: number; tokens: number; calls: number }>;
}

export interface UsageHistory {
  /** Per-day series, oldest → newest, limited to the last `days` retained records. */
  days: UsageRecord[];
  /** Distinct app ids across the returned series, ordered by spend (desc) — stable chart series order. */
  apps: string[];
  /** Rollups: d1 = today's UTC bucket, d7/d30 = trailing 7/30 calendar days. */
  windows: { d1: UsageWindow; d7: UsageWindow; d30: UsageWindow };
}

const emptyWindow = (): UsageWindow => ({ cost_usd: 0, tokens: 0, calls: 0, per_app: {} });

function accumulateWindow(win: UsageWindow, rec: UsageRecord): void {
  win.cost_usd += rec.total_cost_usd || 0;
  win.tokens += rec.total_tokens || 0;
  win.calls += rec.total_calls || 0;
  for (const [app, m] of Object.entries(rec.per_app || {})) {
    const cur = win.per_app[app] ?? (win.per_app[app] = { cost_usd: 0, tokens: 0, calls: 0 });
    cur.cost_usd += m.cost_usd || 0;
    cur.tokens += m.tokens || 0;
    cur.calls += m.calls || 0;
  }
}

/**
 * Read an owner's AI-spend history. Every completion persists one `ai-usage.<gaii>.<day>` record
 * (retained forever, ttlHours:null); this fans the prefix into a per-day series plus 24h/7d/30d
 * rollups for the profile home card and the Generator time-series chart. UTC-day granularity —
 * no intra-day data (see /v1/ai/usage for the live "today" number the budget bar uses).
 */
export async function getUsageHistory(storage: Storage, gaii: string, days = 30): Promise<UsageHistory> {
  const records = await storage.listMemory(gaii, { prefix: `ai-usage.${gaii}.` });
  const sorted = records
    .map((r) => r.value as UsageRecord)
    .filter((v): v is UsageRecord => !!v && typeof v.date === 'string')
    .sort((a, b) => a.date.localeCompare(b.date));

  const clampDays = Math.min(Math.max(Math.trunc(days) || 30, 1), 365);
  const series = sorted.slice(-clampDays);

  const today = todayKey();
  const cutoff = (n: number) => new Date(Date.now() - (n - 1) * 86_400_000).toISOString().slice(0, 10);
  const d7cut = cutoff(7);
  const d30cut = cutoff(30);

  const windows = { d1: emptyWindow(), d7: emptyWindow(), d30: emptyWindow() };
  for (const rec of sorted) {
    if (rec.date === today) accumulateWindow(windows.d1, rec);
    if (rec.date >= d7cut) accumulateWindow(windows.d7, rec);
    if (rec.date >= d30cut) accumulateWindow(windows.d30, rec);
  }

  // App ordering derived from the CHARTED series so every dataset has a day to land on.
  const appSpend: Record<string, number> = {};
  for (const rec of series) {
    for (const [app, m] of Object.entries(rec.per_app || {})) {
      appSpend[app] = (appSpend[app] || 0) + (m.cost_usd || 0);
    }
  }
  const apps = Object.keys(appSpend).sort((a, b) => appSpend[b] - appSpend[a]);

  return { days: series, apps, windows };
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

  // ── Provider host allowlist (protects the decrypted key from a poisoned baseUrl) ──
  // On a public multi-tenant node, config.aiProviderAllowlist restricts which HOST a decrypted AI
  // key may be sent to, so an owner- (or app-) supplied baseUrl can't exfiltrate it. Empty = any
  // host (local dev / self-hosted models). See docs/coding-guidelines/security-development-dna.md.
  if (config.aiProviderAllowlist.length > 0) {
    let providerHost: string;
    try { providerHost = new URL(baseUrl).hostname.toLowerCase(); }
    catch { throw new AiCompletionError('INVALID_BASE_URL', 400, `Invalid AI provider baseUrl: ${baseUrl}`); }
    if (!config.aiProviderAllowlist.includes(providerHost)) {
      throw new AiCompletionError('PROVIDER_NOT_ALLOWED', 403,
        `AI provider host "${providerHost}" is not in this node's allowlist. Ask the operator to allow it.`);
    }
  }

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
    // Per-app cap. By DEFAULT an app may spend the whole daily budget the owner set (the "AI apps
    // daily budget") — there is no separate hidden per-app default. An explicit app_quotas.<app>
    // override throttles that one app below the budget when the owner wants it.
    const appQuota = appQuotas[opts.appId]?.daily_usd ?? dailyBudget;
    const appSpent = usage.per_app[opts.appId]?.cost_usd ?? 0;
    if (appSpent >= appQuota) {
      throw new AiCompletionError('APP_QUOTA_EXHAUSTED', 402,
        `Daily AI quota for "${opts.appId}" hit ($${appSpent.toFixed(4)} / $${appQuota}). Raise it in Settings.`);
    }
  }

  // ── Model selection ──
  const hasImages = Array.isArray(opts.images) && opts.images.length > 0;
  let selectedModel: string;
  if (typeof opts.model === 'string' && opts.model) {
    selectedModel = opts.model;
  } else if (hasImages && typeof prefs.visionModel === 'string' && prefs.visionModel) {
    // Image inputs need a vision-capable model — the owner's default may be text-only. Use the
    // configured visionModel (e.g. qwen-2.5-VL) for any request carrying images.
    selectedModel = prefs.visionModel as string;
  } else if (opts.modelRole === 'reasoning' && prefs.reasoningModel) {
    selectedModel = prefs.reasoningModel as string;
  } else if (opts.modelRole === 'execution' && prefs.executionModel) {
    selectedModel = prefs.executionModel as string;
  } else {
    selectedModel = (prefs.model as string)
      || (prefs.executionModel as string)
      || (prefs.reasoningModel as string)
      // Vendor-neutral default: OpenRouter's free-models router (no specific vendor hardcoded).
      || 'openrouter/free';
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
    result = await complete(decryptedKey, selectedModel, opts.prompt, opts.systemPrompt, baseUrl, options, opts.images);
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

  // ── Mint the provenance record (TARGET-058) ──
  // THE mint point for an observed generation. The node just watched a model produce these exact
  // bytes, so it stamps what it saw: stampedBy 'node', observed true, model, provider, principal,
  // node id, timestamp and the content hash. Minting is MAXIMAL — none of that is optional here,
  // because a thin record is a record that cannot answer a question later.
  //
  // Level is `ai-generated` with `humanInvolvement: 'none'`: at this instant nobody has read the
  // substance, whatever happens downstream. A publisher who later reviews it declares that at
  // publication (an attributable act) — the node never infers editorial control on anyone's behalf.
  //
  // The record is not resolvable by anyone yet, and nothing here decides that. Provenance
  // visibility FOLLOWS THE CONTENT: this record becomes publicly resolvable exactly when the owner
  // attaches it to something public, and goes back to a 404 when they unpublish. A completion is
  // the owner's own until then.
  let provenance: AiProvenanceRecordRow | undefined;
  if (config.aiProvenance) {
    try {
      provenance = await mintProvenance(storage, {
        stampedBy: 'node',
        ownerGhii: gaii,
        principal: gaii,
        level: 'ai-generated',
        humanInvolvement: 'none',
        method: 'fully-generated',
        content: result.content,
        generator: {
          model: result.model,
          provider,
          pipeline: opts.appId,
          // What the model VENDOR does about marking is not something we can observe from here.
          // `unknown` is the honest answer, and it is never silently upgraded to 'yes'.
          upstreamMarks: 'unknown',
        },
        labelPolicy: config.aiLabelPublic,
        nodeId: config.nodeId,
        baseUrl: config.baseUrl,
      });
    } catch (err) {
      // A completion the owner has already paid for must not fail because bookkeeping did. Logged
      // rather than swallowed: an operator who sees this knows generated content is going out
      // unrecorded, which is exactly the thing they would want to fix.
      logger.warn(`[ai] provenance mint failed for gaii=${gaii} model=${result.model}: ${(err as Error).message}`);
    }
  }

  return {
    content: result.content,
    model: result.model,
    usage: { promptTokens: promptTok, completionTokens: completionTok, totalTokens: totalTok, costUsd, costExact },
    budget: {
      dailyBudgetUsd: dailyBudget,
      spentTodayUsd: updated.total_cost_usd,
      remainingUsd: Math.max(0, dailyBudget - updated.total_cost_usd),
    },
    provenance,
  };
}
