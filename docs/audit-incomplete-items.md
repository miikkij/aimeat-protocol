# AIMEAT v1.2 — Implementation Audit: Incomplete Items

**Audit date:** 2026-02-25  
**Compared against:** `docs/implementation-plan-v1.2-compliance.md`  
**Build status:** Clean (`tsc --noEmit` passes, 39/39 unit tests pass)  

---

## Summary

| Phase | Planned | Done | Gaps |
|-------|---------|------|------|
| 1 — Enforcement Fixes | 3 items | 2.5 | Board post cleanup interval wrong (5min vs 10min) |
| 2 — OpenAPI Spec | 3 sections | 1 of 3 | MCP OAuth paths + wallet alias missing |
| 3 — Validation Layer | 2 items | 0.5 | Schemas created but **never wired into routes** |
| 4 — Developer Tooling | 4 items | 3 of 4 | OpenAPI type generation missing entirely |
| 5 — Rate Limiting | 4 items | 3 of 4 | Rate limits not updatable via admin API |
| 6 — MongoDB/Prisma | 3 items | 2.5 | Missing package.json deps & db scripts |
| 7 — Federation Routing | 2 items | 1 of 2 | Work forwarding + heartbeat job not started |
| 8 — Remaining RFC | 3 items | 1 of 3 | GAII port endpoint, core/extended tagging |
| 9 — Test Coverage | 2 items | 0.5 | 2 unit test files missing, 0/9 E2E additions |

**Total gaps: 27 individual items across 9 phases.**

---

## Detailed Gap List

### Phase 1 — Enforcement Fixes

| # | Item | Status | Description |
|---|------|--------|-------------|
| 1.2a | Board post cleanup interval | ⚠️ WRONG | Runs every 5 min (combined with memory cleanup). Plan specifies **10 min** for posts. Should be a separate interval. |

---

### Phase 2 — OpenAPI Spec Alignment

| # | Item | Status | Description |
|---|------|--------|-------------|
| 2.2a | `/v1/mcp/register` POST | ❌ MISSING | MCP OAuth client registration not in openapi.yaml |
| 2.2b | `/v1/mcp/authorize` GET | ❌ MISSING | MCP OAuth authorization endpoint not in openapi.yaml |
| 2.2c | `/v1/mcp/token` POST | ❌ MISSING | MCP OAuth token endpoint not in openapi.yaml |
| 2.2d | `/v1/mcp/token/revoke` POST | ❌ MISSING | MCP OAuth token revocation not in openapi.yaml |
| 2.2e | `/.well-known/oauth-authorization-server` GET | ❌ MISSING | OAuth discovery endpoint not in openapi.yaml |
| 2.3 | `/v1/wallet/history` alias | ❌ MISSING | Alias for `/v1/wallet/transactions` not documented |

---

### Phase 3 — Validation & Schema Layer (**BIGGEST GAP**)

| # | Item | Status | Description |
|---|------|--------|-------------|
| 3.1a | Zod schemas in `src/models/schemas.ts` | ✅ DONE | 23+ schemas created with `validateBody()` middleware |
| 3.1b | **Route files use schemas** | ❌ NOT DONE | **0 of 20 route files** import `validateBody()` or any schema. All routes still use inline manual validation (`if (!field) return error(...)`) |
| 3.2 | `/v1/validate` uses Zod schemas | ❌ NOT DONE | Uses hardcoded `SCHEMAS` map with basic required-field checks instead of centralized Zod schemas |

---

### Phase 4 — Developer Tooling

| # | Item | Status | Description |
|---|------|--------|-------------|
| 4.1a | `openapi-typescript` devDependency | ❌ MISSING | Package not installed |
| 4.1b | `generate:types` script | ❌ MISSING | Script not in package.json |
| 4.1c | `src/generated/api-types.ts` | ❌ MISSING | Directory and file do not exist |

---

### Phase 5 — Rate Limiting Tiers

| # | Item | Status | Description |
|---|------|--------|-------------|
| 5.1a | `rateLimits` in admin config update | ❌ MISSING | `PUT /v1/admin/config` has `allowedKeys` list that does NOT include `rateLimits`. Operators cannot tune rate limits at runtime. |
| 5.1b | Tier 0/1/2 differentiation | ❌ MISSING | All authenticated users get the same limits regardless of their tier level (owner, agent, operator) |

---

### Phase 6 — MongoDB/Prisma Adapter

| # | Item | Status | Description |
|---|------|--------|-------------|
| 6.1a | `prisma` + `@prisma/client` in package.json | ❌ MISSING | Not in dependencies or devDependencies. Users must manually install. |
| 6.1b | `db:generate` script | ❌ MISSING | Not in package.json scripts |
| 6.1c | `db:push` script | ❌ MISSING | Not in package.json scripts |

