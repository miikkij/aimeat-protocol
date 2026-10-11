/**
 * @file src/config-pacing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description When the old morsel-price fields stop being read and written. Ruling
 *   decision-morseli-on-tahdistus-ei-hinta-tarjouksen-kaksi-arvoa (2026-10-11): an offer has an
 *   optional money price and a separate pacing amount in morsels per use, and a morsel is never a
 *   price. Until MORSEL_PRICE_FIELDS_REMOVED_IN, a write that sends an old morsel price field
 *   (`price.morsels`, `price_morsels`, `base_morsels`, `payMorsels`, `priceMorsels`) is accepted and
 *   stored as the pacing amount, and responses still carry the old field as a mirror of the pacing
 *   amount with a `deprecated` note. From that release both are gone.
 * @structure MORSEL_PRICE_FIELDS_REMOVED_IN · MORSEL_PRICE_DEPRECATION · legacyMorselFieldsLive
 * @usage if (legacyMorselFieldsLive()) out.price = { morsels: toll, deprecated: MORSEL_PRICE_DEPRECATION };
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial (wish-tarjouksella-rahahinta-ja-tahdistus-morselhinnat-tahdistukse).
 */
import { getSoftwareVersion } from './utils/version.js';

/** The release in which the old morsel-price fields are neither accepted nor returned. */
export const MORSEL_PRICE_FIELDS_REMOVED_IN = '4.0.0';

/** The note a deprecated mirror carries, so a client reading it learns what to read instead. */
export const MORSEL_PRICE_DEPRECATION =
  `Deprecated: a morsel is pacing, not a price. Read toll_morsels (the pacing amount per use) and the money price; this mirror is removed in ${MORSEL_PRICE_FIELDS_REMOVED_IN}.`;

/** True when `version` is at or past `floor`, compared part by part as numbers. */
function versionAtLeast(version: string, floor: string): boolean {
  const a = version.split('.').map(n => parseInt(n, 10));
  const b = floor.split('.').map(n => parseInt(n, 10));
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = Number.isFinite(a[i]) ? a[i] as number : -1;
    const y = Number.isFinite(b[i]) ? b[i] as number : 0;
    if (x !== y) return x > y;
  }
  return true;
}

/** Whether this release still accepts and mirrors the old morsel-price fields. */
export function legacyMorselFieldsLive(version: string = getSoftwareVersion()): boolean {
  return !versionAtLeast(version, MORSEL_PRICE_FIELDS_REMOVED_IN);
}
