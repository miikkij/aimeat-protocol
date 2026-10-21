/**
 * @file src/mcp/dm-groups.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Group chat on the node's MCP endpoint: aimeat_dm_group_create, _get, _members, _leave,
 *   _invitations and _answer. The tools do not decide anything themselves: they call the services the
 *   /v1/messages/groups/* routes call (services/conversation-group-open.ts and
 *   conversation-group-manage.ts), so the chat and the page follow one set of rules. The scope words
 *   are applied where every tool is registered (TOOL_SCOPES, from the catalog entry); `as_owner` asks
 *   messages:send-as-owner here, as the route does.
 * @structure registerDmGroupTools(mcp, storage, config, peers, caller)
 * @usage import { registerDmGroupTools } from './dm-groups.js';
 * @version-history
 *   v1.0.0 — 2026-10-21 — Initial (wish-ryhm-keskustelu-viestit-puolelle).
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { toDeclaredProvenance } from './ai-provenance-input.js';
import { groupActor, openGroupAs } from '../services/conversation-group-open.js';
import {
  answerGroupInvitation, changeGroupMembers, groupView, leaveGroupConversation, listGroupInvitations, readGroupFor,
  type GroupFailure,
} from '../services/conversation-group-manage.js';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const failed = (f: Pick<GroupFailure, 'message' | 'members'> & { code: string }) => toolError(f.code,
  f.members ? `${f.message} ${JSON.stringify({ members: f.members })}` : f.message);

const AS_OWNER_SCOPE = 'messages:send-as-owner';

export function registerDmGroupTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  peers: Map<string, PeerInfo>,
  caller: () => CallerContext,
): void {
  const ctx = { config, storage, peers };

  /** The acting identity, or the refusal when `as_owner` is asked without its scope. */
  const act = (asOwner: boolean | undefined): { principal: string; actor: string } | { refused: ReturnType<typeof toolError> } => {
    const c = caller();
    if (asOwner && !c.has(AS_OWNER_SCOPE)) {
      return { refused: toolError('SCOPE_DENIED', `Acting in your owner's name needs their permission (${AS_OWNER_SCOPE}). Without it, act as yourself.`) };
    }
    return { principal: c.principal, actor: groupActor(c.principal, asOwner).actor };
  };

  mcp.registerTool('aimeat_dm_group_create', {
    description: descriptionFor('aimeat_dm_group_create'),
    inputSchema: zodShapeFor('aimeat_dm_group_create'),
    annotations: annotationsFor('aimeat_dm_group_create'),
  }, async ({ members, subject, body, as_owner, ai_provenance, ai_provenance_id }) => {
    const who = act(as_owner);
    if ('refused' in who) return who.refused;
    const opened = await openGroupAs(ctx, {
      principal: who.principal, scopes: caller().scopes, asOwner: as_owner,
      members: members ?? [], subject: subject ?? '', body: body ?? '',
      declared: toDeclaredProvenance(ai_provenance), declaredId: ai_provenance_id,
      pipeline: 'mcp.dm_group_create',
    });
    if (!opened.ok) return failed(opened);
    return text({
      ...groupView(opened.conversation, who.actor),
      message_id: opened.messageId,
      delivered_to: opened.delivered,
      members: opened.members,
      ...(opened.aiProvenanceId ? { ai_provenance_id: opened.aiProvenanceId } : {}),
      reply_with: 'aimeat_dm_send with conversation_id set to the value above',
    });
  });

  mcp.registerTool('aimeat_dm_group_get', {
    description: descriptionFor('aimeat_dm_group_get'),
    inputSchema: zodShapeFor('aimeat_dm_group_get'),
    annotations: annotationsFor('aimeat_dm_group_get'),
  }, async ({ conversation_id }) => {
    const view = await readGroupFor(ctx, conversation_id, caller().principal);
    return view ? text(view) : toolError('CONVERSATION_NOT_FOUND', 'No such group.');
  });

  mcp.registerTool('aimeat_dm_group_members', {
    description: descriptionFor('aimeat_dm_group_members'),
    inputSchema: zodShapeFor('aimeat_dm_group_members'),
    annotations: annotationsFor('aimeat_dm_group_members'),
  }, async ({ conversation_id, add, remove, as_owner }) => {
    if (!add?.length && !remove?.length) return toolError('INVALID_INPUT', 'Name somebody to add or remove.');
    const who = act(as_owner);
    if ('refused' in who) return who.refused;
    const changed = await changeGroupMembers(ctx, { actor: who.actor, conversationId: conversation_id, add, remove });
    if (!changed.ok) return failed(changed);
    return text({ ...groupView(changed.conversation, who.actor), members: changed.members });
  });

  mcp.registerTool('aimeat_dm_group_leave', {
    description: descriptionFor('aimeat_dm_group_leave'),
    inputSchema: zodShapeFor('aimeat_dm_group_leave'),
    annotations: annotationsFor('aimeat_dm_group_leave'),
  }, async ({ conversation_id, as_owner }) => {
    const who = act(as_owner);
    if ('refused' in who) return who.refused;
    const left = await leaveGroupConversation(ctx, { actor: who.actor, conversationId: conversation_id });
    if (!left.ok) return failed(left);
    return text({ conversation_id: left.conversation.id, left: true, manager: left.manager });
  });

  mcp.registerTool('aimeat_dm_group_invitations', {
    description: descriptionFor('aimeat_dm_group_invitations'),
    inputSchema: zodShapeFor('aimeat_dm_group_invitations'),
    annotations: annotationsFor('aimeat_dm_group_invitations'),
  }, async () => text({ invitations: await listGroupInvitations(ctx, caller().principal) }));

  mcp.registerTool('aimeat_dm_group_answer', {
    description: descriptionFor('aimeat_dm_group_answer'),
    inputSchema: zodShapeFor('aimeat_dm_group_answer'),
    annotations: annotationsFor('aimeat_dm_group_answer'),
  }, async ({ conversation_id, accept, as_owner }) => {
    const who = act(as_owner);
    if ('refused' in who) return who.refused;
    const answered = await answerGroupInvitation(ctx, { actor: who.actor, conversationId: conversation_id, accept });
    if (!answered.ok) return failed(answered);
    return text({
      conversation_id: answered.conversation.id, accepted: answered.accepted, joined: answered.joined,
      ...(answered.accepted ? groupView(answered.conversation, who.actor) : {}),
    });
  });
}
