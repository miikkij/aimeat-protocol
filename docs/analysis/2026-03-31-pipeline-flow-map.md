# Generator Pipeline Flow Map — Spec-Driven Architecture

**Date:** 2026-03-31
**Purpose:** Map every artifact in the generation pipeline — what creates it, what material it uses, where it flows downstream. Then redesign so each layer produces a **clean spec** that higher layers consume instead of raw code summaries.

---

## Part 1: The Flow Map

### Legend

```
[STEP]  = generation step (requires LLM or user)
{artifact}  = data artifact (JSON, YAML, code, spec)
──→  = "flows into" / "is used by"
```

### Full Pipeline Flow

```
USER INPUT: "PRH company monitor with search, watchlist, comparison, change tracking"
    │
    ▼
[1. INTERVIEW PROMPT]
    Uses: user description + AIMEAT_CONTEXT (2.6K)
    Creates: {interview-prompt} (~3K) — copy-paste to AI chat
    │
    ▼
USER ↔ AI CHAT: conversational interview, ~20 questions
    │
    ▼
{interview.json} — structured spec from the AI conversation
    │
    │  Contains:
    │  ├── useCases[]        — what the user wants to do
    │  ├── dataSources[]     — URLs, sample responses, response envelopes
    │  │   ├── .url          — "https://avoindata.prh.fi/opendata-ytj-api/v3/companies"
    │  │   ├── .sampleEntry  — actual JSON from the API (copy-pasted during interview)
    │  │   ├── .responseEnvelope — "{ totalResults, companies }"
    │  │   └── .notes        — "no path param lookup, use ?businessId= query"
    │  ├── dataModel.entities[]
    │  ├── views[]           — search, detail, watchlist, comparison, timeline
    │  ├── style             — mood, layout, typography
    │  ├── locale            — "fi"
    │  └── settings[]        — API keys, config values
    │
    ├──→ [2. BLUEPRINT]
    │
    ▼
[2. BLUEPRINT PROMPT]
    Uses: {interview.json} + AIMEAT_CONTEXT + blueprint format spec
    Creates: {blueprint-prompt} (~15-25K)
    │
    ▼
AI generates blueprint
    │
    ▼
{blueprint.json}
    │
    │  Contains:
    │  ├── components[]      — list of all components with id, type, label, produces, consumes
    │  ├── phases[]          — ordered generation phases
    │  ├── dataModel
    │  │   ├── .structures   — JSON Schema definitions ($ref-able)
    │  │   ├── .memoryKeys   — key → schema + source + producedBy + consumedBy
    │  │   └── .actions      — ext:/cortex: action contracts with input/output using $ref
    │  ├── settings          — service[] + user[] config keys
    │  └── testScenarios[]   — per-component test specs
    │
    ├──→ [3. CSM]
    ├──→ [4. MEMORY]
    ├──→ [5. TRANSLATION]
    ├──→ [6. EXTENSION]
    ├──→ [7. DATA CORTEX]
    ├──→ [8. COMPONENTS]
    ├──→ [9. APP-DOMAIN CORTEX]
    └──→ [10. APP]

═══════════════════════════════════════════════════════════════
PHASE 0: SERVICE FOUNDATION
═══════════════════════════════════════════════════════════════

[3. CSM]
    Uses: {blueprint.json}.dataModel (full)
    Creates: {csm.yaml} — data_schema (required/optional fields), consent, moderation
    Registered as: CSM in platform
    Downstream: used by nothing directly — defines the service's data contract

[4. MEMORY]
    Uses: {blueprint.json}.dataModel.memoryKeys (filtered by producedBy)
        + {interview.json}.dataSources[].staticData (if source=static)
    Creates: {memory.json} — key-value pairs with seed data, indexes, metadata
    Registered as: memory keys in OWNER namespace
    Downstream: extension reads via ctx.memory.getPublic(ctx.caller.gaii, key)
               cortex reads via AIMEAT.data.get(key)

[5a. TRANSLATION (locale 1, e.g., Finnish)]
    Uses: {blueprint.json}.dataModel (i18n keys)
        + {interview.json}.locale
    Creates: {translation-fi.json} — { "fi": { "app.title": "...", ... } }
    Registered as: i18n key in OWNER namespace (e.g., "i18n.fi" or "{service}.i18n.fi")
    Downstream: cortex reads via AIMEAT.data.get('i18n.fi')
               app reads via AIMEAT.data.get('i18n.fi')

[5b. TRANSLATION (locale 2, e.g., English)]
    Uses: {blueprint.json} + {translation-fi.json}.keys (MUST match exactly)
    Creates: {translation-en.json} — { "en": { ... } } with SAME keys as fi
    Downstream: same as above

═══════════════════════════════════════════════════════════════
PHASE 1: EXTENSION — the project-agnostic data capability
═══════════════════════════════════════════════════════════════

[6. EXTENSION]
    Uses: {blueprint.json}.dataModel.actions (filtered to this component)
        + {blueprint.json}.dataModel.structures (JSON schemas)
        + {blueprint.json}.dataModel.memoryKeys (filtered by producedBy/consumedBy)
        + {blueprint.json}.settings (→ config keys)
        + {blueprint.json}.components[].schedules
        + {interview.json}.dataSources[] (URLs, sample responses, notes)
        + AIMEAT_CONTEXT + SANDBOX_CONSTRAINTS + NAMESPACE_RULES
    Creates: {extension-code} — YAML manifest + JS action files
    Registered as: extension in platform → activated → @activate init runs
    │
    ▼
[6b. EXTENSION PROBE]
    Calls each action with test inputs, captures REAL responses
    Creates: {extension-probe-results[]}
        Each entry: { action, input, status, response }
        Example: { action: "searchCompanies", input: { query: "Overscale" },
                   status: 200, response: { totalResults: 1, companies: [...] } }
    │
    ├──→ [7. DATA CORTEX]
    │
    ▼
*** CURRENT GAP: No formal spec is produced here. ***
*** Only raw code + regex-extracted summaries (summarizeExtensionApi). ***
*** Downstream cortex gets: action paths, memory key names, rough data shapes. ***
*** Missing: exact return types, error cases, rate limits, data freshness. ***

═══════════════════════════════════════════════════════════════
PHASE 2: DATA CORTEX — the data access layer
═══════════════════════════════════════════════════════════════

[7. DATA CORTEX]
    Uses: {blueprint.json}.dataModel.structures
        + {extension-probe-results[]} — ACTUAL field names and response shapes
        + {extension-code} summary (regex-extracted: action paths, memory keys)
        + EXTENSION_CONSUMPTION_RULES
    Creates: {data-cortex-code} — IIFE with callExt wrappers + readExtMemory + readOwnerMemory
    Registered as: cortex in platform → activated
    │
    ▼
[7b. DATA CORTEX PROBE] (currently not done — should be)
    Would call each public method, capture return shapes
    Would create: {data-cortex-probe-results[]}
    │
    ├──→ [8. COMPONENTS]
    │
    ▼
*** CURRENT GAP: No spec produced. ***
*** Downstream gets: regex-extracted method names + exports list. ***
*** Missing: exact return types per method, error states, loading patterns. ***

═══════════════════════════════════════════════════════════════
PHASE 3: COMPONENTS (NEW — replaces feature cortexes)
═══════════════════════════════════════════════════════════════

[8. COMPONENTS] (one per reusable UI piece)
    Uses: {data-cortex-code} summary (method names, rough return types)
        + {extension-probe-results[]} (passed through from phase 1)
        + platform UI cortex catalog (Tabs, DataTable, Timeline, Forms, etc.)
        + {blueprint.json} view definitions
        + {translation keys} from registered translations
    Creates: {component-code[]} — each a standalone cortex IIFE
             CompanyCard, WatchlistBadge, SearchInput, ChangeTimeline, etc.
    Each registered as: cortex in platform
    │
    ├──→ [9. APP-DOMAIN CORTEX]
    │
    ▼
*** CURRENT GAP: No component specs produced. ***
*** App-domain cortex gets: cortex names + regex-extracted exports. ***
*** Missing: props interface, events, usage example. ***

═══════════════════════════════════════════════════════════════
PHASE 4: APP-DOMAIN CORTEX — business logic + composition
═══════════════════════════════════════════════════════════════

[9. APP-DOMAIN CORTEX]
    Uses: {component registrations} — names + exported methods
        + {data-cortex-code} summary
        + {translation keys}
        + {interview.json}.useCases
        + {blueprint.json} view/navigation structure
    Creates: {app-domain-cortex-code} — composes components, manages nav/auth/i18n
    Registered as: cortex in platform
    │
    ▼
*** CURRENT GAP: summarizeCortexApiForApp() regex-extracts method names. ***
*** App gets: method list + rough param/return types. ***

═══════════════════════════════════════════════════════════════
PHASE 5: APP — thin shell
═══════════════════════════════════════════════════════════════

[10. APP]
    Uses: {app-domain-cortex-code} summary (method names, return types)
        + {translation keys} (from registered translations)
        + {interview.json}.style (mood, layout)
        + platform UI cortex script paths
        + auth boot pattern
    Creates: {app.html} — thin shell with script loads, CSS theming, auth container
    Registered as: app in catalog → launched

═══════════════════════════════════════════════════════════════
```

