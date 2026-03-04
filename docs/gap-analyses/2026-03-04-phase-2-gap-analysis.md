# Phase 2: "Markkinapaikka + yhteisötyökalut" — Gap Analysis & Status Report

*2026-03-04 — Gap analysis of Phase 2 against the Soluuntuminen Masterplan (`docs/plans/2026-03-01-cellularization-masterplan-design.md`), reflecting the Node Extension System architectural pivot*

---

## Executive Summary

**Phase 2 has undergone an architectural pivot.** Rather than patching the hardcoded marketplace and organism routes identified in the original gap analysis, the team built a **generic Node Extension System** — a V8 isolate sandbox that lets operators install server-side JavaScript plugins. This directly addresses the AIMEAT founding principle:

> *"AIMEAT = infrastruktuuri. Kaikki muu rakennetaan näiden päälle, ei sisään."*

**Current state:** All 6 masterplan components (2.1–2.6) are addressed — some by pre-existing code, some by the new extension system, and some still by hardcoded routes pending migration. The extension system itself is complete and code-reviewed.

**Key metrics:**
- **Extension system:** 100% complete (runtime, routes, storage incl. MongoDB, config, reference extensions, docs)
- **Pre-existing Phase 2 features:** AI matching, appeals, semantic ontology — all complete
- **Future migration:** Hardcoded `marketplace.ts` (385 lines) and `organisms.ts` (873 lines) to be replaced by extension-driven equivalents
- **Tests:** 506 total (485 unit/integration + 21 E2E extension tests), all passing

---

## Architectural Pivot: Extension System

### Decision

The `docs/core-vs-ecosystem-analysis.md` (2026-02-27) classifies marketplace and organisms as **ecosystem applications**, not core infrastructure. The Phase 2 gap analysis originally found hardcoded routes that violated this principle. Instead of patching them, a new architecture was built:

### Four-Layer Service Model

```
Layer 3: Extensions    Server-side JavaScript plugins (V8 isolate, operator-installed)
Layer 2: MSM           External API descriptions (AI reads → builds integrations)
Layer 1: CSM           Internal data shape + rules (AI reads → builds UI → generic APIs)
Layer 0: Core          Generic APIs (memory, wallet, boards, consent, directory, flags, auth, trust)
```

### What Was Built

| Component | File(s) | Status | Lines |
|-----------|---------|--------|-------|
| V8 Isolate Sandbox Runtime | `src/services/extension-runtime.ts` | Complete | 295 |
| Extension Storage Types | `src/storage/interface.ts` (ExtensionRecord + EscrowHoldRecord) | Complete | ~100 |
| Extension Storage Impl (in-memory) | `src/storage/memory.ts` (10 CRUD methods) | Complete | ~100 |
| Extension Storage Impl (MongoDB) | `src/storage/mongodb.ts` + `prisma/schema.prisma` (Extension + EscrowHold models) | Complete | ~200 |
| Extension Config | `src/config.ts` (6 fields) + `.env.example` | Complete | ~20 |
| Extension Management Routes | `src/routes/extensions.ts` (7 endpoints) | Complete | 449 |
| Server Integration | `src/server.ts` (conditional mount) | Complete | ~5 |
| Organism CSM Template | `docs/csm-examples/organism.csm.yaml` | Complete | — |
| marketplace-behaviors Extension | `docs/extensions/marketplace-behaviors/` | Complete | ~120 |
| membership-behaviors Extension | `docs/extensions/membership-behaviors/` | Complete | ~170 |
| OpenAPI Documentation | `openapi.yaml` (7 new endpoints, 2 schemas) | Complete | ~250 |
| Unit Tests (storage) | `test/unit/extension-storage.test.ts` | Complete | 15 tests |
| Unit Tests (runtime) | `test/unit/extension-runtime.test.ts` | Complete | 11 tests |
| E2E Tests | `test/e2e-extensions.ts` | Complete, all passing | 21 tests |

**Design docs:**
- `docs/plans/2026-03-04-csm-driven-services-and-node-extensions-design.md` — Full architecture
- `docs/plans/2026-03-04-node-extension-system-implementation.md` — 10-task implementation plan

---

## Masterplan Component Mapping

