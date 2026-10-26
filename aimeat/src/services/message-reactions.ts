/**
 * @file src/services/message-reactions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Acknowledgement marks on a single direct message: a symbol (an emoji or a short word)
 *   given instead of a reply, modelled on board reactions (services/board-write.ts). The one
 *   implementation behind POST/DELETE /v1/messages/:id/reactions, the MCP tool aimeat_dm_react on
 *   all three surfaces, and the federation endpoint POST /v1/federation/message/reaction.
 *
 *   WHO MAY REACT. Whoever holds a copy of the message as one of its parties: the owner in person on
 *   any copy in their own mailbox; an agent acting as itself on a message it sent or that was
 *   addressed to it (or a group thread it is in); an agent holding messages:send-as-owner on its
 *   owner's copy, in the owner's name (the mark then names the agent in `byAgent`). Anyone else is
 *   told the message does not exist, the same answer a stranger gets when reading it.
 *
 *   ONE MARK PER PERSON AND SYMBOL. Giving it twice changes nothing; taking it back takes only the
 *   caller's own. The rows are keyed by the message id every copy shares, so one set serves every
 *   copy on this node.
 *
 *   WHAT HAPPENS AFTER. Each local party's Messages page hears `messages` on its own stream, scoped
 *   to its mailbox. The agent that wrote the message (the sender, or the agent that sent it in its
 *   owner's name) is woken with `dm.reaction`, naming the symbol and who gave it. A party on another
 *   node gets the mark signed, the way a read receipt travels.
 *
 *   THE PALETTE is a memory record of the person, key `messages.reactions`:
 *   `{ symbols: [{ symbol: "✓", meaning: "done" }, …] }`. The Messages page offers its symbols first.
 *   A person or their AI changes it with a memory write; any other symbol of 1-32 characters can still
 *   be given. The node never reads it on anyone's behalf: an agent that wants to know what a symbol
 *   means reads the record with its own permissions, or follows its own instructions, because the
 *   record is the person's private memory and a wake-up must not carry it past the agent's scopes.
 * @structure REACTION_MAX · PALETTE_KEY · DEFAULT_PALETTE · AS_OWNER_SCOPE · reactionActor ·
 *   normalizeReaction · reactToMessage · applyRemoteReaction · withReactions · summarizeReactions
 * @usage const actor = reactionActor(caller, asOwner); if ('refused' in actor) → 403
 *   const out = await reactToMessage(ctx, actor, { messageId, reaction, remove });
 * @version-history
 *   v1.0.0 — 2026-10-26 — Initial (wish-kuittausreaktiot-yksitt-isiin-viesteihin-viestit-ketjuissa).
 */
import type { DirectMessageRecord, MessageReactionRecord, MessageReactionSummary, ConversationRecord } from '../storage/interface.js';
import type { DeliveryCtx } from './message-delivery.js';
import type { CallerContext } from './caller-context.js';
import { emitChange, emitDelivery } from './event-bus.js';
import { isParticipant } from './conversation-group.js';
import { deliveryTargetFor } from '../utils/messaging.js';
import { parseGaiiLoose, isSameOwner } from '../utils/gaii.js';
import { sign } from '../auth/keypair.js';
import { audienceProof } from './signed-node-request.js';
import { peerTakesMessages } from './federation-peer-gate.js';
import { peerFetch } from '../utils/peer-fetch.js';
import { logger } from '../utils/logger.js';

/** The longest symbol, as board reactions (BOARD_LIMITS.reactionMax). */
export const REACTION_MAX = 32;

/** The person's memory record that lists the symbols offered first, and what each means. */
export const PALETTE_KEY = 'messages.reactions';

/** What the Messages page offers when the person has no palette record. Acknowledgement symbols. */
export const DEFAULT_PALETTE: ReadonlyArray<{ symbol: string; meaning: string }> = Object.freeze([
  { symbol: '✓', meaning: 'done' },
  { symbol: '👍', meaning: 'agreed' },
  { symbol: '❤️', meaning: 'thank you' },
  { symbol: '😄', meaning: 'that made me smile' },
  { symbol: '🙏', meaning: 'thanks, appreciated' },
  { symbol: '👀', meaning: 'seen, looking at it' },
]);

