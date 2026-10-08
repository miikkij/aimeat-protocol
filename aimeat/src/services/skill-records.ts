/**
 * @file src/services/skill-records.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading the skills registry's memory records across the members who hold copies of
 *   them. Moved unchanged out of services/skills.ts (max-file-lines).
 * @structure listAcrossOwners(storage, prefix) · freshestByKey(records)
 * @usage const freshest = freshestByKey(await listAcrossOwners(storage, mKey)).get(mKey);
 * @version-history
 *   v1.0.0 — 2026-10-08 — Moved from services/skills.ts (max-file-lines).
 */
import type { Storage, MemoryRecord } from '../storage/interface.js';

/** All owners' copies of the records under a key prefix (workspace records may be
 *  published by different members — the organism content-ownership invariant). */
export async function listAcrossOwners(storage: Storage, prefix: string): Promise<MemoryRecord[]> {
  const { items } = await storage.listAllMemory({ prefix, limit: 2000 });
  return items;
}

/** Collapse multi-owner copies of the same key to the freshest one (freshest-wins). */
export function freshestByKey(records: MemoryRecord[]): Map<string, MemoryRecord> {
  const best = new Map<string, MemoryRecord>();
  for (const r of records) {
    const cur = best.get(r.key);
    if (!cur || String(r.updatedAt) > String(cur.updatedAt)) best.set(r.key, r);
  }
  return best;
}
