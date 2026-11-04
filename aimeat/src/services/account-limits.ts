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
 *   ACROSS PROCESSES. Each limiter has an `OnNode` form that counts in the node's storage
 *   (services/ephemeral-claims.ts) and a synchronous form that counts in this process (takeMailSend,
 *   takeInviteEmail, takeAiCall, requireAiCallTurn), with the same window, limit and answer; with no
 *   storage registered both count in one place. The services call the `OnNode` forms, so N processes of
 *   one node allow each limit once, not N times (codebase analysis 2026-11-03, high-availability
 *   report section 2d).
 * @structure AccountLimitRefusal · AccountLimiter · accountLimiter(kind, limit, sentence) ·
 *   MAIL_SEND_LIMIT · INVITE_EMAIL_LIMIT · takeMailSend · takeMailSendOnNode ·
 *   takeInviteEmail · takeInviteEmailOnNode · AiCallLimitMark · AI_CALL_DEFAULT_LIMIT · takeAiCall ·
 *   takeAiCallOnNode · requireAiCallTurn · requireAiCallTurnOnNode · retryAfterOf
 * @usage
 *   const turn = await takeMailSendOnNode(senderGhii);
 *   if (!turn.ok) return refuse(429, turn.code, turn.message);
 *   await requireAiCallTurnOnNode(config, gaii, opts.limit);   // throws AiCompletionError RATE_LIMITED 429
 * @version-history
 *   v1.2.0 — 2026-11-04 — The `OnNode` forms count in the node's storage, and the services call them
 *     (codebase analysis 2026-11-03, HA stage 2).
 *   v1.1.1 — 2026-10-06 — The header names the extension start as counted (secaudit 2026-10 follow-up, A5).
 *   v1.1.0 — 2026-10-05 — The AI call limit is counted per account in the service, so the MCP tools share it (secaudit 2026-10, C5).
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, C5).
 */
import type { RateLimitTier } from '../config-types.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { rateTakeOf, type RateTake } from './rate-buckets.js';
import { AiCompletionError } from './ai/errors.js';
import { windowCounter } from './ephemeral-claims.js';

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
 * A limiter for one kind of act. Called, it counts one against the principal's account across every
 * process of the node, in the node's storage (services/ephemeral-claims.ts windowCounter, under
 * `kind`), and answers the turn or the refusal with `sentence(max, seconds)` as its message. `here`
 * counts the same way in this process's memory, which is also where the node-wide form counts when
 * no storage is registered, so the two forms share one count there.
 *
 * The window is the one services/rate-buckets.ts keeps: it starts at the first call and a call after
 * its end starts a new one. The key names the window and the limit, so a changed number starts a new
 * count (the operator can change the AI call limit while the node runs, config-overrides.ts).
 */
export interface AccountLimiter {
  (principal: string): Promise<AccountTurn>;
  here(principal: string): AccountTurn;
}

export function accountLimiter(
  kind: string,
  limit: { windowMs: number; max: number },
  sentence: (max: number, retryAfterSec: number) => string,
): AccountLimiter {
  const counter = windowCounter(kind);
  const keyOf = (account: string): string => `${limit.windowMs}:${limit.max}:${account}`;
  // A window ends when now passes its end (rate-buckets.ts): staleBefore now.
  const answer = (account: string, c: { count: number; expiresAt: number }, now: number): AccountTurn =>
    turnOf(account, rateTakeOf(c.count, c.expiresAt, limit.max, now), limit.max, sentence);
  const onNode = async (principal: string): Promise<AccountTurn> => {
    const account = ownerGhiiOf(principal);
    const now = Date.now();
    return answer(account, await counter.bump(keyOf(account), { windowMs: limit.windowMs, now, staleBefore: now }), now);
  };
  return Object.assign(onNode, {
    here(principal: string): AccountTurn {
      const account = ownerGhiiOf(principal);
      const now = Date.now();
      return answer(account, counter.here.bump(keyOf(account), { windowMs: limit.windowMs, now, staleBefore: now }), now);
    },
  });
}

function turnOf(account: string, counted: RateTake, max: number, sentence: (max: number, retryAfterSec: number) => string): AccountTurn {
  if (counted.ok) return { ok: true, account };
  return { ok: false, code: 'RATE_LIMITED', retryAfterSec: counted.retryAfterSec, message: sentence(max, counted.retryAfterSec) };
}

