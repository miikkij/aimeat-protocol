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
import { cached, invalidateKey, TTL } from './cache.js';
import { readAllowance, remainingOf } from './ai-allowance.js';
import { loadOwnerAgents, loadOwnerEcoApps } from './db/owner-identity.js';
import { runInReadScope } from '../storage/read-scope/read-scope.js';

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
  /**
   * The AI limit a person actually has, which was the one quota they could not see anywhere.
   *
   * `own_key` true means there is no house limit at all: their own OpenRouter key pays and nothing
   * here applies. Otherwise the node's key pays until the allowance is gone, and `remaining_usd` is
   * how much of it is left. The grant is once per person and never renews, so a bar that fills is
   * a bar that stays full — which is exactly what a person needs to see coming.
   */
  ai: {
    own_key: boolean;
    granted_usd: number;
    spent_usd: number;
    remaining_usd: number;
    percent: number;
  };
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
  // Shared IdentityMap-aware loaders: inside a read scope (the home dashboard composite) the agent/eco
  // lists are already resolved by AgentDbService, so this reuses them instead of a second fetch; a lone
  // GET /v1/owner/usage call falls back to a direct read. Either way one source, no duplication.
  const agents = await loadOwnerAgents(storage, ownerName);
  const ecoApps = await loadOwnerEcoApps(storage, ownerName);
  // Owner-scope identities: the human's GHII + every agent + every ecosystem app. Usage is keyed by
  // the writer, so the owner's true footprint is the union (mirrors GET /v1/memory owner-scope).
  const identities = [ghii, ...agents.map(a => a.gaii), ...ecoApps.map(e => e.geai)];

  // ── Memory (keys cheap via COUNT DISTINCT; bytes summed DB-side across ALL identities in one go) ──
  // Previously: countMemory + one sumMemoryBytes PER identity (an owner with ~100 agents = ~100 serial
  // round-trips just for the byte total). Now a single cross-identity aggregate.
  const usedKeys = await storage.countMemory(identities);
  const memBytes = await storage.sumMemoryBytesForOwners(identities);
  const memMax = config.memoryQuotaMb * 1024 * 1024;

  // ── Storage files / micro-memory / actions — each a SINGLE cross-identity aggregate ──
  // Previously one listStorageFiles + listMicroMemorySets(+bytes) per identity + listActionsByProvider
  // per agent — for an owner with ~100 agents that was ~250-400 queries per cache-miss (the profiler
  // showed 268, dominated by ~130 micro-memory calls). Now: one sum for storage, one for micro, one
  // count for actions. Everything runs concurrently.
  const storageMax = config.storageQuotaMb * 1024 * 1024;
  const microMax = config.microMemoryQuotaKb * 1024;

  const [
    storageAgg, microAgg, services,
    organismsList, appsResult, extensionsList, cortexesList, ghiiRecord,
  ] = await Promise.all([
    storage.sumStorageBytesForOwners(identities),
    storage.getMicroMemoryTotalForOwners(identities),
    storage.countActionsForProviders(agents.map(a => a.gaii)),
    storage.listOrganisms({ member: ownerName, perPage: 10000 }),
    storage.listApps({ ownerGaii: ghii, limit: 1 }),
    storage.listExtensions(),
    storage.listCortexExtensions({ installedBy: ownerName }),
    storage.getGHIIByOwner(ownerName),
  ]);

  // The AI allowance, read through the same function the chat status uses so the two can never
  // disagree about a number the person is told twice.
  const [allowance, ownKeyRecord] = await Promise.all([
    readAllowance(storage, config, ghii),
    storage.getMemory(ghii, 'openrouter.apikey'),
  ]);
  const allowanceRemaining = remainingOf(allowance);

  const storageBytes = storageAgg.bytes, storageFiles = storageAgg.count;
  const microBytes = microAgg.bytes, microSets = microAgg.sets;

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
    ai: {
      own_key: !!ownKeyRecord,
      granted_usd: allowance.granted_usd,
      spent_usd: allowance.spent_usd,
      remaining_usd: allowanceRemaining,
      percent: pct(allowance.spent_usd, allowance.granted_usd),
    },
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
    // A read scope around the whole recompute: it fans across agents, memory, files and the ledger,
    // and loadOwnerAgents was already written to read through an IdentityMap — it just never had one
    // bound, so every call fell through to a direct read. Nested under an outer scope (the home
    // dashboard opens one) this joins it rather than starting a second.
    () => runInReadScope(() => computeOwnerUsageSummary(config, storage, ownerName)),
    usageTags(ownerName),
  );
}

/** Drop one owner's cached summary (force a fresh recompute on next read). */
export function invalidateOwnerUsage(ownerName: string): void {
  invalidateKey(usageKey(ownerName));
}
