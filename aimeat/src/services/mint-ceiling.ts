/**
 * @file src/services/mint-ceiling.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one daily ceiling on morsels the node adds from nothing: an operator's mint
 *   (POST /v1/admin/mint, services/morsel.ts mintMorsels) and a sold pacing pack
 *   (commerce/pacing-pack.ts) draw on the same AIMEAT_MAX_OPERATOR_MINT_PER_DAY. A pack is created
 *   inside the existing daily ceiling (decision "Buying pacing capacity with money", 2026-10-11).
 *
 *   WHAT IT REPLACED (feature-list audit 176). The mint counted only mint rows, so after a day of
 *   pack sales the operator could still mint the whole ceiling; and both counted over
 *   listAllTransactions, the newest 10 000 rows, so on a busy day the sum came out too low.
 * @structure DAILY_ADDED_TYPES · addedToday(storage)
 * @usage if (await addedToday(storage) + amount > config.maxOperatorMintPerDay) refuse();
 * @version-history
 *   v1.0.0 — 2026-10-15 — Initial (feature-list audit 176).
 */
import type { Storage } from '../storage/interface.js';

/** The ledger types that add morsels from nothing and share the daily ceiling. */
export const DAILY_ADDED_TYPES = ['mint', 'pacing_pack'] as const;

/** Morsels minted and sold since the start of the UTC day, summed by the database. */
export async function addedToday(storage: Storage): Promise<number> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  return storage.sumTransactionsSince(DAILY_ADDED_TYPES, dayStart.toISOString());
}
