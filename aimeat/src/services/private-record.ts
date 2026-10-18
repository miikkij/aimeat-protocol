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
 *
 *   upsertPrivateRecord replaces the value. updatePrivateRecord changes the stored value on its
 *   version (services/record-cas.ts), for a record that more than one code path writes, such as the
 *   owner's AI settings record `openrouter.settings`: POST /v1/ai/settings, the MCP tool
 *   aimeat_operator_ai_config, an agent's daily cap and a provider delete each change some fields of
 *   it, and a whole-record write from a copy read before another one's write lost that write.
 * @structure upsertPrivateRecord(storage, ownerGaii, key, value, tags) ·
 *   updatePrivateRecord(storage, ownerGaii, key, mutate, tags)
 * @usage
 *   await upsertPrivateRecord(storage, gaii, 'decide.policy', policy, ['decide', 'policy']);
 *   await updatePrivateRecord(storage, gaii, 'openrouter.settings', cur => ({ ...(cur ?? {}), n: 1 }), ['openrouter', 'settings']);
 * @version-history
 *   v1.1.0 — 2026-10-18 — updatePrivateRecord (wish wish-ei-atomisen-kirjoituksen-107-avointa-kohtaa-korjataan-raha-j).
 *   v1.0.0 — 2026-09-19 — Extracted from routes/ai.ts upsertMemory, for services/decide/ (TARGET-080).
 */
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { updateRecord, type UNCHANGED } from './record-cas.js';

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

type Obj = Record<string, unknown>;
const objectOf = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Obj) } : null);

/**
 * Change a private record on its version: `mutate` gets a copy of the stored object (null when there
 * is none) and answers the new value, or UNCHANGED to write nothing. On a concurrent write it runs
 * again on the fresh value, so it depends only on what it is given. `tags` is the list to write, or
 * a function of the stored record. Answers the value as stored.
 */
export async function updatePrivateRecord(
  storage: Storage, ownerGaii: string, key: string,
  mutate: (cur: Obj | null) => Obj | typeof UNCHANGED,
  tags: string[] | ((stored: MemoryRecord | null) => string[]),
): Promise<Obj | null> {
  return updateRecord(storage, ownerGaii, key, objectOf, mutate, { tag: 'private', tags, visibility: 'private' });
}
