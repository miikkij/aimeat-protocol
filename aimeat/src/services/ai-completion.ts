/**
 * @file ai-completion.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v3.7.0 — 2026-09-28 — Providers and routing (System 2 plan, V3). prepareAiCall reads the owner's
 *     provider records (the legacy setting migrated on the first read, services/ai/provider-store.ts),
 *     their routing and the policy, and plans an ordered candidate list with a reason for every
 *     provider left out (services/ai/route-plan.ts); the plan's own fields are the first candidate's.
 *     The key is per candidate: an agent's own key for that provider, the owner's key for it, and the
 *     node's key only on the node's own OpenRouter provider. completeForOwner tries the candidates
 *     by the owner's rules (services/ai/route-run.ts), records the attempts that failed before a
 *     fallback as usage rows of their own, and returns the `route`. The refusals for the situations
 *     that existed before keep their code and wording. nodeKeyPaysFor() moved into the node's
 *     provider record (image and transcription enabled only with a node default model, J4);
 *     the host allowlist is checked per candidate.
 *   v3.6.0 — 2026-09-28 — The owner's model policy (System 2 plan, V2; services/ai/policy-gate.ts): the
 *     model is chosen under it BEFORE the key, a named model the rules leave out is refused 403
 *     AI_MODEL_NOT_ALLOWED, lists with nothing in common 403 AI_MODEL_POLICY_EMPTY, a model the
 *     owner's role names but the rules leave out is replaced by the first allowed one
 *     (`policyChoseModel`), and a spent allowance falls back to the free model only when the policy
 *     allows it. With no policy anywhere every choice is as before. AiCompletionError moved to
 *     services/ai/errors.ts (re-exported here) and carries `details`.
 *   v3.5.0 — 2026-09-28 — One gate for every operation (System 2 plan, V1). prepareAiCall takes an
 *     `op` (text, image, transcribe), resolves the model for it, and returns the target the gateway
 *     calls (services/ai/gateway.ts, on the AI SDK); completeForOwner calls the gateway instead of the
 *     transport's complete(), which is gone. For images and transcription the model is chosen first
 *     and refused by name when unset, as those paths always did, and the node's key pays only when
 *     the operator named a node default model for the operation (Jouni, 2026-09-28); otherwise the
 *     agent's or the owner's own key is needed, as before. AiCallOutcome carries the operation, the
 *     units (audio seconds) and where its cost came from (`costSource`).
 *   v3.4.0 — 2026-09-20 — A key per agent: `agent` on the options; that agent's own OpenRouter key
 *     pays before the owner's and the node's, and its daily cap is checked beside the app's
 *     (services/agent-ai-keys.ts). The usage-accounting group moved to ai-usage-record.ts, unchanged
 *     and re-exported from here (max-file-lines).
 *   v3.3.0 — 2026-09-19 — One name per app in the budget (services/ai-app-id.ts): the day's spend is
 *     recorded under the canonical name, and the allowlist and the per-app cap match any of an app's
 *     names, so `app`, `app.html` and `owner/app.html` are one app with one cap.
 *   v3.2.1 — 2026-09-16 — prepareAiCall passes the call's baseUrl to resolveAiKey, which refuses
 *     the node's shared key for any address but OpenRouter's own.
 *   v3.2.0 — 2026-09-13 — The result carries finishReason and truncated (finish_reason === 'length').
 *     The provider's reason was in hand and dropped, so a cut answer reached an app looking finished.
 *   v3.1.0 — 2026-08-31 — `signal` on the options, threaded to complete(), which composes it with
 *     its own timeout. It is what lets a background AI job be cancelled while it is running instead
 *     of waiting out the transport timeout. Nothing about the settlement changes: a cancel that
 *     lands after the provider answered leaves the usage row where it is, because a cancelled call
 *     is not a free call.
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
 *   v1.8.0 — 2026-09-09 — `reasoning` and `retries` reach the provider from the call or from the
 *     owner's settings; an empty answer surfaces as EMPTY_COMPLETION after the transport's retries.
 *     `uncapped` lets a long-generation caller (the workflow ai step) refuse the owner's max_tokens
 *     preference, which had applied to it although the step's contract says no cap. getUsageHistory
 *     moved to ai-usage-history.ts as a pure move (max-file-lines).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { decrypt, getEncryptionKey } from './encryption.js';
import type { ProviderType, CompletionReasoning } from './openrouter.js';
import { text as gatewayText } from './ai/gateway.js';
import type { AiAdapterType, AiCapability, AiOp, AiTarget, CostSource } from './ai/types.js';
import { loadPolicyDecision } from './ai/policy-gate.js';
import type { CallerClass } from './ai/policy.js';
import { AiCompletionError } from './ai/errors.js';
import { providersForOwner } from './ai/provider-store.js';
import { readRouting, rulesFor, type RoutingRules } from './ai/routing.js';
import { planRoute, refusalFor, type AiCandidate, type ChosenBy, type RejectedCandidate } from './ai/route-plan.js';
import { runRoute, type AiRoute } from './ai/route-run.js';
import { mintProvenance } from './ai-provenance.js';
import type { AiProvenanceRecordRow } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { resolveModelFor, type ModelRole } from './ai-model-defaults.js';
import { debitAllowance, readAllowance, remainingOf } from './ai-allowance.js';
import { appSpentToday, appQuotaFor, appAllowlisted } from './ai-app-id.js';
import { todayKey, getTodayUsage, recordAiUsage, emptyUsage, type UsageRecord } from './ai-usage-record.js';
import { agentCapRefusal } from './agent-ai-keys.js';
import { DEFAULT_DAILY_BUDGET_USD, getDailyBudgetUsd } from './ai-daily-budget.js';
export { todayKey, getTodayUsage, recordAiUsage, type UsageRecord, DEFAULT_DAILY_BUDGET_USD, getDailyBudgetUsd };

/**
 * Rough cost estimate when the provider didn't report one (LM Studio, custom).
 * The user's OpenRouter dashboard is authoritative — budgets exist to prevent
 * runaways, not to bill.
 */
