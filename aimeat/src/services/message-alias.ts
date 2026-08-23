/**
 * @file message-alias.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Named message addresses that stand for a GROUP of people rather than one person.
 *
 *   `support@operators` is the first and, for now, the only one. It exists because the identity
 *   model is correct and unusable as a support address: a GHII names one person on one node, so
 *   asking for help means first working out who runs the node and what their identity string is.
 *   Nobody does that. They give up, or they email a human who happens to have a contact, which is
 *   how the last external report reached this project six days late.
 *
 *   So the address is the capability: write to `support@operators` and every operator gets it, in
 *   ONE thread, in the same Messages surface where they already answer people. What each operator
 *   sees is a group conversation (services/conversation-group.ts), not a new inbox and not a
 *   dashboard tab — that distinction is the whole lesson of the feedback channel it replaces, which
 *   collected seven genuine reports that nobody ever opened.
 *
 *   The alias resolves AT SEND TIME and the thread keeps the alias rather than the resolved list,
 *   because "who is an operator" changes and "what this person addressed" does not.
 * @structure
 *   - SUPPORT_ALIAS / OPERATORS_HOST — the address vocabulary
 *   - isAliasAddress() — does this `to:` name a group rather than a person
 *   - openSupportThread() — resolve the operators, open the group thread
 *   - soleParticipantNote() — why a named thread reached nobody, when that is the honest answer
 * @usage
 *   if (isAliasAddress(to, config.nodeId)) { const t = await openSupportThread(ctx, sender, subject); }
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial: support@operators over group conversations.
 *   v1.1.0 — 2026-08-23 — soleParticipantNote(): on a one-operator node the operator's own support
 *     message reaches nobody, which is true rather than broken. Both send doors return the reason
 *     beside the count, because an agent reading a bare `delivered_to: 0` concludes the node failed.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { ConversationRecord, DirectMessageAttachment } from '../storage/interface.js';
import type { DeliveryCtx } from './message-delivery.js';
import { listOperatorGhiis } from './operators.js';
import { createGroupConversation, setParticipants, fanOutToParticipants } from './conversation-group.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { deliveryTargetFor } from '../utils/messaging.js';

/** The local part. Reserved in utils/gaii.ts so nobody registers an owner by this name. */
export const SUPPORT_LOCAL_PART = 'support';

/**
 * The host part of the short form: `support@operators`.
 *
 * It is deliberately NOT a node id. A node id is `aimeat-{region}-{nnn}-{name}` and nobody memorises
 * one; "operators" is a word, which is the entire reason the address works. The long form
 * `support@{nodeId}` is accepted too and is what a sender on another node would use once group
 * threads cross nodes.
 */
export const OPERATORS_HOST = 'operators';

/** The canonical address to print in docs, prompts and error messages. One place, so a change to it
 *  is one edit rather than fourteen. */
export const SUPPORT_ADDRESS = `${SUPPORT_LOCAL_PART}@${OPERATORS_HOST}`;

/** True when `to` names this node's operators rather than a single principal. */
export function isAliasAddress(to: string, nodeId: string): boolean {
  const trimmed = to.trim().toLowerCase();
  return trimmed === `${SUPPORT_LOCAL_PART}@${OPERATORS_HOST}`
    || trimmed === `${SUPPORT_LOCAL_PART}@${nodeId.toLowerCase()}`;
}

/**
 * The LONG form, `support@{thisNodeId}`, which always means THIS node's own operators.
 *
 * The two forms mean different things once a node has somebody answering support for it. The word
 * form asks for "whoever answers support here", which on a managed instance is the people who run
 * it. The long form names this node, and is the escape hatch for an owner who wants their own
 * operators rather than their provider's. That distinction was already latent in isAliasAddress;
 * this is it, said out loud.
 */
export function isLocalSupportAddress(to: string, nodeId: string): boolean {
  return to.trim().toLowerCase() === `${SUPPORT_LOCAL_PART}@${nodeId.toLowerCase()}`;
}

