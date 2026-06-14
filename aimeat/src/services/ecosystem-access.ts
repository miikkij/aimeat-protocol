/**
 * @file ecosystem-access.ts
 * @description Data-area allowlist enforcement for ecosystem-app (GEAI) writes. A GEAI works freely
 *   in its OWN eco: namespace (flat keys) — that needs no grant — but a write into the OWNER's shared
 *   areas (organism workspaces) must be covered by an owner-granted data-area (the consent grants
 *   captured at approval, stored on EcosystemAppRecord.dataAreas). This realizes "the scope list is
 *   the allowlist; there is no implicit area access" for the organism deposit path, on top of the
 *   existing workspace-access membership/consent checks.
 * @structure ecoMayWriteKey(storage, geai, key)
 * @usage import { ecoMayWriteKey } from '../services/ecosystem-access.js';
 * @version-history
 *   v1.0.0 — 2026-06-14 — Created for ecosystem capability & data-access (chunk 3).
 */
import type { Storage } from '../storage/interface.js';
import { consentMatchPattern } from '../storage/pattern-utils.js';

/**
 * May this GEAI write `key`? Flat keys (the GEAI's own eco: working namespace) are always allowed.
 * An `organism.*` key (a deposit into the owner's shared area) requires a matching data-area grant
 * (area 'organisms'/'organism', 'write' right, pattern glob-matching the key or the organism id).
 */
export async function ecoMayWriteKey(storage: Storage, geai: string, key: string): Promise<boolean> {
  if (!key.startsWith('organism.')) return true; // the GEAI's own namespace — free, no grant needed
  const app = await storage.getEcosystemApp(geai);
  if (!app) return false; // unknown GEAI — deny the cross-namespace deposit
  const organismId = key.split('.')[1] ?? '';
  const grants = app.dataAreas ?? [];
  return grants.some(g =>
    (g.area === 'organisms' || g.area === 'organism') &&
    g.rights.includes('write') &&
    (consentMatchPattern(g.pattern, key) || g.pattern === organismId || consentMatchPattern(g.pattern, organismId)),
  );
}
