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
 * @structure AccountLimitRefusal · accountLimiter(name, limit, sentence) · MAIL_SEND_LIMIT ·
 *   INVITE_EMAIL_LIMIT · takeMailSend · takeInviteEmail
 * @usage
 *   const turn = takeMailSend(senderGhii);
 *   if (!turn.ok) return refuse(429, turn.code, turn.message);
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, C5).
 */
import { ownerGhiiOf } from '../utils/gaii.js';
import { rateBuckets } from './rate-buckets.js';

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