---

## Part 2: The Problem — No Specs, Only Code Summaries

Looking at the flow map, every "downstream" connection currently works like this:

```
EXTENSION CODE (20K chars of YAML+JS)
    │
    ▼
summarizeExtensionApi() — REGEX extraction from raw code
    │  Extracts: action paths, input property names, memory key names
    │  Misses: exact return types, error responses, data freshness, rate limits
    │
    ▼
DATA CORTEX PROMPT — gets a rough summary, not a formal spec
```

And then:

```
DATA CORTEX CODE (5K chars of IIFE)
    │
    ▼
summarizeCortexApi() — REGEX extraction from raw code
    │  Extracts: method names, LIB_NAME, extension names it wraps
    │  Misses: return types, error handling, async patterns
    │
    ▼
COMPONENT / APP-DOMAIN PROMPT — gets a rough summary
```

**The fundamental problem:** Higher layers receive degraded, lossy summaries of lower layers. Every regex extraction loses information. The `data.results` vs `data.companies` bug happens because the extension code uses `companies` but the regex summary doesn't capture the field name precisely enough for the cortex to know.

**The probe results partially fix this** — they contain ACTUAL return shapes. But probes only exist for extensions, not for cortex methods. And the probe data is a raw JSON dump, not a structured spec document.

---