/** Where `support@operators` is answered on this node. */
export type SupportRoute =
  | { kind: 'local' }
  | { kind: 'upstream'; nodeId: string; address: string };

/**
 * Who answers support here: this node's own operators, or a peer that agreed to.
 *
 * A managed instance makes its buyer the local operator, so the address every agent is told to use
 * resolves to the customer rather than to the people who actually run the node. `supportUpstream` on
 * a peer row is the answer, and it lives THERE rather than in config so that the routing cannot
 * outlive the link: a config key can name a peer that was removed, and every ticket then queues into
 * a black hole for a week before it is declared undeliverable.
 *
 * A peer that may not deliver messages here cannot answer support either, so it is not a candidate.
 * The PUT route refuses that combination up front; this is the second half of the same rule, for a
 * flag turned off after the routing was set.
 */
export function resolveSupportRoute(peers: Iterable<SupportRoutablePeer>): SupportRoute {
  const upstream = [...peers].find(p =>
    p.supportUpstream === true && p.status === 'active' && p.allowMessaging !== false);
  if (!upstream) return { kind: 'local' };
  return { kind: 'upstream', nodeId: upstream.nodeId, address: `${SUPPORT_LOCAL_PART}@${upstream.nodeId}` };
}

/**
 * The four fields the question actually turns on, so both sources answer it with the same function.
 *
 * The send path holds the live peer MAP; the MCP handshake has storage and no map, and reads the
 * ROWS. Those are the same peers, and "who answers support here" must not have two implementations
 * that can disagree — one of them would eventually be the one a customer's agent believed.
 */
export interface SupportRoutablePeer {
  nodeId: string;
  status: string;
  supportUpstream?: boolean;
  allowMessaging?: boolean;
}

export type OpenSupportResult =
  | { ok: true; conversation: ConversationRecord; operators: string[] }
  | { ok: false; code: 'NO_OPERATORS'; message: string };

/**
 * Open a support thread: resolve the operators now, and put them and the sender in one group.
 *
 * The sender is a participant, so the thread appears in their own Messages exactly as it does in
 * every operator's — one conversation, both sides, no ticket portal.
 *
 * A node with no operator refuses rather than silently accepting: a message with no recipient that
 * reports success is worse than an error, because the person believes they asked for help.
 */
export async function openSupportThread(
  ctx: DeliveryCtx,
  config: AimeatConfig,
  senderGhii: string,
  subject?: string,
): Promise<OpenSupportResult> {
  const operators = await listOperatorGhiis(ctx.storage, config);
  if (!operators.length) {
    return { ok: false, code: 'NO_OPERATORS', message: 'This node has no operator to receive support messages' };
  }

  const created = await createGroupConversation(ctx, {
    createdBy: senderGhii,
    participants: operators,
    subject: subject?.trim() || 'Support request',
    alias: SUPPORT_ADDRESS,
  });
  // Every refusal createGroupConversation can return is impossible here (the membership is this
  // node's own operators plus the sender, and the count is bounded by the operator list), so a
  // failure means the invariant broke rather than the input being bad — surface it as one.
  if (!created.ok) return { ok: false, code: 'NO_OPERATORS', message: created.message };

  return { ok: true, conversation: created.conversation, operators };
}

/**
 * Why a named thread delivered to nobody, when that is the honest answer rather than a failure.
 *
 * A node with one operator resolves `support@operators` to that one person, so when THEY write to it
 * the membership is themselves and `delivered_to` is 0. An agent reading a bare 0 concludes the send
 * failed and either retries or tells its owner the node is broken, neither of which is true. Both
 * doors return this alongside the count so the number can be read.
 *
 * Undefined for an ordinary thread and whenever anyone was actually told: a note that appears when
 * there is nothing to explain is noise.
 */
export function soleParticipantNote(convo: ConversationRecord, delivered: number): string | undefined {
  if (delivered > 0 || !convo.alias) return undefined;
  return `You are the only holder of ${convo.alias} on this node, so this is a note to yourself. It is stored and you can reply in it; nobody else was told.`;
}

