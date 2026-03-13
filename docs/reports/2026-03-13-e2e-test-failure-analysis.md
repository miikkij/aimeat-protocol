# E2E Test Failure Analysis — 2026-03-13

**Storage backend:** MongoDB
**Total:** 308 passed, 214 failed out of 522 tests across 19 suites

## Executive Summary

214 tests fail across 10 suites. The failures stem from **6 root causes**, with the top 3 accounting for ~90% of all failures:

| Root Cause | Failed Tests | Affected Suites |
|---|---|---|
| RC-1: Operator role not recognized | ~65 | 8 suites |
| RC-2: Default agent scopes too restrictive | ~55 | 7 suites |
| RC-3: Cascading failures (from RC-1/RC-2) | ~60 | 6 suites |
| RC-4: Owner name validation rejects test names | ~25 | 2 suites |
| RC-5: MCP requires GHII account | ~15 | 1 suite |
| RC-6: Miscellaneous (6 distinct issues) | ~9 | 5 suites |

---

## Root Cause 1: Operator Role Not Recognized (403 ACCESS_DENIED)

**Symptom:** Endpoints requiring `requireRole('operator')` return `403 ACCESS_DENIED: Role "operator" required` even when the first registered owner (who should auto-receive operator role) is authenticated.

**Affected suites:** e2e-admin-features (26 failures), e2e-federation (22), e2e-hooks (18), e2e-disputes (5), e2e-concurrency (2), e2e-knowledge (2), e2e-personal-node (2), e2e-board-ttl (3)

**Evidence:** In `e2e-admin-features`, the test registers a test owner (auto-operator), obtains a token, and confirms 401/403 for unauthenticated/non-operator — those guards pass. But the operator token itself gets 403 on every `/v1/admin/*` endpoint.

**Likely cause:** Either:
1. The auto-operator role assignment is broken (the first owner no longer gets `operator` in the roles array)
2. The JWT token generation doesn't include the `operator` role in the claims
3. The `requireRole('operator')` middleware checks roles differently than how they're stored

**Investigation starting points:**
- `src/auth/middleware.ts` — `requireRole()` implementation
- `src/routes/owners.ts` — first-owner auto-operator logic
- `src/auth/jwt.ts` — role inclusion in JWT claims

---

## Root Cause 2: Default Agent Scopes Too Restrictive

**Symptom:** Agents receive default scopes `[memory:read, memory:write, catalogue:read]` but many operations require additional scopes: `social:write`, `work:publish`, `work:request`, `work:read`, `wallet:read`, `wallet:write`, `memory:delete`.

**Affected suites:** e2e-board-ttl (3 primary), e2e-concurrency (5), e2e-disputes (8), e2e-hooks (5), e2e-libs (12), e2e-board-ttl (3)

**Evidence:**
- `e2e-board-ttl` test 1: `SCOPE_DENIED: Scope "social:write" required. Agent scopes: [memory:read, memory:write, catalogue:read]`
- `e2e-concurrency` test 0b: `SCOPE_DENIED: Scope "work:publish" required`
- `e2e-libs` Phase 3: `social.createBoard` — `Scope "social:write" required`
- `e2e-libs` Phase 4: `wallet.balance` — `Scope "wallet:read" required`
- `e2e-libs` Phase 5: `work.request` — `Scope "work:request" required`

**Likely cause:** Either:
1. Default scopes were intentionally narrowed and tests were not updated
2. Agent registration should assign `["*"]` (wildcard) by default but a recent change broke this
3. The test registration calls need to pass explicit scopes

**Investigation starting points:**
- `src/routes/agents.ts` — default scope assignment during registration
- `src/auth/middleware.ts` — scope enforcement logic
- Check if the `api-full` suite (which passes) registers agents differently (e.g., with wildcard scopes)

---

## Root Cause 3: Cascading Failures

**Symptom:** Large numbers of tests fail with empty IDs in URLs (e.g., `Cannot POST /v1/boards//posts`) or `Cannot read properties of undefined`.