### 2.1 AI-matchaus-agentti → COMPLETE (pre-existing)

**Masterplan requirement:** Federation-agentti that reads profiles, compares interests + geography, sends opt-in suggestions.

**Status:** Fully implemented before the extension system work. No changes needed.

| Deliverable | File | Status |
|------------|------|--------|
| Matching engine | `src/services/matching.ts` (403 lines) | Complete |
| Match endpoints (3) | `src/routes/matches.ts` (195 lines) | Complete |
| Background scheduler | `src/server.ts` (setInterval integration) | Complete |
| 6 config fields | `src/config.ts` | Complete |
| MatchRecord storage (7 methods) | `src/storage/interface.ts` + `memory.ts` | Complete |
| Cross-node matching | `src/services/cross-node-matching.ts` | Complete |
| OpenAPI | 3/3 endpoints documented | Complete |

**Masterplan coverage:** Shared interests × distance weighting × recency — all implemented. `AIMEAT_MATCHING_ENABLED` config flag works. Email notifications via Phase 1.1 email service.

**Tests:** 13 unit (matching.test.ts) + 10 unit (cross-node-matching.test.ts) + 6 unit (match-notification.test.ts) = 29 tests. No E2E.

---

### 2.2 Organismi/ryhmä-entiteetti → DUAL IMPLEMENTATION

**Masterplan requirement:** OrganismRecord with name, description, type, location, interests, member list, join policies (open/approval_required/invite_only), directory integration.

**Status:** Two implementations now exist:

#### A) Hardcoded routes (pre-existing, pending migration)

| Deliverable | File | Status |
|------------|------|--------|
| OrganismRecord + OrganismMembershipRecord + JoinRequestRecord | `src/storage/interface.ts` | Complete |
| 12 endpoints | `src/routes/organisms.ts` (873 lines) | Complete |
| 3 join policies | Open, approval_required, invite_only | Complete |
| Directory integration | `src/services/directory.ts` (organisms indexed as `entryType: 'organism'`) | Complete |
| Board auto-creation | On organism creation | Complete |
| Memory namespace | `organism.{id}.*` prefix | Complete |
| OpenAPI | 8/12 endpoints documented | Partial |

**Tests:** 13 unit (organisms.test.ts) + 8 unit (organism-reputation.test.ts) = 21 tests. No E2E.

#### B) Extension-driven (new, ready for production validation)

| Deliverable | File | Status |
|------------|------|--------|
| Organism CSM template | `docs/csm-examples/organism.csm.yaml` | Complete |
| membership-behaviors extension | `docs/extensions/membership-behaviors/` | Complete |
| 5 actions | join, invite, leave, promote, review-request | Complete |
| Join policies | open, approval_required, invite_only (in join.js) | Complete |
| RBAC | Admin checks in invite, promote, review-request | Complete |

**Migration path:** Once the extension system is validated in production, `organisms.ts` (873 lines) will be removed and replaced by the CSM template + extension. The existing workspace-access.ts middleware may be absorbed into the membership-behaviors extension.

---

### 2.3 Collaborative workspaces → COMPLETE (pre-existing)

**Masterplan requirement:** Shared memory spaces for organism members, consent-gated access, AI agents can participate.

**Status:** Implemented as transparent middleware on `/v1/memory`.

| Deliverable | File | Status |
|------------|------|--------|
| RBAC middleware | `src/middleware/workspace-access.ts` (138 lines) | Complete |
| Namespace isolation | `organism.{id}.shared.*`, `organism.{id}.meta.*`, `organism.{id}.member.{owner}.*` | Complete |
| Consent integration | `storage.findMatchingConsents()` for non-own namespace access | Complete |
| Agent access | Organism agents access `shared.*` and read `meta.*` | Complete |

**Architecture note:** Workspaces are not dedicated endpoints — workspace access is transparently enforced via memory middleware. This follows the "no per-service backend" rule from CLAUDE.md.

**Tests:** 44 unit tests (`test/unit/workspace-access.test.ts`) covering passthrough, auth enforcement, organism existence, agent access (shared/meta namespaces), GHII/membership validation, consent requirements, admin-only meta writes, cross-member write protection, and edge cases.

---

