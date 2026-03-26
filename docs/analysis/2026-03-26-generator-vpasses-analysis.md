# Generator VPasses — Multi-Pass Pipeline Analysis

**Date:** 2026-03-26
**Purpose:** Research and analysis for designing `generator-vpasses`, a new generator pipeline that uses a skeleton-first, incremental-fill approach instead of single-shot component generation.

---

## 1. Problem Statement

The current generator produces each component (extension, cortex, app) in a single prompt that tries to do everything at once. These prompts grow to 25,000–100,000+ characters because they must include:

- AIMEAT platform context (~3,200 chars, repeated in every prompt)
- Sandbox/API rules (~4,500 chars for extensions)
- Blueprint data model with structures and $ref (~variable, often 3,000–8,000 chars)
- Interview spec excerpts (~2,000–5,000 chars)
- Previously completed component summaries (~2,000–10,000 chars per upstream component)
- Output format specification (~1,500–3,000 chars)
- Code examples and anti-pattern warnings (~3,000–5,000 chars)
- Component-specific rules (~2,000–5,000 chars)

The result: the LLM receives a massive prompt and must simultaneously understand the architecture, follow the format, implement business logic, handle edge cases, integrate with upstream components, and produce valid syntax. It selectively complies — following some rules while ignoring others.

### Measured Failure Modes (from 6 pipeline test sessions)

| Failure Mode | Frequency | Root Cause | Example |
|---|---|---|---|
| **Inter-component contract drift** | Every session | Components generated independently disagree on interfaces | `data.results` vs `data.companies` (session 2026-03-26b) |
| **Structural non-compliance** | 4/6 sessions | LLM produces semantically correct but structurally wrong output | Object schema when array expected, malformed cron, split code blocks |
| **Missing execution data** | 5/6 sessions | LLM guesses API shapes instead of receiving real data | App guesses cortex return types, cortex guesses extension response shapes |
| **Prompt overload → selective compliance** | 4/6 sessions | Large prompts cause LLM to follow some rules, ignore others | Single code block instruction ignored, enum naming ignored, asterisks dropped |
| **Skipped verification → silent failures** | 3/6 sessions | No gates between phases allow errors to compound | Tests pass but app shows `[object Object]` |

### The Core Insight

The problem isn't that the LLM can't generate correct components. It's that **a single prompt asks it to solve too many concerns simultaneously**, and the context window fills with information that's irrelevant to most of those concerns.

A multi-pass approach addresses this by:
1. Separating **what** (skeleton) from **how** (implementation)
2. Giving each pass only the context it needs
3. Validating after each pass before proceeding
4. Using real execution data between passes instead of descriptions

---

## 2. Current Prompt Anatomy — Where the Bloat Lives

### File sizes (prompt generation code, not the prompts themselves)

| File | Chars | Role |
|---|---|---|
| `generator-prompts-base.js` | 92,679 | Shared constants + ALL component templates |
| `generator-prompts-build.js` | 61,343 | Blueprint/interview/component dispatcher |
| `generator-prompts-cortex-data.js` | 5,311 | Data cortex template (lean) |
| `generator-prompts-cortex-feature.js` | 8,272 | Feature cortex template |
| `generator-prompts-cortex-app.js` | 5,043 | App-domain cortex template |
| `generator-prompts-test.js` | 16,869 | Test generation prompts |
| **Total** | **189,517** | |

### Typical prompt sizes delivered to the LLM

| Component | Static template | Variable context | Total estimate |
|---|---|---|---|
| Extension | ~18,000 chars | ~7,000–12,000 chars | **25,000–30,000 chars** |
| Cortex (generic) | ~20,000 chars | ~5,000–10,000 chars | **25,000–30,000 chars** |
| App | ~18,000 chars | ~10,000–15,000 chars | **28,000–33,000 chars** |
| Blueprint | ~15,000 chars | ~5,000–8,000 chars | **20,000–23,000 chars** |
| Feature cortex | ~8,000 chars | ~5,000–8,000 chars | **13,000–16,000 chars** |