export type GroupTarget =
  | { kind: 'none' }
  | { kind: 'group'; conversation: ConversationRecord }
  /** Not a group here: an ordinary 1:1 to a support address on the node that answers for this one. */
  | { kind: 'redirect'; to: string; conversationId: string; subject?: string }
  | { kind: 'refused'; status: number; code: string; message: string };

/**
 * Decide whether a send is going to a GROUP thread, and to which one.
 *
 * Shared by POST /v1/messages and the MCP send tools, so both doors treat `support@operators` and a
 * group conversation id the same way — one capability, one implementation, whatever the interface.
 *
 * Three outcomes, in the order they are checked:
 *   1. A `conversation_id` naming a stored conversation → that group. (A pair thread has no record,
 *      so an unknown id falls through to the ordinary path and behaves exactly as it did before.)
 *   2. A `to` naming an alias → open a fresh thread. Every aliased send with no conversation id
 *      starts a new one: a support request is a ticket, and silently gluing an unrelated question
 *      onto last week's thread is how a support queue becomes unreadable.
 *   3. Anything else → not a group; the caller carries on with 1:1 delivery.
 */
export async function resolveGroupTarget(
  ctx: DeliveryCtx,
  config: AimeatConfig,
  senderGhii: string,
  input: { to: string; conversationId?: string; subject?: string },
): Promise<GroupTarget> {
  const route = resolveSupportRoute(ctx.peers.values());
  const addressedToSupport = !input.to?.trim() || isAliasAddress(input.to, config.nodeId);

  if (input.conversationId) {
    const existing = await ctx.storage.getConversation(input.conversationId);
    if (existing) {
      const fresh = await refreshSupportParticipants(ctx, config, existing);
      return { kind: 'group', conversation: fresh };
    }
    // No record means a PAIR thread, which is what an upstream ticket is on this side. Continuing it
    // has to reach the same thread id, or "pass the conversation id back" stops being true the
    // moment support is answered somewhere else.
    if (route.kind === 'upstream' && addressedToSupport) {
      return { kind: 'redirect', to: route.address, conversationId: input.conversationId, subject: input.subject };
    }
    return { kind: 'none' };
  }

  if (isAliasAddress(input.to, config.nodeId)) {
    // The long form always means THIS node's own operators, whoever else answers support here.
    if (route.kind === 'upstream' && !isLocalSupportAddress(input.to, config.nodeId)) {
      // A fresh id per aliased send, exactly as the local path opens a fresh thread: a support
      // request is a ticket, and gluing an unrelated question onto last week's is how a queue
      // becomes unreadable.
      return { kind: 'redirect', to: route.address, conversationId: randomUUID(), subject: input.subject };
    }
    const opened = await openSupportThread(ctx, config, senderGhii, input.subject);
    if (!opened.ok) {
      return { kind: 'refused', status: 503, code: opened.code, message: opened.message };
    }
    return { kind: 'group', conversation: opened.conversation };
  }

  return { kind: 'none' };
}

export type ReceiveSupportResult =
  | { ok: true; conversationId: string; participants: string[]; delivered: number }
  | { ok: false; status: number; code: string; message: string };

/**
 * A support message that arrived from a peer, addressed to this node's support address.
 *
 * The cross-node leg is an ordinary signed 1:1 DM to `support@{thisNodeId}`; what happens HERE is
 * that the alias is resolved locally into this node's own group thread, whose participants are this
 * node's own operators. That asymmetry is the whole trick: the sender's side is a pair thread, ours
 * is a group, and `createGroupConversation`'s node-local invariant is never touched.
 *
 * Without this the frame 404s: the inbound route parses the delivery address, finds no owner called
 * `support`, and reports the recipient does not exist here.
 */
