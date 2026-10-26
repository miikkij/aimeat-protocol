/**
 * @file conversation-group-manage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Group chat as a person (or an agent acting for them) uses it: open a group with the
 *   people they choose, add and remove members, leave, and answer an invitation. The thread itself,
 *   its fan-out and its sends are conversation-group.ts; this file decides WHO is in it.
 *
 *   Four rulings by Jouni, 2026-10-21 (wish-ryhm-keskustelu-viestit-puolelle):
 *     1. Members live on this node. Another node's identity is refused per person, by name.
 *     2. A person joins DIRECTLY only when their contact book already accepts the one who adds them.
 *        Everybody else is INVITED: they read and receive nothing until they accept. Without this a
 *        group is a way round the first-contact gate, since a group send has no gate of its own.
 *     3. A member who joins later sees what is written from then on, not the history. That is what
 *        the mailbox model gives (one copy per mailbox, written at send time), so nothing is copied.
 *     4. The one who opened the group manages its members. Anybody may leave. When the manager's
 *        account leaves, the role passes to the next person still in the thread.
 *
 *   An account is one party throughout, as everywhere in messaging: an owner's agent acts for the
 *   owner (isSameOwner), so the owner may manage a group their agent opened, and an owner's own
 *   agents join directly.
 *
 *   A thread opened through a named address (`support@operators`) is not a group anybody manages:
 *   its membership is a role, resolved by message-alias.ts. Every change here refuses it.
 * @structure
 *   - classifyMember() — added, invited or refused, for one identity, as the one adding them sees it
 *   - startGroupConversation() — open a group and send its first message
 *   - changeGroupMembers() — the manager adds and removes
 *   - leaveGroupConversation() — a member leaves
 *   - answerGroupInvitation() — an invitee accepts or declines
 *   - listGroupInvitations() — the open invitations of one mailbox
 *   - groupView() — the thread's membership as a reader is told it
 *   - readGroupFor() — the same, read by id, for a member only
 * @usage
 *   const r = await startGroupConversation(ctx, { actor, members: ['bob', 'carol'], subject, body });
 * @version-history
 *   v1.1.0 — 2026-10-26 — classifyMember adds a colleague directly on a node with members see each other
 *     on (areColleagues, services/colleagues.ts); a block still refuses first.
 *   v1.0.0 — 2026-10-21 — Initial: user-created group chat on the Messages page.
 */
import type { ConversationRecord, DirectMessageAttachment } from '../storage/interface.js';
import type { DeliveryCtx } from './message-delivery.js';
import {
  MAX_GROUP_PARTICIPANTS, createGroupConversation, emitGroupChange, isParticipant, sendGroupMessage,
} from './conversation-group.js';
import { acceptedSameAccount } from './contact-same-account.js';
import { areColleagues } from './colleagues.js';
import { normalizeContactId } from './contacts.js';
import { isIdentityShaped, localIdentityExists, missingIdentityReason } from './local-identity.js';
import { notify } from './notify.js';
import { isSameOwner, parseGaiiLoose } from '../utils/gaii.js';
import { deliveryTargetFor } from '../utils/messaging.js';
import type { SendLimitMark } from './message-send-limit.js';

/** A group's title: shown in every member's list, so a group without one cannot be told apart. */
export const MAX_GROUP_SUBJECT = 200;

export type MemberRefusal = 'INVALID_IDENTITY' | 'NOT_FOUND' | 'CROSS_NODE_UNSUPPORTED' | 'BLOCKED' | 'IS_MANAGER';

/** What happened to one name the caller gave. */
export type MemberOutcome =
  | { identity: string; result: 'added' | 'invited' | 'removed' | 'already' }
  | { identity: string; result: 'refused'; code: MemberRefusal; message: string };

export type GroupManageError =
  | 'INVALID_INPUT' | 'NO_MEMBERS' | 'TOO_MANY_PARTICIPANTS' | 'CONVERSATION_NOT_FOUND'
  | 'NOT_A_PARTICIPANT' | 'NOT_THE_MANAGER' | 'NOT_A_GROUP' | 'NOT_INVITED' | 'RATE_LIMITED';

