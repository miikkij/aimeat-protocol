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

  mcp.tool('aimeat_mcp_list', descriptionFor('aimeat_mcp_list'), zodShapeFor('aimeat_mcp_list'),
    annotationsFor('aimeat_mcp_list'),
    async () => out(await client.get('/v1/mcp-servers')));

  mcp.tool('aimeat_mcp_tools', descriptionFor('aimeat_mcp_tools'), zodShapeFor('aimeat_mcp_tools'), annotationsFor('aimeat_mcp_tools'), async ({ server, refresh }) => out(
    await client.get(`/v1/mcp-servers/${encodeURIComponent(server)}/tools${refresh ? '?refresh=1' : ''}`),
  ));

  mcp.tool('aimeat_mcp_call', descriptionFor('aimeat_mcp_call'), zodShapeFor('aimeat_mcp_call'), annotationsFor('aimeat_mcp_call'), async ({ server, tool, arguments: args }) => out(
    await client.post(`/v1/mcp-servers/${encodeURIComponent(server)}/call`, { tool, arguments: args ?? {} }),
  ));

  mcp.tool('aimeat_mcp_attach', descriptionFor('aimeat_mcp_attach'), zodShapeFor('aimeat_mcp_attach'), annotationsFor('aimeat_mcp_attach'), async ({ name, url, peer, organism_id: group, ws, title, description, transport, token, header }) => {
    const body = {
      name,
      ...(url ? { url } : {}),
      ...(peer ? { peer } : {}),
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(transport ? { transport } : {}),
      ...(token ? { token } : {}),
      ...(header ? { header } : {}),
    };
    // Two doors, one tool: a group server is the same act with a different owner. The two paths are
    // written out as LITERALS rather than picked with a ternary, because check:field-reach matches a
    // tool to its route by the path it calls, and a computed path matches nothing. A ternary here
    // cost BOTH doors their twin on 2026-09-16, including the one that already had one.
    return out(group
      ? await client.post('/v1/mcp-servers/organism', { ...body, organism_id: group, ...(ws ? { ws } : {}) })
      : await client.post('/v1/mcp-servers', body));
  });

  mcp.tool('aimeat_mcp_authorize', descriptionFor('aimeat_mcp_authorize'), zodShapeFor('aimeat_mcp_authorize'), annotationsFor('aimeat_mcp_authorize'), async ({ server, return_url }) => out(
    await client.post(`/v1/mcp-servers/${encodeURIComponent(server)}/authorize`, {
      ...(return_url ? { return_url } : {}),
    }),
  ));

  mcp.tool('aimeat_mcp_update', descriptionFor('aimeat_mcp_update'), zodShapeFor('aimeat_mcp_update'), annotationsFor('aimeat_mcp_update'), async ({ server, enabled, title, description, exposure }) => out(
    await client.patch(`/v1/mcp-servers/${encodeURIComponent(server)}`, {
      ...(enabled !== undefined ? { enabled } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(exposure !== undefined ? { exposure } : {}),
    }),
  ));

  mcp.tool('aimeat_mcp_registry_list', descriptionFor('aimeat_mcp_registry_list'), zodShapeFor('aimeat_mcp_registry_list'),
    annotationsFor('aimeat_mcp_registry_list'),
    async () => out(await client.get('/v1/mcp-servers/node')));

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

  mcp.tool('aimeat_mcp_grant_list', descriptionFor('aimeat_mcp_grant_list'), zodShapeFor('aimeat_mcp_grant_list'), annotationsFor('aimeat_mcp_grant_list'), async ({ server }) => out(
    await client.get('/v1/mcp-servers/grants' + (server ? `?server=${encodeURIComponent(server)}` : '')),
  ));

  mcp.tool('aimeat_mcp_grant_set', descriptionFor('aimeat_mcp_grant_set'), zodShapeFor('aimeat_mcp_grant_set'), annotationsFor('aimeat_mcp_grant_set'), async ({ server, grantee, tools, locked_input, call_cap, expires }) => out(
    await client.put(`/v1/mcp-servers/${encodeURIComponent(server)}/grants`, {
      grantee, tools,
      ...(locked_input ? { locked_input } : {}),
      ...(call_cap ? { call_cap } : {}),
      ...(expires ? { expires } : {}),
    }),
  ));

  mcp.tool('aimeat_mcp_grant_revoke', descriptionFor('aimeat_mcp_grant_revoke'), zodShapeFor('aimeat_mcp_grant_revoke'), annotationsFor('aimeat_mcp_grant_revoke'), async ({ server, grantee }) => out(
    await client.delete(`/v1/mcp-servers/${encodeURIComponent(server)}/grants/${encodeURIComponent(grantee)}`),
  ));

  mcp.tool('aimeat_mcp_detach', descriptionFor('aimeat_mcp_detach'), zodShapeFor('aimeat_mcp_detach'), annotationsFor('aimeat_mcp_detach'), async ({ server }) => out(
    await client.delete(`/v1/mcp-servers/${encodeURIComponent(server)}`),
  ));
}
