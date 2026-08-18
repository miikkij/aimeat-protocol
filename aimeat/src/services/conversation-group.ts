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
 *   - setParticipants() — replace the membership (a support thread re-resolves its operators)
 *   - threadAddressFor() — the address a group's copies carry
 * @usage
 *   const convo = await createGroupConversation(ctx, { createdBy, participants, subject });
 *   await sendGroupMessage(ctx, { conversationId: convo.id, senderGhii, body });
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial: group threads, built for support@operators and for any thread
 *     with several people and AIs in it.
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
 */
export async function createGroupConversation(ctx: DeliveryCtx, input: CreateGroupInput): Promise<CreateGroupResult> {
  const { config, storage } = ctx;
  const participants = [...new Set([input.createdBy, ...input.participants].map(p => p.trim()).filter(Boolean))];

  if (participants.length < 2) {
    return { ok: false, code: 'TOO_FEW_PARTICIPANTS', message: 'A conversation needs at least two participants' };
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
  const recipientGhii = threadAddressFor(convo);
  const senderMailbox = deliveryTargetFor(input.senderGhii);

  // Mailbox → the participant identity it stands for, so an agent in the thread is still woken by
  // name even though its copy lives in its owner's mailbox.
  const mailboxes = new Map<string, string>();
  for (const participant of convo.participants) {
    const mailbox = deliveryTargetFor(participant);
    if (!mailboxes.has(mailbox)) mailboxes.set(mailbox, participant);
  }

  let delivered = 0;
  for (const [mailbox, participant] of mailboxes) {
    const isSender = mailbox === senderMailbox;
    await storage.createDirectMessage({
      id,
      ownerGhii: mailbox,
      conversationId: convo.id,
      subject: convo.subject,
      senderGhii: input.senderGhii,
      recipientGhii,
      body: input.body,
      attachments: input.attachments,
      interactive: input.interactive,
      respondable: true,
      status: 'delivered',
      direction: isSender ? 'outbound' : 'inbound',
      replyToId: input.replyToId,
      origin: 'local',
      originNodeId: config.nodeId,
      aiProvenanceId: input.aiProvenanceId,
      createdAt: now,
      deliveredAt: now,
    });
    if (isSender) continue;
    delivered++;

    await notify(storage, mailbox, {
      type: 'direct_message',
      title: convo.subject ? `${convo.subject} — ${input.senderGhii}` : `New message from ${input.senderGhii}`,
      body: messagePreviewWithAttachments(input.body, input.attachments),
      link: `/v1/profile#inbox/${convo.id}`,
      actions: [{ id: 'reply', label: 'Reply', kind: 'reply', to: recipientGhii, conversationId: convo.id, subject: convo.subject, replyTo: id }],
    });

    // An agent participant is woken over its connect tunnel, the same signal a 1:1 DM sends, so a
    // thread with an AI in it does not wait for that AI to poll.
    if (participant !== mailbox) {
      emitDelivery({
        target: participant, kind: 'dm.inbound', id,
        payload: {
          id, conversationId: convo.id, subject: convo.subject ?? null, senderGhii: input.senderGhii,
          preview: messagePreview(input.body), attachments: input.attachments?.length ?? 0, createdAt: now,
          interactive: input.interactive?.role ?? null,
        },
      });
    }
  }

  await storage.updateConversation(convo.id, {});
  emitChange('messages');
  return { ok: true, messageId: id, delivered };
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
