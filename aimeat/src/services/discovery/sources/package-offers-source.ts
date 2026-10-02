/**
 * @file package-offers-source.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `package-offers` discovery source: the packages this node sells, as `offering`
 *   entries with segment `package` (docs/specs/package-sale-design.md, phase 5: the offer in discovery
 *   for agents). An agent that searches for something to buy finds the package, its price and the
 *   call that buys it. Read from this node's sales catalogue (package-sale-catalogue.ts); only entries
 *   on sale, in the public scope and in the caller's own scope alike, because a price on sale is
 *   what the node shows every buyer.
 * @structure createPackageOffersSource(storage, config) → DiscoverySource
 * @usage registry.register(createPackageOffersSource(storage, config));
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial (package sale design, phase 5).
 */
import type { AimeatConfig } from '../../../config.js';
import type { Storage } from '../../../storage/interface.js';
import type { DiscoveryContext, DiscoveryEntry, DiscoverySource, RawHit } from '../types.js';
import { readCatalogue, type CatalogueEntry } from '../../package-sale-catalogue.js';

export const PACKAGE_OFFERS_SOURCE_ID = 'package-offers';
const MAX_LIMIT = 100;

const money = (m: { amount: number; currency: string } | null): string => (m ? `${(m.amount / 1_000_000).toFixed(2)} ${m.currency}` : 'no charge');

export function createPackageOffersSource(storage: Storage, config: AimeatConfig): DiscoverySource {
  return {
    id: PACKAGE_OFFERS_SOURCE_ID,
    gating: 'none',

    async enumerate(ctx: DiscoveryContext): Promise<RawHit[]> {
      if (ctx.scope === 'shared') return [];
      const limit = Math.min(ctx.filters.limit ?? 50, MAX_LIMIT);
      const words = (ctx.filters.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      return (await readCatalogue(storage))
        .filter(e => e.state === 'on_sale')
        .filter(e => words.every(w => `${e.title ?? ''} ${e.group_id}`.toLowerCase().includes(w)))
        .slice(0, limit)
        .map(record => ({ sourceId: PACKAGE_OFFERS_SOURCE_ID, record, score: 0 }));
    },

    toEntry(raw: RawHit, ctx: DiscoveryContext): DiscoveryEntry {
      const e = raw.record as CatalogueEntry;
      const renewal = e.renewal ? `, then ${money(e.renewal)} per ${e.renewal.period_days} days of updates` : '';
      const qs = new URLSearchParams({ repository: e.repository, group_id: e.group_id }).toString();
      return {
        type: 'offering',
        segment: 'package',
        id: `${e.repository}/${e.group_id}`,
        title: e.title ?? e.group_id,
        description: `A package sold here for ${money(e.price)}${renewal}. Read the terms and buy it with aimeat_package_buy.`,
        tags: ['package', 'for-sale'],
        visibility: 'public',
        owner: `${e.seller_of_record}@${config.nodeId}`,
        node: ctx.nodeId,
        score: raw.score ?? 0,
        updatedAt: e.updatedAt,
        href: `/v1/package-sales/offer?${qs}`,
      };
    },
  };
}
