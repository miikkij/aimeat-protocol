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
 * @usage
 *   if (isAliasAddress(to, config.nodeId)) { const t = await openSupportThread(ctx, sender, subject); }
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial: support@operators over group conversations.
 */
import type { AimeatConfig } from '../config.js';
import type { ConversationRecord } from '../storage/interface.js';
import type { DeliveryCtx } from './message-delivery.js';
import { listOperatorGhiis } from './operators.js';
import { createGroupConversation, setParticipants } from './conversation-group.js';

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

export type GroupTarget =
  | { kind: 'none' }
  | { kind: 'group'; conversation: ConversationRecord }
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
  if (input.conversationId) {
    const existing = await ctx.storage.getConversation(input.conversationId);
    if (existing) {
      const fresh = await refreshSupportParticipants(ctx, config, existing);
      return { kind: 'group', conversation: fresh };
    }
    return { kind: 'none' };
  }

  if (isAliasAddress(input.to, config.nodeId)) {
    const opened = await openSupportThread(ctx, config, senderGhii, input.subject);
    if (!opened.ok) {
      return { kind: 'refused', status: 503, code: opened.code, message: opened.message };
    }
    return { kind: 'group', conversation: opened.conversation };
  }

  return { kind: 'none' };
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
