/**
 * @file conversation-group-open.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one implementation behind every endpoint that opens a group chat: POST
 *   /v1/messages/groups and the aimeat_dm_group_create MCP tool both call openGroupAs, so the
 *   provenance declaration, the send limit and the provenance record happen in one place.
 *
 *   WHO OPENS IT. A person opens a group as themselves. An agent opens it as itself, or, with
 *   `asOwner`, in its owner's name: the owner is then the manager and the sender of the first message,
 *   and that message names the agent that wrote it (sentByAgent), the rule a 1:1 sent in the owner's
 *   name follows (services/message-send-as-owner.ts). The endpoint decides whether `asOwner` is allowed
 *   (`messages:send-as-owner`); this function takes the answer.
 * @structure groupActor() · openGroupAs()
 * @usage const r = await openGroupAs(ctx, { principal, scopes, members, subject, body, pipeline: 'rest.messages_group_create' });
 * @version-history
 *   v1.0.0 — 2026-10-21 — Initial: user-created group chat (wish-ryhm-keskustelu-viestit-puolelle).
 */
import type { ConversationRecord } from '../storage/interface.js';
import type { DeliveryCtx } from './message-delivery.js';
import type { DeclaredProvenance } from './ai-provenance.js';
import { provenanceDeclarationRefusal } from './ai-provenance.js';
import { mintMessageProvenance } from './message-provenance.js';
import { takeSendTurn } from './message-send-limit.js';
import { startGroupConversation, type GroupManageError, type MemberOutcome } from './conversation-group-manage.js';
import { ownerGhiiOf, parseGaiiLoose } from '../utils/gaii.js';

/**
 * The identity that acts in a group change: the caller, or with `asOwner` the account behind an
 * agent. A person passing `asOwner` is themselves already, so it changes nothing for them.
 */
export function groupActor(principal: string, asOwner: boolean | undefined): { actor: string; actingAgent?: string } {
  if (!asOwner || !parseGaiiLoose(principal).agent) return { actor: principal };
  return { actor: ownerGhiiOf(principal), actingAgent: principal };
}

export interface OpenGroupRequest {
  /** The resolved identity of the caller (an owner's GHII, an agent's GAII). */
  principal: string;
  scopes: readonly string[];
  /** Already authorised by the endpoint: open the group in the agent's owner's name. */
  asOwner?: boolean;
  members: string[];
  subject: string;
  body: string;
  declared?: DeclaredProvenance;
  declaredId?: string;
  /** Names the endpoint in the provenance record, e.g. 'rest.messages_group_create'. */
  pipeline: string;
}

export type OpenGroupAnswer =
  | { ok: true; conversation: ConversationRecord; messageId: string; delivered: number; members: MemberOutcome[]; aiProvenanceId?: string }
  | { ok: false; status: number; code: GroupManageError | string; message: string; members?: MemberOutcome[]; retryAfterSec?: number };

const STATUS: Record<GroupManageError, number> = {
  INVALID_INPUT: 400, NO_MEMBERS: 400, TOO_MANY_PARTICIPANTS: 400, CONVERSATION_NOT_FOUND: 404,
  NOT_A_PARTICIPANT: 403, NOT_THE_MANAGER: 403, NOT_A_GROUP: 400, NOT_INVITED: 404, RATE_LIMITED: 429,
};

/** The HTTP status for a group refusal, shared by every REST endpoint of group chat. */
export function groupErrorStatus(code: GroupManageError): number {
  return STATUS[code] ?? 400;
}

/**
 * Open a group and send its first message, with the checks every send makes, in the order they
 * must run: the provenance declaration is refused before anything is counted or written, the send
 * limit is counted before anything is written, and the provenance record is stored only once the
 * group and its first message exist.
 */
export async function openGroupAs(ctx: DeliveryCtx, req: OpenGroupRequest): Promise<OpenGroupAnswer> {
  const { storage, config } = ctx;
  const { actor, actingAgent } = groupActor(req.principal, req.asOwner);

  const refusal = await provenanceDeclarationRefusal(storage, {
    principal: req.principal, declaredId: req.declaredId, declared: req.declared, enabled: config.aiProvenance, scopes: req.scopes,
  });
  if (refusal) return { ok: false, status: 403, code: refusal.code, message: refusal.message };

  const turn = takeSendTurn(actor);
  if (!turn.ok) return { ok: false, status: 429, code: 'RATE_LIMITED', message: turn.message, retryAfterSec: turn.retryAfterSec };

  // The words were written by the principal, whoever they are sent as: delegation is not review.
  const prov = await mintMessageProvenance({ storage, config }, {
    principal: req.principal, scopes: [...req.scopes], body: req.body,
    declaredId: req.declaredId, declared: req.declared, pipeline: req.pipeline,
  });
  const agent = actingAgent ? await storage.getAgent(actingAgent) : null;

  const started = await startGroupConversation(ctx, {
    actor, members: req.members, subject: req.subject, body: req.body,
    aiProvenanceId: prov.id, sendLimit: turn,
    ...(actingAgent ? { sentByAgent: actingAgent, sentByAgentName: agent?.displayName || parseGaiiLoose(actingAgent).agent } : {}),
  });
  if (!started.ok) {
    return { ok: false, status: groupErrorStatus(started.code), code: started.code, message: started.message,
      ...(started.members ? { members: started.members } : {}),
      ...(started.retryAfterSec ? { retryAfterSec: started.retryAfterSec } : {}) };
  }
  await prov.store();
  return { ok: true, conversation: started.conversation, messageId: started.messageId, delivered: started.delivered,
    members: started.members, ...(prov.id ? { aiProvenanceId: prov.id } : {}) };
}
