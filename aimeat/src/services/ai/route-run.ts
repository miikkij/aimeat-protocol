/**
 * @file route-run.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Trying a planned call's candidates in order (docs/internal/llmproviderintegrations/
 *   11, sections 7, 8 and 10). The caller hands in one attempt as a function; this decides whether a
 *   failure moves to the next candidate, keeps each capability's health, and reports the route: who
 *   chose, who answered, and every attempt with its cost.
 *
 *   WHAT MOVES ON: a timeout, a rate limit, a server error, an unavailable provider and a refused key,
 *   as far as the owner's `fallbackOn` lists them. WHAT NEVER DOES: a bad request (the next provider
 *   refuses the same request), a content refusal (looking for a provider that accepts refused
 *   content would be a way round the refusal), a cancel by the caller, and a stream that has already
 *   sent its first byte (the proxy and the voice stream decide that themselves: they call this only
 *   before the first byte).
 * @structure
 *   AttemptRecord · AiRoute · classifyFailure · runRoute · routeOf
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V3 of the System 2 plan).
 */
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { healthKey, recordFailure, recordSuccess, type FailureClass } from './health.js';
import { persistHealth } from './provider-store.js';
import type { AiCandidate, ChosenBy } from './route-plan.js';
import type { RoutingRules } from './routing.js';
import type { AiCapability } from './types.js';

export interface AttemptRecord {
  provider: string;
  model: string;
  ok?: true;
  error?: FailureClass;
  costUsd: number;
}

/** What every answer and usage record says about how it was reached (plan 11, section 10). */
export interface AiRoute {
  capability: AiCapability;
  chosenBy: ChosenBy;
  answeredBy: { provider: string; model: string } | null;
  attempts: AttemptRecord[];
  fellBack: boolean;
}

const CONTENT_REFUSAL = /moderation|flagged|content[ _-]?policy|content_filter|safety system|responsible ai/i;

/** What one failure was, as the rules name it. */
export function classifyFailure(e: unknown, callerSignal?: AbortSignal): FailureClass {
  if (callerSignal?.aborted) return 'cancelled';
  const err = e as { status?: unknown; name?: unknown; message?: unknown; empty?: unknown; code?: unknown; cause?: { code?: unknown } };
  const message = typeof err?.message === 'string' ? err.message : String(e);
  if (err?.name === 'TimeoutError' || /timed? ?out|aborted due to timeout/i.test(message)) return 'timeout';
  if (err?.empty) return 'empty';
  const status = typeof err?.status === 'number' ? err.status : undefined;
  if (status === 429) return 'rate_limit';
  if (status !== undefined && status >= 400 && status < 500 && CONTENT_REFUSAL.test(message)) return 'content';
  if (status === 401 || status === 403) return 'auth';
  if (status === 503 || status === 529) return 'unavailable';
  if (status !== undefined && status >= 500) return 'server_error';
  if (status !== undefined && status >= 400) return 'bad_request';
  const code = String(err?.code ?? err?.cause?.code ?? '');
  if (/ECONNREFUSED|ENOTFOUND|ECONNRESET|EHOSTUNREACH|ETIMEDOUT/.test(code) || /fetch failed|socket hang up/i.test(message)) return 'unavailable';
  return 'other';
}

export interface RunContext {
  storage: Storage;
  gaii: string;
  capability: AiCapability;
  candidates: AiCandidate[];
  chosenBy: ChosenBy;
  allowFallback: boolean;
  rules: RoutingRules;
  signal?: AbortSignal;
}

export interface RunOutcome<T> {
  result: T;
  candidate: AiCandidate;
  route: AiRoute;
  /** The attempts that failed before the answer, for the usage record. */
  failed: Array<{ candidate: AiCandidate; error: FailureClass; costUsd: number }>;
}

/** The capability's new health, written to the owner's record only when the status changed. */
function noteHealth(ctx: RunContext, c: AiCandidate, outcome: { ok: true } | { error: FailureClass; message: string }): void {
  const scope = c.provider.source === 'owner' ? ctx.gaii : 'node';
  const key = healthKey(scope, c.provider.id, ctx.capability);
  const at = new Date().toISOString();
  const changed = 'ok' in outcome ? recordSuccess(key) : recordFailure(key, outcome.error);
  if (!changed || c.provider.source !== 'owner') return;
  void persistHealth(ctx.storage, ctx.gaii, c.provider.id, ctx.capability, 'ok' in outcome
    ? { status: changed, lastOkAt: at }
    : { status: changed, lastError: { code: outcome.error, at, message: outcome.message.slice(0, 300) } });
}

export function routeOf(ctx: Pick<RunContext, 'capability' | 'chosenBy'>, attempts: AttemptRecord[]): AiRoute {
  const ok = attempts.find(a => a.ok);
  return {
    capability: ctx.capability, chosenBy: ctx.chosenBy,
    answeredBy: ok ? { provider: ok.provider, model: ok.model } : null,
    attempts, fellBack: attempts.length > 1,
  };
}

/**
 * Run the attempt against each candidate until one answers or the rules stop. On the final failure
 * the last error is thrown with `route` and `failed` on it, so the caller can record the attempts
 * and say what happened.
 */
export async function runRoute<T>(
  ctx: RunContext,
  attempt: (c: AiCandidate) => Promise<T>,
  /** The charge a failed attempt reported, when the provider said (an image that timed out may be billed). */
  failedCost: (e: unknown) => number = () => 0,
): Promise<RunOutcome<T>> {
  const attempts: AttemptRecord[] = [];
  const failed: RunOutcome<T>['failed'] = [];
  const list = ctx.allowFallback ? ctx.candidates.slice(0, ctx.rules.maxAttempts) : ctx.candidates.slice(0, 1);
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    try {
      const result = await attempt(c);
      noteHealth(ctx, c, { ok: true });
      attempts.push({ provider: c.provider.id, model: c.model, ok: true, costUsd: 0 });
      return { result, candidate: c, route: routeOf(ctx, attempts), failed };
    } catch (e) {
      const cls = classifyFailure(e, ctx.signal);
      const costUsd = failedCost(e);
      noteHealth(ctx, c, { error: cls, message: e instanceof Error ? e.message : String(e) });
      attempts.push({ provider: c.provider.id, model: c.model, error: cls, costUsd });
      failed.push({ candidate: c, error: cls, costUsd });
      const next = list[i + 1];
      if (!next || !ctx.rules.fallbackOn.includes(cls)) {
        throw Object.assign(e instanceof Error ? e : new Error(String(e)), { route: routeOf(ctx, attempts), failed });
      }
      logger.warn(`[ai] ${c.provider.id} failed (${cls}) for ${ctx.capability}; trying ${next.provider.id}`, { owner: ctx.gaii });
    }
  }
  // Unreachable: the loop returns or throws on its last candidate. An empty list is prepareAiCall's refusal.
  throw new Error('No candidate to try.');
}
