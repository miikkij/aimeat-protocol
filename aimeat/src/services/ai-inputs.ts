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
 *
 *   WHO MAY READ WHAT, WHEN A VIEWER IS GIVEN (services/ai-read-viewer.ts). A key without a namespace
 *   is read across the owner scope, which is the owner's own reach. A caller that knows who the model
 *   reads FOR passes that viewer: a same-owner record or file it may not see is refused with
 *   READ_AS_OWNER_NOTE before any model is called, rather than left out silently, so the model does
 *   not invent it and the agent knows what to ask its owner for. A caller that passes no viewer reads
 *   as before (the node's own unattended work, the workflow ai step with its own save-time check, a
 *   decide run).
 * @structure AiInputRecord · readAiRecords() · readAiFile()
 * @usage
 *   const recs = await readAiRecords(deps, reader, ownerGhii, [{ key }], { capability: 'text' }, viewer);
 * @version-history
 *   v1.2.0 -- 2026-10-22 -- An optional viewer: a record or a file the owner or a sibling agent keeps
 *     private is refused with READ_AS_OWNER_NOTE to a viewer that does not read as the owner, and a
 *     hidden owner copy that shadows the viewer's own record of the same key gives way to the viewer's
 *     own, as GET /v1/memory/:key?owner_scope=true reads it (secaudit 2026-10, r49 and v75). No viewer
 *     reads as before.
 *   v1.0.1 — 2026-10-05 — The file's workspace binding goes to fileTarget (secaudit 2026-10, DATA-4).
 *   v1.0.0 — 2026-09-29 — TARGET-082 V1. Initial.
 */
import type { Storage, StorageFileRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { getOwnerScopeMemory } from './owner-memory.js';
import { localAccountName } from '../utils/gaii.js';
import { presentMemories } from './classification/present-memory.js';
import { memoryTarget, fileTarget } from './classification/labels.js';
import type { ContentReader } from './classification/reader.js';
import { visibleToSameOwnerReader } from './owner-scope-read.js';
import { aiFileRefusal, hiddenRecordError, AiInputHiddenError, type AiReadViewer } from './ai-read-viewer.js';

/** One named input: its key, and the value a model may read, or undefined when there is none. */
export interface AiInputRecord {
  key: string;
  value: unknown | undefined;
}

/**
 * Read the records a model will be given, in the order asked. A key without `namespace` is read the
 * way the owner's own tools read one, across the owner scope (the owner and their agents); a key
 * with one is read there, and the caller has already made sure it is the owner's own. With a
 * `viewer` that does not read as the owner, a record it may not see is refused (AiInputHiddenError)
 * before anything is returned; when such a record only shadowed the viewer's own record of the same
 * key, the viewer's own is read.
 */
export async function readAiRecords(
  deps: { storage: Storage; config: AimeatConfig },
  reader: ContentReader,
  ownerGhii: string,
  keys: ReadonlyArray<{ key: string; namespace?: string }>,
  use: { capability: string },
  viewer?: AiReadViewer,
): Promise<AiInputRecord[]> {
  const { storage, config } = deps;
  const ownerName = localAccountName(ownerGhii);
  const found = await Promise.all(keys.map(k => k.namespace
    ? storage.getMemory(k.namespace, k.key)
    : getOwnerScopeMemory(storage, config.nodeId, ownerName, k.key)));
  if (viewer && !viewer.readsAll) {
    for (let i = 0; i < found.length; i++) {
      const rec = found[i];
      if (!rec || visibleToSameOwnerReader(rec, viewer.principal)) continue;
      const own = keys[i].namespace ? null : await storage.getMemory(viewer.principal, keys[i].key);
      if (!own) throw hiddenRecordError(keys[i].key, viewer);
      found[i] = own;
    }
  }
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

/**
 * A file a model will read, from `ownerGaii`'s own storage. Null when it is not there. With a `fence`
 * whose viewer may not read the file (aiFileRefusal), AiInputHiddenError before the bytes are shown.
 */
export async function readAiFile(
  storage: Storage,
  reader: ContentReader,
  ownerGaii: string,
  storageKey: string,
  use: { capability: string },
  fence?: { config: AimeatConfig; viewer?: AiReadViewer },
): Promise<StorageFileRecord | null> {
  const file = await storage.getStorageFile(ownerGaii, storageKey);
  if (!file) return null;
  if (fence?.viewer) {
    const refusal = await aiFileRefusal(storage, fence.config, fence.viewer, file);
    if (refusal) throw new AiInputHiddenError(refusal);
  }
  await reader.useForAi([fileTarget(ownerGaii, storageKey, file.workspaceRef)], use);
  const [shown] = await reader.show([file], () => fileTarget(ownerGaii, storageKey, file.workspaceRef));
  return shown ?? null;
}
