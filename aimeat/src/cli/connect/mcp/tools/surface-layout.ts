/**
 * @file surface-layout.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registration for arranging this node's pages — parity with the server
 *   MCP (src/mcp/surface-layout.ts), so an agent served locally can do what the same agent can do
 *   over /v2/mcp.
 *
 *   A THIN PROXY, ON PURPOSE. Every refusal, the block validation and the passage rules live behind
 *   the HTTP routes; this door forwards and returns. The alternative is a second implementation of
 *   the same decisions, which is how one tool name came to mean two different backends here for
 *   months.
 * @structure registerSurfaceLayoutTools(mcp, registry)
 * @usage import { registerSurfaceLayoutTools } from './surface-layout.js';
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerSurfaceLayoutTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  mcp.tool('aimeat_surface_layout_get', descriptionFor('aimeat_surface_layout_get'), zodShapeFor('aimeat_surface_layout_get'), annotationsFor('aimeat_surface_layout_get'), async ({ surface }) => {
    // Two reads rather than one: the layout, and the catalogue of blocks this node can serve. The
    // second is the vocabulary, and without it the first write an AI attempts is always a refusal.
    const layout = await client.get(`/v1/site/layout/${encodeURIComponent(surface)}`);
    if (layout.ok === false) return out(layout);
    const blocks = await client.get(`/v1/site/blocks?surface=${encodeURIComponent(surface)}`);
    return out({ ok: true, data: { ...(layout.data as object), available_blocks: (blocks.data as { blocks?: unknown })?.blocks ?? [] } });
  });

  mcp.tool('aimeat_surface_layout_set', descriptionFor('aimeat_surface_layout_set'), zodShapeFor('aimeat_surface_layout_set'), annotationsFor('aimeat_surface_layout_set'), async ({ surface, blocks, note, ai_provenance, ai_provenance_id }) => {
    return out(await client.put(`/v1/site/layout/${encodeURIComponent(surface)}`, {
      v: 1, blocks,
      ...(note ? { meta: { note } } : {}),
      ...(ai_provenance ? { ai_provenance } : {}),
      ...(ai_provenance_id ? { ai_provenance_id } : {}),
    }));
  });
}
