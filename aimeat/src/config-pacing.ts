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
 *
 *   Two more names were found after 3.27.0 had announced the removals: a knowledge package's
 *   `sharing.morsel_price` and a capability's `cost.morsels`. They were not announced, so they are
 *   not removed in 4.0.0: from 4.0.0 the name is `toll_morsels`, the old name is still accepted with
 *   the Deprecation headers and counted, and MORSEL_PRICE_NAMES_REMOVED_IN refuses it (ruling
 *   decision-4-0-0-sharing-morsel-price-ja-cost-morsels-saavat-nimen-toll; services/toll-morsels-names.ts).
 * @structure MORSEL_PRICE_FIELDS_REMOVED_IN · MORSEL_PRICE_NAMES_REMOVED_IN · MORSEL_PRICE_DEPRECATION ·
 *   legacyMorselFieldsLive
 * @usage if (legacyMorselFieldsLive()) out.price = { morsels: toll, deprecated: MORSEL_PRICE_DEPRECATION };
 * @version-history
 *   v1.1.0 — 2026-10-13 — MORSEL_PRICE_NAMES_REMOVED_IN, the next major release, for `sharing.morsel_price`
 *     and `cost.morsels`.
 *   v1.0.1 — 2026-10-12 — versionAtLeast comes from utils/version.ts; the private copy is gone.
 *   v1.0.0 — 2026-10-11 — Initial (wish-tarjouksella-rahahinta-ja-tahdistus-morselhinnat-tahdistukse).
 */
import { getSoftwareVersion, versionAtLeast } from './utils/version.js';

/** The release in which the old morsel-price fields are neither accepted nor returned. */
export const MORSEL_PRICE_FIELDS_REMOVED_IN = '4.0.0';

/**
 * The release that stops taking a knowledge package's `sharing.morsel_price` and a capability's
 * `cost.morsels`: the next major release after 4.x, because 4.0.0 is the first to announce them.
 */
export const MORSEL_PRICE_NAMES_REMOVED_IN = '5.0.0';

/** The note a deprecated mirror carries, so a client reading it learns what to read instead. */
export const MORSEL_PRICE_DEPRECATION =
  `Deprecated: a morsel is pacing, not a price. Read toll_morsels (the pacing amount per use) and the money price; this mirror is removed in ${MORSEL_PRICE_FIELDS_REMOVED_IN}.`;

/** Whether this release still accepts and mirrors the old morsel-price fields. */
export function legacyMorselFieldsLive(version: string = getSoftwareVersion()): boolean {
  return !versionAtLeast(version, MORSEL_PRICE_FIELDS_REMOVED_IN);
}
