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
 *   - assertProviderAllowed / assertAppAllowed / decryptOwnerKey / assertWithinBudget / recordAiUsage
 *     — the shared gate every owner-billed provider call runs through (see ai-transcription.ts)
 *   - AiCompletionError — typed error carrying { code, status } for the route
 * @usage
 *   import { completeForOwner, AiCompletionError } from '../services/ai-completion.js';
 *   const r = await completeForOwner(storage, config, gaii, { prompt });
 * @version-history
 *   v3.0.0 — 2026-08-16 — The decision and the bookkeeping are their own functions, prepareAiCall
 *     and settleAiCall, and completeForOwner runs both. Nothing changed about what either does; the
 *     chat proxy needs the same key choice, the same budget gate, the same free-model fallback and
 *     the same usage record, and the alternative was a second implementation of all four on the
 *     door that spends the most money.
 *   v1.x — 2026-08-16 — Which key pays is decided in services/ai-allowance.ts: the person's own,
 *     then the node's if they have allowance left. `apiKeyScope` stops being hardcoded to 'own' —
 *     it was hardcoded because before the node had a key of its own there was only one possible
 *     answer. A node-key caller whose allowance is spent gets a free model and is TOLD so
 *     (degradedToFreeModel), rather than a dead end; an explicit model override is left alone,
 *     because a caller that named a model is not asking the node to choose.
 *   v1.x — 2026-08-16 — Model selection asks the node as well as the owner, per role, through
 *     services/ai-model-defaults.ts. A node that pays for its own inference can now name a model
 *     for a person who has chosen none. Inert until an operator sets one: with the environment
 *     untouched every branch resolves exactly as it did before.
 *   v1.8.0 — 2026-08-01 — Speech-to-text groundwork: the preflight (provider allowlist, app
 *     allowlist, key decrypt, budget) and the usage write are now exported helpers, so
 *     ai-transcription.ts runs the IDENTICAL gate instead of a second copy that could drift — this
 *     is the path that decides where a decrypted key goes. UsageRecord gains optional
 *     `audio_seconds` (missing = 0 on every old record), so STT shares one budget and one chart
 *     with text. completeForOwner behaviour is unchanged.
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
import { resolveModelFor, type ModelRole } from './ai-model-defaults.js';
import { resolveAiKey, debitAllowance } from './ai-allowance.js';
import { recordUsageEvent } from './usage-metering.js';
import { recordAccountEvent } from './account-events.js';

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
  /** Audio seconds transcribed today. Optional: records written before speech-to-text existed do not
   *  have it, and every reader treats a missing value as 0. */
  audio_seconds?: number;
  per_app: Record<string, { cost_usd: number; calls: number; tokens: number; audio_seconds?: number }>;
  updated_at: string;
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The fallback when the provider does not report a cost. Exported so the chat proxy uses the same
 *  arithmetic rather than a second guess at what a turn was worth. */
