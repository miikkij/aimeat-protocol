/**
 * @file messages.ts
 * @description REST endpoints for human↔human direct messaging (GHII↔GHII). Send (owner / agent /
 *   ecosystem sender → human recipient), inbox, conversation threads, read receipts, delete, plus
 *   the first-contact consent gate (requests / accept / block). This layer handles SAME-NODE (local)
 *   delivery; cross-node federation delivery is added in a later layer. Recipients are always humans.
 * @structure
 *   - POST   /v1/messages                                  -- send a message
 *   - GET    /v1/messages/inbox                            -- inbound messages from accepted contacts
 *   - GET    /v1/messages/conversations                    -- thread list (accepted)
 *   - GET    /v1/messages/conversations/:conversationId    -- full thread
 *   - POST   /v1/messages/conversations/:conversationId/read -- mark thread read (+ local receipt)
 *   - PATCH  /v1/messages/:id/read                         -- mark one message read (+ local receipt)
 *   - DELETE /v1/messages/:id                              -- delete the caller's copy
 *   - GET    /v1/messages/requests                         -- pending first-contact requests
 *   - POST   /v1/messages/requests/:contactId/accept       -- accept a contact
 *   - POST   /v1/messages/contacts/:contactId/block        -- block a contact (or proactive hard block)
 *   - GET    /v1/messages/contacts                         -- list contacts + states
 * @usage import { messagesRouter } from '../routes/messages.js'; app.use(messagesRouter(config, storage));
 * @version-history
 *   v1.0.0 -- 2026-06-16 -- Initial creation: local (same-node) direct messaging + first-contact gate.
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, DirectMessageRecord, DirectMessageAttachment } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { requireAuth, requireRole, requireScope, requireExternalPrincipal } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity, isSameOwner, parseGaiiLoose } from '../utils/gaii.js';
import { conversationIdFor, messagePreview } from '../utils/messaging.js';
import { notify } from '../services/notify.js';
import { emitChange } from '../services/event-bus.js';
import { MessageSendSchema } from '../models/message-schemas.js';
import { deliverDirectMessage, propagateReadReceipt } from '../services/message-delivery.js';
import { duplicateMessageAttachments } from '../services/attachment-duplication.js';

export function messagesRouter(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): Router {
  const router = Router();
  const deliveryCtx = { config, storage, peers };

  /** Resolve the caller's effective identity (owner→GHII, agent/eco→sub). */
  const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

  /** Validate a recipient string is a well-formed human GHII (owner@node, never agent/eco). */
  function isHumanGhii(id: string): boolean {
    if (id.includes('#') || id.startsWith('eco:')) return false;
    const p = parseGaiiLoose(id);
    return !!p.owner && !!p.node && !p.agent;
  }

  function mapAttachments(
    input: NonNullable<ReturnType<typeof MessageSendSchema.parse>['attachments']>,
    senderGhii: string,
  ): DirectMessageAttachment[] {
    return input.map(a => ({
      id: a.id ?? randomUUID().slice(0, 8),
      inline: a.inline,
      storageKey: a.storage_key,
      ownerGhii: senderGhii,
      originNodeId: config.nodeId,
      // Same-node messages can reference the sender's storage directly; cross-node duplication
      // (and the reference→duplicate-on-accept rule) is wired in the attachments layer.
      mode: 'reference',
      mime: a.mime,
      size: a.size,
      name: a.name,
      kind: a.kind,
    }));
  }

  /* ── POST /v1/messages — send ── */
  router.post('/v1/messages', requireAuth(), requireExternalPrincipal(), requireScope('messages:send'), async (req, res) => {
    const parsed = MessageSendSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    const input = parsed.data;
    const senderGhii = resolve(req);
    const recipientGhii = input.to.trim();

    if (!isHumanGhii(recipientGhii)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Recipient must be a human GHII (owner@node)'));
      return;
    }
    if (recipientGhii === senderGhii) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Cannot send a message to yourself'));
      return;
    }

    const recipientNode = parseGaiiLoose(recipientGhii).node;
    const isLocal = recipientNode === config.nodeId;

    const id = randomUUID();
    const now = new Date().toISOString();
    const conversationId = conversationIdFor(senderGhii, recipientGhii);
    const attachments = input.attachments ? mapAttachments(input.attachments, senderGhii) : undefined;

    // For a local recipient, enforce the first-contact gate (block) BEFORE materialising delivery.
    if (isLocal) {
      const recipientOwner = parseGaiiLoose(recipientGhii).owner;
      const ownerRec = await storage.getOwner(recipientOwner);
      if (!ownerRec) {
        res.status(404).json(error(config.nodeId, 'RECIPIENT_NOT_FOUND', `No such recipient: ${recipientGhii}`));
        return;
      }
      const contact = await storage.getContact(recipientGhii, senderGhii);
      if (contact?.state === 'blocked') {
        // Record the sender's own copy as undeliverable; do not deliver to the recipient.
        await storage.createDirectMessage({
          id, ownerGhii: senderGhii, conversationId, senderGhii, recipientGhii,
          body: input.body, attachments, status: 'undeliverable', direction: 'outbound',
          replyToId: input.reply_to, origin: 'local', originNodeId: config.nodeId,
          error: 'blocked', createdAt: now,
        });
        res.status(403).json(error(config.nodeId, 'BLOCKED', 'The recipient is not accepting messages from you'));
        return;
      }
    }

    // Sender's outbound copy.
    const senderCopy: DirectMessageRecord = {
      id, ownerGhii: senderGhii, conversationId, senderGhii, recipientGhii,
      body: input.body, attachments,
      status: isLocal ? 'delivered' : 'queued',
      direction: 'outbound', replyToId: input.reply_to,
      origin: 'local', originNodeId: config.nodeId,
      createdAt: now, deliveredAt: isLocal ? now : undefined,
    };
    await storage.createDirectMessage(senderCopy);

    // Sending implies the sender accepts this contact on their OWN side, so the recipient's
    // replies flow back freely (no spurious request gate on the initiator). Never overrides a block.
    const senderContact = await storage.getContact(senderGhii, recipientGhii);
    if (senderContact?.state !== 'blocked') {
      await storage.setContactState(senderGhii, recipientGhii, 'accepted');
    }

    if (isLocal) {
      // Resolve / seed the recipient-side contact state (first-contact gate).
      let contact = await storage.getContact(recipientGhii, senderGhii);
      if (!contact) {
        // Auto-accept the recipient's own agents/apps; everyone else becomes a pending request.
        const autoAccept = isSameOwner(senderGhii, recipientGhii);
        contact = await storage.setContactState(recipientGhii, senderGhii, autoAccept ? 'accepted' : 'pending', id);
      }
      const isRequest = contact.state === 'pending';

      // Recipient's inbound copy.
      await storage.createDirectMessage({
        id, ownerGhii: recipientGhii, conversationId, senderGhii, recipientGhii,
        body: input.body, attachments, status: 'delivered', direction: 'inbound',
        replyToId: input.reply_to, origin: 'local', originNodeId: config.nodeId,
        createdAt: now, deliveredAt: now,
      });

      // Duplicate attachments into the recipient's storage now (accepted contacts only; a pending
      // request keeps them as reference until accepted — DECISION #3).
      if (!isRequest && attachments?.length) {
        const recCopy = await storage.getDirectMessage(id, recipientGhii);
        if (recCopy) {
          const dup = await duplicateMessageAttachments(deliveryCtx, recipientGhii, recCopy);
          if (dup.changed) await storage.updateMessageAttachments(id, recipientGhii, dup.attachments);
        }
      }

      await notify(storage, recipientGhii, {
        type: isRequest ? 'direct_message_request' : 'direct_message',
        title: isRequest ? `${senderGhii} wants to message you` : `New message from ${senderGhii}`,
        body: messagePreview(input.body),
        link: isRequest ? '/v1/profile#inbox/requests' : `/v1/profile#inbox/${conversationId}`,
      });
      emitChange('messages');
    } else {
      // Cross-node: attempt federation delivery now; if the peer is unreachable it stays queued
      // and the retry job will deliver it later. deliverDirectMessage updates the stored status.
      const outcome = await deliverDirectMessage(deliveryCtx, senderCopy);
      senderCopy.status = outcome;
      if (outcome === 'delivered') senderCopy.deliveredAt = new Date().toISOString();
      emitChange('messages');
    }

    res.status(201).json(success(config.nodeId, { message: senderCopy }, [
      { description: 'View conversation', method: 'GET', url: `/v1/messages/conversations/${conversationId}` },
      { description: 'View inbox', method: 'GET', url: '/v1/messages/inbox' },
    ]));
  });

  /* ── GET /v1/messages/inbox — inbound from accepted contacts ── */
  router.get('/v1/messages/inbox', requireAuth(), requireRole('owner'), async (req, res) => {
    const ghii = resolve(req);
    const unreadOnly = req.query.unread === 'true';
    const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page as string || '20', 10)));

    const { messages, total, unread } = await storage.listInbox(ghii, { unreadOnly, page, perPage });
    const pending = new Set((await storage.listContacts(ghii, { state: 'pending' })).map(c => c.contactId));
    const visible = messages.filter(m => !pending.has(m.senderGhii));

    res.json(success(config.nodeId, { messages: visible, total, unread, page, per_page: perPage }));
  });

  /* ── GET /v1/messages/conversations — thread list (accepted) ── */
  router.get('/v1/messages/conversations', requireAuth(), requireRole('owner'), async (req, res) => {
    const ghii = resolve(req);
    const contacts = await storage.listContacts(ghii);
    const hidden = new Set(contacts.filter(c => c.state === 'pending' || c.state === 'blocked').map(c => c.contactId));
    const conversations = (await storage.listConversations(ghii)).filter(c => !hidden.has(c.peerGhii));
    res.json(success(config.nodeId, { conversations }));
  });

  /* ── GET /v1/messages/conversations/:conversationId — full thread ── */
  router.get('/v1/messages/conversations/:conversationId', requireAuth(), requireRole('owner'), async (req, res) => {
    const ghii = resolve(req);
    const conversationId = req.params.conversationId as string;
    const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
    const perPage = Math.min(200, Math.max(1, parseInt(req.query.per_page as string || '50', 10)));
    const result = await storage.listConversation(ghii, conversationId, { page, perPage });
    res.json(success(config.nodeId, { messages: result.messages, total: result.total, page, per_page: perPage }));
  });

  /* ── POST /v1/messages/conversations/:conversationId/read — mark thread read ── */
  router.post('/v1/messages/conversations/:conversationId/read', requireAuth(), requireRole('owner'), async (req, res) => {
    const ghii = resolve(req);
    const conversationId = req.params.conversationId as string;
    // Capture unread inbound messages first so we can fire read receipts (local or cross-node).
    const before = await storage.listConversation(ghii, conversationId, { page: 1, perPage: 200 });
    const unread = before.messages.filter(m => m.direction === 'inbound' && !m.readAt);
    const count = await storage.markConversationRead(ghii, conversationId);
    const now = new Date().toISOString();
    for (const m of unread) await propagateReadReceipt(deliveryCtx, m, now);
    emitChange('messages');
    res.json(success(config.nodeId, { read: count }));
  });

  /* ── PATCH /v1/messages/:id/read — mark one message read ── */
  router.patch('/v1/messages/:id/read', requireAuth(), requireRole('owner'), async (req, res) => {
    const ghii = resolve(req);
    const id = req.params.id as string;
    const updated = await storage.markMessageRead(id, ghii);
    if (!updated) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Message not found'));
      return;
    }
    // Read receipt to the sender's copy (local update or signed cross-node receipt).
    await propagateReadReceipt(deliveryCtx, updated, updated.readAt ?? new Date().toISOString());
    emitChange('messages');
    res.json(success(config.nodeId, { message: updated }));
  });

  /* ── DELETE /v1/messages/:id — delete the caller's copy ── */
  router.delete('/v1/messages/:id', requireAuth(), requireRole('owner'), async (req, res) => {
    const ghii = resolve(req);
    const id = req.params.id as string;
    const ok = await storage.deleteDirectMessage(id, ghii);
    if (!ok) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Message not found'));
      return;
    }
    emitChange('messages');
    res.json(success(config.nodeId, { deleted: true }));
  });

  /* ── GET /v1/messages/requests — pending first-contact requests ── */
  router.get('/v1/messages/requests', requireAuth(), requireRole('owner'), async (req, res) => {
    const ghii = resolve(req);
    const pending = await storage.listContacts(ghii, { state: 'pending' });
    const requests = await Promise.all(pending.map(async c => {
      const first = c.firstMessageId ? await storage.getDirectMessage(c.firstMessageId, ghii) : null;
      return {
        contactId: c.contactId,
        conversationId: first?.conversationId ?? conversationIdFor(ghii, c.contactId),
        preview: messagePreview(first?.body ?? ''),
        createdAt: c.createdAt,
      };
    }));
    res.json(success(config.nodeId, { requests }));
  });

  /* ── POST /v1/messages/requests/:contactId/accept — accept a contact ── */
  router.post('/v1/messages/requests/:contactId/accept', requireAuth(), requireRole('owner'), async (req, res) => {
    const ghii = resolve(req);
    const contactId = req.params.contactId as string;
    const contact = await storage.getContact(ghii, contactId);
    if (!contact) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such contact request'));
      return;
    }
    const updated = await storage.setContactState(ghii, contactId, 'accepted');

    // Now that the contact is accepted, duplicate any attachments that were held as reference
    // while the request was pending (DECISION #3/#10).
    const convId = conversationIdFor(ghii, contactId);
    const conv = await storage.listConversation(ghii, convId, { page: 1, perPage: 200 });
    for (const m of conv.messages) {
      if (m.direction === 'inbound' && m.attachments?.some(a => a.mode !== 'duplicate')) {
        const dup = await duplicateMessageAttachments(deliveryCtx, ghii, m);
        if (dup.changed) await storage.updateMessageAttachments(m.id, ghii, dup.attachments);
      }
    }

    emitChange('messages');
    res.json(success(config.nodeId, { contact: updated }));
  });

  /* ── POST /v1/messages/contacts/:contactId/block — block (or proactive hard block) ── */
  router.post('/v1/messages/contacts/:contactId/block', requireAuth(), requireRole('owner'), async (req, res) => {
    const ghii = resolve(req);
    const contactId = req.params.contactId as string;
    const updated = await storage.setContactState(ghii, contactId, 'blocked');
    emitChange('messages');
    res.json(success(config.nodeId, { contact: updated }));
  });

  /* ── GET /v1/messages/contacts — list contacts + states ── */
  router.get('/v1/messages/contacts', requireAuth(), requireRole('owner'), async (req, res) => {
    const ghii = resolve(req);
    const state = req.query.state as 'pending' | 'accepted' | 'blocked' | undefined;
    const contacts = await storage.listContacts(ghii, state ? { state } : undefined);
    res.json(success(config.nodeId, { contacts }));
  });

  return router;
}
