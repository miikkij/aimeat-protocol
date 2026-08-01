/**
 * @file message-send.ts
 * @description The core "create + deliver a direct message" path, extracted from the POST /v1/messages
 *   route so it can be called server-side (no HTTP session) — e.g. by the Tracked Response evaluator
 *   when it sends an automated federated reply. Builds the sender's outbound copy, enforces the
 *   first-contact / block gate, seeds contact consent, and either delivers locally (recipient inbound
 *   copy + notify + attachment duplication) or hands off to cross-node federation delivery. Behaviour
 *   is identical to the inline logic the route used previously; the route is now a thin caller.
 * @structure sendDirectMessage(ctx, input) → { ok, message } | { ok:false, code }
 * @usage import { sendDirectMessage } from '../services/message-send.js';
 * @version-history
 *   v1.0.0 — 2026-06-21 — Extracted from routes/messages.ts for reuse by Tracked Response replies.
 *   v1.1.0 — 2026-06-21 — Allow replying to an AGENT/eco identity that messaged you: the stored copy +
 *     conversation keep the agent GAII (so the thread is intact), but delivery is routed to the agent's
 *     OWNER human inbox (the owner reads + acts on their agent's DMs) — works on un-upgraded peers too.
 *   v1.2.0 — 2026-06-23 — Carry the optional `interactive` payload (federated AskUserQuestion) onto every
 *     stored copy + the dm.inbound push (as the role) so questions/answers survive send + delivery.
 *   v1.4.0 — 2026-08-01 — TARGET-058 Phase 4: `aiProvenanceId` rides onto every stored copy, so a
 *     message an agent wrote can say so in the recipient's own inbox. A DM is the case Article 50
 *     cares most about — AI-written text delivered to a named person rather than published — and it
 *     was the one write surface with nowhere to record it. Cross-node is unchanged and therefore
 *     unstated on the receiving side; see the field's doc comment.
 *   v1.3.0 — 2026-06-28 — Wake node-run system agents (Secretary/specialist) live: a DM to your OWN such
 *     agent fire-and-forget dispatches to system-agent-responder (real-time reply) instead of waiting for
 *     the tick. Dynamic import avoids the responder↔message-send cycle; the responder no-ops for non-system.
 */
import { randomUUID } from 'node:crypto';
import type { DirectMessageRecord, DirectMessageAttachment, InteractivePayload } from '../storage/interface.js';
import type { MessageAttachmentInput } from '../models/message-schemas.js';
import { isSameOwner, parseGaiiLoose } from '../utils/gaii.js';
import { conversationIdFor, messagePreview, messagePreviewWithAttachments, deliveryTargetFor } from '../utils/messaging.js';
import { notify } from './notify.js';
import { emitChange, emitDelivery } from './event-bus.js';
import { deliverDirectMessage, logDelivery, type DeliveryCtx } from './message-delivery.js';
import { duplicateMessageAttachments } from './attachment-duplication.js';

export interface SendMessageInput {
  senderGhii: string;
  recipientGhii: string;
  body: string;
  replyToId?: string;
  attachments?: DirectMessageAttachment[];
  /** Override the thread id: omit → the deterministic pair thread; provide a fresh id (with `subject`)
   *  to open a new subject thread, or an existing thread's id to continue it. */
  conversationId?: string;
  /** Subject for a new thread (stored on this message; surfaced as the thread title). */
  subject?: string;
  /** Optional interactive payload — a question set (agent asks) or the human's answers (reply). */
  interactive?: InteractivePayload;
  /** Set when this is one copy of a broadcast (send-to-many) — groups copies for the results view. */
  broadcastId?: string;
  /** false = an announcement (recipient cannot reply). Omitted/true = normal. Travels with the message. */
  respondable?: boolean;
  /** Auto-accept the first-contact gate (operator announcements → land in inbox, not requests). */
  skipContactGate?: boolean;
  /**
   * TARGET-058: the provenance record describing `body` — how much of it a model wrote and whether a
   * person read the substance first. Both mailbox copies carry the same id, because the statement is
   * about the bytes rather than about whose row it is.
   *
   * A direct message is the case Article 50 cares most about: AI-written text DELIVERED to a named
   * person, rather than published for whoever comes along. Absent means unstated, never "a human
   * wrote it".
   *
   * CROSS-NODE CAVEAT, stated rather than hidden: the id is node-local, so the sender's copy carries
   * it and a peer receiving the message over federation stores nothing. Content arriving from a peer
   * that strips provenance is therefore unstated — which is the correct reading — but carrying the
   * record itself across the boundary is a federation-payload change this phase does not make.
   */
  aiProvenanceId?: string;
}

/**
 * Map sender-supplied attachment descriptors (the wire/schema shape `{ storage_key, mime, … }`) to the
 * stored `DirectMessageAttachment` form. Attachments start as `reference` (point at the sender's storage
 * key); cross-node duplication promotes them to `duplicate` on accept. Shared by the REST send route and
 * the MCP `aimeat_dm_send` tool so both produce identical records.
 */