### Content categories in a typical extension prompt

| Category | Chars | % of prompt | Needed for skeleton? | Needed for each action? |
|---|---|---|---|---|
| Platform overview (AIMEAT_CONTEXT) | 3,200 | ~11% | Yes (abbreviated) | No |
| Sandbox rules (SANDBOX_CONSTRAINTS) | 4,500 | ~15% | No | Yes (abbreviated) |
| ctx.memory deep docs | 2,500 | ~8% | No | Only if action uses memory |
| Output format (YAML + JS structure) | 2,000 | ~7% | Yes | No |
| Blueprint data model / structures | 3,000–8,000 | ~20% | Yes | Only relevant structures |
| Interview data sources + samples | 2,000–5,000 | ~12% | Yes (schemas) | Only relevant source |
| Upstream component summaries | 2,000–10,000 | ~15% | Dependency list only | Only if action calls upstream |
| Anti-pattern warnings | 1,500 | ~5% | No | Yes (abbreviated) |
| Code examples | 3,000 | ~10% | No | One relevant example |

**Key finding:** Only ~30-40% of a typical prompt is relevant to any single concern. The rest is context for other concerns that the LLM must carry but doesn't actively use for the current task.

### Repeated content across prompts

| Content | Repeated in N templates | Total chars wasted |
|---|---|---|
| AIMEAT_CONTEXT | 7 templates | ~19,200 extra chars |
| callExt() helper code | 3 places | ~2,100 extra chars |
| Translation t() function | 3 places | ~1,050 extra chars |
| YAML string rules | 3 templates | ~1,500 extra chars |
| Namespace explanation | 4+ places | ~4,800 extra chars |
| session.fetch pre-parsed warning | 3 places | ~900 extra chars |
| Empty-state handling rules | 3 places | ~1,500 extra chars |

---

## 3. What Each Component Type Actually Needs

### Extension

**Skeleton needs:**
- Action IDs, HTTP methods, paths (from blueprint)
- Input/output schemas with $ref to structures (from blueprint)
- Memory keys it reads/writes (from blueprint)
- Schedule definitions if any (from blueprint)
- Config keys (from blueprint settings)
- External API URLs and sample responses (from interview)

**Per-action implementation needs:**
- The action's specific input/output schema
- The relevant data source URL + sample response (if it calls external API)
- The relevant memory keys it reads/writes + their schemas
- Sandbox API for the specific operations (ctx.fetch for API calls, ctx.memory for storage, ctx.schedule for cron)
- One correct code example for the pattern (fetch+parse, store, schedule)

**What it does NOT need per-action:**
- Other actions' details
- Full blueprint
- Upstream component summaries
- CDN/CSP rules
- Translation rules
- Platform UI examples

### Data Cortex

**Skeleton needs:**
- Methods to export (from blueprint actions)
- Return type schemas (from blueprint structures)
- Extension dependency: name, action IDs (from blueprint + registration)

**Per-method implementation needs:**
- The method's input/output schema
- The extension action it wraps (name + probe golden sample showing real response)
- callExt pattern (one example)
- AIMEAT.data API if it reads platform data

### Feature Cortex

**Skeleton needs:**
- Use case it serves (from interview)
- View definition (from interview)
- Data cortex methods it consumes (from data cortex skeleton)
- UI components it will use

**Per-section implementation needs:**
- The specific data cortex method(s) for this section + their real return shapes (from probe)
- The specific platform UI component example (only the ones it uses)
- Translation keys for this section only
- DOM container pattern

### App

**Skeleton needs:**
- All views/pages (from interview)
- Navigation structure
- App-domain cortex API surface (from probe)
- Auth flow pattern
- Translation loading pattern

**Per-view implementation needs:**
- The specific feature cortex render() function for this view
- The view's layout requirements (from interview)
- Translation keys for this view only
- Style/CSS for this view only

---

