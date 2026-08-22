/**
 * @file agent-dm-reads.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How an AGENT reads the federated inbox: its own thread and its own inbox, group threads
 *   included. One implementation for all three surfaces (the node MCP tools, GET /v1/messages/agent-*,
 *   and the connector's CLI dispatch, which reaches the same routes over HTTP).
 *
 *   A 1:1 message carries the agent's identity on the row: its sent copy is owned by the agent and the
 *   replies name it as recipient, so the two predicates in listAgentDmThread / listDmsAddressedTo find
 *   everything. A GROUP message carries neither. Every copy is written to the mailbox the participant
 *   resolves to (services/conversation-group.ts), which for an agent is its OWNER, and the message is
 *   addressed to the thread rather than to a person, so `recipientGhii` is the thread's own address.
 *   The agent therefore disappears from its own group correspondence: `aimeat_dm_thread` answered 0 for
 *   a conversation id it had just been handed, and `aimeat_dm_inbox` would never have shown the answer.
 *   An agent that cannot read back what it reported cannot tell "not delivered" from "delivered, and
 *   invisible to you" — which is the one distinction a reporting agent needs.
 *
 *   Membership is what replaces the missing identity on the row, and the two doors ask for it
 *   differently on purpose. Reading ONE named thread accepts the owner-resolving isParticipant(): the
 *   rows already live in the shared mailbox and the same test governs writing to the thread. Listing an
 *   inbox uses the exact participant match, so an agent is handed the threads it was itself named in
 *   and never its owner's other group correspondence.
 * @structure
 *   - readAgentDmThread() — one thread as the agent sees it, group or 1:1
 *   - readAgentDmInbox()  — messages addressed to the agent, group threads folded in
 * @usage const { messages, total } = await readAgentDmThread(storage, agentGaii, conversationId, { page, perPage });
 * @version-history
 *   v1.0.0 — 2026-08-22 — Initial: group threads become readable by the agent that is in them.
 */
import type { Storage, DirectMessageRecord } from '../storage/interface.js';
import { isParticipant } from './conversation-group.js';
import { deliveryTargetFor } from '../utils/messaging.js';

export interface DmPageOpts {
  page?: number;
  perPage?: number;
}

export type DmPage = { messages: DirectMessageRecord[]; total: number };

/**
 * One conversation as the calling agent sees it, newest first.
 *
 * A group thread the agent belongs to is read from the mailbox its copies actually landed in. Anything
 * else keeps the 1:1 predicate, so a thread the agent is not in still answers with nothing.
 */
export async function readAgentDmThread(
  storage: Storage,
  agentGaii: string,
  conversationId: string,
  opts?: DmPageOpts,
): Promise<DmPage> {
  const convo = await storage.getConversation(conversationId);
  if (convo && isParticipant(convo, agentGaii)) {
    return storage.listConversation(deliveryTargetFor(agentGaii), conversationId, opts);
  }
  return storage.listAgentDmThread(agentGaii, conversationId, opts);
}

/**
 * Messages ADDRESSED TO the calling agent, newest first, with the group threads it is a named
 * participant of folded in. Its own sends are left out: this is an inbox.
 */
export async function readAgentDmInbox(
  storage: Storage,
  agentGaii: string,
  opts?: DmPageOpts,
): Promise<DmPage> {
  // Exact participant match — the agent must be named in the thread itself. Resolving this by owner
  // would hand it every group thread anyone in the household belongs to.
  const groups = await storage.listConversationsForParticipant(agentGaii);
  const conversationIds = groups.map(g => g.id);
  if (!conversationIds.length) return storage.listDmsAddressedTo(agentGaii, opts);
  return storage.listDmsAddressedTo(agentGaii, {
    ...opts,
    groupScope: { mailboxGhii: deliveryTargetFor(agentGaii), conversationIds },
  });
}
