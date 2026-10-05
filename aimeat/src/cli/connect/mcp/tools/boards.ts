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
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerBoardsTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_board_reply', descriptionFor('aimeat_board_reply'), zodShapeFor('aimeat_board_reply'), annotationsFor('aimeat_board_reply'), async ({ board_id, post_id, body, ai_provenance, ai_provenance_id }) => {
    const resp = await client.post(
      `/v1/boards/${encodeURIComponent(board_id)}/posts/${encodeURIComponent(post_id)}/replies`,
      { body },
    );
    return provenanceEchoedResult(client,
      { tool: 'aimeat_board_reply', declared: ai_provenance, declaredId: ai_provenance_id }, resp);
  });

}
