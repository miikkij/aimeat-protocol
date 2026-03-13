# Plan: Fix 214 Failing E2E Tests

**Date:** 2026-03-13
**Reference:** [Test failure analysis](../reports/2026-03-13-e2e-test-failure-analysis.md)
**Scope:** 214 failures across 10 suites (308/522 currently passing)

---

## Overview

The failures cluster around 6 root causes. This plan is ordered by impact — fixing items 1-3 resolves ~85% of failures.

---

## Fix 1 — Operator Role Not Recognized (fixes ~105 tests)

**Problem:** The first test owner registers successfully and gets a token, but admin endpoints return `403 ACCESS_DENIED: Role "operator" required`. This cascades across 8 suites.

**Root cause hypothesis:** Test suites run sequentially against the same server. Although `api-full` cleans up its owners, leftover GHII users or other records may mean the new test owner is NOT the "first real owner" — so it doesn't receive auto-operator role. Alternatively, the JWT token issuance isn't including the operator role even when the owner record has it.

### Investigation

1. Check `src/routes/owners.ts:42-49` — the first-owner detection logic:
   ```typescript
   const realOwners = allOwners.filter(o => o.name !== 'anonymous');
   ```
   Verify this correctly identifies the first owner after a cascade delete. Check if GHII users count as "owners" in MongoDB.

2. Check `src/routes/auth.ts:233-245` — role assignment during token issuance. Verify that `ownerRecord.roles` actually contains `'operator'` at the time of token generation.

3. Check `src/routes/auth.ts:237-245` — the self-healing operator promotion. This should promote an owner to operator if no operator exists. Verify it fires correctly.

### Fix options (choose one)

