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
 */
import { randomUUID } from 'node:crypto';
import type { DirectMessageRecord, DirectMessageAttachment } from '../storage/interface.js';
import { isSameOwner, parseGaiiLoose } from '../utils/gaii.js';
import { conversationIdFor, messagePreview, deliveryTargetFor } from '../utils/messaging.js';
import { notify } from './notify.js';
import { emitChange } from './event-bus.js';
import { deliverDirectMessage, logDelivery, type DeliveryCtx } from './message-delivery.js';
import { duplicateMessageAttachments } from './attachment-duplication.js';

export interface SendMessageInput {
  senderGhii: string;
  recipientGhii: string;
  body: string;
  replyToId?: string;
  attachments?: DirectMessageAttachment[];
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
  const { senderGhii, recipientGhii, body, replyToId, attachments } = input;

  // recipientGhii is what the thread is WITH (may be an agent/eco GAII). deliveryGhii is where the
  // message physically lands (the owner's human GHII for an agent/eco recipient; itself for a human).
  const deliveryGhii = deliveryTargetFor(recipientGhii);
  const recipientNode = parseGaiiLoose(deliveryGhii).node;
  const isLocal = recipientNode === config.nodeId;

  const id = randomUUID();
  const now = new Date().toISOString();
  const conversationId = conversationIdFor(senderGhii, recipientGhii);

  // For a local recipient, enforce the first-contact gate (block) BEFORE materialising delivery.
  if (isLocal) {
    const recipientOwner = parseGaiiLoose(deliveryGhii).owner;
    const ownerRec = await storage.getOwner(recipientOwner);
    if (!ownerRec) return { ok: false, code: 'RECIPIENT_NOT_FOUND' };
    const contact = await storage.getContact(deliveryGhii, senderGhii);
    if (contact?.state === 'blocked') {
      // Record the sender's own copy as undeliverable; do not deliver to the recipient.
      await storage.createDirectMessage({
        id, ownerGhii: senderGhii, conversationId, senderGhii, recipientGhii,
        body, attachments, status: 'undeliverable', direction: 'outbound',
        replyToId, origin: 'local', originNodeId: config.nodeId,
        error: 'blocked', createdAt: now,
      });
      return { ok: false, code: 'BLOCKED' };
    }
  }

  // Sender's outbound copy.
  const senderCopy: DirectMessageRecord = {
    id, ownerGhii: senderGhii, conversationId, senderGhii, recipientGhii,
    body, attachments,
    status: isLocal ? 'delivered' : 'queued',
    direction: 'outbound', replyToId,
    origin: 'local', originNodeId: config.nodeId,
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
    // Resolve / seed the recipient-side contact state (first-contact gate) under the OWNER's inbox.
    let contact = await storage.getContact(deliveryGhii, senderGhii);
    if (!contact) {
      const autoAccept = isSameOwner(senderGhii, deliveryGhii);
      contact = await storage.setContactState(deliveryGhii, senderGhii, autoAccept ? 'accepted' : 'pending', id);
    }
    const isRequest = contact.state === 'pending';

    // Recipient's inbound copy — owned by the OWNER's inbox, but recipientGhii still names the agent/eco
    // identity the thread is with (so it threads with the message they sent you).
    await storage.createDirectMessage({
      id, ownerGhii: deliveryGhii, conversationId, senderGhii, recipientGhii,
      body, attachments, status: 'delivered', direction: 'inbound',
      replyToId, origin: 'local', originNodeId: config.nodeId,
      createdAt: now, deliveredAt: now,
    });

    // Duplicate attachments into the recipient's storage now (accepted contacts only; a pending request
    // keeps them as reference until accepted — DECISION #3).
    if (!isRequest && attachments?.length) {
      const recCopy = await storage.getDirectMessage(id, deliveryGhii);
      if (recCopy) {
        const dup = await duplicateMessageAttachments(ctx, deliveryGhii, recCopy);
        if (dup.changed) await storage.updateMessageAttachments(id, deliveryGhii, dup.attachments);
      }
    }

    await notify(storage, deliveryGhii, {
      type: isRequest ? 'direct_message_request' : 'direct_message',
      title: isRequest ? `${senderGhii} wants to message you` : `New message from ${senderGhii}`,
      body: messagePreview(body),
      link: isRequest ? '/v1/profile#inbox/requests' : `/v1/profile#inbox/${conversationId}`,
    });
    await logDelivery(ctx, { messageId: id, origin: 'local', targetNodeId: config.nodeId, status: 'delivered', latencyMs: 0 });
    emitChange('messages');
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