/**
 * Who is reacting, and through which copy.
 *   owner     — the person in person, on a copy in their own mailbox.
 *   agent     — an agent as itself, on a message it is a party to.
 *   as-owner  — an agent in its owner's name (messages:send-as-owner checked by the caller).
 */
export type ReactActor =
  | { kind: 'owner'; ghii: string }
  | { kind: 'agent'; gaii: string }
  | { kind: 'as-owner'; ownerGhii: string; agentGaii: string };

/** The word an agent needs to react in its owner's name, as it needs it to write there. */
export const AS_OWNER_SCOPE = 'messages:send-as-owner';

/**
 * Who the caller reacts as: the one decision every door asks. The person in person, and a published
 * app acting for them, mark as the person. An agent marks as itself, or with `asOwner` and
 * messages:send-as-owner in its owner's name. Anyone else (a visitor, the anonymous identity) is
 * refused; the scope words themselves are checked where the door is mounted.
 */
export function reactionActor(caller: CallerContext, asOwner?: boolean): ReactActor | { refused: string; code: 'SCOPE_DENIED' | 'FORBIDDEN' } {
  if (caller.kind === 'owner' || caller.kind === 'app') return { kind: 'owner', ghii: caller.ownerGhii };
  if (caller.kind !== 'agent' && caller.kind !== 'ecosystem') return { refused: 'This session cannot react to a message', code: 'FORBIDDEN' };
  if (!asOwner) return { kind: 'agent', gaii: caller.principal };
  if (caller.kind !== 'agent' || !caller.has(AS_OWNER_SCOPE)) {
    return { refused: `Reacting in your owner's name needs their permission (${AS_OWNER_SCOPE}). Without it, react as yourself.`, code: 'SCOPE_DENIED' };
  }
  return { kind: 'as-owner', ownerGhii: caller.ownerGhii, agentGaii: caller.principal };
}

export type ReactResult =
  | { ok: true; changed: boolean; messageId: string; reactions: MessageReactionSummary[] }
  | { ok: false; status: 400 | 404; code: 'VALIDATION_ERROR' | 'NOT_FOUND'; message: string };

/**
 * The symbol as stored: trimmed, 1-32 characters, one line, no control characters. Null when it
 * cannot be one. Characters are counted as board reactions count them (UTF-16 length), so a symbol
 * accepted on a board is accepted here.
 */
export function normalizeReaction(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s || s.length > REACTION_MAX) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
}

/** Group the rows of one message by symbol, in the order each symbol was first given. */
export function summarizeReactions(rows: MessageReactionRecord[]): MessageReactionSummary[] {
  const by = new Map<string, string[]>();
  for (const r of rows) {
    const list = by.get(r.reaction) ?? [];
    if (!list.includes(r.reactorGhii)) list.push(r.reactorGhii);
    by.set(r.reaction, list);
  }
  return [...by].map(([reaction, people]) => ({ reaction, by: people }));
}

/** Attach each message's marks in one read. A message nobody reacted to gets no field. */
export async function withReactions<T extends DirectMessageRecord>(storage: DeliveryCtx['storage'], messages: T[]): Promise<T[]> {
  if (!messages.length) return messages;
  const rows = await storage.listMessageReactions([...new Set(messages.map(m => m.id))]);
  if (!rows.length) return messages;
  const byMessage = new Map<string, MessageReactionRecord[]>();
  for (const r of rows) byMessage.set(r.messageId, [...(byMessage.get(r.messageId) ?? []), r]);
  return messages.map(m => {
    const mine = byMessage.get(m.id);
    return mine ? { ...m, reactions: summarizeReactions(mine) } : m;
  });
}

/** Is `identity` one of the parties of this copy: its sender, its recipient, or in its group thread. */
function isParty(copy: DirectMessageRecord, convo: ConversationRecord | null, identity: string): boolean {
  if (copy.senderGhii === identity || copy.recipientGhii === identity) return true;
  return !!convo && isParticipant(convo, identity);
}

