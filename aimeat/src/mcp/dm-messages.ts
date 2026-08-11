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
 *   v1.5.0 -- 2026-08-01 -- TARGET-058 Phase 8b. aimeat_dm_ask joins its siblings: the intro AND the
 *     questions are hashed, because on this tool the questions are the content a person reads.
 *   v1.4.0 -- 2026-08-01 -- TARGET-058 Phase 4. aimeat_dm_send and aimeat_dm_send_as_owner accept an
 *     `ai_provenance` declaration and stamp the body through provenanceForWrite(); aimeat_dm_thread
 *     returns each message's record, batched. send_as_owner stamps the ACTING AGENT rather than the
 *     owner it sends as: the recipient sees a person's name on the message, and letting Mint-3 read
 *     the owner as the writer would manufacture exactly the false attribution this work prevents.
 *   v1.0.0 — 2026-06-22 — Initial: aimeat_dm_send (federated send + multi-attachment), gated messages:send.
 *   v1.1.0 — 2026-06-23 — aimeat_dm_ask (federated AskUserQuestion: structured option questions); inbox/thread
 *     now surface the `interactive` payload so the agent reads the human's machine-readable answers.
 *   v1.2.0 — 2026-07-12 — aimeat_dm_send_as_owner: send AS THE OWNER (consented delegation for Inbox
 *     "Reply with AI"). Gated by the explicit messages:send-as-owner scope; sender is the agent's OWN
 *     owner, derived server-side (never a client id) so an agent can only speak as its own owner. The
 *     reply lands in the owner's thread, attributed to the owner; the acting agent is logged for audit.
 *   v1.3.0 — 2026-07-26 — inbox/thread attachments carry `ref` (+ origin_ref, owner_ghii, size, mode).
 *     They used to expose only a storage_key, and a key alone cannot be opened: storage is addressed by
 *     (owner, key), so the agent looked in its own namespace and got "not found" for a file it had just
 *     been sent. `ref` feeds aimeat_storage_download directly.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { sendDirectMessage, mapMessageAttachments } from '../services/message-send.js';
import { resolveGroupTarget } from '../services/message-alias.js';
import { sendGroupMessage } from '../services/conversation-group.js';
import type { DeliveryCtx } from '../services/message-delivery.js';
import { MessageAttachmentInputSchema, InteractiveQuestionSchema } from '../models/message-schemas.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { fileRefFor } from '../services/file-refs.js';
import type { DirectMessageAttachment } from '../storage/interface.js';
import { aiProvenanceInputs, toDeclaredProvenance } from './ai-provenance-input.js';
import { writeProvenanceEcho, readProvenanceMany } from './ai-provenance-result.js';
import { provenanceForWrite } from '../services/ai-provenance.js';
import { logger } from '../utils/logger.js';

/**
 * How ONE attachment is shown to the agent reading its inbox. `ref` is the point: the descriptor used
 * to carry only a storage_key, and a key alone is unopenable — storage is addressed by (owner, key),
 * so an agent that knew only the key looked in its OWN namespace and got "not found" for a file that
 * was sitting right there. `ref` is exactly what aimeat_storage_download(owner=…, key=…) wants.
 *
 * Which ref: a delivered attachment is normally DUPLICATED into the recipient mailbox owner's storage,
 * and that local copy is the one the recipient side reliably owns — so it becomes `ref` when present.
 * A `reference`-mode attachment (own-agent handoff, or still awaiting quota) has only the sender's
 * copy, whose readability depends on its visibility / a consent grant. `origin_ref` always names the
 * sender's copy so the agent can tell the two apart.
 */
/** The GHII whose mailbox holds an agent's DMs — a message to `agent#alice@node` lands under `alice@node`. */
function ownerGhiiOf(agentGaii: string): string {
    const p = parseGaiiLoose(agentGaii);
    return `${p.owner}@${p.node}`;
}