## 4. Research Findings That Inform Pass Design

### From the guide analysis (3 independent reviews)

1. **Planner-Coder Gap is 75.3% of failures** — Blueprint says one thing, generated code does another. The skeleton pass directly addresses this by establishing the contract first.

2. **Every successful tool executes between steps** — Devin, Bolt, Lovable all run code between generation steps and feed real outputs forward. Per-action passes with validation+probing between them follows this pattern.

3. **Test tautology** — Tests generated from code catch 4% of real faults. Tests generated from the skeleton (before implementation) catch the contract, not the implementation.

4. **Error accumulation** — 80% correct per component × 7 components = 21% all correct. More, smaller passes with validation gates reduce the probability of undetected errors.

### From 6 pipeline test sessions

1. **Real execution data eliminates guessing** — The `data.results` vs `data.companies` bug (session 2026-03-26b) happened because the app prompt didn't include real cortex return shapes. Probing between passes fixes this.

2. **Smaller focused prompts improve compliance** — Session 2026-03-16 showed the LLM ignoring instructions about cron format, code block count, and enum naming in a large prompt. Smaller prompts focused on one thing had near-100% compliance.

3. **Contract mismatches between components** — Flat vs nested translation keys, camelCase vs kebab-case naming, different field names for the same data. The skeleton establishes the contract; implementation passes can't drift from it.

4. **Format enforcement works better in isolation** — When the output format is the primary task (skeleton pass), the LLM follows it precisely. When format is one of 10 concerns, it's deprioritized.

### From academic research (cited in guide analysis)

- **ROCODE:** Backtracking improves test pass rate by 23.8%. Per-action passes enable backtracking at action granularity instead of whole-component granularity.
- **AgentCoder:** Independent test designer that doesn't see implementation achieves 4.3× higher mutation catch rate. Skeleton-based tests achieve this.
- **LLMLOOP:** First feedback loop captures up to 24% improvement. Smoke testing the skeleton before filling it captures structural issues immediately.
- **LeDex:** Explain-then-fix (asking the LLM what it built before validation) improves repair quality by 15%+. Per-pass explain steps are cheap.

---

## 5. Pass Granularity Analysis

### Option A: Per-concern passes (rejected)

Passes like "data layer", "API integration", "business logic", "error handling" across all actions.

**Problem:** Still requires understanding the whole component. The "data layer" pass for an extension with 5 actions needs all 5 action schemas, all memory keys, all data sources. It's just the current approach with less work per pass but the same context.

### Option B: Per-unit passes (recommended)

Each pass implements one action (extension), one method (cortex), or one view (app).

**Advantages:**
- Context is minimal: skeleton + one unit's dependencies
- Validation is precise: did this one action produce correct output?
- Backtracking is cheap: regenerate one action, not the whole extension
- Probing is targeted: probe one action, feed result to the next cortex method

**Estimated prompt sizes with per-unit passes:**

| Pass type | Context needed | Estimated chars |
|---|---|---|
| Extension skeleton | Blueprint component + structures + data sources | 5,000–8,000 |
| Extension action impl | Skeleton excerpt + action schema + data source + sandbox API excerpt | 4,000–7,000 |
| Extension assembly | Skeleton + all action implementations | 3,000–5,000 (mostly mechanical) |
| Data cortex skeleton | Blueprint + extension skeleton | 3,000–5,000 |
| Data cortex method impl | Skeleton excerpt + extension probe result | 3,000–5,000 |
| Feature cortex skeleton | Blueprint + data cortex skeleton + use case | 4,000–6,000 |
| Feature cortex section impl | Skeleton excerpt + data cortex probe + UI example | 4,000–7,000 |
| App skeleton | Blueprint + cortex skeletons + views | 5,000–8,000 |
| App view impl | Skeleton excerpt + cortex probe + view spec | 4,000–7,000 |

**Compared to current:** 25,000–33,000 chars per prompt → 3,000–8,000 chars per prompt. 4–8× reduction.

