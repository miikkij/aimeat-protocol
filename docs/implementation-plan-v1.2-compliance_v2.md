# AIMEAT v1.2 — Implementation Compliance Audit v2

**Audit date:** 2026-02-25  
**Compared against:** `docs/implementation-plan-v1.2-compliance.md` (9 phases, 27 gaps from v1 audit)  
**Build status:** Clean (`tsc --noEmit` 0 errors, 49/49 unit tests, 0 ESLint errors / 95 warnings)  

---

## Executive Summary

| Phase | Planned Items | Implemented | Status |
|-------|:---:|:---:|:---:|
| 1 — Enforcement Fixes | 3 | 3 | ✅ COMPLETE |
| 2 — OpenAPI Spec Alignment | 3 | 3 | ✅ COMPLETE |
| 3 — Validation & Schema Layer | 2 | 2 | ✅ COMPLETE |
| 4 — Developer Tooling | 4 | 3.5 | ⚠️ PARTIAL |
| 5 — Rate Limiting Tiers | 4 | 3 | ⚠️ PARTIAL |
| 6 — MongoDB/Prisma Adapter | 3 | 3 | ✅ COMPLETE |
| 7 — Federation Routing | 2 | 1.5 | ⚠️ PARTIAL |
| 8 — Remaining RFC Features | 3 | 2.5 | ⚠️ PARTIAL |
| 9 — Test Coverage Expansion | 2 | 1 | ⚠️ PARTIAL |

**Previous audit gaps resolved: 22/27 (81%)**  
**Remaining gaps: 12 items (5 from original audit + 7 newly identified)**

---

## Fully Complete Phases

### Phase 1 — Enforcement Fixes ✅

| Item | Status | Evidence |
|------|:---:|---------|
| 1.1 Memory TTL enforcement | ✅ | `getMemory()`, `listMemory()`, `searchMemory()` all filter expired via `isMemoryExpired()`. Background job every 5m. |
| 1.2 Board post TTL enforcement | ✅ | `listPosts()` filters expired. **Separate** background job every 10m (was wrong at 5m — now fixed). |
| 1.3 Dispute auto-escalation | ✅ | Background job: 7 days → `escalated`, 30 days → `timeout_resolved` + escrow return. Audit trail with `actor: 'system'`. |

### Phase 2 — OpenAPI Spec Alignment ✅

| Item | Status | Evidence |
|------|:---:|---------|
| 2.1 Missing paths (13 endpoints) | ✅ | All 13 paths present in `openapi.yaml` (health, OTK, chunked upload, admin). |
| 2.2 MCP OAuth paths (5 endpoints) | ✅ | `/v1/mcp/register`, `/v1/mcp/authorize`, `/v1/mcp/token`, `/v1/mcp/token/revoke`, `/.well-known/oauth-authorization-server` — all documented. |
| 2.3 Wallet history alias | ✅ | `/v1/wallet/history` GET documented in `openapi.yaml`. |

### Phase 3 — Validation & Schema Layer ✅

| Item | Status | Evidence |
|------|:---:|---------|
| 3.1a Zod schemas in `schemas.ts` | ✅ | 25+ schemas + `validateBody()` middleware exported. |
| 3.1b Route files use schemas | ✅ | 12/12 route files import and use `validateBody()`. 22 POST/PUT endpoints protected. |
| 3.2 `/v1/validate` uses Zod | ✅ | Rewritten with `SCHEMA_MAP` covering 25 endpoints, uses `safeParse()`. |

### Phase 6 — MongoDB/Prisma Adapter ✅

| Item | Status | Evidence |
|------|:---:|---------|
| 6.1 Prisma schema + deps | ✅ | `prisma/schema.prisma` exists. `prisma` v6.9.0 in devDeps, `@prisma/client` v6.9.0 in optionalDeps. `db:generate` and `db:push` scripts in package.json. |
| 6.2 MongoDB storage | ✅ | `src/storage/mongodb.ts` implements full `Storage` interface (70 methods). |
| 6.3 Storage selection | ✅ | `server.ts` checks `config.dbUrl` → MongoStorage or InMemoryStorage. |

---

## Partially Complete Phases — Remaining Gaps

### Phase 4 — Developer Tooling ⚠️

| Item | Status | Detail |
|------|:---:|--------|
| 4.1 `openapi-typescript` in devDeps | ✅ | v7.8.0 installed |
| 4.1 `generate:types` script | ✅ | In package.json |
| 4.1 `src/generated/api-types.ts` | ❌ **NOT GENERATED** | Script exists but file has never been generated. Not blocking but plan says "Run and commit the output". |
| 4.2 vitest | ✅ | v4.0.18, 6 test files, 49 tests |
| 4.3 ESLint | ✅ | eslint v10.0.2, config + lint script present |
| 4.4 CLI enhancements | ✅ | `init`, `backup`, `restore` subcommands implemented |

### Phase 5 — Rate Limiting Tiers ⚠️

| Item | Status | Detail |
|------|:---:|--------|
| 5.1a Per-endpoint rate limits | ✅ | 5 tiers applied (global, auth, work, memory, boards) in `server.ts` |
| 5.1a `rateLimits` in admin config | ✅ | In `allowedKeys` for `PUT /v1/admin/config` |
| 5.1a `rateLimits` in MeatConfig | ✅ | `RateLimitsConfig` with 5 named tiers in `config.ts` |
| 5.1b Tier 0/1/2 differentiation | ❌ **NOT DONE** | All authenticated users get same limits regardless of role. RFC 6.6 specifies Tier 0 (generous, read-only), Tier 1 (moderate), Tier 2 (high). No role-based differentiation exists. |

### Phase 7 — Federation Routing ⚠️

