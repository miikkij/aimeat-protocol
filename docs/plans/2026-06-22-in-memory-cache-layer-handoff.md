# Handoff: a generic server-side in-memory cache layer for repeated reads

**Status:** Not started — research + design only. Hand this whole file to a fresh Claude Code session as the prompt.
**Created:** 2026-06-22
**Author of research:** prior session that shipped the profile Home "Usage & quotas" card.

---

## Why this exists

Several read endpoints recompute the **same expensive result on every page load / poll**, hammering the
DB with full table scans and per-record work even though the answer barely changes second-to-second.
The profile dashboard alone re-derives memory byte-sums, storage byte-sums, agent lists, and counts on
each visit. We already proved the pattern is worth it: the new `GET /v1/owner/usage`
([src/services/usage-summary.ts](../../aimeat/src/services/usage-summary.ts)) wraps its expensive
computation in a **single-purpose 60s TTL `Map` cache** and the profile Home card now polls it freely.

That one-off cache should become a **small, reusable cache layer** so every hot read path can opt in with
one line, instead of each endpoint hand-rolling its own `Map` + timestamp logic (which we now have in at
least four places — see "Prior art" below).

**Goal:** one tiny utility (`cached(key, ttl, () => compute())` + tag-based invalidation), adopted by the
handful of hottest read paths, measurably cutting DB calls per page load with no correctness regressions.

**Non-goals:** distributed/Redis cache (single-process node — see "Scaling"), caching writes, or caching
anything per-request-identity-sensitive without keying on the identity.

---

## Hard constraints (read before designing)

1. **Single Node process per node.** In-memory state is process-local and that's fine — the node is one
   Express process; there is no clustering for app logic. Federation/relay coordinate out-of-band (Consul
   for config, peer protocol for data), NOT shared app cache. So a plain in-process `Map` is coherent.
   **Do not** add Redis/memcached/`lru-cache`/`node-cache` — `package.json` has none and we don't want one
   unless a measured need appears. Build on native `Map` + `Date.now()`.
2. **Correctness over freshness, but bounded staleness.** A cached value MUST be invalidated (or expired)
   when the underlying data changes in a way a user would notice within a reasonable window. Use TTL as the
   backstop and event-bus tags as the precise invalidation (below).
3. **Per-identity keys.** Anything owner/agent-scoped MUST include the owner/GAII in the cache key, or one
   user will see another's data. (The usage cache keys by `ownerName`.)
4. **Campsite + project rules still apply:** file headers (Rule 2), ESLint (Rule 7), OpenAPI unaffected
   (no contract change — caching is transparent), and **E2E proving cache hit + invalidation** (Rule 1).
   Add tests on SQLite and MongoDB.
5. **Graceful, observable.** Expose a way to clear/inspect the cache (for tests and an admin stat), and
   never let a cache bug wedge a request — a compute error must propagate, not poison the entry forever.

---

## Prior art already in the repo (reuse the shapes, don't reinvent)

| Pattern | File | TTL / flush | Notes |
|---|---|---|---|
| TTL `Map` (revocation L1) | `aimeat/src/auth/jwt.ts` | 60s + periodic sweep | Closest to what we want: `Map<token,{revoked,cachedAt}>`, TTL check on read, interval cleanup. |
| Single-purpose usage cache | `aimeat/src/services/usage-summary.ts` | 60s | The thing to generalize. `Map<owner,{summary,expiresAt}>`. |
| Interval flush buffer | `aimeat/src/services/telemetry-buffer.ts` | 60s flush | Write-batching, not read-cache, but same lifecycle/shutdown discipline. |
| Interval flush buffer | `aimeat/src/services/consent-audit-buffer.ts` | 60s flush | Bounded queue + drop counter — copy the "never throw on the hot path" stance. |
| Public stats micro-caches | `aimeat/src/routes/public-stats.ts` | 10/30/60s | Already hand-rolled per-endpoint caches — prime candidates to migrate onto the new util. |

**Invalidation signal already exists:** the event bus
([src/services/event-bus.ts](../../aimeat/src/services/event-bus.ts)) emits `emitChange(domain, ownerGaii?)`
on every mutation (`'memory'`, `'agents'`, `'organisms'`, `'files'`, …). Writes already call it (e.g.
`memory.ts` emits `emitChange('memory')` after a write). The cache layer can subscribe and drop matching
entries on the precise domain — TTL is then just the backstop for anything we forget to tag.

---

## Hot read paths to migrate (measured candidates from research)

Ordered by bang-for-buck. Each currently runs on every relevant page load / poll.

1. **`GET /v1/owner/usage`** — already cached; migrate it onto the new util as the first adopter (proves
   parity). Invalidate on `emitChange('memory'|'files'|'agents'|'organisms', ownerGhii)`.
2. **`GET /v1/memory?count=true`** — `storage.countMemory()` per dashboard load. Cache per owner-scope key
   set; invalidate on `emitChange('memory', ownerGaii)`.
3. **Catalogue full scans** — `GET /v1/catalogue/agents|boards|directory|hash` and `GET /v1/stats`
   ([src/routes/catalogue.ts](../../aimeat/src/routes/catalogue.ts)) all call `storage.listAgents()` /
   `listBoards()` / `listActions()` (full table scans), some polled every 5–30s by federation/clients.
   Cache the node-global lists; invalidate on `emitChange('agents'|'boards'|'actions')` (no owner key —
   these are global).
4. **`public-stats.ts`** — migrate its three existing ad-hoc caches onto the util (dedupe code).
5. **Wallet `in_escrow`** ([src/routes/wallet.ts](../../aimeat/src/routes/wallet.ts)) — scans all the
   owner's agents' work items via `calculateEscrow()`. Cache per owner; invalidate on work/wallet changes.

