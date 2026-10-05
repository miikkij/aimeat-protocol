/**
 * @file refinery.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registrations for the mail refinery, parity with the server MCP
 *   (src/mcp/refinery.ts). Thin proxies over /v1/refinery/*, so the scope checks and the batch are
 *   the node's on both surfaces.
 * @version-history
 *   v1.0.0 -- 2026-09-29 -- Initial (wish aimeat-refinery).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerRefineryTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  mcp.tool('aimeat_refinery_classes', descriptionFor('aimeat_refinery_classes'), zodShapeFor('aimeat_refinery_classes'),
    annotationsFor('aimeat_refinery_classes'),
    async () => out(await client.get('/v1/refinery/classes')));

  mcp.tool('aimeat_refinery_run', descriptionFor('aimeat_refinery_run'), zodShapeFor('aimeat_refinery_run'), annotationsFor('aimeat_refinery_run'), async ({ prefix, message_ids }) => out(
    await client.post('/v1/refinery/runs', { prefix, ...(message_ids ? { message_ids } : {}) }),
  ));

  mcp.tool('aimeat_refinery_status', descriptionFor('aimeat_refinery_status'), zodShapeFor('aimeat_refinery_status'), annotationsFor('aimeat_refinery_status'), async ({ run_id }) => out(
    await client.get(`/v1/refinery/runs/${encodeURIComponent(run_id)}`),
  ));
}
