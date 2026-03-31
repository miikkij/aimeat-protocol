# Generator Architecture Redesign — Research & Analysis

**Date:** 2026-03-31
**Status:** Research complete, ready for design decisions

---

## 1. Current System Analysis

### 1.1 Generator (Single-Shot)

The generator pipeline uses **8 prompt files totaling ~206K characters** of source code. The user-facing workflow has 6 phases:

1. **Description** — user writes a free-text description
2. **Interview** — AI interviews user through ~20 questions, produces structured JSON spec
3. **Blueprint** — AI generates a JSON blueprint from the spec (~25K char prompt)
4. **Settings** — user fills in API keys, configuration
5. **Component Generation** — each component generated in phase order (~20-35K char prompts each)
6. **Lifecycle** — activate, launch, package

**Architecture defined in prompts (cortex-modular, 5 layers):**

```
APP (thin shell — navigation, layout, CDN libraries)
  ↓ calls public methods
APP-DOMAIN CORTEX (composes feature cortexes + auth + translations + navigation)
  ↓ orchestrates
FEATURE CORTEX (self-contained data+UI per use case, exports render())
  ↓ uses
DATA CORTEX (pure data access, wraps callExt + AIMEAT.data APIs)
  ↓ calls
EXTENSION (V8 sandbox, external API calls, scheduled jobs, own memory namespace)
```

Plus 7 **bundled platform UI cortexes** (charts, canvas, dialogs, forms, layout, nav, viewers).

**Component generation pipeline — the actual mechanics:**

The pipeline generates components in strict phase order: `csm → memory → translation → extension → cortex-data → cortex-features → cortex-app → app`. Each component type has a specific template and role:

**CSM (Community Service Manifest):** Single-shot YAML generation. The template (`COMPONENT_TEMPLATES.csm`) asks the AI to produce a YAML with `data_schema.required`/`optional` field maps, `consent_requirements`, `moderation` settings, and `ui_hints`. Critical rule: only include fields from the raw source data — computed/derived values (aggregates, scores) are NOT in the CSM, they're calculated by extensions and stored separately. The CSM defines what the _service_ stores, not what the _extension_ computes.

**Memory (seed data/lookup tables):** Single-shot JSON generation. The memory template defines a key convention: `namespace.__meta` (version, description), `namespace.__index` (lightweight lookup index), `namespace.__config` (TTLs, thresholds), `namespace.YYYY-MM-DD` (date-bucketed data), `namespace.item-id` (individual items). Memory is stored in the **owner's namespace** — accessible to extensions via `ctx.memory.getPublic(ctx.caller.gaii, key)`. Static data from the interview's `dataSources[].staticData` is injected verbatim into the memory prompt as a complete dataset. Rule: prefer fewer, larger keys (one array of 300 items) over many small keys.

**Translation:** Single-shot JSON, one component per locale (e.g., "Finnish (fi) Strings", "English (en) Strings"). Keys use dot-namespaced paths matching UI structure: `app.nav.home`, `app.filters.status`, `domain.type.example_category`. Critical mechanics: (a) translations are stored in the **owner's namespace** (key format `{service-name}.i18n.{locale}` or `i18n.{locale}`), NOT in the extension namespace — this is the #1 source of confusion, (b) when the second locale is generated, the first locale's keys are injected into the prompt so the AI produces matching keys, (c) all keys must be flat (`"tab.search": "Haku"`) even though the key names use dots, because the `t()` function checks flat keys first before nested traversal.

**Extension:** Generated via the large extension template (~20K chars). Receives the full `AIMEAT_CONTEXT`, `SANDBOX_CONSTRAINTS`, memory API documentation with box-drawn warnings about `JSON.parse()` prohibition and namespace rules. The `buildComponentPrompt()` function injects: (a) data sources from interview with exact URLs, response envelopes, and sample entries, (b) memory key schemas from `dataModel` filtered by `producedBy`/`consumedBy`, (c) scheduled jobs from blueprint, (d) config keys from blueprint settings, (e) required action IDs from test scenarios. The `@activate` init pattern initializes extension-owned runtime data (watchlists, caches) but does NOT copy translations/settings — those stay in the owner namespace and cortex reads them directly via `AIMEAT.data.get()`.

**Data Cortex:** Specialized prompt (`buildDataCortexPrompt()`, ~5K). Receives: extension context bundle (action endpoints, probe results with real API responses), blueprint structures, memory keys. Wraps `callExt()` and `readExtMemory()` into clean async methods. Pure data access — no UI. Critical: reads extension data via `AIMEAT.data.getPublic('ext:name', key)`, reads owner data (translations, settings) via `AIMEAT.data.get(key)`. The probe results from extension registration are passed here — this is where the "actual field names vs declared field names" contract is verified.

**Feature Cortex:** Specialized prompt (`buildFeatureCortexPrompt()`, ~9K). Self-contained data+UI per use case. Receives: data cortex bundle, use case definition, view specification, translation keys, and full `PLATFORM_UI_EXAMPLES` showing correct usage of Tabs, DataTable, Timeline, Forms, Dialogs with their actual APIs (e.g., `Tabs({ onChange })` not `onSelect`, `DataTable` has no `onRowClick`). Exports `render(container)`.

**App-Domain Cortex:** Specialized prompt (`buildAppDomainCortexPrompt()`, ~5K). Composes all feature cortexes, manages auth (`AIMEAT.auth.login()`), translations (`getTranslations(locale)`), navigation, and settings. Must export `init()`, `render(container)`, `t(key)`, `switchLocale()`.

**App:** The app template (`COMPONENT_TEMPLATES.app`) is dynamic — it grows based on completed components. It injects: (a) translation keys extracted from registered translation components (with a box-drawn warning to use EXACT keys, not invent new ones), (b) cortex library API summaries with `summarizeCortexApiForApp()` showing real return types from probe data, (c) platform UI library load instructions, (d) the `boot()` function pattern with correct script load order. When cortex libraries exist, the app calls only cortex methods. The template also includes a fallback path for apps WITHOUT cortex (direct `extCall()` and `AIMEAT.data` patterns), which is a layer violation but necessary for simple projects.

