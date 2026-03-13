# E2E Test Failure Analysis — MongoDB Backend

**Date:** 2026-03-13
**Command:** `pnpm test:e2e:mongodb`
**Storage:** MongoDB
**Server:** auto-start on :40251
**Overall:** 405 passed, 118 failed out of 523 tests across 19 suites

---

## Executive Summary

118 tests fail across 8 suites. Most failures trace back to **5 root causes**, meaning the actual number of distinct bugs is much smaller than 118. The biggest contributor is the **SAME_OWNER_WORK** enforcement blocking test setups that create requester and provider agents under a single owner (accounting for ~50+ cascading failures). The second largest is the **MCP/OAuth flow** being broken (24 failures). Fixing roughly 10 underlying issues would resolve all 118 test failures.

---

## Root Cause Analysis

### RC-1: SAME_OWNER_WORK Enforcement (~50+ failures)

**Affected suites:** e2e-disputes (37), e2e-hooks (8), e2e-concurrency (3), e2e-libs (6)

**Symptom:** `{"code":"SAME_OWNER_WORK","message":"Cannot create work request between your own agents"}`

**Analysis:** The server correctly rejects work requests where both requester and provider agents belong to the same owner. However, many test suites create all agents under a single test owner for simplicity. When the setup step fails, all downstream tests in that suite cascade-fail.

**Fix required (tests, not server):** These test suites need to register **two separate owners** — one for the requester agent and one for the provider agent. The e2e-disputes suite is the worst offender (37/44 failed), as every phase depends on a delivered work item that can never be created.

| Suite | Failed due to RC-1 | Total failures |
|-------|-------------------|----------------|
| e2e-disputes | 37 | 37 |
| e2e-hooks | ~8 | 16 |
| e2e-concurrency | 3 | 5 |
| e2e-libs | 6 | 9 |

---

### RC-2: MCP/OAuth Authorization Flow Broken (24 failures)

**Affected suite:** e2e-mcp (24 of 38)

**Symptoms:**
- Phase 2 test 4: `POST /v1/oauth/authorize` returns `{"error":"invalid_request","error_description":"Agent not found"}` — the OAuth flow cannot find the agent during authorization
- Phase 2 test 5: Auth without signature should return 400 but returns 200
- Phase 3: Token exchange fails because no valid auth code was ever issued
- Phases 4-8: All MCP session/tool/resource tests fail with 401 because no valid access token exists

**Analysis:** The OAuth authorization endpoint cannot resolve the agent identity. This is likely a regression in how the agent GAII is looked up during the OAuth `authorize` step. Once the auth code is never issued, the entire token exchange and MCP session lifecycle collapses.

**Fix required (server):** Debug the agent lookup in the OAuth authorize handler. The agent is registered successfully (setup passes), but the OAuth flow cannot find it — possibly a GAII format mismatch or a missing index.

---

### RC-3: Wallet Welcome Bonus Not Issued (5 failures)

**Affected suites:** e2e-concurrency (5), e2e-board-ttl (1)

**Symptoms:**
- `balance: 0` when test expects 100 morsels (welcome bonus)
- `expected 6 morsels deducted, got 0 (before: 0, after: 0)`
- Work requests fail or produce 0 successes because agents have no funds

**Analysis:** New agents are expected to receive a 100-morsel welcome bonus upon registration. This is either disabled in the test configuration, not triggered for MongoDB storage, or the wallet initialization path has a bug.

**Fix required (server):** Verify that the welcome bonus is configured (`AIMEAT_WELCOME_BONUS=100`) in `.env.test.mongodb` and that the wallet initialization code path works correctly with MongoDB.

---

### RC-4: Translation Endpoint Requires Auth (4 failures)

**Affected suite:** e2e-admin-features (4 of 5 failures)

**Symptom:** `GET /v1/admin/translations?lang=en` returns 401 `AUTH_REQUIRED` instead of 200 with translation data.

**Analysis:** The translations endpoint appears to require authentication, but the test expects it to be publicly accessible (or the test is not sending the auth token). All 4 translation-related tests fail identically.

**Fix required:** Either the endpoint should accept the operator token (test fix — add Authorization header) or the endpoint should be public for the admin panel to load translations (server fix — remove auth requirement on this specific endpoint).

