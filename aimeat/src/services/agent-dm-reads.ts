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
 *   v1.3.0 — 2026-10-27 — An agent without messages:read-as-owner is merged only its owner's rows that
 *     involve the agent or a party it wrote to or heard from in the thread; the rest are counted in
 *     `ownerMessagesWithheld` (secaudit2026oct26). An agent with the word reads as before.
 *   v1.2.0 — 2026-10-26 — The thread and the inbox carry each message's reactions (services/message-reactions.ts).
 *   v1.1.0 — 2026-10-17 — readOneToOneWithOwner: an agent's 1:1 conversation is read from both mailboxes
 *     as one, for the owner and for the agent, so the owner can answer in it and the agent sees the
 *     answer (decision-viestin-puoli-ja-merkint-kertovat-kuka-sen-kirjoitti-ja-omis).
 *   v1.0.0 — 2026-08-22 — Initial: group threads become readable by the agent that is in them.
 */
import type { Storage, DirectMessageRecord } from '../storage/interface.js';
import { isParticipant } from './conversation-group.js';
import { deliveryTargetFor } from '../utils/messaging.js';
import { withReactions } from './message-reactions.js';
import { permissionAskText } from './permission-ask.js';

/** The owner's mailbox permission (services/owner-mailbox-reads.ts), spelled here: that module imports this one. */
const MESSAGES_READ_AS_OWNER_SCOPE = 'messages:read-as-owner';

export interface DmPageOpts {
  page?: number;
  perPage?: number;
}

export type DmPage = { messages: DirectMessageRecord[]; total: number };

/** A thread page, with how many of the owner's messages in it were left out for this agent. */
export type AgentThreadPage = DmPage & { ownerMessagesWithheld?: number };

/**
 * The fields a thread answer carries when the owner's messages were left out: how many, and the ask
 * that tells the agent where its person gives messages:read-as-owner (services/permission-ask.ts).
 * Empty when nothing was left out.
 */
export function withheldOwnerMessagesFields(baseUrl: string, agentGaii: string, tool: string, withheld?: number): Record<string, unknown> {
  if (!withheld) return {};
  return {
    owner_messages_withheld: withheld,
    note: permissionAskText({ baseUrl, agentGaii, tool, words: [MESSAGES_READ_AS_OWNER_SCOPE] }),
  };
}

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
  /** The agent holds messages:read-as-owner: every message its owner keeps in the thread is merged. */
  readsOwnerMailbox = false,
): Promise<AgentThreadPage> {
  const convo = await storage.getConversation(conversationId);
  const page: AgentThreadPage = convo && isParticipant(convo, agentGaii)
    ? await storage.listConversation(deliveryTargetFor(agentGaii), conversationId, opts)
    : await readOneToOneWithOwner(storage, agentGaii, conversationId, opts, readsOwnerMailbox);
  return { ...page, messages: await withReactions(storage, page.messages) };
}

/** How many messages of one conversation are merged from the two mailboxes before the page is cut. */
const MERGE_CAP = 500;

/**
 * An agent's 1:1 conversation is kept in TWO mailboxes: the agent's own sent copies under the agent,
 * and everything else (the other party's replies to the agent, and since 2026-10-17 the owner's own
 * messages and the messages another of the owner's agents sent in the owner's name into the same
 * conversation) under the owner. Read as one: the owner sees the agent's conversation whole and can
 * answer in it, and the agent sees what its owner said there, so it does not lose the thread (Jouni,
 * 2026-10-17: decision-viestin-puoli-ja-merkint-kertovat-kuka-sen-kirjoitti-ja-omis).
 *
 * The owner's rows are added only when the agent itself has a message in the conversation, so an agent
 * never reads an owner's thread it was not part of. Merged by message id (an inbound reply to the agent
 * is in both reads), newest first, then cut to the page.
 *
 * WHICH OF THE OWNER'S ROWS (secaudit2026oct26, readOneToOneWithOwner:caller-chosen-conversation-id-
 * merges-owner-mailbox). A conversation id is a value a sender can name, so "the agent has a row under
 * this id" did not prove the owner's rows under it were the agent's conversation. Without
 * messages:read-as-owner the agent is merged only the owner's rows that involve the agent itself or a
 * party the agent wrote to or heard from in this thread: the replies to it, and its owner's and
 * siblings' messages to the same person. Any other owner row is left out and counted in
 * `ownerMessagesWithheld`, so the door can hand over the address where the owner gives the permission.
 * An agent holding the word reads the merge as before.
 */
export async function readOneToOneWithOwner(
  storage: Storage,
  agentGaii: string,
  conversationId: string,
  opts?: DmPageOpts,
  readsOwnerMailbox = false,
): Promise<AgentThreadPage> {
  const page = Math.max(1, opts?.page ?? 1);
  const perPage = Math.max(1, opts?.perPage ?? 50);
  const own = await storage.listAgentDmThread(agentGaii, conversationId, { page: 1, perPage: MERGE_CAP });
  if (own.messages.length === 0) return storage.listAgentDmThread(agentGaii, conversationId, opts);
  const ownerMailbox = deliveryTargetFor(agentGaii);
  const owners = await storage.listConversation(ownerMailbox, conversationId, { page: 1, perPage: MERGE_CAP });
  // The parties the agent itself wrote to or heard from here, other than itself and its owner.
  const parties = new Set<string>();
  for (const m of own.messages) for (const p of [m.senderGhii, m.recipientGhii]) if (p !== agentGaii && p !== ownerMailbox) parties.add(p);
  const merged = readsOwnerMailbox ? owners.messages : owners.messages.filter(m =>
    m.senderGhii === agentGaii || m.recipientGhii === agentGaii || parties.has(m.senderGhii) || parties.has(m.recipientGhii));
  const withheld = owners.messages.length - merged.length;
  const byId = new Map<string, DirectMessageRecord>();
  // The owner's copy first: it carries the owner's read state. The agent's sent copies exist only under the agent.
  for (const m of merged) byId.set(m.id, m);
  for (const m of own.messages) if (!byId.has(m.id)) byId.set(m.id, m);
  const all = [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { messages: all.slice((page - 1) * perPage, page * perPage), total: all.length, ...(withheld > 0 ? { ownerMessagesWithheld: withheld } : {}) };
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
  const page = !conversationIds.length
    ? await storage.listDmsAddressedTo(agentGaii, opts)
    : await storage.listDmsAddressedTo(agentGaii, {
      ...opts,
      groupScope: { mailboxGhii: deliveryTargetFor(agentGaii), conversationIds },
    });
  return { ...page, messages: await withReactions(storage, page.messages) };
}
