/**
 * @file src/services/exposure/sources-market.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The exposure sources for what a person offers to others: packages, exchange offerings
 *   and needs, and agents in the public agent list (plan doc-mvcn6c7e4e5q, V6.1).
 *
 *   An exchange offering or need is a PUBLIC memory record (services/exchange-market.ts putPublic),
 *   and it stays one after it is delisted or closed: the market stops showing it, the record is still
 *   readable at its address. So every one of the person's offerings and needs is counted, and the
 *   title says which are off the market, with deleting the record as the way to close those.
 *
 *   An agent is in the public agent list (GET /v1/catalogue/agents, routes/catalogue.ts) unless it
 *   carries the tag `unlisted`: its name, description and capabilities are read there by anyone.
 * @structure packageSource · exchangeSource · agentSource
 * @usage import { packageSource } from './sources-market.js';
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V6.1).
 */
import { listAllOfferings, listNeeds } from '../exchange-market.js';
import {
  type ExposureItem, type ExposureLevel, type ExposureSource, LEVELS,
  levelOfVisibility, ownerIdentities,
} from './exposure-types.js';

const enc = encodeURIComponent;

/** The versions of a package that are served to anyone at all. */
const SERVED_STATUSES = new Set(['published', 'beta']);

export const packageSource: ExposureSource = {
  kind: 'package',
  async list(ctx, ownerName, ownerGhii) {
    // A package made by an operator is authored 'operator' and carries the maker's GHII.
    const { packages } = await ctx.memo('packages', () => ctx.storage.listPackages({ limit: 10_000 }));
    const widest = new Map<string, { name: string; level: ExposureLevel; organism_id?: string }>();
    for (const p of packages) {
      if (p.author !== ownerName && p.authorGhii !== ownerGhii) continue;
      if (!SERVED_STATUSES.has(p.status)) continue;
      const lv = levelOfVisibility(p.visibility);
      if (!lv) continue;
      const known = widest.get(p.packageGroupId);
      if (!known || LEVELS.indexOf(lv.level) < LEVELS.indexOf(known.level)) widest.set(p.packageGroupId, { name: p.name, ...lv });
    }
    return [...widest].map(([groupId, { name, ...lv }]): ExposureItem => ({
      kind: 'package', id: groupId, title: name, ...lv, url: `${ctx.base}/v1/packages/${enc(groupId)}`,
      how_to_close: `Make it private with PATCH /v1/packages/${enc(groupId)} and {"visibility":"private"}, or take a version back with aimeat_package_withdraw.`,
    }));
  },
};

export const exchangeSource: ExposureSource = {
  kind: 'exchange',
  async list(ctx, ownerName, ownerGhii) {
    const offerings = await ctx.memo('offerings', () => listAllOfferings(ctx.storage));
    const needs = await ctx.memo('needs', () => listNeeds(ctx.storage));
    const out: ExposureItem[] = [];
    for (const o of offerings) {
      if (o.providerOwner !== ownerName && o.providerGhii !== ownerGhii) continue;
      const listed = o.state === 'listed';
      out.push({
        kind: 'exchange', id: o.offeringId,
        title: listed ? `Offering: ${o.title}` : `Offering: ${o.title} (off the market, the record is still readable)`,
        level: 'public', url: `${ctx.base}/v1/exchange/offerings/${enc(o.offeringId)}`,
        how_to_close: listed
          ? `Take it off the market with DELETE /v1/exchange/offerings/${enc(o.offeringId)}, then remove the record with aimeat_memory_delete (key exchange.offering.${o.offeringId}).`
          : `Remove the record with aimeat_memory_delete (key exchange.offering.${o.offeringId}; DELETE /v1/memory/exchange.offering.${enc(o.offeringId)}).`,
      });
    }
    for (const n of needs) {
      if (n.requesterOwner !== ownerName) continue;
      const open = n.state !== 'closed';
      out.push({
        kind: 'exchange', id: n.needId,
        title: `Need: ${n.description.slice(0, 120)}${open ? '' : ' (closed, the record is still readable)'}`,
        level: 'public', url: `${ctx.base}/v1/exchange/needs`,
        how_to_close: open
          ? `Close it with POST /v1/exchange/needs/${enc(n.needId)}/close, then remove the record with aimeat_memory_delete (key exchange.need.${n.needId}).`
          : `Remove the record with aimeat_memory_delete (key exchange.need.${n.needId}; DELETE /v1/memory/exchange.need.${enc(n.needId)}).`,
      });
    }
    return out;
  },
};

export const agentSource: ExposureSource = {
  kind: 'agent',
  async list(ctx, ownerName, ownerGhii) {
    const { agents } = await ownerIdentities(ctx, ownerName, ownerGhii);
    return agents
      .filter(a => !(a.tags ?? []).includes('unlisted'))
      .map((a): ExposureItem => ({
        kind: 'agent', id: a.gaii, title: a.displayName || a.name, level: 'public',
        url: `${ctx.base}/v1/catalogue/agents`,
        how_to_close: `Take it out of the public agent list with aimeat_agent_tags_set, adding the tag "unlisted" to its tags (PATCH /v1/agents/${enc(a.name)}/tags).`,
      }));
  },
};