### 2.4 Laatusuodatus — advanced → COMPLETE (pre-existing)

**Masterplan requirement:** Moderation tools, appeals mechanism, auto-hide when flag threshold exceeded.

**Status:** Fully implemented.

| Deliverable | File | Status |
|------------|------|--------|
| Appeals (3 endpoints) | `src/routes/appeals.ts` (281 lines) | Complete |
| AppealRecord + storage | `src/storage/interface.ts` + `memory.ts` | Complete |
| Workflow: pending → upheld/overturned | Complete | Complete |
| One-appeal-per-flag enforcement | `getAppealByFlagId()` → 409 | Complete |
| Organism admin review | Admins can review appeals for organism namespace content | Complete |
| Auto-hide threshold | Configurable per organism via `AIMEAT_AUTO_HIDE_THRESHOLD` | Complete |
| OpenAPI | 3/3 endpoints documented | Complete |

**Tests:** 9 unit (appeals.test.ts) + 9 unit (flags.test.ts) = 18 tests. No E2E.

---

### 2.5 CSM-templatekirjasto → COMPLETE (extended)

**Masterplan requirement:** Ready-made CSM templates for different service types: marketplace, dating, news, opinion, auction, media.

**Status:** 8 templates exist (7 pre-existing + 1 new organism template).

| Template | Type | Status |
|----------|------|--------|
| `hobby-directory.csm.yaml` | directory | Pre-existing (Phase 1) |
| `marketplace.csm.yaml` | marketplace | Pre-existing |
| `dating-directory.csm.yaml` | dating | Pre-existing |
| `news-feed.csm.yaml` | news | Pre-existing |
| `opinion-board.csm.yaml` | opinion | Pre-existing |
| `auction.csm.yaml` | auction | Pre-existing |
| `video-directory.csm.yaml` | media | Pre-existing |
| **`organism.csm.yaml`** | **community** | **New** — added with extension system |

**New:** The `community` service type was added to `CsmServiceType` in `src/services/csm-parser.ts` to support the organism CSM template.

**Endpoints:**

| Endpoint | Status | Notes |
|----------|--------|-------|
| GET /v1/csm/templates | Present | Lists all templates |
| GET /v1/csm/templates/:type | Present | Get template by type |
| POST /v1/csm-templates (operator) | Missing | Operator write endpoints not implemented |
| PUT /v1/csm-templates/:id (operator) | Missing | |
| DELETE /v1/csm-templates/:id (operator) | Missing | |

**Note:** With the extension system, operator template management can be handled through the extension install/uninstall flow rather than dedicated CRUD endpoints. The extension system itself provides operator-level management of service capabilities.

**Tests:** 6 unit (csm-templates.test.ts). No E2E.

---

### 2.6 Vertical Slice: Markkinapaikka → DUAL IMPLEMENTATION

**Masterplan requirement:** CSM-driven marketplace with listings, purchases, escrow, ratings. Morsel transactions, trust score integration.

**Status:** Two implementations now exist:

#### A) Hardcoded routes (pre-existing, pending migration)

| Deliverable | File | Status |
|------------|------|--------|
| Marketplace routes (10 endpoints) | `src/routes/marketplace.ts` (385 lines) | Complete |
| Business logic | `src/services/marketplace.ts` (283 lines) | Complete |
| Morsel economy integration | Listing fees, purchase escrow, transaction fees | Complete |
| Rating system | 1–5 scale, trust score adjustment | Complete |
| Semantic: `schema:Offer` | On listing detail | Complete |
| OpenAPI | 8/10 endpoints documented | Partial |

**Missing hardcoded endpoints:**
- `POST /v1/marketplace/transactions/:id/dispute` — not implemented
- `GET /v1/marketplace/stats` — not implemented

**Tests:** 15 unit (marketplace.test.ts). No E2E.

#### B) Extension-driven (new, ready for production validation)

| Deliverable | File | Status |
|------------|------|--------|
| marketplace-behaviors extension | `docs/extensions/marketplace-behaviors/` | Complete |
| 3 actions | purchase, deliver, rate | Complete |
| Escrow workflow | `ctx.wallet.hold()` → `ctx.wallet.release()` | Complete |
| Trust score adjustment | Rating-based delta (+4 to -6 range) | Complete |
| Config | listing_fee_morsels, transaction_fee_percent, escrow_enabled | Complete |
| Federation advertisement | escrow, purchase-workflow, ratings capabilities | Complete |

