/**
 * @file src/storage/schema-lock-cache.ts
 * @description Process-level cache of ALL schema locks. `findApplicableSchema` runs on EVERY memory
 *   write (validateMemoryWrite) and otherwise loads the full prefix-schema set + probes several exact
 *   keys against the DB per call (~8 round-trips). Schema locks change only when a workspace/schema is
 *   (re)defined, so we cache the whole set and resolve matches in-memory — zero DB per write after warm-up.
 *   A short TTL is a safety net; setSchema/deleteSchema invalidate immediately. Shared by every backend's
 *   findApplicableSchema (the matching logic stays in each provider; only the lock SOURCE is cached).
 * @structure getCachedSchemaLocks() / setCachedSchemaLocks(locks) / invalidateSchemaLockCache()
 * @usage
 *   let locks = getCachedSchemaLocks();
 *   if (!locks) { locks = await this.listSchemas(); setCachedSchemaLocks(locks); }
 *   // …match exact/prefix/wildcard against `locks` in memory…
 * @version-history
 *   v1.0.0 — 2026-07-15 — Initial: cache schema locks to keep findApplicableSchema off the DB per write.
 */
import type { SchemaRecord } from './interface.js';

let cached: SchemaRecord[] | null = null;
let loadedAtMs = 0;
const TTL_MS = 30_000;

/** The cached full lock set, or null if empty/expired (caller loads + {@link setCachedSchemaLocks}). */
export function getCachedSchemaLocks(): SchemaRecord[] | null {
  if (cached && Date.now() - loadedAtMs < TTL_MS) return cached;
  return null;
}

/** Populate the cache with the full lock set just loaded from storage. */
export function setCachedSchemaLocks(locks: SchemaRecord[]): void {
  cached = locks;
  loadedAtMs = Date.now();
}

/** Drop the cache — called by setSchema/deleteSchema so a new/removed lock takes effect immediately. */
export function invalidateSchemaLockCache(): void {
  cached = null;
}