**Affected suites:** e2e-board-ttl (30+ cascading), e2e-disputes (30+ cascading), e2e-hooks (20+), e2e-concurrency (5), e2e-libs (8)

**Mechanism:** When a setup step fails (e.g., board creation returns 403 due to scope denial), the board ID is `undefined`. All subsequent tests that use that board ID construct invalid URLs like `/v1/boards//posts` which return HTML 404 pages. The HTML response then causes JSON parse errors: `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.

**Fix:** These are not independent bugs. Fixing RC-1 (operator role) and RC-2 (agent scopes) will resolve the cascading failures automatically. No separate fix needed.

---

## Root Cause 4: Owner Name Validation Rejects Test Names

**Symptom:** Owner registration returns 400: `Invalid string: must match pattern /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/`

**Affected suites:** e2e-phase0 (all 26 failures cascade from setup), e2e-security (all 29 failures cascade from setup)

**Evidence:**
- `e2e-phase0`: First test "Register test owner" fails with validation error, causing all subsequent tests to fail with 401 (no valid auth)
- `e2e-security`: "Register Owner A" fails identically

**Likely cause:** The test generates owner names that contain underscores, uppercase letters, or don't meet the 3-character minimum. The validation pattern requires:
- Only lowercase alphanumeric + hyphens
- Minimum 3 characters (start + middle + end)
- Must start and end with alphanumeric

**Fix:** Update the test name generation to comply with the pattern, e.g., replace underscores with hyphens and ensure lowercase.

**Investigation starting points:**
- Test files: `test/e2e-phase0.ts`, `test/e2e-security.ts` — look at owner name generation
- Compare with `test/api-full.ts` which passes (its name generation must be compliant)

---

## Root Cause 5: MCP Requires GHII Account

**Symptom:** MCP endpoints return `GHII account required for MCP access. Create one at /v1/ghii first.`

**Affected suite:** e2e-mcp (15 failures in Phases 4-8)

**Evidence:** OAuth discovery, client registration, and auth code flow all work (Phase 1-3 pass). But when the OAuth access token is used for MCP JSON-RPC calls, the server requires the authenticated identity to have a GHII (Global Human Identity Infrastructure) account.

**Likely cause:** The test creates a standard owner+agent but the MCP server middleware additionally checks for GHII registration. The test needs an additional GHII registration step, or the MCP auth should accept standard agent/owner tokens.

**Additional MCP issues:**
- Test 5: "Auth without signature → 400" gets 200 instead (auth endpoint accepts unsigned requests)
- Test 28: SSE stream returns 400 instead of opening
- Test 31: Session close returns 404

---

## Root Cause 6: Miscellaneous Issues (6 Distinct Bugs)

### 6a. Missing `/v1/admin/translations` Endpoint (4 failures)

**Suite:** e2e-admin-features
**Symptom:** `GET /v1/admin/translations` returns 404 HTML page (`Cannot GET /v1/admin/translations`)
**Fix:** The endpoint route is either not registered in `server.ts` or the router file is missing.

### 6b. Password Validation Too Strict (4 failures)

**Suite:** e2e-auth-lib
**Symptom:** `Registration failed: Password must contain an uppercase letter`
**Evidence:** Test registers with a password that lacks uppercase. Either the test password needs updating or the validation was recently tightened.

### 6c. Micro-Memory Value Size Limit Not Enforced (1 failure)

**Suite:** e2e-micro-memory
**Symptom:** Test 23 — a value exceeding 1KB is accepted (200) instead of rejected
**Fix:** The 1KB per-value size limit is not being enforced in the micro-memory write handler.

### 6d. Portal HTML Missing Title + Bootstrap Hints (2 failures)

**Suite:** e2e-portal
**Symptom:** `GET /v1/portal` — missing `<title>` tag; `GET /` bootstrap hints missing `portal` property
**Fix:** Check the default portal template and bootstrap response builder.

### 6e. Optimistic Locking Race Condition (1 failure)

**Suite:** e2e-concurrency
**Symptom:** Test 8 — two parallel PUT requests with same version both succeed (200,200) instead of one getting 409
**Likely cause:** MongoDB concurrent writes are not properly serialized. The version check and update are not atomic. Need `findOneAndUpdate` with version in the filter condition.

### 6f. Anonymous Prompt Boot Steps Count Changed (1 failure)

**Suite:** e2e-anonymous
**Symptom:** `Expected 5 boot steps, got 6`
**Fix:** Either a boot step was added (update test expectation) or the prompt template has an extra step.

---

## Suite-by-Suite Breakdown

| Suite | Pass | Fail | Total | Primary Root Cause(s) |
|---|---|---|---|---|
| api-full | 129 | 0 | 129 | - |
| e2e-storage-visibility | 42 | 0 | 42 | - |
| e2e-micro-memory | 51 | 1 | 52 | 6c (value size limit) |
| e2e-portal | 7 | 2 | 9 | 6d (template/bootstrap) |
| e2e-personal-node | 16 | 2 | 18 | RC-1 (operator role) |
| e2e-knowledge | 16 | 4 | 20 | RC-1 (operator role) |
| e2e-auth-lib | 17 | 4 | 21 | 6b (password validation) |
| e2e-anonymous | 10 | 10 | 20 | Anonymous mode auth, 6f |
| e2e-concurrency | 22 | 12 | 34 | RC-2 (scopes), 6e (locking) |
| e2e-mcp | 19 | 18 | 37 | RC-5 (GHII required) |
| e2e-extensions | 2 | 19 | 21 | Setup auth failure (admin password) |
| e2e-libs | 34 | 24 | 58 | RC-2 (scopes), RC-3 (cascade) |
| e2e-phase0 | 5 | 26 | 31 | RC-4 (name validation) |
| e2e-federation | 12 | 28 | 40 | RC-1 (operator role) |
| e2e-security | 9 | 29 | 38 | RC-4 (name validation) |
| e2e-admin-features | 11 | 30 | 41 | RC-1 (operator), 6a (translations) |
| e2e-hooks | 4 | 34 | 38 | RC-1 + RC-2 + RC-3 |
| e2e-board-ttl | 11 | 36 | 47 | RC-2 (scopes), RC-3 (cascade) |
| e2e-disputes | 7 | 37 | 44 | RC-2 (scopes), RC-3 (cascade) |

---

## Recommended Fix Priority

### Priority 1 — High Impact (fixes ~180 tests)

1. **Fix operator role assignment/recognition** (RC-1) — ~65 direct failures + ~40 cascading
2. **Fix default agent scopes** (RC-2) — ~55 direct failures + ~20 cascading
3. **Fix test owner name generation** (RC-4) — ~55 cascading failures in 2 suites

### Priority 2 — Medium Impact (fixes ~20 tests)

4. **Add GHII registration to MCP test** or relax MCP auth (RC-5) — 15 failures
5. **Fix extension system admin password** — 19 failures
6. **Register `/v1/admin/translations` route** (6a) — 4 failures

### Priority 3 — Low Impact (fixes ~9 tests)

7. **Update password in auth-lib test** (6b) — 4 failures
8. **Enforce micro-memory 1KB value limit** (6c) — 1 failure
9. **Fix portal template title + bootstrap hints** (6d) — 2 failures
10. **Fix MongoDB optimistic locking atomicity** (6e) — 1 failure
11. **Update anonymous prompt step count** (6f) — 1 failure

---

## Notes

- The `api-full` suite (129 tests) and `e2e-storage-visibility` (42 tests) pass completely, confirming that core CRUD, auth flow, economy, social, infrastructure, and storage work correctly when proper scopes and operator roles are in place.
- The passing suites likely use different registration patterns (e.g., wildcard scopes, compliant names) that the failing suites don't replicate.
- Many "failed" suites in the summary table show 0/0/0 — this appears to be a reporting artifact where the runner counts results differently from inline output.
