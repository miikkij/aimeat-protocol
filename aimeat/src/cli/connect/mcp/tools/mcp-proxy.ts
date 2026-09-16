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
    url: z.string().describe('The server address, https.'),
    title: z.string().optional().describe('What to call it on screen.'),
    description: z.string().optional().describe('What it is for, in a sentence.'),
    transport: z.enum(['http', 'sse']).optional().describe("'http' is the current transport and the default."),
    token: z.string().optional().describe('A token the server needs. Held encrypted on the node.'),
    header: z.string().optional().describe("Which header the token belongs in, when not a bearer."),
  }, annotationsFor('aimeat_mcp_attach'), async ({ name, url, title, description, transport, token, header }) => out(
    await client.post('/v1/mcp-servers', {
      name, url,
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(transport ? { transport } : {}),
      ...(token ? { token } : {}),
      ...(header ? { header } : {}),
    }),
  ));

  mcp.tool('aimeat_mcp_detach', descriptionFor('aimeat_mcp_detach'), {
    server: z.string().describe('Which server, by its short name.'),
  }, annotationsFor('aimeat_mcp_detach'), async ({ server }) => out(
    await client.delete(path(server)),
  ));
}