export function mapMessageAttachments(
  input: MessageAttachmentInput[],
  senderGhii: string,
  nodeId: string,
): DirectMessageAttachment[] {
  return input.map(a => ({
    id: a.id ?? randomUUID().slice(0, 8),
    inline: a.inline,
    storageKey: a.storage_key,
    ownerGhii: senderGhii,
    originNodeId: nodeId,
    mode: 'reference',
    mime: a.mime,
    size: a.size,
    name: a.name,
    kind: a.kind,
    durationSeconds: a.duration_seconds,
    // A transcript that arrives with a message is the SENDER's, whatever the client claimed: `by` is
    // provenance, and a reader deciding whether to trust the text needs it to mean something. A
    // recipient's own transcript is written to their own copy after delivery, never sent.
    transcript: a.transcript
      ? {
        text: a.transcript.text,
        by: 'sender' as const,
        model: a.transcript.model,
        lang: a.transcript.lang,
        seconds: a.transcript.seconds,
        at: a.transcript.at ?? new Date().toISOString(),
      }
      : undefined,
  }));
}

export type SendMessageResult =
  | { ok: true; message: DirectMessageRecord }
  | { ok: false; code: 'RECIPIENT_NOT_FOUND' | 'BLOCKED' };

/**
 * Create and deliver a direct message from `senderGhii` to `recipientGhii`. Same-node recipients are
 * delivered inline (with the first-contact gate); cross-node recipients are handed to federation
 * delivery (queued + retried if the peer is unreachable). Never throws on a blocked/unknown recipient —
 * returns a structured result the caller maps to HTTP or ignores.
 */
