/**
 * @file src/services/message-send-limit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How many messages one account may send in a minute, on every door that sends one.
 *
 *   WHAT COUNTS. A send that a person, or an agent or app acting for them, asks for: a direct
 *   message, a message into a group thread, and a broadcast, which counts as ONE however many
 *   people it reaches. They all draw on one allowance per ACCOUNT, the owner's GHII: an owner and
 *   every agent and app acting for them share it, so connecting a second agent does not double what
 *   one person can send.
 *
 *   WHY THE ACCOUNT. The tool surface reaches the node over loopback, so a key by address would put
 *   every account in one bucket. A key by principal would give each of an owner's agents an allowance
 *   of its own.
 *
 *   WHAT DOES NOT COUNT. The node's own messages (a welcome, a fault report, a notice about an
 *   exchange, a reply the owner set up to go out automatically), and a send through a door that has
 *   a limit of its own (the outbound send door). Their callers mark the send 'exempt'.
 *
 *   WHERE IT IS ASKED. In the send services every door calls: sendDirectMessage (message-send.ts),
 *   sendGroupMessage (conversation-group.ts) and broadcastFromPrincipal (message-broadcast.ts). A
 *   send that reaches them without a turn is counted there, so no door sends uncounted. A door that
 *   writes something before it calls them (the AI-provenance record, a new support thread) takes the
 *   turn FIRST and hands it on, so a refused send has written nothing (invariant 14, refuse before
 *   you write).
 * @structure MESSAGE_SEND_LIMIT · SendTurn · SendLimitRefusal · SendLimitMark · takeSendTurn(sender)
 *   · checkSendLimit(sender, mark)
 * @usage
 *   const turn = takeSendTurn(senderGhii);
 *   if (!turn.ok) return refuse(turn);
 *   await sendDirectMessage(ctx, { senderGhii, recipientGhii, body, sendLimit: turn });
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (security audit A5-3). The limit sat on POST /v1/messages and
 *     POST /v1/messages/broadcast only, keyed by the principal, and the aimeat_dm_* tools, which
 *     never pass those routes, sent without one.
 */
import { ownerGhiiOf } from '../utils/gaii.js';
import { rateBuckets } from './rate-buckets.js';

/** Sends one account may make in one window, every send door together. The number the outbound send
 *  door has always used (routes/outbound.ts). */
export const MESSAGE_SEND_LIMIT = { windowMs: 60_000, max: 30 } as const;

/** A send counted against its account. A door that took one hands it to the send service, which then
 *  does not count the same send again. */
export interface SendTurn {
  ok: true;
  /** The owner GHII the send was counted against. */
  account: string;
}

/** The answer when the account has used its allowance for this window. */
export interface SendLimitRefusal {
  ok: false;
  code: 'RATE_LIMITED';
  /** Whole seconds until the window ends: the value a Retry-After carries. */
  retryAfterSec: number;
  /** A plain sentence for the sender. */
  message: string;
}

/**
 * What a send tells the send service about the limit: the turn a door took before it wrote anything,
 * or 'exempt' for a send that does not count (see the file header). A send that says neither is
 * counted by the service itself.
 */
export type SendLimitMark = SendTurn | 'exempt';

const take = rateBuckets(MESSAGE_SEND_LIMIT.windowMs);

/** Count one send against the account behind `senderGhii`: an agent, an app and the owner are one. */
export function takeSendTurn(senderGhii: string): SendTurn | SendLimitRefusal {
  const account = ownerGhiiOf(senderGhii);
  const counted = take(account, MESSAGE_SEND_LIMIT.max);
  if (counted.ok) return { ok: true, account };
  return {
    ok: false,
    code: 'RATE_LIMITED',
    retryAfterSec: counted.retryAfterSec,
    message: `This account has sent ${MESSAGE_SEND_LIMIT.max} messages in the last minute, which is `
      + `the most one account may send. Try again in ${counted.retryAfterSec} seconds. A broadcast `
      + 'counts as one message, however many people it reaches.',
  };
}

/**
 * The send services' own question. A send that carries a turn, or is 'exempt', is not counted again;
 * a send that carries neither is counted here. Answers the refusal, or null when the send may go.
 */
export function checkSendLimit(senderGhii: string, mark: SendLimitMark | undefined): SendLimitRefusal | null {
  if (mark !== undefined) return null;
  const turn = takeSendTurn(senderGhii);
  return turn.ok ? null : turn;
}