| Item | Status | Detail |
|------|:---:|--------|
| 7.1a `resolveGaii()` function | ✅ | Exists in `services/federation.ts` with cache (5min TTL), local check, peer broadcast |
| 7.1b `POST /v1/federation/route` | ✅ | Implemented with max hops, relay routing, 1 morsel/hop fee |
| 7.1c `GET /v1/federation/resolve/:gaii` | ✅ | Local → node hint → peer broadcast resolution |
| 7.1d **Work request forwarding** | ❌ **NOT DONE** | `POST /v1/work/request` does NOT call `resolveGaii()`. No remote provider detection. If `provider_gaii` is on a peer node, work request silently fails with "action not found". Cross-node work is broken. |
| 7.2a Heartbeat job called | ✅ | `startHeartbeatJob(config, peers)` called in `server.ts` |
| 7.2b Consecutive failure tracking | ✅ | `peerFailures` Map: 3 → degraded, 10 → offline, success → reset |
| 7.2c Peers Map shared | ✅ | Created in `server.ts`, passed to both `federationRouter` and `startHeartbeatJob` |

### Phase 8 — Remaining RFC Features ⚠️

| Item | Status | Detail |
|------|:---:|--------|
| 8.1a `POST /v1/agents/:gaii/port` | ✅ | Endpoint exists, deducts 50 morsels, stores `__redirect__` pointer in memory |
| 8.1b Redirect pointer storage | ✅ | `__redirect__` key with `target_node_url`, `target_node_id`, `ported_at` |
| 8.1c Porting fee deduction | ✅ | 50 morsels, checks balance (402 if insufficient), records 'spent' transaction |
| 8.1d **301 redirect on old GAII** | ❌ **NOT DONE** | `GET /v1/agents/:gaii` does NOT check for `__redirect__` key. Old GAII returns 404 instead of 301. Redirect pointer is stored but never consumed. |
| 8.2a `POST /v1/owners/:name/recover` | ✅ | Operator-only, generates new keypair, fires `owner_recovery` hook |
| 8.2b `POST /v1/agents/:gaii/rekey` | ✅ | Owner auth, generates new keypair, fires `agent_rekey` hook |
| 8.3a Core/Extended endpoint tags | ✅ | Bootstrap response includes `tier: 'core'` or `tier: 'extended'` for all endpoints |
| 8.3b **Disable extended features toggle** | ❌ **NOT DONE** | No `extendedFeaturesEnabled` field in MeatConfig. Only `keyedBrowseEnabled` exists. Operators cannot disable extended features (federation, storage, disputes) as a group. |

### Phase 9 — Test Coverage Expansion ⚠️

| Item | Status | Detail |
|------|:---:|--------|
| 9.2a `trust.test.ts` | ✅ | 6 tests (default score, no work, successful deliveries, new agent cap, disputes penalty, bounds) |
| 9.2b `otk.test.ts` | ✅ | 4 tests (prefix, hex, uniqueness, length) |
| 9.2c Other unit test files | ✅ | `morsel.test.ts` (6), `gaii.test.ts` (21), `tracking-code.test.ts` (5), `envelope.test.ts` (8) |
| 9.1 **E2E test additions (9 scenarios)** | ❌ **NOT DONE** | None of the 9 planned E2E additions exist |

---

## Complete Gap List — Items NOT Done

### HIGH Priority

| # | Phase | Item | Impact |
|---|:---:|------|--------|
| 1 | 7.1d | **Work request forwarding to remote nodes** | `POST /v1/work/request` never calls `resolveGaii()`. Cross-node work is non-functional. `resolveGaii()` is dead code. |
| 2 | 8.1d | **301 redirect on ported GAII** | `GET /v1/agents/:gaii` returns 404 for ported agents instead of 301. `__redirect__` pointer stored but never consumed. |

### MEDIUM Priority

| # | Phase | Item | Impact |
|---|:---:|------|--------|
| 3 | 5.1b | **Tier 0/1/2 role-based rate limits** | All users get same limits. RFC specifies different tiers by role (public/owner/operator). |
| 4 | 8.3b | **Extended features toggle** | No way to disable extended features (federation, storage, disputes) as a group via admin config. |
| 5 | 9.1 | **9 E2E test scenarios not added** | Memory TTL, Board TTL, Dispute escalation, Chunked upload, Action PUT, HEAD storage, Error paths, Optimistic locking conflict, Rate limit 429 |

### LOW Priority

| # | Phase | Item | Impact |
|---|:---:|------|--------|
| 6 | 4.1 | **`src/generated/api-types.ts` not generated** | Script exists but output file wasn't generated and committed. Non-blocking. |

---

## Corrections to Original Plan

The implementation plan contained one inaccuracy that was silently corrected:

| Plan Says | RFC Says | Implementation |
|-----------|----------|---------------|
| `WorkRatingSchema: { score: 1-5, feedback? }` | Rating: `positive` or `negative` (RFC §3, line 505) | `{ rating: enum('positive','negative'), comment? }` — **Matches RFC, not plan** ✅ |

---

## Build Verification Results

```
TypeScript:  npx tsc --noEmit         → 0 errors ✅
Unit Tests:  npx vitest run           → 49 passed (6 files, 440ms) ✅
ESLint:      npx eslint src/          → 0 errors, 95 warnings ✅
                                        (95 warnings are pre-existing: mostly no-explicit-any in mongodb.ts)
E2E Tests:   test/e2e-full.ts         → 35 tests (requires running server)
```

---

## Summary

**22 of 27 original audit gaps have been resolved.**  
**6 remaining gaps** (2 HIGH, 3 MEDIUM, 1 LOW) documented above. The two HIGH items are both related to federation/portability — the infrastructure exists but the final wiring (routing work requests and consuming redirect pointers) is missing.

---

*Generated from full compliance audit — 2026-02-25*