export type GroupFailure = { ok: false; code: GroupManageError; message: string; members?: MemberOutcome[]; retryAfterSec?: number };

/** The membership of a thread as one reader is told it. Invitations are shown to members only. */
export interface GroupView {
  conversation_id: string;
  subject: string | null;
  manager: string;
  participants: string[];
  invited: string[];
  /** May this reader add and remove members? */
  you_manage: boolean;
}

export function groupView(convo: ConversationRecord, reader: string): GroupView {
  return {
    conversation_id: convo.id,
    subject: convo.subject ?? null,
    manager: convo.createdBy,
    participants: convo.participants,
    invited: convo.invited ?? [],
    you_manage: !convo.alias && isSameOwner(convo.createdBy, reader),
  };
}

/**
 * The group as `reader` is told it, or null when there is no such group or the reader is not in it.
 * The two answers are one on purpose: the subject and the members are the members' business.
 */
export async function readGroupFor(ctx: Pick<DeliveryCtx, 'storage'>, conversationId: string, reader: string): Promise<GroupView | null> {
  const convo = await ctx.storage.getConversation(conversationId);
  return convo && isParticipant(convo, reader) ? groupView(convo, reader) : null;
}

/**
 * Added, invited or refused: one identity, as `actor` adding them sees it.
 *
 * Added means the person's own contact book already accepts the actor's account (the actor, the
 * account behind it, or an agent of it they accepted), or the identity is the actor's own account.
 * A block on either refuses, and says so the way a 1:1 send says so. Everything else is an invitation.
 */
export async function classifyMember(ctx: DeliveryCtx, actor: string, raw: string): Promise<MemberOutcome> {
  const { config, storage } = ctx;
  const identity = normalizeContactId(String(raw ?? ''), config.nodeId);
  if (!isIdentityShaped(identity)) {
    return { identity, result: 'refused', code: 'INVALID_IDENTITY', message: `"${raw}" is not a person, an agent or an app on this node.` };
  }
  if (parseGaiiLoose(identity).node !== config.nodeId) {
    return { identity, result: 'refused', code: 'CROSS_NODE_UNSUPPORTED', message: `${identity} is on another node. A group can hold people of this node only.` };
  }
  if (!(await localIdentityExists(storage, config, identity))) {
    return { identity, result: 'refused', code: 'NOT_FOUND', message: missingIdentityReason(identity) };
  }
  if (isSameOwner(identity, actor)) return { identity, result: 'added' };

  const mailbox = deliveryTargetFor(identity);
  const actorAccount = deliveryTargetFor(actor);
  const [byActor, byAccount] = await Promise.all([
    storage.getContact(mailbox, actor),
    actorAccount === actor ? Promise.resolve(null) : storage.getContact(mailbox, actorAccount),
  ]);
  if (byActor?.state === 'blocked' || byAccount?.state === 'blocked') {
    return { identity, result: 'refused', code: 'BLOCKED', message: `${identity} is not taking messages from you.` };
  }
  if (byActor?.state === 'accepted' || byAccount?.state === 'accepted' || await acceptedSameAccount(storage, mailbox, actor)
    || await areColleagues(storage, config, mailbox, actor)) {
    return { identity, result: 'added' };
  }
  return { identity, result: 'invited' };
}

/** Classify a list once per distinct identity, leaving out the actor and anyone already listed. */
async function classifyAll(ctx: DeliveryCtx, actor: string, raws: string[], skip: Set<string>): Promise<MemberOutcome[]> {
  const out: MemberOutcome[] = [];
  const seen = new Set<string>();
  for (const raw of raws) {
    const identity = normalizeContactId(String(raw ?? ''), ctx.config.nodeId);
    if (!identity || seen.has(identity) || identity === actor) continue;
    seen.add(identity);
    if (skip.has(identity)) { out.push({ identity, result: 'already' }); continue; }
    out.push(await classifyMember(ctx, actor, identity));
  }
  return out;
}

