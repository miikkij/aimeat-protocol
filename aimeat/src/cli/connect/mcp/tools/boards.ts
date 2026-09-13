/**
 * @file boards.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tool registrations for board management -- creating, listing,
 *   subscribing, reacting, replying, member updates, and deletion.
 * @version-history
 *   v1.4.0 -- 2026-09-13 -- aimeat_board_create sends `rules`, and aimeat_board_rules_set reaches
 *     PATCH /v1/boards/:id/rules. A board created through the connector ran on the node defaults,
 *     and its posts expired after seven days with no tool able to change that.
 *   v1.3.0 -- 2026-08-01 -- TARGET-058 Phase 11: aimeat_board_reply carries `ai_provenance` /
 *     `ai_provenance_id` and echoes what was recorded. The catalog promised the parameter; this
 *     shape stripped it as an unknown key.
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.2.0 -- 2026-05-30 -- F10 drift reconciliation: add allowed_gaiis to create, callback_url+filters to
 *     subscribe, replace members with add/remove on members (matches REST PATCH body + server MCP).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';
import { aiProvenanceInputs } from '../../../../mcp/ai-provenance-input.js';
import { provenanceEchoedResult } from '../../ai-provenance-carry.js';
import { envelopeResult } from './_registry.js';

/**
 * The rule set a board takes, the same shape the node's own tool declares (mcp/boards.ts). Strict,
 * so a misspelled rule is refused here instead of stripped on the way out. The bounds are the node's
 * to check: services/board-write.ts refuses an out-of-range value with the message that names it.
 */
const boardRulesInput = z.strictObject({
  posting: z.enum(['owner', 'members', 'anyone']).optional(),
  categories: z.array(z.string()).optional(),
  default_ttl_hours: z.number().optional(),
  post_cost: z.number().optional(),
}).describe('The board\'s own rules: posting, categories, default_ttl_hours, post_cost');

export function registerBoardsTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_board_list', descriptionFor('aimeat_board_list'), {}, annotationsFor('aimeat_board_list'), async () => {
    const resp = await client.get('/v1/boards');
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_board_create', descriptionFor('aimeat_board_create'), {
    name: z.string().describe('Board name'),
    description: z.string().optional().describe('Board description'),
    visibility: z.string().optional().describe('Board visibility level'),
    allowed_gaiis: z.array(z.string()).optional().describe('GAIIs allowed to access a shared/private board'),
    rules: boardRulesInput.optional(),
  }, annotationsFor('aimeat_board_create'), async ({ name, description, visibility, allowed_gaiis, rules }) => {
    const body: Record<string, unknown> = { name };
    if (description) body.description = description;
    if (visibility) body.visibility = visibility;
    if (allowed_gaiis) body.allowed_gaiis = allowed_gaiis;
    // POST /v1/boards has read `rules` since 2026-08-30; this door never sent it.
    if (rules) body.rules = rules;
    const resp = await client.post('/v1/boards', body);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_board_rules_set', descriptionFor('aimeat_board_rules_set'), {
    board_id: z.string().describe('Board identifier'),
    rules: boardRulesInput,
  }, annotationsFor('aimeat_board_rules_set'), async ({ board_id, rules }) => {
    const resp = await client.patch(`/v1/boards/${encodeURIComponent(board_id)}/rules`, { rules });
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_board_subscribe', descriptionFor('aimeat_board_subscribe'), {
    board_id: z.string().describe('Board identifier'),
    callback_url: z.string().optional().describe('Webhook URL to notify on new posts'),
    filters: z.object({
      categories: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
    }).optional().describe('Only notify for posts matching these categories/tags'),
  }, annotationsFor('aimeat_board_subscribe'), async ({ board_id, callback_url, filters }) => {
    const body: Record<string, unknown> = {};
    if (callback_url) body.callback_url = callback_url;
    if (filters) body.filters = filters;
    const resp = await client.post(`/v1/boards/${encodeURIComponent(board_id)}/subscribe`, body);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_board_react', descriptionFor('aimeat_board_react'), {
    board_id: z.string().describe('Board identifier'),
    post_id: z.string().describe('Post identifier'),
    emoji: z.string().describe('Reaction emoji'),
    remove: z.boolean().optional().describe('Take back your own reaction instead of adding it'),
  }, annotationsFor('aimeat_board_react'), async ({ board_id, post_id, emoji, remove }) => {
    const path = `/v1/boards/${encodeURIComponent(board_id)}/posts/${encodeURIComponent(post_id)}/react`;
    // The body key is `reaction`, which is what BoardReactionSchema names and what the route
    // destructures. This surface sent `{ emoji }`, so every reaction an agent made through the
    // connector failed validation while the node's own tool, sending the right key, worked.
    const resp = remove
      ? await client.delete(`${path}?reaction=${encodeURIComponent(emoji)}`)
      : await client.post(path, { reaction: emoji });
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_board_reply', descriptionFor('aimeat_board_reply'), {
    board_id: z.string().describe('Board identifier'),
    post_id: z.string().describe('Post identifier'),
    body: z.string().describe('Reply body'),
    ...aiProvenanceInputs,
  }, annotationsFor('aimeat_board_reply'), async ({ board_id, post_id, body, ai_provenance, ai_provenance_id }) => {
    const resp = await client.post(
      `/v1/boards/${encodeURIComponent(board_id)}/posts/${encodeURIComponent(post_id)}/replies`,
      { body },
    );
    return provenanceEchoedResult(client,
      { tool: 'aimeat_board_reply', declared: ai_provenance, declaredId: ai_provenance_id }, resp);
  });

  mcp.tool('aimeat_board_members', descriptionFor('aimeat_board_members'), {
    board_id: z.string().describe('Board identifier'),
    add: z.array(z.string()).optional().describe('GAIIs to grant access'),
    remove: z.array(z.string()).optional().describe('GAIIs to revoke access'),
  }, annotationsFor('aimeat_board_members'), async ({ board_id, add, remove }) => {
    const body: Record<string, unknown> = {};
    if (add) body.add = add;
    if (remove) body.remove = remove;
    const resp = await client.patch(
      `/v1/boards/${encodeURIComponent(board_id)}/members`,
      body,
    );
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_board_delete', descriptionFor('aimeat_board_delete'), {
    board_id: z.string().describe('Board identifier'),
  }, annotationsFor('aimeat_board_delete'), async ({ board_id }) => {
    const resp = await client.delete(`/v1/boards/${encodeURIComponent(board_id)}`);
    return envelopeResult(resp);
  });
}
