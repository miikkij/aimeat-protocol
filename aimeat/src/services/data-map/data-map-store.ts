/**
 * @file src/services/data-map/data-map-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where a program's data map is read from and written to, and the summary that rides on
 *   the app manifest so a listing can show the state without opening the document.
 *
 *   The full map is a memory record at `apps.{appId}.datamap`, which is where this project puts a
 *   feature's data — a key prefix plus something that reads it — and `appToolsKey` is the precedent
 *   for an app-level side document. Writes go through `writeMemoryRecord()` and never
 *   `storage.setMemory`, so the archive guard, the value ceiling, the key ceiling and the provenance
 *   stamp all apply; that shortcut is exactly how the tool manifest came to skip all four.
 *
 *   The document is PUBLIC and the gap is stripped from it. A published app's map is the promise it
 *   makes to whoever installs it, and an agent deciding whether to use an app needs to know where its
 *   data lands before it touches it; the publish check's finding is the owner's own unfinished
 *   business, and `publicDataMap()` removes it — the same split `publicPosture()` makes.
 * @structure readAppDataMap · writeAppDataMap · stampFor · collectAppDerivationInput
 * @usage import { readAppDataMap, stampFor } from './data-map-store.js';
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial creation for TARGET-073 step 6.
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { IdentificationTier } from '../../utils/key-family.js';
import { writeMemoryRecord, type MemoryWriteCaller, type MemoryWriteFanout } from '../memory-write.js';
import { deriveDataMap, type DataMapDerivationInput } from './data-map-derive.js';
import {
  appDataMapKey,
  publicDataMap,
  type DataMap,
  type DataMapStamp,
  DATA_MAP_SPEC,
} from './data-map-types.js';

/** Weakest first, so `stampFor` can report what a reader should trust the whole map to. */
const TIER_STRENGTH: Record<IdentificationTier, number> = {
  'schema-locked': 4, 'declared-space': 3, 'platform-prefix': 2, 'owner-named': 1, none: 0,
};

/** Read one app's published map document, or null when it has none. */
export async function readAppDataMap(
  storage: Storage, ownerGhii: string, appId: string,
): Promise<DataMap | null> {
  const rec = await storage.getMemory(ownerGhii, appDataMapKey(appId));
  const value = rec?.value as DataMap | undefined;
  if (!value || typeof value !== 'object' || value.spec !== DATA_MAP_SPEC) return null;
  return value;
}

/**
 * Write one app's map document.
 *
 * Public on purpose, and the gap is stripped on the way in rather than on the way out — a stored
 * record that carries an owner-only field is one accidental read away from leaking it, and this
 * document is served to strangers by design.
 */
export async function writeAppDataMap(
  deps: MemoryWriteFanout, caller: MemoryWriteCaller, appId: string, map: DataMap,
): Promise<{ ok: boolean; message?: string }> {
  const result = await writeMemoryRecord(deps, caller, {
    key: appDataMapKey(appId),
    value: publicDataMap(map),
    visibility: 'public',
    tags: ['datamap'],
    pipeline: 'app.datamap',
    ownerScoped: true,
  });
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

/** The manifest summary. Everything here answers a question a listing asks without opening the doc. */
export function stampFor(map: DataMap, appId: string): DataMapStamp {
  const rows = [...map.held, ...map.elsewhere];
  const weakest = rows.reduce<IdentificationTier>(
    (worst, r) => (TIER_STRENGTH[r.basis.tier] < TIER_STRENGTH[worst] ? r.basis.tier : worst),
    'schema-locked',
  );
  return {
    spec: DATA_MAP_SPEC,
    form: map.form,
    source: map.source,
    heldRows: map.held.length,
    elsewhereRows: map.elsewhere.length,
    // An empty map is a statement ("this stores nothing"), and its weakest basis is not 'none' —
    // there are no rows to be unsure about. Reporting 'none' would put every storage-free app at the
    // bottom of a coverage sort next to the genuinely unexplained.
    weakestTier: rows.length === 0 ? 'declared-space' : weakest,
    rowsWithoutWhy: map.held.filter(r => !r.why.trim()).length,
    docKey: appDataMapKey(appId),
    at: map.at,
    ...(map.gap ? { gap: map.gap } : {}),
  };
}

/**
 * Gather everything `deriveDataMap` needs about one app. The ONLY I/O in the derivation path, which
 * is what lets the publish and the one-off backfill call the same pure function underneath.
 *
 * A NOTE ON FORKS, stated rather than glossed. The document lives at a key derived from the app id,
 * so it follows an app across VERSIONS for free. A fork gets a new id and therefore no document, and
 * unlike `aiPosture` — which the manifest carries and a fork copies — the map's rows do not travel.
 * The fork path is where that is fixed, and until it is, a forked app derives a fresh map and its
 * check reports it as underived rather than silently presenting the parent's promises as its own.
 */
export async function collectAppDerivationInput(
  storage: Storage,
  config: AimeatConfig,
  app: {
    ownerName: string; filename: string; html: string | null;
    scopes: string[]; usesCortex?: string[];
  },
  at: string,
  declaredMeta: DataMapDerivationInput['declaredMeta'],
): Promise<DataMapDerivationInput> {
  const appId = app.filename.replace(/\.html$/i, '');
  const ownerGhii = `${app.ownerName}@${config.nodeId}`;
  const declaredDoc = await readAppDataMap(storage, ownerGhii, appId);

  return {
    programKind: 'app',
    programId: appId,
    ownerName: app.ownerName,
    at,
    scopes: app.scopes,
    declaredMeta,
    declaredDoc,
    // Same key across versions, so the previous version's answers ARE the document already read.
    previous: declaredDoc,
    manifest: { usesCortex: app.usesCortex ?? [] },
  };
}

/** Build the map and its stamp for one app in one call — what the publish path wants. */
export function deriveAndStamp(input: DataMapDerivationInput): { map: DataMap; stamp: DataMapStamp } {
  const map = deriveDataMap(input);
  return { map, stamp: stampFor(map, input.programId) };
}