/** Tell the people a change reached: an invitee is asked, a person added directly is told. */
async function tellMembers(ctx: DeliveryCtx, convo: ConversationRecord, actor: string, outcomes: MemberOutcome[]): Promise<void> {
  const subject = convo.subject ?? 'a group';
  for (const o of outcomes) {
    if (o.result !== 'invited' && o.result !== 'added') continue;
    const mailbox = deliveryTargetFor(o.identity);
    if (mailbox === deliveryTargetFor(actor)) continue;
    await notify(ctx.storage, mailbox, o.result === 'invited'
      ? {
        type: 'group_invitation',
        title: `${actor} invites you to the group "${subject}"`,
        body: 'You see the group and its messages once you accept.',
        link: '/v1/profile#inbox',
      }
      : {
        type: 'group_added',
        title: `${actor} added you to the group "${subject}"`,
        body: 'You see the messages written from now on.',
        link: `/v1/profile#inbox/${convo.id}`,
      });
  }
}

export interface StartGroupInput {
  actor: string;
  members: string[];
  subject: string;
  body: string;
  attachments?: DirectMessageAttachment[];
  aiProvenanceId?: string;
  sentByAgent?: string;
  sentByAgentName?: string;
  sendLimit?: SendLimitMark;
}

export type StartGroupResult =
  | { ok: true; conversation: ConversationRecord; messageId: string; delivered: number; members: MemberOutcome[] }
  | GroupFailure;

/**
 * Open a group and send its first message.
 *
 * The first message is part of opening it, not a second step: the Messages list is built from the
 * copies in each mailbox, so a group with no message would show nowhere, and "start a group" without
 * anything said in it is not what a person does. Members who are refused are named in the answer and
 * the group opens without them, as long as one other member remains.
 */
export async function startGroupConversation(ctx: DeliveryCtx, input: StartGroupInput): Promise<StartGroupResult> {
  const subject = String(input.subject ?? '').trim();
  if (!subject || subject.length > MAX_GROUP_SUBJECT) {
    return { ok: false, code: 'INVALID_INPUT', message: `A group needs a name of 1 to ${MAX_GROUP_SUBJECT} characters.` };
  }
  if (!String(input.body ?? '').trim()) {
    return { ok: false, code: 'INVALID_INPUT', message: 'A group opens with a first message. Write one.' };
  }
  if (input.members.length > MAX_GROUP_PARTICIPANTS * 2) {
    return { ok: false, code: 'TOO_MANY_PARTICIPANTS', message: `A group holds at most ${MAX_GROUP_PARTICIPANTS} participants.` };
  }
  const members = await classifyAll(ctx, input.actor, input.members, new Set());
  const added = members.filter(m => m.result === 'added').map(m => m.identity);
  const invited = members.filter(m => m.result === 'invited').map(m => m.identity);
  if (!added.length && !invited.length) {
    return { ok: false, code: 'NO_MEMBERS', message: 'Nobody you named can be in this group. The reasons are in `members`.', members };
  }

  const created = await createGroupConversation(ctx, { createdBy: input.actor, participants: added, invited, subject });
  if (!created.ok) {
    return { ok: false, code: created.code === 'TOO_MANY_PARTICIPANTS' ? 'TOO_MANY_PARTICIPANTS' : 'INVALID_INPUT', message: created.message, members };
  }
  const sent = await sendGroupMessage(ctx, {
    conversationId: created.conversation.id,
    senderGhii: input.actor,
    body: input.body,
    attachments: input.attachments,
    aiProvenanceId: input.aiProvenanceId,
    sentByAgent: input.sentByAgent,
    sentByAgentName: input.sentByAgentName,
    sendLimit: input.sendLimit,
  });
  if (!sent.ok) {
    // Only the send limit can refuse a participant's first message, and the caller took that turn
    // before calling. Answered rather than thrown, so the group is still named in the answer.
    return { ok: false, code: sent.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'NOT_A_PARTICIPANT',
      message: sent.code === 'RATE_LIMITED' ? sent.message : 'The first message could not be sent.',
      ...(sent.code === 'RATE_LIMITED' ? { retryAfterSec: sent.retryAfterSec } : {}), members };
  }
  await tellMembers(ctx, created.conversation, input.actor, members.filter(m => m.result === 'invited'));
  return { ok: true, conversation: created.conversation, messageId: sent.messageId, delivered: sent.delivered, members };
}

