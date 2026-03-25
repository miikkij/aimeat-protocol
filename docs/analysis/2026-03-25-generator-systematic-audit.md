# Generator Systematic Audit — 2026-03-25

## Purpose

The generator automation produces broken results even though the same prompts work perfectly when manually copied to AI chat. This audit systematically maps the entire system (extensions, cortex, apps), verifies that prompts match reality, identifies every discrepancy, and produces a plan to fix the automation.

## Method

For each component type (extension, cortex, app):
1. Read the actual implementation code — what the system DOES
2. Read the prompt templates — what we TELL the AI
3. Compare the two and list every discrepancy
4. Cross-reference with actual test failures from debug_generator.txt
5. Determine if each discrepancy could cause the observed failures

All findings are recorded in dedicated audit reports with exact file paths and line numbers:
- `docs/analysis/2026-03-25-extension-audit.md` — Extension system audit
- `docs/analysis/2026-03-25-cortex-audit.md` — Cortex system audit
- `docs/analysis/2026-03-25-app-audit.md` — App system audit
- `docs/analysis/2026-03-25-audit-findings-summary.md` — All findings ranked by severity

---

## Phase 1: Build Complete Picture

### Goal
Understand exactly how each component type works end-to-end — from generation prompt through AI response, validation, registration, activation, runtime execution, and testing. Document what the AI is told vs what actually happens.

### 1A. Extension System
**Audit report:** `docs/analysis/2026-03-25-extension-audit.md` (409 lines)
**Status:** ✅ Complete