/** The copy the actor reacts through, or null when it holds none as a party. */
async function copyFor(ctx: DeliveryCtx, actor: ReactActor, messageId: string): Promise<{ copy: DirectMessageRecord; convo: ConversationRecord | null } | null> {
  const { storage } = ctx;
  if (actor.kind !== 'agent') {
    // The person's own mailbox: every copy there is theirs to acknowledge.
    const mailbox = actor.kind === 'owner' ? actor.ghii : actor.ownerGhii;
    const copy = await storage.getDirectMessage(messageId, mailbox);
    return copy ? { copy, convo: await storage.getConversation(copy.conversationId) } : null;
  }
  // An agent as itself: its own mailbox, or its owner's where a reply to it or a group thread's copy
  // lands, and only as a party of the message.
  for (const mailbox of new Set([actor.gaii, deliveryTargetFor(actor.gaii)])) {
    const copy = await storage.getDirectMessage(messageId, mailbox);
    if (!copy) continue;
    const convo = await storage.getConversation(copy.conversationId);
    if (isParty(copy, convo, actor.gaii)) return { copy, convo };
  }
  return null;
}

/** Everyone the message concerns: its two ends and, in a group thread, every participant and the remote party. */
function partiesOf(copy: DirectMessageRecord, convo: ConversationRecord | null): string[] {
  const out = new Set<string>([copy.senderGhii, copy.recipientGhii]);
  for (const p of convo?.participants ?? []) out.add(p);
  if (convo?.remote?.ghii) out.add(convo.remote.ghii);
  return [...out].filter(p => !!parseGaiiLoose(p).node);
}

/**
 * After a mark changed on this node: tell every local party's page, wake the agent that wrote the
 * message, and (for a mark given here) send it to every other node the message concerns.
 */
async function announce(
  ctx: DeliveryCtx, copy: DirectMessageRecord, convo: ConversationRecord | null,
  mark: { reaction: string; reactorGhii: string; byAgent?: string; removed: boolean },
  opts: { federate: boolean },
): Promise<void> {
  const { config } = ctx;
  const parties = partiesOf(copy, convo);
  const mailboxes = new Set(parties.filter(p => parseGaiiLoose(p).node === config.nodeId).map(deliveryTargetFor));
  for (const mailbox of mailboxes) emitChange('messages', mailbox);

  // The agent that wrote it: its own message, or one it sent in its owner's name. The wake-up names
  // the symbol only. What it means is the reactor's palette, a private record the agent reads with its
  // own permissions (or its own instructions say), never handed over by the node on the reactor's behalf.
  const author = copy.sentByAgent ?? (parseGaiiLoose(copy.senderGhii).agent ? copy.senderGhii : undefined);
  if (!mark.removed && author && parseGaiiLoose(author).node === config.nodeId
      && author !== mark.reactorGhii && author !== mark.byAgent) {
    emitDelivery({
      target: author, kind: 'dm.reaction', id: `${copy.id}:${mark.reaction}:${mark.reactorGhii}`,
      payload: {
        messageId: copy.id, conversationId: copy.conversationId, reaction: mark.reaction,
        reactorGhii: mark.reactorGhii, byAgent: mark.byAgent ?? null,
        // Read the thread with aimeat_dm_thread to see the message the mark is on.
        createdAt: new Date().toISOString(),
      },
    });
  }

  if (!opts.federate) return;
  const nodes = new Set(parties.map(p => parseGaiiLoose(p).node).filter(n => n && n !== config.nodeId));
  for (const node of nodes) await sendToNode(ctx, node, copy.id, mark);
}

/** The signed body one node sends another; the receiver verifies the same seven fields in this order. */
export function reactionPayload(sourceNode: string, messageId: string, mark: { reaction: string; reactorGhii: string; byAgent?: string; removed: boolean }, timestamp: string) {
  return {
    source_node: sourceNode, message_id: messageId, reaction: mark.reaction, reactor: mark.reactorGhii,
    by_agent: mark.byAgent ?? null, op: mark.removed ? 'remove' : 'add', timestamp,
  };
}

