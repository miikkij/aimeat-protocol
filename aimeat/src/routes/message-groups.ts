/**
 * @file src/routes/message-groups.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Group chat: a person opens a group with the people they choose, the manager adds and
 *   removes members, anybody leaves, an invited person accepts or declines. Messages in a group are
 *   sent and read on the endpoints every thread uses (POST /v1/messages with conversation_id, GET
 *   /v1/messages/conversations/:id); these endpoints decide who is in it. The rules are in
 *   services/conversation-group-manage.ts, and the aimeat_dm_group_* MCP tools call the same services.
 *
 *   `as_owner` lets an agent act in its owner's name, on the messages:send-as-owner scope, as a 1:1
 *   send in the owner's name does.
 * @structure registerGroupRoutes(router, config, storage, peers)
 *   - POST /v1/messages/groups                                   -- open a group with its first message
 *   - GET  /v1/messages/groups/invitations                       -- open invitations to answer
 *   - GET  /v1/messages/groups/:conversationId                   -- the members, for a member
 *   - POST /v1/messages/groups/:conversationId/members           -- the manager adds and removes
 *   - POST /v1/messages/groups/:conversationId/leave             -- leave
 *   - POST /v1/messages/groups/:conversationId/invitation        -- accept or decline
 * @usage registerGroupRoutes(router, config, storage, peers);  (from messagesRouter, before /:id routes)
 * @version-history
 *   v1.0.0 — 2026-10-21 — Initial (wish-ryhm-keskustelu-viestit-puolelle).
 */