/** The thread, if it is a group this actor may change. */
async function managedGroup(ctx: DeliveryCtx, actor: string, conversationId: string): Promise<{ ok: true; convo: ConversationRecord } | GroupFailure> {
  const convo = await ctx.storage.getConversation(conversationId);
  if (!convo) return { ok: false, code: 'CONVERSATION_NOT_FOUND', message: 'No such group.' };
  if (!isParticipant(convo, actor)) return { ok: false, code: 'NOT_A_PARTICIPANT', message: 'You are not in this group.' };
  if (convo.alias) return { ok: false, code: 'NOT_A_GROUP', message: `${convo.alias} is answered by whoever holds that role; its members are not chosen by hand.` };
  return { ok: true, convo };
}

export interface ChangeMembersInput { actor: string; conversationId: string; add?: string[]; remove?: string[] }
export type ChangeMembersResult = { ok: true; conversation: ConversationRecord; members: MemberOutcome[] } | GroupFailure;

/**
 * The manager adds and removes members. Adding follows the same rule as opening: a person whose
 * contact book accepts the manager joins, anybody else is invited. Removing takes a member or an open
 * invitation away. The manager's own account cannot be removed here; it leaves instead.
 */
export async function changeGroupMembers(ctx: DeliveryCtx, input: ChangeMembersInput): Promise<ChangeMembersResult> {
  const found = await managedGroup(ctx, input.actor, input.conversationId);
  if (!found.ok) return found;
  const { convo } = found;
  if (!isSameOwner(convo.createdBy, input.actor)) {
    return { ok: false, code: 'NOT_THE_MANAGER', message: `Only ${convo.createdBy}, who manages this group, adds and removes members. You may leave it.` };
  }

  let participants = [...convo.participants];
  let invited = [...(convo.invited ?? [])];
  const outcomes: MemberOutcome[] = [];

  for (const raw of input.remove ?? []) {
    const identity = normalizeContactId(String(raw ?? ''), ctx.config.nodeId);
    if (isSameOwner(identity, convo.createdBy)) {
      outcomes.push({ identity, result: 'refused', code: 'IS_MANAGER', message: 'The manager leaves the group instead of being removed.' });
      continue;
    }
    const before = participants.length + invited.length;
    participants = participants.filter(p => p !== identity);
    invited = invited.filter(p => p !== identity);
    if (participants.length + invited.length < before) outcomes.push({ identity, result: 'removed' });
  }

  const additions = await classifyAll(ctx, input.actor, input.add ?? [], new Set([...participants, ...invited]));
  for (const o of additions) {
    if (o.result === 'added') participants.push(o.identity);
    if (o.result === 'invited') invited.push(o.identity);
  }
  outcomes.push(...additions);
  if (participants.length + invited.length > MAX_GROUP_PARTICIPANTS) {
    return { ok: false, code: 'TOO_MANY_PARTICIPANTS', message: `A group holds at most ${MAX_GROUP_PARTICIPANTS} participants.`, members: outcomes };
  }

  const removed = outcomes.filter(o => o.result === 'removed').map(o => o.identity);
  const updated = await ctx.storage.updateConversation(convo.id, { participants, invited }) ?? convo;
  await tellMembers(ctx, updated, input.actor, additions);
  emitGroupChange(updated, removed);
  return { ok: true, conversation: updated, members: outcomes };
}

export type LeaveGroupResult = { ok: true; conversation: ConversationRecord; manager: string } | GroupFailure;

