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
 *   v1.1.0 -- 2026-06-21 -- Extract the send/deliver core into services/message-send.ts (shared with
 *     Tracked Response replies); the route is now a thin caller. Behaviour unchanged.
 *   v1.2.0 -- 2026-07-12 -- Owner-aggregation in the conversation list: an owner also sees conversations
 *     their OWN agents had with external people (an agent DM'd a user from its own inbox), tagged
 *     `viaAgent`. GET conversations/:id accepts `?agent=<gaii>` to read such a thread read-only under the
 *     (ownership-verified) agent. Only this owner's agents — server-derived, no cross-owner leak.
 *   v1.3.0 -- 2026-07-16 -- GET /conversations moved onto MessagingDbService: the owner + per-agent
 *     conversations fan-out is now ONE batched read (listConversationsForOwners), behaviour unchanged.
 *   v1.4.0 -- 2026-07-16 -- GET /requests fetches every pending contact's first message in ONE batched
 *     read (getDirectMessagesByIds) instead of getDirectMessage per pending contact.
 *   v1.5.0 -- 2026-07-16 -- GET /messages/overview: the inbox mount's 6-request fan-out folded into one
 *     composite (MessagesInboxService, Phase 4). Individual list endpoints stay for interactive re-fetch.
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, DirectMessageRecord } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { requireAuth, requireRole, requireScope, requireExternalPrincipal } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity, parseGaiiLoose } from '../utils/gaii.js';
import { conversationIdFor, messagePreview, deliveryTargetFor } from '../utils/messaging.js';
import { emitChange } from '../services/event-bus.js';
import { MessageSendSchema, BroadcastSendSchema } from '../models/message-schemas.js';
import { propagateReadReceipt } from '../services/message-delivery.js';
import { sendDirectMessage, mapMessageAttachments } from '../services/message-send.js';
import { resolveAudience, sendBroadcast, broadcastToFederation } from '../services/message-broadcast.js';
import { duplicateMessageAttachments } from '../services/attachment-duplication.js';
import { createMessagingDbService } from '../services/db/messaging-db-service.js';
import { createMessagesInboxService } from '../services/db/messages-inbox-db-service.js';