### Option C: Hybrid (per-unit for complex, single-shot for simple)

CSM, MSM, Memory, and Translation components are simple enough for single-shot generation (current prompts for these are 2,000–5,000 chars). Only Extension, Cortex, and App benefit from multi-pass.

**This is the recommended approach.** Blueprint still generates everything. Simple components generate in one pass. Complex components (extension, cortex layers, app) use skeleton → per-unit → assembly.

---

## 6. Skeleton Content Specification

### What makes a good skeleton

A skeleton must be:
1. **Complete** — lists every action/method/view with its signature
2. **Typed** — input/output schemas for every action/method
3. **Connected** — shows which actions consume which upstream outputs
4. **Compact** — no implementation code, no explanations, just contracts
5. **Machine-parseable** — can be validated structurally before proceeding

### Extension skeleton example

```yaml
# Extension skeleton: prh-company-monitor
metadata:
  name: prh-company-monitor
  version: 1.0.0
  description: Monitors Finnish company registry changes

memory:
  write:
    - key: watchlist.items
      schema: { type: array, items: { businessId: string, name: string, addedAt: string } }
    - key: watchlist.changes
      schema: { type: array, items: { businessId: string, field: string, oldValue: any, newValue: any, detectedAt: string } }
  read:
    - key: settings.config
      schema: { checkInterval: number, maxCompanies: number }

actions:
  - id: search-companies
    method: POST
    path: /search
    input: { query: string, maxResults?: number }
    output: { totalResults: number, companies: Array<{ businessId: string, name: string, registrationDate: string, status: string }> }
    dataSource: https://avoindata.prh.fi/opendata-ytj-api/v3/companies
    notes: "Calls PRH YTJ API, transforms response envelope"

  - id: get-company-details
    method: POST
    path: /company/:businessId
    input: { businessId: string }
    output: { businessId: string, name: string, forms: Array<{...}>, addresses: Array<{...}> }
    dataSource: https://avoindata.prh.fi/opendata-ytj-api/v3/companies/{businessId}

  - id: check-changes
    method: POST
    path: /check
    input: {}
    output: { checked: number, changesFound: number, changes: Array<Change> }
    reads: [watchlist.items, settings.config]
    writes: [watchlist.changes]
    schedule: "*/15 * * * *"

config:
  keys: [settings.config]

activate:
  copies: []  # no init data needed from owner namespace
```

### Data cortex skeleton example

```yaml
# Data cortex skeleton: prh-data
metadata:
  name: prh-data

extension: prh-company-monitor  # registered-as name

methods:
  - name: searchCompanies
    params: { query: string, maxResults?: number }
    returns: { totalResults: number, companies: Array<Company> }
    calls: search-companies  # extension action

  - name: getCompanyDetails
    params: { businessId: string }
    returns: { businessId: string, name: string, forms: Array, addresses: Array }
    calls: get-company-details

  - name: getWatchlist
    returns: Array<WatchlistItem>
    reads: watchlist.items  # AIMEAT.data.getPublic('ext:prh-company-monitor', 'watchlist.items')

  - name: getChanges
    returns: Array<Change>
    reads: watchlist.changes
```

### Feature cortex skeleton example

```yaml
# Feature cortex skeleton: prh-search-feature
metadata:
  name: prh-search-feature

useCase: "Search Finnish companies by name or business ID"
view: search-view

dataCortex: prh-data
methods:
  - name: render
    params: { container: HTMLElement }
    description: "Renders search form + results table"
    uses:
      data: [searchCompanies]
      ui: [DataTable, Form]
    translationKeys: [search.title, search.placeholder, search.button, search.results, search.noResults]
```

### App skeleton example

