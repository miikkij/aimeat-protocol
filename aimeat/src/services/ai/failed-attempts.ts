/**
 * @file src/services/ai/failed-attempts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The provider attempts that did not give the answer, as usage rows of their own: the
 *   candidates a route fell back from, and the text attempts that answered nothing and were asked again.
 *
 *   An empty answer is a full provider call: the model read the prompt and may have spent its answer's
 *   length thinking, and the provider bills it. The gateway asks again (ai/gateway.ts text()) and kept
 *   only the attempt it returned, so the empty ones were never recorded and, on the node's key, never
 *   debited from the account's allowance (secaudit2026oct26, gateway.ts:gatewayText:
 *   node-key-empty-answer-attempts-not-debited). They are priced here as an answer is priced
 *   (catalog/price.ts callCost: the provider's charge first) and recorded as one row per candidate.
 * @structure recordFailedAttempts · emptyAttemptsCostUsd · withEmptyAttemptsCost · emptyAttemptsCostOf
 * @usage
 *   const run = await runRoute(ctx, (c) => gatewayText(...).catch((e) => { throw withEmptyAttemptsCost(e, c); }), emptyAttemptsCostOf);
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- recordFailedAttempts moved here from completion.ts unchanged (max-file-lines),
 *     beside the pricing of empty attempts (secaudit2026oct26).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { AiCallPlan } from './call-plan.js';
import type { AiCandidate } from './route-plan.js';
import type { EmptyAttempt } from './gateway.js';
import { callCost } from './catalog/price.js';
import { debitAllowance } from '../ai-allowance.js';
import { recordAiUsage } from '../ai-usage-record.js';

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
      costUsd: f.costUsd, tokens: 0, appId: plan.appId ?? call.appId, model: f.candidate.model, provider: f.candidate.provider.id,
      source: `${call.source}:failed-${f.error}`, apiKeyScope: f.candidate.keyScope, ...(plan.agent ? { agent: plan.agent } : {}),
    }, config);
    if (f.candidate.keyScope === 'node' && f.costUsd > 0) await debitAllowance(storage, config, gaii, f.costUsd);
  }
}

/** What a candidate's attempts that answered nothing cost, each priced as an answer is. */
export function emptyAttemptsCostUsd(c: AiCandidate, attempts: readonly EmptyAttempt[] | undefined): number {
  let usd = 0;
  for (const a of attempts ?? []) {
    usd += callCost({
      type: c.provider.type, model: a.model, requestedModel: c.model,
      promptTokens: a.usage.promptTokens ?? 0, completionTokens: a.usage.completionTokens ?? 0, reported: a.usage.costUsd,
    }).costUsd;
  }
  return usd;
}

/** A failed text call with what its empty attempts cost on it, for runRoute's failedCost. */
export function withEmptyAttemptsCost(e: unknown, c: AiCandidate): unknown {
  const attempts = (e as { emptyAttempts?: EmptyAttempt[] } | null)?.emptyAttempts;
  if (!attempts?.length || !(e instanceof Error)) return e;
  return Object.assign(e, { emptyCostUsd: emptyAttemptsCostUsd(c, attempts) });
}

/** runRoute's failedCost: what the failed attempt's empty answers cost, or 0. */
export function emptyAttemptsCostOf(e: unknown): number {
  const usd = (e as { emptyCostUsd?: unknown } | null)?.emptyCostUsd;
  return typeof usd === 'number' && Number.isFinite(usd) && usd > 0 ? usd : 0;
}