function attachmentView(a: DirectMessageAttachment, mailboxOwnerGhii: string): Record<string, unknown> {
    const originRef = fileRefFor(a.ownerGhii, a.storageKey);
    const localRef = a.mode === 'duplicate' && a.localKey ? fileRefFor(mailboxOwnerGhii, a.localKey) : undefined;
    return {
        ref: localRef ?? originRef,
        origin_ref: originRef,
        owner_ghii: a.ownerGhii,
        storage_key: a.storageKey,
        mime: a.mime,
        kind: a.kind,
        name: a.name,
        size: a.size,
        mode: a.mode,
        expired: a.expired ?? false,
        note: 'Open it with aimeat_storage_download using this ref (key="<owner@node>/<key>" or owner + key). MCP never carries the bytes.',
    };
}

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
            to: z.string().min(3).max(256).optional().describe('Recipient identity: a person (owner@node), an agent (agent#owner@node), or an app (eco:app#owner@node). A message to an agent/app is delivered to its owner\'s inbox. Use "support@operators" to reach whoever runs this node — that is the address to write to when something here does not work, when a step cannot be completed, or when you need a human decision; it opens a thread the operators answer in. Omit only when conversation_id names a group thread you are already in.'),
            body: z.string().max(50000).optional().describe('Message body (GFM markdown). Optional only if you attach at least one file.'),
            reply_to: z.string().uuid().optional().describe('Id of a message you are replying to (keeps the same conversation thread).'),
            subject: z.string().min(1).max(200).optional().describe('Open a NEW topic thread with this title (instead of one endless thread with the recipient). For support@operators this is what the operators see in their list, so name the actual problem. Omit to use the default thread or continue one via conversation_id.'),
            conversation_id: z.string().min(8).max(64).optional().describe('Continue a specific existing thread by its id (e.g. one returned by aimeat_dm_inbox, or the one a support@operators send returned). Omit for the default per-recipient thread.'),
            attachments: z.array(MessageAttachmentInputSchema).max(20).optional()
                .describe('Up to 20 files to attach. Upload each file first via aimeat_storage_upload (presigned), then pass its { storage_key, mime, kind, size, name } here — MCP does not carry the bytes.'),
            ...aiProvenanceInputs,
        },
        annotationsFor('aimeat_dm_send'),
        async ({ to, body, reply_to, subject, conversation_id, attachments, ai_provenance, ai_provenance_id }) => {
            const senderGhii = getAgentGaii();
            const recipientGhii = (to ?? '').trim();

            if (recipientGhii && recipientGhii === senderGhii) {
                return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Cannot send a message to yourself.' }) }] };
            }
            if (!body?.trim() && !attachments?.length) {
                return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: 'A message must have a body or at least one attachment.' }) }] };
            }

            const mapped = attachments?.length ? mapMessageAttachments(attachments, senderGhii, config.nodeId) : undefined;
            // TARGET-058. A message an agent sends is AI-written text delivered to a named person, so
            // it is stamped like any other write: declared if the agent said something, Mint-3 if it
            // said nothing. The record describes the BODY — attachments carry their own provenance
            // wherever they are stored.
            const aiProvenanceId = await provenanceForWrite(storage, {
                principal: senderGhii,
                content: body ?? '',
                declaredId: ai_provenance_id,
                declared: toDeclaredProvenance(ai_provenance),
                pipeline: 'mcp.dm_send',
                // A DM is never public, but it IS delivered to a person — which is what decides
                // whether a label is owed, not whether the world can read it.
                surface: { visibility: 'private', humanAudience: true },
                labelPolicy: config.aiLabelPublic,
                nodeId: config.nodeId,
                baseUrl: config.baseUrl,
                enabled: config.aiProvenance,
            });
            // A named group address (support@operators) or a group conversation id goes to the group
            // path — the same resolver POST /v1/messages uses, so the two doors cannot drift.
            const group = await resolveGroupTarget(ctx, config, senderGhii, {
                to: recipientGhii, conversationId: conversation_id, subject,
            });
            if (group.kind === 'refused') {
                return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: group.message, code: group.code }) }] };
            }
            if (group.kind === 'group') {
                const sent = await sendGroupMessage(ctx, {
                    conversationId: group.conversation.id,
                    senderGhii, body: body ?? '', attachments: mapped, replyToId: reply_to, aiProvenanceId,
                });
                if (!sent.ok) {
                    return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: sent.code === 'CONVERSATION_NOT_FOUND' ? 'No such conversation' : 'You are not a participant in this conversation', code: sent.code }) }] };
                }
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            message_id: sent.messageId,
                            conversation_id: group.conversation.id,
                            addressed_to: group.conversation.alias ?? 'group',
                            participants: group.conversation.participants,
                            delivered_to: sent.delivered,
                            reply_with: 'aimeat_dm_send with conversation_id set to the value above',
                            ...(await writeProvenanceEcho(storage, config, aiProvenanceId)),
                        }, null, 2),
                    }],
                };
            }

            const result = await sendDirectMessage(ctx, {
                senderGhii, recipientGhii, body: body ?? '', replyToId: reply_to, attachments: mapped,
                conversationId: conversation_id, subject, aiProvenanceId,
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
                        ...(await writeProvenanceEcho(storage, config, aiProvenanceId)),
                    }, null, 2),
                }],
            };
        },
    );

    // ── aimeat_dm_send_as_owner — send a federated DM AS THE OWNER (consented delegation) ──
    // Gated by the explicit `messages:send-as-owner` scope (the registration filter only registers this
    // tool when the agent holds it). The sender is the agent's OWN owner, derived SERVER-SIDE from the
    // session GAII — never a client-supplied id — so an agent can only ever speak as its own owner, never
    // another (no cross-owner impersonation). The reply lands in the OWNER's thread, attributed to the
    // owner (as if sent from the UI); the acting agent is logged for audit. Powers Inbox "Reply with AI".
    mcp.tool(
        'aimeat_dm_send_as_owner',
        descriptionFor('aimeat_dm_send_as_owner'),
        {
            to: z.string().min(3).max(256).describe('Recipient identity: a person (owner@node), an agent (agent#owner@node), or an app (eco:app#owner@node).'),
            body: z.string().max(50000).optional().describe('Message body (GFM markdown). Optional only if you attach at least one file.'),
            reply_to: z.string().uuid().optional().describe('Id of a message you are replying to (keeps the same conversation thread).'),
            subject: z.string().min(1).max(200).optional().describe('Open a NEW topic thread with this title. Omit to continue the owner\'s existing thread via conversation_id.'),
            conversation_id: z.string().min(8).max(64).optional().describe('The owner\'s existing thread with the recipient (so the reply lands in that thread). Omit for the default per-pair thread.'),
            attachments: z.array(MessageAttachmentInputSchema).max(20).optional()
                .describe('Up to 20 files to attach, each pre-uploaded via aimeat_storage_upload (presigned).'),
            ...aiProvenanceInputs,
        },
        annotationsFor('aimeat_dm_send_as_owner'),
        async ({ to, body, reply_to, subject, conversation_id, attachments, ai_provenance, ai_provenance_id }) => {
            const agentGaii = getAgentGaii();
            const parsed = parseGaiiLoose(agentGaii);
            // Server-derived: the acting agent's OWN owner GHII. Never trust a client id here.
            const ownerGhii = `${parsed.owner}@${parsed.node}`;
            const recipientGhii = to.trim();

            if (recipientGhii === ownerGhii) {
                return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Cannot send a message to yourself.' }) }] };
            }
            if (!body?.trim() && !attachments?.length) {
                return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: 'A message must have a body or at least one attachment.' }) }] };
            }

            const mapped = attachments?.length ? mapMessageAttachments(attachments, ownerGhii, config.nodeId) : undefined;
            // TARGET-058, and this is the sharpest case on the whole surface. The message is SENT as
            // the owner, so the recipient sees a person's name on it — but an AGENT wrote the words.
            // Stamping the owner as the principal would let Mint-3 conclude "a human wrote this" and
            // produce exactly the false attribution the whole design exists to prevent, so the
            // principal here is the ACTING AGENT (the same identity the audit line below records).
            // Delegation is not review: holding `messages:send-as-owner` says the owner allowed the
            // agent to speak for them, not that anyone read this text before it went out. An owner
            // who did read it can say so by declaring human_involvement:"editorial-control".
            const aiProvenanceId = await provenanceForWrite(storage, {
                principal: agentGaii,
                content: body ?? '',
                declaredId: ai_provenance_id,
                declared: toDeclaredProvenance(ai_provenance),
                pipeline: 'mcp.dm_send_as_owner',
                surface: { visibility: 'private', humanAudience: true },
                labelPolicy: config.aiLabelPublic,
                nodeId: config.nodeId,
                baseUrl: config.baseUrl,
                enabled: config.aiProvenance,
            });
            const result = await sendDirectMessage(ctx, {
                senderGhii: ownerGhii, recipientGhii, body: body ?? '', replyToId: reply_to, attachments: mapped,
                conversationId: conversation_id, subject, aiProvenanceId,
            });

            if (!result.ok) {
                const msg = result.code === 'RECIPIENT_NOT_FOUND'
                    ? `No such recipient: ${recipientGhii}`
                    : 'The recipient is not accepting messages (blocked or pending first-contact approval).';
                return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: msg, code: result.code }) }] };
            }

            // Audit: an agent posted on the owner's behalf. The message displays as from the owner; this
            // log is the durable record of WHICH agent acted (a persisted per-message field is a follow-up).
            logger.info('dm sent as owner (delegated)', { agent: agentGaii, owner: ownerGhii, recipient: recipientGhii, messageId: result.message.id });

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        message_id: result.message.id,
                        conversation_id: result.message.conversationId,
                        sent_as: ownerGhii,
                        recipient: result.message.recipientGhii,
                        status: result.message.status,
                        attachments: result.message.attachments?.length ?? 0,
                        created_at: result.message.createdAt,
                        ...(await writeProvenanceEcho(storage, config, aiProvenanceId)),
                    }, null, 2),
                }],
            };
        },
    );

    // ── aimeat_dm_ask — ask a person a STRUCTURED question (a federated AskUserQuestion) ──
    mcp.tool(
        'aimeat_dm_ask',
        descriptionFor('aimeat_dm_ask'),
        {
            to: z.string().min(3).max(256).describe('Recipient identity: a person (owner@node), an agent (agent#owner@node), or an app (eco:app#owner@node).'),
            questions: z.array(InteractiveQuestionSchema).min(1).max(20)
                .describe('1–20 questions. Each: { id, header (short chip), prompt, options:[{id,label}], multiSelect? (checkboxes), allowOther? (default true), required? }.'),
            body: z.string().max(50000).optional().describe('Optional intro text shown above the questions (GFM markdown).'),
            subject: z.string().min(1).max(200).optional().describe('Open a NEW topic thread with this title (else the default thread or conversation_id).'),
            conversation_id: z.string().min(8).max(64).optional().describe('Continue a specific existing thread by its id.'),
            submit_label: z.string().min(1).max(80).optional().describe('Optional submit-button label (the inbox defaults to a localized "Send answers").'),
            ...aiProvenanceInputs,
        },
        annotationsFor('aimeat_dm_ask'),
        async ({ to, questions, body, subject, conversation_id, submit_label, ai_provenance, ai_provenance_id }) => {
            const senderGhii = getAgentGaii();
            const recipientGhii = to.trim();
            if (recipientGhii === senderGhii) {
                return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Cannot send a message to yourself.' }) }] };
            }
            // TARGET-058. A structured question is not a lesser kind of message: the framing and the
            // options are what a person reads, and the options are what they are steered to choose
            // between. So the hash covers the intro AND the questions — hashing the body alone would
            // describe the one part that is often empty.
            const aiProvenanceId = await provenanceForWrite(storage, {
                principal: senderGhii,
                content: `${body ?? ''}\n\n${JSON.stringify(questions)}`,
                declaredId: ai_provenance_id,
                declared: toDeclaredProvenance(ai_provenance),
                pipeline: 'mcp.dm_ask',
                surface: { visibility: 'private', humanAudience: true },
                labelPolicy: config.aiLabelPublic,
                nodeId: config.nodeId,
                baseUrl: config.baseUrl,
                enabled: config.aiProvenance,
            });
            const result = await sendDirectMessage(ctx, {
                senderGhii, recipientGhii, body: body ?? '', conversationId: conversation_id, subject,
                interactive: { role: 'questions', v: 1, questions, submitLabel: submit_label },
                aiProvenanceId,
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
                        questions: questions.length,
                        status: result.message.status,
                        note: 'The answer returns as a reply — read interactive.answers via aimeat_dm_thread(conversation_id).',
                        created_at: result.message.createdAt,
                        ...(await writeProvenanceEcho(storage, config, aiProvenanceId)),
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
            const mailboxOwnerGhii = ownerGhiiOf(agentGaii);
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
                            attachments: m.attachments?.map(a => attachmentView(a, mailboxOwnerGhii)) ?? [],
                            interactive: m.interactive ?? null,
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
            const mailboxOwnerGhii = ownerGhiiOf(agentGaii);
            const { messages, total } = await storage.listAgentDmThread(agentGaii, conversation_id, { page: page ?? 1, perPage: per_page ?? 50 });
            // Oldest-first so the agent reads the conversation in order.
            const ordered = [...messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            // TARGET-058: how each message in the thread was made, in one query. This is the case the
            // read half of the phase was written for — an agent summarising a conversation for the
            // person who owns the mailbox has to be able to say which turns a model wrote.
            const provFor = await readProvenanceMany(storage, config, ordered.map(m => m.aiProvenanceId));
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
                            attachments: m.attachments?.map(a => attachmentView(a, mailboxOwnerGhii)) ?? [],
                            interactive: m.interactive ?? null,
                            created_at: m.createdAt,
                            ...provFor(m.aiProvenanceId),
                        })),
                        total,
                    }, null, 2),
                }],
            };
        },
    );
}
