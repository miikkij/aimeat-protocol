# Generator Audit — All Findings Summary (2026-03-25)

All findings from 4 independent Opus 4.6 audits of extension, cortex, and app systems.

## CRITICAL: Root causes of "tests pass but app doesn't work"

### 1. Test page auth mock returns different format than real auth
**Source:** App audit (Opus)
**Files:** `generator-testing.ts` (auth injection) vs `libs.ts` (real aimeat-auth.js)

The test page injects a mock `AIMEAT.auth.getSession()` where `session.fetch()` returns raw `resp.json()`. The REAL `aimeat-auth.js` returns a custom object `{ ok, data, error, status }` — the AIMEAT envelope, already parsed.

**Impact:** Cortex code generated for test environment works differently than in production. A cortex that does `resp.data` works in production but the mock returns the raw JSON without `.data` wrapper.

### 2. Test page data mock has wrong method names
**Source:** App audit (Opus)
**Files:** `generator-testing.ts` auth injection code

Mock exposes `AIMEAT.data.put()` but the real library method is `AIMEAT.data.set()`. Mock is missing `delete()` entirely.

**Impact:** App code generated to pass tests uses `put()` which doesn't exist in production.

### 3. Cortex template tells AI to use GET for some extension actions — GET route doesn't exist
**Source:** Cortex audit (Opus)
**Files:** `generator-prompts-base.js` line 1083-1103 vs `extensions.ts` line 1009

The cortex template says: match the extension manifest's declared HTTP method. Some manifests declare GET. But the actual backend only has `router.post('/v1/ext/:extName/:actionId')` — no GET route.

`EXTENSION_CONSUMPTION_RULES` (line 1549) correctly says "ALL actions use POST" but this constant is NOT included in the cortex generation prompt — only in test prompts.

**Impact:** AI generates cortex code that uses GET for some calls → 404.

### 4. stripCodeblock only ran for extensions (FIXED this session)
**Source:** Debug analysis
**Files:** All use-*.js files

AI responses come wrapped in ` ```lang ... ``` `. Only extensions were stripped. Cortex got ` ```yaml ``` ` wrapper, app got ` ```html ``` ` wrapper passed to validation and registration.

**Status:** FIXED — stripCodeblock now runs for all component types.

## MODERATE: Prompt inaccuracies that cause AI to generate broken code

### 5. ctx.wallet.deposit — doesn't exist
**Source:** Extension audit (Opus)
**File:** `generator-prompts-base.js` SANDBOX_CONSTRAINTS

Prompt mentions `deposit` but actual API only has `consume()` and `getBalance()`.

### 6. ctx.consent.request — should be ctx.consent.require
**Source:** Extension audit (Opus)
**File:** `generator-prompts-base.js` SANDBOX_CONSTRAINTS

Wrong method name. AIMEAT_CONTEXT gets it right, but SANDBOX_CONSTRAINTS has the wrong name.

### 7. ctx.wallet.balance — should be ctx.wallet.getBalance()
**Source:** Extension audit (Opus)
**File:** `generator-prompts-base.js` SANDBOX_CONSTRAINTS

Wrong method name.

## CRITICAL: Sandbox identity crisis — AI thinks it's writing for Node.js or browser

### 14. Web APIs not available in isolated-vm — prompt doesn't establish the environment correctly
**Source:** Live test failure 2026-03-25T09:13, verified against `extension-runtime.ts`
**Error:** `URLSearchParams is not defined [<isolated-vm>]`

**Root cause:** The V8 isolate is a **bare JavaScript engine** — NOT Node.js, NOT a browser. It has only ECMAScript built-ins. The prompt's "NOT available" list focuses on Node.js things (`require`, `fs`) and browser things (`document`, `window`). This makes AI think "OK, it's neither Node.js nor browser, but standard JavaScript APIs are fine." Wrong — Web APIs like `URLSearchParams` exist in both Node.js and browsers but NOT in bare V8.

**The prompt needs to establish identity first:** "You are writing code for a bare V8 isolate. ONLY ECMAScript built-in objects and functions are available. Nothing from the Web API, nothing from Node.js."

