# Foundry Pipeline Test — Execution Template

> **Purpose:** Validate that Foundry multi-pass prompts produce correct, registerable output when processed by a fresh AI session with no prior context.
>
> **Methodology:** Each pass extracts the prompt from the browser UI and sends it to a fresh Opus 4.6 subagent. The subagent's raw response is pasted back without modification. Validation failures indicate prompt deficiencies, not implementation bugs.
>
> **Copy this template** before each run and fill in the results.

---

## Run Metadata

| Field | Value |
|-------|-------|
| **Date** | |
| **Project description** | |
| **Interview JSON source** | |
| **Prompt files version** | (git commit hash) |
| **Previous run issues** | |

---

## Pre-Flight Checklist

### Step 0.1: Stop any running dev server
- [ ] Kill existing pnpm dev process if running
- **Why:** BUILD_ID must refresh to pick up changed prompt JS files

### Step 0.2: Start fresh dev server
- [ ] Run `pnpm dev` from project root
- [ ] Verify server running on port 40050

### Step 0.3: Open browser and login
- [ ] Navigate to `http://localhost:40050/v1/profile`
- [ ] Verify logged in as testuser
- **Result:** ___

### Step 0.4: Clean up old project (if exists)
- [ ] Open Foundry → delete previous test project if present
- **Result:** ___

### Step 0.5: Record git state
- [ ] `git log --oneline -1`
- **Commit:** ___

---

## Phase 1: Create Project + Single-Shot Components

### Step 1.1: Create new Foundry project
- [ ] Click "+ New Project", paste project description
- **Project ID:** ___

### Step 1.2: Import interview spec
- [ ] Paste interview JSON
- **Result:** ___

### Step 1.3: Import blueprint
- [ ] Blueprint generated/imported, component list visible
- **Total components:** ___
- **Component list:** (fill in what the blueprint produces)

| # | Label | Type | Multi-pass? |
|---|-------|------|-------------|
| 1 | | | |
| 2 | | | |
| ... | | | |

### Steps 1.4–1.N: Register single-shot components

For each single-shot component (CSM, Memory, Translations):

| # | Component label | Type | Subagent dispatched | Validation | Registered | Notes |
|---|----------------|------|-------------------|------------|------------|-------|
| | | | [ ] | PASS/FAIL | YES/NO | |
| | | | [ ] | PASS/FAIL | YES/NO | |
| | | | [ ] | PASS/FAIL | YES/NO | |
| | | | [ ] | PASS/FAIL | YES/NO | |

### Phase 1 Summary
| Metric | Value |
|--------|-------|
| Components registered | / |
| Dashboard shows | |
| Validation failures | |
| Time taken | |

---

## Phase 2: Extension Multi-Pass Pipeline

**Component label:** (fill from blueprint)
**Component type:** EXTENSION

### Step 2.1: Test Pass
- [ ] Snapshot → extract prompt → dispatch **fresh Opus 4.6 subagent** → paste raw response → validate
- [ ] Result: PASS / FAIL
- **Validation errors:** ___

### Step 2.2: Skeleton Pass
- [ ] Same method
- [ ] Result: PASS / FAIL
- [ ] Record units created from skeleton:

| # | Unit ID | Unit label |
|---|---------|-----------|
| 1 | | |
| 2 | | |
| ... | | |

**Total units:** ___

### Step 2.3–2.N: Unit Passes

For EACH unit created by the skeleton:

| Unit # | Unit ID | Subagent dispatched | Validation | Notes |
|--------|---------|-------------------|------------|-------|
| 1 | | [ ] | PASS/FAIL | |
| 2 | | [ ] | PASS/FAIL | |
| ... | | [ ] | PASS/FAIL | |

**Key quality checks (sample from subagent responses):**
- [ ] Used correct function signature per component type
- [ ] No forbidden APIs (global fetch, require, URLSearchParams)
- [ ] Null-checks on data access