```yaml
# App skeleton: prh-monitor
metadata:
  name: PRH Yritysseuranta
  version: 1.0.0

cortex: prh-app-domain  # app-domain cortex registered-as name

views:
  - id: search
    label: search.tab
    feature: prh-search-feature
    layout: "Full width, search bar top, results table below"
  - id: watchlist
    label: watchlist.tab
    feature: prh-watchlist-feature
    layout: "Card grid with company cards, add button"
  - id: changes
    label: changes.tab
    feature: prh-changes-feature
    layout: "Timeline of detected changes"

navigation: tabs  # tabs | sidebar | single-page
auth: required
locale: [fi, en]
```

---

## 7. Pass Ordering and Dependencies

### Complete pass sequence for a complex service

```
Phase 1: Blueprint (unchanged)
Phase 2: Define
  2a. CSM (single-shot)
  2b. MSM (single-shot, if needed)
Phase 3: Seed
  3a. Memory (single-shot)
  3b. Translation FI (single-shot)
  3c. Translation EN (single-shot)
Phase 4: Extension
  4a. Extension skeleton ← blueprint + interview data sources
  4b. Extension action 1 impl ← skeleton + action 1 spec + data source sample
  4c. Extension action 2 impl ← skeleton + action 2 spec + data source sample
  ...
  4n. Extension assembly ← skeleton + all action impls → validate → register → probe all actions
Phase 5: Data Cortex
  5a. Data cortex skeleton ← blueprint + extension skeleton + extension probe results
  5b. Data cortex method 1 impl ← skeleton + extension action 1 probe result
  5c. Data cortex method 2 impl ← skeleton + extension action 2 probe result
  ...
  5n. Data cortex assembly ← skeleton + all method impls → validate → register → probe all methods
Phase 6: Feature Cortex (one per use case)
  6a. Feature cortex skeleton ← blueprint + data cortex skeleton + data cortex probe results + use case
  6b. Feature cortex section 1 impl ← skeleton + data method probe + UI component example
  ...
  6n. Feature cortex assembly → validate → register → probe render()
Phase 7: App-Domain Cortex
  7a. App-domain cortex skeleton ← all feature cortex skeletons + probes
  7b. App-domain cortex composition impl ← skeleton + feature probes
  7c. Assembly → validate → register → probe
Phase 8: App
  8a. App skeleton ← blueprint + app-domain cortex probe
  8b. App view 1 impl ← skeleton + feature cortex render spec
  8c. App view 2 impl ← skeleton + feature cortex render spec
  ...
  8n. App assembly → validate → register → smoke test
```

### Validation gates

