/**
 * @file src/services/db/owner-identity.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ONE place an owner's agent list, ecosystem-app list, and owner-scope identity set are
 *   resolved — the fix for `getAgentsByOwner` being re-read independently by ~60 call sites (and the
 *   owner-scope identity array being re-derived in services/db/index.ts, usage-summary.ts and several
 *   handlers). Each loader is IdentityMap-aware: inside an active {@link ../../storage/read-scope/read-scope.js
 *   ReadScope} (a read scope / whole operation) it reads through the map so the list is fetched ONCE and
 *   reused by every domain service composed in that operation; outside any scope it falls back to a direct
 *   storage read, so the same code path works for a lone caller and a composite alike.
 *
 * @structure
 *   - loadOwnerAgents(storage, owner) — the owner's agents, read-once per operation
 *   - loadOwnerEcoApps(storage, owner) — the owner's ecosystem apps, read-once per operation
 *   - resolveOwnerIdentities(storage, nodeId, owner) — GHII first, then agent GAIIs, then eco GEAIs
 *     (the priority order the owner-scope GHII-first dedup relies on)
 * @usage const agents = await loadOwnerAgents(storage, owner);   // 0 extra reads inside a read scope
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 3: canonical IdentityMap-aware owner-identity loaders (dedup).
 */
import type { Storage } from '../../storage/interface.js';
import { getCurrentReadScope } from '../../storage/read-scope/read-scope.js';

type Agents = Awaited<ReturnType<Storage['getAgentsByOwner']>>;
type EcoApps = Awaited<ReturnType<Storage['getEcosystemAppsByOwner']>>;

/** The owner's agents. Memoised in the active read scope's IdentityMap (`owner-agents/<owner>`) so a composite
 *  operation reads them once; a direct storage read when no scope is bound. */
export function loadOwnerAgents(storage: Storage, owner: string): Promise<Agents> {
  const scope = getCurrentReadScope();
  return scope
    ? scope.identity.getOrLoad('owner-agents', owner, () => storage.getAgentsByOwner(owner))
    : storage.getAgentsByOwner(owner);
}

/** The owner's ecosystem apps. Memoised in the active read scope's IdentityMap (`owner-eco/<owner>`). */
export function loadOwnerEcoApps(storage: Storage, owner: string): Promise<EcoApps> {
  const scope = getCurrentReadScope();
  return scope
    ? scope.identity.getOrLoad('owner-eco', owner, () => storage.getEcosystemAppsByOwner(owner))
    : storage.getEcosystemAppsByOwner(owner);
}

/**
 * The owner-scope identity list: the human's GHII first, then each agent's GAII, then each ecosystem
 * app's GEAI. Usage/memory is keyed by the writer, so the owner's true footprint is this union, and the
 * GHII-first order is what the owner-scope dedup (GHII wins a key collision) relies on. Both underlying
 * lists resolve through the IdentityMap, so composing this alongside other agent-scoped work is free.
 */
export async function resolveOwnerIdentities(storage: Storage, nodeId: string, owner: string): Promise<string[]> {
  const [agents, ecoApps] = await Promise.all([loadOwnerAgents(storage, owner), loadOwnerEcoApps(storage, owner)]);
  return [`${owner}@${nodeId}`, ...agents.map(a => a.gaii), ...ecoApps.map(e => e.geai)];
}
