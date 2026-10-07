/**
 * @file ai-embed.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Embeddings for a single owner: vectors for a list of texts, through the node's one
 *   gate. prepareAiCall with op `embed` (the provider, the model, the key, the policy, the budget),
 *   the gateway's embed(), settleAiCall (usage and allowance). No provenance record: a vector is not
 *   content anybody reads.
 *
 *   ANOTHER MODEL'S VECTORS ARE NOT COMPARABLE. A fallback to another provider is allowed only for the
 *   same model (services/ai/route-plan.ts), and the answer names the model, so a caller that stores
 *   vectors can store which model made them and embed again when it changes (plan 12, section 4).
 * @structure embedForOwner(storage, config, gaii, opts) · EMBED_LIMITS
 * @usage
 *   const r = await embedForOwner(storage, config, payer, { input: ['a', 'b'], appId: 'notes' });
 * @version-history
 *   v1.5.0 -- 2026-10-07 -- A provider's key refusal is 424 INVALID_API_KEY, not 401 (PROVIDER_KEY_REFUSED_STATUS).
 *   v1.4.0 — 2026-10-05 — The AI call limit is counted per account in the service, so the MCP tools share it (secaudit 2026-10, C5).
 *   v1.3.0 — 2026-10-05 — `caller` is required: every call says who asks (secaudit 2026-10, AI-3).
 *   v1.2.0 — 2026-10-02 — Takes `lang`, so a refusal's sentence is in the person's language.
 *   v1.1.0 — 2026-09-28 — Takes `role`, the AI role the call runs as (services/ai/roles.ts).
 *   v1.0.0 — 2026-09-28 — Initial (V5 of the System 2 plan).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import {
  AiCompletionError, PROVIDER_KEY_REFUSED_STATUS, prepareAiCall, settleAiCall, planFor, recordFailedAttempts, type AiCallPlan,
} from './ai/completion.js';
import { embed as gatewayEmbed } from './ai/gateway.js';
import { runRoute, type AiRoute } from './ai/route-run.js';
import { callCost } from './ai/catalog/price.js';
import type { AiCandidate } from './ai/route-plan.js';
import type { CallerClass } from './ai/policy.js';
import type { RequestLanguage } from './ai/ai-fix-words.js';
import { requireAiCallTurn, type AiCallLimitMark } from './account-limits.js';

/** One call's ceiling: enough for a page of notes, small enough to answer inside a request. */
export const EMBED_LIMITS = { maxInputs: 256, maxTotalChars: 500_000 } as const;

export interface EmbedForOwnerOptions {
  /** The texts, one vector each. */
  input: string[];
  model?: string;
  appId?: string;
  agent?: string;
  caller: CallerClass;
  verifiedApp?: string;
  /** The request's word on the person's language, for a refusal's sentence. */
  lang?: RequestLanguage;
  provider?: string;
  fallback?: boolean;
  /** The AI role the call runs as (services/ai/roles.ts). A named model or provider wins over it. */
  role?: string;
  signal?: AbortSignal;
  /** 'exempt' for node-internal work; absent, the call counts against the account's AI call limit
   *  (services/account-limits.ts). */
  limit?: AiCallLimitMark;
}

export interface EmbedForOwnerResult {
  embeddings: number[][];
  /** The model that made the vectors: store it beside them. */
  model: string;
  dimensions: number;
  usage: { promptTokens: number; costUsd: number; costExact: boolean };
  budget: { dailyBudgetUsd: number; spentTodayUsd: number; remainingUsd: number };
  keySource: 'agent' | 'own' | 'node';
  route: AiRoute;
}