**What we learned:**
- The extension sandbox (isolated-vm) provides a `ctx` object with memory, fetch, wallet, consent, trust, caller, config, log, notify, email
- The prompt accurately describes most of the ctx API
- **Three wrong API names** in SANDBOX_CONSTRAINTS: `wallet.deposit` (doesn't exist), `consent.request` (should be `require`), `wallet.balance` (should be `getBalance()`)
- **URLSearchParams, URL, and other Web APIs are NOT available** in the sandbox but the prompt doesn't warn about this — only lists `fetch`, `setTimeout`, `require`, `console` as unavailable
- The `ctx.fetch` timeout is hardcoded at 30s — not documented
- API call limit is shared across all ctx methods — not documented
- Memory values are returned as parsed JavaScript objects, never JSON strings — correctly documented

**Key files:**
- `aimeat/src/routes/extensions.ts` — registration, activation, action execution
- `aimeat/src/services/extension-runtime.ts` — V8 sandbox setup, ctx API construction
- `aimeat/public/js/services/generator-prompts-base.js` — SANDBOX_CONSTRAINTS, NAMESPACE_RULES

### 1B. Cortex System
**Audit report:** `docs/analysis/2026-03-25-cortex-audit.md` (pending final Opus save — findings available from Explore agent)
**Status:** ✅ Complete

**What we learned:**
- Cortex libraries are browser-side IIFEs registered on `window.AIMEAT`
- They wrap extension calls via `session.fetch()` and memory reads via `AIMEAT.data.getPublic()`
- `session.fetch()` returns already-parsed AIMEAT envelope `{ ok, data, error }` — NOT a Response object. Correctly documented in prompts.
- **CRITICAL: The cortex prompt template says "method MUST match extension action's declared method"** — but the actual backend only has `router.post()`, no GET routes. `EXTENSION_CONSUMPTION_RULES` correctly says "ALL actions use POST" but this constant is NOT included in the cortex generation prompt, only in test prompts.
- Cortex libraries serve from `/v1/cortex/{name}/libs/{filename.js}` — only when active, cached 24h
- The YAML + JS output must be two separate code blocks — prompt correctly documents this
- `init()` must never call `callExt()` — correctly documented

**Key files:**
- `aimeat/src/routes/cortex.ts` — registration, activation, lib serving
- `aimeat/src/routes/libs.ts` — aimeat-auth.js and aimeat-data.js serving
- `aimeat/src/routes/lib-data.ts` — AIMEAT.data implementation

### 1C. App System
**Audit report:** `docs/analysis/2026-03-25-app-audit.md` (438 lines)
**Status:** ✅ Complete

**What we learned:**
- Apps are single HTML files stored in an apps table, served via `/v1/apps/:owner/:filename`
- Registration parses `<!-- AIMEAT App Manifest ... -->` HTML comment for name, version, description
- **Test page auth mock returns different format than real auth** — mock's `session.fetch()` returns raw `resp.json()`, real returns `{ ok, data, error }` envelope. Tests can pass but production fails.
- **Data mock has wrong method names** — mock has `put()` but real API has `set()`. Missing `delete()` entirely.
- **Dual CSP conflict** — server sets permissive CSP header; prompt tells AI to add restrictive meta CSP. Browser intersects both → most restrictive wins → can block API connections.
- `entry` field in manifest is dead code — never used
- Manifest validation is too weak — any `name:` text passes (e.g., `<meta name="viewport">`)

**Key files:**
- `aimeat/src/routes/apps.ts` — app storage, serving, registration API
- `aimeat/src/services/generator-registration.ts` — manifest parsing for generator
- `aimeat/public/js/services/generator-validate.js` — validation checks

---

## Phase 2: Verify Against Facts

### Goal
For each claim the prompt makes, verify it against the actual code. Every false claim is a potential source of AI generating broken code.

### 2A. Extension Facts Check

| Claim in prompt | Actual behavior | Verdict |
|----------------|-----------------|---------|
| `ctx.memory.get(key)` → value or null | Returns `record.value` directly (parsed JS), null if missing | ✅ Correct |
| `ctx.memory.set(key, value)` → void | Stores to `ext:{name}` namespace, visibility: public | ✅ Correct |
| `ctx.memory.search(prefix)` → `[{key, value}]` | Returns array of objects | ✅ Correct |
| `ctx.memory.delete(key)` → boolean | Deletes from ext namespace | ✅ Correct |
| `ctx.memory.getPublic(ns, key)` → value or null | Reads any namespace, returns value if public | ✅ Correct |
| `ctx.fetch(url, opts)` → `{status, ok, text, headers}` | Returns decoded text with auto-detected charset | ✅ Correct |
| `ctx.wallet.consume(amount, reason)` | Works, debits caller's balance | ✅ Correct |
| `ctx.wallet.deposit` | **DOES NOT EXIST** | ❌ Wrong |
| `ctx.wallet.balance` | **Should be `getBalance()`** | ❌ Wrong name |
| `ctx.consent.request(gaii, scope)` | **Should be `require(gaii, scope)`** | ❌ Wrong name |
| No `require`, `import`, `fetch` global | Correct — V8 isolate has none of these | ✅ Correct |
| No `setTimeout`, `setInterval` | Correct | ✅ Correct |
| No `console.log` — use `ctx.log` | Correct | ✅ Correct |
| **URLSearchParams** | **NOT available — prompt doesn't mention this** | ❌ Missing |
| **URL** constructor | **NOT available — prompt doesn't mention** | ❌ Missing |
| **TextEncoder/TextDecoder** | **NOT available — prompt doesn't mention** | ❌ Missing |
| **Headers, Request, Response** | **NOT available — prompt doesn't mention** | ❌ Missing |
| **AbortController** | **NOT available — prompt doesn't mention** | ❌ Missing |
| Actions cannot call each other | Correct — no ctx method for it, impossible by design | ✅ Correct |
| Memory namespace is `ext:{name}` | Correct for single-instance | ✅ Correct |
| `JSON.parse(ctx.memory.get(...))` will crash | Correct — value is already parsed | ✅ Correct |
| ctx.fetch charset auto-detection | Correct — Content-Type, XML prolog, HTML meta | ✅ Correct |

**Live failure confirmed:** `URLSearchParams is not defined` — 2026-03-25T09:13. AI generated `new URLSearchParams()` because prompt didn't say it's unavailable.

### 2B. Cortex Facts Check

| Claim in prompt | Actual behavior | Verdict |
|----------------|-----------------|---------|
| `session.fetch()` returns parsed envelope `{ok, data, error}` | Confirmed in `libs.ts` line 389-397 | ✅ Correct |
| Do NOT call `resp.json()` on session.fetch result | Correct — it's already parsed | ✅ Correct |
| `AIMEAT.data.getPublic(ns, key)` returns value directly | Uses raw `fetch()` + `.json()`, returns `res.data.value` | ✅ Correct |
| `AIMEAT.data.get(key)` reads own namespace | Uses `authFetch()`, returns `res.data.value` | ✅ Correct |
| Cortex IIFE pattern on `window.AIMEAT` | Correct pattern | ✅ Correct |
| init() must never call callExt() | Correct by design | ✅ Correct |
| **"method MUST match extension action's declared method"** | **WRONG — all actions are POST only** | ❌ Wrong |
| **EXTENSION_CONSUMPTION_RULES in cortex prompt** | **NOT included — only in test prompts** | ❌ Missing |
| Cortex lib filename matches metadata.name | Correct convention | ✅ Correct |
| LIB_NAME is camelCase of metadata.name | Correct convention | ✅ Correct |

### 2C. App Facts Check

| Claim in prompt | Actual behavior | Verdict |
|----------------|-----------------|---------|
| Boot sequence: auth → data → cortex → mountLoginButton → login | Correct order | ✅ Correct |
| `AIMEAT.auth.mountLoginButton(selector, {onLogin, onLogout})` | Confirmed | ✅ Correct |
| `AIMEAT.auth.login()` returns session or null | Confirmed | ✅ Correct |
| App manifest `entry: index.html` | **Dead code — registerApp never reads it** | ⚠️ Harmless |
| CSP meta tag required for CDN scripts | **Conflicts with server-set CSP — intersection blocks** | ❌ Conflict |
| **Test page mock auth format** | **Returns raw JSON, not {ok, data, error} envelope** | ❌ Wrong |
| **Test page AIMEAT.data.put()** | **Real method is set(), not put()** | ❌ Wrong name |
| **Test page AIMEAT.data.delete()** | **Missing entirely from mock** | ❌ Missing |

---

## Phase 3: Analyze Current Failures

### Goal
For each observed failure, trace it to a specific discrepancy from Phase 2.

### 3A. Extension: "URLSearchParams is not defined"
- **Error:** `URLSearchParams is not defined [<isolated-vm>]`
- **Cause:** Phase 2A finding — prompt doesn't list Web APIs as unavailable
- **AI generated:** `const params = new URLSearchParams(); params.set('name', query);`
- **Should have generated:** `const url = baseUrl + '?name=' + encodeURIComponent(query);`
- **Actions affected:** searchCompanies, getCompany, checkWatchlist (all use URL construction)
- **Actions NOT affected:** init, addToWatchlist, removeFromWatchlist (no URL construction)

### 3B. Extension: "Function statements require a function name"
- **Error:** From earlier run (2026-03-25T08:41)
- **Cause:** Likely same class — AI used a Web API or syntax that V8 isolate doesn't support
- **Need to verify:** Check that specific generated code in the earlier debug dump

### 3C. Cortex: "searchCompanies: should return array"
- **Error:** From cortex test round
- **Cause:** Cortex wraps extension which returns `{totalResults, companies}` but test expected plain array
- **Related to:** Test quality — prompt example shows checking for `.items` but extension returns `.companies`

### 3D. App: "Extension not found" (404)
- **Error:** `POST /v1/ext/prh-yritystietopalvelu/searchCompanies 404`
- **Cause:** Extension registered as `prh-tiedonhaku` but app calls `prh-yritystietopalvelu`
- **Root cause chain:** App should call cortex (which knows the right name), but either:
  1. App bypasses cortex and calls extension directly with wrong name, OR
  2. Cortex uses wrong extension name
- **Related to:** Phase 2B finding — cortex template may generate wrong extension name

### 3E. App: "Test did not complete"
- **Error:** App test timeout with no useful information
- **Cause:** Mock auth returns different format → cortex calls fail silently → test never sets window.__testResults
- **Related to:** Phase 2C finding — mock auth format mismatch

---

## Phase 4: Cross-Reference with Research

**Research document:** `docs/analysis/2026-03-25-generator-research-raw.md`

### Applicable findings

| Research finding | Applies to our failure? | How? |
|-----------------|------------------------|------|
| Contract-first generation | YES — extension name drift (3D) | Shared contract would lock extension name for all components |
| Golden sample / probe | YES — businessId shape (3C) | Running extension first and capturing real JSON would show AI the actual data shape |
| Test scaffolding from code | YES — test quality (3C, 3E) | Generating test structure from actual cortex exports, not AI imagination |
| Execute between steps (Devin pattern) | YES — all failures | Running each component and capturing real output before generating the next |
| Bidirectional validation | YES — name mismatch (3D) | Parse app's API calls and verify they match registered endpoints |
| Reflection before fix | Implemented this session | Helps with fix-round quality |
| Fix history accumulation | Implemented this session | Prevents ping-pong |
| Fresh generation on oscillation | Implemented this session | Breaks anchoring |

### Most impactful technique for our specific failures

**URLSearchParams (3A):** Fix the prompt — add Web API restrictions. No research technique needed, just accuracy.

**Name mismatch (3D):** Contract/registry approach — after extension registers, store the actual name and inject it into all subsequent prompts literally.

**Data shape (3C):** Probe approach — after extension registers, call it with test data, capture actual JSON, inject into cortex/test prompts.

**Mock mismatch (3E):** Fix the mock to match reality. Not a generation problem, it's an infrastructure problem.

---

## Phase 5: Design New System

### Based on ALL findings, here is what needs to change:

*To be completed after user reviews Phases 1-4 and confirms direction.*

**Prompt fixes (accuracy):**
- [ ] Add Web API restrictions to SANDBOX_CONSTRAINTS (URLSearchParams, URL, TextEncoder, etc.)
- [ ] Fix wallet.deposit → remove, consent.request → require, wallet.balance → getBalance()
- [ ] Add EXTENSION_CONSUMPTION_RULES to cortex generation prompt
- [ ] Fix cortex template to always use POST for extension calls
- [ ] Remove `entry` from app manifest template
- [ ] Resolve CSP conflict

**Infrastructure fixes (test reliability):**
- [ ] Fix auth mock to return `{ok, data, error}` envelope (match real aimeat-auth.js)
- [ ] Fix data mock: `put()` → `set()`, add `delete()`
- [ ] Strengthen app manifest validation

**Pipeline improvements (from research):**
- [ ] After extension registration: probe actions with test data, capture real JSON responses
- [ ] Inject real JSON into cortex prompt as "actual API responses"
- [ ] After cortex registration: probe methods, capture real returns
- [ ] Inject real returns into app prompt
- [ ] Name registry: store registeredAs in project metadata, inject literally into all prompts
- [ ] Bidirectional validation: after app generation, parse its API calls and verify against registered endpoints
