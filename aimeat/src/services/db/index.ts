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
import { MemoryDbService } from './memory-db-service.js';
import { resolveOwnerIdentities } from './owner-identity.js';

export { MemoryDbService } from './memory-db-service.js';
export { MemoryRepository } from '../../storage/repositories-impl/memory-repository.js';
export { LegacyMemoryAdapter } from '../../storage/adapter/legacy-memory-adapter.js';
export { AgentDbService, createAgentDbService } from './agent-db-service.js';
export { HomeDashboardService, createHomeDashboardService } from './home-dashboard-service.js';
export { MessagingDbService, createMessagingDbService, type OwnerConversation } from './messaging-db-service.js';
export { MessagesInboxService, createMessagesInboxService, type InboxOverview } from './messages-inbox-db-service.js';
export { AccessTabService, createAccessTabService, type AccessOverview } from './access-tab-db-service.js';
export { WalletTabService, createWalletTabService, type WalletOverview } from './wallet-tab-db-service.js';
export { MemoryTabService, createMemoryTabService, type MemoryTabOverview } from './memory-tab-db-service.js';
export { loadOwnerAgents, loadOwnerEcoApps, resolveOwnerIdentities } from './owner-identity.js';

/** Assemble the memory Application-DB-Service over the given storage (Phase 0: LegacyMemoryAdapter). Its
 *  owner-scope identity resolution is the shared IdentityMap-aware {@link ./owner-identity.js} source —
 *  the same one AgentDbService and usage-summary use — so the list is built once per operation. */
export function createMemoryDbService(storage: Storage, config: Pick<AimeatConfig, 'nodeId'>): MemoryDbService {
  const adapter = new LegacyMemoryAdapter(storage);
  const repo = new MemoryRepository(adapter);
  return new MemoryDbService(repo, {
    nodeId: config.nodeId,
    resolveOwnerIdentities: (ownerName: string) => resolveOwnerIdentities(storage, config.nodeId, ownerName),
  });
}