const FALLBACK_PROMPT_COST_PER_TOKEN = 0.000005;
const FALLBACK_COMPLETION_COST_PER_TOKEN = 0.000015;

// DEFAULT_DAILY_BUDGET_USD and getDailyBudgetUsd live in ai-daily-budget.ts (a leaf, so the ledger's
// budget alert can read the number without importing this file) and are re-exported below.

/** The fallback when the provider does not report a cost. Exported so the chat proxy uses the same
 *  arithmetic rather than a second guess at what a turn was worth. */
export function estimateCostUsd(promptTokens: number, completionTokens: number): number {
  return promptTokens * FALLBACK_PROMPT_COST_PER_TOKEN
    + completionTokens * FALLBACK_COMPLETION_COST_PER_TOKEN;
}

// The typed error lives in services/ai/errors.ts (a leaf the policy code can throw too) and is
// re-exported here, so every existing importer keeps its path.
export { AiCompletionError };

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
export function assertAppAllowed(prefs: Record<string, unknown>, appId?: string, ownerGhii?: string): void {
  const allowlist = Array.isArray(prefs.app_allowlist) ? (prefs.app_allowlist as string[]) : null;
  if (!allowlist) return;
  // Under any of the app's names (services/ai-app-id.ts): an entry saved as `app.html` still allows `app`.
  if (appId && !appAllowlisted(allowlist, appId, ownerGhii)) {
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
  usage: UsageRecord, prefs: Record<string, unknown>, appId?: string, ownerGhii?: string,
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
    // One app, one cap, whatever name a door recorded it under (services/ai-app-id.ts).
    const appQuota = appQuotaFor(prefs.app_quotas as Record<string, { daily_usd?: number }> | undefined, appId, ownerGhii, dailyBudget);
    const appSpent = appSpentToday(usage.per_app, appId, ownerGhii);
    if (appSpent >= appQuota) {
      throw new AiCompletionError('APP_QUOTA_EXHAUSTED', 402,
        `Daily AI quota for "${appId}" hit ($${appSpent.toFixed(4)} / $${appQuota}). Raise it in Settings.`);
    }
  }
  return dailyBudget;
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
  /** The owner's agent that is asking, by bare name (see PrepareAiCallOptions.agent). */
  agent?: string;
  /** Whose call this is and the app the node identified, for the model policy (PrepareAiCallOptions). */
  caller?: CallerClass;
  verifiedApp?: string;
  /** A provider the call names (an id of the caller's, or a type), and the call's word on fallback. */
  provider?: string;
  fallback?: boolean;
  /** The capability, when the prompt alone does not say it (a provider test of `files`). */
  capability?: AiCapability;
  /** Optional image attachments (data: or https URLs) for vision-capable models. */
  images?: string[];
  /**
   * Passed to the provider as given (OpenRouter's unified `reasoning` parameter). When unset, the
   * owner's settings decide, and when those say nothing, nothing is sent.
   */
  reasoning?: CompletionReasoning;
  /** How many times an empty answer is asked again before it is an error. Falls back to the owner's setting, then 2. */
  retries?: number;
  /**
   * The caller is a long generation and the owner's `max_tokens` preference must NOT apply. The
   * workflow ai step passes this: its contract is no cap, and the preference had been reaching it
   * through here regardless. An explicit `maxTokens` on the call still wins.
   */
  uncapped?: boolean;
  /**
   * An outside reason to stop waiting — a cancelled AI job. Composed with the call's own timeout in
   * the gateway (services/ai/gateway.ts), never replacing it.
   *
   * A cancel that lands AFTER the provider has answered does not undo the bookkeeping: the
   * settlement below has already run, and a cancelled call is not a free call. The usage row must
   * not silently disappear or the spend charts lie.
   */
  signal?: AbortSignal;
}

