/**
 * @file node-capabilities-source.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's OWN capabilities in the directory that answers "what exists here that I
 *   can use?" — the half that was missing.
 *
 *   Until now `discover` could find an app's tools, a published capability, a workflow and a
 *   document, and could not find `aimeat_memory_write`. An agent that wanted to know how to do
 *   something on this node had to already have all 297 tool descriptions in its context, which is
 *   the exact problem the directory exists to remove. So the node's own capabilities are entries
 *   like everything else, and `invoke` runs the one you found.
 *
 *   TYPE `capability`, SEGMENT BY FAMILY. Not a new discovery type: a node capability IS a
 *   capability, and the vocabulary is carried in four separate lists that all have to learn a new
 *   word (see types.ts). The segment — `memory`, `task`, `workspace` — is what a caller filters on,
 *   and it comes from the id rather than from a curated table.
 *
 *   GATING IS `none`, AND THAT IS CORRECT. The catalogue is a description of what this node can do,
 *   not of what any account holds: the same list is true for everybody, it is already public in
 *   `/v1/spec` and in every MCP tool listing, and knowing that `aimeat_memory_write` exists gives
 *   nobody access to anything. The gate that matters is on the CALL, and `invoke` runs it with the
 *   caller's own credential through the real route.
 *
 * @structure createNodeCapabilitiesSource() → DiscoverySource
 * @usage registry.register(createNodeCapabilitiesSource());
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V2: discover + invoke).
 */
import type { DiscoveryContext, DiscoveryEntry, DiscoverySource, RawHit } from '../types.js';
import { searchNodeCapabilities, type NodeCapability } from '../../node-capabilities.js';

export const NODE_CAPABILITIES_SOURCE_ID = 'node-capabilities';
const MAX_LIMIT = 100;

export function createNodeCapabilitiesSource(): DiscoverySource {
  return {
    id: NODE_CAPABILITIES_SOURCE_ID,
    gating: 'none',

    async enumerate(ctx: DiscoveryContext): Promise<RawHit[]> {
      // Every scope. In `own` these are as much "what I can use" as the caller's own records are —
      // more so, since a fresh account has no records and still needs to find out what it can do.
      const limit = Math.min(ctx.filters.limit ?? 20, MAX_LIMIT);
      // A segment filter that names something else entirely (`app`, `knowledge`) must return
      // nothing rather than everything, so it is passed through and matched exactly.
      const segment = ctx.filters.segments?.length === 1 ? ctx.filters.segments[0] : undefined;
      if (ctx.filters.segments?.length && !segment) return [];
      const hits = searchNodeCapabilities(ctx.filters.q, segment, limit);
      // Rank descends with position, so the directory's own sort keeps the search's order instead of
      // flattening every capability to the same score and re-sorting them by name.
      return hits.map((record, i) => ({ sourceId: NODE_CAPABILITIES_SOURCE_ID, record, score: hits.length - i }));
    },

    toEntry(raw: RawHit, ctx: DiscoveryContext): DiscoveryEntry {
      const cap = raw.record as NodeCapability;
      return {
        type: 'capability',
        segment: cap.segment,
        id: cap.id,
        title: cap.title,
        description: cap.description,
        // What a caller needs before deciding: that this one runs here and now, who it is for, and
        // whether it will ask for anything.
        tags: ['node', `caller:${cap.caller}`, ...(cap.required.length ? ['needs-input'] : [])],
        visibility: 'public',
        // The node itself offers these, not any account. An owner field naming a person would be a
        // claim nobody made.
        owner: `node@${ctx.nodeId}`,
        node: ctx.nodeId,
        score: raw.score ?? 0,
        // The catalogue is static between releases; the build's own date would be a better answer
        // and this layer does not have one, so the epoch says "not a record with a history".
        updatedAt: new Date(0).toISOString(),
        // Where to READ the contract. Running it is POST /v1/invoke with this id.
        href: `/v1/capabilities/node/${encodeURIComponent(cap.id)}`,
      };
    },
  };
}
