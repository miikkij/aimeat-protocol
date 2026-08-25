/**
 * @file src/services/data-map/data-map-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Read and write one app's data map, which lives BESIDE the app as its own record
 *   rather than inside its HTML.
 *
 *   Beside, not inside, for two reasons. The map is prose — a paragraph about what the app is for
 *   and one sentence per row about why the data is where it is — and prose does not fit in a `meta`
 *   attribute. And it is corrected after the fact, by whoever notices the arrangement is wrong,
 *   which must not require republishing the app.
 *
 *   Writes go through `writeMemoryRecord`, never `storage.setMemory`, so the archive guard, the
 *   value ceiling, the key ceiling and the provenance stamp all apply.
 * @structure readAppDataMap · writeAppDataMap · stampForApp
 * @usage import { readAppDataMap, writeAppDataMap } from './data-map-store.js';
 * @version-history
 *   v2.0.0 — 2026-08-25 — Follows the spec/2 shape; the derivation collector is gone with the
 *     guessing it fed.
 *   v1.0.0 — 2026-08-24 — Initial creation for TARGET-073 step 6.
 */
import type { Storage } from '../../storage/interface.js';
import { writeMemoryRecord, type MemoryWriteCaller, type MemoryWriteFanout } from '../memory-write.js';
import { stampFor } from './data-map-check.js';
import {
  appDataMapKey, publicDataMap, DATA_MAP_SPEC, type DataMap, type DataMapStamp,
} from './data-map-types.js';

/** Read one app's map, or null when it has none. Null is a real answer and is rendered as one. */
export async function readAppDataMap(
  storage: Storage, ownerGhii: string, appId: string,
): Promise<DataMap | null> {
  const rec = await storage.getMemory(ownerGhii, appDataMapKey(appId));
  const value = rec?.value as DataMap | undefined;
  if (!value || typeof value !== 'object' || value.spec !== DATA_MAP_SPEC) return null;
  return value;
}

/**
 * Write one app's map.
 *
 * Public on purpose — the map is the promise the app makes to whoever installs it — and the finding
 * is stripped on the way IN rather than on the way out, because a stored record carrying an
 * owner-only field is one careless read away from leaking it.
 */
export async function writeAppDataMap(
  deps: MemoryWriteFanout, caller: MemoryWriteCaller, appId: string, map: DataMap,
): Promise<{ ok: boolean; status: number; code?: string; message?: string }> {
  const result = await writeMemoryRecord(deps, caller, {
    key: appDataMapKey(appId),
    value: publicDataMap(map),
    visibility: 'public',
    tags: ['datamap', `app:${appId}`],
    pipeline: 'rest.datamap',
    ownerScoped: true,
  });
  return result.ok
    ? { ok: true, status: 200 }
    : { ok: false, status: result.status, code: result.code, message: result.message };
}

/** The stamp the app manifest carries, so a list renders without reading the document. */
export async function stampForApp(
  storage: Storage, ownerGhii: string, appId: string, at: string,
): Promise<DataMapStamp> {
  const map = await readAppDataMap(storage, ownerGhii, appId);
  return stampFor(map, appId, at);
}