/** Best-effort, as a read receipt: a mark that does not arrive changes what the other side sees, nothing else. */
async function sendToNode(ctx: DeliveryCtx, node: string, messageId: string, mark: { reaction: string; reactorGhii: string; byAgent?: string; removed: boolean }): Promise<void> {
  const { config, storage, peers } = ctx;
  const peer = [...peers.values()].find(p => p.nodeId === node);
  if (!peer || !peer.url || !peerTakesMessages(peer)) return;
  const nodeKey = await storage.getNodeKey();
  if (!nodeKey) return;
  const payload = reactionPayload(config.nodeId, messageId, mark, new Date().toISOString());
  try {
    const signed = JSON.stringify(payload);
    const signature = await sign(nodeKey.privateKey, signed);
    const audience = await audienceProof(nodeKey.privateKey, signed, peer.nodeId);
    const sent = await peerFetch(`${peer.url}/v1/federation/message/reaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-source-node': config.nodeId },
      body: JSON.stringify({ ...payload, signature, ...audience }),
    }, { timeoutMs: config.federationTimeoutMs });
    if (!sent.ok) throw new Error(sent.message);
  } catch (err) {
    logger.warn('message reaction: not delivered to a peer node', { node, messageId, error: String(err) });
  }
}

/** Give or take back a mark through the actor's own copy of the message. */
export async function reactToMessage(
  ctx: DeliveryCtx, actor: ReactActor, input: { messageId: string; reaction: unknown; remove?: boolean },
): Promise<ReactResult> {
  const reaction = normalizeReaction(input.reaction);
  if (!reaction) {
    return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: `reaction must be 1-${REACTION_MAX} characters on one line, such as ✓ or 👍` };
  }
  const found = await copyFor(ctx, actor, input.messageId);
  if (!found) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'No such message in your mailbox' };
  const { copy, convo } = found;

  const reactorGhii = actor.kind === 'owner' ? actor.ghii : actor.kind === 'as-owner' ? actor.ownerGhii : actor.gaii;
  const byAgent = actor.kind === 'as-owner' ? actor.agentGaii : undefined;
  const removed = !!input.remove;
  const changed = removed
    ? await ctx.storage.removeMessageReaction(copy.id, reaction, reactorGhii)
    : await ctx.storage.addMessageReaction({ messageId: copy.id, reaction, reactorGhii, ...(byAgent ? { byAgent } : {}), createdAt: new Date().toISOString() });
  if (removed && !changed) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'No such reaction from you on that message' };
  }
  if (changed) await announce(ctx, copy, convo, { reaction, reactorGhii, byAgent, removed }, { federate: true });
  return { ok: true, changed, messageId: copy.id, reactions: summarizeReactions(await ctx.storage.listMessageReactions([copy.id])) };
}

export type RemoteReactionResult = { ok: true; changed: boolean } | { ok: false; status: 400 | 403; code: string; message: string };

/**
 * A mark from another node, after its signature and freshness were checked. The reactor must be a
 * person or agent of the node that signed it, and a party of a copy this node holds; the agent named
 * in `by_agent` must be the reactor's own. Never sent on: the node where it was given sends it to
 * every node itself.
 */
export async function applyRemoteReaction(
  ctx: DeliveryCtx, sourceNode: string,
  input: { message_id: unknown; reaction: unknown; reactor: unknown; by_agent: unknown; op: unknown },
): Promise<RemoteReactionResult> {
  const messageId = typeof input.message_id === 'string' ? input.message_id : '';
  const reactorGhii = typeof input.reactor === 'string' ? input.reactor : '';
  const byAgent = typeof input.by_agent === 'string' && input.by_agent ? input.by_agent : undefined;
  const reaction = normalizeReaction(input.reaction);
  const op = input.op === 'remove' ? 'remove' : input.op === 'add' ? 'add' : null;
  if (!messageId || !reactorGhii || !reaction || !op) {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'message_id, reaction (1-32 characters), reactor and op (add or remove) are required' };
  }
  if (parseGaiiLoose(reactorGhii).node !== sourceNode || (byAgent && (parseGaiiLoose(byAgent).node !== sourceNode || !isSameOwner(byAgent, reactorGhii)))) {
    return { ok: false, status: 403, code: 'FORBIDDEN', message: 'A node sends the marks of its own people and agents only' };
  }
  for (const copy of await ctx.storage.listDirectMessageCopies(messageId)) {
    const convo = await ctx.storage.getConversation(copy.conversationId);
    if (!isParty(copy, convo, reactorGhii)) continue;
    const removed = op === 'remove';
    const changed = removed
      ? await ctx.storage.removeMessageReaction(messageId, reaction, reactorGhii)
      : await ctx.storage.addMessageReaction({ messageId, reaction, reactorGhii, ...(byAgent ? { byAgent } : {}), createdAt: new Date().toISOString() });
    if (changed) await announce(ctx, copy, convo, { reaction, reactorGhii, byAgent, removed }, { federate: false });
    return { ok: true, changed };
  }
  return { ok: false, status: 403, code: 'FORBIDDEN', message: 'No message here that the reactor is a party of' };
}