### Step 2.A: Assembly Pass
- [ ] Dispatch fresh subagent → paste → validate
- [ ] Result: PASS / FAIL
- **Critical checks:**
  - [ ] Output has required metadata fields for this component type
  - [ ] All units present in assembled output
  - [ ] Correct registration patterns
- **Validation errors:** ___

### Step 2.R: Registration
- [ ] Register button → click → dashboard updated
- **Dashboard shows:** ___

### Phase 2 Summary
| Metric | Value |
|--------|-------|
| Total passes | / |
| First-try validations | / |
| Failures | |
| Time taken | |
| Prompt deficiencies found | |

---

## Phase 3: Data Cortex Multi-Pass Pipeline

**Component label:** (fill from blueprint)
**Component type:** CORTEX (data)

### Step 3.1: Test Pass
- [ ] Fresh subagent → paste → validate
- [ ] Result: PASS / FAIL

### Step 3.2: Skeleton Pass
- [ ] Fresh subagent → paste → validate
- [ ] Result: PASS / FAIL
- [ ] Record methods created:

| # | Method name |
|---|------------|
| 1 | |
| ... | |

**Total methods:** ___

### Step 3.3–3.N: Method Unit Passes

| Unit # | Method name | Subagent dispatched | Validation | Notes |
|--------|------------|-------------------|------------|-------|
| 1 | | [ ] | PASS/FAIL | |
| 2 | | [ ] | PASS/FAIL | |
| ... | | [ ] | PASS/FAIL | |

**Key quality checks:**
- [ ] Uses `callExt` helper (not raw fetch or session.fetch directly)
- [ ] Thin wrappers — no business logic duplication

### Step 3.A: Assembly Pass
- [ ] Fresh subagent → paste → validate
- [ ] Result: PASS / FAIL
- **Critical checks:**
  - [ ] `callExt` uses `session.fetch()` not raw `fetch()`
  - [ ] `callExt` has `console.warn` on failures
  - [ ] `const exports = {...}` present
  - [ ] `namespace: community` in YAML
  - [ ] IIFE pattern correct
- **Validation errors:** ___

### Step 3.R: Registration
- **Dashboard shows:** ___

### Phase 3 Summary
| Metric | Value |
|--------|-------|
| Total passes | / |
| First-try validations | / |
| Failures | |
| Time taken | |

---

## Phase 4: Feature Cortexes

Repeat this block for EACH feature cortex component from the blueprint.

### Phase 4.[X]: Feature Cortex "[label]"

**Component type:** CORTEX (feature)

| Step | Pass type | Subagent dispatched | Validation | Notes |
|------|-----------|-------------------|------------|-------|
| Test | Test | [ ] | PASS/FAIL | |
| Skeleton | Skeleton | [ ] | PASS/FAIL | Sections: ___ |
| Section 1 | Unit | [ ] | PASS/FAIL | |
| Section 2 | Unit | [ ] | PASS/FAIL | |
| ... | Unit | [ ] | PASS/FAIL | |
| Assembly | Assembly | [ ] | PASS/FAIL | |
| Register | — | [ ] | — | Dashboard: ___ |

**Key quality checks:**
- [ ] Assembly has `t()` reading `AIMEAT._translations`
- [ ] Assembly has `dv()` helper
- [ ] Sections handle null data gracefully
- [ ] `namespace: community` in YAML

---

### Phase 4 Summary (all feature cortexes combined)
| Metric | Value |
|--------|-------|
| Feature cortexes registered | / |
| Total passes across all | |
| First-try validations | |
| Failures | |
| Time taken | |

---

## Phase 5: App-Domain Cortex

**Component label:** (fill from blueprint)
**Component type:** CORTEX (app-domain)

| Step | Pass type | Subagent dispatched | Validation | Notes |
|------|-----------|-------------------|------------|-------|
| 5.1 | Test | [ ] | PASS/FAIL | |
| 5.2 | Skeleton | [ ] | PASS/FAIL | |
| 5.3 | Assembly | [ ] | PASS/FAIL | |
| 5.4 | Register | — | [ ] | Dashboard: ___ |

