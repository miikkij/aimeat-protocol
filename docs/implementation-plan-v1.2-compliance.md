# AIMEAT v1.2 — Implementation Plan for Full RFC Compliance

**Created:** 2026-02-25  
**Based on:** Gap analysis of `aimeat/src/` vs RFC v1.2, OpenAPI spec, and build prompt  
**Current state:** 87 routes, 36 storage methods, 35/35 E2E tests passing, clean TypeScript build  

---

## Table of Contents

1. [Phase 1 — Enforcement Fixes](#phase-1--enforcement-fixes-quick-wins)
2. [Phase 2 — OpenAPI Spec Alignment](#phase-2--openapi-spec-alignment)
3. [Phase 3 — Validation & Schema Layer](#phase-3--validation--schema-layer)
4. [Phase 4 — Developer Tooling](#phase-4--developer-tooling)
5. [Phase 5 — Rate Limiting Tiers](#phase-5--rate-limiting-tiers)
6. [Phase 6 — MongoDB/Prisma Adapter](#phase-6--mongodbprisma-adapter)
7. [Phase 7 — Federation Routing](#phase-7--federation-routing)
8. [Phase 8 — Remaining RFC Features](#phase-8--remaining-rfc-features)
9. [Phase 9 — Test Coverage Expansion](#phase-9--test-coverage-expansion)
10. [Verification Checklist](#verification-checklist)

---

## Phase 1 — Enforcement Fixes (Quick Wins)

These features are already stored in data records but the enforcement logic is missing. Each is a small, isolated change.

### 1.1 Memory TTL Enforcement

**Gap:** `ttl_hours` is accepted and stored in `MemoryRecord.ttlHours` but entries never expire.  
**RFC ref:** Section 8.2  

**Tasks:**
1. **Read-time expiry check** — In `src/storage/memory.ts`, modify `getMemory()` and `listMemory()` to check `ttlHours`:
   - If `record.ttlHours` is set and `Date.now() > record.createdAt + ttlHours * 3600_000`, return `null` (treat as deleted)
   - Filter expired entries from `listMemory()` and `searchMemory()` results
2. **Background cleanup job** — In `src/server.ts`, add a `setInterval` (every 5 minutes) that iterates all memory entries and deletes expired ones. Follow the existing `expireTimedOutWork` pattern.
3. **Test:** Create a memory entry with `ttl_hours: 0.001` (3.6 seconds), wait, verify it's gone.

**Files to modify:**
- `src/storage/memory.ts` — `getMemory()`, `listMemory()`, `searchMemory()`
- `src/server.ts` — new `cleanupExpiredMemory()` interval

---

### 1.2 Board Post TTL Enforcement

**Gap:** `ttlExpiresAt` is stored on `BoardPostRecord` but posts never age out.  
**RFC ref:** Section 12  

**Tasks:**
1. **Read-time filter** — In `listPosts()`, filter out posts where `ttlExpiresAt < now`.
2. **Background cleanup job** — In `src/server.ts`, add interval (every 10 minutes) to delete expired posts.

**Files to modify:**
- `src/storage/memory.ts` — `listPosts()`
- `src/server.ts` — new `cleanupExpiredPosts()` interval

---

### 1.3 Dispute Auto-Escalation and Timeout

**Gap:** Disputes require manual escalation. RFC specifies auto-escalation after 7 days and auto-resolve (timeout) after 30 days.  
**RFC ref:** Section 10.8  

**Tasks:**
1. **Background job** — In `src/server.ts`, add interval (every hour) that:
   - Finds disputes with status `open` older than 7 days → auto-set status to `escalated`, add audit entry
   - Finds disputes with status `escalated` older than 30 days → auto-set status to `resolved` with `timeout_resolved` event, return escrow to requester
2. **Audit trail** — Each auto-action must add a `DisputeAuditEntry` with `actor: 'system'`

**Files to modify:**
- `src/server.ts` — new `autoEscalateDisputes()` interval
- `src/services/morsel.ts` — may need `returnEscrow` call for timeout resolution

---

## Phase 2 — OpenAPI Spec Alignment

The implementation has routes not documented in `openapi.yaml`, and the spec should be the canonical contract.

### 2.1 Add Missing Paths to openapi.yaml

Add these implemented endpoints to the OpenAPI spec:

| Path | Method | Tag | Description |
|------|--------|-----|-------------|
| `/v1/health` | GET | Bootstrap | Liveness/readiness check |
| `/v1/auth/otk` | POST | Auth | Generate one-time key (Tier 0.5) |
| `/v1/storage/upload/init` | POST | Storage | Initiate chunked upload |
| `/v1/storage/upload/{id}/{chunk}` | PUT | Storage | Upload single chunk |
| `/v1/storage/upload/{id}/complete` | POST | Storage | Finalize chunked upload |
| `/v1/storage/upload/{id}` | DELETE | Storage | Abort chunked upload |
| `/v1/admin/agents` | GET | Admin | List all agents (operator) |
| `/v1/admin/stats` | GET | Admin | System statistics (operator) |
| `/v1/admin/hooks` | GET | Admin | List extension hooks |
| `/v1/admin/hooks/{hookName}` | PUT | Admin | Set hook URLs |
| `/v1/admin/hooks/{hookName}` | DELETE | Admin | Clear hook |
| `/v1/admin/backup` | GET | Admin | Export all data |
| `/v1/admin/restore` | POST | Admin | Import data |

### 2.2 Add MCP Paths (Optional Section)

Document the MCP server endpoints as an optional extension:

| Path | Method | Tag |
|------|--------|-----|
| `/v1/mcp` | POST | MCP |
| `/v1/mcp` | GET | MCP |
| `/v1/mcp` | DELETE | MCP |
| `/v1/mcp/register` | POST | MCP |
| `/v1/mcp/authorize` | GET | MCP |
| `/v1/mcp/token` | POST | MCP |
| `/v1/mcp/token/revoke` | POST | MCP |
| `/.well-known/oauth-authorization-server` | GET | MCP |

### 2.3 Document Legacy/Alias Routes

Add a note in the spec that `/v1/wallet/history` is an alias for `/v1/wallet/transactions`.

**Files to modify:**
- `openapi.yaml` — add paths, schemas, tags

---

## Phase 3 — Validation & Schema Layer

### 3.1 Centralize Zod Schemas

**Gap:** Routes do ad-hoc inline validation (`if (!key) return error(...)`) instead of using Zod schemas.  
**Build prompt ref:** "Zod 4.x for all request/response schemas", `models/schemas.ts`  

**Tasks:**
1. Create `src/models/schemas.ts` with Zod schemas for all request bodies:
   - `OwnerRegistrationSchema` — `{ name: string, public_key: string }`
   - `AgentRegistrationSchema` — `{ name, owner, display_name?, description?, capabilities? }`
   - `MemoryWriteSchema` — `{ key, value, visibility?, tags?, ttl_hours? }`
   - `MemoryUpdateSchema` — `{ value?, visibility?, tags?, ttl_hours?, version }`
   - `ActionPublishSchema` — `{ id, display_name, description, input_schema, output_schema, pricing }`
   - `WorkRequestSchema` — `{ action_id, provider_gaii, input, callback_url?, ttl_hours? }`
   - `WorkBatchSchema` — `{ requests: WorkRequestSchema[] }`
   - `WorkDeliverySchema` — `{ output }`
   - `WorkRatingSchema` — `{ score: 1-5, feedback? }`
   - `DisputeOpenSchema` — `{ reason }`
   - `BoardCreateSchema` — `{ name, type, description? }`
   - `BoardPostSchema` — `{ content, tags? }`
   - `TokenRequestSchema` — `{ gaii, timestamp, signature }`
   - `PeeringRequestSchema` — `{ target_node_url }`
   - `PeeringDecisionSchema` — `{ decision: 'accept'|'reject' }`
   - `OperatorRulingSchema` — `{ ruling, distribution }`
   - `PartialOfferSchema` — `{ refund_morsels }`
   - `ConfigUpdateSchema` — partial config object
   - `RoleGrantSchema` — `{ owner, role }`
2. Replace inline validation in each route file with `schema.parse(req.body)` wrapped in try/catch that returns a 400 MEAT error.
3. Optionally create a `validateBody(schema)` middleware helper to DRY this up.

**Files to create:**
- `src/models/schemas.ts`

**Files to modify:**
- All files in `src/routes/` — replace inline validation with Zod `.parse()`

---

### 3.2 Strengthen /v1/validate Endpoint

**Tasks:**
1. Verify that `POST /v1/validate` validates request bodies against the Zod schemas (not just OpenAPI structure checks).
2. Accept `{ endpoint, method, body }` and return validation result using the centralized schemas.

**Files to modify:**
- `src/routes/validate.ts`

---

## Phase 4 — Developer Tooling

### 4.1 OpenAPI Type Generation

**Tasks:**
1. `pnpm add -D openapi-typescript`
2. Add script to `package.json`: `"generate:types": "openapi-typescript ../openapi.yaml -o src/generated/api-types.ts"`
3. Create `src/generated/` directory
4. Run `pnpm generate:types` and commit the output

**Files to modify:**
- `package.json` — add devDep + script
- Create `src/generated/api-types.ts` (generated)

---

### 4.2 Test Framework (vitest)

**Tasks:**
1. `pnpm add -D vitest`
2. Update `package.json`: `"test": "vitest run"`, `"test:watch": "vitest"`
3. Create `test/unit/` directory with unit tests for:
   - `services/morsel.ts` — escrow/settlement math
   - `services/trust.ts` — trust score calculation edge cases
   - `utils/gaii.ts` — GAII parsing and validation
   - `utils/tracking-code.ts` — format verification
4. Wrap existing E2E suite: `"test:e2e": "tsx test/e2e-full.ts"`

**Files to modify:**
- `package.json` — scripts + devDep
- Create `test/unit/` directory with test files

---

### 4.3 ESLint Configuration

**Tasks:**
1. `pnpm add -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin`
2. Create `eslint.config.js` with TypeScript strict rules
3. Add script: `"lint": "eslint src/"`

**Files to create:**
- `eslint.config.js`

**Files to modify:**
- `package.json` — add devDeps + script

---

### 4.4 CLI Enhancements

**Gap:** Build prompt specifies `aimeat init` wizard and `aimeat.config.json` support.  

**Tasks:**
1. Add `aimeat init` subcommand to `src/index.ts` — interactive prompts for node-id, port, admin password, then writes `.env` or `aimeat.config.json`
2. Add config file loading: check for `aimeat.config.json` in cwd, merge with env vars (env takes precedence)
3. Add `aimeat backup --out backup.json` and `aimeat restore --from backup.json` CLI subcommands (currently only available as API endpoints)

**Files to modify:**
- `src/index.ts` — add subcommand handling
- `src/config.ts` — add config file loading

---

## Phase 5 — Rate Limiting Tiers

### 5.1 Per-Endpoint Rate Limiting

**Gap:** Global 200 req/60s for everyone. RFC 6.6 specifies per-tier and per-endpoint limits.  
**RFC ref:** Section 6.6  

**Tasks:**
1. Extend `src/middleware/rate-limit.ts` to accept a config object:
   ```typescript
   interface RateLimitConfig {
     default: { windowMs: number; max: number };
     overrides: Record<string, { windowMs: number; max: number }>;
   }
   ```
2. Allow overrides keyed by route pattern (e.g., `/v1/work` → 10 req/min, `/v1/memory` → 100 req/min)
3. Expose config via `PUT /v1/admin/config` so operators can tune at runtime
4. Different limits for Tier 0 (generous, read-only) vs Tier 1 (moderate) vs Tier 2 (high)

**Files to modify:**
- `src/middleware/rate-limit.ts` — accept per-route config
- `src/config.ts` — add `rateLimits` to `MeatConfig`
- `src/routes/admin.ts` — allow rate limit config updates

---

## Phase 6 — MongoDB/Prisma Adapter

### 6.1 Prisma Schema

**Gap:** No `prisma/` directory, no MongoDB adapter. Build prompt specifies dual-mode storage.  
**Build prompt ref:** Section 2.1  

**Tasks:**
1. Create `prisma/schema.prisma` with MongoDB provider:
   ```prisma
   datasource db {
     provider = "mongodb"
     url      = env("DATABASE_URL")
   }
   generator client {
     provider = "prisma-client-js"
   }
   ```
2. Define models matching all 14 record types in `src/storage/interface.ts`
3. `pnpm add prisma @prisma/client`
4. Add scripts: `"db:generate": "prisma generate"`, `"db:push": "prisma db push"`

**Files to create:**
- `prisma/schema.prisma`

**Files to modify:**
- `package.json` — add deps + scripts

---

### 6.2 MongoDB Storage Implementation

**Tasks:**
1. Create `src/storage/mongodb.ts` implementing the full `Storage` interface
2. Each of the 36 methods maps to Prisma CRUD operations
3. Handle MongoDB-specific concerns: ObjectId mapping, compound indexes, TTL indexes
4. Use MongoDB native TTL indexes for memory and board post expiry (more efficient than background jobs)

**Files to create:**
- `src/storage/mongodb.ts`

---

### 6.3 Storage Selection at Startup

**Tasks:**
1. In `src/server.ts`, check `config.dbUrl`:
   - If set → instantiate `MongoStorage`, connect, run migrations
   - If not set → instantiate `InMemoryStorage` (current behavior)
2. Both implementations must pass the same test suite

**Files to modify:**
- `src/server.ts` — conditional storage creation

---

## Phase 7 — Federation Routing

### 7.1 Cross-Node Message Routing

**Gap:** Peering lifecycle works, but requests don't actually traverse the network.  
**RFC ref:** Section 13.3–13.5  

**Tasks:**
1. **GAII resolver** — Given a GAII with a foreign node, look up peer info, determine route
2. **Request proxy** — When work targets a foreign GAII:
   - `POST /v1/federation/route` relays the request to the peer node
   - Include hop counter (max 3) and originator info
   - Forward JWT or re-sign with federation key
3. **Work request forwarding** — `POST /v1/work/request` checks if `provider_gaii` is remote:
   - If remote → proxy via federation route to the provider's node
   - Track cross-node work with both nodes' tracking codes
4. **GAII resolution endpoint** — `GET /v1/federation/resolve/:gaii` returns the node URL where that GAII lives

**Files to modify:**
- `src/routes/federation.ts` — implement route, resolve logic
- `src/routes/work.ts` — add remote provider detection + forwarding
- `src/services/federation.ts` (new) — routing logic, peer lookup, signature verification

---

### 7.2 Heartbeat & Health Monitoring

**Tasks:**
1. Background job that sends `POST /v1/federation/heartbeat` to all active peers every 5 minutes
2. Track peer health: last heartbeat, latency, consecutive failures
3. After 3 consecutive heartbeat failures → mark peer as `degraded`
4. After 10 failures → mark as `offline`, stop routing

**Files to modify:**
- `src/server.ts` — new `federationHeartbeat()` interval
- `src/storage/interface.ts` — add health fields to peer records

---

## Phase 8 — Remaining RFC Features

### 8.1 GAII Portability

**RFC ref:** Section 4.5  

**Tasks:**
1. New endpoint: `POST /v1/agents/:gaii/port` — initiate transfer
2. Source node creates a redirect pointer (30-day TTL)
3. Destination node accepts the agent record
4. Deduct porting fee (configurable, default 50 morsels)
5. Old endpoint returns 301 with `Location` header pointing to new node

---

### 8.2 Operator Extension Hooks — Full Integration

**Gap:** Hook framework exists in `src/services/hooks.ts` but not all RFC hooks are wired in.  
**RFC ref:** Section 5.4  

**Tasks:**
1. Verify these hooks fire in the correct routes:
   - `pre_owner_registration` / `post_owner_registration` — in `src/routes/owners.ts`
   - `pre_agent_registration` / `post_agent_registration` — in `src/routes/agents.ts`
   - `pre_work_request` — in `src/routes/work.ts`
   - `post_settlement` — in `src/services/morsel.ts`
   - `pre_board_post` — in `src/routes/boards.ts`
   - `pre_federation_peer` — in `src/routes/federation.ts`
   - `owner_recovery` / `agent_rekey` — placeholders (no recovery implemented)
2. Hook execution should be abort-on-failure: if any hook returns failure, the operation is rolled back.

**Files to modify:**
- Multiple route files — audit and wire missing hooks

---

### 8.3 Core vs Extended Service Tagging

**RFC ref:** Section 15  

**Tasks:**
1. Add metadata to each route indicating whether it's Core or Extended
2. In `GET /` bootstrap response, tag endpoints as core/extended
3. In `/v1/admin/config`, allow operators to disable extended features

---

## Phase 9 — Test Coverage Expansion

### 9.1 E2E Test Additions

Add test cases for currently untested paths:

| Test | Endpoint | Scenario |
|------|----------|----------|
| Memory TTL expiry | `POST /v1/memory` + `GET /v1/memory/:key` | Create with short TTL, verify gone after expiry |
| Board post TTL | `POST /v1/boards/:id/posts` + `GET` | Post expires after TTL |
| Dispute auto-escalation | `POST /v1/work/:tc/dispute` | Wait 7+ days equivalent, verify escalated |
| Chunked upload | `POST /v1/storage/upload/init` → chunks → complete | Full lifecycle |
| Action update | `PUT /v1/actions/:id` | Modify published action |
| HEAD storage | `HEAD /v1/storage/:key` | Verify metadata headers |
| Error paths | Various | Invalid input, unauthorized, insufficient morsels |
| Optimistic locking conflict | `PUT /v1/memory/:key` | Two concurrent updates with same version |
| Rate limiting | Any | Exceed limit, verify 429 + Retry-After |

**Files to modify:**
- `test/e2e-full.ts` — add test phases 7+

---

### 9.2 Unit Tests

Create unit tests for pure logic modules:

| Module | Tests |
|--------|-------|
| `services/morsel.ts` | Escrow math, settlement distribution, burn rate, insufficient balance |
| `services/trust.ts` | Score calculation, decay, new-agent cap, edge cases (zero deliveries) |
| `utils/gaii.ts` | Valid/invalid GAII parsing, reserved names, edge cases |
| `utils/tracking-code.ts` | Format regex match, uniqueness |
| `utils/otk.ts` | Key generation format, expiry calculation |
| `middleware/envelope.ts` | Envelope structure, hints format |

**Files to create:**
- `test/unit/morsel.test.ts`
- `test/unit/trust.test.ts`
- `test/unit/gaii.test.ts`
- `test/unit/tracking-code.test.ts`

---

## Verification Checklist

After each phase, verify:

- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npx tsx test/e2e-full.ts` — 35/35 (or more) tests pass
- [ ] All new code uses `.js` import extensions (ESM requirement)
- [ ] All responses use `success()`/`error()` envelope with hints
- [ ] New endpoints have `requireAuth()`/`requireRole()` matching RFC tier requirements

### Full Compliance Checklist

| RFC Section | Requirement | Compliant After Phase |
|-------------|------------|----------------------|
| 4.5 | GAII portability | Phase 8 |
| 5.4 | All extension hooks fire | Phase 8 |
| 6.6 | Per-endpoint rate limits | Phase 5 |
| 8.2 | Memory TTL enforced | Phase 1 |
| 10.8 | Dispute auto-timeout | Phase 1 |
| 12 | Board post TTL enforced | Phase 1 |
| 13.3–13.5 | Cross-node federation routing | Phase 7 |
| 15 | Core vs Extended tagging | Phase 8 |
| Build prompt | Zod validation layer | Phase 3 |
| Build prompt | OpenAPI type generation | Phase 4 |
| Build prompt | MongoDB/Prisma storage | Phase 6 |
| Build prompt | vitest + ESLint | Phase 4 |
| Build prompt | CLI init wizard | Phase 4 |
| OpenAPI | All routes documented | Phase 2 |
| OpenAPI | Chunked upload paths | Phase 2 |
| OpenAPI | MCP paths | Phase 2 |

---

*Implementation plan generated from gap analysis — 2026-02-25*
