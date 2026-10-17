/**
 * @file src/services/message-send-as-owner.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An agent sends a direct message in its owner's name, and the message says which agent
 *   sent it. One implementation for every surface: the MCP tool aimeat_dm_send_as_owner, the REST
 *   route POST /v1/messages/as-owner, and through that route the connector's copy of the tool.
 *
 *   WHY. Until 2026-10-17 the MCP tool wrote the message as the owner and kept the agent only in the
 *   node log and the provenance record, which no page read: the owner's list said "You: ..." about
 *   words an agent wrote and sent, and the recipient saw only the owner. The connector's copy posted
 *   to POST /v1/messages with the agent's own token, so the same tool sent as the AGENT there. And the
 *   MCP tool did not resolve a group address, so a reply into a support thread was written as a 1:1 to
 *   `support@operators` and stayed queued. Jouni: "agenttina lähetetyt mitkä on lähetetty minuna
 *   pitäisi näkyä että agentti lähetti ne" (2026-10-17); the recipient sees it too.
 *
 *   WHAT IT DOES. The sender is the agent's OWN owner, derived from the agent's identity and never
 *   taken from the request, so an agent can speak only for its own owner. The address is resolved as
 *   POST /v1/messages resolves it (a group thread, the support address, or a person), the account's
 *   send limit is asked once, the provenance names the AGENT as its principal (delegation is not
 *   review), and the message carries sentByAgent / sentByAgentName on every copy.
 *
 *   WHO. The route and the tool ask `messages:send-as-owner`; this function takes an agent identity
 *   and refuses anything else.
 * @structure SendAsOwnerInput · SendAsOwnerResult · sendAsOwner(ctx, input)
 * @usage const r = await sendAsOwner(ctx, { agentGaii, scopes, to, body, pipeline: 'rest.messages_send_as_owner' });
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial, from the body of aimeat_dm_send_as_owner
 *     (wish-agentin-omistajan-nimiss-l-hett-m-viesti-n-ytt-mik-agentti-s).
 */
import type { DeliveryCtx } from './message-delivery.js';
import type { MessageAttachmentInput } from '../models/message-schemas.js';
import type { DeclaredProvenance } from './ai-provenance.js';
import { sendDirectMessage, mapMessageAttachments } from './message-send.js';
import { sendGroupMessage } from './conversation-group.js';
import { resolveGroupTarget } from './message-alias.js';
import { takeSendTurn } from './message-send-limit.js';
import { mintMessageProvenance } from './message-provenance.js';
import { provenanceDeclarationRefusal } from './ai-provenance.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

export interface SendAsOwnerInput {
  /** The acting agent's own identity, from its credential. */
  agentGaii: string;
  /** The scopes the agent's request holds, for the provenance declaration check. */
  scopes: readonly string[];
  to: string;
  body?: string;
  replyTo?: string;
  subject?: string;
  conversationId?: string;
  attachments?: MessageAttachmentInput[];
  declared?: DeclaredProvenance;
  declaredId?: string;
  /** Which surface sent it, for the provenance record: 'mcp.dm_send_as_owner', 'rest.messages_send_as_owner'. */
  pipeline: string;
}

export type SendAsOwnerResult =
  | { ok: true; messageId: string; conversationId: string; sentAs: string; recipient: string; status: string;
      sentByAgent: string; sentByAgentName: string; aiProvenanceId?: string; delivered?: number; awaitingApproval?: boolean }
  | { ok: false; status: number; code: string; message: string; retryAfterSec?: number };

