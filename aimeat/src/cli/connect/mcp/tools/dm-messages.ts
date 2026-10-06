/**
 * @file dm-messages.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP tools for the FEDERATED direct-message inbox ("Postilaatikko") — send a DM
 *   from the connected agent to anyone on the network, and read replies addressed to it. Thin proxies to
 *   the node REST API (POST /v1/messages, GET /v1/messages/agent-inbox|agent-thread). Distinct from the
 *   agent↔owner dashboard tools in agent-messages.ts. Mirrors the server MCP surface (src/mcp/dm-messages.ts).
 * @version-history
 *   2026-10-06 — aimeat_dm_send, _broadcast, _ask and _send_as_owner run their dispatch definition (secaudit 2026-10 follow-up, Part B).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.6.0 -- 2026-09-13 -- aimeat_dm_archive_as_owner / aimeat_dm_organize_as_owner: organising the
 *     owner's Messages list on messages:organize-as-owner, parity with the node MCP.
 *   v1.5.0 -- 2026-09-12 -- aimeat_dm_inbox_as_owner / aimeat_dm_thread_as_owner: the owner's own
 *     mailbox on messages:read-as-owner, parity with the node MCP.
 *   v1.4.0 -- 2026-09-06 -- aimeat_dm_broadcast: send-to-many in one call. Without it the only
 *     fan-out an agent had was a loop over aimeat_dm_send, which tags nothing and fills a list.
 *   v1.3.0 -- 2026-08-01 -- TARGET-058 Phase 11: dm_send / dm_ask / dm_send_as_owner carry
 *     `ai_provenance` / `ai_provenance_id` and echo what was recorded.
 *   v1.0.0 -- 2026-06-22 -- Initial: aimeat_dm_send / aimeat_dm_inbox / aimeat_dm_thread.
 *   v1.1.0 -- 2026-06-23 -- Add aimeat_dm_ask (structured federated AskUserQuestion) — connector parity.
 *   v1.2.0 -- 2026-07-19 -- Add aimeat_dm_send_as_owner — the shell path sends via POST /v1/messages as the
 *     connected principal (there is no send-as-owner REST route; the server MCP tool remains the way to
 *     speak strictly as the owner from an agent).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerDmMessagesTools(mcp: McpServer, registry: AgentRegistry): void {

  // The agent tells its own owner something: POST /v1/notifications as the connected principal,
  // parameter for parameter with the server tool (src/mcp/notify.ts).
  mcp.tool('aimeat_notify', descriptionFor('aimeat_notify'), zodShapeFor('aimeat_notify'), annotationsFor('aimeat_notify'), async ({ title, body, link, type }) => {
    const { client } = registry.resolve();
    const resp = await client.post('/v1/notifications', { title, body, link, type });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) };
  });

}
