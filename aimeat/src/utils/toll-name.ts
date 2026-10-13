/**
 * @file src/utils/toll-name.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The read side of the pacing-amount rename: a stored object that still carries a 3.x
 *   name for the pacing amount is answered under `toll_morsels` (ruling
 *   decision-4-0-0-sharing-morsel-price-ja-cost-morsels-saavat-nimen-toll, 2026-10-13).
 *
 *   Two objects carried a morsel amount under a name that made it a price: a knowledge package's
 *   `sharing.morsel_price` and a capability's `cost.morsels`. A morsel paces use and is never a price
 *   (ruling decision-morseli-on-tahdistus-ei-hinta-tarjouksen-kaksi-arvoa), so from 4.0.0 both are
 *   `toll_morsels`. A row written before the rename keeps its old key, and every read passes it
 *   through here, so no reader sees the old name and no migration rewrites the rows.
 *
 *   No mirror: the old name is not answered beside the new one. Nothing in this node reads either
 *   value (the knowledge amount is always 0, the capability amount is shown by the profile screen,
 *   which reads both names), so a mirror would keep the price-sounding name alive for no reader.
 *
 *   A leaf: the storage providers read it, so it imports nothing.
 * @structure TOLL_MORSELS · tollNameOnRead(obj, oldKey)
 * @usage
 *   cost: tollNameOnRead(JSON.parse(row.cost), 'morsels')
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial (decision-4-0-0-sharing-morsel-price-ja-cost-morsels-saavat-nimen-toll).
 */

/** The one name for a pacing amount in morsels on these objects. */
export const TOLL_MORSELS = 'toll_morsels';

/**
 * `obj` with `oldKey` answered as `toll_morsels`. The new name wins when a row carries both. Anything
 * that is not a plain object comes back unchanged, so a null cost stays null.
 */
export function tollNameOnRead<T>(obj: T, oldKey: string): T {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || !(oldKey in obj)) return obj;
  const { [oldKey]: old, ...rest } = obj as Record<string, unknown>;
  return { ...rest, [TOLL_MORSELS]: rest[TOLL_MORSELS] ?? old } as T;
}
