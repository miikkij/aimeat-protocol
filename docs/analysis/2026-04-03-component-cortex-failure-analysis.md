# Component Cortex (Yrityskortti) Failure Analysis

**Project:** prj-mnhzlw4a-2k21l
**Component:** component-company-card (Yrityskortti)
**Run timestamp:** 2026-04-03 ~13:18-13:22
**Result:** FAILED after all fix rounds + fresh generation

---

## File-by-File Analysis

### 1. spec-prompt.txt (13:18)
The spec prompt correctly loaded `gen-component-spec`. It contains:
- Component label: "Yrityskortti"
- Data API spec from the data cortex (JSON with all 8 methods)
- Translation keys

**Verdict:** ✅ Correct

### 2. spec.txt / spec-raw-response.txt (13:18)
The spec was generated correctly:
```json
{
  "name": "yrityskortti",
  "libName": "yrityskortti",
  "render": {
    "signature": "AIMEAT.yrityskortti.render(container, props)",
    "props": { "company", "locale", "translations", "onViewDetails", "onCompare", "onAddToWatchlist", "onRemoveFromWatchlist", "isInWatchlist" }
  },
  "dataAccess": ["getCompany", "addToWatchlist", "removeFromWatchlist", "getComparisonData"]
}
```

The spec correctly defines this as a RENDER component — it exports `render(container, props)` and receives data via props. It does NOT export data methods. The `dataAccess` list shows which data cortex methods it USES (via `AIMEAT.finnishCompanyWatchlist`), not what it exports.

**Verdict:** ✅ Correct — this is a UI component, not a data layer.

### 3. prompt.txt (13:18) — Code generation prompt
Contains:
- `{{spec_section}}` with name enforcement: "metadata.name MUST be: yrityskortti, LIB_NAME MUST be: yrityskortti" ✅
- `{{use_case}}` — ALL use cases listed ✅ (fix from earlier worked)
- `{{view_section}}` — ALL views listed ✅
- `{{data_cortex_api}}` — **STILL EMPTY** ❌ — the warnFallback fired at 10:15

Wait — the timestamps suggest there were multiple runs. Let me check if this run (13:18) had the subtype fix applied...

The data_cortex_api being empty means the subtype enrichment either wasn't applied in this run, or the data cortex's contextBundle was missing. The API route enrichment was committed at 6131126 but the server may not have been restarted.

**Verdict:** ⚠️ Missing data cortex API in the code prompt. The component cortex has no idea how to call `AIMEAT.finnishCompanyWatchlist`.

### 4. ai-raw-response.txt (13:19) — Generated cortex code
The LLM generated a component that:
- `name: yrityskortti`, `LIB_NAME = 'yrityskortti'` ✅ (spec enforcement worked!)
- Exports ONLY `render(container, props)` ✅ (correct for a UI component)
- Uses `dv()` helper for nested values ✅
- 575 lines of DOM rendering code
- Does NOT export searchCompanies, getCompany, getWatchlist etc. — CORRECT, these belong to the data cortex

**Verdict:** ✅ The code is correct for a component cortex. It's a render-only component.

### 5. test-prompt.txt (13:19) — Test generation prompt

**MULTIPLE CRITICAL ISSUES:**

a) **Line 6: "Registered as:" is EMPTY** — the `wraps_extension` variable resolved to empty because the component spec doesn't have `wrapsExtension` (only data cortex specs have that).

b) **Lines 8-9: `{{cortex_methods}}` is EMPTY** — the resolver uses `bpComp.produces.filter(p => p.startsWith('api:'))` to find methods. But this component's blueprint produces are `["ui:company-card"]` — NO `api:` prefixed methods. The cortex_methods section is empty because component cortexes produce UI, not API methods.

c) **Line 13: "Test ONLY the cortex library methods listed above"** — but there IS no list above. The LLM has no guidance on what to test.