## Part 3: The Redesigned Architecture — Specs Flow Upward

### Core principle: Each layer produces a SPEC, not just code

```
                     WHAT FLOWS UP
                     ═════════════

         ┌─────────────────────────────────────────┐
         │  APP (thin shell)                        │
         │  Uses: {app-domain-spec}                 │
         │  + style + auth pattern                  │
         │  Prompt: ~3K (smallest — spec is clear)  │
         └────────────────────▲────────────────────┘
                              │
                    {app-domain-spec}
                    Methods: init(), render(), t(), switchLocale()
                    Return types, events, nav structure
                              │
         ┌────────────────────┴────────────────────┐
         │  APP-DOMAIN CORTEX                       │
         │  Uses: {component-specs[]}               │
         │  + {data-api-spec} + use cases           │
         │  + translation keys                      │
         │  Prompt: ~5K                             │
         └────────────────────▲────────────────────┘
                              │
                    {component-specs[]}
                    Each: name, render(container, props), props interface,
                    events emitted, usage example
                              │
         ┌────────────────────┴────────────────────┐
         │  COMPONENTS (reusable UI pieces)         │
         │  Uses: {data-api-spec}                   │
         │  + platform UI cortex catalog            │
         │  + translation keys                      │
         │  Prompt: ~5K per component               │
         └────────────────────▲────────────────────┘
                              │
                    {data-api-spec}
                    Methods with EXACT signatures:
                      searchCompanies(query) → { totalResults: number,
                        companies: Array<{ name, businessId, companyForm }> }
                      getDetails(businessId) → { ... exact fields ... }
                    Error handling: returns null on failure
                    Data freshness: cached 15 min
                              │
         ┌────────────────────┴────────────────────┐
         │  DATA CORTEX                             │
         │  Uses: {extension-spec}                  │
         │  + blueprint structures                  │
         │  Prompt: ~5K                             │
         └────────────────────▲────────────────────┘
                              │
                    {extension-spec}
                    Actions with EXACT contracts:
                      POST /v1/ext/prh-ytj/searchCompanies
                        Input: { query: string }
                        Output: { totalResults: number, companies: [...] }
                        (with real example from probe)
                    Memory keys:
                      ext:prh-ytj/watchlist.items → Array<{ businessId, addedAt }>
                    Scheduled jobs:
                      @activate: init, */15: collect
                    Config keys: api_url
                              │
         ┌────────────────────┴────────────────────┐
         │  EXTENSION                               │
         │  Uses: data source URL + sample response │
         │  + action list + SANDBOX_CONSTRAINTS     │
         │  Knows NOTHING about cortex/app/project  │
         │  Prompt: ~3-4K per action                │
         └─────────────────────────────────────────┘
```

