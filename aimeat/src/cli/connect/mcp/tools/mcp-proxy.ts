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
 *   v1.0.0 — 2026-09-16 — Phase 1 of the MCP proxy.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerMcpProxyTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  const path = (server: string, suffix = '') =>
    `/v1/mcp-servers/${encodeURIComponent(server)}${suffix}`;

  mcp.tool('aimeat_mcp_list', descriptionFor('aimeat_mcp_list'), {},
    annotationsFor('aimeat_mcp_list'),
    async () => out(await client.get('/v1/mcp-servers')));

  mcp.tool('aimeat_mcp_tools', descriptionFor('aimeat_mcp_tools'), {
    server: z.string().describe("Which server, by the short name from aimeat_mcp_list (e.g. 'jira')."),
    refresh: z.boolean().optional().describe('Ask the server again instead of using what was cached.'),
  }, annotationsFor('aimeat_mcp_tools'), async ({ server, refresh }) => out(
    await client.get(path(server, '/tools') + (refresh ? '?refresh=1' : '')),
  ));

  mcp.tool('aimeat_mcp_call', descriptionFor('aimeat_mcp_call'), {
    server: z.string().describe('Which server, by the short name from aimeat_mcp_list.'),
    tool: z.string().describe('Which of its tools, by the name aimeat_mcp_tools gave.'),
    arguments: z.record(z.string(), z.unknown()).optional()
      .describe("The arguments that tool asks for, in the shape its own schema names."),
  }, annotationsFor('aimeat_mcp_call'), async ({ server, tool, arguments: args }) => out(
    await client.post(path(server, '/call'), { tool, arguments: args ?? {} }),
  ));

  mcp.tool('aimeat_mcp_attach', descriptionFor('aimeat_mcp_attach'), {
    name: z.string().describe("A short name used instead of the address, e.g. 'jira'."),
    url: z.string().optional().describe('The server address, https. Give this or peer.'),
    peer: z.string().optional().describe('The id of a peer AIMEAT node, instead of url.'),
    group: z.string().optional().describe("Attach it to a GROUP instead of to this person."),
    ws: z.string().optional().describe('With group, bind it to one workspace inside that group.'),
    title: z.string().optional().describe('What to call it on screen.'),
    description: z.string().optional().describe('What it is for, in a sentence.'),
    transport: z.enum(['http', 'sse']).optional().describe("'http' is the current transport and the default."),
    token: z.string().optional().describe('A token the server needs. Held encrypted on the node.'),
    header: z.string().optional().describe("Which header the token belongs in, when not a bearer."),
  }, annotationsFor('aimeat_mcp_attach'), async ({ name, url, peer, group, ws, title, description, transport, token, header }) => {
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

  mcp.tool('aimeat_mcp_authorize', descriptionFor('aimeat_mcp_authorize'), {
    server: z.string().describe('Which server, by its short name.'),
    return_url: z.string().optional().describe('A path on this node the browser lands on afterwards.'),
  }, annotationsFor('aimeat_mcp_authorize'), async ({ server, return_url }) => out(
    await client.post(path(server, '/authorize'), {
      ...(return_url ? { return_url } : {}),
    }),
  ));

  mcp.tool('aimeat_mcp_update', descriptionFor('aimeat_mcp_update'), {
    server: z.string().describe('Which server, by its short name.'),
    enabled: z.boolean().optional().describe('false switches it off at once; true switches it back on.'),
    title: z.string().optional().describe('What to call it on screen.'),
    description: z.string().optional().describe('What it is for, in a sentence.'),
    exposure: z.enum(['gateway', 'flatten']).optional().describe('How its tools are reached.'),
  }, annotationsFor('aimeat_mcp_update'), async ({ server, enabled, title, description, exposure }) => out(
    await client.patch(path(server), {
      ...(enabled !== undefined ? { enabled } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(exposure !== undefined ? { exposure } : {}),
    }),
  ));

  mcp.tool('aimeat_mcp_registry_list', descriptionFor('aimeat_mcp_registry_list'), {},
    annotationsFor('aimeat_mcp_registry_list'),
    async () => out(await client.get('/v1/mcp-servers/node')));

  mcp.tool('aimeat_mcp_registry_set', descriptionFor('aimeat_mcp_registry_set'), {
    server: z.string().describe("Which server on this node's registry, by its short name."),
    availability: z.enum(['all-owners', 'allowlist']).optional(),
    allowlist: z.array(z.string()).optional(),
    price: z.object({
      unit: z.enum(['morsels', 'money']),
      perCall: z.number(),
      currency: z.string().optional(),
    }).optional(),
    exposure: z.enum(['gateway', 'flatten']).optional(),
    enabled: z.boolean().optional(),
  }, annotationsFor('aimeat_mcp_registry_set'), async ({ server, availability, allowlist, price, exposure, enabled }) => {
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
      ...(price ? { price: price.perCall > 0 ? price : null } : {}),
      ...(exposure ? { exposure } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
    }));
  });

  mcp.tool('aimeat_mcp_grant_list', descriptionFor('aimeat_mcp_grant_list'), {
    server: z.string().optional().describe('Only for this server, by its short name.'),
  }, annotationsFor('aimeat_mcp_grant_list'), async ({ server }) => out(
    await client.get('/v1/mcp-servers/grants' + (server ? `?server=${encodeURIComponent(server)}` : '')),
  ));

  mcp.tool('aimeat_mcp_grant_set', descriptionFor('aimeat_mcp_grant_set'), {
    server: z.string().describe('Which server, by its short name.'),
    grantee: z.string().describe("An agent's full name, an app as app:owner/file, or *."),
    tools: z.union([z.literal('*'), z.array(z.string())]).describe("Tool names, or '*'."),
    locked_input: z.record(z.string(), z.unknown()).optional().describe('Arguments it may not choose.'),
    call_cap: z.object({ count: z.number(), windowHours: z.number() }).optional(),
    expires: z.string().optional(),
  }, annotationsFor('aimeat_mcp_grant_set'), async ({ server, grantee, tools, locked_input, call_cap, expires }) => out(
    await client.put(path(server, '/grants'), {
      grantee, tools,
      ...(locked_input ? { locked_input } : {}),
      ...(call_cap ? { call_cap } : {}),
      ...(expires ? { expires } : {}),
    }),
  ));

  mcp.tool('aimeat_mcp_grant_revoke', descriptionFor('aimeat_mcp_grant_revoke'), {
    server: z.string().describe('Which server, by its short name.'),
    grantee: z.string().describe('Whose narrowing to remove.'),
  }, annotationsFor('aimeat_mcp_grant_revoke'), async ({ server, grantee }) => out(
    await client.delete(path(server, `/grants/${encodeURIComponent(grantee)}`)),
  ));

  mcp.tool('aimeat_mcp_detach', descriptionFor('aimeat_mcp_detach'), {
    server: z.string().describe('Which server, by its short name.'),
  }, annotationsFor('aimeat_mcp_detach'), async ({ server }) => out(
    await client.delete(path(server)),
  ));
}
