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
 *   - getOwnerScopePublicMemory(storage, nodeId, ownerName, key) — first PUBLIC record for a key across
 *       owner+agents (GHII-first); a non-public record never shadows a public one (anonymous serve paths)
 * @usage import { listOwnerScopeMemory, getOwnerScopeMemory } from '../services/owner-memory.js';
 * @version-history
 *   v1.0.0 — 2026-06-13 — Extracted from routes/memory.ts owner-scope branch; reused by the workflow
 *     signal evaluator (fix: signals must read owner-scope, not the owner GHII keyspace alone).
 *   v1.1.0 — 2026-06-14 — Fold the owner's ecosystem apps (GEAIs) into the owner-scope union
 *     (ecosystem-apps foundation, chunk 1).
 *   v1.2.0 — 2026-07-14 — Add listOwnerScopeMemoryMeta (value-free owner-scope listing) for ?include=meta.
 *   v1.3.0 — 2026-07-21 — Add getOwnerScopePublicMemory so anonymous public-serve paths (agent face) can
 *     resolve a record an owner's AGENT published under its own GAII — a non-public record never shadows
 *     a public one on the same key.
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
  // Not under the owner's GHII — look across every agent + ecosystem app in ONE query. Previously this
  // was one getMemory PER identity (an owner with ~60 agents = ~60 serial round-trips just to read one
  // key that isn't there). `prefix: key` + an exact-key filter finds the key wherever it lives; GHII was
  // already checked, so agents/eco keep their listing-order precedence.
  const agents = await storage.getAgentsByOwner(ownerName);
  const ecoApps = await storage.getEcosystemAppsByOwner(ownerName);
  const others = [...agents.map(a => a.gaii), ...ecoApps.map(e => e.geai)];
  if (!others.length) return null;
  const rows = (await storage.listMemoryForOwners(others, { prefix: key })).filter(r => r.key === key);
  if (!rows.length) return null;
  const priority = new Map(others.map((id, i) => [id, i]));
  rows.sort((a, b) => (priority.get(a.ownerGaii) ?? others.length) - (priority.get(b.ownerGaii) ?? others.length));
  return rows[0];
}

/**
 * Read the first PUBLIC record for an exact key across the owner's GHII + all the owner's agents + eco
 * apps, GHII-first. Unlike {@link getOwnerScopeMemory}, a NON-public record on the same key never
 * shadows a public one — so this must NOT short-circuit on the GHII copy (a private GHII record must not
 * hide a public agent record). One query across the whole union, then filter to `visibility === 'public'`
 * and pick the highest-priority (GHII-first) survivor. null if no public copy exists anywhere.
 *
 * Used by anonymous public-serve paths (the Agent Face) where only `visibility:'public'` is servable and
 * an owner's agent may have written the record under its own GAII (memory is keyed by the writer).
 */
export async function getOwnerScopePublicMemory(
  storage: Storage, nodeId: string, ownerName: string, key: string,
): Promise<MemoryRecord | null> {
  const ownerGhii = `${ownerName}@${nodeId}`;
  const agents = await storage.getAgentsByOwner(ownerName);
  const ecoApps = await storage.getEcosystemAppsByOwner(ownerName);
  const identities = [ownerGhii, ...agents.map(a => a.gaii), ...ecoApps.map(e => e.geai)];
  const rows = (await storage.listMemoryForOwners(identities, { prefix: key, visibility: 'public' }))
    .filter(r => r.key === key);
  if (!rows.length) return null;
  const priority = new Map(identities.map((id, i) => [id, i]));
  rows.sort((a, b) => (priority.get(a.ownerGaii) ?? identities.length) - (priority.get(b.ownerGaii) ?? identities.length));
  return rows[0];
}
