/**
 * @file src/services/exchange-source-terms.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How a listing SOURCE's own declarations read as listing fields: the usage terms with
 *   their defaults, the provenance stamped with its ODPS version, every money price, the price rows a
 *   source sells in, the pacing toll a combined price carries, and the content hash a reconcile compares.
 *   Moved out of services/exchange-projection.ts unchanged, so the projection stays under the file limit
 *   and the ODPS write check (services/exchange-odps-write.ts) reads usage terms with the same defaults
 *   the listing gets, rather than with a copy of them.
 * @structure hasSchema · usageTermsOf · provenanceOf · moneyPricesOf · contentHash · prices · pacingTollOf
 * @usage
 *   const terms = usageTermsOf(tool.usageTerms);
 *   for (const p of prices(morsels, moneyPricesOf(tool.priceMoney, tool.pricesMoney))) { ... }
 * @version-history
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

/** Every money price a source declares, `priceMoney` first, de-duplicated by currency. */
export function moneyPricesOf(
  primary: { amount: number; currency: string } | null | undefined,
  extra: Array<{ amount: number; currency: string }> | undefined,
): Array<{ amount: number; currency: string }> {
  const out: Array<{ amount: number; currency: string }> = [];
  const seen = new Set<string>();
  for (const p of [primary, ...(extra ?? [])]) {
    if (!p || typeof p.amount !== 'number' || !Number.isInteger(p.amount) || p.amount <= 0 || !p.currency) continue;
    if (seen.has(p.currency)) continue;
    seen.add(p.currency); out.push({ amount: p.amount, currency: p.currency });
  }
  return out;
}

export function contentHash(parts: unknown): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
}

/** One price row per sellable unit: morsels (when priced) plus every declared money currency. */
export function prices(morsels: number, money: Array<{ amount: number; currency: string }>):
  Array<{ unit: EntitlementUnit; basePrice: number; currency: string | null }> {
  const rows: Array<{ unit: EntitlementUnit; basePrice: number; currency: string | null }> = [];
  // A source that declares BOTH a money price and a morsel figure is stating ONE combined price:
  // "1 morsel · 0.01 EUR". The money is what the provider is paid; the morsels pace the call
  // (see pacingTollOf below, which carries them onto the listing as the toll). This used to emit
  // a separate morsel listing beside the money one, which turned one product into two purchasable
  // alternatives — and a buyer who took the morsel one got the whole thing for pacing tokens,
  // which the platform itself says are not a currency. Nobody ever declared that second product.
  // Morsels WITHOUT money stay a listing of their own: that is a deliberate no-money offer.
  if (morsels > 0 && money.length === 0) rows.push({ unit: 'morsels', basePrice: morsels, currency: null });
  for (const m of money) rows.push({ unit: 'money', basePrice: m.amount, currency: m.currency });
  return rows;
}

/**
 * The pacing toll a listing carries. An explicit `tollMorsels` always wins — it is the declared
 * one. Otherwise, when a source prices in money AND names a morsel figure, that figure IS the
 * pacing half of the combined price and rides along as the toll, so a call costs the money to the
 * provider and burns the morsels. Money-only stays untolled; morsels-only is priced in morsels
 * already and must not be charged twice for the same number.
 */
export function pacingTollOf(declared: number | null | undefined, morsels: number, hasMoney: boolean): number | null {
  if (declared != null) return declared;
  return hasMoney && morsels > 0 ? morsels : null;
}
