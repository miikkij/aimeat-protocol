/**
 * @file cache.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Tiny process-local TTL cache with tag-based invalidation, for the handful of hot
 *   READ paths that recompute the same expensive result on every page load / poll (owner usage
 *   summary, memory counts, catalogue scans, …). The node is a single Express process — there is no
 *   app-logic clustering (federation/relay coordinate out-of-band), so a plain in-process `Map` is
 *   coherent and we deliberately add NO Redis/memcached/lru-cache dependency. Build on `Map` +
 *   `Date.now()` only.
 *
 *   Correctness over freshness, but bounded staleness: a cached value is dropped either when the
 *   TTL expires (backstop) or when a matching invalidation tag fires (precise). The event bus is
 *   wired to translate `emitChange(domain, ownerGaii?)` into `invalidateTag('domain:<d>')` (+ the
 *   owner-scoped tag when present) in routes-loader, so writes evict stale reads BEFORE the TTL
 *   would have. Per-identity entries MUST include the owner/GAII in their key (one user must never
 *   read another's cached value).
 * @structure
 *   - cached(key, ttlMs, compute, tags?) — read-through: returns the fresh value or computes+stores
 *   - invalidateTag(tag) / invalidateKey(key) — precise eviction (event-bus driven + ad hoc)
 *   - clearCache() — drop everything (tests / shutdown)
 *   - cacheStats() — { entries, tags, evictions } for /v1/stats observability
 *   - shutdownCache() — stop the expiry sweep (graceful exit); TTL constants in `TTL`
 * @usage
 *   import { cached, TTL } from '../services/cache.js';
 *   const summary = await cached(`usage:${owner}`, TTL.dashboard, () => compute(owner),
 *     [`owner:${owner}:memory`, `owner:${owner}:files`]);
 *   SINGLE FLIGHT. Readers that miss the same key while it is being computed wait for that one run
 *   and get its answer, as a reader that arrives just after it gets the stored value. A run whose
 *   tag or key was invalidated while it ran still answers the readers that were waiting, as it always
 *   answered its own caller, but is not stored, and the next reader computes afresh. A run that fails
 *   fails its own caller only: each waiting reader then computes for itself, as before.
 * @version-history
 *   v1.1.0 — 2026-11-04 — Single flight for concurrent misses of one key; MEMORY_ANY_LEVEL_TAG for
 *     entries that read memory records of any level across owners (codebase analysis 2026-11-03,
 *     item C4).
 *   v1.0.0 — 2026-06-22 — Initial generic cache layer (generalizes usage-summary.ts's one-off
 *     60s map; first adopters: GET /v1/owner/usage + GET /v1/memory?count=true).
 */
import { logger } from '../utils/logger.js';

/** Named TTLs so call sites read intent, not magic numbers. */
export const TTL = {
  /** Dashboard summaries (usage card, memory counts) — a minute of staleness is fine. */
  dashboard: 60_000,
  /** Catalogue/federation full scans polled every 5–30s by peers/clients. */
  catalogue: 30_000,
  /** Public landing data — kept short so the node never looks stale to visitors. */
  public: 10_000,
} as const;

/**
 * The tag of an entry computed from memory records of ANY level across owners (private ones
 * included), such as the catalogue's dataset facts. Every memory change drops it, also one that only
 * its owner reads, which leaves the plain `domain:memory` entries in place
 * (server-bootstrap/process-buffers.ts). An entry for one owner's records uses that owner's tag
 * (`owner:<name>:memory`) instead.
 */
export const MEMORY_ANY_LEVEL_TAG = 'domain:memory:any-level';

/** Hard ceiling on entries: entries are tiny + TTL-bounded, but key cardinality (one per owner on a
 *  big node) could otherwise grow the map without bound. Oldest-inserted entries evict past this. */
const MAX_ENTRIES = 5_000;

/** Expired-entry sweep cadence (backstop for entries no invalidation tag ever matched). */
const SWEEP_INTERVAL_MS = 60_000;

interface Entry {
  value: unknown;
  expiresAt: number;
  tags: string[];
}

const store = new Map<string, Entry>();
/** Reverse index tag -> set of cache keys, for near-O(1) tag invalidation. */
const byTag = new Map<string, Set<string>>();
/** Count of entries dropped by the size cap (observability — a high number means MAX_ENTRIES is low). */
let evictions = 0;

/** A compute in progress for one key. `current` turns false when its key or a tag is invalidated. */
interface Flight { value: Promise<unknown>; tags: string[]; current: boolean }
/** Key -> the compute in progress, so concurrent misses of one key run it once. */
// process-local: each process shares its own computes; a second process computes its own once.
const inFlight = new Map<string, Flight>();

