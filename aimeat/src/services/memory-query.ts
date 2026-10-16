/**
 * @file src/services/memory-query.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two memory reads that GET /v1/memory/search, GET /v1/memory and the node MCP tools
 *   aimeat_memory_search and aimeat_memory_list share: which records a text search finds, and which
 *   keys an owner-scope listing holds. One query each, so the same question finds the same records
 *   on every surface.
 *
 *   Search: the indexed word-start search (storage.searchText: tokens OR-ed as prefixes, ranked
 *   best-first). An owner-scope search covers the owner's GHII, every agent and every ecosystem app
 *   (MemoryDbService.searchOwnerScope); otherwise one identity.
 *
 *   Owner-scope listing: the owner's GHII, every agent and every ecosystem app in one query, one row
 *   per key, the GHII copy first and the shadowed copies named in `alsoUnder`
 *   (MemoryDbService.listOwnerScopeMeta). The MCP tool built this by hand until 2026-10-16: one query
 *   per agent, no ecosystem apps, and a key the owner and an agent both held listed twice.
 *
 *   What each surface still decides itself: who may ask for the owner scope, the visibility filter
 *   for a caller that does not read as the owner (ownerScopeView), the classification reader, and the
 *   shape of the answer.
 * @structure searchMemoryRecords · listMemoryMetaFor
 * @usage
 *   const hits = await searchMemoryRecords({ storage, config }, { ownerScopeOf: null, gaii, q, limit: 50 });
 *   const rows = await listMemoryMetaFor({ storage, config }, { ownerScopeOf: ownerName, gaii, prefix });
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial, out of routes/memory/crud.ts, mcp/memory-extended.ts and mcp/core.ts (QA audit D2-06).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import type { ListOpts, MemoryMetaRow } from '../storage/adapter/memory-adapter.js';
import { LegacyMemoryAdapter } from '../storage/adapter/legacy-memory-adapter.js';
import { MemoryRepository } from '../storage/repositories-impl/memory-repository.js';
import { MemoryDbService } from './db/memory-db-service.js';
import { resolveOwnerIdentities } from './db/owner-identity.js';

interface Deps { storage: Storage; config: Pick<AimeatConfig, 'nodeId'> }

/** The memory service, assembled as createMemoryDbService does; inline, because services/db/index.js
 *  re-exports modules that reach the MCP layer, and importing it from here would close an import cycle. */
function memoryDbOf(deps: Deps): MemoryDbService {
  return new MemoryDbService(new MemoryRepository(new LegacyMemoryAdapter(deps.storage)), {
    nodeId: deps.config.nodeId,
    resolveOwnerIdentities: (owner: string) => resolveOwnerIdentities(deps.storage, deps.config.nodeId, owner),
  });
}

/**
 * The records a text search finds, best match first. `ownerScopeOf` names the account whose whole
 * identity set is searched; null searches `gaii` alone.
 */
export async function searchMemoryRecords(deps: Deps, args: {
  ownerScopeOf: string | null;
  gaii: string;
  q: string;
  keyPrefix?: string;
  visibility?: string;
  maxFlags?: number;
  limit: number;
}): Promise<MemoryRecord[]> {
  const opts = { keyPrefix: args.keyPrefix, visibility: args.visibility, maxFlags: args.maxFlags, limit: args.limit };
  const memoryDb = memoryDbOf(deps);
  const hits = args.ownerScopeOf
    ? await memoryDb.searchOwnerScope(args.ownerScopeOf, args.q, opts)
    : await deps.storage.searchText(args.q, { ...opts, ownerGaiis: [args.gaii] });
  return hits.map(h => h.record);
}

/**
 * The metadata rows of a listing, no values. `ownerScopeOf` names the account whose whole identity
 * set is listed, one row per key; null lists `gaii` alone.
 */
export async function listMemoryMetaFor(deps: Deps, args: {
  ownerScopeOf: string | null;
  gaii: string;
} & ListOpts): Promise<MemoryMetaRow[]> {
  const { ownerScopeOf, gaii, ...opts } = args;
  const memoryDb = memoryDbOf(deps);
  return ownerScopeOf
    ? memoryDb.listOwnerScopeMeta(ownerScopeOf, opts)
    : deps.storage.listMemoryMeta(gaii, opts);
}