import type { Request, Response, Router } from 'express';
import type { ZodType } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { requireAuth, requireLocalSession, requireExternalPrincipal, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { refuseNeedsPermission } from '../middleware/refusals.js';
import { callerOf } from '../middleware/caller.js';
import { GroupCreateSchema, GroupMembersSchema, GroupLeaveSchema, GroupInvitationAnswerSchema } from '../models/message-schemas.js';
import { toDeclaredProvenance } from '../mcp/ai-provenance-input.js';
import { groupActor, groupErrorStatus, openGroupAs } from '../services/conversation-group-open.js';
import {
  answerGroupInvitation, changeGroupMembers, groupView, leaveGroupConversation, listGroupInvitations, readGroupFor,
  type GroupFailure,
} from '../services/conversation-group-manage.js';

const AS_OWNER_SCOPE = 'messages:send-as-owner';

export function registerGroupRoutes(router: Router, config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): void {
  const ctx = { config, storage, peers };
  const guard = [requireAuth(), requireLocalSession(), requireExternalPrincipal()];

  /** The body, parsed, or the 400 already sent. */
  const parse = <T>(schema: ZodType<T>, req: Request, res: Response): T | null => {
    const parsed = schema.safeParse(req.body ?? {});
    if (parsed.success) return parsed.data;
    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')));
    return null;
  };

  /** The acting identity, or the 403 already sent when `as_owner` is asked without its scope. */
  const actorOf = (req: Request, res: Response, asOwner: boolean | undefined): { principal: string; actor: string } | null => {
    const caller = callerOf(req, config.nodeId, storage);
    if (asOwner && !caller.has(AS_OWNER_SCOPE)) {
      res.status(403).json(refuseNeedsPermission(config, { want: 'act in your name in group chats', scope: AS_OWNER_SCOPE }));
      return null;
    }
    return { principal: caller.principal, actor: groupActor(caller.principal, asOwner).actor };
  };

  const refuse = (res: Response, f: GroupFailure): void => {
    res.status(groupErrorStatus(f.code)).json(error(config.nodeId, f.code, f.message, groupErrorStatus(f.code),
      f.members ? { members: f.members } : undefined));
  };

  /* ── POST /v1/messages/groups — open a group with its first message ── */
  router.post('/v1/messages/groups', ...guard, requireScope('messages:send'), async (req, res) => {
    const input = parse(GroupCreateSchema, req, res);
    if (!input) return;
    const who = actorOf(req, res, input.as_owner);
    if (!who) return;
    const opened = await openGroupAs(ctx, {
      principal: who.principal, scopes: req.auth!.scopes ?? [], asOwner: input.as_owner,
      members: input.members, subject: input.subject, body: input.body,
      declared: toDeclaredProvenance(input.ai_provenance), declaredId: input.ai_provenance_id,
      pipeline: 'rest.messages_group_create',
    });
    if (!opened.ok) {
      if (opened.retryAfterSec) res.setHeader('Retry-After', opened.retryAfterSec);
      res.status(opened.status).json(error(config.nodeId, opened.code, opened.message, opened.status,
        opened.members ? { members: opened.members } : undefined));
      return;
    }
    res.status(201).json(success(config.nodeId, {
      ...groupView(opened.conversation, who.actor),
      message_id: opened.messageId,
      delivered_to: opened.delivered,
      members: opened.members,
      ...(opened.aiProvenanceId ? { ai_provenance_id: opened.aiProvenanceId } : {}),
      reply_with: 'POST /v1/messages with conversation_id set to the value above',
    }, [
      { description: 'View conversation', method: 'GET', url: `/v1/messages/conversations/${opened.conversation.id}` },
      { description: 'Add or remove members', method: 'POST', url: `/v1/messages/groups/${opened.conversation.id}/members` },
    ]));
  });

  /* ── GET /v1/messages/groups/invitations — open invitations the caller may answer ── */
  router.get('/v1/messages/groups/invitations', ...guard, requireScope('messages:read'), async (req, res) => {
    const principal = callerOf(req, config.nodeId, storage).principal;
    const invitations = await listGroupInvitations(ctx, principal);
    res.json(success(config.nodeId, { invitations }));
  });

  /* ── GET /v1/messages/groups/:conversationId — the members, for a member ── */
  router.get('/v1/messages/groups/:conversationId', ...guard, requireScope('messages:read'), async (req, res) => {
    // Somebody who is not in the group is told the same as for a group that does not exist.
    const view = await readGroupFor(ctx, req.params.conversationId as string, callerOf(req, config.nodeId, storage).principal);
    if (!view) {
      res.status(404).json(error(config.nodeId, 'CONVERSATION_NOT_FOUND', 'No such group.'));
      return;
    }
    res.json(success(config.nodeId, view));
  });

  /* ── POST /v1/messages/groups/:conversationId/members — the manager adds and removes ── */
  router.post('/v1/messages/groups/:conversationId/members', ...guard, requireScope('messages:send'), async (req, res) => {
    const input = parse(GroupMembersSchema, req, res);
    if (!input) return;
    const who = actorOf(req, res, input.as_owner);
    if (!who) return;
    const changed = await changeGroupMembers(ctx, {
      actor: who.actor, conversationId: req.params.conversationId as string, add: input.add, remove: input.remove,
    });
    if (!changed.ok) { refuse(res, changed); return; }
    res.json(success(config.nodeId, { ...groupView(changed.conversation, who.actor), members: changed.members }));
  });

  /* ── POST /v1/messages/groups/:conversationId/leave ── */
  router.post('/v1/messages/groups/:conversationId/leave', ...guard, requireScope('messages:send'), async (req, res) => {
    const input = parse(GroupLeaveSchema, req, res);
    if (!input) return;
    const who = actorOf(req, res, input.as_owner);
    if (!who) return;
    const left = await leaveGroupConversation(ctx, { actor: who.actor, conversationId: req.params.conversationId as string });
    if (!left.ok) { refuse(res, left); return; }
    res.json(success(config.nodeId, { conversation_id: left.conversation.id, left: true, manager: left.manager }));
  });

  /* ── POST /v1/messages/groups/:conversationId/invitation — accept or decline ── */
  router.post('/v1/messages/groups/:conversationId/invitation', ...guard, requireScope('messages:send'), async (req, res) => {
    const input = parse(GroupInvitationAnswerSchema, req, res);
    if (!input) return;
    const who = actorOf(req, res, input.as_owner);
    if (!who) return;
    const answered = await answerGroupInvitation(ctx, {
      actor: who.actor, conversationId: req.params.conversationId as string, accept: input.accept,
    });
    if (!answered.ok) { refuse(res, answered); return; }
    res.json(success(config.nodeId, {
      conversation_id: answered.conversation.id, accepted: answered.accepted, joined: answered.joined,
      ...(answered.accepted ? groupView(answered.conversation, who.actor) : {}),
    }, answered.accepted
      ? [{ description: 'View conversation', method: 'GET', url: `/v1/messages/conversations/${answered.conversation.id}` }]
      : []));
  });
}