### What changes: SPECS are first-class artifacts

**After each layer registers and is probed, a SPEC is generated.** Not by regex extraction from code — by structured output from the LLM during generation, validated by probes.

### Spec formats

**{extension-spec}** — produced AFTER extension registration + probe:
```json
{
  "name": "prh-ytj",
  "description": "Finnish Patent and Registration Office company data",
  "actions": [
    {
      "id": "searchCompanies",
      "method": "POST",
      "path": "/v1/ext/prh-ytj/searchCompanies",
      "input": { "query": "string (company name or business ID)" },
      "output": {
        "totalResults": "number",
        "companies": "Array<{ name: string, businessId: string, companyForm: string, registrationDate: string }>"
      },
      "example": {
        "input": { "query": "Overscale" },
        "output": { "totalResults": 1, "companies": [{ "name": "Overscale Solutions Oy", "businessId": "3323553-5", "companyForm": "Osakeyhtiö", "registrationDate": "2020-12-01" }] }
      },
      "errors": "Returns { error: 'message' } on API failure"
    },
    {
      "id": "getDetails",
      "...": "..."
    }
  ],
  "memoryKeys": [
    { "key": "watchlist.items", "type": "Array<{ businessId: string, addedAt: string }>", "readBy": "anyone via getPublic" },
    { "key": "cache.{businessId}", "type": "{ data: CompanyDetail, fetchedAt: string }", "ttl": "15 min" }
  ],
  "schedules": [
    { "id": "init", "cron": "@activate", "description": "Initialize watchlist if empty" },
    { "id": "check-changes", "cron": "0 6 * * *", "description": "Check watchlisted companies for changes" }
  ],
  "config": {
    "api_url": "string — PRH API base URL"
  },
  "usage": {
    "callPattern": "POST /v1/ext/prh-ytj/{actionId} with JSON body",
    "authRequired": true,
    "readMemory": "GET /v1/memory/ext%3Aprh-ytj/{key} (public, no auth)"
  }
}
```

**{data-api-spec}** — produced AFTER data cortex registration + probe:
```json
{
  "name": "prh-data",
  "libName": "prhData",
  "access": "AIMEAT.prhData.{method}()",
  "methods": [
    {
      "name": "searchCompanies",
      "params": "query: string",
      "returns": "Promise<{ totalResults: number, companies: Array<{ name, businessId, companyForm, registrationDate }> } | null>",
      "example": "const result = await AIMEAT.prhData.searchCompanies('Overscale');\n// result.companies[0].name === 'Overscale Solutions Oy'",
      "errorBehavior": "Returns null on failure, logs warning to console"
    },
    {
      "name": "getDetails",
      "params": "businessId: string",
      "returns": "Promise<CompanyDetail | null>",
      "example": "const detail = await AIMEAT.prhData.getDetails('3323553-5');"
    },
    {
      "name": "getWatchlist",
      "params": "none",
      "returns": "Promise<Array<{ businessId, addedAt }>>",
      "example": "const items = await AIMEAT.prhData.getWatchlist();"
    }
  ],
  "translationAccess": "AIMEAT.prhData.getTranslations(locale) → i18n object",
  "settingsAccess": "AIMEAT.prhData.getSettings() → settings object"
}
```

