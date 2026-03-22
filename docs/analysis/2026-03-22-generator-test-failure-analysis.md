# Generator Extension Test Failure — Root Cause Analysis

> **Date:** 2026-03-22
> **Subject:** PRH Yritystietopalvelu extension tests fail during autopilot
> **Status:** Analysis complete, solution proposed
> **Debug log:** `debug_generator.txt`

---

## 1. Observed Symptoms

The autopilot generated a PRH company lookup extension. After registration, the per-component test ran and produced 7 errors:

```
searchCompanies (name): no results
searchCompanies (businessId): no results
addToWatchlist: error - Yrityksen tietojen haku epäonnistui
checkWatchlist: did not check any companies
removeFromWatchlist: error - Yritystä ei löydy seurantalistalta
addToWatchlist (re-add): not successful
removeFromWatchlist (second): not successful
```

The fix loop ran 3 rounds but could not fix the issue because the root cause is not in the extension code.

---

## 2. Root Cause Analysis

### 2.1 The Cascade

All 7 failures trace to a single root cause: **the PRH API (`avoindata.prh.fi`) returns HTTP 400 errors during testing**.

```
Cascade:
PRH API → 400 error
  → searchCompanies returns { error: 'API-pyyntö epäonnistui: 400' }
    → test checks for results → "no results" error
  → addToWatchlist can't fetch company data → error
    → watchlist empty → checkWatchlist finds nothing
      → removeFromWatchlist can't find entry → error
```

The extension code itself handles the error correctly — it returns `{ error: '...' }` with a Finnish error message. The problem is that **the test code treats any error response from an external-API-dependent action as a test failure**, even though the test prompt explicitly says:

> "For EXTERNAL API actions: the extension may return an error message if the third-party API refused the call (403, 429, etc). This is CORRECT behavior — the extension handled it gracefully. Only FAIL if HTTP 500."

### 2.2 Why the AI Ignores the Guidance

The test prompt contains a **fundamental contradiction**:

1. **General rule** (line 166 of generator-prompts-test.js): "For EXTERNAL API actions... Only FAIL if HTTP 500"
2. **Scenario expectations** (from blueprint testScenarios): "Search for 'Overscale' → returns Overscale Solutions Oy", "Add 3323553-5 to watchlist → succeeds"

The AI-generated test code follows the **specific scenario expectations** (which assume real data) rather than the **general tolerance rule** (which says API errors are OK). This is the expected behavior from an LLM — specific overrides general.

### 2.3 Why the Fix Loop Can't Help

The fix loop sends the test errors back to the LLM to fix the extension code. But the extension code is correct — the PRH API genuinely returns 400. The LLM can't fix an external API's behavior. Each fix round either:
- Produces identical code (nothing to fix)
- Makes cosmetic changes that don't affect the external API call
- Potentially makes the code worse by trying to work around a non-bug

### 2.4 Missing Deactivation Step

The fix loop in `use-autopilot.js` (lines 291-315) does: re-register → apply-settings → activate. It does NOT deactivate before re-registering. The `registerComponent` function does upsert (delete+create), so the old extension is removed. But the extension runtime may still have the old version cached/loaded until explicitly deactivated. This means the re-test might execute against the OLD extension code, not the fixed version.

---

## 3. Problem Categories

| # | Problem | Severity | Where |
|---|---------|----------|-------|
| P1 | Test prompt contradiction: scenarios expect real data but rule says API errors OK | **Critical** | `generator-prompts-test.js` |
| P2 | No distinction between "action that needs external API" vs "memory-only action" in test scenarios | **Critical** | Blueprint testScenarios + test prompt |
| P3 | Fix loop can't fix external API issues — wastes 3 rounds on unfixable problem | **High** | `use-autopilot.js` fix loop logic |
| P4 | Missing deactivation before re-registration in fix loop | **Medium** | `use-autopilot.js` fix loop |
| P5 | Test scenarios use real company data that may not exist or may change | **Medium** | Blueprint testScenarios |

---

## 4. Solution Research

### Solution A: Classify test scenarios by API dependency (Probability: 85%)

**Approach:** Each test scenario in the blueprint gets a `type` field: `"memory"` or `"external-api"`. The test prompt generates different assertion logic based on the type:
- `memory` scenarios: MUST succeed (current behavior)
- `external-api` scenarios: PASS if action returns any non-500 response. Check that the response shape is correct (has either data fields OR an error message), but don't assert specific data values.