export interface CompleteForOwnerResult {
  content: string;
  model: string;
  /**
   * Why the provider stopped ('stop', 'length', 'content_filter', …), or null when it did not say.
   * `truncated` is finish_reason === 'length': the answer was cut at a token limit, which an app
   * cannot otherwise tell from a finished answer.
   */
  finishReason: string | null;
  truncated: boolean;
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
  keySource: 'agent' | 'own' | 'node';
  allowanceRemainingUsd?: number;
  /**
   * True when the allowance was spent and the answer came from a free model instead of a refusal.
   * Surfaced rather than hidden: a weaker answer the person was told about is an honest trade, and
   * an unannounced one is not.
   */
  degradedToFreeModel?: boolean;
  /**
   * True when the owner's model policy chose the model: the one that would have answered is not
   * allowed, or nobody chose one. Surfaced like degradedToFreeModel, so an app can say so.
   */
  policyChoseModel?: boolean;
  /** Who chose the provider, who answered, and every attempt (services/ai/route-run.ts). */
  route: AiRoute;
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
  /** The id of the provider the first candidate calls (services/ai/providers.ts). */
  provider: string;
  baseUrl: string;
  /** The decrypted key that will pay. Never logged, never returned to a caller. */
  key: string | undefined;
  keyScope: 'agent' | 'own' | 'node';
  /** The owner's agent that asked, by bare name, so the settle step adds the spend to its cap. */
  agent?: string;
  /** What is left on the node's allowance, when the node is paying. */
  allowanceRemainingUsd?: number;
  /** Today's usage record, read once so the settle step does not read it again. */
  usage: UsageRecord;
  dailyBudgetUsd: number;
  model: string;
  /** True when the allowance was spent and a free model is answering instead of nothing. */
  degradedToFree: boolean;
  /** What this call does. */
  op: AiOp;
  /** Which adapter builds the model for this provider (services/ai/adapters/). */
  providerType: AiAdapterType;
  /** True when the owner's model policy chose the model because the one that would have answered
   *  is not allowed, or nobody chose one (services/ai/policy-gate.ts). */
  policyChoseModel: boolean;
  /** The references this call's policy allows, or 'any'. A model list shown to the caller is
   *  filtered by it, so nobody picks a model the node would then refuse. */
  allowedModels: string[] | 'any';
  /** The first candidate's destination; the plan's own fields mirror it. */
  target: AiTarget;
  /** What the call asks for. */
  capability: AiCapability;
  /** Every provider that may answer, in order, and the ones that may not with their reason. */
  candidates: AiCandidate[];
  rejected: RejectedCandidate[];
  chosenBy: ChosenBy;
  /** Whether a failure may move to the next candidate (the owner's rules and the call's own word). */
  allowFallback: boolean;
  rules: RoutingRules;
}

