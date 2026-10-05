/**
 * @file mcp-proxy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registrations for the remote MCP servers a node connects OUT to —
 *   parity with the server MCP (src/mcp/mcp-proxy.ts), so `aimeat connect serve --surface agent`
 *   exposes the same five tools locally.
 *
 *   Thin proxies over the shared REST routes, so both surfaces behave identically and neither can
 *   drift into being the permissive one. The endpoint of a remote server never appears here either:
 *   this door names a slug and the node builds the request, exactly as the other two do.
 *
 *   There is a pleasing recursion in this file and it is worth naming so nobody "fixes" it: a local
 *   MCP server, serving tools that reach a remote MCP server, through a node in the middle. Every
 *   hop is the same protocol. Nothing here needs to know that.
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-09-16 — Phase 1 of the MCP proxy.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerMcpProxyTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  mcp.tool('aimeat_mcp_registry_set', descriptionFor('aimeat_mcp_registry_set'), zodShapeFor('aimeat_mcp_registry_set'), annotationsFor('aimeat_mcp_registry_set'), async ({ server, availability, allowlist, price, exposure, enabled }) => {
    // The REST door takes an id, and this door takes the slug an operator actually says. One
    // lookup here rather than a second listing route nobody else needs.
    const listed = await client.get('/v1/mcp-servers/node');
    const rows = ((listed.data as { servers?: { id: string; slug: string }[] } | undefined)?.servers) ?? [];
    const row = rows.find((s) => s.slug === server);
    if (!row) {
      return { content: [{ type: 'text' as const, text: `This node offers no server called "${server}".` }], isError: true };
    }
    return out(await client.patch(`/v1/mcp-servers/node/${encodeURIComponent(row.id)}`, {
      ...(availability ? { availability } : {}),
      ...(allowlist ? { allowlist } : {}),
      // Forwarded as sent: the route reads it through normalizeMcpPrice, so this door decides nothing.
      ...(price ? { price: { unit: 'money', ...price } } : {}),
      ...(exposure ? { exposure } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
    }));
  });

}
