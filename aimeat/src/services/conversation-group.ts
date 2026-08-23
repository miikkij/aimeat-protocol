/**
 * @file conversation-group.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A conversation with more than two participants: people and AIs in one thread, each
 *   holding their own mailbox copy of every message.
 *
 *   Direct messaging was built for a pair. The thread id is a hash of the two sorted identities
 *   (utils/messaging.ts conversationIdFor), which is elegant for two and cannot express three. This
 *   file adds the n-party case WITHOUT touching the pair case: a group thread stores a
 *   ConversationRecord, a pair thread stores nothing and still derives its id, and the absence of a
 *   record is what says which one you are looking at.
 *
 *   What is deliberately unchanged: delivery stays per person. Every participant gets their own row,
 *   so read state, deletion and the inbox query are the ones already written and tested — a group is
 *   n mailboxes, not a new kind of mailbox.
 *
 *   What is deliberately different: `recipientGhii` on every copy is the THREAD's address (the alias
 *   it was opened through, or `group:<id>`), the same value in each copy. In a pair, recipientGhii
 *   answers "who is the other one", and in a group there is no such person. Naming the thread keeps
 *   the field meaningful ("this was addressed to support") and makes every participant's list agree,
 *   at the cost of the conversations list showing the thread rather than a peer — which is what a
 *   group is.
 * @structure
 *   - createGroupConversation() — open a thread with a membership
 *   - sendGroupMessage() — one message, one copy per participant mailbox
 *   - fanOutToParticipants() — the shared write: one copy per mailbox, notify, wake the agents
 *   - setParticipants() — replace the membership (a support thread re-resolves its operators)
 *   - threadAddressFor() — the address a group's copies carry
 * @usage
 *   const convo = await createGroupConversation(ctx, { createdBy, participants, subject });
 *   await sendGroupMessage(ctx, { conversationId: convo.id, senderGhii, body });
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial: group threads, built for support@operators and for any thread
 *     with several people and AIs in it.
 *   v1.1.0 — 2026-08-23 — Two refusals that hit the one-owner node hardest. A mailbox shared by
 *     several participants now tells the ones who did not write it: an owner whose OWN agent posted
 *     to support@operators was skipped as "the sender" and got no row worth reading, no bell and
 *     delivered:0. And a NAMED thread may have a single participant, because a role with one holder
 *     is still the role. Fan-out extracted so the next caller (an inbound support frame from a peer)
 *     writes copies the same way rather than a second time.
 */
import { randomUUID } from 'node:crypto';
import type { ConversationRecord, DirectMessageAttachment, InteractivePayload } from '../storage/interface.js';
import type { DeliveryCtx } from './message-delivery.js';
import { isSameOwner, parseGaiiLoose } from '../utils/gaii.js';
import { deliveryTargetFor, messagePreviewWithAttachments } from '../utils/messaging.js';
import { notify } from './notify.js';
import { emitChange, emitDelivery } from './event-bus.js';
import { messagePreview } from '../utils/messaging.js';

/** The maximum number of identities in one group thread. High enough for a team plus its AIs, low
 *  enough that a single send stays one bounded write rather than an unbounded fan-out. */
export const MAX_GROUP_PARTICIPANTS = 64;

/**
 * The address every copy of a group message carries as its recipient.
 *
 * An aliased thread keeps the alias, because that is what the sender actually wrote and it stays
 * true after the membership behind it changes. An ad-hoc group has no such name, so it carries its
 * own id — never a participant, which would make one member look like the addressee.
 */
export function threadAddressFor(convo: Pick<ConversationRecord, 'id' | 'alias'>): string {
  return convo.alias ?? `group:${convo.id}`;
}

/**
 * May `identity` read and write in this thread?
 *
 * An owner's agent counts as the owner: a participant listed as `alice@node` is joined by
 * `bot#alice@node`, because an agent acts for the person who owns it and the two share a mailbox
 * anyway (delivery resolves an agent to its owner). The reverse holds too — a thread that named an
 * agent admits the human behind it, who can already read the mailbox the copy landed in.
 */
export function isParticipant(convo: ConversationRecord, identity: string): boolean {
  return convo.participants.some(p => p === identity || isSameOwner(p, identity));
}

export type GroupSendResult =
  | { ok: true; messageId: string; delivered: number }
  | { ok: false; code: 'CONVERSATION_NOT_FOUND' | 'NOT_A_PARTICIPANT' };

export interface CreateGroupInput {
  createdBy: string;
  participants: string[];
  subject?: string;
  /** The named address this thread was opened through (`support@operators`), when there was one. */
  alias?: string;
}

export type CreateGroupResult =
  | { ok: true; conversation: ConversationRecord }
  | { ok: false; code: 'TOO_FEW_PARTICIPANTS' | 'TOO_MANY_PARTICIPANTS' | 'CROSS_NODE_UNSUPPORTED'; message: string };