**Option A — Fix root cause in server code:**
- Add logging in `owners.ts` to trace first-owner detection
- Add logging in `auth.ts` to trace role assignment
- Run a single failing suite in isolation to confirm it passes (proving it's a cross-suite contamination issue)
- Fix whatever causes the operator role to be lost

**Option B — Fix tests to ensure clean state:**
- Each test suite's setup should explicitly verify it has operator role after registration
- If operator role is missing, use the self-healing mechanism or re-register

**Option C — Fix test runner to reset DB between suites:**
- In `test/run-e2e-ci.ts`, drop and recreate the database between each suite (like it does at startup for MongoDB)
- This ensures each suite starts with a clean slate

### Files to modify

| File | Change |
|------|--------|
| `aimeat/src/routes/owners.ts` | Debug/fix first-owner operator detection |
| `aimeat/src/routes/auth.ts` | Debug/fix role inclusion in JWT and self-healing |
| `aimeat/test/run-e2e-ci.ts` | Consider DB reset between suites |

---

## Fix 2 — Default Agent Scopes Too Restrictive (fixes ~55 tests)

**Problem:** Agents are registered without explicit scopes and receive the config default `['memory:read', 'memory:write', 'catalogue:read']`. Tests expect agents to have broader permissions (`social:write`, `work:publish`, `work:request`, `wallet:read`, etc.).

**Root cause:** `config.ts:547` sets:
```typescript
defaultAgentScopes: (process.env.AIMEAT_DEFAULT_AGENT_SCOPES ?? 'memory:read,memory:write,catalogue:read').split(',')
```

The passing `api-full` suite works because the test owner has operator role, which bypasses all scope checks (`middleware.ts:208`). Failing suites don't have operator role (see Fix 1), so scope enforcement kicks in.

### Relationship to Fix 1

If Fix 1 resolves the operator role issue, many scope-denied failures will disappear automatically (operators bypass scope checks). However, tests that run agents under non-operator owners will still fail.

### Fix options (choose one)

**Option A — Widen default scopes (server change):**
- Change default in `config.ts` to include all standard scopes:
  ```
  memory:read,memory:write,memory:delete,catalogue:read,social:read,social:write,
  work:publish,work:request,work:read,wallet:read,wallet:write
  ```
- Pro: Tests pass without changes
- Con: Changes production behavior — new agents get broad permissions by default

**Option B — Use wildcard in test environment:**
- In `test/run-e2e-ci.ts`, set env var `AIMEAT_DEFAULT_AGENT_SCOPES=*` before starting the server
- Pro: Only affects test runs, no production impact
- Con: Doesn't test scope enforcement

**Option C — Update tests to pass explicit scopes:**
- Each test suite's agent registration sends `scopes: ['*']` or the specific scopes needed
- Pro: Tests are explicit, production defaults unchanged
- Con: More test code changes

**Recommended:** Option B for immediate fix + Option C for tests that specifically validate scope enforcement (like `e2e-security`).

### Files to modify

| File | Change |
|------|--------|
| `aimeat/test/run-e2e-ci.ts` | Set `AIMEAT_DEFAULT_AGENT_SCOPES=*` in server env |
| OR `aimeat/src/config.ts` | Widen default scopes |
| OR individual test files | Pass explicit scopes in agent registration |

---

## Fix 3 — Owner Name Validation Rejects Test Names (fixes ~55 tests)

**Problem:** `e2e-phase0` and `e2e-security` generate owner names with underscores (e.g., `testphase0_1773401597000`, `secowner_a_1773401597000`). The validation pattern `/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/` rejects underscores. All subsequent tests cascade-fail.

**Fix:** Update the test name generators to use hyphens instead of underscores.

### Files to modify

| File | Change |
|------|--------|
| `aimeat/test/e2e-phase0.ts` | Change `testphase0_${Date.now()}` → `testphase0-${Date.now()}` |
| `aimeat/test/e2e-security.ts` | Change `secowner_a_${...}` → `secowner-a-${...}`, same for `_b_` |

### Verification

After fix, run these two suites in isolation:
```bash
npx tsx test/run-e2e-ci.ts --suite e2e-phase0
npx tsx test/run-e2e-ci.ts --suite e2e-security
```

---

## Fix 4 — MCP Requires GHII Account (fixes ~15 tests)

**Problem:** MCP JSON-RPC calls return `GHII account required for MCP access`. The test creates a standard owner+agent but doesn't register a GHII identity.

**Fix:** Add GHII registration step to MCP test setup, similar to how `api-full.ts` creates a GHII user for chat instance tests.

### Files to modify

| File | Change |
|------|--------|
| `aimeat/test/e2e-mcp.ts` | In setup, after owner+agent registration, add `POST /v1/ghii` to create a GHII identity with password, then use the GHII login token for MCP calls |

### Additional MCP fixes

- **Test 5** ("Auth without signature → 400" gets 200): Check `src/routes/mcp.ts` or `src/routes/oauth.ts` — auth code endpoint may accept unsigned requests when it shouldn't
- **Test 28** (SSE stream 400): Check SSE endpoint session validation
- **Test 31** (Session close 404): Check if session close endpoint is registered

---

## Fix 5 — Extension System Admin Password (fixes ~19 tests)

**Problem:** `e2e-extensions.ts` uses `/v1/admin/setup/register` with hardcoded password `TestAdminPw123!`. The endpoint returns `401: Invalid admin password`.

**Root cause:** The test env doesn't set `AIMEAT_ADMIN_PASSWORD`, and the hardcoded fallback doesn't match what the server expects. Or the setup endpoint validation changed.

### Fix options

**Option A — Set admin password in test env:**
- In `test/run-e2e-ci.ts`, pass `AIMEAT_ADMIN_PASSWORD=TestAdminPw123!` as env var to the server process

**Option B — Use standard owner registration:**
- Change `e2e-extensions.ts` to use `POST /v1/owners` (like other suites) instead of `/v1/admin/setup/register`

### Files to modify

| File | Change |
|------|--------|
| `aimeat/test/run-e2e-ci.ts` | Add `AIMEAT_ADMIN_PASSWORD: 'TestAdminPw123!'` to server env |
| OR `aimeat/test/e2e-extensions.ts` | Switch to standard registration flow |

---

## Fix 6 — Missing `/v1/admin/translations` Endpoint (fixes 4 tests)

**Problem:** `GET /v1/admin/translations` returns 404. The admin UI loads translations client-side from static JSON files (`/locales/en.json`), but the test expects a server API endpoint.

### Fix options

**Option A — Create the endpoint:**
- Add a route in `src/routes/admin.ts` (or new file) that reads locale JSON files and returns them
- Register in `src/server.ts`

**Option B — Update tests to match current architecture:**
- Since admin translations are served as static files, update `e2e-admin-features.ts` to test `GET /locales/en.json` instead of `/v1/admin/translations`

### Files to modify

| File | Change |
|------|--------|
| `aimeat/src/routes/admin.ts` | Add `GET /v1/admin/translations` route |
| `aimeat/src/server.ts` | Register the translations route |
| `aimeat/locales/en.json` | Ensure admin dashboard keys exist |
| `aimeat/locales/fi.json` | Same |

---

## Fix 7 — Auth-Lib Password Validation (fixes 4 tests)

**Problem:** `e2e-auth-lib.ts` registers a GHII user with a password that lacks an uppercase letter. Validation in `ghii.ts:23-30` requires uppercase, lowercase, digit, and minimum 8 chars.

**Fix:** Update the test to use a compliant password (e.g., `TestPass1` instead of `testpass1`).

### Files to modify

| File | Change |
|------|--------|
| `aimeat/test/e2e-auth-lib.ts` | Change test password to include uppercase letter |

---

## Fix 8 — Micro-Memory 1KB Value Limit Not Enforced (fixes 1 test)

**Problem:** Test 23 sends a value >1KB but gets 200 instead of 400. The enforcement code exists at `micro-memory.ts:193` using `config.microMemoryMaxValueSizeBytes`.

**Root cause:** The config value may be set higher than 1024 in test env, or the value is slightly under 1024 bytes.

### Investigation

1. Check `config.ts` for `microMemoryMaxValueSizeBytes` default value
2. Check if the test value actually exceeds 1024 bytes in UTF-8 encoding
3. Verify the test env doesn't override the config

### Files to modify

| File | Change |
|------|--------|
| `aimeat/src/config.ts` | Verify `microMemoryMaxValueSizeBytes` default is 1024 |
| OR `aimeat/test/e2e-micro-memory.ts` | Ensure test value is definitely >1024 bytes |

---

## Fix 9 — Portal Template Issues (fixes 2 tests)

**Problem:**
- `GET /v1/portal` — response HTML missing `<title>` tag
- `GET /` — bootstrap response missing `hints.portal` property

### Fix

1. Check `public/spa.html` (or whichever template `/v1/portal` serves) — add/fix `<title>` tag
2. Check `src/routes/bootstrap.ts:52` — verify `portal` is included in the hints object returned by the root endpoint

### Files to modify

| File | Change |
|------|--------|
| `aimeat/public/spa.html` | Ensure `<title>` tag is present |
| `aimeat/src/routes/bootstrap.ts` | Ensure `hints.portal` is included in root response |

---

## Fix 10 — MongoDB Optimistic Locking Race Condition (fixes 1 test)

**Problem:** Two parallel PUT requests with the same version both return 200. The version check in the route handler (`memory.ts:547-552`) is not atomic with the update in MongoDB.

**Current flow (non-atomic):**
1. Route handler: `GET version` → compare with request version
2. Route handler: `storage.setMemory()` → upsert without version constraint

**Fix:** Make the update atomic using a conditional update.

### Files to modify

| File | Change |
|------|--------|
| `aimeat/src/storage/providers/mongodb/index.ts` | Change `setMemory` to use `updateOne` with version in the filter: `{ ownerGaii, key, version: expectedVersion }` → `$set` + `$inc: { version: 1 }`. Return a "not found" result if no document matched (meaning version conflict). |
| `aimeat/src/storage/interface.ts` | Update `setMemory` return type to indicate conflict vs success |
| `aimeat/src/routes/memory.ts` | Move version check from route handler into storage layer, handle conflict return |
| `aimeat/src/storage/providers/sqlite/index.ts` | Apply same atomic pattern for SQLite (use `UPDATE ... WHERE version = ?`) |

---

## Fix 11 — Anonymous Mode Test Expectations (fixes ~10 tests)

**Problem:** `e2e-anonymous` expects memory CRUD to work without auth, but `requireAuth()` is enforced on all memory endpoints. Anonymous agents use micro-memory (`/v1/mm`), not full memory.

### Fix options

**Option A — Update tests to match current design:**
- Remove expectations for no-auth memory CRUD
- Test anonymous access through micro-memory only

**Option B — Add anonymous bypass for memory endpoints:**
- In `src/routes/memory.ts`, allow requests to the anonymous agent's namespace without auth
- Risky — changes security model

**Recommended:** Option A. The anonymous mode uses micro-memory by design.

### Additional anonymous test fixes

- **Prompt boot steps:** Test expects 5 steps, server returns 6. Either update test expectation or remove the extra step from the prompt template.
- **Micro-memory list issues:** `score mismatch` and `at least one set` — investigate the micro-memory list/sets endpoints for anonymous agent.

### Files to modify

| File | Change |
|------|--------|
| `aimeat/test/e2e-anonymous.ts` | Update Phase 2 tests (remove no-auth memory CRUD expectations), fix Phase 3 expectations, update Phase 4 boot step count |

---

## Execution Order

```
Phase 1 — High impact (resolve ~180 failures)
├── Fix 1: Operator role recognition
├── Fix 2: Default agent scopes in test env
└── Fix 3: Owner name validation in tests

Phase 2 — Medium impact (resolve ~25 failures)
├── Fix 4: MCP GHII registration
├── Fix 5: Extension admin password
└── Fix 6: Admin translations endpoint

Phase 3 — Low impact (resolve ~9 failures)
├── Fix 7: Auth-lib test password
├── Fix 8: Micro-memory value limit
├── Fix 9: Portal template issues
├── Fix 10: MongoDB optimistic locking
└── Fix 11: Anonymous mode test expectations
```

---

## Verification

After all fixes, run the full E2E suite against both storage backends:

```bash
cd aimeat
pnpm test:e2e:mongodb
pnpm test:e2e:sqlite
```

Target: **522/522 passing** (or document any intentionally skipped tests).

---

## Risk Assessment

| Fix | Risk | Notes |
|-----|------|-------|
| Fix 1 | Medium | Requires understanding cross-suite state contamination |
| Fix 2 | Low | Env var change in test runner only |
| Fix 3 | Low | Simple string replacement in tests |
| Fix 4 | Low | Add setup step to test |
| Fix 5 | Low | Env var or test code change |
| Fix 6 | Low | New endpoint or test update |
| Fix 7 | Low | Change test password string |
| Fix 8 | Low | Config verification |
| Fix 9 | Low | Template/bootstrap fix |
| Fix 10 | Medium | Storage layer refactor — must not break existing behavior |
| Fix 11 | Low | Test expectation updates |
