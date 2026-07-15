/**
 * @file src/storage/uow/unit-of-work.ts
 * @description Unit of Work — the transaction-scoped state that ties one whole operation together. It
 *   owns (1) an {@link ./identity-map.js IdentityMap} so shared entities are read once, (2) a registry
 *   of named {@link ./batch-loader.js BatchLoader}s so fan-out reads coalesce into single IN queries,
 *   and (3) the transaction boundary via a {@link ../adapter/memory-adapter.js Transactor}. A domain
 *   service runs a multi-step operation with `uow.run(fn)`: everything inside sees one identity map and
 *   one transaction. An `AsyncLocalStorage` binding lets deep code reach the current UoW without
 *   threading it through every call, while `getCurrentUow()` returns undefined outside any operation
 *   (so callers fall back to direct reads — Phase 0 coexistence).
 *
 * @structure
 *   - UnitOfWork: identity map + loader registry + run(fn) (wraps Transactor.withTransaction)
 *   - runWithUow / getCurrentUow: AsyncLocalStorage binding of the active UoW
 * @usage
 *   await runInUnitOfWork(adapter, async (uow) => {
 *     const org = await uow.identity.getOrLoad('organism', id, () => load(id));
 *     // … stage writes … then adapter.bulkUpsert(rows) inside the same transaction
 *   });
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 0 scaffolding: UoW over the memory adapter (Transactor seam).
 *   v1.1.0 — 2026-07-15 — Phase 3: runInReadScope — bind an IdentityMap to the async context for a
 *     READ composite (a home dashboard fanning across domains) so a shared entity (the owner's agent
 *     list) is read ONCE and reused, WITHOUT opening a write transaction.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Transactor } from '../adapter/memory-adapter.js';
import { BatchLoader } from './batch-loader.js';
import { IdentityMap } from './identity-map.js';

/** One operation's shared state. Not reused across operations. */
export class UnitOfWork {
  /** Entities read once and reused for the operation's lifetime. */
  readonly identity = new IdentityMap();
  /** Named batch loaders, created lazily and reused within the operation. */
  private readonly loaders = new Map<string, BatchLoader<unknown, unknown>>();

  constructor(private readonly transactor: Transactor) {}

  /**
   * Get (or lazily create) a named batch loader for this operation. The name namespaces the loader so
   * the same fan-out (e.g. `memory:byOwnerKey`) coalesces across the whole operation; `batchFn` is used
   * only on first creation.
   */
  loader<K, V>(name: string, batchFn: (keys: K[]) => Promise<(V | Error)[]>, opts?: { cache?: boolean; keyFn?: (key: K) => string }): BatchLoader<K, V> {
    let loader = this.loaders.get(name) as BatchLoader<K, V> | undefined;
    if (!loader) {
      loader = new BatchLoader<K, V>(batchFn, opts);
      this.loaders.set(name, loader as BatchLoader<unknown, unknown>);
    }
    return loader;
  }

  /** Run `fn` inside the adapter's transaction boundary. `fn` receives this UoW. */
  run<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    return this.transactor.withTransaction(() => fn(this));
  }
}

/** Binds the active UoW to the async context so nested code can find it without prop-drilling. */
const uowStore = new AsyncLocalStorage<UnitOfWork>();

/** The UoW for the current operation, or undefined when running outside one (direct-read fallback). */
export function getCurrentUow(): UnitOfWork | undefined {
  return uowStore.getStore();
}

/** Run `fn` with `uow` bound as the current UoW for its entire async subtree. */
export function runWithUow<T>(uow: UnitOfWork, fn: () => Promise<T>): Promise<T> {
  return uowStore.run(uow, fn);
}

/**
 * Convenience: create a UoW over `transactor`, bind it to the async context, and run `fn` inside the
 * transaction. This is the normal entry point for a whole operation.
 */
export function runInUnitOfWork<T>(transactor: Transactor, fn: (uow: UnitOfWork) => Promise<T>): Promise<T> {
  const uow = new UnitOfWork(transactor);
  return runWithUow(uow, () => uow.run(fn));
}

/** A transactor that runs the callback directly — no transaction boundary. Used by read scopes, which
 *  want the IdentityMap's read-once memoisation but never write, so opening a transaction is pointless. */
const NOOP_TRANSACTOR: Transactor = { withTransaction: fn => fn() };

/**
 * Bind a fresh {@link UnitOfWork} (its {@link IdentityMap}) to the async context for a READ-only whole
 * operation, and run `fn` inside it — WITHOUT opening a transaction. A composite that fans across several
 * domains (e.g. the profile home dashboard) uses this so a shared entity — the owner's agent list, which
 * ~60 handlers each re-read — is loaded ONCE by the first domain service and served from the map to the
 * rest. Nested reads reach the map via {@link getCurrentUow}; outside any scope they fall back to a
 * direct storage read, so the same service code works either way.
 */
export function runInReadScope<T>(fn: () => Promise<T>): Promise<T> {
  return runWithUow(new UnitOfWork(NOOP_TRANSACTOR), fn);
}