export async function receiveRemoteSupportMessage(
  ctx: DeliveryCtx,
  config: AimeatConfig,
  input: { sourceNode: string; senderGhii: string; conversationId: string; subject?: string; body: string; messageId: string; attachments?: DirectMessageAttachment[]; createdAt: string },
): Promise<ReceiveSupportResult> {
  const operators = await listOperatorGhiis(ctx.storage, config);
  if (!operators.length) {
    // 503, not 404 or 403. Those are terminal on the wire: deliverDirectMessage marks the sender's
    // copy `undeliverable` and the ticket is lost. A node with no operator right now may have one in
    // an hour, and the retry job is exactly the thing that should carry it there.
    return { ok: false, status: 503, code: 'NO_OPERATORS', message: 'This node has no operator to receive support messages' };
  }

  const sender = parseGaiiLoose(input.senderGhii);
  const existing = await ctx.storage.getConversation(input.conversationId);

  // Does the stored thread genuinely belong to this correspondent? Compare owner AND node: isSameOwner
  // compares the owner name alone, so any peer with an owner called `alice` would be writing into
  // alice-from-somewhere-else's ticket.
  const matches = !!existing
    && existing.alias === SUPPORT_ADDRESS
    && existing.remote?.nodeId === input.sourceNode
    && parseGaiiLoose(existing.remote.ghii).owner === sender.owner
    && parseGaiiLoose(existing.remote.ghii).node === sender.node;

  let convo: ConversationRecord;
  if (existing && matches) {
    convo = await refreshSupportParticipants(ctx, config, existing);
  } else {
    // Either a first message, or an id that names somebody else's thread. In the second case open a
    // FRESH local thread and remember the id the far side uses, rather than refusing: a customer must
    // not lose a support request to an id collision, and an existing thread must not be posted into
    // by a stranger who guessed its id. Both are served by not reusing it.
    const created = await createGroupConversation(ctx, {
      // Reuse the far side's id only when it is free, so both sides usually agree on one name.
      id: existing ? undefined : input.conversationId,
      createdBy: operators[0],
      participants: operators,
      subject: input.subject?.trim() || 'Support request',
      alias: SUPPORT_ADDRESS,
      remote: { ghii: input.senderGhii, nodeId: input.sourceNode, conversationId: input.conversationId },
    });
    if (!created.ok) return { ok: false, status: 503, code: 'NO_OPERATORS', message: created.message };
    convo = created.conversation;
  }

  // Idempotent per mailbox: a retried frame must not write a second copy for anyone. The route's own
  // check cannot help here, because there is no `support@{node}` mailbox to look in.
  const already = await ctx.storage.getDirectMessage(input.messageId, deliveryTargetFor(convo.participants[0]));
  if (already) return { ok: true, conversationId: convo.id, participants: convo.participants, delivered: 0 };

  const now = new Date().toISOString();
  const { delivered } = await fanOutToParticipants(ctx, convo, {
    id: input.messageId,
    senderGhii: input.senderGhii,
    // The SHORT form, so an operator's row reads exactly as it does in a local support thread.
    recipientGhii: SUPPORT_ADDRESS,
    body: input.body,
    attachments: input.attachments,
    origin: 'federation',
    originNodeId: input.sourceNode,
    createdAt: input.createdAt || now,
    deliveredAt: now,
  });

  return { ok: true, conversationId: convo.id, participants: convo.participants, delivered };
}

/**
 * Bring an existing support thread's membership up to date before a message lands in it.
 *
 * An operator appointed after the thread opened should see the next message in it; one who lost the
 * role should not. The membership is therefore the CREATOR plus whoever holds the role right now —
 * the person who asked for help never stops belonging to their own conversation, and everyone else
 * in the thread is there by virtue of the role, which is exactly what the alias promised.
 */
export async function refreshSupportParticipants(
  ctx: DeliveryCtx,
  config: AimeatConfig,
  convo: ConversationRecord,
): Promise<ConversationRecord> {
  if (convo.alias !== SUPPORT_ADDRESS) return convo;
  const operators = await listOperatorGhiis(ctx.storage, config);
  if (!operators.length) return convo;

  const merged = [...new Set([convo.createdBy, ...operators])];
  const unchanged = merged.length === convo.participants.length && merged.every(p => convo.participants.includes(p));
  if (unchanged) return convo;

  return (await setParticipants(ctx, convo.id, merged)) ?? convo;
}
