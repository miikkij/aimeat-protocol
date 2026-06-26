/**
 * @file owner-memory.ts
 * @description Owner-scope memory aggregation: the union of an owner's GHII keyspace and every one
 *   of the owner's agents' keyspaces, deduped by key (GHII wins). This is the SAME view
 *   `GET /v1/memory?owner_scope=true` returns — memory is keyed by the WRITER's identity, so a
 *   coordinator/owner that needs to see what its agents produced must read across all of them. This
 *   is the single shared read path (same-owner-access invariant): the memory route AND the workflow
 *   signal evaluator both go through here so they can't diverge.
 * @structure
 *   - listOwnerScopeMemory(storage, nodeId, ownerName, opts) — aggregated list (deduped, GHII-first)
 *   - getOwnerScopeMemory(storage, nodeId, ownerName, key) — one key across owner+agents (GHII-first)
 * @usage import { listOwnerScopeMemory, getOwnerScopeMemory } from '../services/owner-memory.js';
 * @version-history
 *   v1.0.0 — 2026-06-13 — Extracted from routes/memory.ts owner-scope branch; reused by the workflow
 *     signal evaluator (fix: signals must read owner-scope, not the owner GHII keyspace alone).
 *   v1.1.0 — 2026-06-14 — Fold the owner's ecosystem apps (GEAIs) into the owner-scope union
 *     (ecosystem-apps foundation, chunk 1).
 */
import type { Storage, MemoryRecord } from '../storage/interface.js';

export interface OwnerScopeListOpts {
  prefix?: string;
  visibility?: string;
  tags?: string[];
  maxFlags?: number;
  archived?: import('../storage/interface.js').ArchiveFilter;
}

/**
 * List memory across the owner's GHII + all the owner's agents, deduped by key (GHII first, then
 * agents in storage order). The owner sees all their own data regardless of visibility — exactly the
 * set `aimeat_memory_list { owner_scope: true }` returns.
 */
export async function listOwnerScopeMemory(
  storage: Storage, nodeId: string, ownerName: string, opts?: OwnerScopeListOpts,
): Promise<MemoryRecord[]> {
  const ownerGhii = `${ownerName}@${nodeId}`;
  const agents = await storage.getAgentsByOwner(ownerName);
  const ecoApps = await storage.getEcosystemAppsByOwner(ownerName);
  // The owner owns their GEAIs' data the same way they own their agents' — via aggregation. A GEAI
  // writes into its own eco: namespace (resolveIdentity returns its sub verbatim), so its writes are
  // only visible to the owner through this union.
  const identities = [ownerGhii, ...agents.map(a => a.gaii), ...ecoApps.map(e => e.geai)];
  const seen = new Set<string>();
  const out: MemoryRecord[] = [];
  for (const id of identities) {
    const recs = await storage.listMemory(id, opts);
    for (const r of recs) {
      if (!seen.has(r.key)) { seen.add(r.key); out.push(r); }
    }
  }
  return out;
}

/** Read ONE key across the owner's GHII + all the owner's agents (GHII first). null if found nowhere. */
export async function getOwnerScopeMemory(
  storage: Storage, nodeId: string, ownerName: string, key: string,
): Promise<MemoryRecord | null> {
  const ownerGhii = `${ownerName}@${nodeId}`;
  const ghii = await storage.getMemory(ownerGhii, key);
  if (ghii) return ghii;
  const agents = await storage.getAgentsByOwner(ownerName);
  for (const agent of agents) {
    const rec = await storage.getMemory(agent.gaii, key);
    if (rec) return rec;
  }
  const ecoApps = await storage.getEcosystemAppsByOwner(ownerName);
  for (const app of ecoApps) {
    const rec = await storage.getMemory(app.geai, key);
    if (rec) return rec;
  }
  return null;
}
