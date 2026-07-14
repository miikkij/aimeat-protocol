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
 *   v1.2.0 — 2026-07-14 — Add listOwnerScopeMemoryMeta (value-free owner-scope listing) for ?include=meta.
 */
import type { Storage, MemoryRecord } from '../storage/interface.js';
import type { MemoryMetaRow } from '../storage/repositories/memory.repository.js';

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
  // ONE query across all identities (was one listMemory per identity), then dedup by key GHII-first.
  const rows = await storage.listMemoryForOwners(identities, opts);
  return dedupGhiiFirst(rows, identities);
}

/** Order rows by identity priority (GHII first, then agents, then eco apps — the `identities` order)
 *  and keep the first occurrence of each key, so the GHII copy wins when a key exists under several
 *  identities. Mirrors the old per-identity loop's GHII-first dedup. */
function dedupGhiiFirst<T extends { key: string; ownerGaii: string }>(rows: T[], identities: string[]): T[] {
  const priority = new Map(identities.map((id, i) => [id, i]));
  const ranked = [...rows].sort((a, b) => (priority.get(a.ownerGaii) ?? identities.length) - (priority.get(b.ownerGaii) ?? identities.length));
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of ranked) { if (!seen.has(r.key)) { seen.add(r.key); out.push(r); } }
  return out;
}

/**
 * Owner-scope META listing — the same union + key-dedup as {@link listOwnerScopeMemory}, but each
 * identity is read with `listMemoryMeta` so NO value is ever loaded (backs `?include=meta`). Returns
 * lightweight rows carrying the stored `byteSize`, so the caller can total quota usage without
 * serialising anything.
 */
export async function listOwnerScopeMemoryMeta(
  storage: Storage, nodeId: string, ownerName: string, opts?: OwnerScopeListOpts,
): Promise<MemoryMetaRow[]> {
  const ownerGhii = `${ownerName}@${nodeId}`;
  const agents = await storage.getAgentsByOwner(ownerName);
  const ecoApps = await storage.getEcosystemAppsByOwner(ownerName);
  const identities = [ownerGhii, ...agents.map(a => a.gaii), ...ecoApps.map(e => e.geai)];
  // ONE value-free query across all identities, then dedup by key GHII-first.
  const rows = await storage.listMemoryMetaForOwners(identities, opts);
  return dedupGhiiFirst(rows, identities);
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