/** Detach the flights that carry `tag` (or every flight): their result is not stored. */
function detachFlights(match: (key: string, flight: Flight) => boolean): void {
  for (const [key, flight] of inFlight) {
    if (!match(key, flight)) continue;
    flight.current = false;
    inFlight.delete(key);
  }
}

/** Remove one entry and detach it from every tag's reverse-index set. */
function removeEntry(key: string): void {
  const entry = store.get(key);
  if (!entry) return;
  store.delete(key);
  for (const tag of entry.tags) {
    const keys = byTag.get(tag);
    if (!keys) continue;
    keys.delete(key);
    if (keys.size === 0) byTag.delete(tag);
  }
}

/**
 * Read-through cache. Returns the cached value while fresh (< ttlMs old); otherwise runs `compute`,
 * stores the result under `key` with the given `tags`, and returns it.
 *
 * Failures are NEVER cached: if `compute` throws, the error propagates and no entry is written, so a
 * transient storage error can't poison the key for the whole TTL. Only successful computes are stored.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  compute: () => Promise<T>,
  tags: string[] = [],
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;

  // Another reader is computing this key now: wait for its answer. If that run fails, this reader
  // computes for itself, as it did before single flight; the failure stays the first reader's.
  const running = inFlight.get(key);
  if (running) {
    try {
      return await running.value as T;
    } catch (err) {
      logger.debug('cache: the run this reader waited for failed; the reader computes for itself', { key, error: String(err) });
      return computeAndStore(key, ttlMs, compute, tags, null);
    }
  }

  const flight: Flight = { value: Promise.resolve(), tags, current: true };
  // Registered before this function yields, so a reader arriving while compute() runs joins it.
  const value = computeAndStore(key, ttlMs, compute, tags, flight);
  flight.value = value;
  inFlight.set(key, flight);
  // A failed run is not kept, and its waiters see the rejection; this branch only clears the slot.
  value.then(
    () => { if (inFlight.get(key) === flight) inFlight.delete(key); },
    () => { if (inFlight.get(key) === flight) inFlight.delete(key); },
  );
  return value;
}

/** Run `compute`, store its value unless `flight` was invalidated meanwhile, and answer it. */
async function computeAndStore<T>(
  key: string,
  ttlMs: number,
  compute: () => Promise<T>,
  tags: string[],
  flight: Flight | null,
): Promise<T> {
  const value = await compute(); // errors propagate; we do NOT cache failures

  // Invalidated while it ran: the answer goes to the readers who asked, and is not stored, so the
  // next reader computes from what the write left.
  if (flight && !flight.current) return value;

  // Re-key under the same tags. If the key already existed (expired), detach its old tag links first
  // so a changed tag set can't leave stale reverse-index entries.
  if (store.has(key)) removeEntry(key);

  store.set(key, { value, expiresAt: Date.now() + ttlMs, tags });
  for (const tag of tags) {
    let keys = byTag.get(tag);
    if (!keys) { keys = new Set(); byTag.set(tag, keys); }
    keys.add(key);
  }

  // Bound the map: evict oldest-inserted entries (Map preserves insertion order) past the cap.
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    removeEntry(oldest);
    evictions++;
  }

  return value;
}

/** Drop every entry carrying `tag` (and clean the reverse index). The primary invalidation path. */
export function invalidateTag(tag: string): void {
  // A run in progress for an entry with this tag computed from what the change replaced.
  if (inFlight.size > 0) detachFlights((_key, flight) => flight.tags.includes(tag));
  const keys = byTag.get(tag);
  if (!keys) return;
  // Copy first — removeEntry mutates the set we'd otherwise iterate.
  for (const key of [...keys]) removeEntry(key);
  byTag.delete(tag);
}

/** Drop a single entry by exact key. */
export function invalidateKey(key: string): void {
  if (inFlight.size > 0) detachFlights((k) => k === key);
  removeEntry(key);
}

/** Clear the entire cache (tests / shutdown — process-global like the other in-memory buffers). */
export function clearCache(): void {
  detachFlights(() => true);
  store.clear();
  byTag.clear();
  evictions = 0;
}

/** Snapshot for observability (folded into GET /v1/stats gauges). */
export function cacheStats(): { entries: number; tags: number; evictions: number } {
  return { entries: store.size, tags: byTag.size, evictions };
}

/** Drop entries whose TTL has elapsed but that no invalidation tag ever matched. */
function sweepExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) removeEntry(key);
  }
}

// Self-starting expiry sweep. unref() so it never keeps the process alive on its own (matters for
// in-process E2E servers and graceful shutdown), mirroring jwt.ts's revocation-cache cleanup.
let sweepTimer: ReturnType<typeof setInterval> | null = setInterval(sweepExpired, SWEEP_INTERVAL_MS);
sweepTimer.unref?.();

/** Stop the expiry sweep (graceful shutdown). The cache stays usable; only the timer is cleared. */
export function shutdownCache(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