**Key checks:**
- [ ] `init()` calls `AIMEAT.auth.login()` first
- [ ] Loads translations with service-prefix fallback
- [ ] Stores in `AIMEAT._translations`
- [ ] `render()` creates navigation + mounts feature cortexes
- [ ] `mountLoginButton` for unauthenticated users
- [ ] `callExt` uses `session.fetch()` with `console.warn`

### Phase 5 Summary
| Metric | Value |
|--------|-------|
| Passes | / |
| First-try validations | / |
| Issues | |

---

## Phase 6: App

**Component label:** (fill from blueprint)
**Component type:** APP

| Step | Pass type | Subagent dispatched | Validation | Notes |
|------|-----------|-------------------|------------|-------|
| 6.1 | Test | [ ] | PASS/FAIL | |
| 6.2 | Skeleton | [ ] | PASS/FAIL | Views: ___ |
| 6.3+ | View units | [ ] each | PASS/FAIL | |
| 6.A | Assembly | [ ] | PASS/FAIL | |
| 6.R | Register | — | [ ] | Dashboard: ___ |

**Key checks for Assembly output:**
- [ ] Starts with `<!-- AIMEAT App Manifest ... -->` comment
- [ ] Loads `aimeat-auth.js` and `aimeat-data.js` via `loadScript()`
- [ ] Loads platform UI libraries
- [ ] Loads cortex scripts in dependency order
- [ ] `AIMEAT.auth.mountLoginButton('#auth-container', {...})`
- [ ] `AIMEAT.auth.login()` before `startApp()`
- [ ] `startApp()` calls `cortex.init()` then `cortex.render()`
- [ ] Error collector script present
- [ ] CSP meta tag present

### Phase 6 Summary
| Metric | Value |
|--------|-------|
| Passes | / |
| First-try validations | / |
| Dashboard shows | "N registered / N active" + "Launch App" |
| Issues | |

---

## Phase 7: Verification

### Step 7.1: Launch the app
- [ ] Click "Launch App" on Foundry dashboard
- [ ] Snapshot the app page
- [ ] Check console for errors
- **Console errors:** ___

### Step 7.2: Auth check
- [ ] App shows logged-in state (not login button only)
- [ ] No 401 errors in console
- **Auth status:** ___

### Step 7.3: Translation check
- [ ] UI shows translated text (not raw keys like "search.placeholder")
- [ ] Title/heading shows localized text
- **Translation status:** ___

### Step 7.4: Core functionality
- [ ] Primary use case works (e.g., search returns results)
- [ ] Results display correctly (no [object Object])
- [ ] Detail view renders with real data
- **Functionality status:** ___

### Step 7.5: Navigation
- [ ] All tabs/views are accessible
- [ ] No crashes on tab switch
- **Navigation status:** ___

### Step 7.6: Empty state handling
- [ ] Views with no data show friendly messages (not crashes)
- [ ] No `.forEach is not a function` or similar type errors
- **Empty states:** ___

### Phase 7 Summary
| Check | Status |
|-------|--------|
| App loads without crash | |
| Auth works (no 401s) | |
| Translations visible | |
| Primary use case works | |
| Navigation works | |
| Empty states handled | |
| No [object Object] in UI | |
| No console errors | |

---

## Final Report

### Overall Results

| Metric | Value |
|--------|-------|
| Total components registered | / |
| Total passes executed | |
| First-try validation rate | % |
| Validation failures | |
| Manual fixes needed (should be 0) | |
| App functional | YES / NO |
| Total time | |

### Prompt Deficiencies Found

Any validation failure where the subagent's raw output was rejected = prompt deficiency.

| # | Phase | Pass type | Prompt function | Issue | Severity |
|---|-------|-----------|----------------|-------|----------|
| 1 | | | | | |
| 2 | | | | | |

### Comparison to Previous Run