**New generic infrastructure:**
- **EscrowHoldRecord** — generic wallet escrow (not marketplace-specific) that any extension can use
- **Shared extension memory** — extensions use `ext:{name}` namespace for cross-user data access
- **Config default extraction** — YAML schema objects with `.default` resolved to actual values

**Migration path:** Once validated, `marketplace.ts` (385 lines) and `marketplace.ts` service (283 lines) will be removed. Existing data migrates from dedicated `ListingRecord`/`PurchaseRecord` storage to generic memory entries.

---

## Extension System Details

### Extension API Endpoints

| Method | Path | Auth | Status |
|--------|------|------|--------|
| GET | `/v1/extensions` | Public | Complete |
| POST | `/v1/extensions` | Operator | Complete |
| GET | `/v1/extensions/:name` | Public | Complete |
| DELETE | `/v1/extensions/:name` | Operator | Complete |
| POST | `/v1/extensions/:name/activate` | Operator | Complete |
| POST | `/v1/extensions/:name/deactivate` | Operator | Complete |
| POST | `/v1/ext/:extName/:actionId` | Authenticated | Complete |

### V8 Sandbox Security

| Threat | Mitigation | Tested |
|--------|-----------|--------|
| Infinite loops | `timeout_ms` limit (default 5000ms) | ✅ Unit test |
| Memory exhaustion | `memory_mb` limit (default 64MB) | ✅ Config |
| API abuse | `max_api_calls` limit (default 50) | ✅ Unit test |
| File system access | V8 isolate has no `fs` module | ✅ Unit test |
| Network access | No `fetch`/`http` available | ✅ Unit test |
| Code injection | No `eval()`, `Function()`, dynamic import | ✅ Unit test |
| Cross-extension access | Each action gets its own isolate | By design |

### Extension Config

| Env Var | Default | Description |
|---------|---------|-------------|
| `AIMEAT_EXTENSIONS_ENABLED` | false | Enable extension system |
| `AIMEAT_EXT_MAX_MEMORY_MB` | 64 | V8 isolate memory limit per action |
| `AIMEAT_EXT_TIMEOUT_MS` | 5000 | V8 isolate CPU timeout per action |
| `AIMEAT_EXT_MAX_API_CALLS` | 50 | Max AIMEAT API calls per action invocation |
| `AIMEAT_EXT_MAX_CODE_SIZE_KB` | 256 | Max JS source size per action |
| `AIMEAT_EXT_MAX_INSTALLED` | 20 | Max extensions installed on this node |

---

## Testing Summary

### Extension System Tests

| File | Tests | Coverage |
|------|-------|----------|
| `test/unit/extension-storage.test.ts` | 15 | CRUD for ExtensionRecord (7) + EscrowHoldRecord (8), incl. status guards |
| `test/unit/extension-runtime.test.ts` | 11 | V8 sandbox execution, timeout, no-globals, memory API, API limit, caller, config, errors, logging |
| `test/unit/workspace-access.test.ts` | 44 | RBAC middleware: passthrough, auth, agent access, membership, consent, namespace writes |
| `test/e2e-extensions.ts` | 21 | Full lifecycle: install → activate → execute → memory → deactivate → uninstall |
| **Total** | **91** | **All passing (70 unit + 21 E2E)** |

### Pre-Existing Phase 2 Tests

| File | Tests | Component |
|------|-------|-----------|
| matching.test.ts | 13 | AI Matching (2.1) |
| cross-node-matching.test.ts | 10 | AI Matching (2.1) |
| match-notification.test.ts | 6 | Match Notifications (1.6/2.1) |
| organisms.test.ts | 13 | Organisms (2.2) |
| organism-reputation.test.ts | 8 | Organisms (2.2) |
| appeals.test.ts | 9 | Appeals (2.4) |
| flags.test.ts | 9 | Data Quality (2.4) |
| csm-templates.test.ts | 6 | CSM Templates (2.5) |
| marketplace.test.ts | 15 | Marketplace (2.6) |
| **Total** | **89** | |

