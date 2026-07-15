/**
 * @file src/storage/uow/batch-loader.ts
 * @description A minimal, dependency-free DataLoader — coalesces many individual `load(key)` calls made
 *   within the same event-loop tick into ONE batch call, turning a fan-out of N point reads into a
 *   single `IN (…)` query. This is the structural fix for the N+1 read (an owner with ~60 agents doing
 *   one getMemory per agent to read a single key). Modelled on graphql/dataloader but tiny and built on
 *   `queueMicrotask` (no new dependency — Rule 5). A loader is per-operation (created by the
 *   {@link ./unit-of-work.js UnitOfWork}); its promise cache lives only as long as the operation.
 *
 * @structure BatchLoader<K,V> — load / loadMany / prime / clear / clearAll; constructed with a batchFn
 * @usage
 *   const loader = new BatchLoader<string, MemoryRecord | null>(
 *     async (gaiis) => adapter.getByOwnersBatched(gaiis, key));   // one IN query for all queued keys
 *   const [a, b] = await Promise.all([loader.load(g1), loader.load(g2)]);   // → single batch call
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 0 scaffolding: DataLoader-style batching primitive.
 */

/**
 * Batch + cache point loads by key. `batchFn(keys)` MUST return an array of the SAME length and order
 * as `keys` (result[i] corresponds to keys[i]); a per-key Error value is thrown to that key's caller.
 * `keyFn` maps a key to its cache-identity string (default JSON) so object keys dedupe correctly.
 */
export class BatchLoader<K, V> {
  private readonly cache = new Map<string, Promise<V>>();
  private batch: { key: K; resolve: (v: V) => void; reject: (e: unknown) => void }[] | null = null;

  constructor(
    private readonly batchFn: (keys: K[]) => Promise<(V | Error)[]>,
    private readonly opts: { cache?: boolean; keyFn?: (key: K) => string } = {},
  ) {}

  private cacheKey(key: K): string {
    return this.opts.keyFn ? this.opts.keyFn(key) : (typeof key === 'string' ? key : JSON.stringify(key));
  }

  /** Queue `key` for the next batch and return a promise for its value. Identical keys share one
   *  promise (unless caching is disabled). */
  load(key: K): Promise<V> {
    const useCache = this.opts.cache !== false;
    const ck = this.cacheKey(key);
    if (useCache) {
      const hit = this.cache.get(ck);
      if (hit) return hit;
    }
    const promise = new Promise<V>((resolve, reject) => {
      if (!this.batch) {
        this.batch = [];
        // Flush after the current synchronous run — every load() issued this tick is in one batch.
        queueMicrotask(() => this.flush());
      }
      this.batch.push({ key, resolve, reject });
    });
    if (useCache) this.cache.set(ck, promise);
    return promise;
  }

  loadMany(keys: K[]): Promise<V[]> {
    return Promise.all(keys.map(k => this.load(k)));
  }

  /** Seed the cache with a known value (e.g. an entity already loaded elsewhere in the operation). */
  prime(key: K, value: V): void {
    if (this.opts.cache === false) return;
    this.cache.set(this.cacheKey(key), Promise.resolve(value));
  }

  /** Forget one key (call after a mutation so the next load re-reads it). */
  clear(key: K): void {
    this.cache.delete(this.cacheKey(key));
  }

  clearAll(): void {
    this.cache.clear();
  }

  private async flush(): Promise<void> {
    const batch = this.batch;
    this.batch = null;
    if (!batch || batch.length === 0) return;
    const keys = batch.map(b => b.key);
    try {
      const results = await this.batchFn(keys);
      if (results.length !== keys.length) {
        throw new Error(`BatchLoader batchFn returned ${results.length} results for ${keys.length} keys`);
      }
      batch.forEach((entry, i) => {
        const r = results[i];
        if (r instanceof Error) entry.reject(r);
        else entry.resolve(r);
      });
    } catch (err) {
      // A batch-level failure rejects every queued key (and evicts them so a retry can re-batch).
      for (const entry of batch) {
        entry.reject(err);
        this.cache.delete(this.cacheKey(entry.key));
      }
    }
  }
}
