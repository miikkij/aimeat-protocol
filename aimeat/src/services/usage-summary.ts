/**
 * @file usage-summary.ts
 * @description Owner-scoped usage + quota + count summary for the profile Home dashboard.
 *   Aggregates the EXPENSIVE-to-compute usage figures (memory byte-sum, storage byte-sum,
 *   micro-memory byte-sum — each a full scan) together with cheap counts (agents, organisms,
 *   apps, extensions, cortexes, services, morsels) into ONE payload, behind a short-lived
 *   in-memory TTL cache keyed by owner. The home page polls this on load / live-update; without
 *   the cache every visit would re-scan the owner's whole keyspace.
 *
 *   The 60s TTL + per-owner key + invalidation now ride the generic cache layer (services/cache.ts);
 *   this file just supplies the compute + the keying/tagging convention.
 * @structure
 *   - getOwnerUsageSummary(config, storage, ownerName) — cached summary (computes on miss/expiry)
 *   - invalidateOwnerUsage(ownerName) — drop one owner's cache entry (e.g. after a big delete)
 *   - USAGE_CACHE_TTL_MS — cache lifetime (60s; staleness up to a minute is acceptable here)
 * @usage import { getOwnerUsageSummary } from '../services/usage-summary.js';
 * @version-history
 *   v1.0.0 — 2026-06-22 — Initial: quota usage (memory/storage/micro-memory) + counts + morsels,
 *     60s TTL in-memory cache, for the profile Home usage card.
 *   v1.1.0 — 2026-06-22 — Migrate the hand-rolled Map cache onto the generic cache layer
 *     (services/cache.ts): same 60s TTL, now invalidated precisely by event-bus tags.
 *   v1.2.0 — 2026-07-14 — Perf: memory bytes via a single sumMemoryBytesForOwners aggregate; the
 *     storage/micro/actions/counts fan-outs run concurrently (Promise.all) instead of ~500 serial
 *     round-trips per cache-miss.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { getMicroMemoryTotalBytes } from './quota.js';
import { cached, invalidateKey, TTL } from './cache.js';

/** How long a computed summary stays fresh. A minute of staleness is fine for a dashboard and keeps
 *  the full-scan byte computations off the request hot path on repeated visits. */
export const USAGE_CACHE_TTL_MS = TTL.dashboard;

/** Cache key for one owner's usage summary. */
const usageKey = (ownerName: string) => `usage:${ownerName}`;

/** Tags this summary is invalidated by. Domain-level tags fire on ANY write in that domain (the
 *  memory/agents/etc. write paths broadcast `emitChange(domain)` without an owner — safety net);
 *  the owner-scoped tags fire when a write does carry the owner (precise). Either drops this entry
 *  before its TTL, so the card reflects a fresh delete/write on the next poll. */
const usageTags = (ownerName: string): string[] => {
  const domains = ['memory', 'files', 'agents', 'organisms'];
  return [...domains.map(d => `domain:${d}`), ...domains.map(d => `owner:${ownerName}:${d}`)];
};

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

  // ── Memory (keys cheap via COUNT DISTINCT; bytes summed DB-side across ALL identities in one go) ──
  // Previously: countMemory + one sumMemoryBytes PER identity (an owner with ~100 agents = ~100 serial
  // round-trips just for the byte total). Now a single cross-identity aggregate.
  const usedKeys = await storage.countMemory(identities);
  const memBytes = await storage.sumMemoryBytesForOwners(identities);
  const memMax = config.memoryQuotaMb * 1024 * 1024;

  // ── Storage files / micro-memory / actions ──
  // These still enumerate per identity, but CONCURRENTLY (Promise.all) rather than one-await-at-a-time,
  // so the whole fan-out costs ~one round-trip of latency instead of summing ~400 serial ones (the bulk
  // of the old ~1.3s cache-miss). Row volumes per identity are small (files/actions/micro-sets), so a
  // load-then-count here is not a scale risk the way the memory value-scan was.
  const storageMax = config.storageQuotaMb * 1024 * 1024;
  const microMax = config.microMemoryQuotaKb * 1024;

  const [
    fileLists, microByteList, microSetLists, actionLists,
    organismsList, appsResult, extensionsList, cortexesList, ghiiRecord,
  ] = await Promise.all([
    Promise.all(identities.map(id => storage.listStorageFiles(id))),
    Promise.all(identities.map(id => getMicroMemoryTotalBytes(storage, id))),
    Promise.all(identities.map(id => storage.listMicroMemorySets(id))),
    Promise.all(agents.map(a => storage.listActionsByProvider(a.gaii))),
    storage.listOrganisms({ member: ownerName, perPage: 10000 }),
    storage.listApps({ ownerGaii: ghii, limit: 1 }),
    storage.listExtensions(),
    storage.listCortexExtensions({ installedBy: ownerName }),
    storage.getGHIIByOwner(ownerName),
  ]);

  let storageBytes = 0, storageFiles = 0;
  for (const files of fileLists) { storageFiles += files.length; for (const f of files) storageBytes += f.size; }
  const microBytes = microByteList.reduce((a, b) => a + b, 0);
  const microSets = microSetLists.reduce((a, sets) => a + sets.length, 0);
  const services = actionLists.reduce((a, list) => a + list.length, 0);

  // ── Counts ──
  const organisms = organismsList.length;
  const apps = appsResult.total;
  const extensions = extensionsList.filter(e => e.installedBy === ownerName).length;
  const cortexes = cortexesList.length;

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
  return cached(
    usageKey(ownerName),
    USAGE_CACHE_TTL_MS,
    () => computeOwnerUsageSummary(config, storage, ownerName),
    usageTags(ownerName),
  );
}

/** Drop one owner's cached summary (force a fresh recompute on next read). */
export function invalidateOwnerUsage(ownerName: string): void {
  invalidateKey(usageKey(ownerName));
}