**Unavailable (confirmed against isolated-vm source — no globals injected):**
- `URLSearchParams`, `URL` — caused today's crash
- `TextEncoder`, `TextDecoder`
- `Headers`, `Request`, `Response`
- `FormData`, `Blob`, `File`
- `AbortController`, `AbortSignal`
- `atob`, `btoa`
- `structuredClone`
- `crypto` (Web Crypto)
- `queueMicrotask`, `performance`

**Available (V8 ECMAScript built-ins):**
- `JSON`, `Math`, `Date`, `RegExp`, `Promise`, `async/await`
- `encodeURIComponent`, `decodeURIComponent`, `parseInt`, `parseFloat`
- `String`, `Array`, `Object`, `Map`, `Set`, `WeakMap`, `WeakSet`
- `Symbol`, `Proxy`, `Reflect`

**Correct URL construction pattern:**
```
WRONG:  const params = new URLSearchParams(); params.set('name', query);
RIGHT:  const url = baseUrl + '?name=' + encodeURIComponent(query);
```

### 15. Previous "Function statements require a function name" error
**Source:** Live test failure 2026-03-25T08:41

Same pattern — AI used a Web API or syntax feature not in bare V8.

## LOW: Gaps and dead code

### 8. App manifest `entry` field is dead code
**Source:** App audit (both agents)
**File:** `generator-registration.ts`

Prompt shows `entry: index.html` but `registerApp()` never reads it.

### 9. Dual CSP conflict
**Source:** App audit (Opus)

Server sets permissive CSP header for inline mode. Prompt tells AI to add restrictive meta CSP. Browser intersects both → most restrictive wins → can block legitimate API connections.

### 10. App manifest validation too weak
**Source:** App audit (Opus)
**File:** `generator-validate.js`

The `name:` check matches any `name:` text in HTML (e.g., `<meta name="viewport">`).

### 11. API call limit not documented in prompts
**Source:** Extension audit (Opus)

Extensions have a shared API call counter. Log calls don't count. Not mentioned in prompts.

### 12. ctx.fetch 30s timeout not documented
**Source:** Extension audit (Opus)

Hardcoded at 30s regardless of extension's `limits.timeoutMs`.

### 13. Multi-instance memory namespace not documented
**Source:** Extension audit (Explore)

`ext:{name}.{instanceId}` pattern not in prompts.

## Phase 2B Detailed Findings: Cortex facts check

### session.fetch() return type
- **Prompt says:** returns already-parsed JSON `{ok, data, error}` — never call `.json()`
- **Actual code** (`libs.ts:396`): `return resp.json()` — returns AIMEAT envelope
- **Verdict:** ✅ Correct. The envelope IS `{ok, data, error, ...}`.

### Extension action HTTP method
- **Prompt says** (`generator-prompts-base.js:1192`): "method MUST match extension action's declared method (GET or POST)"
- **Actual code** (`extensions.ts:1009`): Only `router.post()` exists. No GET route.
- **EXTENSION_CONSUMPTION_RULES** (`generator-prompts-base.js:1549`): "ALL actions use POST"
- **But:** EXTENSION_CONSUMPTION_RULES is NOT included in cortex generation prompt. Only in fix/test prompts.
- **Verdict:** ❌ Cortex template gives wrong advice. AI may generate GET calls that 404.

### Test page auth mock vs real auth
- **Mock** (`generator.ts:624-631`): `session.fetch()` does `return resp.json()` ✅ matches real
- **Verdict:** ✅ Auth mock session.fetch IS correct (same as libs.ts:396)
- **Earlier claim that mock returns different format was WRONG** — I apologize for the false finding.

### Test page AIMEAT.data mock vs real library
- **Mock provides:** `getPublic(ns,key)`, `get(key)`, `put(key,value)` — 3 methods
- **Real library provides:** `set`, `get`, `getEntry`, `update`, `delete`, `list`, `search`, `getPublic` — 8 methods
- **Mock `put()` should be `set()`** — wrong name, wrong signature (real `set` takes `(key, value, opts)`)
- **Mock missing:** `delete`, `list`, `search`, `getEntry`, `update`
- **Verdict:** ❌ Mock has wrong method name and is incomplete