/**
 * Leave a group. A person leaves with their agents, because an agent in the thread would keep them in
 * it (an agent counts as its owner). An agent leaves alone. When the manager's account is gone, the
 * role passes to the next person still in the thread, or the next identity when no person remains.
 */
export async function leaveGroupConversation(ctx: DeliveryCtx, input: { actor: string; conversationId: string }): Promise<LeaveGroupResult> {
  const found = await managedGroup(ctx, input.actor, input.conversationId);
  if (!found.ok) return found;
  const { convo } = found;
  const leavesWholeAccount = !parseGaiiLoose(input.actor).agent;
  const leaving = (p: string) => (leavesWholeAccount ? isSameOwner(p, input.actor) : p === input.actor);
  const participants = convo.participants.filter(p => !leaving(p));
  const invited = (convo.invited ?? []).filter(p => !leaving(p));

  let manager = convo.createdBy;
  if (!participants.some(p => isSameOwner(p, manager))) {
    manager = participants.find(p => !parseGaiiLoose(p).agent && !p.startsWith('eco:')) ?? participants[0] ?? manager;
  }
  const updated = await ctx.storage.updateConversation(convo.id, {
    participants, invited, ...(manager !== convo.createdBy ? { createdBy: manager } : {}),
  }) ?? convo;
  emitGroupChange(updated, [input.actor]);
  return { ok: true, conversation: updated, manager };
}

export type AnswerInvitationResult = { ok: true; conversation: ConversationRecord; accepted: boolean; joined: string[] } | GroupFailure;

/**
 * Accept or decline an invitation. A person answers for themselves and for their own agents; an agent
 * answers for itself only.
 */
export async function answerGroupInvitation(
  ctx: DeliveryCtx, input: { actor: string; conversationId: string; accept: boolean },
): Promise<AnswerInvitationResult> {
  const convo = await ctx.storage.getConversation(input.conversationId);
  const mine = (convo?.invited ?? []).filter(p => (parseGaiiLoose(input.actor).agent
    ? p === input.actor
    : p === input.actor || deliveryTargetFor(p) === input.actor));
  if (!convo || !mine.length) return { ok: false, code: 'NOT_INVITED', message: 'You have no open invitation to this group.' };

  const invited = (convo.invited ?? []).filter(p => !mine.includes(p));
  const participants = input.accept ? [...convo.participants, ...mine] : convo.participants;
  if (participants.length + invited.length > MAX_GROUP_PARTICIPANTS) {
    return { ok: false, code: 'TOO_MANY_PARTICIPANTS', message: `This group is full (${MAX_GROUP_PARTICIPANTS} participants).` };
  }
  const updated = await ctx.storage.updateConversation(convo.id, { participants, invited }) ?? convo;
  emitGroupChange(updated, [input.actor]);
  return { ok: true, conversation: updated, accepted: input.accept, joined: input.accept ? mine : [] };
}

/** One open invitation, as the invited mailbox is shown it. Members are named; messages are not. */
export interface GroupInvitation {
  conversation_id: string;
  subject: string | null;
  invited_by: string;
  /** Who of this mailbox is invited: the person, or one of their agents. */
  invitees: string[];
  participants: string[];
  updated_at: string;
}

/**
 * The open invitations `reader` may answer: a person sees their own and their agents', an agent only
 * its own (the same rule answerGroupInvitation applies).
 */
export async function listGroupInvitations(ctx: Pick<DeliveryCtx, 'storage'>, reader: string): Promise<GroupInvitation[]> {
  const mailbox = deliveryTargetFor(reader);
  const isAgent = !!parseGaiiLoose(reader).agent;
  const rows = await ctx.storage.listConversationsInvitingMailbox(mailbox);
  return rows.filter(c => !c.alias).map(c => ({
    conversation_id: c.id,
    subject: c.subject ?? null,
    invited_by: c.createdBy,
    invitees: (c.invited ?? []).filter(p => (isAgent ? p === reader : deliveryTargetFor(p) === mailbox)),
    participants: c.participants,
    updated_at: c.updatedAt,
  })).filter(i => i.invitees.length);
}
