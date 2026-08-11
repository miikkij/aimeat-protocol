/**
 * @file src/storage/read-scope/read-scope.ts
 * @description Operation-scoped read state. It owns one {@link ./identity-map.js IdentityMap} so a
 *   shared entity (the owner's agent list, an organism, a manifest) is read ONCE per operation and
 *   reused by every service composed into it. An `AsyncLocalStorage` binding lets deep code reach the
 *   current scope without threading it through every call; `getCurrentReadScope()` returns undefined
 *   outside any scope, so the same service code works for a lone caller and a composite alike.
 *
 *   READ ONLY, and the name says so on purpose. This class was called `UnitOfWork` until 2026-08-11
 *   and advertised a transaction boundary it never had: the write half (a `Transactor` seam whose one
 *   implementation was `return fn()`, plus `runInUnitOfWork`, `UnitOfWork.run` and a BatchLoader
 *   registry) had zero call sites and was removed. Multi-step atomicity is `Storage.transaction()`'s
 *   job, one level down, where both backends can implement it for real.
 *
 * @structure
 *   - ReadScope: the identity map for one operation
 *   - getCurrentReadScope / runInReadScope: AsyncLocalStorage binding of the active scope
 * @usage
 *   await runInReadScope(async () => {
 *     const agents = await loadOwnerAgents(storage, owner);   // read once, reused below
 *     …compose several domain services…
 *   });
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 0 scaffolding: UoW over the memory adapter (Transactor seam).
 *   v1.1.0 — 2026-07-15 — Phase 3: runInReadScope — bind an IdentityMap to the async context for a
 *     READ composite (a home dashboard fanning across domains) so a shared entity (the owner's agent
 *     list) is read ONCE and reused, WITHOUT opening a write transaction.
 *   v2.0.0 — 2026-08-11 — Removed the unused write half (see the note above).
 *   v2.1.0 — 2026-08-11 — Renamed UnitOfWork → ReadScope and uow/ → read-scope/. The old name is the
 *     reason the missing transaction went unnoticed for a month: a reader who saw `UnitOfWork` in the
 *     stack assumed multi-step writes were atomic and did not check.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { IdentityMap } from './identity-map.js';

/** One operation's shared read state. Not reused across operations. */
export class ReadScope {
  /** Entities read once and reused for the operation's lifetime. */
  readonly identity = new IdentityMap();
}

/** Binds the active scope to the async context so nested code can find it without prop-drilling. */
const scopeStore = new AsyncLocalStorage<ReadScope>();

/** The scope for the current operation, or undefined when running outside one (direct-read fallback). */
export function getCurrentReadScope(): ReadScope | undefined {
  return scopeStore.getStore();
}

/**
 * Bind a fresh {@link ReadScope} (its {@link IdentityMap}) to the async context for a READ-only whole
 * operation, and run `fn` inside it. A composite that fans across several domains (e.g. the profile
 * home dashboard) uses this so a shared entity — the owner's agent list, which ~60 handlers each
 * re-read — is loaded ONCE by the first domain service and served from the map to the rest. Nested
 * reads reach the map via {@link getCurrentReadScope}; outside any scope they fall back to a direct
 * storage read, so the same service code works either way.
 */
export function runInReadScope<T>(fn: () => Promise<T>): Promise<T> {
  // Nesting JOINS rather than replacing. A composite that opens a scope may be called from another
  // that already opened one (the home dashboard composes the usage summary); starting a second would
  // hand it an empty map and re-read everything the outer had already loaded — the exact cost this
  // exists to remove.
  if (scopeStore.getStore()) return fn();
  return scopeStore.run(new ReadScope(), fn);
}