### EXTENSION_CONSUMPTION_RULES not in cortex generation prompt
- **Where it IS used:** fix prompt (cortex type), edit prompt (cortex type), test prompt (all types)
- **Where it is NOT:** `generator-prompts-build.js` — the initial generation prompt
- **Impact:** First-time cortex generation doesn't know "ALL actions use POST"
- **Verdict:** ❌ Missing from the most important prompt

## Phase 2C Detailed Findings: App facts check

### Boot sequence
- **Prompt says:** loadScript(auth) → loadScript(data) → loadScript(cortex) → mountLoginButton → login
- **Verified against code** (`generator-prompts-base.js:577-593`): ✅ Correct sequence

### Cortex code injection into app prompt
- **Line 532:** `lib.result` (full cortex code) is injected verbatim into app prompt
- **Before stripCodeblock fix:** This included ` ```yaml ... ``` ` wrapper → AI got malformed context
- **After fix:** Clean code injected ✅

### "method MUST match" in app template (line 642)
- Same wrong claim as cortex template
- App's `extCall()` helper supports GET (line 651-653) but backend only has POST
- **Verdict:** ❌ Wrong — app-generated code may use GET which returns 404

### Data mock in test page
- `put(key, value)` should be `set(key, value, opts)` — wrong name
- Missing: `delete`, `list`, `search`, `getEntry`, `update`
- **Verdict:** ❌ Mock incomplete and misnamed

### CSP meta tag vs server CSP
- Prompt (line 676-678) tells AI to add restrictive meta CSP
- Server adds its own CSP header for inline-served apps
- Browser intersects both → most restrictive wins
- **Verdict:** ⚠️ Potential conflict but works if meta CSP is at least as permissive as server

### App manifest `entry` field
- Prompt shows `entry: index.html` in manifest template
- `registerApp()` never reads it
- **Verdict:** ⚠️ Dead code, harmless

## Phase 3: Current Failure Analysis

### 3A. Extension: "URLSearchParams is not defined" (CURRENT BLOCKER)
**Error:** `URLSearchParams is not defined [<isolated-vm>]` — status 500 on searchCompanies, getCompany, checkWatchlist
**Root cause:** Phase 2A finding #14 — bare V8 isolate has no Web APIs. AI generated `new URLSearchParams()`.
**Evidence from trace:**
- Actions that use `ctx.fetch()` + URL construction (searchCompanies, getCompany, checkWatchlist) → 500
- Actions that use only `ctx.memory` (init, addToWatchlist, removeFromWatchlist) → 200 ✅
**Fix:** SANDBOX_CONSTRAINTS must explicitly state "bare V8 — no Web APIs" and provide `encodeURIComponent()` pattern for URL construction.

### 3B. Extension: "Function statements require a function name" (earlier run)
**Error:** From 2026-03-25T08:41 run
**Hypothesis:** Same class of error — AI used a Web API or modern JS feature not in bare V8. Could also be a `stripCodeblock` artifact from before the fix.
**Status:** Superseded by 3A — the URLSearchParams error in the latest run confirms the pattern.

### 3C. Cortex: "searchCompanies: should return array" / "businessId should be a string"
**Error:** Cortex test expected `companies[0].businessId` to be string `"3323553-5"`, but PRH API returns `{value: "3323553-5", registrationDate: "2022-11-07", source: "3"}`
**Root cause:** AI doesn't know the actual PRH API response shape. Prompt doesn't include it. When human copies prompt to chat, the human eventually sees the real data and the AI adapts. In automation, the AI never sees the real data.
**Fix needed:** Probe-vaihe — after extension works, call it with real params, capture response, inject into cortex/test prompts.

### 3D. App: "Extension not found" (404)
**Error:** `POST /v1/ext/prh-yritystietopalvelu/searchCompanies 404`
**Root cause:** Extension registered as `prh-tiedonhaku` (metadata.name in YAML). App calls `prh-yritystietopalvelu` (CSM name / label). Cortex knows the right name but app bypassed cortex and called extension directly.
**Contributing factor:** stripCodeblock wasn't applied to cortex → cortex result had ` ```yaml ``` ` wrapper → when injected into app prompt, AI couldn't parse it properly → fell back to direct extension calls using the wrong name.
**Fix:** stripCodeblock for all types (DONE), plus verify cortex code is clean before injecting into app prompt.