**Cross-component data threading:** `buildComponentPrompt()` does significant work to thread context forward:
- `dataModel` entries are filtered by `producedBy`/`consumedBy` and injected per component
- Extension probe results (real API responses) are passed to cortex and app prompts
- Translation keys from registered translation components are injected into app prompts
- Context bundles (`createBundle()`) capture each component's registration name, actions, exports, and probe results
- `summarizeCortexApiForApp()` combines cortex code analysis with extension probe data to show actual return types

**Blueprint JSON structure:**

```json
{
  "architecture": "cortex-modular",
  "components": [{ "id", "type", "label", "produces", "consumes" }],
  "phases": [["csm-1"], ["memory-1", "translation-fi"], ...],
  "dataModel": {
    "structures": { "$ref-able JSON Schema definitions" },
    "memoryKeys": { "key → schema + source + producedBy + consumedBy" },
    "actions": { "ext:name/action → input/output with $ref" }
  },
  "settings": { "service": [], "user": [] },
  "testScenarios": [{ "componentId", "scenario", "expected" }]
}
```

**What works well:**

- The interview phase catches unvalidated assumptions early
- `produces`/`consumes` annotations create a data flow contract
- `dataModel` with `$ref` references threads data shapes between components
- Context bundles (`createBundle()`) pass probe results and API summaries forward
- Specialized cortex prompts per subtype (data/feature/app-domain) enforce layer scope
- The hook-per-domain dashboard architecture is clean

**What fails:**

1. **Prompt overload.** Individual prompts reach 20-35K chars. The extension template alone is 20K+. Critical rules (namespace access, JSON.parse prohibition, HTML entities) are repeated in box drawings because the AI keeps violating them — a symptom of attention span limits.

2. **Advisory-only enforcement.** All architectural rules, data flow constraints, and layer boundaries are expressed as prompt instructions. Nothing prevents the AI from generating an app that calls extensions directly.

3. **Feature cortex = monolithic view.** Each feature cortex is a self-contained data+UI module for one use case. Domain-specific UI components (CompanyCard, WatchlistBadge, ChangeTimeline) are created inline within the feature cortex's `render()` function. They cannot be reused across views or projects.

4. **Extensions designed for specific apps.** While architecturally positioned as platform capabilities, extensions are generated for specific project needs. The blueprint specifies exactly which actions to implement, tied to the project's data sources.

5. **No structural validation of generated output.** Blueprint validation checks JSON shape; component validation checks for anti-patterns. But there's no verification that a generated extension actually implements the blueprint's declared actions with the correct signatures.

6. **Quality gap.** V7 pipeline test produced working but bare-minimum UI. The reference Yritystutka app (generated from the same prompts by a human-guided AI session) has rich detail views, colored badges, timelines, and sidebar navigation. The difference: the human-guided session used the full 22K prompts; the automated pipeline used 2K summaries.

### 1.2 Foundry (Multi-Pass)

The Foundry breaks component generation into focused passes:

```
TEST (from contract, before implementation)
  → SKELETON (structure + signatures, zero code)
    → UNIT × N (one action/method per pass)
      → ASSEMBLY (combine skeleton + units)
        → Validate → Register → Probe
```

Passes use smaller prompts (1.5-8K chars each). Phase ordering enforced by `PHASE_ORDER`. Single-shot components (CSM, memory, translation) bypass multi-pass.

**Foundry's handling of single-shot components:**

