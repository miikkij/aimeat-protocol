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
 * @structure registerMcpProxyTools(mcp, storage, config, agentGaii, scopes)
 * @usage registerMcpProxyTools(mcp, storage, config, () => agentGaii, scopes);
 * @version-history
 *   v1.4.0 — 2026-10-09 — aimeat_mcp_authorize hands back the node's confirmation page, where the
 *     owner confirms the sign-in in their own browser, never the far side's address (secrets audit
 *     2026-10-09, chapter 2).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.3.1 — 2026-09-26 — Attaching to a group hands the service the owner GHII, not a name cut from it,
 *     the same identity POST /v1/mcp-servers/organism hands it (secaudit 2026-09, a0ecb62eafb3).
 *   v1.3.0 — 2026-09-24 — SECURITY (audit A8-1): the registry pair asks the operator:admin word as
 *     well as the account (services/owner-lifecycle.ts resolveOperatorAgentName). The account alone
 *     let any agent of the operator switch a node-wide server off for everybody.
 *   v1.2.0 — 2026-09-24 — Takes the session's scopes, and aimeat_mcp_call hands them to the
 *     chokepoint, which no longer reads a missing list as mcp:use.
 *   v1.1.0 — 2026-09-24 — aimeat_mcp_update, aimeat_mcp_authorize and aimeat_mcp_detach resolve the
 *     server through requireManageableServer, the question their REST twins ask: a node-wide server
 *     is used by the owners it admits and changed by none of them.
 *   v1.0.0 — 2026-09-16 — Phase 1 of the MCP proxy.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
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
import { resolveOperatorAgentName, OPERATOR_AGENT_REFUSAL } from '../services/owner-lifecycle.js';
import {
  toPublicMcpServer, type McpTransport, type McpServerCredential,
} from '../models/mcp-server-schemas.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';

type TextResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

export function registerMcpProxyTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
  /** What this session holds. aimeat_mcp_call hands it to the chokepoint, which assumes nothing, and
   *  the registry pair asks operator:admin of it at call time. */
  scopes: string[],
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
    zodShapeFor('aimeat_mcp_list'),
    annotationsFor('aimeat_mcp_list'),
    async (): Promise<TextResult> => ok({ servers: await listUsableServers(storage, ownerGhii()) }));

  mcp.tool('aimeat_mcp_tools', descriptionFor('aimeat_mcp_tools'),
    zodShapeFor('aimeat_mcp_tools'),
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
    zodShapeFor('aimeat_mcp_call'),
    annotationsFor('aimeat_mcp_call'),
    async ({ server, tool, arguments: args }): Promise<TextResult> => {
      const row = await requireUsableServer(storage, ownerGhii(), server);
      if (!row) return notFound(server);

      const result = await callRemoteTool({
        storage, config, server: row, tool, args: args ?? {},
        caller: getAgentGaii(), callerKind: 'agent', scopes,
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
    zodShapeFor('aimeat_mcp_attach'),
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
          // The owner GHII, which the organism's rolls are compared against whole, as the REST twin does.
          callerGhii: ownerGhii(),
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
    zodShapeFor('aimeat_mcp_authorize'),
    annotationsFor('aimeat_mcp_authorize'),
    async ({ server, return_url }): Promise<TextResult> => {
      // A sign-in writes the credential onto the row, so it is a change like the two tools below.
      const row = await manageable(server);
      if (!row) return notManageable(server);

      const started = await startMcpOAuth({
        storage, config, server: row, ownerGhii: ownerGhii(),
        startedBy: getAgentGaii(),
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
        // The node's confirmation page, never the far side's address: the round waits until the
        // owner signs in there and confirms it in their own browser (secrets audit 2026-10-09).
        authorize_url: started.approvalUrl,
        owner_confirms: true,
        next: 'Give this address to your owner and wait. They sign in to this node, confirm, and sign in at '
          + 'the server; nothing here can approve it for them, and fetching it yourself does nothing. '
          + 'Say in one sentence what it is for.',
      });
    });

  mcp.tool('aimeat_mcp_update', descriptionFor('aimeat_mcp_update'),
    zodShapeFor('aimeat_mcp_update'),
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
  // Asked at runtime of the OWNER record's operator role AND of the operator:admin word, the way
  // every other operator tool asks it (services/owner-lifecycle.ts resolveOperatorAgentName). The
  // word is not mcp:manage: an operator's agent that may attach a server to its owner's account must
  // not thereby control what the whole node offers, and the role alone armed every agent the
  // operator connected (security audit A8-1).

  mcp.tool('aimeat_mcp_registry_list', descriptionFor('aimeat_mcp_registry_list'),
    zodShapeFor('aimeat_mcp_registry_list'),
    annotationsFor('aimeat_mcp_registry_list'),
    async (): Promise<TextResult> => {
      const operator = await resolveOperatorAgentName(storage, getAgentGaii(), scopes);
      if (!operator) return fail(OPERATOR_AGENT_REFUSAL);
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
    zodShapeFor('aimeat_mcp_registry_set'),
    annotationsFor('aimeat_mcp_registry_set'),
    async ({ server, availability, allowlist, price, exposure, enabled }): Promise<TextResult> => {
      const operator = await resolveOperatorAgentName(storage, getAgentGaii(), scopes);
      if (!operator) return fail(OPERATOR_AGENT_REFUSAL);

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
    zodShapeFor('aimeat_mcp_grant_list'),
    annotationsFor('aimeat_mcp_grant_list'),
    async ({ server }): Promise<TextResult> =>
      ok({ grants: await listMcpGrants(storage, ownerGhii(), server) }));

  mcp.tool('aimeat_mcp_grant_set', descriptionFor('aimeat_mcp_grant_set'),
    zodShapeFor('aimeat_mcp_grant_set'),
    annotationsFor('aimeat_mcp_grant_set'),
    async ({ server, grantee, tools, locked_input, call_cap, expires, read_only }): Promise<TextResult> => {
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
        ...(read_only === true ? { readOnly: true } : {}),
        expires: expires ?? null,
        grantedBy: getAgentGaii(),
        grantedAt: new Date().toISOString(),
      };
      await putMcpGrant(storage, grant);
      emitChange('mcp-servers', ownerGhii());
      return ok({ grant });
    });

  mcp.tool('aimeat_mcp_grant_revoke', descriptionFor('aimeat_mcp_grant_revoke'),
    zodShapeFor('aimeat_mcp_grant_revoke'),
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
    zodShapeFor('aimeat_mcp_detach'),
    annotationsFor('aimeat_mcp_detach'),
    async ({ server }): Promise<TextResult> => {
      const row = await manageable(server);
      if (!row) return notManageable(server);
      await detachMcpServer(storage, row);
      return ok({ removed: row.slug });
    });
}