/** Where the gateway sends a planned call: the adapter, the address and the key that pays. */
export function targetOf(plan: AiCallPlan): AiTarget {
  return plan.target;
}

/** The plan as the candidate that answered it: its provider, key, model and pocket. */
export function planFor(plan: AiCallPlan, c: AiCandidate): AiCallPlan {
  return {
    ...plan, provider: c.provider.id, providerType: c.provider.type, baseUrl: c.target.baseUrl, key: c.target.key,
    keyScope: c.keyScope, model: c.model, degradedToFree: !!c.degradedToFree, policyChoseModel: c.policyChoseModel,
    target: c.target,
    ...(c.allowanceRemainingUsd !== undefined ? { allowanceRemainingUsd: c.allowanceRemainingUsd } : { allowanceRemainingUsd: undefined }),
  };
}

/** The operations whose model is a role of its own, and never the text model. */
const OP_ROLE: Partial<Record<AiOp, ModelRole>> = { image: 'image', transcribe: 'stt' };

export interface PrepareAiCallOptions {
  /** What the call does. Default `text`. */
  op?: AiOp;
  /** An explicit model. A caller that named one is not asking the node to choose. */
  model?: string;
  modelRole?: 'reasoning' | 'execution';
  appId?: string;
  /** Image inputs need a vision-capable model, whatever the owner's text default is. */
  hasImages?: boolean;
  /** The bare name of the owner's agent that is asking: its own key pays first, and its daily cap
   *  applies. The door derives it from the principal (aiPayerOf), never from the body, and passes
   *  the agent's OWNER as `gaii`: the payer is the human. */
  agent?: string;
  /** What the call asks for, when the operation alone does not say (a spoken reply is `speech`). */
  capability?: AiCapability;
  /** Whose call this is, for the owner's policy switches. Default: `agent` with an agent, else `owner`. */
  caller?: CallerClass;
  /** The app the node identified from an app grant (`owner/file.html`), never a body field. */
  verifiedApp?: string;
  /** A provider the call names: one of the caller's provider ids, or a type. No fallback then. */
  provider?: string;
  /** The call's own word on moving to the next provider; the owner's rules decide when it says nothing. */
  fallback?: boolean;
  /** Only a provider on this machine. */
  requires?: { local?: boolean };
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
  const op: AiOp = opts.op ?? 'text';
  const roleModel = (role: ModelRole) => resolveModelFor(config, prefs, role);
  assertAppAllowed(prefs, opts.appId, gaii);

  const capability: AiCapability = opts.capability
    ?? (op === 'image' ? 'image' : op === 'transcribe' ? 'transcription' : opts.hasImages ? 'vision' : 'text');
  const requested = typeof opts.model === 'string' && opts.model ? opts.model : undefined;
  const policyCtx = {
    capability, caller: opts.caller ?? (opts.agent ? 'agent' : 'owner') as CallerClass,
    ...(opts.agent ? { agent: opts.agent } : {}),
    ...(opts.verifiedApp ? { verifiedApp: opts.verifiedApp } : {}),
    ...(opts.appId ? { appId: opts.appId } : {}),
  };
  // The owner's providers (the legacy setting migrated on the first read), their routing and their
  // model policy. The legacy records were read above, so the migration reads nothing twice.
  const [providers, routing, policy] = await Promise.all([
    providersForOwner(storage, config, gaii, { settings: prefsRecord, key: apiKeyRecord }),
    readRouting(storage, gaii, opts.agent),
    loadPolicyDecision(storage, config, gaii, policyCtx),
  ]);
  const rules = rulesFor({ capability, ...(opts.agent ? { agent: opts.agent } : {}), ...(opts.appId ? { app: opts.appId } : {}) }, routing);

