/**
 * @file boards.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tool registrations for board management -- creating, listing,
 *   subscribing, reacting, replying, member updates, and deletion.
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
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
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { provenanceEchoedResult } from '../../../../tool-dispatch/ai-provenance-carry.js';
import { envelopeResult } from './_registry.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerBoardsTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_board_list', descriptionFor('aimeat_board_list'), zodShapeFor('aimeat_board_list'), annotationsFor('aimeat_board_list'), async () => {
    const resp = await client.get('/v1/boards');
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_board_create', descriptionFor('aimeat_board_create'), zodShapeFor('aimeat_board_create'), annotationsFor('aimeat_board_create'), async ({ name, description, visibility, allowed_gaiis, rules }) => {
    const body: Record<string, unknown> = { name };
    if (description) body.description = description;
    if (visibility) body.visibility = visibility;
    if (allowed_gaiis) body.allowed_gaiis = allowed_gaiis;
    // POST /v1/boards has read `rules` since 2026-08-30; this door never sent it.
    if (rules) body.rules = rules;
    const resp = await client.post('/v1/boards', body);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_board_rules_set', descriptionFor('aimeat_board_rules_set'), zodShapeFor('aimeat_board_rules_set'), annotationsFor('aimeat_board_rules_set'), async ({ board_id, rules }) => {
    const resp = await client.patch(`/v1/boards/${encodeURIComponent(board_id)}/rules`, { rules });
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_board_subscribe', descriptionFor('aimeat_board_subscribe'), zodShapeFor('aimeat_board_subscribe'), annotationsFor('aimeat_board_subscribe'), async ({ board_id, callback_url, filters }) => {
    const body: Record<string, unknown> = {};
    if (callback_url) body.callback_url = callback_url;
    if (filters) body.filters = filters;
    const resp = await client.post(`/v1/boards/${encodeURIComponent(board_id)}/subscribe`, body);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_board_react', descriptionFor('aimeat_board_react'), zodShapeFor('aimeat_board_react'), annotationsFor('aimeat_board_react'), async ({ board_id, post_id, emoji, remove }) => {
    const path = `/v1/boards/${encodeURIComponent(board_id)}/posts/${encodeURIComponent(post_id)}/react`;
    // The body key is `reaction`, which is what BoardReactionSchema names and what the route
    // destructures. This surface sent `{ emoji }`, so every reaction an agent made through the
    // connector failed validation while the node's own tool, sending the right key, worked.
    const resp = remove
      ? await client.delete(`${path}?reaction=${encodeURIComponent(emoji)}`)
      : await client.post(path, { reaction: emoji });
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_board_reply', descriptionFor('aimeat_board_reply'), zodShapeFor('aimeat_board_reply'), annotationsFor('aimeat_board_reply'), async ({ board_id, post_id, body, ai_provenance, ai_provenance_id }) => {
    const resp = await client.post(
      `/v1/boards/${encodeURIComponent(board_id)}/posts/${encodeURIComponent(post_id)}/replies`,
      { body },
    );
    return provenanceEchoedResult(client,
      { tool: 'aimeat_board_reply', declared: ai_provenance, declaredId: ai_provenance_id }, resp);
  });

  mcp.tool('aimeat_board_members', descriptionFor('aimeat_board_members'), zodShapeFor('aimeat_board_members'), annotationsFor('aimeat_board_members'), async ({ board_id, add, remove }) => {
    const body: Record<string, unknown> = {};
    if (add) body.add = add;
    if (remove) body.remove = remove;
    const resp = await client.patch(
      `/v1/boards/${encodeURIComponent(board_id)}/members`,
      body,
    );
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_board_delete', descriptionFor('aimeat_board_delete'), zodShapeFor('aimeat_board_delete'), annotationsFor('aimeat_board_delete'), async ({ board_id }) => {
    const resp = await client.delete(`/v1/boards/${encodeURIComponent(board_id)}`);
    return envelopeResult(resp);
  });
}
