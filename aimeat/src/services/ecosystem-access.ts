/**
 * @file ecosystem-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Data-area allowlist enforcement for ecosystem-app (GEAI) reads AND writes. A GEAI works
 *   freely in its OWN eco: namespace (flat keys) — that needs no grant — but crossing into the OWNER's
 *   shared areas (organism workspaces) must be covered by an owner-granted data-area (the consent grants
 *   captured at approval, stored on EcosystemAppRecord.dataAreas): a WRITE needs a matching `write`
 *   grant, a READ needs a matching `read` grant. This realizes "the scope list is the allowlist; there
 *   is no implicit area access" symmetrically for both directions, on top of the existing
 *   workspace-access membership/consent checks. A GEAI rides its owner's organism membership, so
 *   without this READ gate an owner-selected read-allowlist (EcoDataAreaGrant.rights = ['read']) is
 *   captured at approval but never enforced — model A (strict): reads require a matching read grant.
 * @structure
 *   - approvableDataAreas(areas)          — the areas an approval shows and stores (no `memory` area)
 *   - ecoMayWriteKey(storage, geai, key) — write gate (area grant with 'write')
 *   - ecoMayReadKey(storage, geai, key)  — read gate (area grant with 'read')
 * @usage import { ecoMayReadKey, ecoMayWriteKey } from '../services/ecosystem-access.js';
 * @version-history
 *   2026-11-15 — approvableDataAreas: the `memory` area is left out of what the approval shows and
 *     stores, since no gate reads it; a request that carries one is accepted (audit 2026-11 L045).
 *   v1.0.0 — 2026-06-14 — Created for ecosystem capability & data-access (chunk 3).
 *   v1.1.0 — 2026-07-02 — Add ecoMayReadKey (model A / strict): organism reads now require a matching
 *     'read' data-area grant, mirroring the write gate. Closes the inert read-allowlist hole.
 */
import type { Storage } from '../storage/interface.js';
import type { EcoDataAreaGrant } from '../storage/interface.js';
import { consentMatchPattern } from '../storage/pattern-utils.js';

/**
 * The data areas the owner approves, from what an app asked for or the owner sent: every area except
 * `memory`. A GEAI writes and reads its own namespace with no grant (the gates below return true for
 * a flat key) and reaches no other memory, so the node enforces no memory area; showing one on the
 * approval presented a limit that does not exist (audit 2026-11 L045). A hello and an approval that
 * carry one are accepted, since published apps send it, and the area is left out of what is shown and
 * stored. Every other area passes unchanged.
 */
export function approvableDataAreas(areas: EcoDataAreaGrant[]): EcoDataAreaGrant[] {
  return areas.filter(a => (a as { area?: unknown } | null)?.area !== 'memory');
}

/**
 * Does any of the GEAI's `organisms`/`organism` data-area grants cover `key` with `right`? The grant
 * pattern may glob-match the full key OR name the organism id directly. Shared by the read + write gates.
 */
function grantsCover(grants: EcoDataAreaGrant[], key: string, right: 'read' | 'write'): boolean {
  const organismId = key.split('.')[1] ?? '';
  return grants.some(g =>
    (g.area === 'organisms' || g.area === 'organism') &&
    g.rights.includes(right) &&
    (consentMatchPattern(g.pattern, key) || g.pattern === organismId || consentMatchPattern(g.pattern, organismId)),
  );
}

/**
 * May this GEAI write `key`? Flat keys (the GEAI's own eco: working namespace) are always allowed.
 * An `organism.*` key (a deposit into the owner's shared area) requires a matching data-area grant
 * (area 'organisms'/'organism', 'write' right, pattern glob-matching the key or the organism id).
 */
export async function ecoMayWriteKey(storage: Storage, geai: string, key: string): Promise<boolean> {
  if (!key.startsWith('organism.')) return true; // the GEAI's own namespace — free, no grant needed
  const app = await storage.getEcosystemApp(geai);
  if (!app) return false; // unknown GEAI — deny the cross-namespace deposit
  return grantsCover(app.dataAreas ?? [], key, 'write');
}

/**
 * May this GEAI READ `key`? (Model A / strict.) Flat keys (the GEAI's own eco: working namespace) are
 * always allowed — a GEAI must be able to read back its own working data with no grant. An `organism.*`
 * key requires a matching `read` data-area grant, mirroring {@link ecoMayWriteKey}. The GEAI otherwise
 * rides its owner's organism membership, so this is the ONLY thing that makes the owner-selected read
 * allowlist actually bite. Callers MUST guard with a GEAI check first (a non-GEAI has no EcosystemApp
 * record and would be wrongly denied).
 */
export async function ecoMayReadKey(storage: Storage, geai: string, key: string): Promise<boolean> {
  if (!key.startsWith('organism.')) return true; // the GEAI's own namespace — free, no grant needed
  const app = await storage.getEcosystemApp(geai);
  if (!app) return false; // unknown GEAI — deny the cross-namespace read
  return grantsCover(app.dataAreas ?? [], key, 'read');
}