export async function sendDirectMessage(ctx: DeliveryCtx, input: SendMessageInput): Promise<SendMessageResult> {
  const { config, storage } = ctx;
  const { senderGhii, recipientGhii, body, replyToId, attachments, subject, interactive, broadcastId, respondable, aiProvenanceId } = input;

  // recipientGhii is what the thread is WITH (may be an agent/eco GAII). deliveryGhii is where the
  // message physically lands (the owner's human GHII for an agent/eco recipient; itself for a human).
  const deliveryGhii = deliveryTargetFor(recipientGhii);
  const recipientNode = parseGaiiLoose(deliveryGhii).node;
  const isLocal = recipientNode === config.nodeId;

  const id = randomUUID();
  const now = new Date().toISOString();
  // Default: the deterministic per-pair thread. An explicit conversationId continues a specific thread;
  // a `subject` with no id opens a NEW thread (fresh minted id). Both nodes share the id via the payload.
  const conversationId = input.conversationId
    || (subject ? randomUUID() : conversationIdFor(senderGhii, recipientGhii));

  // For a local recipient, enforce the first-contact gate (block) BEFORE materialising delivery.
  if (isLocal) {
    const recipientOwner = parseGaiiLoose(deliveryGhii).owner;
    const ownerRec = await storage.getOwner(recipientOwner);
    if (!ownerRec) return { ok: false, code: 'RECIPIENT_NOT_FOUND' };
    const contact = await storage.getContact(deliveryGhii, senderGhii);
    if (contact?.state === 'blocked') {
      // Record the sender's own copy as undeliverable; do not deliver to the recipient.
      await storage.createDirectMessage({
        id, ownerGhii: senderGhii, conversationId, subject, senderGhii, recipientGhii,
        body, attachments, interactive, broadcastId, respondable, status: 'undeliverable', direction: 'outbound',
        replyToId, origin: 'local', originNodeId: config.nodeId, aiProvenanceId,
        error: 'blocked', createdAt: now,
      });
      return { ok: false, code: 'BLOCKED' };
    }
  }

  // Sender's outbound copy.
  const senderCopy: DirectMessageRecord = {
    id, ownerGhii: senderGhii, conversationId, subject, senderGhii, recipientGhii,
    body, attachments, interactive, broadcastId, respondable,
    status: isLocal ? 'delivered' : 'queued',
    direction: 'outbound', replyToId,
    origin: 'local', originNodeId: config.nodeId, aiProvenanceId,
    createdAt: now, deliveredAt: isLocal ? now : undefined,
  };
  await storage.createDirectMessage(senderCopy);

  // Sending implies the sender accepts this contact on their OWN side, so the recipient's replies flow
  // back freely (no spurious request gate on the initiator). Never overrides a block.
  const senderContact = await storage.getContact(senderGhii, recipientGhii);
  if (senderContact?.state !== 'blocked') {
    await storage.setContactState(senderGhii, recipientGhii, 'accepted');
  }

  if (isLocal) {
    // Sending to your OWN agent/eco: delivery resolves to you (the owner). The owner's mailbox already
    // holds the sender (outbound) copy, so the inbound copy is owned by the AGENT to avoid a primary-key
    // clash (id+ownerGhii) — the agent reads it (recipientGhii match) and you see your sent copy. No
    // first-contact gate or self-notification for your own agent.
    const ownAgent = deliveryGhii === senderGhii;
    const inboundOwner = ownAgent ? recipientGhii : deliveryGhii;

    let isRequest = false;
    if (!ownAgent) {
      // Resolve / seed the recipient-side contact state (first-contact gate) under the OWNER's inbox.
      let contact = await storage.getContact(deliveryGhii, senderGhii);
      if (!contact) {
        // skipContactGate (operator announcements) auto-accepts so a node/federation-wide notice lands
        // in the inbox instead of the first-contact requests bucket.
        const autoAccept = isSameOwner(senderGhii, deliveryGhii) || !!input.skipContactGate;
        contact = await storage.setContactState(deliveryGhii, senderGhii, autoAccept ? 'accepted' : 'pending', id);
      }
      isRequest = contact.state === 'pending';
    }

    // Recipient's inbound copy. recipientGhii names the agent/eco the thread is with; ownerGhii is the
    // mailbox it lands in (the owner, or the agent itself for your own agent — see above).
    await storage.createDirectMessage({
      id, ownerGhii: inboundOwner, conversationId, subject, senderGhii, recipientGhii,
      body, attachments, interactive, broadcastId, respondable, status: 'delivered', direction: 'inbound',
      replyToId, origin: 'local', originNodeId: config.nodeId, aiProvenanceId,
      createdAt: now, deliveredAt: now,
    });

    // Duplicate attachments into the recipient's storage now (accepted contacts only; a pending request
    // keeps them as reference until accepted — DECISION #3). Own-agent shares the owner's storage, so the
    // reference is already readable — no duplication needed.
    if (!ownAgent && !isRequest && attachments?.length) {
      const recCopy = await storage.getDirectMessage(id, inboundOwner);
      if (recCopy) {
        const dup = await duplicateMessageAttachments(ctx, inboundOwner, recCopy);
        if (dup.changed) await storage.updateMessageAttachments(id, inboundOwner, dup.attachments);
      }
    }

    if (!ownAgent) {
      await notify(storage, deliveryGhii, {
        type: isRequest ? 'direct_message_request' : 'direct_message',
        title: isRequest ? `${senderGhii} wants to message you` : `New message from ${senderGhii}`,
        body: messagePreviewWithAttachments(body, attachments),
        // Request → 'req:<conversationId>': while pending it lands on the inbox requests list, but once
        // the request is accepted the same notification opens the now-existing thread (see inbox-tab
        // consumeDeepLink). A delivered DM deep-links straight to its conversation.
        link: isRequest ? `/v1/profile#inbox/req:${conversationId}` : `/v1/profile#inbox/${conversationId}`,
        // A delivered DM gets an inline reply box in the bell (POST /v1/messages back to the sender).
        // A pending request has no thread to reply into yet — it keeps its navigate-to-requests link.
        actions: isRequest ? undefined : [
          { id: 'reply', label: 'Reply', kind: 'reply', to: senderGhii, conversationId, subject: subject || undefined, replyTo: id },
        ],
      });
    }
    await logDelivery(ctx, { messageId: id, origin: 'local', targetNodeId: config.nodeId, status: 'delivered', latencyMs: 0 });
    emitChange('messages');

    // Event-based push: if the actual recipient is an agent/eco (delivery routed to its owner), wake it
    // over the connect tunnel (mirrors task_assigned / workspace.record) so it acts on the DM without
    // polling. The owner keeps the mailbox copy above. (MCP-resource push is emitted by the route layer
    // to avoid a service→mcp import cycle; the tunnel deliver is what connect-serve agents drain.)
    if (recipientGhii !== deliveryGhii) {
      emitDelivery({
        target: recipientGhii, kind: 'dm.inbound', id,
        // Field names match the DirectMessageRecord / GET /v1/messages/agent-inbox shape (camelCase + GHII),
        // so the daemon's wake and its full-context fetch use ONE shape. `preview` + `attachments` (count)
        // are the lightweight extras; read the full body/attachments via aimeat_dm_thread(conversationId).
        payload: {
          id, conversationId, subject: subject ?? null, senderGhii,
          preview: messagePreview(body), attachments: attachments?.length ?? 0, createdAt: now,
          // Let the woken agent distinguish a question it should answer from a normal/answer DM.
          interactive: interactive?.role ?? null,
        },
      });
    }
  } else {
    // Cross-node: attempt federation delivery now; if the peer is unreachable it stays queued and the
    // retry job will deliver it later. Delivery targets the owner's human GHII (deliveryGhii) so the
    // peer node accepts it; the payload keeps the agent-based conversationId for threading.
    const outcome = await deliverDirectMessage(ctx, senderCopy, deliveryGhii);
    senderCopy.status = outcome;
    if (outcome === 'delivered') senderCopy.deliveredAt = new Date().toISOString();
    emitChange('messages');
  }

  return { ok: true, message: senderCopy };
}