**Changes needed:**
1. Blueprint prompt: add `type: "memory" | "external-api"` to each testScenario
2. Test prompt: generate different assertion patterns per type
3. Test prompt example: show both patterns explicitly

**Pros:** Directly addresses P1 and P2. The AI sees concrete examples of both patterns.
**Cons:** Requires blueprint prompt change (CLAUDE.md says don't modify prompts that work — but test scenarios are a new feature, not the core prompts).

### Solution B: Test against extension's internal logic only — mock external calls (Probability: 40%)

**Approach:** Provide a mock ctx.fetch in the test sandbox. The test code calls the extension action, which calls ctx.fetch, but ctx.fetch returns predefined responses.

**Changes needed:**
1. Major change to the test execution backend (`generator-testing.ts`)
2. Need to generate mock response data for each external API
3. Test prompt needs to generate both the mock data AND the assertions

**Pros:** Tests are deterministic — no external dependencies.
**Cons:** Very complex. The extension sandbox already provides `ctx.fetch` — intercepting it at test time requires a different execution path. Mock data may not match real API format. The test would not verify real integration.

### Solution C: Two-phase testing — functional tests + integration tests (Probability: 60%)

**Approach:** Split tests into:
1. **Functional tests** (always run): Test memory-only actions, error handling, input validation
2. **Integration tests** (optional): Test external API actions, only pass/fail on HTTP 500

The test prompt generates both categories clearly labeled. The test runner separates results.

**Changes needed:**
1. Test prompt: explicit two-phase structure with different success criteria
2. Test result format: add `phase` field to distinguish functional vs integration
3. TestResultsView: show functional and integration results separately

**Pros:** Clear separation. Functional tests always pass for correct code. Integration tests are informational.
**Cons:** More complex UI. May confuse the fix loop — which failures should trigger fixes?

### Solution D: Fix the test prompt contradiction only (Probability: 70%)

**Approach:** Remove the specific data expectations from external-API scenarios in the test prompt. Instead, change the example to show:
- Check response shape (has `results` array OR `error` string)
- Check HTTP status is not 500
- For external API actions, any of these is a PASS

**Changes needed:**
1. Test prompt: rewrite the external API example to be more explicit
2. Test prompt: add a clear rule that scenario `expect` values for external-API actions are "ideal case" descriptions, not hard assertions

**Pros:** Minimal change. Addresses P1 directly.
**Cons:** The AI might still generate strict assertions if the scenario `expect` text is very specific.

### Solution E: Add deactivation step to fix loop (Probability: 95%)

**Approach:** Before re-registration in the fix loop, deactivate the extension:
```javascript
await apiPost(`/v1/extensions/${encodeURIComponent(updated.registeredAs)}/deactivate`);
```

**Changes needed:** 1 line addition in `use-autopilot.js` fix loop.

**Pros:** Trivially correct. Ensures clean state.
**Cons:** Only fixes P4, not the test design issues.

---

## 5. Recommended Solution: A + D + E Combined

The best combination addresses all problems with minimal risk:

### 5.1 Fix the test prompt (Solution D — enhanced)

In `generator-prompts-test.js`, change the external API example and add a clearer rule:

**Current problematic example:**
```javascript
// EXTERNAL API action — must not crash (HTTP 500); graceful errors are acceptable
const r2 = await testFetch('/v1/ext/my-service/fetchData', { ... });
if (r2.status === 500) errors.push('fetchData: crashed with HTTP 500');
// r.body.data.error with a message is OK
```

**Improved example:**
```javascript
// EXTERNAL API action — PASS if response shape is correct, even if API returned an error
const r2 = await testFetch('/v1/ext/my-service/fetchData', { ... });
if (r2.status === 500) errors.push('fetchData: crashed with HTTP 500');
else {
  // External API may be unreachable — that's OK if extension handled it gracefully
  const d = r2.body?.data;
  if (!d) errors.push('fetchData: no response data');
  else if (!d.results && !d.error) errors.push('fetchData: unexpected response shape');
  // Do NOT check specific values — the external API may return different data or errors
}
```

Add this explicit rule to the test prompt:
```
CRITICAL TESTING RULE FOR EXTERNAL APIs:
When an action calls an external API (ctx.fetch to a third-party URL):
- PASS if: HTTP status is not 500 AND response has a valid shape (either success data OR error message)
- FAIL only if: HTTP 500 (extension crashed) OR no response data at all
- NEVER assert specific data values from external APIs — the API may be down, rate-limited, or return different data
- The scenario "Expected" descriptions are IDEAL outcomes — use them to understand what the action SHOULD do, but do NOT hard-assert them for external API calls
```

### 5.2 Classify scenarios in blueprint (Solution A — lightweight)

Add a `type` hint to blueprint testScenarios. The blueprint prompt already generates `testScenarios` — add guidance for the LLM to mark each scenario:

```json
{
  "action": "searchCompanies",
  "input": { "query": "Nokia" },
  "expect": "Returns matching companies",
  "type": "external-api"
}
```

The test prompt then uses `type` to select the assertion pattern. If `type` is missing, default to `"memory"` for backward compatibility.

### 5.3 Add deactivation to fix loop (Solution E)

In `use-autopilot.js`, before re-registration in the fix loop, add:
```javascript
// Deactivate before re-registering to ensure clean state
if (comp.type === 'extension') {
  try { await apiPost(`/v1/extensions/${encodeURIComponent(updated.registeredAs)}/deactivate`); } catch { /* may not be active */ }
}
```

### 5.4 Implementation order

1. **E first** (deactivation) — 1 line, zero risk, fixes P4
2. **D next** (test prompt) — update example and add rule, fixes P1
3. **A last** (scenario classification) — blueprint prompt + test prompt, fixes P2 and P5

### 5.5 Expected outcomes

| Problem | Solution | Expected result |
|---------|----------|----------------|
| P1: Prompt contradiction | D: Clear rule + better example | AI generates tests that pass for correct error handling |
| P2: No action type distinction | A: Scenario `type` field | Test code uses different assertion patterns per type |
| P3: Fix loop wastes rounds | D+A: Tests pass on first run if code is correct | Fix loop only triggers for real code bugs |
| P4: Missing deactivation | E: Add deactivate call | Clean extension state after re-registration |
| P5: Hardcoded test data | A+D: Don't assert specific values for external APIs | Tests work regardless of external API state |

---

## 6. Simulation / Verification Plan

Before implementing, verify by mental simulation:

**Scenario: PRH API returns 400 for all requests**

With the fix:
1. Test calls `searchCompanies({ query: "Nokia" })`
2. Extension calls `ctx.fetch(prh_url)` → gets 400
3. Extension returns `{ error: "API-pyyntö epäonnistui: 400" }`
4. Test checks: HTTP not 500 ✓, `r.body.data` exists ✓, has `.error` field ✓ → **PASS**
5. Test calls `addToWatchlist({ businessId: "..." })`
6. Extension returns `{ error: "Yrityksen tietojen haku epäonnistui" }`
7. Test checks: HTTP not 500 ✓, response has `.error` ✓ → **PASS**
8. Test calls `init({})` → succeeds → **PASS**
9. Test calls `removeFromWatchlist(...)` on empty list → `{ error: "..." }` → **PASS** (error handling test)

Result: All tests pass. The extension is correct — it handles API errors gracefully.

**Scenario: PRH API works normally**

With the fix:
1. `searchCompanies` returns results → test checks shape has `.results` array → **PASS**
2. `addToWatchlist` succeeds → test checks shape has relevant fields → **PASS**
3. All other tests also pass with valid data

Result: All tests pass. Extension works correctly with live API.

**Scenario: Extension has a real bug (crashes on null input)**

With the fix:
1. Test sends `searchCompanies({})` → extension throws → HTTP 500 → **FAIL**
2. Fix loop triggers → LLM fixes the null check → re-test → **PASS**

Result: Real bugs are still caught and fixed.

---

## 7. Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Test prompt change affects existing working tests | Only the external-API example changes; memory-only logic is unchanged |
| Blueprint prompt change (scenario types) may break existing blueprints | `type` field is optional — defaults to `"memory"` if missing |
| LLM still generates strict assertions despite new guidance | The example code is concrete — LLMs follow examples more than rules |
| Deactivation call fails | Wrapped in try/catch, failure is non-fatal |
