/**
 * @file src/services/message-thread-binding.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which thread a 1:1 message that names a conversation id lands in (secaudit2026oct26,
 *   agent-dm-reads.ts:readOneToOneWithOwner:caller-chosen-conversation-id-merges-owner-mailbox).
 *
 *   WHY. The send doors (POST /v1/messages, aimeat_dm_send, aimeat_dm_ask) and a peer's delivery took
 *   any conversation id the sender wrote as the thread id. A pair thread's id is a public hash of the
 *   two identities (utils/messaging.ts conversationIdFor), so any sender could compute the id of a
 *   recipient's existing thread with a third party and place a message inside it, and an agent could
 *   place a row under its owner's thread with somebody else.
 *
 *   THE RULE. A named id is kept when it is the pair's own id, when the sender already holds the
 *   thread (its own rows; for an agent its own sends and the messages addressed to it, and its owner's
 *   mailbox when it may read that mailbox), or when no mailbox on this node holds a thread under it
 *   that the sender is not part of (a fresh id, such as a new subject thread). Otherwise the message
 *   is sent all the same, in the pair's own thread. Group threads are routed before this and never
 *   reach it.
 * @structure boundConversationId(storage, input) · boundInboundConversationId(storage, input)
 * @usage
 *   const conversationId = await boundConversationId(storage, { requested, senderGhii, recipientGhii, recipientMailbox, senderReadsOwnerMailbox });
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import type { Storage } from '../storage/interface.js';
import { conversationIdFor, deliveryTargetFor } from '../utils/messaging.js';

type ThreadStorage = Pick<Storage, 'listConversation' | 'listAgentDmThread'>;

/** True when some row of `mailbox` under `id` names nobody of the account `account` (a person and their agents). */
async function holdsThreadWithout(storage: ThreadStorage, mailbox: string, id: string, account: string): Promise<boolean> {
  const { messages } = await storage.listConversation(mailbox, id, { page: 1, perPage: 200 });
  return messages.some(m => deliveryTargetFor(m.senderGhii) !== account && deliveryTargetFor(m.recipientGhii) !== account);
}

/** True when `mailbox` holds any row under `id`. */
async function holdsAny(storage: ThreadStorage, mailbox: string, id: string): Promise<boolean> {
  return (await storage.listConversation(mailbox, id, { page: 1, perPage: 1 })).messages.length > 0;
}

/**
 * The thread id a locally sent 1:1 message lands in. `recipientMailbox` is the recipient's mailbox on
 * this node, or null when the recipient is on another node. `senderReadsOwnerMailbox` is true for an
 * agent that may read its owner's mailbox (messages:read-as-owner); a sender that is not an agent
 * reads its own mailbox anyway.
 */
export async function boundConversationId(storage: ThreadStorage, input: {
  requested: string; senderGhii: string; recipientGhii: string; recipientMailbox: string | null;
  senderReadsOwnerMailbox?: boolean;
}): Promise<string> {
  const { requested, senderGhii, recipientGhii } = input;
  const pair = conversationIdFor(senderGhii, recipientGhii);
  if (requested === pair) return requested;
  const senderMailbox = deliveryTargetFor(senderGhii);
  const isAgent = senderMailbox !== senderGhii;
  // The sender already holds the thread.
  if (isAgent) {
    if ((await storage.listAgentDmThread(senderGhii, requested, { page: 1, perPage: 1 })).messages.length > 0) return requested;
    if (input.senderReadsOwnerMailbox && await holdsAny(storage, senderMailbox, requested)) return requested;
  } else if (await holdsAny(storage, senderGhii, requested)) {
    return requested;
  }
  // A thread under this id that the sender's account is not part of, in the recipient's mailbox; or,
  // for an agent, its owner's thread it may not read: the pair's own thread instead.
  if (input.recipientMailbox && await holdsThreadWithout(storage, input.recipientMailbox, requested, senderMailbox)) return pair;
  if (isAgent && await holdsAny(storage, senderMailbox, requested)) return pair;
  return requested;
}

/**
 * The thread id a message from another node lands in. The peer names the id; it is kept when it is
 * the pair's own id, when the recipient's mailbox holds no thread under it, or when that thread
 * already has the sender in it. Otherwise the pair's own thread.
 */
export async function boundInboundConversationId(storage: ThreadStorage, input: {
  requested: string; senderGhii: string; recipientGhii: string; recipientMailbox: string;
}): Promise<string> {
  const pair = conversationIdFor(input.senderGhii, input.recipientGhii);
  if (input.requested === pair) return input.requested;
  return (await holdsThreadWithout(storage, input.recipientMailbox, input.requested, deliveryTargetFor(input.senderGhii))) ? pair : input.requested;
}