d) **Lines 1120-1127: Action contracts show ALL cortex: methods** — `cortex:searchCompanies`, `cortex:getCompany`, `cortex:addToWatchlist` etc. These are DATA CORTEX methods, not component cortex methods. The action contracts are not filtered by component — they show ALL cortex actions from the blueprint.

e) **Golden samples show extension probe data** — searchCompanies, getCompany, addToWatchlist responses. These are data layer operations, not UI render operations.

**Result:** The test LLM sees data cortex methods in contracts + golden samples, sees no component method list, and generates tests that call `lib.searchCompanies()`, `lib.getWatchlist()` etc. on the component cortex — which only exports `render()`.

**Verdict:** ❌ The test prompt is fundamentally wrong for component cortexes. It was designed for data cortex (which exports API methods). Component cortexes export `render()` and need a completely different test approach.

### 6. test-raw-response.txt (13:19) — Generated test code
Tests `searchCompanies`, `getCompany`, `addToWatchlist`, `removeFromWatchlist`, `getWatchlist`, `getChangeHistory`, `markChangesRead`, `getComparisonData` — ALL wrong. The component only exports `render()`.

**Verdict:** ❌ Wrong test — testing data methods on a UI component.

### 7. test-fix-1-reflection-response.txt (13:19)
The reflection CORRECTLY identifies the problem: "the test is calling lib.searchCompanies, but the component only exports a render function". It says the test should test `render()` instead.

**Verdict:** ✅ Correct diagnosis. But the fix prompt has to fix the CORTEX CODE (not the test), so it can't act on this.

### 8. test-fix-1-fix-response.txt (13:21)
The fix LLM ADDS searchCompanies, getCompany, getWatchlist, addToWatchlist, removeFromWatchlist, getChangeHistory, markChangesRead, getComparisonData methods to the component — making it a DUPLICATE of the data cortex instead of a UI component. This completely destroys the component's architecture.

**Verdict:** ❌ The fix broke the component by making it a data layer copy.

### 9. test-fix-2-reflection-response.txt (13:21)
Says "the test expects getWatchlist but your component doesn't export it". Recommends adding more data methods.

**Verdict:** ❌ Wrong recommendation — perpetuates the architecture corruption.

### 10. test-fix-2-fix-response.txt (13:22)
Adds even MORE data methods. Component is now a bloated hybrid.

**Verdict:** ❌ Architecture completely destroyed.

---

## Root Cause

**The test prompt (`gen-test-cortex-spec`) is designed for DATA CORTEX only.** It assumes the cortex exports API methods and tests them. But COMPONENT cortexes export `render()` — they are UI components that CALL the data cortex, not data layers themselves.

The test for a component cortex should:
1. Load the component library
2. Call `lib.render(container, { company: mockData, ... })`
3. Check that DOM elements were created
4. Check that buttons/interactions work
5. NOT try to call searchCompanies, getCompany, etc.

This requires a DIFFERENT test prompt for component cortexes — something like `gen-test-cortex-component-spec` that tests render/DOM, not API methods.

## What Needs to Change

1. **Different test prompts per cortex subtype:**
   - `data` → current `gen-test-cortex-spec` (tests API methods via `window.AIMEAT.libName.method()`)
   - `component` → NEW test prompt that tests `render()` with mock data, checks DOM output
   - `app-domain` → NEW test prompt that tests `init()` + `render()`, checks navigation

2. **Action contracts in test prompt should be filtered by component, not all cortex:** The current test prompt shows ALL `cortex:*` actions. For a component cortex, it should only show what that component produces/consumes.

3. **`{{cortex_methods}}` for component cortex:** Currently looks for `api:*` in produces. Component cortex produces `ui:*`, not `api:*`. The method list should show `render(container, props)` based on the spec.

4. **Registered as:** empty because the test resolver uses `spec.wrapsExtension` which only exists for data cortex. For component cortex, it should use `spec.name` or `comp.registeredAs`.
