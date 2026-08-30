/**
 * @file app-tools-source.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `tool` discovery source — an app's published tools, ONE ENTRY PER TOOL, in the
 *   directory that answers "what exists here that I can use?".
 *
 *   WHY PER TOOL AND NOT PER APP. The record is one manifest per app (`apps.{appId}.tools`), and
 *   surfacing the manifest would put a row in the directory that nobody searches for: a person
 *   looking for "probability" wants the tool, not the file that lists it. So the manifest is
 *   expanded here, and the id carries both halves — `owner/appId#tool` — which is also the address
 *   a caller needs to invoke it.
 *
 *   WHY IT IS A SOURCE AND NOT ONLY A CLASSIFIER PATTERN. Until now the manifest reached the
 *   directory anyway, through the memory source, as an untyped `memory` record whose description was
 *   its own JSON. A key pattern alone would have typed that one row correctly and still listed one
 *   row for a manifest holding ten tools. The memory source now leaves these keys to this source,
 *   the way it already leaves template.catalog.* to the templates source.
 *
 *   ONE SCANNER. The scan is commerce/app-tool-catalog.ts, which already feeds the ACP product feed,
 *   GET /v1/commerce/tools and the MCP Server Card. It is called here with `pricedOnly: false`,
 *   because a free tool is still a thing a person can use and this directory is about use, not
 *   sale. A second scan would be the drift that file was written to prevent.
 * @structure createAppToolsSource(storage, config) → DiscoverySource
 * @usage registry.register(createAppToolsSource(storage, config));
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial: `tool` becomes a first-class discovery type.
 */
import type { AimeatConfig } from '../../../config.js';
import type { Storage } from '../../../storage/interface.js';
import type { DiscoveryContext, DiscoveryEntry, DiscoverySource, RawHit } from '../types.js';
import { listPublicAppTools, type PricedAppTool } from '../../../commerce/app-tool-catalog.js';

export const APP_TOOLS_SOURCE_ID = 'app-tools';
const MAX_LIMIT = 100;

/** A tool matches a query when every word of it appears in its name, its app, or its description. */
function matchesQuery(tool: PricedAppTool, words: string[]): boolean {
  if (!words.length) return true;
  const hay = `${tool.name} ${tool.app} ${tool.description}`.toLowerCase();
  return words.every(w => hay.includes(w));
}

export function createAppToolsSource(storage: Storage, config: AimeatConfig): DiscoverySource {
  return {
    id: APP_TOOLS_SOURCE_ID,
    gating: 'visibility',

    async enumerate(ctx: DiscoveryContext): Promise<RawHit[]> {
      // Only PUBLIC manifests are scanned at all (the scanner's own gate), so there is nothing here
      // that a caller in any scope may not read. `shared` has no meaning for these: a tool manifest
      // is not a workspace record.
      if (ctx.scope !== 'public' && ctx.scope !== 'own') return [];

      const limit = Math.min(ctx.filters.limit ?? 50, MAX_LIMIT);
      const tools = await listPublicAppTools(storage, config, { pricedOnly: false });

      // In `own` scope the question is "what have I got", so another account's public tool is noise
      // rather than an answer. The scanner gives the publishing account on every entry.
      const mine = ctx.scope === 'own'
        ? tools.filter(t => t.ownerName === ctx.caller.ownerName)
        : tools;

      const words = (ctx.filters.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      return mine
        .filter(t => matchesQuery(t, words))
        .slice(0, limit)
        .map(tool => ({ sourceId: APP_TOOLS_SOURCE_ID, record: tool, score: 0 }));
    },

    toEntry(raw: RawHit, ctx: DiscoveryContext): DiscoveryEntry {
      const tool = raw.record as PricedAppTool;
      const priced = Boolean(tool.price || tool.priceMoney);
      return {
        type: 'tool',
        // The app is the coarse area, so a person can ask for one app's tools the way they ask for
        // one workspace's documents.
        segment: tool.app,
        id: `${tool.app}#${tool.name}`,
        title: tool.name,
        description: tool.description,
        // What a reader most wants to know before calling: does it cost, and does it answer now or
        // land as a task for a person's agent.
        tags: [priced ? 'priced' : 'free', tool.fulfillment === 'call' ? 'instant' : 'task'],
        visibility: 'public',
        owner: `${tool.ownerName}@${ctx.nodeId}`,
        node: ctx.nodeId,
        score: raw.score ?? 0,
        updatedAt: tool.updatedAt,
        // The listing, not the memory key: it is the machine-readable card for this tool and it
        // names the invoke address. The raw manifest tells a reader less and is one indirection away.
        href: `/v1/apps/${encodeURIComponent(tool.ownerName)}/${encodeURIComponent(tool.appId)}/webmcp`,
      };
    },
  };
}
