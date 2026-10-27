/**
 * @file src/services/knowledge-review-reach.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whose package an operator's review is about, for the two reads that show the review
 *   (GET /v1/knowledge/:id/reviews and the last review on GET /v1/knowledge/:id/reputation).
 *
 *   WHY. A review is stored by the package's manifest key (`packages/<id>/manifest`) alone, and the
 *   reads asked only whether the caller's account held a record at that key. The packages/ prefix is
 *   not reserved, so another account wrote its own record there and read the operator's moderation
 *   notes on somebody else's package (secaudit2026oct26, GET-reviews:mine-by-global-manifest-key).
 *
 *   THE RULE. The package is the copy its import made first: the import mints the id, so a copy
 *   written by anybody else at that key is always younger. The caller's account reads the reviews
 *   when it holds the oldest live copy of the key on this node. The owner in person and the owner's
 *   agents keep reading the reviews of their packages; the operator's read does not ask this.
 * @structure holdsOldestPackageCopy(storage, manifestKey, identities)
 * @usage if (!(await holdsOldestPackageCopy(storage, manifestKey, identities))) return notFound();
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import type { Storage, MemoryRecord } from '../storage/interface.js';

/** Every live copy of `key` on this node, whoever holds it. */
async function copiesOf(storage: Storage, key: string): Promise<MemoryRecord[]> {
  const rows = storage.getMemoryByKeysAnyOwner
    ? await storage.getMemoryByKeysAnyOwner([key])
    : (await storage.listAllMemory({ prefix: key, limit: 1000 })).items;
  return rows.filter(r => r.key === key);
}

/** True when one of `identities` (one account's GHII and agents) holds the oldest copy of the key. */
export async function holdsOldestPackageCopy(storage: Storage, manifestKey: string, identities: readonly string[]): Promise<boolean> {
  const copies = await copiesOf(storage, manifestKey);
  if (!copies.some(r => identities.includes(r.ownerGaii))) return false;
  const time = (r: MemoryRecord) => Date.parse(String(r.createdAt)) || 0;
  const oldest = copies.reduce((a, b) => (time(b) < time(a) || (time(b) === time(a) && b.ownerGaii < a.ownerGaii) ? b : a));
  return identities.includes(oldest.ownerGaii);
}