/**
 * Open a group thread.
 *
 * The creator is always a member, whether or not the caller listed them: a thread you cannot read is
 * not a thread you opened. Duplicates collapse, because membership is a set.
 *
 * LIMIT, stated rather than discovered: every participant must live on THIS node. A group is n
 * mailbox copies written in one pass, and a copy on a peer node is a federation frame with its own
 * delivery, retry and membership-agreement problem. That is a separate piece of work; refusing it
 * here is better than half-delivering a thread and calling it sent.
 *
 * A NAMED thread may have one participant. `support@operators` on a node with a single operator
 * resolves to that one person, and the creator IS that person, so the membership collapses to one
 * and the old floor of two refused it with 503 NO_OPERATORS: the only operator of a node could not
 * write to their own support address. A name is addressed to a ROLE, and a role with one holder is
 * still the role. An UNNAMED ad-hoc group of one is a mistake and still refuses.
 */
export async function createGroupConversation(ctx: DeliveryCtx, input: CreateGroupInput): Promise<CreateGroupResult> {
  const { config, storage } = ctx;
  const participants = [...new Set([input.createdBy, ...input.participants].map(p => p.trim()).filter(Boolean))];

  const floor = input.alias ? 1 : 2;
  if (participants.length < floor) {
    return {
      ok: false, code: 'TOO_FEW_PARTICIPANTS',
      message: floor === 1
        ? 'A conversation needs at least one participant'
        : 'A conversation needs at least two participants',
    };
  }
  if (participants.length > MAX_GROUP_PARTICIPANTS) {
    return { ok: false, code: 'TOO_MANY_PARTICIPANTS', message: `A conversation holds at most ${MAX_GROUP_PARTICIPANTS} participants` };
  }
  const foreign = participants.filter(p => parseGaiiLoose(p).node !== config.nodeId);
  if (foreign.length) {
    return {
      ok: false, code: 'CROSS_NODE_UNSUPPORTED',
      message: `A group conversation is currently node-local; these participants are on another node: ${foreign.join(', ')}`,
    };
  }

  const now = new Date().toISOString();
  const conversation = await storage.createConversation({
    id: randomUUID(),
    kind: 'group',
    subject: input.subject,
    participants,
    createdBy: input.createdBy,
    alias: input.alias,
    createdAt: now,
    updatedAt: now,
  });
  emitChange('messages');
  return { ok: true, conversation };
}

export interface GroupSendInput {
  conversationId: string;
  senderGhii: string;
  body: string;
  attachments?: DirectMessageAttachment[];
  interactive?: InteractivePayload;
  replyToId?: string;
  aiProvenanceId?: string;
}

/**
 * Post one message into a group thread: one mailbox copy per participant, one shared message id.
 *
 * Mailboxes are DE-DUPLICATED before writing. A thread can name both `alice@node` and
 * `bot#alice@node`, and both resolve to Alice's mailbox — two rows would collide on the (id,
 * ownerGhii) primary key and the second write would throw halfway through a delivered send.
 *
 * There is no first-contact gate here, and that is the point rather than an omission: the gate asks
 * "do you accept mail from this stranger", and joining a thread has already answered it. A support
 * thread is the clearest case — someone asking for help must not land in a request queue nobody
 * opens, which is exactly how the feedback channel accumulated seven unanswered reports.
 */
export async function sendGroupMessage(ctx: DeliveryCtx, input: GroupSendInput): Promise<GroupSendResult> {
  const { config, storage } = ctx;
  const convo = await storage.getConversation(input.conversationId);
  if (!convo) return { ok: false, code: 'CONVERSATION_NOT_FOUND' };
  if (!isParticipant(convo, input.senderGhii)) return { ok: false, code: 'NOT_A_PARTICIPANT' };

  const id = randomUUID();
  const now = new Date().toISOString();

  const { delivered } = await fanOutToParticipants(ctx, convo, {
    id,
    senderGhii: input.senderGhii,
    recipientGhii: threadAddressFor(convo),
    body: input.body,
    attachments: input.attachments,
    interactive: input.interactive,
    replyToId: input.replyToId,
    aiProvenanceId: input.aiProvenanceId,
    origin: 'local',
    originNodeId: config.nodeId,
    createdAt: now,
    deliveredAt: now,
  });

  await storage.updateConversation(convo.id, {});
  emitChange('messages');
  return { ok: true, messageId: id, delivered };
}

export interface FanOutMessage {
  id: string;
  senderGhii: string;
  /** What every copy names as its recipient: the thread's address, the same value in each copy. */
  recipientGhii: string;
  body: string;
  attachments?: DirectMessageAttachment[];
  interactive?: InteractivePayload;
  replyToId?: string;
  aiProvenanceId?: string;
  /** 'local' when this node produced the message, 'federation' when it arrived signed from a peer. */
  origin: 'local' | 'federation';
  originNodeId: string;
  createdAt: string;
  deliveredAt: string;
}

