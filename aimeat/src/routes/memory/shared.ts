/**
 * @file src/routes/memory/shared.ts
 * @description Shared context type + small pure helpers for the memory route group modules. Extracted from src/routes/memory.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/memory.ts (max-file-lines)
 */

import type { RequestHandler } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { StatsCollector } from '../../services/stats.js';
import type { MemoryDbService } from '../../services/db/memory-db-service.js';

/** Context shared by every memory route group module (closed-over deps from memoryRouter). */
export interface MemoryRouteCtx {
  config: AimeatConfig;
  storage: Storage;
  /** Application-DB-Service for the memory domain (data-access redesign) — the batched whole-operations
   *  (owner-scope reads, bulk write) the routes call instead of hitting storage directly. */
  memoryDb: MemoryDbService;
  stats?: StatsCollector;
  onDirectoryChange?: () => void;
  peers?: Map<string, import('../../services/federation.js').PeerInfo>;
  /** Resolve effective identity for memory operations — owner sessions use GHII, agents use GAII */
  resolve: (req: Express.Request) => string;
  /** Phase 2.3 — Workspace access middleware for organism.* namespace keys */
  workspaceAccess: RequestHandler;
}

/** Anonymous agents (shared#anonymous@...) may only write to keys prefixed with "anonymous." */
export function isAnonymousGaii(gaii: string): boolean {
  return gaii.includes('#anonymous@');
}

/** Map memory visibility to DMZ zone (Phase 0.6) */
export function visibilityToZone(visibility: string): 'private' | 'dmz' | 'federation' {
  switch (visibility) {
    case 'private': return 'private';
    case 'owner': return 'dmz';
    case 'group': return 'dmz';
    case 'workspace': return 'dmz'; // node-local: readable by workspace members, never federated
    case 'members': return 'dmz'; // node-local: never replicated to federation
    case 'public': return 'federation';
    default: return 'private';
  }
}