**{component-spec}** — produced per component:
```json
{
  "name": "company-card",
  "libName": "companyCard",
  "purpose": "Renders a single company summary as a styled card",
  "render": {
    "signature": "AIMEAT.companyCard.render(container, props)",
    "props": {
      "company": "{ name: string, businessId: string, companyForm: string, registrationDate?: string }",
      "locale": "string — 'fi' | 'en'",
      "translations": "object — i18n strings",
      "onSelect": "function(businessId) — called when user clicks the card",
      "onAddToWatchlist": "function(businessId) — called when user clicks watchlist button"
    },
    "returns": "{ el: HTMLElement, destroy(): void, update(props): void }"
  },
  "example": "const card = AIMEAT.companyCard.render(container, {\n  company: { name: 'Oy', businessId: '123-4' },\n  locale: 'fi', translations: fiStrings,\n  onSelect: (id) => showDetail(id)\n});"
}
```

**{app-domain-spec}** — produced after app-domain cortex registration:
```json
{
  "name": "prh-app-domain",
  "libName": "prhApp",
  "access": "AIMEAT.prhApp",
  "methods": {
    "init": "async () → { session, translations, settings } — call on app boot after auth",
    "render": "(container: HTMLElement) → void — renders the full app UI",
    "t": "(key: string) → string — translate using current locale",
    "switchLocale": "(locale: string) → void — switch language, re-renders"
  },
  "views": ["search", "detail", "watchlist", "comparison", "timeline"],
  "navigation": "Sidebar with icons, managed by app-domain cortex",
  "scriptDependencies": [
    "/v1/cortex/aimeat-ui-nav/libs/aimeat-ui-nav.js",
    "/v1/cortex/aimeat-ui-viewers/libs/aimeat-ui-viewers.js",
    "/v1/cortex/prh-data/libs/prh-data.js",
    "/v1/cortex/company-card/libs/company-card.js",
    "/v1/cortex/watchlist-badge/libs/watchlist-badge.js",
    "/v1/cortex/prh-app-domain/libs/prh-app-domain.js"
  ],
  "example": "await AIMEAT.prhApp.init();\nAIMEAT.prhApp.render(document.getElementById('app'));"
}
```

---

## Part 4: Simulation — PRH Yritysseuranta Through Spec-Driven Pipeline

### Step 1: Interview → {interview.json}
User describes: "Finnish company data monitor with search, details, watchlist, change tracking"
AI interviews about data sources, captures PRH API URL + sample response + response envelope.

### Step 2: Blueprint → {blueprint.json}
Uses {interview.json}. Produces component list with produces/consumes, dataModel with structures, and **component decomposition into reusable pieces**:

Components identified:
- `csm-1`: Service schema
- `memory-1`: Seed data (lookup tables if any)
- `translation-fi`: Finnish strings
- `translation-en`: English strings
- `ext-1`: PRH data extension (searchCompanies, getDetails, addToWatchlist, removeFromWatchlist, getWatchlist, getChanges)
- `cortex-data`: Data access layer wrapping ext-1
- `component-company-card`: Renders one company as a card
- `component-watchlist-badge`: Shows watchlist status indicator
- `component-change-timeline`: Renders change history as timeline
- `component-search-input`: Search box with autocomplete
- `component-company-comparison`: Side-by-side comparison table
- `cortex-app-domain`: Composes all components + navigation + business rules
- `app-1`: Thin HTML shell

### Step 3: Phase 0 — CSM + Memory + Translation
**Small, single-shot, same as today.** These templates work fine.

Generated artifacts:
- {csm.yaml} → registered
- {memory.json} → stored in owner namespace
- {translation-fi.json} with 45 keys → stored in owner namespace
- {translation-en.json} matching same 45 keys → stored in owner namespace

### Step 4: Phase 1 — Extension
**Extension prompt knows NOTHING about the project.** It receives:
- Data source: `https://avoindata.prh.fi/opendata-ytj-api/v3/companies`
- Sample response (from interview)
- Action list: searchCompanies, getDetails, addToWatchlist, removeFromWatchlist, getWatchlist, getChanges
- Config keys: api_url
- Schedules: @activate init, daily change check
- SANDBOX_CONSTRAINTS

**The prompt does NOT mention:**
- ~~"This is for a company monitoring app"~~
- ~~"The search view will show..."~~
- ~~"The cortex will wrap this into..."~~