Every pass has a validation gate:
- **Skeleton pass:** Validate structure (all actions/methods declared, schemas parseable, dependencies exist)
- **Unit pass:** Validate syntax + anti-patterns + schema compliance (does the implementation match the skeleton's declared input/output?)
- **Assembly pass:** Validate complete component (all units present, correct assembly, no orphaned code)
- **Registration:** Existing registration flow (unchanged)
- **Probe:** Existing probe flow (extended to all layers)

### When to backtrack

If a unit pass fails validation 2 times:
1. Re-examine the skeleton's contract for that unit — is it achievable?
2. If the skeleton is wrong, regenerate just that skeleton entry and retry
3. If the skeleton is fine, try fresh generation (not iterative fix)

---

## 8. Context Budget Per Pass Type

### Target: Every pass under 10,000 chars

| Pass | Required context | Estimated chars |
|---|---|---|
| **Extension skeleton** | INSTRUCTION_DISCLAIMER (250) + blueprint component (500) + structures (1,000–3,000) + data sources with samples (1,000–3,000) + skeleton output format (800) | **3,500–7,500** |
| **Extension action impl** | skeleton (500–1,000) + action spec excerpt (300) + relevant data source + sample (500–1,500) + sandbox API excerpt for this action's needs (500–1,000) + one code example (500) + anti-pattern checklist (300) | **2,600–4,600** |
| **Extension assembly** | skeleton (500–1,000) + all action impls (2,000–5,000) + YAML manifest format (500) + assembly rules (300) | **3,300–6,800** |
| **Data cortex skeleton** | extension skeleton (500–1,000) + extension probe summaries (500–1,500) + blueprint methods (300) + output format (500) | **1,800–3,300** |
| **Data cortex method impl** | skeleton method entry (200) + extension probe result for this action (300–800) + callExt pattern (300) + one example (300) | **1,100–1,600** |
| **Feature cortex skeleton** | use case (300) + view spec (300) + data cortex skeleton (300–500) + output format (500) | **1,400–1,600** |
| **Feature cortex section** | skeleton section (200) + data cortex probe for relevant method (300–500) + ONE platform UI example (500–1,000) + translation keys (200) + render pattern (300) | **1,500–2,200** |
| **App skeleton** | views (500) + app-domain cortex probe (500–1,000) + navigation pattern (300) + output format (500) | **1,800–2,300** |
| **App view impl** | skeleton view (200) + feature cortex render spec (300–500) + layout requirements (200) + CSS pattern (300) + translation keys (200) | **1,200–1,400** |

**Maximum estimated prompt:** Extension skeleton at ~7,500 chars — still 3-4× smaller than current minimum.

---

## 9. Comparison: Current vs VPasses

| Dimension | Current pipeline | VPasses pipeline |
|---|---|---|
| Prompts per extension | 1 (25-30K chars) | 3-7 (3-8K chars each) |
| Prompts per cortex | 1 (13-30K chars) | 3-6 (1-5K chars each) |
| Prompts per app | 1 (28-33K chars) | 3-6 (1-3K chars each) |
| Total prompts for 12-component service | ~12 | ~30-50 |
| Max prompt size | 33K chars | ~8K chars |
| Context relevance per prompt | ~30-40% | ~80-90% |
| Validation granularity | Per component | Per action/method/view |
| Backtrack granularity | Whole component | Single action/method/view |
| Real data between steps | Extension probes only | Probes at every layer |
| Contract enforcement | Post-hoc (contract.js) | Built-in (skeleton IS the contract) |
| Test basis | Implementation code | Skeleton contract |

### Trade-off: More prompts = more copy-paste cycles

For manual (copy-paste) workflow: ~30-50 prompts vs ~12. This is 2.5-4× more interactions.

**Mitigation:** The autopilot (OpenRouter/LM Studio) handles this automatically. For manual users, the skeleton pass can optionally be merged with the first unit pass to reduce round-trips.

### Trade-off: Assembly pass overhead

Each complex component needs an assembly pass that combines units. This is mostly mechanical (concatenation + glue code) and could potentially be done deterministically (no LLM needed).

---

## 10. Key Design Decisions Required

1. **Skeleton format:** YAML (as shown above) or JSON? YAML is more readable for the LLM but JSON is easier to validate programmatically.

2. **Assembly: LLM or deterministic?** Can the assembly pass be a code operation (concatenate action implementations into YAML+JS manifest) or does it need LLM judgment?

3. **Simple component threshold:** Which components stay single-shot? Proposed: CSM, MSM, Memory, Translation = single-shot. Extension, all Cortex layers, App = multi-pass.

4. **Manual workflow accommodation:** Should the UI support both single-shot (current) and multi-pass modes? Or is VPasses autopilot-only?

5. **Skeleton storage:** Where does the skeleton live? Proposed: `generator.{projectId}.component.{componentId}.skeleton` memory key.

6. **Pass state tracking:** How to track which passes are complete? Proposed: extend component state with `passes: [{ id, status, result }]`.

---

## 11. Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| More prompts = more failure points | Medium | Each failure is cheaper to fix (one action vs whole component) |
| Assembly pass introduces new integration bugs | Medium | Deterministic assembly where possible; LLM assembly is a focused task |
| Skeleton quality determines everything | High | Skeleton validation must be rigorous; skeleton fix loop needed |
| Autopilot latency (30-50 API calls vs 12) | Low | Each call is faster (smaller prompt = faster response) |
| Manual users overwhelmed by passes | Medium | UI groups passes visually; optional "express mode" for simple services |
