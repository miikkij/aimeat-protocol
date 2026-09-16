/**
 * @file remote-mcp-source.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The tools on attached MCP servers, in the directory that answers "what exists here
 *   that I can use?".
 *
 *   WHY IT BELONGS THERE. `discover` can already find an app's tools, a published capability and
 *   the node's own 340. Without this it could not find the one thing the person actually attached
 *   for their AI to use — so an agent had to be TOLD the server existed before it could look at it,
 *   which is the exact problem a directory removes. With it, "is there anything here that can read
 *   Jira" is a question with an answer.
 *
 *   ONE ENTRY PER TOOL, NOT PER SERVER. A server is a container; a tool is the thing somebody is
 *   looking for. Searching for "issue" should find `create_issue` on the server called `jira`, not
 *   a server whose description happens to mention issues.
 *
 *   THE ENUMERATION IS THE GATE. The node's own catalogue is `gating: none` because the same list is
 *   true for everybody and is already public. This list is NOT: which servers somebody attached is a
 *   fact about them, and a stranger learning that this account has a Jira has learned something. It
 *   is still `none`, because the gating vocabulary is visibility / workspace / consent and this
 *   question is none of the three — so the access rule runs INSIDE enumerate(), through the same
 *   requireUsableServer every other door uses, and what comes out is only what the caller could
 *   already call. A `public` or `shared` scope answers nothing at all.
 *
 *   THE ENDPOINT IS NOWHERE IN AN ENTRY, for the reason it is nowhere in a response: a caller that
 *   learns the address can call it directly and leave every gate behind. `href` points at this
 *   node's own tool listing for that server.
 * @structure createRemoteMcpSource(storage, config) → DiscoverySource
 * @usage registry.register(createRemoteMcpSource(storage, config));
 * @version-history
 *   v1.0.0 — 2026-09-16 — Phase 6 of the MCP proxy.
 */
import type { DiscoveryContext, DiscoveryEntry, DiscoverySource, RawHit } from '../types.js';
import type { Storage } from '../../../storage/interface.js';
import type { AimeatConfig } from '../../../config.js';
import type { McpServerRecord, RemoteToolSnapshot } from '../../../models/mcp-server-schemas.js';
import { listUsableServers, requireUsableServer } from '../../mcp-client/registry.js';
import { logger } from '../../../utils/logger.js';

export const REMOTE_MCP_SOURCE_ID = 'remote-mcp';
const MAX_LIMIT = 100;

/** One tool on one server, as the directory carries it. */
interface RemoteToolHit {
  server: McpServerRecord;
  tool: RemoteToolSnapshot;
}

export function createRemoteMcpSource(storage: Storage, config: AimeatConfig): DiscoverySource {
  return {
    id: REMOTE_MCP_SOURCE_ID,
    // THE ENUMERATION IS THE GATE, which is why this is 'none' and not a lie. The vocabulary here
    // is visibility / workspace / consent, and "which servers this person may reach" is none of
    // those three: it is their own attachments, plus what the operator admits them to, plus their
    // groups'. That question is answered by requireUsableServer, so enumerate() returns only what
    // the caller could already call and there is nothing left for a later filter to remove.
    gating: 'none',

    async enumerate(ctx: DiscoveryContext): Promise<RawHit[]> {
      // `public` and `shared` mean somebody else's things, and nobody else's attached servers are
      // ever anybody's to see. Answering nothing is the whole content of that rule.
      if (ctx.scope !== 'own') return [];

      const limit = Math.min(ctx.filters.limit ?? 20, MAX_LIMIT);
      const q = (ctx.filters.q ?? '').trim().toLowerCase();

      let reachable;
      try {
        reachable = await listUsableServers(storage, ctx.caller.gaii, config);
      } catch (err) {
        // A directory that cannot read one source answers with the others. Discovery is the place
        // somebody goes when they do not know what exists; failing the whole question because one
        // source is unwell is the wrong trade.
        logger.warn('remote-mcp-source: the attached servers could not be listed', {
          caller: ctx.caller.gaii, error: String(err),
        });
        return [];
      }

      const hits: RawHit[] = [];
      for (const pub of reachable) {
        if (hits.length >= limit) break;
        // listUsableServers returns the PUBLIC projection, which deliberately holds no tool list.
        // requireUsableServer re-resolves the row through the same access rule, so this loop cannot
        // see a server the listing would not have shown.
        const server = await requireUsableServer(storage, ctx.caller.gaii, pub.id, config);
        if (!server || !server.enabled || server.status !== 'active') continue;

        for (const tool of server.toolCache) {
          if (hits.length >= limit) break;
          if (q && !`${tool.name} ${tool.description} ${server.slug} ${server.title}`
            .toLowerCase().includes(q)) continue;
          hits.push({
            sourceId: REMOTE_MCP_SOURCE_ID,
            record: { server, tool } satisfies RemoteToolHit,
            // An exact name match ranks above a description mention, which is what somebody
            // searching for a tool by name expects.
            score: q && tool.name.toLowerCase().includes(q) ? 2 : 1,
          });
        }
      }
      return hits;
    },

    toEntry(raw: RawHit, ctx: DiscoveryContext): DiscoveryEntry {
      const { server, tool } = raw.record as RemoteToolHit;
      return {
        type: 'capability',
        // The server's own name, so a caller can filter to one of them. Not a curated vocabulary:
        // the segment is whatever the owner called the server.
        segment: server.slug,
        // The name a caller actually uses, whichever way they reach it: `aimeat_mcp_call` takes
        // these two apart, and a flattened tool is registered under exactly this string.
        id: `${server.slug}__${tool.name}`,
        title: `${tool.name} (${server.title || server.slug})`,
        description: tool.description,
        tags: [
          'mcp-server',
          `server:${server.slug}`,
          // Where it came from, because "this is not on this node" changes what a caller should
          // expect: another party's uptime, another party's rules.
          server.ownership === 'node' ? 'offered-by-this-node'
            : server.ownership === 'organism' ? 'offered-by-a-group' : 'attached-by-you',
          ...(server.ownership === 'node' && server.price ? ['costs-morsels'] : []),
        ],
        // Never public. The entry exists only inside the reach that produced it.
        visibility: 'private',
        owner: server.ownerGhii ?? `node@${ctx.nodeId}`,
        node: ctx.nodeId,
        score: raw.score ?? 0,
        // When this node last learned what the server offers. A real time, unlike the node's own
        // catalogue, because a remote tool list genuinely changes between releases.
        updatedAt: server.lastListedAt ?? server.updatedAt,
        // THIS node's listing for that server, never the far side's address.
        href: `/v1/mcp-servers/${encodeURIComponent(server.slug)}/tools`,
      };
    },
  };
}