  // The model each role gave before providers existed: the owner's setting, then the node's default
  // (services/ai-model-defaults.ts), and for text, with nothing chosen anywhere, OpenRouter's
  // free-models router. It is what the migrated provider and the node's own provider use when a call
  // names no model, so an owner who set nothing new sees nothing change.
  const textModel = (opts.modelRole === 'reasoning' && roleModel('reasoning'))
    || (opts.modelRole === 'execution' && roleModel('execution'))
    || roleModel('chat') || roleModel('execution') || roleModel('reasoning')
    || 'openrouter/free';
  const legacyModel = (cap: AiCapability): string | undefined => {
    if (cap === 'image') return roleModel('image');
    if (cap === 'transcription') return roleModel('stt');
    if (cap === 'embed') return undefined;
    if (cap === 'vision') return roleModel('vision') || textModel;
    return textModel;
  };

  // ── Candidates: the model, the policy and the key, per provider, before anything is spent ──
  // services/ai/route-plan.ts. Every refusal about the model and the key comes before the budget,
  // as it always did (Refuse before you write).
  const route = await planRoute({
    storage, config, gaii, op, capability, providers, routing, rules, policy, policyCtx,
    ...(requested ? { requested } : {}),
    ...(opts.provider ? { namedProvider: opts.provider } : {}),
    ...(opts.fallback !== undefined ? { fallback: opts.fallback } : {}),
    ...(opts.requires ? { requires: opts.requires } : {}),
    ...(opts.agent ? { agent: opts.agent } : {}),
    legacyModel,
    nodeAllowance: async () => ({ remainingUsd: remainingOf(await readAllowance(storage, config, gaii)) }),
  });
  const opRole = OP_ROLE[op];
  if (!route.candidates.length) throw refusalFor(route, op, capability, opRole ? roleModel(opRole) : textModel);

  const usage = (usageRecord?.value as UsageRecord | undefined) ?? emptyUsage();
  const dailyBudgetUsd = assertWithinBudget(usage, prefs, opts.appId, gaii);
  const overCap = await agentCapRefusal(storage, gaii, opts.agent);
  if (overCap) throw new AiCompletionError('AGENT_QUOTA_EXHAUSTED', 402, overCap);

  const first = route.candidates[0];
  return planFor({
    prefs, provider: first.provider.id, baseUrl: first.target.baseUrl, key: first.target.key, keyScope: first.keyScope,
    ...(opts.agent ? { agent: opts.agent } : {}),
    usage, dailyBudgetUsd, model: first.model, degradedToFree: false,
    op, providerType: first.provider.type, policyChoseModel: false, allowedModels: policy.decision.allowed,
    target: first.target, capability, candidates: route.candidates, rejected: route.rejected,
    chosenBy: route.chosenBy, allowFallback: route.allowFallback, rules,
  }, first);
}

/**
 * The attempts that failed before an answer, or before the final failure, as usage rows of their
 * own (plan 11, section 7): a provider may bill a timed-out picture, and a fallback the owner cannot
 * see in their records is a fallback they cannot judge. The caller writes them only when the route
 * moved on (`route.fellBack`), so a single failed call records what it always did: nothing.
 */