CSM, Memory, and Translation use single-shot generation (same templates as the generator — `COMPONENT_TEMPLATES.csm/memory/translation`). These are small enough that multi-pass adds no value. The foundry applies the same phase ordering: CSM first (defines the data schema), then memory (seeds lookup data and indexes), then translations (one per locale, second locale forced to match first locale's keys). These are validated and registered before extension generation begins, ensuring the extension can read seed data from the owner namespace during its `@activate` init.

**Extension skeleton mechanics:** `buildExtensionSkeletonPrompt()` receives blueprint structures (JSON Schema), memory keys filtered to this component's `producedBy`/`consumedBy`, action definitions with input/output schemas, schedule definitions, config keys, and — critically — **data source URLs and sample responses from the interview**. The skeleton must include `sampleResponse` verbatim for every action that calls an external API, with the rule "use EXACT field names from sample responses." This is the foundry's key insight for preventing `data.results` vs `data.companies` drift — the skeleton captures real field names.

**Extension unit prompts:** `buildExtensionUnitPrompt()` receives the full skeleton (as context anchor), the specific unit's contract (id, input/output schemas, memory reads/writes, schedule, notes), the relevant data source with URL and sample response, and `SANDBOX_CONSTRAINTS`. Each unit is a single `export default async function(ctx, input)` body. The prompt is ~3-4K chars — well within the effective attention span.

**Extension assembly:** `buildExtensionAssemblyPrompt()` receives skeleton + all unit implementations. Despite saying "MECHANICAL assembly — do NOT modify the unit implementations," it asks the LLM to produce the complete YAML manifest (author, method, path for every action) and separate `// actions/{id}.js` blocks. This is where the LLM makes unauthorized modifications.

**Cortex skeleton/unit/assembly:** Similar pattern but with cortex-specific mechanics: `buildCortexMethodUnitPrompt()` receives skeleton, unit definition, extension probe results (ideally — but often `null` in practice), and the `callExt`/`readExtMemory` helper patterns. The cortex assembly produces a complete IIFE with `AIMEAT.register()`.

**Pipeline test results (2026-03-27):** All 11 components registered in ~45 minutes. Extension took 14 passes (27 min), data cortex 12 passes (4 min), three feature cortexes 5 passes each, app-domain cortex 4 passes, app 7 passes.

**What worked:**

- **Skeleton as explicit contract.** Having a validated intermediate representation anchors all unit implementations to declared interfaces.
- **Smaller focused prompts.** 1.5-8K chars per pass improves AI compliance.
- **Phase ordering enforcement.** `checkPhaseOrder()` prevents generating downstream components before upstream ones are registered.
- **Anti-pattern validation.** Comprehensive regex checks catch `JSON.parse(ctx.memory.get())`, `require()` in sandbox, etc.
- **Debug artifact logging.** Every prompt, response, and validation result is saved for post-mortem analysis.

**What failed:**

1. **Assembly is NOT mechanical.** Despite the design claiming "mechanical merge," the assembly prompt asks the LLM to generate YAML manifests, wrap units in IIFE structures, add shared helpers, and resolve shared state. The LLM modifies unit implementations during assembly.

2. **Probe data passed as null.** The critical design principle — real execution data flowing into downstream passes — is not implemented. `buildFeatureCortexSectionPrompt()` and `buildCortexMethodUnitPrompt()` explicitly receive `null` for probe data.

3. **Skeleton-to-unit extraction is fragile.** `parseUnitFromSkeleton()` uses naive YAML line parsing (find `- id: X`, collect lines until next `- `). Nested YAML or multi-line values cause incomplete extraction.

4. **Inter-unit consistency not validated.** Units are generated independently. If the search action stores `{ items: [...] }` but the detail action expects `{ results: [...] }`, they're incompatible. No validation catches this before assembly.

5. **Test-first tests too abstract.** Tests from blueprint schemas assert shapes that may not match actual API responses. Tests should be generated after skeleton + probe data, not from abstract `$ref` definitions.

6. **Reflection not fully wired.** Reflection can prescribe `modify_skeleton` or `modify_test`, but only `retry_unit` is implemented. The system just appends the error and retries.

7. **Complete code duplication.** Foundry is a parallel copy of the generator (separate routes, files, state, dashboard) creating ~15K lines of duplicated infrastructure.

**Key lesson:** The foundry's skeleton concept and per-action decomposition are architecturally sound. The failures are in execution: assembly should be deterministic, probe data must flow, and inter-unit validation is essential.

### 1.3 Calibrator (Iterative Prompt Improvement)

The calibrator runs a 4-step batch pipeline:

1. **Generate** — send prompt to N candidate models via OpenRouter
2. **Analyze** — reasoning LLM judges each output against target, produces pass/fail dimensions with severity (critical=3x, major=2x, minor=1x)
3. **Reflect** — dual reflection per model: (a) judge proposes improvements, (b) candidate self-reflects on own tendencies
4. **Synthesize** — aggregate proposals, group overlaps, produce A/B/C option tiers (conservative/moderate/aggressive)

Then **Apply Selected** — reasoning LLM edits the prompt (not follows it), producing a new version.

**What works well:**

- **Dual reflection** (judge + self) catches different failure modes — novel and valuable
- **A/B/C option tiers** prevent over-correction
- **Full auditability** — every prompt and response saved
- **Paste-back mechanism** — works without API keys, aligns with AIMEAT's prompt-driven workflow
- **Version tracking** with changelog
- **Batch isolation** — runs don't interfere

**Limitations for the new architecture:**

1. **No pipeline-aware calibration.** Optimizes one prompt in isolation. Changes to a skeleton prompt may break downstream test/assembly prompts. No concept of prompt dependencies.

2. **Hard-coded analysis categories.** The 8 evaluation dimensions (top-level structure, component count, data pipeline, etc.) are generator-blueprint specific. Different prompt types need different criteria.

3. **No regression detection.** After applying fixes, no mechanism to verify nothing else broke.

4. **Per-dimension chart not working.** Always shows overall score regardless of dimension filter.

5. **No cost tracking.** Each batch involves many LLM calls with no visibility into total cost.

**Reusability assessment:** The core 4-step loop (generate → analyze → reflect → synthesize → apply) is prompt-agnostic and can work for focused per-layer prompts. Needs: (a) customizable analysis templates per prompt type, (b) pipeline-aware calibration that tests downstream effects, (c) domain-derived dimension definitions.

### 1.4 Extension System

Extensions execute in **isolated-vm** (V8 Isolate), completely cut off from Node.js and browser APIs. The only gateway is the `ctx` object:

- `ctx.memory.{get,set,search,delete}` — own namespace (`ext:{name}`)
- `ctx.memory.getPublic(ns, key)` — read-only cross-namespace
- `ctx.fetch(url, opts)` — proxied HTTP with charset detection
- `ctx.wallet.consume(amount, reason)` — morsel economy
- `ctx.caller.{gaii, owner, roles}` — identity context
- `ctx.log.{info,warn,error}` — structured logging

**Contract surface:** YAML manifest declares actions (id, method, path, input/output schemas), schedules (cron, @activate), config keys, limits, federation settings.

**Key architectural property: Extensions ARE independent.** An extension needs to know only its own domain — what APIs to call, what data to store, what actions to expose. It does NOT need to know about cortexes, apps, or UI. The contract boundary is the memory namespace + action API. This is verified by the E2E tests and the actual runtime — extensions function identically whether called by a cortex, an AI agent, or a raw API request.

**The independence is enforced by the sandbox.** Since extensions cannot import Node.js modules, access global state, or call other extensions directly, they are physically isolated. The only coupling is through the documented action API and public memory keys.

### 1.5 Cortex System

Three cortex types are generated, plus 7 bundled platform UI cortexes:

| Type | Role | Composition |
|------|------|-------------|
| **Data cortex** | Pure data access layer | Wraps `callExt()` + `AIMEAT.data.*` APIs |
| **Feature cortex** | Self-contained feature module (data + UI) | Uses data cortex + platform UI cortexes |
| **App-domain cortex** | Top-level composition + business logic | Composes feature cortexes + auth + i18n + nav |
| **Platform UI cortexes** (7) | Reusable UI components | Tabs, Forms, DataTable, Timeline, Charts, etc. |

**Cortexes are browser-side IIFEs** that register on `window.AIMEAT`. No formal dependency system — composition is convention-based via shared globals. Load order is critical and manually managed in the app HTML.

**Component model gap:** Domain-specific UI pieces (CompanyCard, WatchlistBadge) are created inline within feature cortex `render()` functions. They are NOT registered as reusable components. The `AIMEAT.register()` function works at the cortex level, not the component level. There is no `type: component` in the YAML manifest.

**This is the core architectural problem the brief identifies:** The current "one feature cortex per view" approach creates monolithic views that embed all rendering logic. Reusable components should be the building blocks, composed by the app-domain cortex.

---

## 2. External Research

### 2.1 Multi-Agent Code Generation Systems

**MetaGPT** ([ICLR 2024](https://arxiv.org/html/2308.00352v6)) uses an "assembly line" paradigm where specialized agents (Product Manager, Architect, Project Manager, Engineer, QA) communicate through **structured documents**, not free-form dialogue. Each agent produces standardized artifacts (PRDs, system designs, interface definitions) that the next agent consumes. Achieved 85.9% and 87.7% Pass@1 on benchmarks.

**ChatDev** ([ACL 2024](https://aclanthology.org/2024.acl-long.810.pdf)) models a virtual software company with agents in design, coding, testing, and documentation phases. Unlike MetaGPT, agents communicate through dialogue — resulting in higher communication costs (often exceeding $10 per HumanEval task) and more ambiguity. The contrast demonstrates that **structured intermediate artifacts beat dialogue**.

**Blueprint2Code** ([Frontiers in AI, 2025](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2025.1660912/full)) uses a 4-stage pipeline: task preview → blueprint planning → code implementation → debugging optimization. If code fails tests, iterative debugging (max 5 rounds). If debugging fails, loop back to re-plan. Achieved 96.3% on HumanEval. **This is the closest published architecture to what AIMEAT needs.**

**Devin** ([2025 performance review](https://cognition.ai/blog/devin-annual-performance-review-2025)) learned after 18 months in production that it is "senior-level at codebase understanding but junior at execution." Works best on clearly-scoped 4-8 hour tasks. Failed 14/20 tasks in independent testing. **Critical production lesson: a single agent step at 95% reliability becomes 77% reliable across 5 steps.** Reliability compounds multiplicatively.

**Relevance to AIMEAT:** The blueprint IS the shared artifact (MetaGPT pattern). The foundry's probe-and-register pattern aligns with the test-feedback insight (agents that can run tests and see errors produce better code). The 95%^5=77% reliability math means we must minimize the number of generation steps — 4 is the practical maximum.

### 2.2 Prompt Decomposition & Context Engineering

**Context engineering vs prompt engineering** is the key shift in 2025-2026. The prompt is not the problem — the context is. Teams shipping reliable AI-generated code master what information agents see, when they see it, and how it is structured. Four strategies identified ([source](https://www.faros.ai/blog/context-engineering-for-developers)): Write (persist to scratchpad), Select (pull relevant info), Compress (summarize to fit), Isolate (separate concerns into different contexts).

**Self-correction pattern** is the most reliable chaining approach ([Anthropic docs](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/chain-prompts)): generate a draft, review it against criteria in a separate call, refine based on the review. Each step is a separate API call, allowing logging, evaluation, and branching.

**Skeleton-first decomposition** works when: (a) the skeleton is machine-validated, (b) fill passes receive the validated skeleton as context, (c) assembly is deterministic. This is exactly the foundry's approach — the failures were in execution, not concept.

**Context window saturation:** LLM instruction-following degrades beyond ~8K-12K tokens of instructions. Rules placed in the middle of long prompts are followed less reliably than at beginning or end. This explains the generator's defensive repetition of critical rules across its 20-35K prompts.

**Key finding:** The most successful prompt decomposition strategies share three properties:
1. **Explicit contracts** between steps (not just "the previous output")
2. **Validation at every boundary** (machine-checkable, not LLM-dependent)
3. **Minimal context per step** (only what's needed, not everything available)

### 2.3 Contract-First / Interface-First Generation

**Spec-Driven Development (SDD)** emerged as a major paradigm ([paper](https://arxiv.org/abs/2602.00180), [Thoughtworks](https://thoughtworks.medium.com/spec-driven-development-d85995a81387)), treating specifications — not code — as the primary artifact. Code becomes a generated or verified secondary artifact.

**AWS Kiro** (launched mid-2025) implements SDD natively: Requirements → Design → Tasks → Code. Real-world finding: Kiro didn't make developers write better specs — it made **weak specs impossible to ignore**. Acceptance criteria became enforced constraints. Limitations: spec quality degrades on ambiguous requests, specs and code can still fall out of sync. One practitioner called it "vibe coding with structure."

**The "schema as compiler" concept** ([source](https://medium.com/software-architecture-in-the-age-of-ai/contracts-over-classes-architecting-for-ai-understanding-not-just-developer-comfort-646882ebb93c)): contracts unlock safe generation, validation, and orchestration. If you define the interface between layers first, each generation step has a verifiable target.

**Relevance to AIMEAT:** The extension probe mechanism already validates contracts (call action, compare response shape). The blueprint's `dataModel` should be treated as an enforced contract — not an advisory description. Extending probing to cortex methods would close the verification gap.

### 2.4 Failure Modes in Multi-Step Generation

**The MAST Taxonomy** ([NeurIPS 2025 spotlight](https://arxiv.org/abs/2503.13657)) analyzed 1,600+ traces across 7 multi-agent frameworks and identified **14 failure modes** in 3 categories: specification/system design (5 modes), inter-agent misalignment (6 modes), task verification (3 modes). Key finding: **simple prompt engineering fixes achieved only 14% improvement** — structural redesigns are needed.

**The Planner-Coder Gap** ([2025 study](https://arxiv.org/abs/2510.10460)) accounts for **75.3% of failures** in multi-agent code generation. Two mechanisms: (1) semantic drift — plans are logically sound but lack implementation details, (2) context fragmentation — coding agents lose constraints implicit in requirements. Five error patterns: core concepts unclear (32.7%), edge cases missing (19.5%), complex logic underspecified (15.9%), relational phrases misinterpreted (9.7%), condition judgments omitted (22.1%). **A "monitor agent" inserted between planner and coder repairs 40-88% of failures.**

**The 17x Error Trap** ([source](https://towardsdatascience.com/why-your-multi-agent-system-is-failing-escaping-the-17x-error-trap-of-the-bag-of-agents/)): when agents are thrown together without structured topology, errors cascade multiplicatively. Google DeepMind found accuracy gains saturate beyond ~4 agents. Solution: centralized control plane with structured topology.

**Composability problem** ([CodeRabbit report](https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report)): with GenAI assistance, cycle time up 9%, PRs per author up 20%, but **incidents per PR up 23.5% and change failure rate up 30%**. More code, more breakage. Composability must be a constraint during generation, not an afterthought.

**79% of problems are specification, not implementation** ([Augment Code](https://www.augmentcode.com/guides/why-multi-agent-llm-systems-fail-and-how-to-fix-them)): agents cannot read between lines, infer context, or ask clarifying questions during execution. Every ambiguity becomes a decision point where agents explore all possible interpretations.

**AIMEAT-specific prevention techniques:**
- **Golden contract (dataModel)** as machine-parseable document that all components reference
- **Integration smoke tests** after each phase (extension → cortex → app data path)
- **Canonical field names** locked in the contract — components using different names fail validation
- **Monitor/validator between steps** (the probe-and-reconcile pattern)
- **Deterministic assembly** — no LLM touching the final component structure (assembly hallucination is consistently reported)
- **Pass exact contract, not summaries** — summaries lose detail, causing naming drift

### 2.5 Extension/Plugin Generation

No published system generates layered extension+cortex+app stacks at the scale AIMEAT needs. The closest analogs:

- **Semantic Kernel** ([Microsoft](https://learn.microsoft.com/en-us/semantic-kernel/concepts/plugins/)) uses a plugin model where each plugin has a defined contract (input/output schema, description) and the orchestrator selects/composes plugins at runtime.
- **WordPress plugin generation** ecosystem — AI tools generate plugin components (PHP, CSS, JS) separately against a defined plugin interface.
- **OpenAI Codex plugins** — generates against a defined plugin interface contract.

**Key insight from plugin ecosystems (VSCode, WordPress, Shopify):** Successful plugin systems have (a) a comprehensive platform API, (b) strict manifests declaring capabilities, (c) runtime sandboxing enforcing boundaries. AIMEAT already has all three. The missing piece is generating plugins that DON'T assume a specific consumer.

**The AIMEAT extension model maps naturally to API-first development:** the extension is an API provider (contract = action endpoints + public memory keys), the cortex is a generated client. The contract is the synchronization point between independently-generated layers.

---

## 3. Design Options

### Option A: Layered Pipeline with Deterministic Assembly

**Core idea:** Keep the multi-pass approach but fix the foundry's execution failures. Each layer is generated independently with a validated contract flowing between layers. Assembly is deterministic (no LLM).

**How it works:**

```
INTERVIEW → BLUEPRINT (with machine-validated dataModel)
  ↓
PHASE 0: SERVICE FOUNDATION (single-shot, existing templates)
  CSM → defines data_schema (required/optional fields, consent, moderation)
  Memory components → seed data, lookup tables, indexes in OWNER namespace
  Translation components → per-locale i18n strings in OWNER namespace
    (second locale prompt includes first locale's keys for consistency)
  Register all → validates YAML/JSON, stores in platform
  ↓
PHASE 1: EXTENSION (multi-pass)
  Skeleton → Validate skeleton against blueprint + sample responses
  Unit passes (one per action) → Validate each unit
  Deterministic assembly (template concatenation, NOT LLM)
  Register → Probe → Store probe results
  @activate init runs → initializes extension runtime data (watchlists, caches)
  Extension reads owner seed data via ctx.memory.getPublic(ctx.caller.gaii, key)
  ↓
PHASE 2: DATA CORTEX (single-shot, ~5K prompt)
  Receives: blueprint structures + extension probe results (ACTUAL field names)
  Wraps callExt() + readExtMemory() into clean async methods
  Reads translations/settings from owner namespace via AIMEAT.data.get()
  Validate → Register → Probe cortex methods
  ↓
PHASE 3: COMPONENTS (NEW — replaces feature cortexes)
  For each reusable UI component identified in blueprint:
    Generate as standalone cortex with render(container, props) interface
    Receives: data cortex probe results + platform UI library examples
    Each component handles ONE concern (CompanyCard, WatchlistBadge, SearchInput...)
    Validate → Register
  ↓
PHASE 4: APP-DOMAIN CORTEX (single-shot, ~5K prompt)
  Receives: all component registrations + data cortex probe + translation keys
  Composes components into views, manages navigation, enforces business rules
  Owns use cases, workflows, validation, computed values
  Exports: init(), render(), t(), switchLocale()
  Validate → Register
  ↓
PHASE 5: APP (single-shot, ~4K prompt)
  Receives: app-domain cortex API summary ONLY
  Thin shell: boot(), loadScript() chain, auth container, CSS theming
  Validate → Register → Launch
```

**Extension generation — separately? Same system?**
Extensions are generated by the same system but in Phase 1, before anything that depends on them. The extension prompt knows NOTHING about cortexes or apps — only the data source, API contract, and storage model.

**Cortex generation:**
Data cortex is single-shot (small, well-defined scope). Components are generated individually as small, focused cortexes. App-domain cortex is single-shot, composing components.

**App generation:**
Single-shot, receives only the app-domain cortex's API. Thin shell.

**Contract maintenance:**
- Blueprint `dataModel` is the golden contract (machine-validated JSON)
- Extension skeleton is validated against blueprint actions/structures
- Extension probe results are captured and passed to data cortex prompt
- Data cortex probe results are passed to component prompts
- Component registrations are passed to app-domain cortex prompt
- Each validation step is structural (JSON Schema, AST-level), not LLM-dependent

**Assembly:**
Deterministic for extensions (template: YAML from validated skeleton + unit function bodies concatenated into IIFE + manifest metadata). No LLM call. For cortexes and apps, single-shot generation (no assembly needed — they're small enough).

**Testing:**
- Extension tests: generated from skeleton + probe results (not abstract schemas)
- Integration smoke test: after each phase, run a minimal end-to-end test
- No test-before-code for cortex/app (too abstract to be useful)

**Calibrator integration:**
- Calibrate each prompt type independently (extension unit prompt, data cortex prompt, component prompt, app prompt)
- Create per-type analysis templates with relevant evaluation dimensions
- Pipeline-aware calibration: after improving a prompt, re-run the downstream pipeline to verify no regression

**Prompt count and sizes:**
| Prompt | Approx Size | Count per project |
|--------|------------|-------------------|
| Interview | ~3K | 1 |
| Blueprint | ~15K (reduced from 25K by removing cortex instructions) | 1 |
| CSM | ~2K | 1 |
| Memory | ~2K | 1-3 (one per namespace) |
| Translation | ~2K | 2 (one per locale, second includes first's keys) |
| Extension skeleton | ~4K | 1 per extension |
| Extension unit | ~3K | N per extension (one per action) |
| Data cortex | ~5K | 1 |
| Component | ~6K | M (one per reusable component) |
| App-domain cortex | ~5K | 1 |
| App | ~4K | 1 |

**User workflow:** Same as current generator (6 phases). The UI changes are internal — the dashboard shows phases and pass progress, but the user's copy-paste-or-autopilot workflow is unchanged.

**Known risks:**
- Deterministic assembly requires a robust template engine for extension code. Edge cases in YAML/JS formatting may produce invalid output.
- Reusable components are a new concept — the blueprint prompt needs to learn how to decompose features into components vs leaving them as monolithic views.
- More prompts × more validation steps = slower pipeline for complex projects.

**Complexity:** Medium. Most infrastructure exists (foundry passes, validation, probing, bundling). Main new work: deterministic assembly engine, component generation prompt, blueprint component decomposition.

**Key questions answered:**
1. Can an extension be designed WITHOUT knowing what app will use it? **Yes.** Phase 1 extension prompt receives only data source + API contract.
2. Can a cortex be designed knowing ONLY the extension's contract? **Yes.** Data cortex receives probe results (actual field names and shapes), not extension internals.
3. Can an app be designed knowing ONLY the cortex's API? **Yes.** App receives app-domain cortex summary only.
4. How do we verify contracts WITHOUT running an LLM? **JSON Schema validation of skeleton against blueprint, field name comparison of probe results against declared structures, AST-level checks of exports.**
5. How do we prevent drift? **Golden contract (dataModel) + probe results passed forward + deterministic assembly.**
6. Where does the calibrator add most value? **Extension unit prompts (most complex, highest failure rate) and component prompts (quality-sensitive).**

---

### Option B: Two-System Architecture (Extension Forge + App Composer)

**Core idea:** Split generation into two independent systems. The Extension Forge generates platform extensions from data source descriptions. The App Composer generates apps from a service description + available extensions. Extensions are truly first-class — they exist before any app is conceived.

**How it works:**

**System 1: Extension Forge**
```
DATA SOURCE DESCRIPTION (API URL, sample response, desired actions)
  → Interview (focused on data source capabilities)
  → Extension Spec (actions, memory keys, schedules, config)
  → Generate Extension (skeleton → units → deterministic assembly)
  → Register → Probe → Publish to Extension Catalog
```

The Extension Forge is a focused tool. Its ONLY job is producing platform extensions. It doesn't know about cortexes, apps, or UI. The interview asks about the data source, not about how the data will be used.

**System 2: App Composer**
```
SERVICE DESCRIPTION + AVAILABLE EXTENSIONS (from catalog)
  → Interview (focused on use cases, views, business rules)
  → App Blueprint (components, views, navigation, business rules)
  → CSM + Memory + Translations (service foundation — same as current)
  → Data Cortex (wraps selected extensions, reads owner seed data)
  → Components (reusable UI pieces)
  → App-Domain Cortex (composition + business logic + i18n)
  → App (thin shell, loads cortex scripts, auth boot)
```

The App Composer assumes extensions already exist. It browses the extension catalog, selects relevant extensions, and generates an app that uses them. The prompts never mention extension internals — only the published API (action endpoints, response shapes from probe results, public memory keys).

**Extension generation:**
Completely independent system with its own interview, spec, and generation pipeline. Extensions are stored in a catalog with documentation, probe results, and version history.

**Cortex/app generation:**
The App Composer generates all cortex layers. Data cortex wraps the selected extensions. Components are generated as standalone pieces. App-domain cortex composes everything.

**Contract maintenance:**
- Extension catalog entries include probe results — these ARE the contract
- App Composer reads catalog entries, not extension source code
- Data cortex is validated against extension probe results
- Component ↔ data cortex contract is validated via probe

**Testing:**
- Extension Forge: per-action unit tests + integration probe
- App Composer: per-component smoke test + end-to-end integration test
- Extensions and apps can be tested independently

**Calibrator integration:**
- Separate calibration projects for Extension Forge prompts and App Composer prompts
- Extension prompts are calibrated against data-source-specific targets
- App prompts are calibrated against app-quality-specific targets

**Prompt count and sizes:**
| Prompt | System | Approx Size |
|--------|--------|------------|
| Extension interview | Forge | ~3K |
| Extension spec | Forge | ~4K |
| Extension skeleton | Forge | ~4K |
| Extension unit | Forge | ~3K |
| App interview | Composer | ~4K |
| App blueprint | Composer | ~10K |
| Data cortex | Composer | ~5K |
| Component | Composer | ~6K |
| App-domain cortex | Composer | ~5K |
| App | Composer | ~4K |

**User workflow:**
1. **Create extensions** (one-time per data source): describe the API → interview → generate → publish
2. **Create apps** (uses existing extensions): describe the service → select extensions → interview → generate

This is fundamentally different from the current workflow. Users build a library of extensions first, then compose apps from them. One extension can be used by multiple apps. New apps reuse existing extensions.

**Known risks:**
- **Bootstrap problem:** The first time a user creates a project, they have no extensions. They must create extensions before creating apps, which adds friction.
- **Extension catalog UX:** Requires a new UI for browsing, selecting, and managing extensions.
- **Extension versioning:** If an extension is updated, apps that depend on it may break. Needs version pinning.
- **Overkill for simple projects:** A user who wants one simple app must create an extension first, then an app. The current generator is faster for one-off projects.

**Complexity:** High. Two separate systems with their own UIs, storage, and pipelines. Extension catalog with versioning. Selection/dependency UI.

**Key questions answered:**
1. Can an extension be designed WITHOUT knowing what app will use it? **Yes — this is the core design principle.** Extensions are created before apps exist.
2. Can a cortex be designed knowing ONLY the extension's contract? **Yes.** The App Composer reads catalog probe results.
3. Can an app be designed knowing ONLY the cortex's API? **Yes.** Same as Option A.
4. How do we verify contracts? **Extension catalog entries include machine-parseable probe results. Data cortex validated against these.**
5. How do we prevent drift? **Physical separation — the two systems can't share internal state.**
6. Where does the calibrator add most value? **Extension unit prompts in the Forge. Component prompts in the Composer.**

---

### Option C: Contract-First Pipeline with Blueprint Compiler

**Core idea:** The blueprint is not just a document — it's a compiled intermediate representation that generates deterministic scaffolds for every component. The LLM only fills in the parts that require intelligence (external API integration, business logic, UI rendering). Everything else is generated mechanically from the blueprint.

**How it works:**

```
INTERVIEW → BLUEPRINT
  ↓
BLUEPRINT COMPILER (deterministic, no LLM)
  → Extension scaffold: YAML manifest with action stubs, memory key declarations
  → Data cortex scaffold: IIFE with callExt wrappers for each action
  → Component scaffolds: render function stubs with typed props
  → App-domain cortex scaffold: composition stubs with navigation
  → App scaffold: HTML with correct script tags, load order, layout
  → Test scaffolds: test files with assertions matching declared schemas
  ↓
LLM FILL PASSES (only the parts requiring intelligence)
  → Extension action bodies (external API calls, data transformation)
  → Component render bodies (DOM construction, event handlers, styling)
  → App-domain cortex view composition (how components fit on each page)
  → Business rule implementations (validation, computed values, workflows)
  ↓
DETERMINISTIC ASSEMBLY (template engine)
  Scaffold + filled bodies → complete component
  ↓
VALIDATE → REGISTER → PROBE → NEXT PHASE
```

**Key innovation:** The blueprint compiler generates all structural code deterministically. The LLM never touches:
- YAML manifests (generated from blueprint action definitions)
- IIFE wrappers, registration code, or module patterns
- Import statements, script tags, or load order
- Memory key declarations or namespace setup
- Test scaffolds (assertions generated from declared schemas)

The LLM ONLY writes:
- External API call logic inside extension action bodies
- DOM construction and event handling inside component render functions
- View composition logic inside the app-domain cortex
- Business rules (validation, computed values)

**Extension generation:**
Blueprint compiler generates the complete YAML manifest and JS scaffold with stub functions. LLM fills each action body independently. No assembly step — the scaffold already has the correct structure.

**Cortex generation:**
Blueprint compiler generates the IIFE, registration, exports, and callExt wrappers. LLM fills the data transformation and error handling logic.

**Component generation:**
Blueprint compiler generates the component scaffold (IIFE, registration, props interface, render function signature). LLM fills the DOM construction, event handlers, and styling.

**App generation:**
Blueprint compiler generates the complete HTML with script tags, importmap, auth container, and layout. LLM fills CSS custom properties and minor layout adjustments.

**Contract maintenance:**
Contracts are ENFORCED by the compiler, not by prompt instructions. The compiler reads the blueprint's `dataModel` and generates code that structurally conforms to it. Field names come from the contract, not from the LLM.

**Testing:**
Test scaffolds are generated from the blueprint with real assertions. The LLM only needs to add test data setup (like mocking API responses). Tests run after each phase.

**Calibrator integration:**
Much simpler — calibrate only the fill prompts (extension action body, component render body, business rule implementations). These are small, focused prompts with clear success criteria.

**Prompt count and sizes:**
| Prompt | Approx Size | Purpose |
|--------|------------|---------|
| Interview | ~3K | Same as current |
| Blueprint | ~12K (simpler — compiler handles structure) | Generate the blueprint JSON |
| Extension action fill | ~2-4K | Fill ONE action body (API call + data transform) |
| Data cortex fill | ~3K | Fill data transformation logic |
| Component render fill | ~4-6K | Fill DOM construction + events |
| App-domain composition fill | ~3-4K | Fill view composition + business rules |
| App layout fill | ~2K | Fill CSS theming only |

**User workflow:** Same 6 phases, but Phase 5 (component generation) is much faster because the compiler does the structural work and the LLM only fills focused gaps.

**Known risks:**
- **Blueprint compiler complexity.** Building a deterministic code generator for AIMEAT's component formats (extension YAML+JS, cortex IIFE+YAML, app HTML) is substantial engineering work. The compiler must handle all edge cases (multi-instance extensions, scheduled jobs, platform UI library integration, auth patterns, translation loading, etc.).
- **Rigidity.** The compiler's scaffold is a hard constraint. If the LLM needs to do something the scaffold doesn't support (e.g., a component that needs WebSocket connections, or an extension that needs multi-step API orchestration), the scaffold may be too restrictive.
- **Blueprint quality bottleneck.** Everything depends on the blueprint being correct and complete. If the blueprint's `dataModel` misses a field, the compiler generates wrong code that the LLM can't fix (because the LLM doesn't touch structure).
- **Maintenance burden.** The compiler must be updated whenever the AIMEAT platform changes (new cortex component types, new extension APIs, new YAML manifest fields).

**Complexity:** Very high for the compiler. Low for the LLM prompts (much smaller and more focused).

**Key questions answered:**
1. Can an extension be designed WITHOUT knowing what app will use it? **Yes — the compiler generates the extension from the blueprint's action definitions, which are data-source-scoped.**
2. Can a cortex be designed knowing ONLY the extension's contract? **Yes — the compiler generates callExt wrappers from blueprint action declarations.**
3. Can an app be designed knowing ONLY the cortex's API? **Yes — the compiler generates the app from the cortex's exported method list.**
4. How do we verify contracts WITHOUT running an LLM? **The compiler IS the verification — code structurally conforms to the blueprint by construction.**
5. How do we prevent drift? **The compiler generates all structural code. The LLM can't drift on structure because it doesn't touch structure.**
6. Where does the calibrator add most value? **Extension action fill prompts (domain-specific API integration) and component render fill prompts (UI quality).**

---

## 4. Recommendation

### Recommended: Option A (Layered Pipeline with Deterministic Assembly)

**Why Option A:**

Option A is the pragmatic choice that addresses the core problems while being achievable with the existing codebase:

1. **Smallest delta from current system.** Most infrastructure already exists — the foundry's pass system, validation, probing, bundling, dashboard hooks. The main new work is deterministic assembly, the component generation layer, and fixing the probe-data-flow-forward problem.

2. **Addresses the real failures.** The foundry's post-mortem shows the problems are in execution (null probe data, LLM assembly, fragile parsing), not in the multi-pass concept itself. Option A fixes these specific execution failures.

3. **Introduces components incrementally.** The new "Component" phase (Phase 3) can be introduced alongside existing feature cortexes. Projects can use either model during migration.

4. **Budget-compatible.** Smaller, focused prompts work better with cheap models ($0.08-$0.30/M tokens). Option A's prompts are 2-6K each, well within the effective attention span of budget models.

5. **Preserves the prompt-driven workflow.** Users still copy prompts to their AI chat. The prompts are just smaller and more focused.

**Why not Option B:** The two-system architecture is elegant but overkill. It requires building an extension catalog, versioning system, selection UI, and two separate generation pipelines. The bootstrap problem (must create extensions before apps) adds friction. For most users who want to generate one service, Option A is faster.

**Why not Option C:** The blueprint compiler is the "right" solution architecturally, but the engineering investment is very high. Building a deterministic code generator that handles all AIMEAT component formats, edge cases, and platform integration patterns would take weeks. The maintenance burden (updating the compiler whenever the platform changes) is also significant. If Option A proves insufficient, Option C is the next step — but Option A should be tried first.

### What Option A must get right

These are non-negotiable requirements for Option A to succeed:

1. **Deterministic assembly for extensions.** No LLM. Template engine that combines validated skeleton YAML + unit function bodies into the final JS file. The template handles IIFE wrapping, `export default`, manifest metadata, and `ctx` parameter threading.

2. **Probe data flows forward.** Extension probe results MUST be passed to data cortex prompt. Data cortex probe results MUST be passed to component prompts. This is the foundry's #1 unfixed bug.

3. **Machine-validated contracts at every boundary.** Blueprint → extension skeleton (JSON Schema check of action signatures). Skeleton → assembled extension (field name comparison). Extension → data cortex (probe result shape validation). Data cortex → components (method signature check).

4. **Components as first-class building blocks.** The blueprint must learn to decompose features into reusable components (CompanyCard, WatchlistBadge, ChangeTimeline, SearchInput) that the app-domain cortex composes. This requires a new section in the blueprint prompt.

5. **Proper YAML parsing for skeleton extraction.** Replace `parseUnitFromSkeleton()` with a real YAML parser. Extract unit definitions structurally, not by line matching.

### Honest assessment of trade-offs

**What Option A sacrifices:**
- Extensions are still generated for a specific project (not truly independent platform capabilities). Option B would fix this.
- The blueprint is still LLM-generated and may have errors. Option C would fix this with a compiler.
- Assembly for cortex/app layers is still single-shot LLM (not deterministic). Acceptable because these are small components.

**What might require revisiting:**
- If the component decomposition in the blueprint proves too unreliable (AI struggles to identify reusable components), we may need to fall back to the feature-cortex-per-view model and accept that component reuse is a manual post-generation step.
- If cheap models can't produce quality components from 4-6K prompts, we may need to add a calibration step per component type.

---

## 5. Next Steps

### Validation before implementation

1. **Manual prototype of deterministic assembly.** Take a real foundry-generated extension (skeleton + units from the 2026-03-27 test) and write a template engine that assembles them mechanically. Verify the result matches the LLM-assembled version. This validates feasibility and identifies edge cases.

2. **Blueprint component decomposition test.** Give the current blueprint prompt a description that implies reusable components (e.g., "PRH company monitor with search, detail cards, watchlist badges, and change timeline"). Check if the AI can identify CompanyCard, WatchlistBadge, ChangeTimeline, and SearchInput as separate components rather than embedding them in feature cortexes.

3. **Probe-data-forward test.** Take the current foundry and fix the null probe data in unit pass dispatch. Run a pipeline test. Measure whether real probe data improves output quality vs null.

### Implementation order

If the prototype validates, implementation should proceed in this order:

1. **Fix the foundry's execution bugs** (deterministic assembly, probe data flow, YAML parsing) — this alone would substantially improve output quality.
2. **Unify generator and foundry** into a single system (eliminate the code duplication).
3. **Add the Component generation phase** to the blueprint and pipeline.
4. **Create per-type calibrator analysis templates** for the new focused prompts.
5. **Deprecate the old single-shot generator.**

### What NOT to build yet

- Extension catalog / versioning (Option B territory — not needed until multi-app reuse is a real use case)
- Blueprint compiler (Option C territory — try Option A first)
- Pipeline-aware calibration (nice-to-have, not blocking)
- Multi-project extension sharing (future work)
