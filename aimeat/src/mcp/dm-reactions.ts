/**
 * @file src/mcp/dm-reactions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_dm_react on the node's MCP endpoint. It decides nothing itself: reactionActor and
 *   reactToMessage (services/message-reactions.ts) are what POST/DELETE /v1/messages/:id/reactions
 *   call, so the chat and the page follow one set of rules. messages:send is applied where every tool
 *   is registered (TOOL_SCOPES, from the catalog entry); `as_owner` asks messages:send-as-owner in
 *   reactionActor, as the route does.
 * @structure registerDmReactionTools(mcp, storage, config, peers, caller)
 * @usage import { registerDmReactionTools } from './dm-reactions.js';
 * @version-history
 *   v1.0.0 — 2026-10-26 — Initial (wish-kuittausreaktiot-yksitt-isiin-viesteihin-viestit-ketjuissa).
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
import { reactToMessage, reactionActor } from '../services/message-reactions.js';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

export function registerDmReactionTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  peers: Map<string, PeerInfo>,
  caller: () => CallerContext,
): void {
  const ctx = { config, storage, peers };

  mcp.registerTool('aimeat_dm_react', {
    description: descriptionFor('aimeat_dm_react'),
    inputSchema: zodShapeFor('aimeat_dm_react'),
    annotations: annotationsFor('aimeat_dm_react'),
  }, async ({ message_id, reaction, remove, as_owner }) => {
    const actor = reactionActor(caller(), as_owner);
    if ('refused' in actor) return toolError(actor.code, actor.refused);
    const out = await reactToMessage(ctx, actor, { messageId: message_id, reaction, remove });
    if (!out.ok) return toolError(out.code, out.message);
    return text({ message_id: out.messageId, reaction: String(reaction).trim(), removed: !!remove, changed: out.changed, reactions: out.reactions });
  });
}
