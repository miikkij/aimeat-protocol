/**
 * @file src/services/private-record.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Write one private record into an owner's namespace from the SERVER side: the node's
 *   own bookkeeping (AI settings, decision policies, run progress), which a reserved prefix keeps out
 *   of the memory API and which therefore does not pass through its gate.
 *
 *   One function because the same eight lines had been written out in three places, and a version
 *   bump or a createdAt kept on update is exactly the detail that drifts when it lives in three.
 *   Not for anything a person or an agent writes: that goes through services/memory-write.ts, which
 *   applies the ceilings, the archive guard and provenance.
 * @structure upsertPrivateRecord(storage, ownerGaii, key, value, tags)
 * @usage await upsertPrivateRecord(storage, gaii, 'decide.policy', policy, ['decide', 'policy']);
 * @version-history
 *   v1.0.0 — 2026-09-19 — Extracted from routes/ai.ts upsertMemory, for services/decide/ (TARGET-080).
 */
import type { Storage } from '../storage/interface.js';

/** Create or replace a private record, keeping its createdAt and bumping its version. */
export async function upsertPrivateRecord(
  storage: Storage, ownerGaii: string, key: string, value: unknown, tags: string[],
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await storage.getMemory(ownerGaii, key);
  await storage.setMemory({
    key, ownerGaii, value: value as Record<string, unknown>, visibility: 'private', tags,
    ttlHours: null,
    version: existing ? existing.version + 1 : 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}