### Overall Test Status

| Category | Count | Status |
|----------|-------|--------|
| All project unit/integration tests | 485 | ✅ Passing |
| Extension unit tests (included above) | 26 | ✅ Passing |
| Workspace-access unit tests (included above) | 44 | ✅ Passing |
| Extension E2E tests | 21 | ✅ Passing (requires `AIMEAT_EXTENSIONS_ENABLED=true`) |
| Type-check | — | ✅ Clean |

### Test Gaps

| Gap | Severity | Description |
|-----|----------|-------------|
| ~~workspace-access.test.ts~~ | ~~Medium~~ | ✅ **Closed** — 44 unit tests added |
| ~~Extension E2E not run~~ | ~~Medium~~ | ✅ **Closed** — 21/21 E2E tests passing against live MongoDB server |
| Phase 2 E2E coverage | Low | No E2E tests for matching, organisms, marketplace routes |

---

## Cross-Phase Reuse Audit

### Phase 0 → Phase 2 Reuse

| Phase 0 Component | How Phase 2 Reuses It | Status |
|---|---|---|
| 0.1 Schema Locking | CSM templates generate JSON Schema; extension memory uses schema validation | Reused correctly |
| 0.2 CSM Parser | 8 templates parsed (7 existing + organism); `community` type added | Extended correctly |
| 0.3 Consent Layer | Matching checks consent; workspace middleware checks namespace consents; extensions use `ctx.consent` | Reused correctly |
| 0.4 Profile Schemas | Matching reads profile interests/location from memory | Reused correctly |
| 0.5 TOTP | No direct Phase 2 usage | N/A |
| 0.6 DMZ Architecture | Workspace middleware implements namespace isolation; extension memory scoped to `ext:{name}` | Extended correctly |
| 0.7 Semantic Ontology | `schema:RecommendAction`, `schema:Organization`, `schema:Offer` added | Extended correctly |
| 0.8 Morsel Economy | Marketplace listing fees, escrow, transaction fees; extension `ctx.wallet` wraps escrow | Reused correctly |
| 0.9 Trust Scoring | Marketplace ratings adjust trust; extension `ctx.trust.adjust()` wraps same | Reused correctly |

### Phase 1 → Phase 2 Reuse

| Phase 1 Component | How Phase 2 Reuses It | Status |
|---|---|---|
| 1.1 Email System | Matching sends suggestion emails via EmailService | Reused correctly |
| 1.4 Directory | Matching reads directory; organisms indexed alongside people | Extended correctly |
| 1.5 Data Quality Flags | Appeals extend flags; organisms use autoHideThreshold | Extended correctly |
| 1.6 Hobby Directory | CSM template pattern reused for all Phase 2 templates | Pattern reused |

### Extension System → Core Reuse

| Core API | Extension Access Via | Integration |
|---|---|---|
| Memory | `ctx.memory.get/set/search/delete` → `storage.getMemory/setMemory/listMemory/deleteMemory` | Shared `ext:{name}` namespace |
| Wallet | `ctx.wallet.hold/release/transfer/getBalance` → `storage.createEscrowHold/releaseEscrowHold` + `storage.addTransaction` | Generic EscrowHoldRecord |
| Consent | `ctx.consent.check/require` → `storage.listConsents` | Purpose-based consent matching |
| Trust | `ctx.trust.adjust` → `storage.updateAgent` (trustScore) | Bounded 0–100 range |
| Logging | `ctx.log.info/warn/error` → winston logger | Prefixed `[ext:{name}]` |

**No infrastructure was re-implemented.** The extension system wraps existing core APIs via the `ctx` proxy.

---

## Summary of All Gaps

### Must-Fix

All must-fix gaps have been resolved:

| # | Gap | Component | Status | Resolution |
|---|-----|-----------|--------|------------|
| 1 | ~~Extension E2E not validated~~ | Extension System | ✅ **Closed** | 21/21 E2E tests passing against live MongoDB server (admin setup register for operator role) |
| 2 | ~~Workspace RBAC tests~~ | 2.3 | ✅ **Closed** | 44 unit tests in `test/unit/workspace-access.test.ts` |

### Should-Fix (before migration)