### 3E. App: "Test did not complete"
**Error:** App test timeout, no useful info
**Root cause:** Test page injects hand-built AIMEAT.auth/data instead of loading real libraries. If cortex calls fail silently, test never reaches `window.__testResults`.
**Fix:** Test page should load real aimeat-auth.js and aimeat-data.js via `<script>` tags — same boot as production.

## Phase 4: Cross-Reference with Research

Full research: `docs/analysis/2026-03-25-generator-research-raw.md`

### Failure → Research pattern → Solution mapping

**Failure 3A: URLSearchParams (V8 sandbox identity)**
- **Research pattern:** None directly — this is a factual prompt error, not an architectural issue
- **Solution:** Fix the prompt. No research-backed technique needed.
- **But also:** ROCODE (ICSE 2025) demonstrates "incremental error detection during generation" — a compile/runtime check immediately after generating extension code would catch this before testing. We already have the sandbox — we could attempt to *parse* the generated code in V8 isolate before registering it.

**Failure 3C: AI doesn't know PRH API response shape (businessId is object, not string)**
- **Research pattern:** **Execute between steps** (Devin, Bolt, Lovable, CodeAct) + **Golden sample / Probe** (Section 5 of research)
- **Evidence:** "All tools that handle multi-file generation well execute code between generation steps and feed real outputs back." (Research Section 1.5)
- **Specific technique:** After extension registers and activates, call `POST /v1/ext/{name}/searchCompanies` with `{"query":"Overscale Solutions"}`, capture the REAL JSON response. Inject that JSON literally into cortex prompt: "Here is what the extension actually returns: {real JSON}". AI then generates code that handles `businessId.value` correctly.
- **Sources:** Devin (cognition.ai/blog/devin-2), CodeAct (arxiv.org/abs/2402.01030), Lovable context bundle (system-design.space/en/chapter/lovable-startup-architecture/)

**Failure 3D: Extension name mismatch (prh-yritystietopalvelu vs prh-tiedonhaku)**
- **Research pattern:** **Shared blackboard / Contract-first** (Section 4.2) + **Planner-coder gap** (Section 4.1)
- **Evidence:** "The planner-coder gap accounts for 75.3% of all observed failures in tested multi-agent systems." Semantic drift and context fragmentation between steps.
- **Specific technique:** After extension registers, its `registeredAs` name is stored. That exact name MUST be injected into every subsequent prompt literally — not described, not summarized, but the actual string. This is the "blackboard" pattern: a shared fact that all steps read.
- **Our pipeline already does this** via `completedComponents` which includes `registeredAs`. The failure happened because cortex result was corrupted by ` ```yaml ``` ` wrapper (stripCodeblock bug, now fixed) → app couldn't parse cortex code → fell back to direct extension calls with wrong name.

**Failure 3E: Test tautology — tests pass but app doesn't work**
- **Research pattern:** **Independent test designer** (AgentCoder) + **Test-first generation** (TGen) + **Test tautology** (Section 3)
- **Evidence:** "100% line and branch coverage yet a mutation score of only 4% — tests caught almost no injected faults."
- **Key insight from AgentCoder:** "The test designer agent operates independently of the programmer — this avoids the tautology problem because tests aren't derived from the implementation."
- **Specific technique for AIMEAT:**
  1. Generate tests from the CSM spec + extension API declaration, NOT from the generated code
  2. Use real API responses (from probe) as "golden samples" — tests verify against reality, not against what code does
  3. Test page must use real AIMEAT libraries, not hand-built shims — so tests verify the actual integration path

**Overall architecture improvement: Probe-driven pipeline**
- **Research backing:** Every successful multi-file tool (Devin, Bolt, Lovable) executes between steps. v0 explicitly acknowledges multi-file integration as a weakness because it doesn't.
- **LLMLOOP finding:** "The first feedback loop alone boosts performance by up to 24%." — Even one execution check between steps is high-value.
- **Recommended pipeline:**
  ```
  1. Generate extension
  2. Register + activate
  3. PROBE: call each action with test params, capture real JSON responses
  4. Generate cortex — prompt includes real JSON from step 3
  5. Register + activate cortex
  6. PROBE: call cortex methods from test page, capture real returns
  7. Generate app — prompt includes real returns from step 6
  8. Register app
  9. Integration test: Playwright navigates app, performs user flows
  ```

