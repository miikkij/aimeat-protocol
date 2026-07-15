/**
 * @file src/services/db/index.ts
 * @description Factory + barrel for the Application DB Service layer. `createMemoryDbService(storage,
 *   config)` assembles the full stack — wraps the existing `Storage` in a
 *   {@link ../../storage/adapter/legacy-memory-adapter.js LegacyMemoryAdapter}, layers the
 *   backend-agnostic {@link ../../storage/repositories-impl/memory-repository.js MemoryRepository}, and
 *   returns a {@link ./memory-db-service.js MemoryDbService} with owner-identity resolution backed by
 *   storage. This is the ONE wiring seam the routes migrate onto in Phase 1 (they call the service
 *   instead of storage); building it here keeps the assembly in a single place and off the request path
 *   until then.
 *
 * @structure createMemoryDbService(storage, config) → MemoryDbService; re-exports of the layer types
 * @usage const memoryDb = createMemoryDbService(storage, config);
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 0 scaffolding: assemble adapter → repository → service.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { LegacyMemoryAdapter } from '../../storage/adapter/legacy-memory-adapter.js';
import { MemoryRepository } from '../../storage/repositories-impl/memory-repository.js';
import { MemoryDbService, type OwnerIdentityResolver } from './memory-db-service.js';

export { MemoryDbService } from './memory-db-service.js';
export { MemoryRepository } from '../../storage/repositories-impl/memory-repository.js';
export { LegacyMemoryAdapter } from '../../storage/adapter/legacy-memory-adapter.js';

/**
 * The owner-scope identity list backed by storage: the owner's GHII first, then each agent's GAII, then
 * each ecosystem app's GEAI — the exact order (and set) services/owner-memory.ts builds, so the
 * GHII-first dedup behaves identically. Kept here (not in the memory service) so the memory domain
 * doesn't reach into the agent/eco domains directly.
 */
function ownerIdentityResolver(storage: Storage, nodeId: string): OwnerIdentityResolver {
  return async (ownerName: string): Promise<string[]> => {
    const [agents, ecoApps] = await Promise.all([
      storage.getAgentsByOwner(ownerName),
      storage.getEcosystemAppsByOwner(ownerName),
    ]);
    return [`${ownerName}@${nodeId}`, ...agents.map(a => a.gaii), ...ecoApps.map(e => e.geai)];
  };
}

/** Assemble the memory Application-DB-Service over the given storage (Phase 0: LegacyMemoryAdapter). */
export function createMemoryDbService(storage: Storage, config: Pick<AimeatConfig, 'nodeId'>): MemoryDbService {
  const adapter = new LegacyMemoryAdapter(storage);
  const repo = new MemoryRepository(adapter);
  return new MemoryDbService(repo, {
    nodeId: config.nodeId,
    resolveOwnerIdentities: ownerIdentityResolver(storage, config.nodeId),
  });
}