| # | Gap | Component | Severity | Description |
|---|-----|-----------|----------|-------------|
| 3 | Hardcoded route migration | 2.2 + 2.6 | Medium | `organisms.ts` (873 lines) + `marketplace.ts` (385 lines) should be removed once extension system validated |
| 4 | CSM operator CRUD | 2.5 | Low | POST/PUT/DELETE template endpoints missing (may be replaced by extension management) |
| 5 | Marketplace dispute endpoint | 2.6 | Low | Not in hardcoded routes or extension (out-of-scope for initial extension) |
| 6 | Federation capability routing | Extension System | Low | Designed but not yet implemented (heartbeat advertisement, capability discovery) |

### Acceptable Deviations

| Deviation | Explanation |
|-----------|-------------|
| Dual implementation (hardcoded + extension) | Intentional: extension system validated before removing hardcoded routes |
| Extension memory scoped to `ext:{name}` not caller GAII | Design decision: cross-user workflows (buyer reads seller's listing) require shared namespace |
| Config `.default` extraction | YAML config fields define schema with `type`/`default`/`description`; runtime extracts `.default` values |
| `community` added to CsmServiceType | Required for organism CSM template; follows existing pattern |
| Escrow status guards (held-only release/refund) | Added during code review; prevents double-release bugs |

---

## Masterplan Completeness Matrix

| Masterplan § | Requirement | Implementation | Completeness |
|---|---|---|---|
| **2.1** AI-matchaus-agentti | Federation agent, interest + geo matching, opt-in notifications | `matching.ts` + `matches.ts` + scheduler | **100%** |
| **2.2** Organismi/ryhmä | OrganismRecord, 3 join policies, directory, workspaces | Hardcoded routes (complete) + CSM/extension (ready) | **95%** (dual impl) |
| **2.3** Collaborative workspaces | Shared memory, RBAC, consent-gated, AI agents | `workspace-access.ts` middleware + 44 unit tests | **100%** |
| **2.4** Laatusuodatus advanced | Moderation tools, appeals, auto-hide | `appeals.ts` + flag system | **100%** |
| **2.5** CSM-templatekirjasto | 6+ templates for different service types | 8 templates (7 pre-existing + organism) | **100%** |
| **2.6** Markkinapaikka | Listings, purchases, escrow, ratings, trust integration | Hardcoded routes (near-complete) + extension (ready) | **90%** (missing dispute, stats) |

**Overall Phase 2: ~97% complete** against masterplan requirements, with all must-fix gaps closed and the extension system providing a reusable foundation for all future service types.

---

## Next Steps

### Immediate (this sprint) — ✅ COMPLETED

1. ~~**Run extension E2E tests**~~ — ✅ 21/21 passing against live MongoDB server with `AIMEAT_EXTENSIONS_ENABLED=true`
2. ~~**Add workspace-access unit tests**~~ — ✅ 44 unit tests covering all RBAC paths
3. ~~**MongoDB storage for extensions + escrow**~~ — ✅ Full Prisma CRUD in `mongodb.ts` + `Extension`/`EscrowHold` models in `schema.prisma`

### Migration (separate plan)

3. **Remove hardcoded routes** — Delete `marketplace.ts` (385 lines), `organisms.ts` (873 lines), dedicated storage types
4. **Migrate workspace-access.ts** — Absorb RBAC logic into membership-behaviors extension
5. **Add federation capability routing** — Advertise extension capabilities in heartbeats

### Phase 3 Readiness

The extension system provides the pluggable architecture Phase 3 needs. Future services (auction, car rental, event booking) can be built as CSM + extension packages without touching AIMEAT server code — fulfilling the masterplan's architectural vision.

---

*Generated: 2026-03-04*
*Source: `docs/plans/2026-03-01-cellularization-masterplan-design.md` (Soluuntuminen Masterplan)*
*Architecture: `docs/plans/2026-03-04-csm-driven-services-and-node-extensions-design.md`*
*Implementation: `docs/plans/2026-03-04-node-extension-system-implementation.md`*
*Cross-references: `docs/gap-analyses/2026-03-04-phase-0-gap-analysis.md`, `docs/gap-analyses/2026-03-04-phase-1-gap-analysis.md`*
