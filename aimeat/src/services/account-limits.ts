/**
 * @file src/services/account-limits.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How often one ACCOUNT may do an expensive thing, counted in the service every surface
 *   calls, so a REST route, an MCP tool and a scheduled run draw on one allowance.
 *
 *   WHY. The October 2026 audit found these limits on REST routes only (secaudit 2026-10, C5): a mail
 *   send, an emailed invitation and an AI call each had a path limiter, and the MCP tools that do the
 *   same work never pass the path, so an agent sent without one. The path limiter also counts per
 *   principal, so an owner with N agents had N allowances. Counted here, per owner GHII, an owner and
 *   every agent and app acting for them share one allowance. The pattern is services/message-send-limit.ts.
 *
 *   WHAT IS NOT COUNTED. Work the node does itself (an install set inviting the people it names)
 *   passes `exempt`; the caller says why.
 *
 *   AI CALLS. An AI call that a person or an agent starts directly (a REST route or an MCP tool) is
 *   counted in the AI service function both call, against `config.rateLimits.openrouter` (the number
 *   the REST path limiter had). Node-internal AI work (a schedule, a workflow step, a refinery batch,
 *   a classifier, a background job's run, a provider test's inner call) passes `limit: 'exempt'`,
 *   because it is not one request per call and the limit would break a batch. An extension's
 *   `ctx.ai.start` is counted against its installer (an action is a request anyone the extension
 *   admits can make); only a chain's continuation is exempt, its first start having been counted.
 * @structure AccountLimitRefusal · accountLimiter(name, limit, sentence) · MAIL_SEND_LIMIT ·
 *   INVITE_EMAIL_LIMIT · takeMailSend · takeInviteEmail · AiCallLimitMark · AI_CALL_DEFAULT_LIMIT ·
 *   takeAiCall · requireAiCallTurn · retryAfterOf
 * @usage
 *   const turn = takeMailSend(senderGhii);
 *   if (!turn.ok) return refuse(429, turn.code, turn.message);
 *   requireAiCallTurn(config, gaii, opts.limit);   // throws AiCompletionError RATE_LIMITED 429
 * @version-history
 *   v1.1.1 — 2026-10-06 — The header names the extension start as counted (secaudit 2026-10 follow-up, A5).
 *   v1.1.0 — 2026-10-05 — The AI call limit is counted per account in the service, so the MCP tools share it (secaudit 2026-10, C5).
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, C5).
 */
import type { RateLimitTier } from '../config-types.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { rateBuckets } from './rate-buckets.js';
import { AiCompletionError } from './ai/errors.js';

/** The answer when the account has used its allowance for this window. */
export interface AccountLimitRefusal {
  ok: false;
  code: 'RATE_LIMITED';
  /** Whole seconds until the window ends: the value a Retry-After carries. */
  retryAfterSec: number;
  message: string;
}

export type AccountTurn = { ok: true; account: string } | AccountLimitRefusal;

/**
 * A limiter for one kind of act: `take(principal)` counts one against the principal's account, or
 * answers the refusal with `sentence(max, seconds)` as its message.
 */
export function accountLimiter(
  limit: { windowMs: number; max: number },
  sentence: (max: number, retryAfterSec: number) => string,
): (principal: string) => AccountTurn {
  const take = rateBuckets(limit.windowMs);
  return (principal: string): AccountTurn => {
    const account = ownerGhiiOf(principal);
    const counted = take(account, limit.max);
    if (counted.ok) return { ok: true, account };
    return { ok: false, code: 'RATE_LIMITED', retryAfterSec: counted.retryAfterSec, message: sentence(limit.max, counted.retryAfterSec) };
  };
}

/** Mail sent out through a connected account or the node's own sender: the number POST
 *  /v1/outbound/send always had, now per account and on every surface. */
export const MAIL_SEND_LIMIT = { windowMs: 60_000, max: 30 } as const;

/** Invitations sent by email into an organism: the number POST /v1/organisms/:id/invitations/email had. */
export const INVITE_EMAIL_LIMIT = { windowMs: 10 * 60_000, max: 20 } as const;

export const takeMailSend = accountLimiter(MAIL_SEND_LIMIT, (max, s) =>
  `This account has sent ${max} emails in the last minute, which is the most one account may send. Try again in ${s} seconds.`);

export const takeInviteEmail = accountLimiter(INVITE_EMAIL_LIMIT, (max, s) =>
  `This account has sent ${max} email invitations in the last ten minutes, which is the most one account may send. Try again in ${s} seconds.`);

/**
 * What an AI service is told about the limit. `'exempt'` is node-internal work (see the file
 * header); absent, the service counts the call against the account.
 */
export type AiCallLimitMark = 'exempt';

/** One limiter per distinct limit: the operator can change the number while the node runs
 *  (config-overrides.ts), and a new number starts a new count. */
const aiCallLimiters = new Map<string, (principal: string) => AccountTurn>();

/** The number config.ts gives `rateLimits.openrouter` when AIMEAT_RL_OPENROUTER is unset; used only
 *  when a caller hands in a config without the tier (a partial config in a unit test). */
export const AI_CALL_DEFAULT_LIMIT = { windowMs: 60_000, max: 30 } as const;

/** The config shape the AI call limit reads: only the one tier. */
export interface AiCallLimitConfig { rateLimits?: { openrouter?: RateLimitTier } }

/**
 * Count one AI call, started on a request, against the principal's account. The limit is
 * `config.rateLimits.openrouter` (AIMEAT_RL_OPENROUTER, 30 a minute by default).
 */
export function takeAiCall(config: AiCallLimitConfig, principal: string): AccountTurn {
  const { windowMs, max } = config.rateLimits?.openrouter ?? AI_CALL_DEFAULT_LIMIT;
  const id = `${windowMs}:${max}`;
  let take = aiCallLimiters.get(id);
  if (!take) {
    take = accountLimiter({ windowMs, max }, (m, s) =>
      `This account has started ${m} AI calls in the last minute, which is the most one account may start. Try again in ${s} seconds.`);
    aiCallLimiters.set(id, take);
  }
  return take(principal);
}

/**
 * The AI services' own question: count the call unless it is `'exempt'`, and throw the refusal as
 * AiCompletionError RATE_LIMITED 429 with `details.retry_after_sec`, which every AI route and MCP
 * tool already answers. Called before anything is written or spent.
 */
export function requireAiCallTurn(
  config: AiCallLimitConfig, principal: string, mark: AiCallLimitMark | undefined,
): void {
  if (mark === 'exempt') return;
  const turn = takeAiCall(config, principal);
  if (!turn.ok) throw new AiCompletionError(turn.code, 429, turn.message, { retry_after_sec: turn.retryAfterSec });
}

/** The Retry-After seconds of an AI call refusal, for the route that answers it; undefined otherwise. */
export function retryAfterOf(e: unknown): number | undefined {
  if (!(e instanceof AiCompletionError) || e.code !== 'RATE_LIMITED') return undefined;
  const s = e.details?.retry_after_sec;
  return typeof s === 'number' ? s : undefined;
}