### Which research patterns we've already implemented (this session)

| Pattern | Status | Source |
|---------|--------|--------|
| Reflection (explain-then-fix) | ✅ Implemented | LeDex (NeurIPS 2024) |
| Episodic memory (fix history) | ✅ Implemented | Reflexion (NeurIPS 2023) |
| Fresh generation on oscillation | ✅ Implemented | IoRT (NAACL 2025), Cursor best practices |
| Backtracking with real error data | ✅ Partial — trace in fix prompt | ROCODE (ICSE 2025) |

### Which research patterns are NOT yet implemented (needed)

| Pattern | Priority | Source |
|---------|----------|--------|
| Execute between steps (probe) | P0 | Devin, Bolt, Lovable, CodeAct |
| Shared blackboard with real data | P0 | L2MAC (ICLR 2024), Planner-Coder Gap |
| Independent test generation from spec | P1 | AgentCoder, TGen |
| Test page uses real libraries | P1 | (Our own finding) |
| Pre-registration compile check | P2 | ROCODE |
| Mutation testing post-generation | P3 | Meta ACH |

## Phase 5: New System Design

Based on all findings from Phases 1-4, here is the plan organized from quickest wins to deepest changes.

### Layer 1: Fix Factual Errors in Prompts (no architecture change)

These are plain bugs where the prompt tells the AI something that isn't true. Fixing these costs nothing and prevents known crashes.

**1.1 SANDBOX_CONSTRAINTS — establish V8 identity**

Current prompt lists individual missing APIs (`require`, `fetch`, `setTimeout`). AI interprets this as "these specific things are banned" and assumes everything else is available.

Fix: Replace the itemized list with a clear identity statement:

```
This is a BARE V8 JavaScript engine — not Node.js, not a browser.
ONLY ECMAScript built-in objects exist: JSON, Math, Date, RegExp,
String, Array, Object, Map, Set, Promise, encodeURIComponent, parseInt, etc.

NOTHING from Node.js: no require, no Buffer, no process, no fs
NOTHING from Web APIs: no URLSearchParams, no URL, no TextEncoder,
  no Headers, no Request, no Response, no FormData, no Blob,
  no AbortController, no atob/btoa, no crypto, no structuredClone
NOTHING from browsers: no document, no window, no fetch, no setTimeout

The ONLY way to interact with the outside world is through the ctx object.

URL construction example:
  WRONG:  new URLSearchParams({name: query}).toString()
  RIGHT:  'name=' + encodeURIComponent(query)
```

**1.2 Fix wrong method names in SANDBOX_CONSTRAINTS**

| Prompt says | Should say | Line |
|-------------|-----------|------|
| `ctx.wallet (consume/deposit/balance)` | `ctx.wallet (consume/getBalance)` — no deposit | 1497 |
| `ctx.consent (check/request)` | `ctx.consent (check/require)` | 1498 |

**1.3 Fix "method MUST match" in cortex and app templates**

Three locations say "method MUST match extension action's declared method (GET or POST)":
- `generator-prompts-base.js:1192` — cortex callExt template
- `generator-prompts-base.js:642` — app extCall template
- Comment above callExt in cortex template

All must say: "ALL extension actions are POST. Always use method: 'POST'."

Also remove the GET branch from `callExt()` / `extCall()` templates — it creates dead code that confuses AI:
```javascript
// Remove this entirely:
const url = method === 'GET' && body && Object.keys(body).length > 0
  ? basePath + '?' + new URLSearchParams(body).toString()
  : basePath;

// Replace with:
const url = '/v1/ext/' + extName + '/' + actionId;
const opts = { method: 'POST', body: JSON.stringify(body || {}) };
```

**1.4 Add EXTENSION_CONSUMPTION_RULES to cortex generation prompt**

Currently included in: fix prompt (cortex), edit prompt (cortex), test prompt (all)
Missing from: `buildComponentPrompt()` for cortex type in `generator-prompts-build.js`

Add it to the cortex template or inject it in `buildComponentPrompt()` when type is cortex.

### Layer 2: Fix Test Infrastructure (use real libraries)