---

### Phase 7 — Federation Routing

| # | Item | Status | Description |
|---|------|--------|-------------|
| 7.1a | Work request forwarding | ❌ NOT DONE | `POST /v1/work/request` does NOT check if `provider_gaii` is remote. No call to `resolveGaii()`. Cross-node work requests stay local and silently fail. |
| 7.2a | `startHeartbeatJob()` called in server.ts | ❌ NOT DONE | Function exists in `src/services/federation.ts` but is **never called** from `server.ts`. Heartbeat is dead code. |
| 7.2b | Consecutive failure tracking | ❌ NOT DONE | No `consecutiveFailures` counter. Current logic: 1st error → degraded, 60 min → offline. Plan requires: 3 failures → degraded, 10 → offline. |

---

### Phase 8 — Remaining RFC Features

| # | Item | Status | Description |
|---|------|--------|-------------|
| 8.1a | `POST /v1/agents/:gaii/port` | ❌ MISSING | Transfer/port endpoint does not exist (only export/import available) |
| 8.1b | Redirect pointer (30-day TTL) | ❌ MISSING | No redirect mechanism. Old GAII returns 404 instead of 301. |
| 8.1c | Porting fee deduction | ❌ MISSING | No `portingFee` config parameter or deduction logic |
| 8.1d | 301 redirect on old GAII | ❌ MISSING | No redirect — old GAII just 404s |
| 8.2a | `owner_recovery` hook | ❌ PLACEHOLDER | Defined in config but never invoked — no recovery logic exists |
| 8.2b | `agent_rekey` hook | ❌ PLACEHOLDER | Defined in config but never invoked — no rekey logic exists |
| 8.3a | Core/Extended endpoint tags | ❌ NOT DONE | Bootstrap response lists endpoints without core/extended metadata |
| 8.3b | Disable extended features | ❌ NOT DONE | No feature toggle in admin config |

---

### Phase 9 — Test Coverage Expansion

| # | Item | Status | Description |
|---|------|--------|-------------|
| 9.2a | `test/unit/trust.test.ts` | ❌ MISSING | Trust score calculation unit tests not created |
| 9.2b | `test/unit/otk.test.ts` | ❌ MISSING | OTK utility unit tests not created |
| 9.1a | E2E: Memory TTL expiry | ❌ NOT ADDED | No test for TTL expiry verification |
| 9.1b | E2E: Board post TTL | ❌ NOT ADDED | No test for post TTL |
| 9.1c | E2E: Dispute auto-escalation | ❌ NOT ADDED | No dispute E2E tests at all |
| 9.1d | E2E: Chunked upload lifecycle | ❌ NOT ADDED | No chunked upload test |
| 9.1e | E2E: Action update (PUT) | ❌ NOT ADDED | No PUT action test |
| 9.1f | E2E: HEAD storage | ❌ NOT ADDED | No HEAD method test |
| 9.1g | E2E: Error paths | ❌ NOT ADDED | No invalid input / unauthorized tests |
| 9.1h | E2E: Optimistic locking conflict | ❌ NOT ADDED | Version conflict not tested |
| 9.1i | E2E: Rate limiting 429 | ❌ NOT ADDED | Rate limit triggering not tested |

---

## Priority Ranking

### HIGH — Core functionality gaps
1. **Phase 3.1b** — Wire Zod schemas into route files (largest single gap — touches 20 files)
2. **Phase 7.1a** — Work request forwarding to remote nodes (federation is non-functional without this)
3. **Phase 7.2a** — Start heartbeat job in server.ts (dead code — heartbeat never runs)

### MEDIUM — Completeness gaps
4. **Phase 8.1** — GAII port endpoint (portability is export/import only, not protocol-level)
5. **Phase 8.3** — Core/Extended tagging (RFC compliance)
6. **Phase 6.1** — Add Prisma deps + db scripts to package.json
7. **Phase 2.2** — Document MCP OAuth paths in openapi.yaml
8. **Phase 5.1** — Make rate limits runtime-configurable + tier-aware
9. **Phase 9** — Missing unit tests (trust, otk) + all 9 E2E additions

### LOW — Minor / cosmetic
10. **Phase 1.2a** — Board post cleanup interval (5min vs 10min)
11. **Phase 2.3** — Wallet history alias in spec
12. **Phase 4.1** — OpenAPI type generation tooling
13. **Phase 8.2** — owner_recovery / agent_rekey placeholders

---

*Generated from full audit of implementation vs. plan — 2026-02-25*
