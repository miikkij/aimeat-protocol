/**
 * @file src/routes/messages-as-owner.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description POST /v1/messages/as-owner: an agent sends a direct message in its owner's name, and
 *   the message says which agent sent it. The REST twin of aimeat_dm_send_as_owner; both call
 *   services/message-send-as-owner.ts. The connector's copy of the tool calls this route, where it
 *   posted to POST /v1/messages with the agent's own token and so sent as the agent until 2026-10-17.
 *
 *   WHO. An agent holding `messages:send-as-owner`. The sender is the agent's own owner, derived from
 *   its credential; the service refuses anything that is not an agent (403 NOT_AN_AGENT).
 * @structure registerSendAsOwnerRoute(router, config, storage, peers)
 * @usage registerSendAsOwnerRoute(router, config, storage, peers);
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial (wish-agentin-omistajan-nimiss-l-hett-m-viesti-n-ytt-mik-agentti-s).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { requireAuth, requireLocalSession, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { MessageSendAsOwnerSchema } from '../models/message-schemas.js';
import { toDeclaredProvenance } from '../mcp/ai-provenance-input.js';
import { sendAsOwner } from '../services/message-send-as-owner.js';
import { resolveIdentity } from '../utils/gaii.js';

export function registerSendAsOwnerRoute(router: Router, config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): void {
  router.post('/v1/messages/as-owner', requireAuth(), requireLocalSession(), requireScope('messages:send-as-owner'), async (req, res) => {
    // No `interactive` here: questions are asked in the agent's own name with POST /v1/messages, and
    // the strict schema refuses the field rather than dropping it.
    const parsed = MessageSendAsOwnerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }
    const input = parsed.data;
    const result = await sendAsOwner({ config, storage, peers }, {
      // The resolved identity: an agent's GAII as it is, and an owner's GHII, which the service refuses.
      agentGaii: resolveIdentity(req.auth!, config.nodeId), scopes: req.auth!.scopes ?? [], to: input.to, body: input.body,
      replyTo: input.reply_to, subject: input.subject, conversationId: input.conversation_id,
      attachments: input.attachments, declared: toDeclaredProvenance(input.ai_provenance), declaredId: input.ai_provenance_id,
      pipeline: 'rest.messages_send_as_owner',
    });
    if (!result.ok) {
      if (result.retryAfterSec) res.setHeader('Retry-After', result.retryAfterSec);
      res.status(result.status).json(error(config.nodeId, result.code, result.message));
      return;
    }
    res.status(201).json(success(config.nodeId, {
      message_id: result.messageId,
      conversation_id: result.conversationId,
      sent_as: result.sentAs,
      sent_by_agent: result.sentByAgent,
      sent_by_agent_name: result.sentByAgentName,
      recipient: result.recipient,
      status: result.status,
      ...(result.delivered !== undefined ? { delivered_to: result.delivered } : {}),
      ...(result.awaitingApproval ? { awaiting_approval: true } : {}),
      ...(result.aiProvenanceId ? { ai_provenance_id: result.aiProvenanceId } : {}),
    }, [
      { description: 'View conversation', method: 'GET', url: `/v1/messages/conversations/${result.conversationId}` },
    ]));
  });
}
