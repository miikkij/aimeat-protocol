# Foundry Pipeline Test — Execution Template

> **Purpose:** Validate that Foundry multi-pass prompts produce correct, registerable output when processed by AI via OpenRouter.
>
> **Methodology:** The Foundry autopilot drives the entire pipeline automatically via OpenRouter API. Two models are configured: a reasoning model for planning/architecture passes and an execution model for code generation passes. All prompts, responses, and results are logged to disk and viewable in the Admin Dashboard → Generator Debug tab.
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
| **Reasoning model** | (e.g. qwen/qwen3.5-397b-a17b) |
| **Execution model** | (e.g. qwen/qwen3-coder-plus) |
| **Previous run issues** | |

---

## Pre-Flight Checklist

### Step 0.1: Start dev server
- [ ] Run `pnpm dev` from project root (uses MongoDB — data persists)
- [ ] Verify server running on port 40050

### Step 0.2: Configure OpenRouter
- [ ] Open Foundry → OpenRouter Settings
- [ ] API key configured (green dot visible)
- [ ] Reasoning model selected
- [ ] Execution model selected
- [ ] Auto-retry enabled, max retries set
- [ ] Click "Test connection" — success

### Step 0.3: Open browser and login
- [ ] Navigate to `http://localhost:40050/v1/profile`
- [ ] Verify logged in as testuser

### Step 0.4: Clean up old project (if exists)
- [ ] Open Foundry → delete previous test project if present

### Step 0.5: Record git state
- [ ] `git log --oneline -1`
- **Commit:** ___

---

## Phase 1: Create Project + Import Spec + Blueprint

### Step 1.1: Create new Foundry project
- [ ] Click "+ New Project", paste project description
- **Project ID:** ___

### Step 1.2: Import interview spec
- [ ] Paste interview JSON
- **Result:** ___

### Step 1.3: Import blueprint
- [ ] Paste blueprint JSON (from verified AI Chat run or generate via OpenRouter)
- **Total components:** ___
- **Component list:**

| # | Label | Type | Subtype | Model role |
|---|-------|------|---------|------------|
| 1 | | | | reasoning/execution |
| 2 | | | | |
| ... | | | | |

---

## Phase 2: Run Autopilot

### Step 2.1: Start single-shot components
- [ ] Click each single-shot component (CSM, Memory, Translations)
- [ ] Click "Run with AI" for each — uses execution model
- [ ] Validate and register each

| # | Component | Type | AI result | Validation | Registered |
|---|-----------|------|-----------|------------|------------|
| 1 | | CSM | | PASS/FAIL | YES/NO |
| 2 | | Memory | | PASS/FAIL | YES/NO |
| 3 | | Translation (fi) | | PASS/FAIL | YES/NO |
| 4 | | Translation (en) | | PASS/FAIL | YES/NO |

### Step 2.2: Run multi-pass components via autopilot
- [ ] Click the Extension component → autopilot runs all passes automatically
- [ ] Monitor progress in the Foundry UI
- [ ] Repeat for each multi-pass component in order:
  1. Extension
  2. Data Cortex
  3. Feature Cortexes (all)
  4. App-Domain Cortex
  5. App

**Model routing per pass type:**

| Pass type | Model role | Model used |
|-----------|-----------|------------|
| Test | reasoning | |
| Skeleton | reasoning | |
| Reflection | reasoning | |
| Unit (code) | execution | |
| Assembly | execution | |
| Fix/retry | execution | |

### Step 2.3: Monitor progress

For each component, record:

| Component | Passes | First-try | Retries | Registered | Notes |
|-----------|--------|-----------|---------|------------|-------|
| Extension | /  | / | | YES/NO | |
| Data Cortex | / | / | | YES/NO | |
| Feature: Search | / | / | | YES/NO | |
| Feature: Detail | / | / | | YES/NO | |
| Feature: Watchlist | / | / | | YES/NO | |
| Feature: Changes | / | / | | YES/NO | |
| Feature: Comparison | / | / | | YES/NO | |
| Feature: Settings | / | / | | YES/NO | |
| App-Domain Cortex | / | / | | YES/NO | |
| App | / | / | | YES/NO | |

---

## Phase 3: Verification

### Step 3.1: Launch the app
- [ ] Click "Launch App" on Foundry dashboard
- [ ] Check console for errors
- **Console errors:** ___

### Step 3.2: Auth check
- [ ] App shows logged-in state (not login button only)
- [ ] No 401 errors in console
- **Auth status:** ___

### Step 3.3: Translation check
- [ ] UI shows translated text (not raw keys)
- **Translation status:** ___

### Step 3.4: Core functionality
- [ ] Search returns results (test with "Overscale Solutions")
- [ ] Results display correctly (no [object Object])
- [ ] Company detail card renders with real data
- [ ] Add to watchlist works
- **Functionality status:** ___

### Step 3.5: Navigation
- [ ] All tabs/views are accessible
- [ ] No crashes on tab switch
- **Navigation status:** ___

### Step 3.6: Empty state handling
- [ ] Views with no data show friendly messages (not crashes)
- **Empty states:** ___

### Phase 3 Summary
| Check | Status |
|-------|--------|
| App loads without crash | |
| Auth works (no 401s) | |
| Translations visible | |
| Search returns real data | |
| Company detail card works | |
| Watchlist add/remove works | |
| Navigation works | |
| Empty states handled | |
| No [object Object] in UI | |
| No console errors | |