Don't try to do all of these in one PR. Land the util + adopters #1 and #2 with tests; then a second pass
for #3–#5.

---

## Suggested design (adjust as you learn)

Create `aimeat/src/services/cache.ts`:

```ts
// Tiny process-local TTL cache with tag-based invalidation. Single-process node → coherent.
interface Entry { value: unknown; expiresAt: number; tags: string[]; }
const store = new Map<string, Entry>();
const byTag = new Map<string, Set<string>>(); // tag -> cache keys (for O(1)-ish invalidation)

export async function cached<T>(
  key: string,
  ttlMs: number,
  compute: () => Promise<T>,
  tags: string[] = [],
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;
  const value = await compute();              // errors propagate; we do NOT cache failures
  store.set(key, { value, expiresAt: now + ttlMs, tags });
  for (const tag of tags) {
    let keys = byTag.get(tag);
    if (!keys) { keys = new Set(); byTag.set(tag, keys); }
    keys.add(key);
  }
  return value;
}

export function invalidateTag(tag: string): void { /* drop every key under tag + clean reverse index */ }
export function invalidateKey(key: string): void { /* drop one */ }
export function clearCache(): void { /* tests/shutdown */ }
export function cacheStats(): { entries: number; tags: number } { /* admin/observability */ }
```

(This is illustrative pseudo-code for shape — flesh out `invalidateTag`/sweep/bounds before use.)

**Wire invalidation once, centrally** (e.g. in `server-bootstrap` after the event bus exists):

```ts
onChange((domain, ownerGaii) => {
  invalidateTag(`domain:${domain}`);
  if (ownerGaii) invalidateTag(`owner:${ownerOf(ownerGaii)}:${domain}`);
});
```

Then an adopter is one line:

```ts
const summary = await cached(
  `usage:${ownerName}`, 60_000,
  () => computeOwnerUsageSummary(config, storage, ownerName),
  [`owner:${ownerName}:memory`, `owner:${ownerName}:files`, `owner:${ownerName}:agents`, `owner:${ownerName}:organisms`],
);
```

**TTL policy:** keep a small set of named TTLs (e.g. `TTL.dashboard = 60s`, `TTL.catalogue = 30s`,
`TTL.public = 10s`) rather than magic numbers scattered around. Consider an env knob
(`AIMEAT_CACHE_DEFAULT_TTL_MS`) wired through `config.ts` + the init-wizard checklist
([docs/coding-guidelines/init-wizard.md](../coding-guidelines/init-wizard.md)) — but only if you actually
need it configurable; otherwise constants are fine.

**Memory safety:** entries are tiny and TTL-bounded, but add a periodic sweep (like `jwt.ts`) that drops
expired entries so the `Map` can't grow unbounded under high key cardinality (e.g. one key per owner on a
big node). Cap total entries and evict oldest if exceeded (the consent buffer's "bounded + drop counter"
stance is the reference).

---

## Acceptance criteria

- [ ] `cache.ts` util with `cached()`, `invalidateTag()`, `invalidateKey()`, `clearCache()`, `cacheStats()`, periodic expiry sweep, bounded size. File header present; passes lint + typecheck.
- [ ] Central event-bus → invalidation wiring (one subscription translating `emitChange` into `invalidateTag`).
- [ ] `usage-summary.ts` and `GET /v1/memory?count=true` migrated onto the util (remove their hand-rolled caches). Behaviour identical.
- [ ] E2E (SQLite **and** MongoDB) proving: (a) second read within TTL is a cache hit (e.g. same `cached_at` / no extra DB work), and (b) a relevant write **invalidates** the entry so the next read reflects it **before** the TTL would have expired. The existing `aimeat/test/e2e-owner-usage.ts` already asserts (a) for usage — extend it for (b).
- [ ] An admin/ops way to see `cacheStats()` (e.g. fold into `GET /v1/stats` gauges) so cache health is observable.
- [ ] Short note in `docs/coding-guidelines/architecture.md` (or a new caching guide) documenting when to reach for `cached()` and the keying/tagging convention.

## Watch out for

- **Stale-after-write** is the classic bug: if you cache `owner:X:memory` but a write emits
  `emitChange('memory')` **without** the owner, your tag won't match. Verify every hot write path passes
  `ownerGaii` to `emitChange`, or invalidate the broad `domain:memory` tag as a safety net.
- **Owner-scope identity:** usage/memory caches are keyed by the human owner, but writes happen under
  agent/eco GAIIs. Map GAII → owner when invalidating (see `parseGaiiLoose` / the owner-scope helpers in
  `src/services/owner-memory.ts`).
- **Don't cache 401/403/empty-due-to-error** as if they were real results — only cache successful computes.
- **Tests must not bleed:** call `clearCache()` between suites (it's process-global like the other buffers).

---

## Pointers

- Generalize from: `aimeat/src/services/usage-summary.ts`, `aimeat/src/auth/jwt.ts` (TTL map + sweep).
- Invalidation source: `aimeat/src/services/event-bus.ts` (`emitChange`, `onChange` if present, else add a subscriber).
- Adopters: `aimeat/src/routes/memory.ts` (count), `aimeat/src/routes/catalogue.ts`, `aimeat/src/routes/public-stats.ts`, `aimeat/src/routes/wallet.ts`.
- Wiring point: `aimeat/src/server-bootstrap/routes-loader.ts` (where buffers like telemetry/consent are init'd).
- Test harness shape: `aimeat/test/e2e-owner-usage.ts`.