export function estimateCostUsd(promptTokens: number, completionTokens: number): number {
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

/**
 * Provider host allowlist — the guard that stands between a decrypted AI key and wherever an
 * owner- (or app-) supplied baseUrl points.
 *
 * On a public multi-tenant node `config.aiProviderAllowlist` restricts which HOST the key may be
 * sent to, so a poisoned baseUrl cannot exfiltrate it. Empty = any host (local dev, self-hosted
 * models). Exported because EVERY path that decrypts a key must run it, and one shared function is
 * how that invariant stays true as paths are added. See docs/coding-guidelines/security-development-dna.md.
 */
export function assertProviderAllowed(config: AimeatConfig, baseUrl: string): void {
  if (config.aiProviderAllowlist.length === 0) return;
  let providerHost: string;
  try { providerHost = new URL(baseUrl).hostname.toLowerCase(); }
  catch { throw new AiCompletionError('INVALID_BASE_URL', 400, `Invalid AI provider baseUrl: ${baseUrl}`); }
  if (!config.aiProviderAllowlist.includes(providerHost)) {
    throw new AiCompletionError('PROVIDER_NOT_ALLOWED', 403,
      `AI provider host "${providerHost}" is not in this node's allowlist. Ask the operator to allow it.`);
  }
}

/** The owner's per-app allowlist (only meaningful once they configured one). */
export function assertAppAllowed(prefs: Record<string, unknown>, appId?: string): void {
  const allowlist = Array.isArray(prefs.app_allowlist) ? (prefs.app_allowlist as string[]) : null;
  if (!allowlist) return;
  if (appId && !allowlist.includes(appId)) {
    throw new AiCompletionError('APP_NOT_ALLOWED', 403,
      `App "${appId}" is not in your AI allowlist. Enable it from Settings.`);
  }
  if (!appId) {
    throw new AiCompletionError('APP_ID_REQUIRED', 403,
      'app_id is required because you have configured an AI app allowlist.');
  }
}

/** Decrypt the owner's stored provider key. Undefined is legitimate for a keyless self-hosted
 *  provider; OpenRouter without a key is not, and says so. */
export function decryptOwnerKey(
  config: AimeatConfig, apiKeyRecordValue: unknown, provider: ProviderType,
): string | undefined {
  const encrypted = (apiKeyRecordValue as { encrypted?: string } | undefined)?.encrypted;
  if (encrypted) {
    const encKey = getEncryptionKey(config);
    if (!encKey) {
      throw new AiCompletionError('ENCRYPTION_NOT_CONFIGURED', 503,
        'Encryption key not configured. Set AIMEAT_ENCRYPTION_KEY or AIMEAT_TOTP_ENCRYPTION_KEY.');
    }
    return decrypt(encrypted, encKey);
  }
  if (provider === 'openrouter') {
    throw new AiCompletionError('NO_API_KEY', 400, 'No OpenRouter API key configured. Set one in Settings.');
  }
  return undefined;
}

/**
 * Daily budget + per-app cap. Both are pre-call checks against what has ALREADY been spent, so a
 * single call can overshoot the budget by its own cost; the cap stops the next one. Returns the
 * resolved daily budget so the caller can report it.
 */
export function assertWithinBudget(
  usage: UsageRecord, prefs: Record<string, unknown>, appId?: string,
): number {
  const dailyBudget = getDailyBudgetUsd(prefs);
  if (usage.total_cost_usd >= dailyBudget) {
    throw new AiCompletionError('QUOTA_EXHAUSTED', 402,
      `Daily AI budget hit ($${usage.total_cost_usd.toFixed(4)} / $${dailyBudget}). Raise it in Settings or wait until midnight UTC.`);
  }
  if (appId) {
    // Per-app cap. By DEFAULT an app may spend the whole daily budget the owner set (the "AI apps
    // daily budget") — there is no separate hidden per-app default. An explicit app_quotas.<app>
    // override throttles that one app below the budget when the owner wants it.
    const appQuotas = (prefs.app_quotas as Record<string, { daily_usd?: number }> | undefined) ?? {};
    const appQuota = appQuotas[appId]?.daily_usd ?? dailyBudget;
    const appSpent = usage.per_app[appId]?.cost_usd ?? 0;
    if (appSpent >= appQuota) {
      throw new AiCompletionError('APP_QUOTA_EXHAUSTED', 402,
        `Daily AI quota for "${appId}" hit ($${appSpent.toFixed(4)} / $${appQuota}). Raise it in Settings.`);
    }
  }
  return dailyBudget;
}

/**
 * Record what yesterday cost, once. Silent when there was no spend: "you spent nothing" is not news,
 * and a feed that says it every morning is a feed people stop reading.
 */
async function reportYesterdaysSpend(
  storage: Storage, gaii: string, config?: AimeatConfig,
): Promise<void> {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const rec = (await storage.getMemory(gaii, `ai-usage.${gaii}.${yesterday}`))?.value as UsageRecord | undefined;
  if (!rec || !(rec.total_cost_usd > 0)) return;
  await recordAccountEvent(storage, {
    ownerGhii: gaii,
    kind: 'ai_spend_daily',
    subject: yesterday,
    link: '/v1/profile?tab=usage',
    data: {
      day: yesterday,
      amount: `$${rec.total_cost_usd < 1 ? rec.total_cost_usd.toFixed(4) : rec.total_cost_usd.toFixed(2)}`,
      calls: String(rec.total_calls ?? 0),
    },
  }, config);
}

/**
 * Fold one call into today's usage record and persist it. Text completions and transcriptions share
 * ONE record, so the daily budget covers both and the spend charts show them together — an owner
 * whose budget is being eaten by voice messages sees it in the same place as everything else.
 *
 * IT WRITES TWO PLACES, AND THEY ARE NOT REDUNDANT. The per-day memory record is the LIVE budget
 * counter: it must be readable in one get before every completion, so it stays a single small key
 * and carries no model dimension. The ledger event is the REPORTING row: append-only, priced,
 * carrying model, provider and appId. Before this, only the first existed, which is why per-app
 * model reporting had no data behind it. Both are written here rather than at the two call sites,
 * so a third caller cannot arrive and write only one of them.
 */
export async function recordAiUsage(
  storage: Storage, gaii: string, usage: UsageRecord,
  call: {
    costUsd: number; tokens: number; audioSeconds?: number; appId?: string;
    /** Ledger dimensions. Omitted only by a caller that genuinely has no model to name. */
    model?: string; provider?: string; promptTokens?: number; completionTokens?: number;
    source?: string;
    /** Which key paid. The ledger has carried this dimension since it was written; before the node
     *  had a key of its own there was only one possible answer, so it was hardcoded. */
    apiKeyScope?: 'own' | 'node';
  },
  /** The node's config, so the event window is the operator's number. Optional: the two callers
   *  have it, and a caller that does not gets the default rather than a compile error. */
  config?: AimeatConfig,
): Promise<UsageRecord> {
  const updated: UsageRecord = {
    date: todayKey(),
    total_cost_usd: usage.total_cost_usd + call.costUsd,
    total_calls: usage.total_calls + 1,
    total_tokens: usage.total_tokens + call.tokens,
    audio_seconds: (usage.audio_seconds ?? 0) + (call.audioSeconds ?? 0),
    per_app: { ...usage.per_app },
    updated_at: new Date().toISOString(),
  };
  const appKey = call.appId || '_unknown';
  const existing = updated.per_app[appKey] ?? { cost_usd: 0, calls: 0, tokens: 0 };
  updated.per_app[appKey] = {
    cost_usd: existing.cost_usd + call.costUsd,
    calls: existing.calls + 1,
    tokens: existing.tokens + call.tokens,
    audio_seconds: (existing.audio_seconds ?? 0) + (call.audioSeconds ?? 0),
  };
  // THE DAY BEFORE, told once. A row per completion would be the loudest thing on the account and
  // the least interesting; what a person wants told is what a day cost. `usage.total_calls === 0`
  // means this is the first call of a new UTC day for them, so yesterday's record is final and can
  // be reported — one extra read per owner per active day, and no marker to keep in step.
  if ((usage.total_calls ?? 0) === 0) {
    void reportYesterdaysSpend(storage, gaii, config).catch(err =>
      logger.warn('[ai] daily spend digest is best-effort', { gaii, error: String(err) }));
  }

  await upsertUsage(storage, gaii, updated);

  // The reporting half. Best-effort on purpose: the owner has already been served and the budget
  // counter above is already correct, so a ledger failure must not surface as a failed completion.
  // It is logged rather than swallowed, because an operator seeing this knows spend is happening
  // that their reports will not show.
  if (call.model) {
    try {
      await recordUsageEvent(storage, {
        agentGaii: gaii,
        ownerGhii: gaii,
        model: call.model,
        provider: call.provider,
        promptTokens: call.promptTokens ?? 0,
        completionTokens: call.completionTokens ?? 0,
        // The provider's own figure when we have it. `costUsd` here is already either the exact
        // reported cost or this node's estimate, and priceUsd() prefers what it is given.
        providerCostUsd: call.costUsd,
        source: call.source ?? 'ai-complete',
        apiKeyScope: call.apiKeyScope ?? 'own',
        appId: call.appId ?? '',
        surface: 'app',
      });
    } catch (err) {
      logger.warn('[ai] ledger event failed; the budget counter is still correct', {
        gaii, model: call.model, error: String(err),
      });
    }
  }

  return updated;
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
  /**
   * Which pocket paid, and — on the node's key — what is left. A caller showing a person their spend
   * has to be able to tell "you spent your own money" from "you used the node's allowance", and the
   * two are different sentences.
   */
  keySource: 'own' | 'node';
  allowanceRemainingUsd?: number;
  /**
   * True when the allowance was spent and the answer came from a free model instead of a refusal.
   * Surfaced rather than hidden: a weaker answer the person was told about is an honest trade, and
   * an unannounced one is not.
   */
  degradedToFreeModel?: boolean;
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
  /** Transcribed audio seconds in the window (0 before speech-to-text existed). */
  audio_seconds: number;
  per_app: Record<string, { cost_usd: number; tokens: number; calls: number; audio_seconds: number }>;
}

export interface UsageHistory {
  /** Per-day series, oldest → newest, limited to the last `days` retained records. */
  days: UsageRecord[];
  /** Distinct app ids across the returned series, ordered by spend (desc) — stable chart series order. */
  apps: string[];
  /** Rollups: d1 = today's UTC bucket, d7/d30 = trailing 7/30 calendar days. */
  windows: { d1: UsageWindow; d7: UsageWindow; d30: UsageWindow };
}

const emptyWindow = (): UsageWindow => ({ cost_usd: 0, tokens: 0, calls: 0, audio_seconds: 0, per_app: {} });

function accumulateWindow(win: UsageWindow, rec: UsageRecord): void {
  win.cost_usd += rec.total_cost_usd || 0;
  win.tokens += rec.total_tokens || 0;
  win.calls += rec.total_calls || 0;
  win.audio_seconds += rec.audio_seconds || 0;
  for (const [app, m] of Object.entries(rec.per_app || {})) {
    const cur = win.per_app[app] ?? (win.per_app[app] = { cost_usd: 0, tokens: 0, calls: 0, audio_seconds: 0 });
    cur.cost_usd += m.cost_usd || 0;
    cur.tokens += m.tokens || 0;
    cur.calls += m.calls || 0;
    cur.audio_seconds += m.audio_seconds || 0;
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
/**
 * Everything decided BEFORE a model is called, for one owner and one call.
 *
 * Which pocket pays, which model answers, whether the allowance has run out and the answer has to
 * come from a free model instead of a refusal: those are one decision, and this is where it is made.
 * `completeForOwner` runs it and then calls the provider itself; the chat proxy runs the same one
 * and then streams the provider's own bytes back. Two call shapes, one set of rules — the alternative
 * was a second implementation of the key choice and the budget, which is how a paywall ends up
 * enforced on one door and not the other.
 */
export interface AiCallPlan {
  prefs: Record<string, unknown>;
  provider: ProviderType;
  baseUrl: string;
  /** The decrypted key that will pay. Never logged, never returned to a caller. */
  key: string | undefined;
  keyScope: 'own' | 'node';
  /** What is left on the node's allowance, when the node is paying. */
  allowanceRemainingUsd?: number;
  /** Today's usage record, read once so the settle step does not read it again. */
  usage: UsageRecord;
  dailyBudgetUsd: number;
  model: string;
  /** True when the allowance was spent and a free model is answering instead of nothing. */
  degradedToFree: boolean;
}

export interface PrepareAiCallOptions {
  /** An explicit model. A caller that named one is not asking the node to choose. */
  model?: string;
  modelRole?: 'reasoning' | 'execution';
  appId?: string;
  /** Image inputs need a vision-capable model, whatever the owner's text default is. */
  hasImages?: boolean;
}

/**
 * Decide who pays, what answers, and whether this call may happen at all.
 *
 * Throws before anything is spent: a provider the node does not allow, an app the owner has not
 * allowed, a missing key, a daily budget already used up. Refusing before the write is the order,
 * not just the presence of the checks.
 */
export async function prepareAiCall(
  storage: Storage,
  config: AimeatConfig,
  gaii: string,
  opts: PrepareAiCallOptions = {},
): Promise<AiCallPlan> {
  const [apiKeyRecord, prefsRecord, usageRecord] = await Promise.all([
    storage.getMemory(gaii, 'openrouter.apikey'),
    storage.getMemory(gaii, 'openrouter.settings'),
    storage.getMemory(gaii, `ai-usage.${gaii}.${todayKey()}`),
  ]);
  const prefs = (prefsRecord?.value as Record<string, unknown>) ?? {};
  const provider = (prefs.provider as ProviderType) || 'openrouter';
  const baseUrl = (prefs.baseUrl as string) || DEFAULT_BASE_URLS[provider];

  assertProviderAllowed(config, baseUrl);
  assertAppAllowed(prefs, opts.appId);
  // Whose key pays is one decision and it lives in services/ai-allowance.ts: the person's own key,
  // then the node's if they have allowance left. An own key is never metered here — it is their
  // money and their provider account, which is the whole reason bringing one is recommended.
  const keyChoice = await resolveAiKey(storage, config, gaii, provider, apiKeyRecord?.value);

  const usage = (usageRecord?.value as UsageRecord | undefined) ?? emptyUsage();
  const dailyBudgetUsd = assertWithinBudget(usage, prefs, opts.appId);

  // ── Model selection ──
  // Each role asks the owner first and the node second (services/ai-model-defaults.ts). With no
  // instance defaults configured every branch resolves exactly as it did before that existed.
  const roleModel = (role: ModelRole) => resolveModelFor(config, prefs, role);
  let model: string;
  if (typeof opts.model === 'string' && opts.model) {
    model = opts.model;
  } else if (opts.hasImages && roleModel('vision')) {
    // Image inputs need a vision-capable model — the owner's default may be text-only. Use the
    // configured visionModel (e.g. qwen-2.5-VL) for any request carrying images.
    model = roleModel('vision') as string;
  } else if (opts.modelRole === 'reasoning' && roleModel('reasoning')) {
    model = roleModel('reasoning') as string;
  } else if (opts.modelRole === 'execution' && roleModel('execution')) {
    model = roleModel('execution') as string;
  } else {
    model = roleModel('chat')
      || roleModel('execution')
      || roleModel('reasoning')
      // Vendor-neutral default: OpenRouter's free-models router (no specific vendor hardcoded).
      || 'openrouter/free';
  }

  // Allowance spent, on the node's key: answer on a free model rather than stopping, and say so.
  // A refusal is a dead end; a weaker answer with an honest label is not. An explicit model override
  // is left alone — a caller that named one is not asking the node to choose.
  let degradedToFree = false;
  if (keyChoice.scope === 'node' && keyChoice.exhausted && !opts.model) {
    if (!config.modelFreeFallback) {
      throw new AiCompletionError('QUOTA_EXHAUSTED', 402,
        'Your allowance on this node is used up. Add more, or set your own OpenRouter key in Settings.');
    }
    model = config.modelFreeFallback;
    degradedToFree = true;
  }

  return {
    prefs, provider, baseUrl,
    key: keyChoice.key,
    keyScope: keyChoice.scope,
    ...(keyChoice.scope === 'node' ? { allowanceRemainingUsd: keyChoice.remainingUsd } : {}),
    usage, dailyBudgetUsd, model, degradedToFree,
  };
}

export interface AiCallOutcome {
  /** The model that actually answered, which is not always the one that was asked for. */
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  /** The text the model produced, hashed into the provenance record. */
  content: string;
  appId?: string;
  /** Where this call came from, for the usage record. */
  source: string;
}

export interface AiCallSettlement {
  usage: UsageRecord;
  allowanceRemainingUsd?: number;
  provenance?: AiProvenanceRecordRow;
}

/**
 * Everything recorded AFTER a model answered: usage, the allowance draw-down, and provenance.
 *
 * Bookkeeping never fails a call the owner has already paid for, so the provenance mint is caught
 * and logged rather than thrown — an operator seeing that line knows generated content is going out
 * unrecorded, which is exactly the thing they would want to fix.
 */
export async function settleAiCall(
  storage: Storage,
  config: AimeatConfig,
  gaii: string,
  plan: AiCallPlan,
  outcome: AiCallOutcome,
): Promise<AiCallSettlement> {
  const updated = await recordAiUsage(storage, gaii, plan.usage, {
    costUsd: outcome.costUsd, tokens: outcome.totalTokens, appId: outcome.appId,
    model: outcome.model, provider: plan.provider,
    promptTokens: outcome.promptTokens, completionTokens: outcome.completionTokens,
    source: outcome.source, apiKeyScope: plan.keyScope,
  }, config);
  // Only the node's key draws down an allowance. An own key is the person's own account.
  const allowanceAfter = plan.keyScope === 'node'
    ? await debitAllowance(storage, config, gaii, outcome.costUsd)
    : null;

  logger.info(`[ai] gaii=${gaii} app=${outcome.appId || '_unknown'} model=${outcome.model} tokens=${outcome.totalTokens} cost=$${outcome.costUsd.toFixed(4)} day_total=$${updated.total_cost_usd.toFixed(4)}`);

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
  if (config.aiProvenance && outcome.content) {
    try {
      provenance = await mintProvenance(storage, {
        stampedBy: 'node',
        ownerGhii: gaii,
        principal: gaii,
        level: 'ai-generated',
        humanInvolvement: 'none',
        method: 'fully-generated',
        content: outcome.content,
        generator: {
          model: outcome.model,
          provider: plan.provider,
          pipeline: outcome.appId,
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
      logger.warn(`[ai] provenance mint failed for gaii=${gaii} model=${outcome.model}: ${(err as Error).message}`);
    }
  }

  return {
    usage: updated,
    ...(plan.keyScope === 'node'
      ? { allowanceRemainingUsd: allowanceAfter ? Math.max(0, allowanceAfter.granted_usd - allowanceAfter.spent_usd) : plan.allowanceRemainingUsd }
      : {}),
    provenance,
  };
}

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

  const hasImages = Array.isArray(opts.images) && opts.images.length > 0;
  const plan = await prepareAiCall(storage, config, gaii, {
    model: opts.model, modelRole: opts.modelRole, appId: opts.appId, hasImages,
  });
  const { prefs } = plan;

  const options = {
    temperature: opts.temperature ?? (typeof prefs.temperature === 'number' ? prefs.temperature : undefined),
    top_p: opts.topP ?? (typeof prefs.top_p === 'number' ? prefs.top_p : undefined),
    max_tokens: typeof opts.maxTokens === 'number' && opts.maxTokens > 0
      ? (opts.maxTokens | 0)
      : (typeof prefs.max_tokens === 'number' ? (prefs.max_tokens as number) : undefined),
  };

  let result;
  try {
    result = await complete(plan.key, plan.model, opts.prompt, opts.systemPrompt, plan.baseUrl, options, opts.images);
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

  const settled = await settleAiCall(storage, config, gaii, plan, {
    model: result.model,
    promptTokens: promptTok, completionTokens: completionTok, totalTokens: totalTok,
    costUsd, content: result.content, appId: opts.appId, source: 'ai-complete',
  });

  return {
    content: result.content,
    model: result.model,
    usage: { promptTokens: promptTok, completionTokens: completionTok, totalTokens: totalTok, costUsd, costExact },
    budget: {
      dailyBudgetUsd: plan.dailyBudgetUsd,
      spentTodayUsd: settled.usage.total_cost_usd,
      remainingUsd: Math.max(0, plan.dailyBudgetUsd - settled.usage.total_cost_usd),
    },
    provenance: settled.provenance,
    keySource: plan.keyScope,
    ...(settled.allowanceRemainingUsd !== undefined
      ? { allowanceRemainingUsd: settled.allowanceRemainingUsd }
      : {}),
    ...(plan.degradedToFree ? { degradedToFreeModel: true } : {}),
  };
}