The extension is a **platform capability**: "PRH company data provider — search, detail, watchlist management, change detection."

After registration + probe:

**NEW: LLM generates {extension-spec} as part of the output.** The extension prompt asks for TWO outputs:
1. The extension code (YAML + JS) — same as today
2. An `extension-spec.json` — structured description of what the extension provides

The spec is validated against probe results: do the declared return types match what the probe actually returned? If not, fail and retry.

### Step 5: Phase 2 — Data Cortex
**Uses ONLY {extension-spec} — never sees extension code.**

The prompt is ~5K and says:
- "Here is the extension spec. Wrap each action into a clean async method."
- "Here are the memory keys the extension writes. Create read methods for them."
- "Add translation access via AIMEAT.data.get('i18n.{locale}')"
- "Add settings access via AIMEAT.data.get('settings.config')"

After registration (+ probe if we add cortex probing):

**NEW: LLM generates {data-api-spec} as part of the output.** Validated against the extension-spec (all actions wrapped?) and any probe results.

### Step 6: Phase 3 — Components
**Uses ONLY {data-api-spec} — never sees extension-spec or extension code.**

Each component gets a focused prompt (~5K):
- "Create a CompanyCard component. Here is the data API spec — you'll call `AIMEAT.prhData.getDetails(id)` which returns `{ name, businessId, companyForm, ... }`."
- "Here are the available platform UI cortexes (Tabs, DataTable, etc.)"
- "Here are the translation keys"

Each component produces a {component-spec} alongside its code.

**Key insight: by this point, the prompts are SMALL because the specs are PRECISE.** The component doesn't need to know about PRH APIs, V8 sandboxes, memory namespaces, or extension internals. It knows: "call this method, get this shape, render this UI."

### Step 7: Phase 4 — App-Domain Cortex
**Uses: {component-specs[]} + {data-api-spec} + use cases + translation keys.**

The prompt says:
- "Compose these components into views. Here is each component's render(container, props) interface."
- "Here are the use cases from the interview: search, watchlist management, comparison, change tracking."
- "Manage navigation between views. Enforce business rules."

Produces: {app-domain-spec} alongside its code.

### Step 8: Phase 5 — App
**Uses ONLY {app-domain-spec}.**

The prompt is the SMALLEST in the entire pipeline (~3K):
- "Load these scripts in this order: [list from spec]"
- "Call AIMEAT.prhApp.init() after auth"
- "Call AIMEAT.prhApp.render(container)"
- "Style with CSS custom properties (mood: professional, layout: sidebar)"

**The app prompt doesn't need to know about extensions, memory, data sources, or component internals.** It only knows the app-domain cortex's 4 public methods.

---

## Part 5: Why This Works — The Spec Pyramid

```
                    APP
                 PROMPT: ~3K
              USES: 1 spec (app-domain-spec)
             ╱                              ╲
        APP-DOMAIN CORTEX
        PROMPT: ~5K
        USES: N component-specs + 1 data-api-spec + use cases
       ╱                                              ╲
   COMPONENTS (N)                              DATA CORTEX
   PROMPT: ~5K each                            PROMPT: ~5K
   USES: 1 data-api-spec                       USES: 1 extension-spec
   + platform UI catalog
  ╱                                                    ╲
                        EXTENSION
                        PROMPT: ~3-4K per action
                        USES: data source + sample response
                        + SANDBOX_CONSTRAINTS
                        KNOWS: NOTHING about anything above
```

**The pyramid effect:**
- At the bottom (extension), prompts are medium-sized but completely self-contained. The extension knows only about its data source.
- In the middle (data cortex, components), prompts use clean specs from below. No raw code, no regex extraction.
- At the top (app-domain, app), prompts are the SMALLEST because everything below is fully specified. The app-domain cortex knows: "I have these components with these interfaces, compose them for these use cases."

**Versus the current approach:**
- Current: every prompt tries to carry the FULL context (20-35K). Rules repeated in box drawings because the AI keeps violating them.
- New: each prompt carries ONLY its layer's spec. Extension spec is ~50 lines of JSON. Data API spec is ~30 lines. Component spec is ~15 lines. No need to repeat sandbox rules in the app prompt.

---

