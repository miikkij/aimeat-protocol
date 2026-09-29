/**
 * @file src/services/ai-inputs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one loader of stored content a model is about to read (TARGET-082, spec §13.2
 *   group 4): the records a prompt_key or input_keys name, and the files a call names by storage key.
 *   It reads them, masks a credential record (secret-records.ts, through presentMemories), and asks
 *   the classification component's useForAi before anything is handed back, so the refusal comes
 *   before the model is called.
 *
 *   The AI job, the scheduled AI job and the workflow AI step each assembled their prompt from keys
 *   with a copy of the same read; they read here now and keep only their own wording around the
 *   values. The scheduled job's copy had no credential mask.
 * @structure AiInputRecord · readAiRecords() · readAiFile()
 * @usage
 *   const recs = await readAiRecords(deps, reader, ownerGhii, [{ key }], { capability: 'text' });
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V1. Initial.
 */
import type { Storage, StorageFileRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { getOwnerScopeMemory } from './owner-memory.js';
import { localAccountName } from '../utils/gaii.js';
import { presentMemories } from './classification/present-memory.js';
import { memoryTarget, fileTarget } from './classification/labels.js';
import type { ContentReader } from './classification/reader.js';

/** One named input: its key, and the value a model may read, or undefined when there is none. */
export interface AiInputRecord {
  key: string;
  value: unknown | undefined;
}

/**
 * Read the records a model will be given, in the order asked. A key without `namespace` is read the
 * way the owner's own tools read one, across the owner scope (the owner and their agents); a key
 * with one is read there, and the caller has already made sure it is the owner's own.
 */
export async function readAiRecords(
  deps: { storage: Storage; config: AimeatConfig },
  reader: ContentReader,
  ownerGhii: string,
  keys: ReadonlyArray<{ key: string; namespace?: string }>,
  use: { capability: string },
): Promise<AiInputRecord[]> {
  const { storage, config } = deps;
  const ownerName = localAccountName(ownerGhii);
  const found = await Promise.all(keys.map(k => k.namespace
    ? storage.getMemory(k.namespace, k.key)
    : getOwnerScopeMemory(storage, config.nodeId, ownerName, k.key)));
  const present = found.filter((r): r is NonNullable<typeof r> => !!r);
  // Refused before anything is returned, so no model is called with content it may not read.
  await reader.useForAi(present.map(r => memoryTarget(r.ownerGaii, r.key)), use);
  const shown = await presentMemories(reader, present);
  const byId = new Map(shown.map(r => [`${r.ownerGaii}\u0000${r.key}`, r.value]));
  return keys.map((k, i) => {
    const rec = found[i];
    return { key: k.key, value: rec ? byId.get(`${rec.ownerGaii}\u0000${rec.key}`) : undefined };
  });
}

/** A file a model will read, from `ownerGaii`'s own storage. Null when it is not there. */
export async function readAiFile(
  storage: Storage,
  reader: ContentReader,
  ownerGaii: string,
  storageKey: string,
  use: { capability: string },
): Promise<StorageFileRecord | null> {
  const file = await storage.getStorageFile(ownerGaii, storageKey);
  if (!file) return null;
  await reader.useForAi([fileTarget(ownerGaii, storageKey)], use);
  const [shown] = await reader.show([file], () => fileTarget(ownerGaii, storageKey));
  return shown ?? null;
}
