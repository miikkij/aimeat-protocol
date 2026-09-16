/**
 * @file src/mcp/mcp-proxy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tools for the remote MCP servers this node connects OUT to.
 *
 *   THREE GATEWAY TOOLS, AND THE COUNT NEVER GROWS. list, tools, call — whether the owner attached
 *   one server or twenty. This node already publishes about 340 tools, and a proxy that spilled
 *   every remote tool into that list would make the list the problem. It is the same shape
 *   `aimeat_discover` + `aimeat_invoke` already argue for: twelve tools instead of three hundred,
 *   everything else found rather than carried. Flattening a chosen server into the list WITH its
 *   real schemas is phase 3, per server, because the owner knows which ones they use enough to
 *   spend the list space on.
 *
 *   THEY HOLD NO LOGIC OF THEIR OWN. Each calls the same service function the REST route calls, so
 *   the access check and the metering cannot answer differently on one door than on the other.
 *
 *   WHOSE SERVERS AN AGENT SEES, and this is a phase-1 decision worth stating plainly: an agent
 *   session reaches its OWNER's servers, gated by the `mcp:use` scope. That differs from
 *   connections, where an agent's mailbox is its own and it inherits nothing — and it differs on
 *   purpose. A connected mailbox is the most private thing on this node and an agent starting its
 *   own authorization is the right friction. A remote MCP server is a TOOL the person attached in
 *   order to be able to use it, and the whole point is that the AI they already talk to can reach
 *   it. So the grant is the scope, which the owner hands over deliberately at device authorization.
 *   Phase 2 narrows it further — per server, per tool, with budgets — and until then `mcp:use`
 *   means all of them, which is why it is the scope an owner should think about before granting.
 *
 *   `mcp:manage` is OUTSIDE the wildcard. Attaching a server to somebody's account is a human act:
 *   an agent holding "Full access" still cannot do it.
 * @structure registerMcpProxyTools(mcp, storage, config, agentGaii)
 * @usage registerMcpProxyTools(mcp, storage, config, () => agentGaii);
 * @version-history
 *   v1.0.0 — 2026-09-16 — Phase 1 of the MCP proxy.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import {
  attachMcpServer, listUsableServers, requireUsableServer, detachMcpServer,
} from '../services/mcp-client/registry.js';
import { callRemoteTool, listRemoteTools } from '../services/mcp-client/invoke.js';
import type { McpTransport, McpServerCredential } from '../models/mcp-server-schemas.js';

type TextResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

export function registerMcpProxyTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
): void {
  const ok = (obj: unknown): TextResult => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
  const fail = (msg: string): TextResult => ({ content: [{ type: 'text', text: msg }], isError: true });

  /** The human behind this session. An agent's servers are its owner's — see the file header. */
  const ownerGhii = (): string => ownerGhiiOf(getAgentGaii());

  const notFound = (name: string): TextResult => fail(
    // Absent and not-yours answer alike: naming another owner's server must not confirm it exists.
    `There is no server called "${name}" you can use. aimeat_mcp_list shows the ones you have.`,
  );

  // ── Using what is attached ──────────────────────────────────────────────────────────────────

  mcp.tool('aimeat_mcp_list', descriptionFor('aimeat_mcp_list'),
    {},
    annotationsFor('aimeat_mcp_list'),
    async (): Promise<TextResult> => ok({ servers: await listUsableServers(storage, ownerGhii()) }));

  mcp.tool('aimeat_mcp_tools', descriptionFor('aimeat_mcp_tools'),
    {
      server: z.string().describe("Which server, by the short name from aimeat_mcp_list (e.g. 'jira')."),
      refresh: z.boolean().optional()
        .describe('Ask the server again instead of using what was cached at the last look.'),
    },
    annotationsFor('aimeat_mcp_tools'),
    async ({ server, refresh }): Promise<TextResult> => {
      const row = await requireUsableServer(storage, ownerGhii(), server);
      if (!row) return notFound(server);

      // The cache is the normal answer. Asking the far side on every list would make this tool as
      // slow as the slowest thing anyone attached, and the cache is refreshed on attach, on a
      // timer, and whenever the server itself says its list changed.
      if (!refresh && row.toolCache.length) {
        return ok({ server: row.slug, tools: row.toolCache, listed_at: row.lastListedAt });
      }
      const listed = await listRemoteTools(storage, config, row);
      if (!listed.ok) return fail(listed.message);
      return ok({ server: row.slug, tools: listed.tools, listed_at: new Date().toISOString() });
    });

  mcp.tool('aimeat_mcp_call', descriptionFor('aimeat_mcp_call'),
    {
      server: z.string().describe("Which server, by the short name from aimeat_mcp_list."),
      tool: z.string().describe('Which of its tools, by the name aimeat_mcp_tools gave.'),
      arguments: z.record(z.string(), z.unknown()).optional()
        .describe('The arguments that tool asks for, in the shape its own schema names.'),
    },
    annotationsFor('aimeat_mcp_call'),
    async ({ server, tool, arguments: args }): Promise<TextResult> => {
      const row = await requireUsableServer(storage, ownerGhii(), server);
      if (!row) return notFound(server);

      const result = await callRemoteTool({
        storage, config, server: row, tool, args: args ?? {},
        caller: getAgentGaii(), callerKind: 'agent',
      });
      if (!result.ok) return fail(result.message);
      // isError is carried through rather than flattened: the far side's tool said no, and the
      // caller needs to see that as a refusal from the tool and not as a broken proxy.
      return {
        content: [{ type: 'text', text: JSON.stringify(result.content, null, 2) }],
        ...(result.isError ? { isError: true } : {}),
      };
    });

  // ── Attaching, which is a human act ─────────────────────────────────────────────────────────
  //
  // These two are gated on `mcp:manage` through TOOL_SCOPES, which createMcpServer applies to every
  // registration, so they are not offered to a session that cannot use them. NOT re-checked here:
  // the explicit guard in connections.ts exists because aimeat_mail_send needs TWO words at once
  // and that map holds one per tool. A second check for a single word would be a second answer to
  // a question already answered, and it hid these two from the surface audit when it was tried —
  // `mcp:manage` sits outside the wildcard, so the audit's `scopes: ['*']` did not carry it.

  mcp.tool('aimeat_mcp_attach', descriptionFor('aimeat_mcp_attach'),
    {
      name: z.string()
        .describe("A short name you will use instead of the address, e.g. 'jira'. Lowercase letters, digits and dashes."),
      url: z.string().describe('The server address, https.'),
      title: z.string().optional().describe('What to call it on screen. Defaults to the name.'),
      description: z.string().optional().describe('What it is for, in a sentence.'),
      transport: z.enum(['http', 'sse']).optional()
        .describe("How to speak to it. 'http' is the current transport and the default; 'sse' is the older one."),
      token: z.string().optional()
        .describe('A token or key the server needs. Held encrypted on this node and never given out again.'),
      header: z.string().optional()
        .describe("Which header the token belongs in, when the server does not take a bearer (e.g. 'X-API-Key')."),
    },
    annotationsFor('aimeat_mcp_attach'),
    async ({ name, url, title, description, transport, token, header }): Promise<TextResult> => {
      const t: McpTransport = {
        kind: transport === 'sse' ? 'sse' : 'http',
        url,
      };
      const credential: McpServerCredential | undefined = token
        ? { shape: 'static', accessToken: token, ...(header ? { headerName: header } : {}) }
        : undefined;

      const result = await attachMcpServer({
        storage, config,
        ownerGhii: ownerGhii(),
        createdBy: getAgentGaii(),
        slug: name,
        title: title ?? name,
        ...(description ? { description } : {}),
        transport: t,
        ...(credential ? { credential } : {}),
      });
      if (!result.ok) return fail(result.message);
      return ok({
        server: result.server,
        tools: result.tools,
        next: `Call them with aimeat_mcp_call, naming server "${result.server.slug}".`,
      });
    });

  mcp.tool('aimeat_mcp_detach', descriptionFor('aimeat_mcp_detach'),
    { server: z.string().describe('Which server, by its short name.') },
    annotationsFor('aimeat_mcp_detach'),
    async ({ server }): Promise<TextResult> => {
      const row = await requireUsableServer(storage, ownerGhii(), server);
      if (!row) return notFound(server);
      await detachMcpServer(storage, row);
      return ok({ removed: row.slug });
    });
}