export function messagesRouter(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): Router {
  const router = Router();
  const deliveryCtx = { config, storage, peers };
  const messagingDb = createMessagingDbService(storage);
  const inboxDb = createMessagesInboxService(storage);

  /** Resolve the caller's effective identity (owner→GHII, agent/eco→sub). */
  const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

  /** A recipient must resolve to an owner@node — a human GHII, an agent GAII (agent#owner@node) or an
   *  ecosystem app (eco:app#owner@node). Agents/eco have no inbox of their own, so a reply addressed to
   *  one is delivered to the owner's human inbox (deliveryTargetFor); the thread keeps the agent/eco
   *  identity. This is what lets you reply to an agent that messaged you. */
  function isAddressableRecipient(id: string): boolean {
    const p = parseGaiiLoose(id);
    return !!p.owner && !!p.node;
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

    if (!isAddressableRecipient(recipientGhii)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Recipient must be a GHII (owner@node), an agent (agent#owner@node) or an app (eco:app#owner@node)'));
      return;
    }
    // Block only a LITERAL self-message (you → you). Messaging your OWN agent/app IS allowed: the inbox
    // is the uniform channel for DMing any agent — yours or someone else's — and the message is delivered
    // to the agent (which reads it), with your mailbox holding the copy so you see + can intervene.
    if (recipientGhii === senderGhii) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Cannot send a message to yourself'));
      return;
    }

    const attachments = input.attachments ? mapMessageAttachments(input.attachments, senderGhii, config.nodeId) : undefined;

    // Interactive answers must point at a real question the sender actually received (prevents orphan
    // answers). The copy lives in the sender's mailbox: for a human that is their own GHII; for an agent
    // the question landed in its OWNER's mailbox with recipientGhii = the agent. So resolve the mailbox via
    // deliveryTargetFor and require the question be addressed to (or owned by) the sender. The question spec
    // itself (role:'questions') is validated structurally by Zod.
    if (input.interactive?.role === 'answers') {
      const mailbox = deliveryTargetFor(senderGhii);
      const question = await storage.getDirectMessage(input.interactive.answersFor, mailbox);
      const visible = !!question && (question.recipientGhii === senderGhii || question.ownerGhii === senderGhii);
      if (!question || !visible || question.interactive?.role !== 'questions') {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'interactive.answersFor does not reference a question you received'));
        return;
      }
    }

    // Announcements are read-only: reject a reply to a non-respondable broadcast message. The flag travels
    // with the message (incl. cross-node), so the check is local — look it up in the sender's mailbox.
    if (input.reply_to) {
      const parent = await storage.getDirectMessage(input.reply_to, deliveryTargetFor(senderGhii));
      if (parent && parent.respondable === false) {
        res.status(403).json(error(config.nodeId, 'NOT_RESPONDABLE', 'This is an announcement — replies are disabled'));
        return;
      }
    }

    // Core create + deliver (local inline / cross-node federation + first-contact gate). Shared with
    // the Tracked Response evaluator, which sends automated replies server-side via the same helper.
    const result = await sendDirectMessage(deliveryCtx, {
      senderGhii, recipientGhii, body: input.body, replyToId: input.reply_to, attachments,
      conversationId: input.conversation_id, subject: input.subject, interactive: input.interactive,
    });
    if (!result.ok) {
      if (result.code === 'RECIPIENT_NOT_FOUND') {
        res.status(404).json(error(config.nodeId, 'RECIPIENT_NOT_FOUND', `No such recipient: ${recipientGhii}`));
        return;
      }
      res.status(403).json(error(config.nodeId, 'BLOCKED', 'The recipient is not accepting messages from you'));
      return;
    }

    res.status(201).json(success(config.nodeId, { message: result.message }, [
      { description: 'View conversation', method: 'GET', url: `/v1/messages/conversations/${result.message.conversationId}` },
      { description: 'View inbox', method: 'GET', url: '/v1/messages/inbox' },
    ]));
  });

  /* ── POST /v1/messages/broadcast — send one message to MANY (announcement / broadcast / poll) ── */
  router.post('/v1/messages/broadcast', requireAuth(), requireExternalPrincipal(), requireScope('messages:send'), async (req, res) => {
    const parsed = BroadcastSendSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    const input = parsed.data;
    const senderGhii = resolve(req);

    // "all node users" and "all federation users" are operator-only (a node/federation-wide announcement
    // is a privileged action). An operator broadcast also bypasses the first-contact gate (lands in inbox).
    const isOperatorAudience = input.audience === 'node-users' || input.audience === 'federation-users';
    if (isOperatorAudience && !req.auth!.roles.includes('operator')) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'A node/federation-wide audience is operator-only'));
      return;
    }

    const recipients = (await resolveAudience(deliveryCtx, senderGhii, { to: input.to, groupId: input.group_id, audience: input.audience }))
      .filter(isAddressableRecipient);
    // federation-users still proceeds with no LOCAL recipients — peers deliver to their own owners.
    if (recipients.length === 0 && input.audience !== 'federation-users') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'No valid recipients in the audience'));
      return;
    }

    const attachments = input.attachments ? mapMessageAttachments(input.attachments, senderGhii, config.nodeId) : undefined;
    const result = await sendBroadcast(deliveryCtx, {
      senderGhii, recipients, mode: input.mode, body: input.body, attachments, interactive: input.interactive,
      skipContactGate: isOperatorAudience,
    });

    // federation-users: fan the announcement out to each active peer (each delivers to its own owners).
    let federationPeers = 0;
    if (input.audience === 'federation-users') {
      const fed = await broadcastToFederation(deliveryCtx, {
        senderGhii, mode: input.mode, body: input.body, interactive: input.interactive, broadcastId: result.broadcastId,
      });
      federationPeers = fed.peers;
    }

    res.status(201).json(success(config.nodeId, {
      broadcast_id: result.broadcastId, recipients: recipients.length, sent: result.sent, failed: result.failed,
      federation_peers: federationPeers,
    }, [
      { description: 'View results', method: 'GET', url: `/v1/messages/broadcast/${result.broadcastId}` },
    ]));
  });

  /* ── GET /v1/messages/broadcast/:id — aggregated results (recipients + delivery/poll answers) ── */
  router.get('/v1/messages/broadcast/:id', requireAuth(), requireRole('owner'), async (req, res) => {
    const senderGhii = resolve(req);
    const broadcastId = req.params.id as string;
    const copies = (await storage.listDmsByBroadcast(broadcastId, senderGhii)).filter(m => m.direction === 'outbound');
    if (copies.length === 0) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such broadcast'));
      return;
    }
    // For each outbound copy, find the recipient's reply (used by the poll results in Phase 2).
    const recipients = await Promise.all(copies.map(async (m) => {
      const replies = await storage.listConversation(senderGhii, m.conversationId, { perPage: 200 });
      const answer = replies.messages.find(r => r.direction === 'inbound' && r.replyToId === m.id && r.interactive?.role === 'answers');
      return {
        recipient: m.recipientGhii,
        status: m.status,
        answered: !!answer,
        answers: answer?.interactive?.role === 'answers' ? answer.interactive.answers : undefined,
      };
    }));
    const first = copies[0];
    res.json(success(config.nodeId, {
      broadcast_id: broadcastId,
      mode: first.respondable === false ? 'announcement' : 'broadcast',
      interactive: first.interactive ?? null,
      total: recipients.length,
      delivered: recipients.filter(r => r.status === 'delivered' || r.status === 'read').length,
      read: recipients.filter(r => r.status === 'read').length,
      answered: recipients.filter(r => r.answered).length,
      recipients,
    }));
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

  /* ── GET /v1/messages/conversations — thread list (accepted) ──
   * Owner-aggregation (own accepted threads + agents' EXTERNAL threads tagged `viaAgent`, pending/blocked
   * contacts hidden, internal own-owner peers skipped) is composed in MessagingDbService, which resolves
   * the agent fleet once and batches the owner + per-agent conversations read into ONE call (was one
   * listConversations per agent). Owner is server-derived → only this owner's agents (no cross-owner leak). */
  router.get('/v1/messages/conversations', requireAuth(), requireRole('owner'), async (req, res) => {
    const { conversations } = await messagingDb.ownerConversations(resolve(req), req.auth!.owner as string);
    res.json(success(config.nodeId, { conversations }));
  });

  /* ── GET /v1/messages/overview — the whole inbox mount in ONE call (requests + conversations +
   * important-flags + tracked-responses + agents + groups), composed in one read scope by
   * MessagesInboxService. Owner-scope: requires 'owner' role (the strictest of the six folded endpoints,
   * so authorization is unchanged). The individual list endpoints stay for interactive re-fetches. ── */
  router.get('/v1/messages/overview', requireAuth(), requireRole('owner'), async (req, res) => {
    const data = await inboxDb.overview(resolve(req), req.auth!.owner as string);
    res.json(success(config.nodeId, data));
  });

  /* ── GET /v1/messages/conversations/:conversationId — full thread ── */
  router.get('/v1/messages/conversations/:conversationId', requireAuth(), requireRole('owner'), async (req, res) => {
    const ghii = resolve(req);
    const conversationId = req.params.conversationId as string;
    const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
    const perPage = Math.min(200, Math.max(1, parseInt(req.query.per_page as string || '50', 10)));
    // `?agent=<gaii>` reads an agent-owned thread (the read-only "via <agent>" rows from the list). Only
    // the owner's OWN agents are readable — verify ownership before reading under that identity.
    const asAgent = String(req.query.agent || '').trim();
    let readAs = ghii;
    if (asAgent) {
      const agents = await storage.getAgentsByOwner(req.auth!.owner).catch(() => []);
      if (!agents.some(a => a.gaii === asAgent)) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Not one of your agents'));
        return;
      }
      readAs = asAgent;
    }
    const result = await storage.listConversation(readAs, conversationId, { page, perPage });
    res.json(success(config.nodeId, { messages: result.messages, total: result.total, page, per_page: perPage }));
  });

  /* ── GET /v1/messages/agent-inbox — federated DMs ADDRESSED TO the calling agent ──
     A reply to an agent is delivered to its owner's mailbox (recipientGhii = the agent), so the agent
     can't see it via the owner-only inbox routes. This exposes those messages to the agent itself. */
  router.get('/v1/messages/agent-inbox', requireAuth(), requireExternalPrincipal(), requireScope('messages:read'), async (req, res) => {
    const agentGhii = resolve(req);
    const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page as string || '20', 10)));
    const { messages, total } = await storage.listDmsAddressedTo(agentGhii, { page, perPage });
    res.json(success(config.nodeId, { messages, total, page, per_page: perPage }));
  });

  /* ── GET /v1/messages/agent-thread/:conversationId — full DM thread as the calling agent sees it ── */
  router.get('/v1/messages/agent-thread/:conversationId', requireAuth(), requireExternalPrincipal(), requireScope('messages:read'), async (req, res) => {
    const agentGhii = resolve(req);
    const conversationId = req.params.conversationId as string;
    const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
    const perPage = Math.min(200, Math.max(1, parseInt(req.query.per_page as string || '50', 10)));
    const { messages, total } = await storage.listAgentDmThread(agentGhii, conversationId, { page, perPage });
    res.json(success(config.nodeId, { messages, total, page, per_page: perPage }));
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
    // Each request's preview comes from its first message — fetch them all in ONE batched read (was
    // getDirectMessage per pending contact), indexed by message id.
    const firstIds = pending.map(c => c.firstMessageId).filter((x): x is string => !!x);
    const firstById = new Map<string, DirectMessageRecord>();
    if (firstIds.length) {
      const msgs = storage.getDirectMessagesByIds
        ? await storage.getDirectMessagesByIds(firstIds, ghii)
        : (await Promise.all(firstIds.map(id => storage.getDirectMessage(id, ghii)))).filter((m): m is DirectMessageRecord => !!m);
      for (const m of msgs) firstById.set(m.id, m);
    }
    const requests = pending.map(c => {
      const first = c.firstMessageId ? firstById.get(c.firstMessageId) ?? null : null;
      return {
        contactId: c.contactId,
        conversationId: first?.conversationId ?? conversationIdFor(ghii, c.contactId),
        preview: messagePreview(first?.body ?? ''),
        createdAt: c.createdAt,
      };
    });
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