The test page (`/v1/generator/test-page/:projectId/:componentId`) currently injects hand-built `AIMEAT.auth` and `AIMEAT.data` objects with `<script>` inline code. These behave differently from the real libraries in subtle ways:
- `AIMEAT.data.put()` vs real `AIMEAT.data.set()`
- Missing `delete()`, `list()`, `search()`, etc.
- `getPublic()` adds unnecessary auth header (real version doesn't)

**Fix:** Load the real libraries via `<script src="/v1/libs/aimeat-auth.js">` and `<script src="/v1/libs/aimeat-data.js">` — same as production apps do. Then auto-login with the test user's credentials.

The test page should:
1. Load real `aimeat-auth.js`
2. Load real `aimeat-data.js`
3. Auto-login using the JWT token (inject via `<script>` that sets the token in the auth library's storage)
4. Load cortex libraries via `<script src="/v1/cortex/{name}/libs/{name}.js">`
5. Run the test code

This way tests exercise the exact same code path as production. If it works in test, it works in production.

### Layer 3: Probe-Driven Pipeline (execute between steps)

This is the biggest change and the one backed by the most research evidence. Every successful multi-file generation tool (Devin, Bolt, Lovable) does this. LLMLOOP found that even one execution check between steps improves results by 24%.

**Current pipeline:**
```
Generate Extension → describe it → Generate Cortex → describe it → Generate App
```

Each step gets a DESCRIPTION of the previous step's output. AI guesses data shapes.

**New pipeline:**
```
Generate Extension → register → PROBE → Generate Cortex with REAL data → register → PROBE → Generate App with REAL data
```

Each step gets ACTUAL DATA from the previous step.

**Probe implementation for extensions:**

After extension registers and activates successfully:
1. Call each action with the test parameters from `interview-spec.json` / `blueprint.testScenarios`
2. Capture the real JSON responses
3. Store them in the project metadata as `probeResults`
4. Inject them into the cortex prompt:

```
## ACTUAL EXTENSION API RESPONSES (captured from live execution)

POST /v1/ext/prh-tiedonhaku/searchCompanies {"query":"Overscale Solutions"}
→ {"totalResults":1,"companies":[{"businessId":{"value":"3323553-5","registrationDate":"2022-11-07","source":"3"},...}]}

POST /v1/ext/prh-tiedonhaku/getCompany {"businessId":"3323553-5"}
→ {"company":{"businessId":{"value":"3323553-5",...},"mainName":"Overscale Solutions Oy",...}}

Your cortex library MUST handle these EXACT data shapes.
Note: businessId is an OBJECT {value, registrationDate, source}, not a string.
```

**Probe implementation for cortex:**

After cortex registers and activates:
1. Open test page with cortex loaded
2. Call each exported method with test parameters
3. Capture real return values
4. Inject into app prompt:

```
## ACTUAL CORTEX API RETURNS (captured from live execution)

AIMEAT.prhYritystietopalvelu.searchCompanies({query:'Overscale Solutions'})
→ {totalResults: 1, companies: [{businessId: '3323553-5', name: 'Overscale Solutions Oy', ...}]}

Your app MUST render data in these exact shapes.
```

**Why this solves the key failures:**
- AI sees `businessId: {value: "3323553-5"}` in real data → generates `company.businessId.value` (not `.businessId`)
- AI sees actual extension name `prh-tiedonhaku` in probe URL → uses correct name
- AI sees actual response envelope shape → doesn't invent field names

### Layer 4: Improve Test Generation (spec-first, not code-first)

Currently tests are generated from the same context as the code. This creates tautological tests — they validate what the code does, not what it should do.

**Change:** Tests should be generated from the CSM spec + probe results, not from the generated code.

Test prompt should include:
1. The CSM schema (what fields SHOULD exist)
2. The probe results (what the extension ACTUALLY returns)
3. The blueprint use cases (what the user EXPECTS to be able to do)

Test should NOT include:
1. The generated extension/cortex/app code — that's what we're testing
2. The extension's internal implementation details

**For extension tests:** Use probe results as golden samples:
```
The extension was probed with these inputs and produced these outputs:
searchCompanies({query:"Overscale Solutions"}) → {actual JSON}

Your test MUST verify that calling the same action with the same input
produces a result that matches this shape. The exact values may differ
(timestamps, etc.) but the structure must match.
```

**For app tests:** Use cases from interview spec:
```
The user must be able to:
1. Search for "Overscale Solutions" → see results with company name and Y-tunnus
2. Click a company → see detail view with all fields
3. Add to watchlist → see it in watchlist tab
4. Remove from watchlist → see it disappear

Playwright test: navigate to app, perform each action, verify DOM shows expected data.
```

### Layer 5: Pre-registration Validation (catch errors before they hurt)

Before registering a generated extension, attempt to parse each action script in V8 isolate (without executing it). This catches:
- Syntax errors
- References to undefined Web APIs (URLSearchParams, URL, etc.)
- Missing `export default`

This is cheap (V8 parse is fast) and prevents the "register broken code → tests fail → fix rounds" cycle.

Similarly, for cortex: parse the JS IIFE before registering to verify syntax.

For apps: parse the HTML, verify the manifest comment, check that `<script>` tags reference real paths.

### Implementation Order

| Step | What | Why first |
|------|------|-----------|
| 1 | Fix SANDBOX_CONSTRAINTS identity + wrong method names | Costs 5 minutes, prevents the #1 current crash |
| 2 | Fix "ALL actions POST" in cortex/app templates | Costs 5 minutes, prevents 404s |
| 3 | Add EXTENSION_CONSUMPTION_RULES to cortex gen prompt | Costs 1 line, prevents method confusion |
| 4 | Test page loads real libraries instead of hand-built shims | Medium effort, makes tests trustworthy |
| 5 | Extension probe after registration | Medium effort, gives cortex real data |
| 6 | Cortex probe after registration | Medium effort, gives app real data |
| 7 | Spec-first test generation | Larger effort, eliminates test tautology |
| 8 | Pre-registration V8 parse check | Small effort, catches syntax errors early |

Steps 1-3 can be done immediately and will fix the current blockers.
Steps 4-6 form the probe-driven pipeline — the biggest quality improvement.
Steps 7-8 are longer-term improvements.

## Fix Priority

| # | Finding | Impact | Effort | Priority |
|---|---------|--------|--------|----------|
| 1 | Auth mock wrong format | CRITICAL — tests pass, prod fails | Medium | P0 |
| 2 | Data mock wrong methods | CRITICAL — tests pass, prod fails | Low | P0 |
| 3 | GET vs POST for ext actions | HIGH — cortex calls 404 | Low | P0 |
| 4 | stripCodeblock all types | CRITICAL — FIXED | Done | Done |
| 5 | wallet.deposit doesn't exist | MODERATE — broken if used | Low | P1 |
| 6 | consent.request→require | MODERATE — broken if used | Low | P1 |
| 7 | wallet.balance→getBalance | MODERATE — broken if used | Low | P1 |
| 8 | entry field dead | LOW | Low | P2 |
| 9 | Dual CSP | MODERATE | Medium | P1 |
| 10 | Manifest validation weak | LOW | Low | P2 |
| 11 | API call limit undocumented | LOW | Low | P2 |
| 12 | fetch timeout undocumented | LOW | Low | P2 |
| 13 | Instance namespace undocumented | LOW | Low | P2 |

## Recommended Action Plan

### Immediate (P0 — these explain the current failures)
1. Fix auth mock in `generator-testing.ts` to return `{ ok, data, error }` envelope — same as real `aimeat-auth.js`
2. Fix data mock: rename `put()` to `set()`, add `delete()`
3. Add `EXTENSION_CONSUMPTION_RULES` to cortex generation prompt (not just test prompt)
4. Fix cortex template to always use POST for extension calls

### Next (P1 — prevent future failures)
5. Fix SANDBOX_CONSTRAINTS: `deposit→(remove)`, `request→require`, `balance→getBalance`
6. Resolve CSP conflict: either remove meta CSP from prompt or make it match server CSP

### Later (P2 — cleanup)
7. Remove `entry` from app prompt manifest template
8. Strengthen manifest validation
9. Document API call limit, fetch timeout, instance namespaces

## Source Reports
- [Extension audit](2026-03-25-extension-audit.md) — 409 lines
- [Cortex audit](2026-03-25-cortex-audit.md) — pending final save
- [App audit](2026-03-25-app-audit.md) — 438 lines
- [Research raw](2026-03-25-generator-research-raw.md) — web research findings
