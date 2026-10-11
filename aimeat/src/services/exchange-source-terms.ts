/**
 * @file src/services/exchange-source-terms.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How a listing SOURCE's own declarations read as listing fields: the usage terms with
 *   their defaults, the provenance stamped with its ODPS version, every money price, the price rows a
 *   source sells in with the pacing it carries, and the content hash a reconcile compares.
 *   Moved out of services/exchange-projection.ts unchanged, so the projection stays under the file limit
 *   and the ODPS write check (services/exchange-odps-write.ts) reads usage terms with the same defaults
 *   the listing gets, rather than with a copy of them.
 * @structure hasSchema · usageTermsOf · provenanceOf · moneyPricesOf · contentHash · listingTerms · ListingRow
 * @usage
 *   const terms = usageTermsOf(tool.usageTerms);
 *   const sold = listingTerms(tool.tollMorsels, tool.price?.morsels ?? 0, moneyPricesOf(tool.priceMoney, tool.pricesMoney));
 *   if (sold) for (const p of sold.rows) { ... }
 * @version-history
 *   v1.1.0 — 2026-10-11 — A morsel is pacing, never a price (decision-morseli-on-tahdistus-ei-hinta-
 *     tarjouksen-kaksi-arvoa). prices + pacingTollOf become listingTerms: a source with only a pacing
 *     amount lists (a free offer with pacing used to be skipped as NOT_PRICED once its old price had
 *     been folded into tollMorsels), and with money the toll is the declared toll plus the legacy figure.
 *   v1.0.1 — 2026-10-07 — moneyPricesOf moved unchanged to commerce/money.ts and re-exported here.
 *   v1.0.0 — 2026-09-13 — Extracted verbatim from services/exchange-projection.ts (pure move).
 */
import { createHash } from 'node:crypto';
import type { UsageTerms } from './exchange-market.js';
import type { EntitlementUnit } from './metered-entitlements.js';
import type { Provenance } from '../models/odps-schemas.js';
import { ODPS_VERSION } from './exchange-odps.js';

export const hasSchema = (v: unknown): boolean => !!v && typeof v === 'object' && Object.keys(v as Record<string, unknown>).length > 0;

/** Same permissive-but-attributed defaults the manual listing route applies when a field is omitted. */
export function usageTermsOf(src: { derivatives?: boolean; resale?: boolean; attribution?: boolean; note?: string } | undefined): UsageTerms {
  return {
    derivatives: src?.derivatives !== false,
    resale: src?.resale === true,
    attribution: src?.attribution !== false,
    ...(src?.note ? { note: src.note } : {}),
  };
}

/** Stamp the ODPS version onto a source-declared provenance, so every descriptor says which version it follows. */
export function provenanceOf(src: Provenance | undefined): Provenance | null {
  if (!src || !Object.keys(src).length) return null;
  return { ...src, odpsVersion: src.odpsVersion ?? ODPS_VERSION };
}

/** Every money price a source declares, `priceMoney` first. Lives in commerce/money.ts, so the
 *  checkout and the tool catalog read money prices with the same function this listing does. */
export { moneyPricesOf } from '../commerce/money.js';

export function contentHash(parts: unknown): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
}

/** One listing row: the rail a contract on it settles on, and its per-call amount on that rail. */
export type ListingRow = { unit: EntitlementUnit; basePrice: number; currency: string | null };

/**
 * The listing rows and the pacing a source projects to (ruling decision-morseli-on-tahdistus-ei-hinta-
 * tarjouksen-kaksi-arvoa, 2026-10-11: every item has an optional MONEY price and a PACING amount in
 * morsels per use, and a morsel is never a price).
 *
 * `declared` is the source's own `tollMorsels`; `legacyMorsels` is a morsel price it still carries
 * from 3.x (`price.morsels` on a tool, `commercial.payMorsels` on an action), which is pacing too.
 *
 *   - Money declared: one money row per currency, and the listing's toll is the declared toll plus
 *     the legacy figure (null when the source states neither, so the node default applies). A source
 *     with money and a morsel figure used to project a morsel listing beside the money one, which
 *     made two purchasable products out of one; that stays gone.
 *   - No money: the item is free and paced. It lists on the morsel rail, whose per-call amount is
 *     charged as pacing (services/metered-settlement.ts settleMorsels). A legacy figure keeps its old
 *     row and toll exactly, so a listing projected by 3.26.1 reads as unchanged. A source with only a
 *     declared toll (an agent offer, whose old price the offers route folds into `tollMorsels`) lists
 *     with that amount on the rail and a toll of 0, so the one amount is charged once.
 *   - Neither: null. The item is not offered to other owners, as before (NOT_PRICED).
 */
export function listingTerms(
  declared: number | null | undefined, legacyMorsels: number, money: Array<{ amount: number; currency: string }>,
): { rows: ListingRow[]; tollMorsels: number | null } | null {
  const legacy = Number.isInteger(legacyMorsels) && legacyMorsels > 0 ? legacyMorsels : 0;
  const toll = typeof declared === 'number' && Number.isInteger(declared) && declared >= 0 ? declared : null;
  if (money.length > 0) {
    return {
      rows: money.map(m => ({ unit: 'money' as const, basePrice: m.amount, currency: m.currency })),
      tollMorsels: toll === null && legacy === 0 ? null : (toll ?? 0) + legacy,
    };
  }
  if (legacy > 0) return { rows: [{ unit: 'morsels', basePrice: legacy, currency: null }], tollMorsels: toll };
  if (toll !== null && toll > 0) return { rows: [{ unit: 'morsels', basePrice: toll, currency: null }], tollMorsels: 0 };
  return null;
}