export async function sendAsOwner(ctx: DeliveryCtx, input: SendAsOwnerInput): Promise<SendAsOwnerResult> {
  const { storage, config } = ctx;
  const parsed = parseGaiiLoose(input.agentGaii);
  if (!parsed.agent || input.agentGaii.startsWith('eco:')) {
    return { ok: false, status: 403, code: 'NOT_AN_AGENT', message: 'Only an agent sends a message in its owner\'s name. A person sends their own with POST /v1/messages.' };
  }
  // Server-derived: the acting agent's OWN owner. Never a client-supplied id.
  const ownerGhii = `${parsed.owner}@${parsed.node}`;
  let to = input.to.trim();
  if (to === ownerGhii) return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'Cannot send a message to yourself.' };
  if (!input.body?.trim() && !input.attachments?.length) {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'A message must have a body or at least one attachment.' };
  }
  const refusal = await provenanceDeclarationRefusal(storage, {
    principal: input.agentGaii, declaredId: input.declaredId, declared: input.declared, enabled: config.aiProvenance, scopes: input.scopes,
  });
  if (refusal) return { ok: false, status: 403, code: refusal.code, message: refusal.message };

  // The owner's account is the sender, and the agent is part of it: one allowance.
  const turn = takeSendTurn(ownerGhii);
  if (!turn.ok) return { ok: false, status: 429, code: 'RATE_LIMITED', message: turn.message, retryAfterSec: turn.retryAfterSec };

  // The agent's name as its owner sees it, written on the message so a recipient elsewhere has it too.
  const agent = await storage.getAgent(input.agentGaii);
  const sentBy = { sentByAgent: input.agentGaii, sentByAgentName: agent?.displayName || parsed.agent };

  // The message is SENT as the owner, but an AGENT wrote the words: the provenance principal is the
  // agent. Delegation is not review; an owner who read it says so with human_involvement.
  const prov = await mintMessageProvenance({ storage, config }, {
    principal: input.agentGaii, scopes: [...input.scopes], body: input.body ?? '',
    declaredId: input.declaredId, declared: input.declared, pipeline: input.pipeline,
  });
  const aiProvenanceId = prov.id;

  // The address, resolved as POST /v1/messages resolves it.
  let conversationId = input.conversationId;
  let subject = input.subject;
  const group = await resolveGroupTarget(ctx, config, ownerGhii, { to, conversationId, subject });
  if (group.kind === 'refused') return { ok: false, status: group.status, code: group.code, message: group.message };
  if (group.kind === 'redirect') { to = group.to; conversationId = group.conversationId; subject = group.subject ?? subject; }
  if (group.kind === 'group') {
    const sent = await sendGroupMessage(ctx, {
      conversationId: group.conversation.id, senderGhii: ownerGhii, body: input.body ?? '',
      attachments: input.attachments?.length ? mapMessageAttachments(input.attachments, ownerGhii, config.nodeId) : undefined,
      replyToId: input.replyTo, aiProvenanceId, ...sentBy, sendLimit: turn,
    });
    if (!sent.ok) {
      if (sent.code === 'RATE_LIMITED') return { ok: false, status: 429, code: 'RATE_LIMITED', message: sent.message, retryAfterSec: sent.retryAfterSec };
      return sent.code === 'CONVERSATION_NOT_FOUND'
        ? { ok: false, status: 404, code: sent.code, message: 'No such conversation.' }
        : { ok: false, status: 403, code: sent.code, message: 'Your owner is not a participant in this conversation.' };
    }
    await prov.store();
    logger.info('dm sent as owner (delegated, group)', { agent: input.agentGaii, owner: ownerGhii, conversation: group.conversation.id, messageId: sent.messageId });
    return {
      ok: true, messageId: sent.messageId, conversationId: group.conversation.id, sentAs: ownerGhii,
      recipient: to, status: 'delivered', delivered: sent.delivered, aiProvenanceId, ...sentBy,
    };
  }

  const result = await sendDirectMessage(ctx, {
    senderGhii: ownerGhii, recipientGhii: to, body: input.body ?? '', replyToId: input.replyTo,
    attachments: input.attachments?.length ? mapMessageAttachments(input.attachments, ownerGhii, config.nodeId) : undefined,
    conversationId, subject, aiProvenanceId,
    // The message is the owner's, the files are the agent's: the send finds which holds each file.
    actingGaii: input.agentGaii,
    ...sentBy,
    sendLimit: turn,
  });
  if (!result.ok) {
    if (result.code === 'RATE_LIMITED') return { ok: false, status: 429, code: 'RATE_LIMITED', message: result.reason ?? 'Too many messages; try again shortly.' };
    const status = result.code === 'RECIPIENT_NOT_FOUND' ? 404 : result.code === 'ATTACHMENT_NOT_FOUND' ? 400 : 403;
    const message = result.reason ?? (result.code === 'RECIPIENT_NOT_FOUND'
      ? `No such recipient: ${to}`
      : 'The recipient is not accepting messages (blocked or pending first-contact approval).');
    return { ok: false, status, code: result.code, message };
  }
  await prov.store();
  logger.info('dm sent as owner (delegated)', { agent: input.agentGaii, owner: ownerGhii, recipient: to, messageId: result.message.id });
  return {
    ok: true, messageId: result.message.id, conversationId: result.message.conversationId, sentAs: ownerGhii,
    recipient: result.message.recipientGhii, status: result.message.status, aiProvenanceId,
    awaitingApproval: result.awaitingApproval, ...sentBy,
  };
}
