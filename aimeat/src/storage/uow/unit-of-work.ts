/**
 * @file src/storage/uow/unit-of-work.ts
 * @description Operation-scoped read state. It owns one {@link ./identity-map.js IdentityMap} so a
 *   shared entity (the owner's agent list, an organism, a manifest) is read ONCE per operation and
 *   reused by every service composed into it. An `AsyncLocalStorage` binding lets deep code reach the
 *   current scope without threading it through every call; `getCurrentUow()` returns undefined outside
 *   any scope, so the same service code works for a lone caller and a composite alike.
 *
 *   READ ONLY. This opens no transaction and never did: the write half (a Transactor seam whose only
 *   implementation ran the callback directly, plus `runInUnitOfWork`, `UnitOfWork.run` and a
 *   BatchLoader registry) was scaffolding for a phase that was never built, had zero call sites, and
 *   was removed on 2026-08-11. Multi-step atomicity belongs on `Storage.transaction()`, not here.
 *
 * @structure
 *   - UnitOfWork: the identity map for one operation
 *   - getCurrentUow / runInReadScope: AsyncLocalStorage binding of the active scope
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
 *   v2.0.0 — 2026-08-11 — Removed the unused write half. `runInUnitOfWork` had 0 call sites in src,
 *     test and scripts; `Transactor.withTransaction`'s only implementation was `return fn()`, so the
 *     "transaction boundary" this file advertised never existed; `uow.loader()` and the whole
 *     BatchLoader class had 0 call sites (its unit test tested an unreachable class). Keeping them
 *     told every reader that multi-step writes were atomic, which they are not.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { IdentityMap } from './identity-map.js';

/** One operation's shared read state. Not reused across operations. */
export class UnitOfWork {
  /** Entities read once and reused for the operation's lifetime. */
  readonly identity = new IdentityMap();
}

/** Binds the active scope to the async context so nested code can find it without prop-drilling. */
const uowStore = new AsyncLocalStorage<UnitOfWork>();

/** The scope for the current operation, or undefined when running outside one (direct-read fallback). */
export function getCurrentUow(): UnitOfWork | undefined {
  return uowStore.getStore();
}

/**
 * Bind a fresh {@link UnitOfWork} (its {@link IdentityMap}) to the async context for a READ-only whole
 * operation, and run `fn` inside it. A composite that fans across several domains (e.g. the profile
 * home dashboard) uses this so a shared entity — the owner's agent list, which ~60 handlers each
 * re-read — is loaded ONCE by the first domain service and served from the map to the rest. Nested
 * reads reach the map via {@link getCurrentUow}; outside any scope they fall back to a direct storage
 * read, so the same service code works either way.
 */
export function runInReadScope<T>(fn: () => Promise<T>): Promise<T> {
  return uowStore.run(new UnitOfWork(), fn);
}
