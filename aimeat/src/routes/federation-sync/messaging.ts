/**
 * @file src/routes/federation-sync/messaging.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Federation messaging + memory-replication routes — signed peer replicate, human↔human
 *   direct message, operator broadcast, delivery/read receipt, and attachment download grant. Extracted from federation-sync.ts to satisfy max-file-lines.
 * @version-history
 *   v1.1.0 — 2026-08-15 — An inbound message's attachment descriptors are normalized instead of
 *     stored as the peer sent them. `ownerGhii` and `originNodeId` decide WHOSE storage the
 *     duplicator reads, so a peer that named this node and a local owner had this node open that
 *     owner's private file and copy it to the recipient. The send side has always stamped both
 *     fields itself (services/message-send.ts:88-89); only the receiving side took the sender's
 *     word. E2E test-quality audit finding A27.
 *   v1.0.0 — 2026-07-13 — Extracted from federation-sync.ts (max-file-lines)
 */

import type { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage, DirectMessageAttachment } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { logger } from '../../utils/logger.js';
import type { PeerInfo } from '../../services/federation.js';
import { verify } from '../../auth/keypair.js';
import { emitChange, emitDelivery } from '../../services/event-bus.js';
import { emitResourceUpdated } from '../../mcp/index.js';
import { notify } from '../../services/notify.js';
import { parseGaiiLoose, isSameOwner } from '../../utils/gaii.js';
import { messagePreview, conversationIdFor } from '../../utils/messaging.js';
import { generateDownloadToken } from '../../services/download-token.js';
import { duplicateMessageAttachments } from '../../services/attachment-duplication.js';

/**
 * An inbound attachment descriptor says which storage the bytes come from, so those two fields are
 * the peer's claim about somebody else's disk and are re-stamped rather than believed: the bytes
 * can only be the SENDER's, on the node that sent them. mapMessageAttachments() does the identical
 * thing to a client's claim on the way out, for the same reason.
 *
 * Believing them let a peer set originNodeId to THIS node and ownerGhii to a local owner, which
 * sends the duplicator down its same-node branch (services/attachment-duplication.ts:45) to read
 * that owner's private file and write the bytes into the recipient's own storage.
 */
function normalizeInboundAttachments(
    attachments: DirectMessageAttachment[] | undefined | null,
    senderGhii: string,
    sourceNode: string,
): DirectMessageAttachment[] | undefined {
    if (!attachments?.length) return undefined;
    return attachments.map(a => ({ ...a, ownerGhii: senderGhii, originNodeId: sourceNode }));
}

