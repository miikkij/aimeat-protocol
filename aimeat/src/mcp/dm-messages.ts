/**
 * @file dm-messages.ts
 * @description MCP tools for the FEDERATED direct-message inbox ("Postilaatikko") — distinct from the
 *   agent-dashboard `aimeat_message_*` tools (which are an agent↔its-own-owner task channel, not
 *   federated). These let an agent send a direct message FROM its own GAII TO any person/agent across
 *   the AIMEAT federation, reusing the same signed-delivery + first-contact-gate + attachment pipeline
 *   the human inbox uses (`sendDirectMessage`). Files travel out-of-band: upload via aimeat_storage_upload
 *   (presigned), then pass the returned storage keys as `attachments` here. Phase A of the federated-inbox
 *   plan (docs/internal/2026-06-22-agent-federated-inbox-messaging-design.md); read tools land in Phase B.
 * @structure registerDmMessageTools(mcp, storage, config, getAgentGaii, peers)
 * @usage import { registerDmMessageTools } from './dm-messages.js';
 * @version-history
 *   v1.0.0 — 2026-06-22 — Initial: aimeat_dm_send (federated send + multi-attachment), gated messages:send.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { sendDirectMessage, mapMessageAttachments } from '../services/message-send.js';
import type { DeliveryCtx } from '../services/message-delivery.js';
import { MessageAttachmentInputSchema } from '../models/message-schemas.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';

export function registerDmMessageTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    peers: Map<string, PeerInfo>,
): void {
    const ctx: DeliveryCtx = { config, storage, peers };

    // ── aimeat_dm_send — send a federated direct message from this agent to anyone ──
    mcp.tool(
        'aimeat_dm_send',
        descriptionFor('aimeat_dm_send'),
        {
            to: z.string().min(3).max(256).describe('Recipient identity: a person (owner@node), an agent (agent#owner@node), or an app (eco:app#owner@node). A message to an agent/app is delivered to its owner\'s inbox.'),
            body: z.string().max(50000).optional().describe('Message body (GFM markdown). Optional only if you attach at least one file.'),
            reply_to: z.string().uuid().optional().describe('Id of a message you are replying to (keeps the same conversation thread).'),
            subject: z.string().min(1).max(200).optional().describe('Open a NEW topic thread with this title (instead of one endless thread with the recipient). Omit to use the default thread or continue one via conversation_id.'),
            conversation_id: z.string().min(8).max(64).optional().describe('Continue a specific existing thread by its id (e.g. one returned by aimeat_dm_inbox). Omit for the default per-recipient thread.'),
            attachments: z.array(MessageAttachmentInputSchema).max(20).optional()
                .describe('Up to 20 files to attach. Upload each file first via aimeat_storage_upload (presigned), then pass its { storage_key, mime, kind, size, name } here — MCP does not carry the bytes.'),
        },
        annotationsFor('aimeat_dm_send'),
        async ({ to, body, reply_to, subject, conversation_id, attachments }) => {
            const senderGhii = getAgentGaii();
            const recipientGhii = to.trim();

            if (recipientGhii === senderGhii) {
                return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Cannot send a message to yourself.' }) }] };
            }
            if (!body?.trim() && !attachments?.length) {
                return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: 'A message must have a body or at least one attachment.' }) }] };
            }

            const mapped = attachments?.length ? mapMessageAttachments(attachments, senderGhii, config.nodeId) : undefined;
            const result = await sendDirectMessage(ctx, {
                senderGhii, recipientGhii, body: body ?? '', replyToId: reply_to, attachments: mapped,
                conversationId: conversation_id, subject,
            });

            if (!result.ok) {
                const msg = result.code === 'RECIPIENT_NOT_FOUND'
                    ? `No such recipient: ${recipientGhii}`
                    : 'The recipient is not accepting messages from you (blocked or pending first-contact approval).';
                return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: msg, code: result.code }) }] };
            }

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        message_id: result.message.id,
                        conversation_id: result.message.conversationId,
                        recipient: result.message.recipientGhii,
                        status: result.message.status,
                        attachments: result.message.attachments?.length ?? 0,
                        created_at: result.message.createdAt,
                    }, null, 2),
                }],
            };
        },
    );

    // ── aimeat_dm_inbox — read recent federated DMs addressed to this agent ──
    mcp.tool(
        'aimeat_dm_inbox',
        descriptionFor('aimeat_dm_inbox'),
        {
            page: z.number().int().positive().optional().describe('Page number (default 1).'),
            per_page: z.number().int().positive().max(100).optional().describe('Messages per page (default 20, max 100).'),
        },
        annotationsFor('aimeat_dm_inbox'),
        async ({ page, per_page }) => {
            const agentGaii = getAgentGaii();
            const { messages, total } = await storage.listDmsAddressedTo(agentGaii, { page: page ?? 1, perPage: per_page ?? 20 });
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        messages: messages.map(m => ({
                            id: m.id,
                            conversation_id: m.conversationId,
                            subject: m.subject ?? null,
                            from: m.senderGhii,
                            body: m.body,
                            attachments: m.attachments?.map(a => ({ storage_key: a.storageKey, mime: a.mime, kind: a.kind, name: a.name })) ?? [],
                            created_at: m.createdAt,
                        })),
                        total,
                    }, null, 2),
                }],
            };
        },
    );

    // ── aimeat_dm_thread — full federated DM thread (this agent's view), oldest-first ──
    mcp.tool(
        'aimeat_dm_thread',
        descriptionFor('aimeat_dm_thread'),
        {
            conversation_id: z.string().min(8).max(64).describe('Conversation id (from aimeat_dm_inbox or aimeat_dm_send).'),
            page: z.number().int().positive().optional().describe('Page number (default 1).'),
            per_page: z.number().int().positive().max(200).optional().describe('Messages per page (default 50, max 200).'),
        },
        annotationsFor('aimeat_dm_thread'),
        async ({ conversation_id, page, per_page }) => {
            const agentGaii = getAgentGaii();
            const { messages, total } = await storage.listAgentDmThread(agentGaii, conversation_id, { page: page ?? 1, perPage: per_page ?? 50 });
            // Oldest-first so the agent reads the conversation in order.
            const ordered = [...messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        messages: ordered.map(m => ({
                            id: m.id,
                            direction: m.direction,
                            from: m.senderGhii,
                            to: m.recipientGhii,
                            subject: m.subject ?? null,
                            body: m.body,
                            attachments: m.attachments?.map(a => ({ storage_key: a.storageKey, mime: a.mime, kind: a.kind, name: a.name })) ?? [],
                            created_at: m.createdAt,
                        })),
                        total,
                    }, null, 2),
                }],
            };
        },
    );
}
