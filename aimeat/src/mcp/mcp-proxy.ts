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
 *   v1.1.0 — 2026-09-24 — aimeat_mcp_update, aimeat_mcp_authorize and aimeat_mcp_detach resolve the
 *     server through requireManageableServer, the question their REST twins ask: a node-wide server
 *     is used by the owners it admits and changed by none of them.
 *   v1.0.0 — 2026-09-16 — Phase 1 of the MCP proxy.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { toolError } from './tool-error.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import {
  attachMcpServer, attachOrganismServer, listUsableServers, requireUsableServer, detachMcpServer,
  updateMcpServerSettings, listNodeServers, setNodeServerPolicy, findNodeServer,
  requireManageableServer,
} from '../services/mcp-client/registry.js';
import { callRemoteTool, listRemoteTools } from '../services/mcp-client/invoke.js';
import { startMcpOAuth } from '../services/mcp-client/oauth.js';
import {
  listMcpGrants, putMcpGrant, removeMcpGrant, type McpGrant,
} from '../services/mcp-client/grants.js';
import { emitChange } from '../services/event-bus.js';
import { resolveOperatorName } from '../services/owner-lifecycle.js';
import {
  toPublicMcpServer, type McpTransport, type McpServerCredential,
} from '../models/mcp-server-schemas.js';

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

  /**
   * The server this session may CHANGE, the question the REST write doors ask. A node-wide server
   * shows in aimeat_mcp_list and is still not one of these, so the refusal says why in general terms.
   */
  const manageable = (name: string) => requireManageableServer(storage, ownerGhii(), name, config);
  const notManageable = (name: string): TextResult => toolError('NOT_FOUND',
    `There is no server called "${name}" that you can change. You can change or remove a server `
    + 'attached to your own account or to a group you run; one this node offers is changed by whoever runs the node.',
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
      url: z.string().optional().describe('The server address, https. Give this or peer.'),
      peer: z.string().optional()
        .describe('The id of a peer AIMEAT node, instead of url. Its address is looked up on every call, so the link follows the peering rather than outliving it. The peering must carry routing.'),
      organism_id: z.string().optional()
        .describe("Attach it to a GROUP instead of to this person, so the group's members reach it without anybody handing out a token. Only an owner or an admin of the group may; using what is attached needs only membership."),
      ws: z.string().optional()
        .describe("With organism_id, bind it to ONE workspace inside that group. Then the workspace's own roles decide: a contributor may call it, a viewer only sees it is there, and a member of the group with no role in that workspace reaches nothing."),
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
    async ({ name, url, peer, organism_id: group, ws, title, description, transport, token, header }): Promise<TextResult> => {
      if (!url && !peer) {
        return fail('Give either the server address, or the id of a peer node as peer.');
      }
      const t: McpTransport = peer
        ? { kind: 'aimeat', peerNodeId: peer }
        : { kind: transport === 'sse' ? 'sse' : 'http', url: url as string };
      const credential: McpServerCredential | undefined = token
        ? { shape: 'static', accessToken: token, ...(header ? { headerName: header } : {}) }
        : undefined;

      // A group server and a personal one are the same act with a different owner, so they share
      // one tool rather than growing a second. The authority check lives in the service, because
      // the answer depends on the organism record and every door would otherwise have to fetch it
      // and get the test right.
      const result = group
        ? await attachOrganismServer({
          storage, config,
          organismId: group,
          ...(ws ? { ws } : {}),
          // The bare owner name, because that is what an organism's rolls are compared against.
          callerName: ownerGhii().split('@')[0],
          createdBy: getAgentGaii(),
          slug: name,
          title: title ?? name,
          ...(description ? { description } : {}),
          transport: t,
          ...(credential ? { credential } : {}),
        })
        : await attachMcpServer({
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

  mcp.tool('aimeat_mcp_authorize', descriptionFor('aimeat_mcp_authorize'),
    {
      server: z.string().describe('Which server, by its short name.'),
      return_url: z.string().optional()
        .describe('A path on this node the browser lands on afterwards, e.g. /spa.html#access.'),
    },
    annotationsFor('aimeat_mcp_authorize'),
    async ({ server, return_url }): Promise<TextResult> => {
      // A sign-in writes the credential onto the row, so it is a change like the two tools below.
      const row = await manageable(server);
      if (!row) return notManageable(server);

      const started = await startMcpOAuth({
        storage, config, server: row, ownerGhii: ownerGhii(),
        ...(return_url ? { returnUrl: return_url } : {}),
      });
      if (!started.ok) return fail(started.message);
      // An empty address means the far side needed nobody: a client already registered with a
      // grant in place. Saying so beats handing an agent an address that goes nowhere.
      if (!started.authorizeUrl) {
        return ok({ server: row.slug, connected: true, note: 'That server needed nobody to sign in.' });
      }
      return ok({
        server: row.slug,
        authorize_url: started.authorizeUrl,
        next: 'Give this address to the PERSON and wait. Nothing here can approve it for them, and '
          + 'fetching it yourself does nothing. Say in one sentence what it is for.',
      });
    });

  mcp.tool('aimeat_mcp_update', descriptionFor('aimeat_mcp_update'),
    {
      server: z.string().describe('Which server, by its short name.'),
      enabled: z.boolean().optional()
        .describe('false switches it off at once without removing it; true switches it back on.'),
      title: z.string().optional().describe('What to call it on screen.'),
      description: z.string().optional().describe('What it is for, in a sentence.'),
      exposure: z.enum(['gateway', 'flatten']).optional()
        .describe("How its tools are reached: 'gateway' through aimeat_mcp_call, or 'flatten' listed one by one."),
    },
    annotationsFor('aimeat_mcp_update'),
    async ({ server, enabled, title, description, exposure }): Promise<TextResult> => {
      const row = await manageable(server);
      if (!row) return notManageable(server);

      // The same service the REST door calls, so neither can switch a server off in a way the
      // other does not: the pool invalidation and the live-update announcement live in there.
      const updated = await updateMcpServerSettings(storage, row, {
        ...(enabled !== undefined ? { enabled } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(exposure !== undefined ? { exposure } : {}),
      });
      return ok({ server: toPublicMcpServer(updated) });
    });

  // ── The operator's registry ──
  //
  // Self-gated at runtime on the OWNER record's operator role, the way every other operator tool
  // here does it (core-admin.ts). Not a scope word: an operator's own agent holding mcp:manage must
  // not be able to attach a server to the whole node in their name, and a scope cannot express
  // "this principal is the operator in person".

  mcp.tool('aimeat_mcp_registry_list', descriptionFor('aimeat_mcp_registry_list'),
    {},
    annotationsFor('aimeat_mcp_registry_list'),
    async (): Promise<TextResult> => {
      const operator = await resolveOperatorName(storage, getAgentGaii());
      if (!operator) return fail('Only whoever runs this node can see its registry.');
      const servers = await listNodeServers(storage);
      return ok({
        servers: servers.map((s) => ({
          ...toPublicMcpServer(s),
          availability: s.availability,
          allowlist: s.allowlist,
          price: s.price,
        })),
      });
    });

  mcp.tool('aimeat_mcp_registry_set', descriptionFor('aimeat_mcp_registry_set'),
    {
      server: z.string().describe("Which server on this node's registry, by its short name."),
      availability: z.enum(['all-owners', 'allowlist']).optional()
        .describe('Who may use it: everyone with an account here, or only the named owners.'),
      allowlist: z.array(z.string()).optional()
        .describe('The owners who may use it, when availability is allowlist. An empty list means nobody.'),
      // No `unit`: a price is money, and morsels are a pacer that buys nothing, so there is nothing
      // for an agent to choose between. Leaving the field out means a morsel price cannot be asked for.
      price: z.object({
        perCall: z.number(),
        currency: z.string().optional(),
      }).optional()
        .describe('What one call costs the caller, in money: perCall in whole micro-units (1000000 is one unit of the currency), and currency as ISO 4217, such as EUR. perCall 0 makes it free again.'),
      exposure: z.enum(['gateway', 'flatten']).optional()
        .describe("How its tools are reached: 'gateway' through aimeat_mcp_call, or 'flatten' listed one by one in every caller's own tool list."),
      enabled: z.boolean().optional().describe('false takes it away from everybody at once.'),
    },
    annotationsFor('aimeat_mcp_registry_set'),
    async ({ server, availability, allowlist, price, exposure, enabled }): Promise<TextResult> => {
      const operator = await resolveOperatorName(storage, getAgentGaii());
      if (!operator) return fail('Only whoever runs this node can change its registry.');

      const row = await findNodeServer(storage, server);
      if (!row) return fail(`This node offers no server called "${server}".`);

      // The same service the operator's REST door calls, so switching a server off cannot stop the
      // pool on one door and leave it answering on the other, and so the price is refused in one
      // place for both. A price of 0 reads as free, because that is how somebody says "free again".
      const set = await setNodeServerPolicy(storage, row, {
        ...(availability ? { availability } : {}),
        ...(allowlist ? { allowlist } : {}),
        ...(price ? { price: { unit: 'money', ...price } } : {}),
        ...(exposure ? { exposure } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
      });
      if (!set.ok) return fail(set.message);
      return ok({
        server: toPublicMcpServer(set.server),
        availability: set.server.availability,
        price: set.server.price,
      });
    });

  mcp.tool('aimeat_mcp_grant_list', descriptionFor('aimeat_mcp_grant_list'),
    { server: z.string().optional().describe('Only for this server, by its short name.') },
    annotationsFor('aimeat_mcp_grant_list'),
    async ({ server }): Promise<TextResult> =>
      ok({ grants: await listMcpGrants(storage, ownerGhii(), server) }));

  mcp.tool('aimeat_mcp_grant_set', descriptionFor('aimeat_mcp_grant_set'),
    {
      server: z.string().describe('Which server, by its short name.'),
      grantee: z.string()
        .describe("Who this is for: an agent's full name, an app as app:owner/file, or * for everything."),
      tools: z.union([z.literal('*'), z.array(z.string())])
        .describe("Which tools it may use: a list of names, or '*' for all of them."),
      locked_input: z.record(z.string(), z.unknown()).optional()
        .describe('Arguments it may not choose, e.g. {"project":"SUPPORT"}. These win over what it sends.'),
      call_cap: z.object({ count: z.number(), windowHours: z.number() }).optional()
        .describe('At most this many calls in this many hours.'),
      expires: z.string().optional().describe('An ISO date after which this stops applying.'),
    },
    annotationsFor('aimeat_mcp_grant_set'),
    async ({ server, grantee, tools, locked_input, call_cap, expires }): Promise<TextResult> => {
      const row = await requireUsableServer(storage, ownerGhii(), server);
      if (!row) return notFound(server);

      const grant: McpGrant = {
        type: 'aimeat:McpGrant',
        ownerGhii: ownerGhii(),
        server: row.slug,
        grantee,
        tools,
        ...(locked_input ? { lockedInput: locked_input } : {}),
        ...(call_cap ? { callCap: call_cap } : {}),
        expires: expires ?? null,
        grantedBy: getAgentGaii(),
        grantedAt: new Date().toISOString(),
      };
      await putMcpGrant(storage, grant);
      emitChange('mcp-servers', ownerGhii());
      return ok({ grant });
    });

  mcp.tool('aimeat_mcp_grant_revoke', descriptionFor('aimeat_mcp_grant_revoke'),
    {
      server: z.string().describe('Which server, by its short name.'),
      grantee: z.string().describe('Whose narrowing to remove.'),
    },
    annotationsFor('aimeat_mcp_grant_revoke'),
    async ({ server, grantee }): Promise<TextResult> => {
      const row = await requireUsableServer(storage, ownerGhii(), server);
      if (!row) return notFound(server);
      const removed = await removeMcpGrant(storage, ownerGhii(), row.slug, grantee);
      if (!removed) return fail(`There is no narrowing for "${grantee}" on "${row.slug}".`);
      emitChange('mcp-servers', ownerGhii());
      return ok({
        removed: grantee,
        note: 'That narrowing is gone. What this agent may do is decided by its permissions again.',
      });
    });

  mcp.tool('aimeat_mcp_detach', descriptionFor('aimeat_mcp_detach'),
    { server: z.string().describe('Which server, by its short name.') },
    annotationsFor('aimeat_mcp_detach'),
    async ({ server }): Promise<TextResult> => {
      const row = await manageable(server);
      if (!row) return notManageable(server);
      await detachMcpServer(storage, row);
      return ok({ removed: row.slug });
    });
}