export async function recordFailedAttempts(
  storage: Storage, config: AimeatConfig, gaii: string, plan: AiCallPlan,
  failed: Array<{ candidate: AiCandidate; error: string; costUsd: number }>,
  call: { appId?: string; source: string },
): Promise<void> {
  for (const f of failed) {
    await recordAiUsage(storage, gaii, plan.usage, {
      costUsd: f.costUsd, tokens: 0, appId: call.appId, model: f.candidate.model, provider: f.candidate.provider.id,
      source: `${call.source}:failed-${f.error}`, apiKeyScope: f.candidate.keyScope, ...(plan.agent ? { agent: plan.agent } : {}),
    }, config);
    if (f.candidate.keyScope === 'node' && f.costUsd > 0) await debitAllowance(storage, config, gaii, f.costUsd);
  }
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
  /** Observed binary output, hashed incrementally without retaining the audio. */
  contentHash?: string;
  appId?: string;
  /** Where this call came from, for the usage record. */
  source: string;
  /** What was consumed besides tokens: audio seconds for a transcription, pictures for an image. */
  units?: { seconds?: number; images?: number };
  /** Where `costUsd` came from (services/ai/types.ts). Logged with the settlement. */
  costSource?: CostSource;
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
    ...(outcome.units?.seconds !== undefined ? { audioSeconds: outcome.units.seconds } : {}),
    model: outcome.model, provider: plan.provider,
    promptTokens: outcome.promptTokens, completionTokens: outcome.completionTokens,
    source: outcome.source, apiKeyScope: plan.keyScope, ...(plan.agent ? { agent: plan.agent } : {}),
  }, config);
  // Only the node's key draws down an allowance. An own key is the person's own account.
  const allowanceAfter = plan.keyScope === 'node'
    ? await debitAllowance(storage, config, gaii, outcome.costUsd)
    : null;

  logger.info(`[ai] gaii=${gaii} op=${plan.op} app=${outcome.appId || '_unknown'} model=${outcome.model} tokens=${outcome.totalTokens} cost=$${outcome.costUsd.toFixed(4)} costSource=${outcome.costSource ?? 'unknown'} key=${plan.keyScope} day_total=$${updated.total_cost_usd.toFixed(4)}`);

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
  if (config.aiProvenance && (outcome.content || outcome.contentHash)) {
    try {
      provenance = await mintProvenance(storage, {
        stampedBy: 'node',
        ownerGhii: gaii,
        // The payer is the human; WHO ASKED is still the agent, and attribution keeps the exact caller.
        principal: plan.agent ? `${plan.agent}#${gaii}` : gaii,
        level: 'ai-generated',
        humanInvolvement: 'none',
        method: 'fully-generated',
        ...(outcome.contentHash ? { contentHash: outcome.contentHash } : { content: outcome.content }),
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
    model: opts.model, modelRole: opts.modelRole, appId: opts.appId, hasImages, agent: opts.agent,
    ...(opts.caller ? { caller: opts.caller } : {}),
    ...(opts.verifiedApp ? { verifiedApp: opts.verifiedApp } : {}),
    ...(opts.provider ? { provider: opts.provider } : {}),
    ...(opts.fallback !== undefined ? { fallback: opts.fallback } : {}),
    ...(opts.capability ? { capability: opts.capability } : {}),
  });
  const { prefs } = plan;

  // The owner's settings are the fallback for every knob the call did not set. `reasoning` arrived
  // 2026-09-09 with the empty-answer fix; its shape is validated where the settings are written
  // (routes/openrouter.ts), so here a non-object is simply not sent. `autoRetry` and `maxRetries`
  // had been on the Tekoäly page since 2026-03 and were read by nothing on the server: the
  // browser's own transport retry was the only thing that ever honoured them. They now govern how
  // many times an answer with no content is asked again, which is the retry an owner setting that
  // name would expect to buy.
  const prefReasoning = prefs.reasoning && typeof prefs.reasoning === 'object' && !Array.isArray(prefs.reasoning)
    ? (prefs.reasoning as CompletionReasoning) : undefined;
  const reasoning = opts.reasoning ?? prefReasoning;
  const retries = typeof opts.retries === 'number' ? opts.retries
    : prefs.autoRetry === false ? 0
      : (typeof prefs.maxRetries === 'number' ? (prefs.maxRetries as number) : undefined);
  let result;
  let answered: AiCallPlan;
  let route: AiRoute;
  try {
    const run = await runRoute({
      storage, gaii, capability: plan.capability, candidates: plan.candidates, chosenBy: plan.chosenBy,
      allowFallback: plan.allowFallback, rules: plan.rules, ...(opts.signal ? { signal: opts.signal } : {}),
    }, (c) => gatewayText({
      target: c.target,
      model: c.model,
      prompt: opts.prompt,
      ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
      ...(opts.images ? { images: opts.images } : {}),
      temperature: opts.temperature ?? (typeof prefs.temperature === 'number' ? prefs.temperature : undefined),
      topP: opts.topP ?? (typeof prefs.top_p === 'number' ? prefs.top_p : undefined),
      maxTokens: typeof opts.maxTokens === 'number' && opts.maxTokens > 0
        ? (opts.maxTokens | 0)
        : (!opts.uncapped && typeof prefs.max_tokens === 'number' ? (prefs.max_tokens as number) : undefined),
      ...(reasoning ? { reasoning } : {}),
      ...(retries !== undefined ? { retries } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }));
    result = run.result;
    answered = planFor(plan, run.candidate);
    route = run.route;
    if (route.fellBack) await recordFailedAttempts(storage, config, gaii, plan, run.failed, { appId: opts.appId, source: 'ai-complete' });
  } catch (e) {
    const moved = e as { route?: AiRoute; failed?: Array<{ candidate: AiCandidate; error: string; costUsd: number }> };
    if (moved.route?.fellBack && moved.failed) await recordFailedAttempts(storage, config, gaii, plan, moved.failed, { appId: opts.appId, source: 'ai-complete' });
    const status = (e as { status?: number }).status;
    if (status === 401) throw new AiCompletionError('INVALID_API_KEY', 401, 'API key was rejected by the provider.');
    if (status === 429) throw new AiCompletionError('RATE_LIMITED', 429, 'Provider rate limit hit. Try again later.');
    // The provider answered, every attempt, with nothing. Its own name so a caller can tell "the
    // model said nothing" from "the provider was down" and act on the finish_reason in the message.
    if ((e as { empty?: boolean }).empty) throw new AiCompletionError('EMPTY_COMPLETION', 502, (e as Error).message);
    throw new AiCompletionError('PROVIDER_ERROR', 502, (e as Error).message);
  }

  const promptTok = result.usage.promptTokens ?? 0;
  const completionTok = result.usage.completionTokens ?? 0;
  const totalTok = result.usage.totalTokens ?? (promptTok + completionTok);
  const costExact = typeof result.usage.costUsd === 'number';
  const costUsd = costExact ? result.usage.costUsd! : estimateCostUsd(promptTok, completionTok);

  const settled = await settleAiCall(storage, config, gaii, answered, {
    model: result.model,
    promptTokens: promptTok, completionTokens: completionTok, totalTokens: totalTok,
    costUsd, content: result.content, appId: opts.appId, source: 'ai-complete',
    costSource: costExact ? 'provider' : 'estimate',
  });
  route.attempts[route.attempts.length - 1].costUsd = costUsd;

  return {
    content: result.content,
    model: result.model,
    finishReason: result.finishReason ?? null,
    truncated: result.finishReason === 'length',
    usage: { promptTokens: promptTok, completionTokens: completionTok, totalTokens: totalTok, costUsd, costExact },
    budget: {
      dailyBudgetUsd: plan.dailyBudgetUsd,
      spentTodayUsd: settled.usage.total_cost_usd,
      remainingUsd: Math.max(0, plan.dailyBudgetUsd - settled.usage.total_cost_usd),
    },
    provenance: settled.provenance,
    keySource: answered.keyScope,
    ...(settled.allowanceRemainingUsd !== undefined
      ? { allowanceRemainingUsd: settled.allowanceRemainingUsd }
      : {}),
    ...(answered.degradedToFree ? { degradedToFreeModel: true } : {}),
    ...(answered.policyChoseModel ? { policyChoseModel: true } : {}),
    route,
  };
}