export async function embedForOwner(
  storage: Storage, config: AimeatConfig, gaii: string, opts: EmbedForOwnerOptions,
): Promise<EmbedForOwnerResult> {
  const input = opts.input;
  if (!Array.isArray(input) || input.length === 0 || !input.every(s => typeof s === 'string' && s.length > 0)) {
    throw new AiCompletionError('INVALID_BODY', 400, 'input is required: one text, or a list of non-empty texts.');
  }
  const total = input.reduce((n, s) => n + s.length, 0);
  if (input.length > EMBED_LIMITS.maxInputs || total > EMBED_LIMITS.maxTotalChars) {
    throw new AiCompletionError('INPUT_TOO_LARGE', 400,
      `One call takes at most ${EMBED_LIMITS.maxInputs} texts and ${EMBED_LIMITS.maxTotalChars} characters; this had ${input.length} and ${total}. Split it into several calls.`);
  }
  // POST /v1/ai/embed and aimeat_ai_embed both arrive here: one count per account, before any spend.
  requireAiCallTurn(config, gaii, opts.limit);

  const plan = await prepareAiCall(storage, config, gaii, {
    op: 'embed', model: opts.model, appId: opts.appId, ...(opts.agent ? { agent: opts.agent } : {}),
    caller: opts.caller, ...(opts.verifiedApp ? { verifiedApp: opts.verifiedApp } : {}),
    ...(opts.lang ? { lang: opts.lang } : {}),
    ...(opts.provider ? { provider: opts.provider } : {}), ...(opts.fallback !== undefined ? { fallback: opts.fallback } : {}),
    ...(opts.role ? { role: opts.role } : {}),
  });
  let result;
  let answered: AiCallPlan;
  let route: AiRoute;
  try {
    const run = await runRoute({
      storage, gaii, capability: plan.capability, candidates: plan.candidates, chosenBy: plan.chosenBy,
      allowFallback: plan.allowFallback, rules: plan.rules, ...(opts.signal ? { signal: opts.signal } : {}),
    }, (c) => gatewayEmbed({ target: c.target, model: c.model, input, ...(opts.signal ? { signal: opts.signal } : {}) }));
    result = run.result;
    answered = planFor(plan, run.candidate);
    route = run.route;
    if (route.fellBack) await recordFailedAttempts(storage, config, gaii, plan, run.failed, { appId: opts.appId, source: 'ai-embed' });
  } catch (e) {
    const moved = e as { route?: AiRoute; failed?: Array<{ candidate: AiCandidate; error: string; costUsd: number }> };
    if (moved.route?.fellBack && moved.failed) await recordFailedAttempts(storage, config, gaii, plan, moved.failed, { appId: opts.appId, source: 'ai-embed' });
    const status = (e as { status?: number }).status;
    if (status === 401) throw new AiCompletionError('INVALID_API_KEY', PROVIDER_KEY_REFUSED_STATUS, 'API key was rejected by the provider.');
    if (status === 429) throw new AiCompletionError('RATE_LIMITED', 429, 'Provider rate limit hit. Try again later.');
    throw new AiCompletionError('PROVIDER_ERROR', 502, (e as Error).message);
  }

  // A provider that reports no token count is estimated at a quarter of the characters.
  const promptTokens = result.usage.promptTokens ?? Math.ceil(total / 4);
  const price = callCost({ type: answered.providerType, model: result.model, requestedModel: answered.model, promptTokens, completionTokens: 0, reported: result.usage.costUsd });
  const settled = await settleAiCall(storage, config, gaii, answered, {
    model: result.model, promptTokens, completionTokens: 0, totalTokens: promptTokens,
    costUsd: price.costUsd, content: '', appId: opts.appId, source: 'ai-embed',
    costSource: price.costSource, priceRef: price.priceRef,
  });
  return {
    embeddings: result.embeddings,
    model: result.model,
    dimensions: result.embeddings[0]?.length ?? 0,
    usage: { promptTokens, costUsd: price.costUsd, costExact: price.costSource === 'provider' },
    budget: {
      dailyBudgetUsd: plan.dailyBudgetUsd,
      spentTodayUsd: settled.usage.total_cost_usd,
      remainingUsd: Math.max(0, plan.dailyBudgetUsd - settled.usage.total_cost_usd),
    },
    keySource: answered.keyScope,
    route: { ...route, attempts: route.attempts.map(a => a.ok ? { ...a, costUsd: price.costUsd } : a) },
  };
}