/**
 * Write one message into every participant's mailbox, tell the people who did not write it, and wake
 * the AIs among them. The single write path for a group thread, whoever produced the message.
 *
 * MAILBOXES ARE SHARED, and that is where this went wrong. A thread can name both `alice@node` and
 * `bot#alice@node`, and both resolve to Alice's mailbox; two rows would collide on the (id, ownerGhii)
 * primary key, so there is exactly one copy per MAILBOX. The old code therefore kept the first
 * participant it saw per mailbox and skipped the mailbox entirely when it was the sender's own. On a
 * one-owner node that is the common case rather than an edge: the owner's agent writes to
 * `support@operators`, agent and owner collapse into one mailbox, the mailbox reads as "the sender",
 * and the human was told nothing while the agent was told `delivered: 0`.
 *
 * So a mailbox now maps to EVERY identity behind it, and the three decisions are made per identity:
 *   - the copy is written once per mailbox, `outbound` when the sender lives there (the message did
 *     leave this account) and `inbound` otherwise;
 *   - the mailbox OWNER is notified unless the owner is literally the sender, so an agent writing in
 *     your name rings your bell and your own message does not;
 *   - every agent identity in the mailbox other than the sender is woken over its connect tunnel.
 *
 * A mailbox holding nobody but the sender is skipped and uncounted: there is no one there to tell.
 */
export async function fanOutToParticipants(
  ctx: DeliveryCtx,
  convo: ConversationRecord,
  msg: FanOutMessage,
): Promise<{ delivered: number }> {
  const { storage } = ctx;
  const senderMailbox = deliveryTargetFor(msg.senderGhii);

  // Mailbox → every participant identity that resolves to it. An agent in the thread is woken by
  // name even though its copy lives in its owner's mailbox.
  const mailboxes = new Map<string, string[]>();
  for (const participant of convo.participants) {
    const mailbox = deliveryTargetFor(participant);
    const members = mailboxes.get(mailbox);
    if (members) { if (!members.includes(participant)) members.push(participant); } else mailboxes.set(mailbox, [participant]);
  }

  let delivered = 0;
  for (const [mailbox, members] of mailboxes) {
    await storage.createDirectMessage({
      id: msg.id,
      ownerGhii: mailbox,
      conversationId: convo.id,
      subject: convo.subject,
      senderGhii: msg.senderGhii,
      recipientGhii: msg.recipientGhii,
      body: msg.body,
      attachments: msg.attachments,
      interactive: msg.interactive,
      respondable: true,
      status: 'delivered',
      direction: mailbox === senderMailbox ? 'outbound' : 'inbound',
      replyToId: msg.replyToId,
      origin: msg.origin,
      originNodeId: msg.originNodeId,
      aiProvenanceId: msg.aiProvenanceId,
      createdAt: msg.createdAt,
      deliveredAt: msg.deliveredAt,
    });

    // Everyone in this mailbox who is not the author. Empty means the sender lives here alone.
    const others = members.filter(m => m !== msg.senderGhii);
    if (!others.length) continue;
    delivered++;

    // The human is told unless the human IS the author. `senderMailbox === mailbox` is not that test:
    // an agent's copy lands in its owner's mailbox, and the owner did not write it.
    if (msg.senderGhii !== mailbox) {
      await notify(storage, mailbox, {
        type: 'direct_message',
        title: convo.subject ? `${convo.subject} — ${msg.senderGhii}` : `New message from ${msg.senderGhii}`,
        body: messagePreviewWithAttachments(msg.body, msg.attachments),
        link: `/v1/profile#inbox/${convo.id}`,
        actions: [{ id: 'reply', label: 'Reply', kind: 'reply', to: msg.recipientGhii, conversationId: convo.id, subject: convo.subject, replyTo: msg.id }],
      });
    }

    // An agent participant is woken over its connect tunnel, the same signal a 1:1 DM sends, so a
    // thread with an AI in it does not wait for that AI to poll.
    for (const member of others) {
      if (member === mailbox) continue;
      emitDelivery({
        target: member, kind: 'dm.inbound', id: msg.id,
        payload: {
          id: msg.id, conversationId: convo.id, subject: convo.subject ?? null, senderGhii: msg.senderGhii,
          preview: messagePreview(msg.body), attachments: msg.attachments?.length ?? 0, createdAt: msg.createdAt,
          interactive: msg.interactive?.role ?? null,
        },
      });
    }
  }

  return { delivered };
}

/**
 * Replace a thread's membership.
 *
 * Used when a named address re-resolves: `support@operators` means whoever holds the operator role
 * NOW, so a thread opened when there were two operators reaches three once a third is appointed.
 * Existing copies are untouched — a participant added today does not retroactively receive
 * yesterday's messages, because a mailbox copy is the thing that was delivered, not a view over a
 * thread. They see everything from their first message onward.
 */
export async function setParticipants(
  ctx: DeliveryCtx,
  conversationId: string,
  participants: string[],
): Promise<ConversationRecord | null> {
  const merged = [...new Set(participants.map(p => p.trim()).filter(Boolean))].slice(0, MAX_GROUP_PARTICIPANTS);
  if (!merged.length) return null;
  return ctx.storage.updateConversation(conversationId, { participants: merged });
}
