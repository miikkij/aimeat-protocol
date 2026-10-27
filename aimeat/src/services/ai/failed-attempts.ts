/**
 * @file src/services/ai/failed-attempts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the text attempts that answered nothing and were asked again cost, so
 *   completion.ts recordFailedAttempts writes them as a usage row of their own.
 *
 *   An empty answer is a full provider call: the model read the prompt and may have spent its answer's
 *   length thinking, and the provider bills it. The gateway asks again (ai/gateway.ts text()) and kept
 *   only the attempt it returned, so the empty ones were never recorded and, on the node's key, never
 *   debited from the account's allowance (secaudit2026oct26, gateway.ts:gatewayText:
 *   node-key-empty-answer-attempts-not-debited). They are priced here as an answer is priced
 *   (catalog/price.ts callCost: the provider's charge first) and recorded as one row per candidate.
 * @structure emptyAttemptsCostUsd · withEmptyAttemptsCost · emptyAttemptsCostOf
 * @usage
 *   const run = await runRoute(ctx, (c) => gatewayText(...).catch((e) => { throw withEmptyAttemptsCost(e, c); }), emptyAttemptsCostOf);
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26).
 */
import type { AiCandidate } from './route-plan.js';
import type { EmptyAttempt } from './gateway.js';
import { callCost } from './catalog/price.js';

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
