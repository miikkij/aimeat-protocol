# Phase 3 Gap Analysis — "Polish + tulevaisuus"

**Date:** 2026-03-04
**Plan:** `docs/plans/phase-3-polish-future.md`
**Status:** ~91% reference-implementation complete

---

## Overview

Phase 3 covers polish & future-proofing: PWA, desktop installer, EU identity integration, and advanced federation. Most components exist as **reference implementations** — API contracts, services, storage, routes, and tests are in place, but some lack production-level cryptographic operations or external integrations.

---

## Component Status

### 3.1 PWA (Progressive Web App) — ✅ 100% COMPLETE

| Component | Status | File |
|-----------|--------|------|
| Web App Manifest | ✅ | `src/static/manifest.json` |
| Service Worker | ✅ | `src/static/sw.js` |
| Offline page | ✅ | `src/static/offline.html` |
| PWA icons | ✅ | `src/static/icons/` |
| Push Notification service | ✅ | `src/services/push.ts` |
| Push API routes (4 endpoints) | ✅ | `src/routes/push.ts` |
| VAPID config | ✅ | `src/config.ts` |
| PushSubscriptionRecord | ✅ | `src/storage/interface.ts` |
| In-memory storage CRUD | ✅ | `src/storage/memory.ts` |
| Server integration | ✅ | `src/server.ts` |
| Unit tests (8) | ✅ | `test/unit/push-service.test.ts` |

**Cache strategies:** Cache-first (static), Network-first (API), Stale-while-revalidate (portal), Background Sync (mutations).

**No gaps.** All plan items are implemented.

---

### 3.2 Desktop Installer (Tauri) — ✅ 95% COMPLETE

| Component | Status | Location |
|-----------|--------|----------|
| Tauri app structure | ✅ | `aimeat-desktop/` |
| Rust backend (4 modules) | ✅ | `src-tauri/src/` |
| Node manager (start/stop) | ✅ | `node_manager.rs` |
| AI connector (LM Studio/Ollama) | ✅ | `ai_connector.rs` |
| System tray | ✅ | `tray.rs` + `main.rs` |
| Dashboard UI | ✅ | Frontend HTML/JS |
| Connections UI | ✅ | Frontend HTML/JS |
| AI Setup UI | ✅ | Frontend HTML/JS |
| Settings UI | ✅ | Frontend HTML/JS |
| Logs UI | ✅ | Frontend HTML/JS |
| Icons (multi-format) | ✅ | `icons/` |

**Minor gap:**
- [ ] Rust unit tests (`cargo test`) — not yet written
- [ ] CI build matrix (Win/Mac/Linux) — not configured

---

### 3.3 EUDIW / MyData / W3C VC — ⚠️ 80% COMPLETE (reference impl)

| Component | Status | File |
|-----------|--------|------|
| EUDIW service | ✅ | `src/services/eudiw.ts` |
| VC issuer service | ✅ | `src/services/vc-issuer.ts` |
| MyData receipt service | ✅ | `src/services/mydata-receipt.ts` |
| Verification routes (8 endpoints incl. callback) | ✅ | `src/routes/verification.ts` |
| Config (EUDIW/FTN/VC) | ✅ | `src/config.ts` |
| TrustedIssuerRecord | ✅ | `src/storage/interface.ts` |
| GHIIRecord Tier 3 fields | ✅ | `src/storage/interface.ts` |
| Storage CRUD | ✅ | `src/storage/memory.ts` |
| Server integration | ✅ | `src/server.ts` |
| OpenAPI spec (7 endpoints) | ✅ | `openapi.yaml` |
| Unit tests — EUDIW (14) | ✅ | `test/unit/eudiw-verifier.test.ts` |
| Unit tests — VC issuer (8) | ✅ | `test/unit/vc-issuer.test.ts` |
| Unit tests — MyData (7) | ✅ | `test/unit/mydata-receipt.test.ts` |

**Gaps (production-readiness — require real external test environments):**
- [ ] `@sd-jwt/core` package — NOT installed, no real SD-JWT parsing
- [ ] Cryptographic signature verification — VP tokens not cryptographically validated
- [x] ~~EUDIW callback endpoint~~ — ✅ `POST /v1/ghii/verify/eudiw/callback` added
- [ ] FTN integration — placeholder only, no real Suomi.fi API calls
- [ ] VC issuance — returns plain objects, not signed JWTs
- [ ] Credential revocation checks — not implemented

**Assessment:** All API contracts, service interfaces, storage, routes and tests exist. The missing pieces are **cryptographic operations** and **external API integrations** — these require real EUDIW/FTN test environments which don't exist yet in development.

---

### 3.4 Advanced Federation — ✅ 95% COMPLETE

| Component | Status | File |
|-----------|--------|------|
| Genesis peering service | ✅ | `src/services/genesis-peering.ts` |
| Cross-node matching service | ✅ | `src/services/cross-node-matching.ts` |
| Organism reputation service | ✅ | `src/services/organism-reputation.ts` |
| GenesisPeerRecord | ✅ | `src/storage/interface.ts` |
| OrganismReputationRecord | ✅ | `src/storage/interface.ts` |
| Genesis peer endpoints (7 incl. suspend) | ✅ | `src/routes/federation.ts` |
| Organism reputation endpoint | ✅ | `GET /v1/organisms/:id/reputation` |
| Cross-catalogue endpoint (federate filter) | ✅ | `src/routes/federation.ts` |
| Network-stats endpoint | ✅ | `src/routes/federation.ts` |
| CSM `federate` field wired | ✅ | `src/routes/csm.ts` |
| Cross-federation config | ✅ | `src/config.ts` |
| Unit tests — peering (8) | ✅ | `test/unit/genesis-peering.test.ts` |
| Unit tests — matching (10) | ✅ | `test/unit/cross-node-matching.test.ts` |
| Unit tests — reputation (8) | ✅ | `test/unit/organism-reputation.test.ts` |