/** Mail sent out through a connected account or the node's own sender: the number POST
 *  /v1/outbound/send always had, now per account and on every surface. */
export const MAIL_SEND_LIMIT = { windowMs: 60_000, max: 30 } as const;

/** Invitations sent by email into an organism: the number POST /v1/organisms/:id/invitations/email had. */
export const INVITE_EMAIL_LIMIT = { windowMs: 10 * 60_000, max: 20 } as const;

const mailSentence = (max: number, s: number): string =>
  `This account has sent ${max} emails in the last minute, which is the most one account may send. Try again in ${s} seconds.`;
const inviteSentence = (max: number, s: number): string =>
  `This account has sent ${max} email invitations in the last ten minutes, which is the most one account may send. Try again in ${s} seconds.`;

const mailLimiter = accountLimiter('limit:mail-send', MAIL_SEND_LIMIT, mailSentence);
const inviteLimiter = accountLimiter('limit:invite-email', INVITE_EMAIL_LIMIT, inviteSentence);

/** One mail sent, counted in this process only. The services count with takeMailSendOnNode. */
export const takeMailSend = (principal: string): AccountTurn => mailLimiter.here(principal);
/** One mail sent, counted across every process of the node. */
export const takeMailSendOnNode = (principal: string): Promise<AccountTurn> => mailLimiter(principal);

/** One emailed invitation, counted in this process only. The services count with takeInviteEmailOnNode. */
export const takeInviteEmail = (principal: string): AccountTurn => inviteLimiter.here(principal);
/** One emailed invitation, counted across every process of the node. */
export const takeInviteEmailOnNode = (principal: string): Promise<AccountTurn> => inviteLimiter(principal);

/**
 * What an AI service is told about the limit. `'exempt'` is node-internal work (see the file
 * header); absent, the service counts the call against the account.
 */
export type AiCallLimitMark = 'exempt';

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
  return aiCallLimiter(config).here(principal);
}

/** takeAiCall counted across every process of the node, under the same limit and in the same count. */
export function takeAiCallOnNode(config: AiCallLimitConfig, principal: string): Promise<AccountTurn> {
  return aiCallLimiter(config)(principal);
}

const aiCallSentence = (m: number, s: number): string =>
  `This account has started ${m} AI calls in the last minute, which is the most one account may start. Try again in ${s} seconds.`;

/** The limiter for the configured AI call limit. Its key names the window and the limit, so a new
 *  number (the operator can change it while the node runs, config-overrides.ts) starts a new count. */
function aiCallLimiter(config: AiCallLimitConfig): AccountLimiter {
  const { windowMs, max } = config.rateLimits?.openrouter ?? AI_CALL_DEFAULT_LIMIT;
  return accountLimiter('limit:ai-call', { windowMs, max }, aiCallSentence);
}

/** The refusal requireAiCallTurn throws. */
function aiCallRefusal(turn: AccountLimitRefusal): AiCompletionError {
  return new AiCompletionError(turn.code, 429, turn.message, { retry_after_sec: turn.retryAfterSec });
}

/**
 * The AI services' own question: count the call unless it is `'exempt'`, and throw the refusal as
 * AiCompletionError RATE_LIMITED 429 with `details.retry_after_sec`, which every AI route and MCP
 * tool already answers. Called before anything is written or spent. Counts in this process only; the
 * services ask requireAiCallTurnOnNode.
 */
export function requireAiCallTurn(
  config: AiCallLimitConfig, principal: string, mark: AiCallLimitMark | undefined,
): void {
  if (mark === 'exempt') return;
  const turn = takeAiCall(config, principal);
  if (!turn.ok) throw aiCallRefusal(turn);
}

/** requireAiCallTurn counted across every process of the node. */
export async function requireAiCallTurnOnNode(
  config: AiCallLimitConfig, principal: string, mark: AiCallLimitMark | undefined,
): Promise<void> {
  if (mark === 'exempt') return;
  const turn = await takeAiCallOnNode(config, principal);
  if (!turn.ok) throw aiCallRefusal(turn);
}

/** The Retry-After seconds of an AI call refusal, for the route that answers it; undefined otherwise. */
export function retryAfterOf(e: unknown): number | undefined {
  if (!(e instanceof AiCompletionError) || e.code !== 'RATE_LIMITED') return undefined;
  const s = e.details?.retry_after_sec;
  return typeof s === 'number' ? s : undefined;
}