---

## Phase 4: Review Debug Logs

### Step 4.1: Open Admin Dashboard
- [ ] Navigate to Admin Dashboard → Generator Debug tab
- [ ] Find the Foundry project (🏭 icon)
- [ ] Click "Copy All" to get the complete log

### Step 4.2: Review key artifacts
For each component, check:
- [ ] Prompt was sent correctly (correct model role)
- [ ] Response follows prompt format
- [ ] Validation result matches expectations

### Step 4.3: Save debug log
- [ ] Copy full debug output to `docs/testing/run{N}/debug-log.txt`

---

## Final Report

### Overall Results

| Metric | Value |
|--------|-------|
| Total components registered | / |
| Total passes executed | |
| First-try validation rate | % |
| Retries needed | |
| Manual fixes needed (should be 0) | |
| App functional | YES / NO |
| Total time | |
| Reasoning model cost | $ |
| Execution model cost | $ |

### Model Performance

| Model | Role | Passes | Success rate | Avg response time | Notes |
|-------|------|--------|-------------|-------------------|-------|
| | Reasoning | | % | | |
| | Execution | | % | | |

### Prompt Deficiencies Found

Any validation failure = prompt deficiency.

| # | Phase | Pass type | Model | Prompt function | Issue | Severity |
|---|-------|-----------|-------|----------------|-------|----------|
| 1 | | | | | | |
| 2 | | | | | | |

### Comparison to Previous Run

| Aspect | Previous run | This run |
|--------|-------------|----------|
| Extension assembly | | |
| App assembly | | |
| Auth in launched app | | |
| Translations | | |
| Empty state crashes | | |
| Console errors | | |
| First-try rate | | |
| Total cost | | |

### Recommendations

1.
2.
3.

---

## Appendix: Model Routing

| Pass type | Model role | Rationale |
|-----------|-----------|-----------|
| Interview generation | reasoning | Requires understanding requirements, asking right questions |
| Blueprint generation | reasoning | Architecture decisions, component planning |
| Blueprint fix | reasoning | Analyzing structural errors |
| Test-first | reasoning | Designing test contracts from specifications |
| Skeleton | reasoning | Defining structure, interfaces, data flow |
| Reflection/diagnosis | reasoning | Analyzing failures, proposing fixes |
| Test regeneration | reasoning | Redesigning tests based on failures |
| Unit (code) | execution | Implementing one function/section per spec |
| Assembly | execution | Mechanical combination of units into IIFE |
| Single-shot components | execution | Generating CSM/Memory/Translation content |
| Fix/retry on validation | execution | Fixing code based on error messages |

## Appendix: Debug Artifacts

All prompts and responses are saved to disk automatically by `writeDebugArtifact()`. View them in:
- **Admin Dashboard** → Generator Debug tab → select Foundry project (🏭)
- **On disk** at `aimeat/debug/foundry-{projectId}/`

Each component gets:
- `pass-{id}-prompt` — the full prompt sent to AI
- `pass-{id}-raw` — raw AI response
- `pass-{id}-stripped` — response with code fences removed
- `pass-{id}-reflection-{N}-prompt` — reflection prompt (on failure)
- `pass-{id}-reflection-{N}-response` — reflection diagnosis
- `pass-{id}-retry-{N}-prompt` — retry prompt
- `pass-{id}-retry-{N}-stripped` — retry response

Project log entries include `modelRole` field showing which model was used for each AI call.

## Appendix: Known Prompt Functions Under Test

| Component type | Pass | Prompt function | Model role |
|---------------|------|-----------------|------------|
| Extension | Test | `buildTestFirstPrompt` | reasoning |
| Extension | Skeleton | `buildExtensionSkeletonPrompt` | reasoning |
| Extension | Unit | `buildExtensionUnitPrompt` | execution |
| Extension | Assembly | `buildExtensionAssemblyPrompt` | execution |
| Cortex (data) | Test | `buildTestFirstPrompt` | reasoning |
| Cortex (data) | Skeleton | `buildDataCortexSkeletonPrompt` | reasoning |
| Cortex (data) | Unit | `buildCortexMethodUnitPrompt` | execution |
| Cortex (data) | Assembly | `buildCortexAssemblyPrompt` | execution |
| Cortex (feature) | Test | `buildTestFirstPrompt` | reasoning |
| Cortex (feature) | Skeleton | `buildFeatureCortexSkeletonPrompt` | reasoning |
| Cortex (feature) | Unit | `buildFeatureCortexSectionPrompt` | execution |
| Cortex (feature) | Assembly | `buildCortexAssemblyPrompt` | execution |
| Cortex (app-domain) | Test | `buildTestFirstPrompt` | reasoning |
| Cortex (app-domain) | Skeleton | `buildAppDomainCortexSkeletonPrompt` | reasoning |
| Cortex (app-domain) | Assembly | `buildCortexAssemblyPrompt` | execution |
| App | Test | `buildTestFirstPrompt` | reasoning |
| App | Skeleton | `buildAppSkeletonPrompt` | reasoning |
| App | Unit | `buildAppViewUnitPrompt` | execution |
| App | Assembly | `buildAppAssemblyPrompt` | execution |
| All types | Single-shot | `buildComponentPrompt` | execution |