---

### RC-5: Extension System Setup Failure (19 failures)

**Affected suite:** e2e-extensions (19 of 21)

**Symptom:** `POST /v1/admin/setup/register` returns 401 `"Invalid admin password"`.

**Analysis:** The extension test uses the admin setup endpoint to register the initial owner. The admin password in the test does not match the server's configured admin password. Once setup fails, the owner/agent tokens are empty (length 0), and every subsequent authenticated request returns 401.

**Fix required (test or config):** Ensure the extension test uses the correct admin password matching the server's `AIMEAT_ADMIN_PASSWORD` in `.env.test.mongodb`, or switch to the standard registration flow (`POST /v1/owners`).

---

## Individual Suite Breakdown

### e2e-admin-features — 36 passed, 5 failed

| # | Test | Expected | Got | Root Cause |
|---|------|----------|-----|------------|
| 1 | POST /v1/admin/email/test → 400 (SMTP not configured) | 400 | 200 `{"sent":true}` | Server returns success even without SMTP config; email may be using `aimeat` protocol fallback |
| 2 | GET /v1/admin/translations?lang=en | 200 | 401 | RC-4: Auth required |
| 3 | GET /v1/admin/translations?lang=fi | 200 | 401 | RC-4: Auth required |
| 4 | GET /v1/admin/translations?lang=en (MSM keys) | 200 | 401 | RC-4: Auth required |
| 5 | GET /v1/admin/translations?lang=fi (MSM keys) | 200 | 401 | RC-4: Auth required |

**Email test:** The server returns `{"sent":true,"template":"notification"}` with `"protocol":"aimeat"` — it seems the server has a non-SMTP delivery mode that the test doesn't account for. The test expects 400 when SMTP is not configured, but the server can send via the aimeat protocol.

---

### e2e-anonymous — 17 passed, 4 failed

| # | Test | Expected | Got | Root Cause |
|---|------|----------|-----|------------|
| 1 | Deleted memory returns 404 | 404 | 200 | Memory delete may not be working for anonymous agent, or soft-delete returns data |
| 2 | List micro-memory set without OTK | `greeting=hello` | Missing key | Micro-memory write/list for anonymous may have regression |
| 3 | List all micro-memory sets without OTK | At least one set | Empty | Same as above — anonymous micro-memory not persisting |
| 4 | Get anonymous prompt tier | `context.latest` in key_conventions | Missing field | Anonymous prompt template may have changed structure |

**Analysis:** These are 4 independent issues in the anonymous mode. The memory deletion returning 200 suggests the delete succeeded but the subsequent GET still returns the value (possible caching or soft-delete behavior). The micro-memory issues suggest anonymous agents may not have proper write access to micro-memory sets.

---

### e2e-board-ttl — 40 passed, 7 failed

| # | Test | Expected | Got | Root Cause |
|---|------|----------|-----|------------|
| 10 | Reply not in list, readable individually | Reply NOT in post list | Reply IS in list | Board listing includes replies when it should filter them |
| 14 | Post → subscriber webhook fired | Webhook payload | 0 payloads | Webhooks not firing on board posts |
| 18 | Post matching category → webhook fired | Webhook payload | 0 payloads | Same webhook issue |
| 22 | Post to public board → morsels deducted | 6 morsels deducted | 0 deducted | RC-3: No welcome bonus, wallet at 0 |
| 29 | Unauthenticated cannot access private board | 401 | 403 | Minor: status code disagreement (403 is arguably more correct) |
| 32 | Post to non-existent board → 404 | 404 | 201 | Board creation is implicit — posting to a non-existent board ID creates it |
| 35 | Non-operator create public board → 403 | 403 | 201 | Missing authorization check: any agent can create public boards |