export function registerMessagingRoutes(router: Router, config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): void {
    // POST /v1/federation/replicate — Receive replicated memory from a peer node
    router.post('/v1/federation/replicate', async (req, res) => {
        const { source_node, gaii, key, value, visibility, version, timestamp, signature } = req.body ?? {};

        if (!source_node || !gaii || !key || value === undefined || !version) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'source_node, gaii, key, value, and version are required'));
            return;
        }

        // Verify the source node is a known peer
        const peer = [...peers.values()].find(p => p.nodeId === source_node);
        if (!peer || peer.status !== 'active') {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Source node is not an active peer'));
            return;
        }

        if (!peer.replicateMemory) {
            res.status(403).json(error(config.nodeId, 'POLICY_DENIED', 'This peer has memory replication disabled'));
            return;
        }

        // P1-11: Require signed replication — verify peer signature
        if (!signature) {
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Missing signature on replication request'));
            return;
        }
        if (!peer.publicKey) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Peer has no public key on file for signature verification'));
            return;
        }
        const replicatePayload = JSON.stringify({ source_node, gaii, key, value, visibility, version, timestamp });
        const replicateValid = await verify(peer.publicKey, replicatePayload, signature);
        if (!replicateValid) {
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Invalid signature on replication request'));
            return;
        }

        // Store replicated memory with cross-node prefix
        const replicaKey = `replica:${source_node}:${key}`;
        const incomingUpdatedAt = timestamp ?? new Date().toISOString();

        // C.2: LWW (Last-Writer-Wins) conflict resolution
        const existing = await storage.getMemory(gaii, replicaKey);
        if (existing) {
            const existingTime = new Date(existing.updatedAt).getTime();
            const incomingTime = new Date(incomingUpdatedAt).getTime();

            if (incomingTime <= existingTime) {
                // Incoming is older or equal — reject silently
                res.json(success(config.nodeId, {
                    replicated: true,
                    key: replicaKey,
                    source_node,
                    version,
                    conflict: true,
                    conflict_resolution: 'incoming_older',
                }));
                emitChange('federation');
                return;
            }

            // Incoming is newer — preserve losing version as conflict backup
            const conflictKey = `${key}._conflict_${Date.now()}`;
            await storage.setMemory({
                ...existing,
                key: conflictKey,
                visibility: 'private',
                tags: [...existing.tags, `conflict:${source_node}`],
                ttlHours: 168, // 7 days
                updatedAt: new Date().toISOString(),
            });

            // Send mailbox notification about the conflict
            await storage.createMailboxItem({
                id: `conflict-${randomBytes(8).toString('hex')}`,
                personalNodeId: '',
                type: 'federation_sync',
                fromGaii: `system@${config.nodeId}`,
                toGaii: gaii,
                payload: JSON.stringify({ type: 'conflict_resolved', key, winner: 'incoming', loser_key: conflictKey }),
                sizeBytes: 0,
                retentionDays: 7,
                expiresAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
                createdAt: new Date().toISOString(),
            });
        }

        await storage.setMemory({
            key: replicaKey,
            ownerGaii: gaii,
            value,
            visibility: visibility ?? 'public',
            tags: [`replica:${source_node}`],
            ttlHours: null,
            version,
            createdAt: timestamp ?? new Date().toISOString(),
            updatedAt: incomingUpdatedAt,
        });

        res.json(success(config.nodeId, {
            replicated: true,
            key: replicaKey,
            source_node,
            version,
            conflict: !!existing,
        }));
        emitChange('federation');
    });

    // POST /v1/federation/message — Receive a human↔human direct message from a peer node.
    // Mirrors /v1/federation/replicate's signed-peer verification. Recipient must be a local human.
    router.post('/v1/federation/message', async (req, res) => {
        const { source_node, message, timestamp, signature } = req.body ?? {};
        if (!source_node || !message || !message.id || !message.senderGhii || !message.recipientGhii) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'source_node and message{id,senderGhii,recipientGhii} are required'));
            return;
        }

        const peer = [...peers.values()].find(p => p.nodeId === source_node);
        if (!peer || peer.status !== 'active') {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Source node is not an active peer'));
            return;
        }
        if (!signature) {
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Missing signature on message'));
            return;
        }
        if (!peer.publicKey) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Peer has no public key on file for signature verification'));
            return;
        }
        const messagePayload = JSON.stringify({ source_node, message, timestamp });
        if (!await verify(peer.publicKey, messagePayload, signature)) {
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Invalid signature on message'));
            return;
        }

        // The ACTUAL recipient (may be an agent/eco GAII) vs the mailbox owner it's delivered to.
        // `deliveryGhii` is where the copy lands (the owner of an agent/eco recipient); the human owns +
        // gates the mailbox, while the agent can still read messages addressed to it. Older senders omit
        // `deliveryGhii`, so fall back to the recipient itself (prior behaviour).
        const recipientGhii: string = message.recipientGhii;
        const deliveryGhii: string = message.deliveryGhii ?? recipientGhii;
        const parsedDelivery = parseGaiiLoose(deliveryGhii);
        if (parsedDelivery.node !== config.nodeId) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Recipient is not hosted on this node'));
            return;
        }
        const ownerRec = await storage.getOwner(parsedDelivery.owner);
        if (!ownerRec) {
            res.status(404).json(error(config.nodeId, 'RECIPIENT_NOT_FOUND', `No such recipient: ${deliveryGhii}`));
            return;
        }

        // First-contact gate is the OWNER's (they decide who may reach them and their agents).
        const contact = await storage.getContact(deliveryGhii, message.senderGhii);
        if (contact?.state === 'blocked') {
            res.status(403).json(error(config.nodeId, 'BLOCKED', 'Recipient is not accepting messages from this sender'));
            return;
        }
        let state = contact?.state;
        if (!state) {
            const autoAccept = isSameOwner(message.senderGhii, deliveryGhii);
            state = autoAccept ? 'accepted' : 'pending';
            await storage.setContactState(deliveryGhii, message.senderGhii, state, message.id);
        }
        const isRequest = state === 'pending';

        // Idempotent: a retried delivery must not create a duplicate inbox copy.
        const existingCopy = await storage.getDirectMessage(message.id, deliveryGhii);
        if (!existingCopy) {
            const now = new Date().toISOString();
            await storage.createDirectMessage({
                id: message.id,
                ownerGhii: deliveryGhii,
                conversationId: message.conversationId,
                subject: message.subject ?? undefined,
                senderGhii: message.senderGhii,
                recipientGhii,
                body: message.body ?? '',
                attachments: normalizeInboundAttachments(message.attachments, message.senderGhii, source_node),
                interactive: message.interactive ?? undefined,
                broadcastId: message.broadcastId ?? undefined,
                respondable: message.respondable ?? undefined,
                status: 'delivered',
                direction: 'inbound',
                replyToId: message.replyToId ?? undefined,
                origin: 'federation',
                originNodeId: source_node,
                createdAt: message.createdAt ?? now,
                deliveredAt: now,
            });
            // Accepted contact → pull the attachment bytes into the recipient's storage now; a
            // pending request leaves them as reference until accepted (DECISION #3).
            if (!isRequest && message.attachments?.length) {
                const recCopy = await storage.getDirectMessage(message.id, deliveryGhii);
                if (recCopy) {
                    const dup = await duplicateMessageAttachments({ config, storage, peers }, deliveryGhii, recCopy);
                    if (dup.changed) await storage.updateMessageAttachments(message.id, deliveryGhii, dup.attachments);
                }
            }

            await notify(storage, deliveryGhii, {
                type: isRequest ? 'direct_message_request' : 'direct_message',
                title: isRequest ? `${message.senderGhii} wants to message you` : `New message from ${message.senderGhii}`,
                body: messagePreview(message.body ?? ''),
                // Request → 'req:<conversationId>': lands on the requests list while pending, opens the
                // thread once accepted (see inbox-tab consumeDeepLink). Delivered DM → its conversation.
                link: isRequest ? `/v1/profile#inbox/req:${message.conversationId}` : `/v1/profile#inbox/${message.conversationId}`,
                // Same inline reply as the local path — a delivered cross-node DM replies straight from the bell.
                actions: isRequest ? undefined : [
                    { id: 'reply', label: 'Reply', kind: 'reply', to: message.senderGhii, conversationId: message.conversationId, subject: message.subject || undefined, replyTo: message.id },
                ],
            });
            emitChange('messages');

            // Event-based push: if the actual recipient is an agent/eco hosted here, wake it over the
            // connect tunnel (mirrors task_assigned / workspace.record) so it acts on the DM without
            // polling. The owner keeps the mailbox copy above.
            if (recipientGhii !== deliveryGhii) {
                emitDelivery({
                    target: recipientGhii, kind: 'dm.inbound', id: message.id,
                    // camelCase + GHII, matching the record / GET /v1/messages/agent-inbox shape.
                    payload: {
                        id: message.id, conversationId: message.conversationId,
                        subject: message.subject ?? null, senderGhii: message.senderGhii,
                        preview: messagePreview(message.body ?? ''),
                        attachments: message.attachments?.length ?? 0, createdAt: message.createdAt ?? now,
                        interactive: message.interactive?.role ?? null,
                    },
                });
                try { emitResourceUpdated(recipientGhii, 'aimeat://dm/inbox'); } catch (err) { logger.warn('POST /v1/federation/message: no live MCP session', { error: String(err) }); }
            }
        }

        res.json(success(config.nodeId, { delivered: true, state }));
    });

    // POST /v1/federation/broadcast — Receive a federation-wide announcement from a peer operator and
    // deliver it to THIS node's own owners (the delegated federation broadcast: one frame per peer, the
    // peer fans out locally). Accepted only from active peers; the first-contact gate is auto-accepted so
    // the announcement lands in each owner's inbox.
    router.post('/v1/federation/broadcast', async (req, res) => {
        const { source_node, broadcast, timestamp, signature } = req.body ?? {};
        if (!source_node || !broadcast || typeof broadcast.senderGhii !== 'string') {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'source_node and broadcast{senderGhii} are required'));
            return;
        }
        const peer = [...peers.values()].find(p => p.nodeId === source_node);
        if (!peer || peer.status !== 'active') {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Source node is not an active peer'));
            return;
        }
        if (!signature || !peer.publicKey) {
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Missing signature or peer key'));
            return;
        }
        const payload = JSON.stringify({ source_node, broadcast, timestamp });
        if (!await verify(peer.publicKey, payload, signature)) {
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Invalid signature on broadcast'));
            return;
        }

        const senderGhii: string = broadcast.senderGhii;
        const now = new Date().toISOString();
        const ghiis = await storage.listGHIIs();
        let delivered = 0;
        for (const g of ghiis) {
            try {
                if (g.ghii === senderGhii) continue; // don't deliver back to the sender if they're local
                // Respect a block: a recipient who blocked the sender does NOT get the announcement.
                const existing = await storage.getContact(g.ghii, senderGhii).catch(err => { logger.warn('POST /v1/federation/broadcast: continuing after a suppressed failure', { error: String(err) }); return null; });
                if (existing?.state === 'blocked') continue;
                const conversationId = conversationIdFor(senderGhii, g.ghii);
                const id = randomUUID();
                // Operator announcement: auto-accept a NEW contact so it lands in the inbox, not requests.
                if (!existing) await storage.setContactState(g.ghii, senderGhii, 'accepted', id).catch(err => { logger.warn('POST /v1/federation/broadcast: best-effort', { error: String(err) }); });
                await storage.createDirectMessage({
                    id, ownerGhii: g.ghii, conversationId, senderGhii, recipientGhii: g.ghii,
                    body: broadcast.body ?? '', interactive: broadcast.interactive ?? undefined,
                    broadcastId: broadcast.broadcastId, respondable: broadcast.respondable,
                    status: 'delivered', direction: 'inbound', origin: 'federation', originNodeId: source_node,
                    createdAt: broadcast.createdAt ?? now, deliveredAt: now,
                });
                await notify(storage, g.ghii, {
                    type: 'direct_message',
                    title: `Announcement from ${senderGhii}`,
                    body: messagePreview(broadcast.body ?? ''),
                    link: `/v1/profile#inbox/${conversationId}`,
                });
                delivered++;
            } catch (err) {
                logger.warn('Federation broadcast: failed to deliver to a local owner', { error: (err as Error).message });
            }
        }
        emitChange('messages');
        res.json(success(config.nodeId, { delivered }));
    });

    // POST /v1/federation/message/receipt — Receive a delivery/read receipt from the recipient node.
    router.post('/v1/federation/message/receipt', async (req, res) => {
        const { source_node, message_id, kind, timestamp, signature } = req.body ?? {};
        if (!source_node || !message_id || !kind) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'source_node, message_id, and kind are required'));
            return;
        }
        const peer = [...peers.values()].find(p => p.nodeId === source_node);
        if (!peer || peer.status !== 'active') {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Source node is not an active peer'));
            return;
        }
        if (!signature || !peer.publicKey) {
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Missing signature or peer public key'));
            return;
        }
        const receiptPayload = JSON.stringify({ source_node, message_id, kind, timestamp });
        if (!await verify(peer.publicKey, receiptPayload, signature)) {
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Invalid signature on receipt'));
            return;
        }

        if (kind === 'read') {
            await storage.setMessageReadReceipt(message_id, timestamp ?? new Date().toISOString());
            emitChange('messages');
        }
        res.json(success(config.nodeId, { ok: true }));
    });

    // POST /v1/federation/storage/grant — Mint a presigned download for a direct-message attachment.
    // The origin node is the authority over its own storage: it verifies the peer signature AND that
    // the message relationship is real (a message with this id was sent to recipient_ghii and lists
    // this storage_key) before issuing a short-lived, single-file download capability (DECISION #5).
    router.post('/v1/federation/storage/grant', async (req, res) => {
        const { source_node, message_id, conversation_id, storage_key, owner_ghii, recipient_ghii, timestamp, signature } = req.body ?? {};
        if (!source_node || !message_id || !storage_key || !owner_ghii || !recipient_ghii) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'source_node, message_id, storage_key, owner_ghii, recipient_ghii are required'));
            return;
        }
        const peer = [...peers.values()].find(p => p.nodeId === source_node);
        if (!peer || peer.status !== 'active') {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Source node is not an active peer'));
            return;
        }
        if (!signature || !peer.publicKey) {
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Missing signature or peer public key'));
            return;
        }
        const grantPayload = JSON.stringify({ source_node, message_id, conversation_id, storage_key, owner_ghii, recipient_ghii, timestamp });
        if (!await verify(peer.publicKey, grantPayload, signature)) {
            res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Invalid signature on storage grant'));
            return;
        }

        // Authority check: this node must hold the sender's copy of that message, addressed to the
        // requesting recipient, and it must actually reference this storage key.
        const msg = await storage.getDirectMessage(message_id, owner_ghii);
        if (!msg || msg.recipientGhii !== recipient_ghii) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'No matching message for this grant'));
            return;
        }
        const att = msg.attachments?.find(a => a.storageKey === storage_key);
        if (!att) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Attachment not part of this message'));
            return;
        }
        const file = await storage.getStorageFile(owner_ghii, storage_key);
        if (!file) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Attachment file not found'));
            return;
        }

        const token = await generateDownloadToken(
            { sub: owner_ghii, key: storage_key, mimeType: file.mimeType, size: file.size },
            300,
        );
        res.json(success(config.nodeId, {
            download_url: `${config.baseUrl}/v1/download/${token}`,
            expires_in_seconds: 300,
        }));
    });
}
