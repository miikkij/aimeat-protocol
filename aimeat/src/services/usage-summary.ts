/**
 * @file usage-summary.ts
 * @description Owner-scoped usage + quota + count summary for the profile Home dashboard.
 *   Aggregates the EXPENSIVE-to-compute usage figures (memory byte-sum, storage byte-sum,
 *   micro-memory byte-sum — each a full scan) together with cheap counts (agents, organisms,
 *   apps, extensions, cortexes, services, morsels) into ONE payload, behind a short-lived
 *   in-memory TTL cache keyed by owner. The home page polls this on load / live-update; without
 *   the cache every visit would re-scan the owner's whole keyspace.
 *
 *   This is a LOCAL, single-purpose cache (one map, one TTL). A general reusable cache layer for
 *   the many other repeated-read hot paths is deliberately deferred — see
 *   docs/plans/2026-06-22-in-memory-cache-layer-handoff.md.
 * @structure
 *   - getOwnerUsageSummary(config, storage, ownerName) — cached summary (computes on miss/expiry)
 *   - invalidateOwnerUsage(ownerName) — drop one owner's cache entry (e.g. after a big delete)
 *   - USAGE_CACHE_TTL_MS — cache lifetime (60s; staleness up to a minute is acceptable here)
 * @usage import { getOwnerUsageSummary } from '../services/usage-summary.js';
 * @version-history
 *   v1.0.0 — 2026-06-22 — Initial: quota usage (memory/storage/micro-memory) + counts + morsels,
 *     60s TTL in-memory cache, for the profile Home usage card.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { getMemoryTotalBytes, getStorageTotalBytes, getMicroMemoryTotalBytes } from './quota.js';

/** How long a computed summary stays fresh. A minute of staleness is fine for a dashboard and keeps
 *  the full-scan byte computations off the request hot path on repeated visits. */
export const USAGE_CACHE_TTL_MS = 60_000;

export interface QuotaUsage {
  used_bytes: number;
  max_bytes: number;
  /** 0–100, clamped; -1 when max is unbounded/unknown. */
  percent: number;
}

export interface OwnerUsageSummary {
  owner: string;
  memory: QuotaUsage & { used_keys: number; max_keys: number };
  storage: QuotaUsage & { used_files: number };
  micro_memory: QuotaUsage & { used_sets: number; max_sets: number };
  counts: {
    agents: number;
    organisms: number;
    apps: { used: number; max: number };
    ecosystem_apps: number;
    extensions: { used: number; max: number };
    cortexes: number;
    services: { used: number; max: number };
  };
  /** Morsel balance is also shown in the profile stats bar; included here for client completeness. */
  morsels: { balance: number };
  cached_at: string;
  ttl_seconds: number;
}

interface CacheEntry { summary: OwnerUsageSummary; expiresAt: number; }
const cache = new Map<string, CacheEntry>();

const pct = (used: number, max: number): number =>
  max > 0 ? Math.min(100, Math.round((used / max) * 100)) : -1;

/** Compute the summary fresh (no cache). Several of these calls are full scans — callers should go
 *  through {@link getOwnerUsageSummary} so repeated visits hit the cache instead. */
async function computeOwnerUsageSummary(
  config: AimeatConfig, storage: Storage, ownerName: string,
): Promise<OwnerUsageSummary> {
  const ghii = `${ownerName}@${config.nodeId}`;
  const agents = await storage.getAgentsByOwner(ownerName);
  const ecoApps = await storage.getEcosystemAppsByOwner(ownerName);
  // Owner-scope identities: the human's GHII + every agent + every ecosystem app. Usage is keyed by
  // the writer, so the owner's true footprint is the union (mirrors GET /v1/memory owner-scope).
  const identities = [ghii, ...agents.map(a => a.gaii), ...ecoApps.map(e => e.geai)];

  // ── Memory (keys cheap via COUNT DISTINCT; bytes are a full scan per identity) ──
  const usedKeys = await storage.countMemory(identities);
  let memBytes = 0;
  for (const id of identities) memBytes += await getMemoryTotalBytes(storage, id);
  const memMax = config.memoryQuotaMb * 1024 * 1024;

  // ── Storage files (sum size + count across identities) ──
  let storageBytes = 0, storageFiles = 0;
  for (const id of identities) {
    const files = await storage.listStorageFiles(id);
    storageFiles += files.length;
    for (const f of files) storageBytes += f.size;
  }
  const storageMax = config.storageQuotaMb * 1024 * 1024;

  // ── Micro-memory (sum bytes + set count) ──
  let microBytes = 0, microSets = 0;
  for (const id of identities) {
    microBytes += await getMicroMemoryTotalBytes(storage, id);
    microSets += (await storage.listMicroMemorySets(id)).length;
  }
  const microMax = config.microMemoryQuotaKb * 1024;

  // ── Counts ──
  const organisms = (await storage.listOrganisms({ member: ownerName, perPage: 10000 })).length;
  const apps = (await storage.listApps({ ownerGaii: ghii, limit: 1 })).total;
  const extensions = (await storage.listExtensions()).filter(e => e.installedBy === ownerName).length;
  const cortexes = (await storage.listCortexExtensions({ installedBy: ownerName })).length;
  let services = 0;
  for (const a of agents) services += (await storage.listActionsByProvider(a.gaii)).length;

  const ghiiRecord = await storage.getGHIIByOwner(ownerName);

  return {
    owner: ownerName,
    memory: { used_keys: usedKeys, max_keys: config.memoryMaxKeysPerAgent, used_bytes: memBytes, max_bytes: memMax, percent: pct(memBytes, memMax) },
    storage: { used_files: storageFiles, used_bytes: storageBytes, max_bytes: storageMax, percent: pct(storageBytes, storageMax) },
    micro_memory: { used_sets: microSets, max_sets: config.microMemoryMaxSetsPerAgent, used_bytes: microBytes, max_bytes: microMax, percent: pct(microBytes, microMax) },
    counts: {
      agents: agents.length,
      organisms,
      apps: { used: apps, max: config.maxAppsPerAgent },
      ecosystem_apps: ecoApps.length,
      extensions: { used: extensions, max: config.maxExtensionsPerOwner },
      cortexes,
      services: { used: services, max: config.maxActionsPerAgent },
    },
    morsels: { balance: ghiiRecord?.morselBalance ?? 0 },
    cached_at: new Date().toISOString(),
    ttl_seconds: Math.round(USAGE_CACHE_TTL_MS / 1000),
  };
}

/** Cached owner usage summary. Returns a cached copy while fresh (< {@link USAGE_CACHE_TTL_MS}),
 *  recomputing on miss/expiry. Safe to call on every dashboard load. */
export async function getOwnerUsageSummary(
  config: AimeatConfig, storage: Storage, ownerName: string,
): Promise<OwnerUsageSummary> {
  const hit = cache.get(ownerName);
  const now = Date.now();
  if (hit && hit.expiresAt > now) return hit.summary;
  const summary = await computeOwnerUsageSummary(config, storage, ownerName);
  cache.set(ownerName, { summary, expiresAt: now + USAGE_CACHE_TTL_MS });
  return summary;
}

/** Drop one owner's cached summary (force a fresh recompute on next read). */
export function invalidateOwnerUsage(ownerName: string): void {
  cache.delete(ownerName);
}

/** Clear the whole cache (tests / shutdown). */
export function clearOwnerUsageCache(): void {
  cache.clear();
}