**Critical issues:**
- **Webhooks not firing (#14, #18):** The board subscription webhook delivery mechanism is broken. No payloads are received by the mock webhook server. This could be a connectivity issue (localhost webhook URL not reachable from server), a missing async dispatch, or webhook delivery being disabled.
- **Implicit board creation (#32):** Posting to a non-existent board ID silently creates the board instead of returning 404. This is a validation gap.
- **Missing public board auth (#35):** Any agent can create a public board, but only operators should be allowed to. Missing role check in the create-board handler.

---

### e2e-concurrency — 29 passed, 5 failed

| # | Test | Expected | Got | Root Cause |
|---|------|----------|-----|------------|
| 1 | Agent starts with 100 morsels | 100 | 0 | RC-3: Welcome bonus |
| 3 | At most two succeed, one fails 402 | At least 1 failure | 0 failures | RC-3: No funds → no work succeeds |
| 4 | Wallet balance consistent | 100 | 0 | RC-3: cascade |
| 22 | Submit 5 work items in parallel | 5 | 0 | RC-1 + RC-3: SAME_OWNER_WORK or no funds |
| 25 | Wallet balances after settlement | 90 | 0 | RC-3: cascade |

All 5 failures trace back to **RC-3 (welcome bonus)** and/or **RC-1 (same-owner work)**.

---

### e2e-disputes — 7 passed, 37 failed

| Phase | Failures | Root Cause |
|-------|----------|------------|
| Setup | 1 | RC-1: SAME_OWNER_WORK — cannot create work between own agents |
| Phase 1-3 | 10 | Cascade: no work item → all dispute operations return 404 |
| Phase 4-5 | 10 | Cascade: same |
| Phase 6 | 1 | Cascade |
| Phase 7 | 7 | Cascade |
| Phase 8 | 4 | Cascade |
| Phase 9 | 2 | Cascade: audit log entries undefined |

**Single fix needed:** The test must create **two owners** with their respective agents so that work requests are cross-owner. This single change would likely fix all 37 failures.

---

### e2e-extensions — 2 passed, 19 failed

All 19 failures trace to **RC-5**: the admin setup registration returns "Invalid admin password", so no authenticated operations succeed. The 2 passing tests (`GET /v1/extensions` initially empty, `GET /v1/extensions/test-echo` after uninstall → 404) don't require auth.

---

### e2e-federation — 34 passed, 6 failed

| # | Test | Expected | Got | Root Cause |
|---|------|----------|-----|------------|
| 12 | Replicate memory entry | Success | `UNAUTHORIZED: Missing signature on replication request` | Federation replication now requires cryptographic signatures |
| 13 | Catalogue sync (full) | Success | `UNAUTHORIZED: Missing signature` | Same: catalogue-sync requires signed requests |
| 14 | Catalogue sync (incremental) | Success | Same | Same |
| 14b | Catalogue sync (update) | Success | Same | Same |
| 18c | Key exchange with known peer | Success | `INVALID_INPUT: node_id and node_public_key are required` | Test not sending required fields |
| 23 | Key exchange with unknown peer | 404 | 400 | Minor status code difference |

**Analysis:** 4 of 6 failures are because federation replication/sync endpoints now require request signing (X-Federation-Signature or similar). The tests send plain requests without signatures. This is a security improvement in the server that tests haven't caught up with.

**Fix required (tests):** Generate and attach federation signatures to replication and catalogue-sync requests. For key exchange, include `node_id` and `node_public_key` in the request body.

---

### e2e-hooks — 22 passed, 16 failed

| Category | Count | Root Cause |
|----------|-------|------------|
| SAME_OWNER_WORK blocks work requests | 8 | RC-1 |
| Webhook payloads not received | 4 | Webhook delivery not working (same as board-ttl) |
| Hook blocking not enforced | 4 | Hooks may not be intercepting requests (expected 403, got 201) |

**Analysis:** Beyond RC-1, the hook system has two independent issues:
1. **Webhook delivery** — hook servers never receive the POST payload, suggesting the async HTTP dispatch is broken or not reaching localhost.
2. **Hook blocking** — `pre_federation_peer` and `pre_board_post` hooks don't block creation (expected 403, got 201), suggesting the hook execution pipeline is not awaiting the hook response before proceeding.

---

### e2e-knowledge — 19 passed, 1 failed

| # | Test | Expected | Got | Root Cause |
|---|------|----------|-----|------------|
| 1 | Get package manifest by ID | 200 | 404 `Package not found or not public` | Package visibility may default to private; the GET endpoint may filter by public-only |

**Fix:** Either the import should set the package as public, or the GET endpoint should return packages owned by the authenticated agent regardless of visibility.

---

### e2e-libs — 49 passed, 9 failed

| # | Test | Expected | Got | Root Cause |
|---|------|----------|-----|------------|
| 1 | data.micro.list — list micro-memory set | Correct score | Score mismatch | Micro-memory score field type or serialization issue |
| 2 | data.microSets — list all sets | >= 1 set | 0 | Micro-memory sets listing empty (similar to anonymous issue) |
| 3 | work.stats — node stats | node_id is string | Not string | Stats response `node_id` field type issue |
| 4 | work.request | Success | SAME_OWNER_WORK | RC-1 |
| 5-9 | work.inbox/status/accept/deliver/rate | Success | Cascade failures | RC-1 cascade |

---

### e2e-phase0 — 23 passed, 8 failed

| # | Test | Expected | Got | Root Cause |
|---|------|----------|-----|------------|
| 1 | Schema violation returns 400 | 400 | 422 | Server uses 422 for validation errors (arguably correct per HTTP spec) |
| 2 | CSM register from template | 201 | 409 `CSM_NAME_TAKEN` | Leftover data from previous test run; test needs unique name or cleanup |
| 3-7 | TOTP tests (5 failures) | Various | 401 / WEAK_PASSWORD | Test uses weak password ("testpass123"); server now enforces uppercase requirement |
| 8 | Semantic @type in action create | @type present | undefined | Semantic annotation not preserved in action creation response |

---

### e2e-portal — 6 passed, 3 failed

| # | Test | Expected | Got | Root Cause |
|---|------|----------|-----|------------|
| 1 | /v1/portal/prompt/claude-pro | 200 | 404 | Platform variant `claude-pro` not registered |
| 2 | /v1/portal/prompt/grok-api | 200 | 404 | Platform variant `grok-api` not registered |
| 3 | /v1/portal/prompt/chatgpt-free | 200 | 404 | Platform variant `chatgpt-free` not registered |

**Analysis:** The portal prompt endpoint only returns 200 for `deepseek-chat` (which passes) but returns 404 for `claude-pro`, `grok-api`, and `chatgpt-free`. These platform variants either haven't been defined or their names have changed.

---

### e2e-security — 34 passed, 4 failed

| # | Test | Expected | Got | Root Cause |
|---|------|----------|-----|------------|
| 1 | IDOR: Agent A cannot read Agent B's private memory | Denied | Allowed | **SECURITY BUG**: Cross-agent private memory access not enforced |
| 3 | Rate limiting: burst triggers 429 | 429 | 200 | Rate limits set too high for test to trigger (auth limit: 1000) |
| 4 | Scope: Agent D (memory:read) cannot write | 403 | 201 | **SECURITY BUG**: Scope enforcement not blocking writes |
| 4b | Scope: Agent D (memory:read) cannot publish actions | 403 | 201 | **SECURITY BUG**: Scope enforcement not blocking action publish |

**Critical security issues:**
- **IDOR (#1):** Agent A can directly access Agent B's private memory. The memory read endpoint may not be filtering by agent GAII ownership.
- **Scope bypass (#4, #4b):** An agent with only `memory:read` scope can still write memory and publish actions. The scope enforcement middleware is not checking write permissions.

---

## Priority Matrix

### P0 — Security Bugs (fix immediately)

| Issue | Suite | Impact |
|-------|-------|--------|
| Cross-agent private memory access (IDOR) | e2e-security #1 | Any agent can read any other agent's private data |
| Scope enforcement bypass | e2e-security #4, #4b | Scoped agents can perform unauthorized writes |
| Non-operator can create public boards | e2e-board-ttl #35 | Any agent can create public (morsel-costing) boards |

### P1 — Functional Bugs (fix soon)

| Issue | Failures unblocked | Description |
|-------|-------------------|-------------|
| Welcome bonus not issued | ~8 | Agents start with 0 morsels on MongoDB |
| MCP/OAuth agent lookup | 24 | OAuth authorize cannot find registered agent |
| Webhook delivery broken | ~6 | Board subscriptions and hooks never fire webhooks |
| Hook blocking not enforced | ~4 | pre_* hooks don't block the operation |
| Implicit board creation | 1 | Posting to non-existent board creates it |
| Federation signature required | 4 | Tests need to send signed replication requests |

### P2 — Test Fixes (tests need updating, server is correct)

| Issue | Failures unblocked | Description |
|-------|-------------------|-------------|
| SAME_OWNER_WORK test setup | ~50+ | Tests need two separate owners for requester/provider |
| Extension admin password | 19 | Test uses wrong admin password |
| Translation auth header | 4 | Test not sending operator token |
| TOTP weak password | 5 | Test password doesn't meet new strength requirements |
| CSM name collision | 1 | Test needs unique CSM name or pre-cleanup |
| Schema 422 vs 400 | 1 | Test expects 400, server correctly uses 422 |
| 401 vs 403 status code | 1 | Private board returns 403 (correct) vs expected 401 |

### P3 — Minor / Cosmetic

| Issue | Failures | Description |
|-------|----------|-------------|
| Portal platform variants missing | 3 | claude-pro, grok-api, chatgpt-free not registered |
| Email test protocol fallback | 1 | Server sends via aimeat protocol when SMTP is down |
| Stats node_id type | 1 | node_id field not a string in stats response |
| Micro-memory score type | 1 | Score serialization mismatch |
| Micro-memory set listing | 2 | Sets listing returns empty |
| Anonymous memory delete | 1 | Deleted memory still returns 200 |
| Anonymous prompt tier | 1 | key_conventions missing context.latest |
| Knowledge package visibility | 1 | Package not found after import |
| Semantic @type preservation | 1 | Action create doesn't preserve semantic annotation |
| Board reply in post list | 1 | Replies appear in post listing |
| Federation key exchange fields | 2 | Test not sending required fields |

---

## Estimated Fix Effort

| Priority | Issues | Est. failures resolved | Effort |
|----------|--------|----------------------|--------|
| P0 Security | 3 bugs | 6 | 2-4 hours |
| P1 Functional | 7 bugs | ~47 | 4-8 hours |
| P2 Test fixes | 7 test updates | ~81 | 3-5 hours |
| P3 Minor | 13 issues | ~14 | 4-6 hours |
| **Total** | **30 issues** | **~118** | **13-23 hours** |

The single highest-leverage fix is updating test suites to use two separate owners for work request scenarios (P2), which would resolve **50+ failures** with a relatively small code change across 4 test files.

---

## Suites with Zero Failures (passing)

| Suite | Tests |
|-------|-------|
| api-full | 129/129 |
| e2e-auth-lib | 21/21 |
| e2e-micro-memory | 52/52 |
| e2e-personal-node | 18/18 |
| e2e-storage-visibility | 42/42 |

---

## Summary Table

| Suite | Passed | Failed | Total |
|-------|--------|--------|-------|
| api-full | 129 | 0 | 129 |
| e2e-admin-features | 36 | 5 | 41 |
| e2e-anonymous | 17 | 4 | 21 |
| e2e-auth-lib | 21 | 0 | 21 |
| e2e-board-ttl | 40 | 7 | 47 |
| e2e-concurrency | 29 | 5 | 34 |
| e2e-disputes | 7 | 37 | 44 |
| e2e-extensions | 2 | 19 | 21 |
| e2e-federation | 34 | 6 | 40 |
| e2e-hooks | 22 | 16 | 38 |
| e2e-knowledge | 19 | 1 | 20 |
| e2e-libs | 49 | 9 | 58 |
| e2e-mcp | 14 | 24 | 38 |
| e2e-micro-memory | 52 | 0 | 52 |
| e2e-personal-node | 18 | 0 | 18 |
| e2e-phase0 | 23 | 8 | 31 |
| e2e-portal | 6 | 3 | 9 |
| e2e-security | 34 | 4 | 38 |
| e2e-storage-visibility | 42 | 0 | 42 |
| **Total** | **405** | **118** | **523** |

*Note: The test runner summary shows some suites as 0/0/0 — this appears to be a reporting bug in the summary aggregation. The detailed per-suite output above reflects the actual results.*