## Part 6: What Material Each Prompt Uses (Summary Table)

| Step | Prompt Size | Material IN | Artifact OUT | Spec OUT |
|------|------------|-------------|-------------|----------|
| Interview | ~3K | user description | {interview.json} | — |
| Blueprint | ~15K | {interview.json} | {blueprint.json} | — |
| CSM | ~2K | {blueprint.json}.dataModel | {csm.yaml} | — |
| Memory | ~2K | {blueprint.json}.memoryKeys + static data | {memory.json} | — |
| Translation×2 | ~2K | {blueprint.json} + previous locale keys | {translation.json} | — |
| Extension skeleton | ~4K | data source + sample + action list | {skeleton.yaml} | — |
| Extension unit ×N | ~3K | {skeleton.yaml} + data source | {unit-code.js} ×N | — |
| Extension assembly | **deterministic** | {skeleton.yaml} + units | {extension-code} | — |
| Extension spec | **from probe** | {extension-code} + {probe-results} | — | **{extension-spec}** |
| Data cortex | ~5K | **{extension-spec}** | {data-cortex-code} | **{data-api-spec}** |
| Component ×M | ~5K | **{data-api-spec}** + UI catalog | {component-code} ×M | **{component-spec}** ×M |
| App-domain cortex | ~5K | **{component-specs[]}** + **{data-api-spec}** + use cases | {app-domain-code} | **{app-domain-spec}** |
| App | ~3K | **{app-domain-spec}** + style | {app.html} | — |

**Total LLM prompts for a typical project (6 actions, 5 components):**
- Interview: 1
- Blueprint: 1
- Foundation (CSM + memory + 2 translations): 4
- Extension (skeleton + 6 units): 7 (assembly is deterministic)
- Data cortex: 1
- Components: 5
- App-domain cortex: 1
- App: 1
- **Total: ~21 LLM calls, average ~4K each**

Compare to current: 11 components × 1 mega-prompt each (20-35K) = 11 calls but much larger and less reliable.

---

## Part 7: How Specs Prevent the Known Failures

| Known Failure | How Specs Fix It |
|---------------|-----------------|
| `data.results` vs `data.companies` | Extension-spec includes exact field names from probe. Data cortex prompt uses spec, not guess. |
| Translation namespace confusion | Data-api-spec documents: `getTranslations(locale)` reads from owner namespace. Component just calls the method. |
| JSON.parse on memory values | Only extension prompt needs SANDBOX_CONSTRAINTS. Higher layers never touch raw memory. |
| Assembly modifying code | Assembly is deterministic. Specs are validated against probes. |
| App calling extensions directly | App-domain-spec lists only public methods. App never sees extension details. |
| Quality gap (bare-minimum output) | Components get precise specs with examples. "Render a company card with name, businessId, companyForm, registrationDate, colored status badge" — not "render some data". |
| Prompt attention span overflow | Largest prompt is ~5K. No 35K monsters. |

---

## Part 8: Open Questions

1. **Who generates the spec — the LLM during code generation, or a separate post-generation step?**
   - Option A: LLM generates code + spec together (risk: spec may not match code)
   - Option B: Code is generated first, then probed, then spec is generated from probe results + code analysis (more reliable but adds a step)
   - Option C: Spec is generated first (before code), then code is generated to match the spec, then probe validates (closest to contract-first)
   - **Recommendation: Option C for extensions (spec first → code → probe validates). Option B for cortexes (code → probe → spec). Rationale: extension contracts are critical and must be precise. Cortex contracts are simpler and can be derived from working code.**

2. **How do we handle spec-code drift?**
   - After any code change (fix, retry), re-generate the spec from probes. Never trust a stale spec.
   - Validation: spec declares `searchCompanies returns { totalResults, companies }`. Probe confirms this. If probe returns `{ total, results }` instead, the spec is regenerated to match reality.

3. **Where are specs stored?**
   - As part of the project's component data (alongside the code and probe results)
   - Could also be registered as a platform artifact (e.g., extension spec published to a catalog)

4. **Does the calibrator calibrate specs too?**
   - Not directly — specs are derived from probes (ground truth). But the calibrator can calibrate the prompts that GENERATE code which PRODUCES better specs.