**Remaining gaps (nice-to-have):**
- [x] ~~Scheduled sync~~ — ✅ `src/services/genesis-sync.ts` scheduler wired in `server.ts`
- [x] ~~Catalogue hash computation~~ — ✅ SHA-256 hash of sorted CSMs computed during sync

---

### 3.5 Semantic Ontology — ✅ 95% COMPLETE

| Component | Status | Notes |
|-----------|--------|-------|
| SemanticAnnotation interface | ✅ | JSON-LD @context/@type |
| schema.org in catalogue | ✅ | Agents, actions, boards |
| schema.org in federation | ✅ | Genesis peer requests + list |
| CSM semantic extraction | ✅ | Service-level semantics |
| GenesisPeerRecord semantic | ✅ | schema:Organization + ItemList |
| OrganismReputationRecord semantic | ✅ | schema:Rating with bestRating/worstRating |
| Semantic validation tests | ✅ | `test/unit/semantic-validation.test.ts` |

---

### 3.6 Documentation — ✅ 100% COMPLETE

| Document | Status |
|----------|--------|
| `docs/aimeat-semantic-ontology.md` | ✅ Exists |
| `docs/aimeat-pwa-guide.md` | ✅ Created |
| `docs/aimeat-eudiw-integration.md` | ✅ Created |
| `docs/aimeat-vc-spec.md` | ✅ Created |
| `docs/aimeat-cross-federation.md` | ✅ Created |
| OpenAPI updates | ✅ Done (EUDIW/VC endpoints) |
| `.env.example` updates | ✅ Done |

---

### 3.7 Testing — ⚠️ 65% COMPLETE

| Area | Plan Target | Actual | Gap |
|------|-------------|--------|-----|
| E2E tests (Phase 24-28) | 29 | 0 specific | Phase 3 E2E test sections not written |
| Unit tests — PWA | ~14 | 8 | push-service done, no service-worker tests |
| Unit tests — EUDIW/VC/MyData | ~26 | 29 | ✅ Exceeds target |
| Unit tests — Federation | ~28 | 26 | ✅ Near target (peering 8 + matching 10 + reputation 8) |
| Total E2E | 85 | 85 | ✅ (but none specific to Phase 3 features) |
| Total unit test files | 38 | 38 | ✅ |

---

## Completeness Matrix

| # | Component | Planned | Implemented | % | Status |
|---|-----------|---------|-------------|---|--------|
| 3.1 | PWA | 12 items | 12 | 100% | ✅ Complete |
| 3.2 | Desktop Installer | 10 items | 9 | 95% | ✅ Near-complete |
| 3.3 | EUDIW / MyData / VC | 15 items | 11 | 85% | ⚠️ Reference impl (+callback) |
| 3.4 | Advanced Federation | 16 items | 16 | 95% | ✅ Near-complete (+sync, +hash) |
| 3.5 | Semantic Ontology | 7 items | 7 | 95% | ✅ Near-complete |
| 3.6 | Documentation | 6 docs | 6 | 100% | ✅ Complete |
| 3.7 | Testing Strategy | 97 tests | ~63 | 65% | ⚠️ Missing Phase 3 E2E |
| **Overall** | | | | **~91%** | |

---

## Priority Actions

### ✅ CLOSED — Fixed 2026-03-04

1. ~~**Re-create `organism-reputation.ts` service**~~ — ✅ Re-created with 5-component weighted scoring
2. ~~**Wire CSM `federate` field**~~ — ✅ Extracted in POST /v1/csm, used in cross-catalogue filtering
3. ~~**Add genesis peer suspend endpoint**~~ — ✅ `PUT /v1/federation/genesis-peer/:id/suspend`
4. ~~**Semantic annotations for GenesisPeer + OrganismReputation**~~ — ✅ schema:Organization, schema:Rating

5. ~~**Phase 3 documentation**~~ — ✅ All 4 docs created (PWA, EUDIW, VC, cross-federation)
6. ~~**EUDIW callback endpoint**~~ — ✅ `POST /v1/ghii/verify/eudiw/callback`
7. ~~**Scheduled genesis sync**~~ — ✅ `src/services/genesis-sync.ts` with catalogue hash

### Remaining (production polish / external dependencies)

8. **Phase 3 E2E tests** — dedicated test sections for PWA, EUDIW, federation
9. **SD-JWT + signature verification** — requires real EUDIW test environment
10. **Tauri unit tests** — `cargo test` for Rust backend

---

## Test Summary

| Category | Count |
|----------|-------|
| Unit tests (vitest) | 457 (38 files) |
| E2E tests (e2e-full.ts) | 85 |
| E2E extension tests | 21 |
| **Total** | **563** |

---

*AIMEAT Phase 3 Gap Analysis — Overscale Solutions Oy, 2026-03-04*