| Aspect | Previous run | This run |
|--------|-------------|----------|
| Extension assembly validation | | |
| App assembly validation | | |
| Auth in launched app | | |
| Translations in launched app | | |
| Empty state crashes | | |
| Console errors in launched app | | |
| First-try validation rate | | |

### Recommendations for Next Iteration

1.
2.
3.

---

## Appendix: Subagent Dispatch Template

For each pass, the subagent is dispatched with this exact format:

```
Agent tool call:
  description: "Foundry pass: [component-type] [pass-type]"
  model: "opus"
  prompt: |
    You are an AI assistant helping a user build an AIMEAT service.
    The user has given you a prompt with detailed instructions.
    Follow the instructions EXACTLY and produce the requested output.
    Do NOT add explanations, commentary, or markdown outside of what
    the instructions ask for. Return ONLY the requested output.

    Here is the prompt:
    ---
    [EXTRACTED PROMPT TEXT FROM BROWSER SNAPSHOT]
    ---
```

The subagent's response is used VERBATIM — no editing, no fixing, no "improving".
If the response fails validation, that failure is recorded as a prompt deficiency.

## Appendix: Full Run Log

During execution, every step is appended to a separate log file:

**Log file:** `docs/testing/foundry-pipeline-log-YYYY-MM-DD.md`

For EVERY pass, the log records this exact structure:

```markdown
---
## [timestamp] Phase X.Y — [Component Label] — [Pass Type]

### Prompt (extracted from Foundry UI)
\```
[FULL prompt text as shown in the browser — every line, no truncation]
\```

### Subagent Response (verbatim, unmodified)
\```
[FULL response from the fresh Opus 4.6 subagent — every line]
\```

### Validation Result
- **Status:** PASS / FAIL
- **Errors (if any):**
  - [error message 1]
  - [error message 2]

### Registration Result (if applicable)
- **Status:** SUCCESS / FAILED / N/A
- **Dashboard after:** "X registered / Y active"
- **Component registered as:** [name]

### Quality Assessment
- **Function signature correct:** YES / NO / N/A
- **Auth pattern correct:** YES / NO / N/A
- **Null-checks present:** YES / NO / N/A
- **Meaningful test coverage (for test passes):** YES / NO — [explain what it tests vs what it should test]
- **Notes:** [any observations about the generated code quality]
---
```

This log is the primary artifact for post-run analysis. It allows reviewing:
1. Whether each prompt contained sufficient instructions
2. Whether the subagent followed those instructions
3. Whether validation caught real issues or false positives
4. Whether tests actually verify meaningful behavior
5. The exact code that was generated and registered

## Appendix: Known Prompt Functions Under Test

| Component type | Pass | Prompt function |
|---------------|------|-----------------|
| Extension | Skeleton | `buildExtensionSkeletonPrompt` |
| Extension | Unit | `buildExtensionUnitPrompt` |
| Extension | Assembly | `buildExtensionAssemblyPrompt` |
| Cortex (data) | Skeleton | `buildDataCortexSkeletonPrompt` |
| Cortex (data) | Unit | `buildCortexMethodUnitPrompt` |
| Cortex (data) | Assembly | `buildCortexAssemblyPrompt` |
| Cortex (feature) | Skeleton | `buildFeatureCortexSkeletonPrompt` |
| Cortex (feature) | Unit | `buildFeatureCortexSectionPrompt` |
| Cortex (feature) | Assembly | `buildCortexAssemblyPrompt` |
| Cortex (app-domain) | Skeleton | `buildAppDomainCortexSkeletonPrompt` |
| Cortex (app-domain) | Assembly | `buildCortexAssemblyPrompt` |
| App | Skeleton | `buildAppSkeletonPrompt` |
| App | Unit | `buildAppViewUnitPrompt` |
| App | Assembly | `buildAppAssemblyPrompt` |
| All types | Test | `buildTestFirstPrompt` |
| All types | Single-shot | `buildComponentPrompt` → `COMPONENT_TEMPLATES.*` |
