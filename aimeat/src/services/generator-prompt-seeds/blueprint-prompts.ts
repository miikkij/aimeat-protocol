/**
 * @file blueprint-prompts.ts
 * @description App spec, app test, blueprint generator, and interview conductor prompts.
 *   Extracted verbatim from generator-prompt-seeds.ts — content is calibrated, DO NOT edit values.
 *   Variables use {{name}} syntax, resolved by resolvers.ts at runtime.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from generator-prompt-seeds.ts (pure extraction, no logic change)
 */

import type { PromptSeedEntry } from '../prompt-defaults.js';

export const BLUEPRINT_PROMPT_SEEDS: PromptSeedEntry[] = [
  // ── App spec prompt ──

  {
    id: 'gen-app-spec',
    group: 'generator',
    name: 'App Spec Generator',
    description: 'Generates app spec — defines app shell, dependencies, theme, locale.',
    content: `{{disclaimer}}

# Task: Generate App Spec

Define the configuration for an AIMEAT App (HTML page).

## App: {{component_label}}
{{project_description}}

## Available Cortex Libraries
{{cortex_dependencies}}

## Output Format
Return ONLY valid JSON:
{
  "name": "<kebab-case app name>",
  "title": "<human-readable title>",
  "description": "<one-line description>",
  "appDomainLib": "<camelCase JS lib name of the app-domain cortex — copy EXACTLY from the list above>",
  "cortexDependencies": ["<ordered list of cortex registeredAs names to load via script tags>"],
  "daisyTheme": "<light | dark | cupcake | business | forest | etc.>",
  "locale": "<default locale: fi | en | etc.>"
}

## Rules
1. name MUST be ASCII kebab-case.
2. appDomainLib: find the app-domain cortex in the list above, copy its JS lib name EXACTLY.
3. cortexDependencies: list ALL cortex registeredAs names. Order: data first, components, app-domain last.
4. daisyTheme: pick a daisyUI theme. "light" is safe default.`,
    variables: ['disclaimer', 'component_label', 'project_description', 'cortex_dependencies'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  // ── App test prompt ──

  {
    id: 'gen-test-app',
    group: 'generator',
    name: 'App Test (HTML page)',
    description: 'Browser-side test for generated HTML apps — tests page loads, auth works, UI renders.',
    content: `{{disclaimer}}You are generating TEST CODE for an AIMEAT APP (HTML page).

## App Under Test
- Label: {{component_label}}
- Type: app (HTML page)

{{project_context}}

## Test Environment: Browser (page.evaluate sandbox)

The app HTML page is loaded in a browser. All cortex libraries are available.
Authentication IS available — the user is logged in.

## Working Test Template

\\\`\\\`\\\`javascript
{{test_template}}
\\\`\\\`\\\`

Keep the template AS-IS. Do NOT add checks for individual components (hakukentta, yrityskortti, etc.) — those have their own tests. This test ONLY verifies that the app shell loads and renders.

## Output Rules
1. Return ONLY executable JavaScript code — NO markdown fences
2. NO import/require/export — sandbox environment
3. Do NOT test individual component rendering — only test init(), render(), and overall DOM output
4. Set window.__testResults as the LAST statement`,
    variables: ['disclaimer', 'component_label', 'project_context', 'test_template'],
    usedIn: ['generator-autopilot'],
  },

  // ── Blueprint & Interview prompts (migrated from browser JS) ──

  {
    id: 'gen-blueprint',
    group: 'generator',
    name: 'Blueprint Generator',
    description: 'Generates component blueprint from project description + interview spec.',
    content: `{{disclaimer}}{{context}}

The user wants to create this service:
---
{{description}}
---
{{interview_spec_section}}{{language_note}}{{cortex_catalog}}
Analyze this request and produce a JSON blueprint listing ALL components needed.

CRITICAL: Return ONLY a JSON object with "service_slug", "architecture", "components", "phases", "dataModel", and optionally "settings" and "testScenarios". Nothing else.
"service_slug" is a kebab-case identifier for this service (e.g., "company-registry", "weather-monitor"). ALL components use this SAME slug for memory keys, translation keys, and cortex naming. Derive it from the project name.
Each component has these fields: "id", "type", "label", "produces", "consumes". Extension components may also have "schedules".
Do NOT include manifest content, code, HTML, translations, or any implementation details.
The blueprint is a lightweight plan — actual content is generated later per component.

Format:
{
  "service_slug": "my-service",
  "architecture": "cortex-modular",
  "components": [
    { "id": "csm-1", "type": "csm", "label": "Human-readable name", "produces": ["memory:service.schema"], "consumes": [] },
    { "id": "memory-1", "type": "memory", "label": "Human-readable name", "produces": ["memory:settings.config"], "consumes": [] },
    { "id": "translation-1", "type": "translation", "label": "Human-readable name (fi)", "produces": ["memory:i18n.fi"], "consumes": [] },
    { "id": "translation-2", "type": "translation", "label": "Human-readable name (en)", "produces": ["memory:i18n.en"], "consumes": [] },
    { "id": "ext-1", "type": "extension", "label": "Human-readable name", "produces": ["memory:items.*"], "consumes": ["memory:settings.config"], "schedules": [{"action":"init","cron":"@activate"},{"action":"collect","cron":"0 2 * * *"}] },
    { "id": "cortex-data", "type": "cortex", "subtype": "data", "label": "Data layer", "produces": ["api:getData", "api:search", "api:addItem", "api:removeItem"], "consumes": ["memory:items.*", "memory:settings.config"], "uses": [] },
    { "id": "component-item-card", "type": "cortex", "subtype": "component", "label": "Item Card", "produces": ["ui:item-card"], "consumes": ["api:getData"], "uses": ["aimeat-ui-viewers"] },
    { "id": "component-search-input", "type": "cortex", "subtype": "component", "label": "Search Input", "produces": ["ui:search-input"], "consumes": ["api:search"], "uses": ["aimeat-ui-forms"] },
    { "id": "cortex-app", "type": "cortex", "subtype": "app-domain", "label": "App domain", "produces": ["api:init", "api:render"], "consumes": ["ui:item-card", "ui:search-input"], "uses": ["aimeat-ui-nav"] },
    { "id": "app-1", "type": "app", "label": "Human-readable name", "produces": [], "consumes": ["api:init", "api:render"] }
  ],
  "phases": [
    { "id": "define", "label": "Define Service", "componentIds": ["csm-1"] },
    { "id": "seed", "label": "Seed Data", "componentIds": ["memory-1", "translation-1", "translation-2"] },
    { "id": "logic", "label": "Capabilities", "componentIds": ["ext-1"] },
    { "id": "cortex-data", "label": "Data Layer", "componentIds": ["cortex-data"] },
    { "id": "components", "label": "UI Components", "componentIds": ["component-item-card", "component-search-input"] },
    { "id": "cortex-app", "label": "App Domain", "componentIds": ["cortex-app"] },
    { "id": "ui", "label": "Application", "componentIds": ["app-1"] }
  ],
  "dataModel": {
    "structures": {
      "Item": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "title": { "type": "string" },
          "status": { "type": "string" },
          "createdAt": { "type": "string", "description": "ISO 8601" }
        }
      },
      "SearchResult": {
        "type": "object",
        "properties": {
          "totalResults": { "type": "number" },
          "items": { "type": "array", "items": { "$ref": "Item" } }
        }
      }
    },
    "memoryKeys": {
      "settings.config": {
        "type": "object",
        "properties": { "locale": { "type": "string" }, "refreshHours": { "type": "number" } },
        "source": "config",
        "producedBy": "memory-1",
        "consumedBy": ["ext-1", "cortex-data"]
      },
      "items.data": {
        "type": "array",
        "items": { "$ref": "Item" },
        "source": "external",
        "producedBy": "ext-1",
        "consumedBy": ["cortex-data"]
      }
    },
    "actions": {
      "ext:search": { "input": { "query": { "type": "string" } }, "output": { "$ref": "SearchResult" } },
      "ext:getItem": { "input": { "id": { "type": "string" } }, "output": { "$ref": "Item" } },
      "ext:addItem": { "input": { "id": { "type": "string" }, "name": { "type": "string" } }, "output": { "$ref": "Item" } },
      "ext:removeItem": { "input": { "id": { "type": "string" } }, "output": { "type": "boolean" } },
      "cortex:search": { "input": { "query": { "type": "string" } }, "output": { "$ref": "SearchResult" } },
      "cortex:getItem": { "input": { "id": { "type": "string" } }, "output": { "$ref": "Item" } },
      "cortex:addItem": { "input": { "id": { "type": "string" }, "name": { "type": "string" } }, "output": { "$ref": "Item" } },
      "cortex:removeItem": { "input": { "id": { "type": "string" } }, "output": { "type": "boolean" } }
    }
  }
}

CRITICAL RULES for the data model:
- Build "structures" from the interview's sampleEntry data — these are the REAL shapes from the verified API response.
- Every memory key and every action input/output MUST use "$ref" to reference a structure. This prevents data shape drift between components.
- Every "$ref" value MUST match a key in the "structures" object.
- Extension actions and cortex actions that pass through the same data MUST reference the SAME structure.

NOTE: The example above uses GENERIC placeholder names. Replace with domain-specific names from YOUR project. Do NOT copy these placeholder names.

Rules:
- Component types: csm, msm, extension, app, memory, translation, cortex
- IDs use format: {type}-{number} (e.g., csm-1, ext-1, app-1). ID prefixes can be short (ext-1) but the "type" field MUST be the full name: "extension" (not "ext").
- Each component object has these fields: "id", "type", "label", "produces", "consumes"
- Extension components may also have "schedules": array of { "action": "actionId", "cron": "cron-expression" }
- Valid cron values: standard 5-field cron syntax OR the special value "@activate"
- CRITICAL: cron expressions MUST have exactly 5 fields separated by spaces.
  CORRECT examples (copy these exactly):
    "0 2 * * *"       ← every day at 02:00
    "*/15 * * * *"    ← every 15 minutes (note: ASTERISK-SLASH-15, not just /15)
    "10 2 * * *"      ← every day at 02:10
  WRONG: "/15 * * * *" (missing leading asterisk), "0 2 * *" (only 4 fields)
  Every asterisk character (*) is REQUIRED — do NOT omit them.
- "@activate" means: runs on extension activation AND on every server restart. Use for init/bootstrap jobs that populate initial data, verify data integrity, or recover from missed scheduled runs. These MUST be idempotent (safe to run repeatedly).
- Use "schedules" for any work that must happen automatically without a browser (data collection, nightly aggregation, periodic computation)
- If an extension collects or computes data, it SHOULD have an "@activate" init job that checks for stale/missing data and populates it — this solves the cold-start problem (empty data after first install or server restart)
- If an extension has NO scheduled actions, omit the "schedules" field entirely
- "produces": array of data outputs (format: "memory:namespace.*" for memory, "api:methodName" for cortex/app)
- "consumes": array of data inputs this component reads from
- Group components into logical phases
- Include ALL components needed for a complete, working service
- Cortex components are layered: data cortex phase → feature cortex phase → app-domain cortex phase → app phase
- Data cortex: ALL data operations (reads AND writes), wraps extension + AIMEAT platform libraries. Every extension action must have a corresponding cortex api: method — the data cortex is the ONLY gateway, UI components never call the extension directly
- Feature cortex: self-contained data+UI per use case, uses data cortex + platform UI cortex libraries
- App-domain cortex: composes all features + auth + translations, entry point for app
- ALWAYS create at least 3 cortex components: one data, one or more feature, one app-domain
- Only include what's actually needed — don't pad with unnecessary components
- TRANSLATIONS: Create ONE translation component PER locale. If the spec has locales ["fi", "en"], create translation-1 for fi AND translation-2 for en. NEVER combine multiple locales into one component.
- MSM: Only create an MSM if the external API requires authentication, API keys, or complex endpoint configuration. Public URLs (RSS feeds, open APIs, open data) do NOT need an MSM — extensions fetch them directly with ctx.fetch().
- MEMORY: Create memory components for (a) static/seed data provided by the user (lookup tables, reference datasets) and (b) default settings/configuration that the service needs on first run. Pre-populating defaults in memory means the app works immediately without hardcoded fallbacks.
- MEMORY KEY NAMING: Use consistent namespace prefixes. Standard conventions: "settings.config" for config, "i18n.{locale}" for translations, descriptive namespace for domain data (e.g., "orders.by-date.*", "stats.daily.*", "scores.by-date.*"). Use dot-separated namespaces, not nested objects.
- CORTEX: Cortex is the application's brain. It handles data access, UI rendering, business logic, and composition. It can use AIMEAT platform libraries (data, storage, social, wallet) directly. It can render UI components (like aimeat-charts renders charts). Apps use cortex for everything.

## dataModel — Domain Data Model (REQUIRED)

The dataModel is a JSON Schema based map of EVERY memory key in the project. It is the single source of truth — all components reference it to know exact data shapes.

Rules for dataModel:
- One entry per memory key pattern (use YYYY-MM-DD for date-bucketed keys)
- Each entry uses JSON Schema (draft 2020-12): type, properties, items, enum, description
- "source": one of "static" (user-provided data), "external" (fetched from API/feed), "computed" (calculated by extension), "config" (default settings)
- "producedBy": exactly ONE component ID that writes this key
- "consumedBy": array of component IDs that read this key
- Every memory key referenced in produces/consumes MUST have a dataModel entry
- Prefer fewer, larger keys. A lookup table or dataset should be ONE key (array/object), not split per entry.
- Include i18n keys (i18n.fi, i18n.en) with source "static" and translation component as producer
- CRITICAL: If the interview provides static data in a specific format (e.g., array of {key, value} pairs), the dataModel schema MUST match that exact format. Do NOT redesign the data shape — the memory component will store it as-is.
- Enum values: use consistent naming across all components. For computed enums (trends, levels, statuses), use lowercase English: "rising"/"falling"/"steady" for trends, "low"/"medium"/"high"/"critical" for levels. If source data uses locale-specific values, keep those as-is in storage — do NOT translate them. Store what the source provides.
- Field names inside stored objects MUST use English camelCase (e.g., "itemCount", "categoryBreakdown", "statusSplit"). This applies even if the source data uses different naming.

## Data Pipeline Verification (do this BEFORE listing components)

### Step 1: Trace RENDER paths (what data does each view display?)
For each VIEW in the spec:
1. What fields does this view need to render?
2. Where does each field come from? (external source, computed, user input)
3. Does the source provide this field directly, or does a component need to transform/enrich it?
4. If a field has no clear path from source to view, add a component that produces it.

### Step 2: Trace USER ACTION paths (what can the user DO?)
For each USE CASE in the spec:
1. What actions can the user take? (add, remove, save, update, delete, submit)
2. For each action, trace the full path: UI component → cortex-data → extension action
3. Does cortex-data produce an api: method for this action? If not, add it.
4. Does the UI component consume that api: method? If not, add it to consumes.
5. If an extension has a write action but no cortex api: method exposes it, the user cannot reach it — this is a gap.

Both reads AND writes must have complete paths from UI to extension. If a use case says "add item to list", there must be an api:addItem in cortex-data AND the relevant UI component must consume it.

## Component Dependencies

Each component MUST declare what it produces and consumes:
- Extensions produce memory keys (e.g., "memory:items.by-date.*")
- Cortex libraries produce API methods (e.g., "api:getItems") and consume memory keys
- Apps consume API methods or memory keys
- Every "consumes" entry must be matched by a "produces" entry in another component

## CRITICAL: Extension vs Cortex vs App — Decision Framework

### The One Rule: EXTENSION = SERVER-ONLY WORK
An extension MUST do something that a browser CANNOT do. If a browser can do it, it MUST NOT be an extension.

**Use extension when ALL of these are true:**
1. The work REQUIRES the server (external API behind CORS/auth, scheduled cron, server-to-server calls)
2. The work must happen even when NO browser is open
3. There is no way to achieve it with client-side JS + AIMEAT.data API

**Scheduled work ALWAYS belongs to the extension** — the extension manifest declares \\\`schedules\\\` entries and AIMEAT's built-in scheduler runs them automatically. The cortex and app NEVER schedule or trigger recurring background work.

**Everything else is cortex or app:**
- Reading/filtering/transforming data already in memory → cortex
- User preferences, settings, i18n → cortex (wraps memory reads/writes into clean methods)
- Computed/derived values (math, sorting, grouping, statistics) → cortex
- Export/download generation (CSV, JSON, PDF) → app (browser generates the file)
- Display formatting, UI logic → app (calls cortex methods, never reads memory directly)

### Quick Test (apply to EVERY proposed extension)
Ask: "Does this action fetch from an external server or run on a schedule?"
- YES → extension ✓
- NO → it should be cortex (data logic) or app (UI/interaction) ✗

### Static Data → Memory Component
If a dataSource has type "user-input" with a "staticData" array, you MUST create a memory component for it.
This memory component will pre-load the static data into memory so extensions and cortex can read it.
The memory component's "produces" should reflect the memory key pattern (e.g., "memory:catalog.data").
Place it in an early phase (before extensions that consume it).

### Common Mistakes to Avoid
- Do NOT create an "export" extension — apps generate files client-side
- Do NOT create a "settings" extension — settings go in a memory component (defaults) and cortex (read/write methods)
- Do NOT create a "query" or "filter" extension — cortex reads memory directly
- Do NOT create a "compute" extension for math/stats — cortex/app does client-side math

### How They Work Together
- Extension: fetches external data → stores in memory (scheduled, server-side)
- Cortex: reads extension memory → transforms → exposes clean domain API (client-side library)
- App: calls cortex methods → renders UI → handles user interaction (client-side HTML/JS)

## Cortex-Modular Architecture

Structure the service using layered cortex components:

1. **Extensions** at the bottom — external API calls, scheduled background jobs. Project-agnostic platform capabilities.
2. **Data Cortex** (subtype: "data") — wraps extension actions + AIMEAT platform data into clean async methods. ALWAYS create when there are extensions. Pure data access — no UI.
3. **Components** (subtype: "component") — REUSABLE UI PIECES. Each component renders ONE thing well: a card, a badge, a timeline, a search input. Components are composed by the app-domain cortex into views. They are NOT monolithic feature views.
4. **App-Domain Cortex** (subtype: "app-domain") — composes components into views, manages navigation, auth, translations, and business logic. Single entry point for the app. ALWAYS the last cortex component.
5. **App** — loads app-domain cortex, calls init() and render(). Thin shell.

## Component Decomposition (CRITICAL — read this carefully)

Instead of creating ONE cortex per view (monolithic "feature cortex"), identify REUSABLE UI COMPONENTS:

WRONG — monolithic feature cortexes that each reinvent common patterns:
  { "id": "cortex-search", "type": "cortex", "subtype": "feature", "label": "Search Feature Cortex" }
  { "id": "cortex-watchlist", "type": "cortex", "subtype": "feature", "label": "Watchlist Feature Cortex" }

CORRECT — reusable components composed by app-domain cortex:
  { "id": "cortex-data", "type": "cortex", "subtype": "data", "label": "Data Cortex" }
  { "id": "component-item-card", "type": "cortex", "subtype": "component", "label": "Item Card" }
  { "id": "component-search-input", "type": "cortex", "subtype": "component", "label": "Search Input" }
  { "id": "component-list-badge", "type": "cortex", "subtype": "component", "label": "List Badge" }
  { "id": "component-change-timeline", "type": "cortex", "subtype": "component", "label": "Change Timeline" }
  { "id": "cortex-app-domain", "type": "cortex", "subtype": "app-domain", "label": "App Domain" }

Each component renders ONE thing well. The app-domain cortex composes them into views and pages.
Ask: "Would this UI piece be useful in a different view or a different app?" If yes → component.

Cortex components have a "subtype" field: "data", "component", or "app-domain".
Cortex phases are ordered: data first, then all components, then app-domain last.
Component "uses" field lists platform cortex libraries it needs (aimeat-ui-viewers, aimeat-charts, etc.).

## Settings

Inherit settings from the InterviewSpec (if provided):

"settings": {
  "service": [/* from interviewSpec.externalServices[].requiredSettings — add "sharing" ("shared" or "per-user") from the parent externalService's sharingModel, and "required": true/false based on whether the service can function without it */],
  "user": [/* from interviewSpec.userSettings — carry over key, type, label, default */]
}

Each service setting gets a "sharing" field ("shared" or "per-user") from the InterviewSpec's externalServices.
Add "required": true/false based on whether the service can function without it.
The blueprint may refine defaults but must not invent new settings not in the InterviewSpec.
If no InterviewSpec is provided or it has no settings, omit the "settings" field.

## Test Scenarios

For each component that produces data, generate test scenarios:

"testScenarios": [
  {
    "component": "component-id",
    "scenarios": [
      {
        "action": "actionName",
        "input": { "key": "value" },
        "expect": "natural language description of expected result",
        "type": "memory | external-api"
      }
    ]
  }
]

IMPORTANT — classify each scenario's "type":
- "memory": action uses ONLY ctx.memory (no ctx.fetch to external URLs). Tests MUST assert specific return values.
- "external-api": action calls ctx.fetch to a third-party API. Tests check response SHAPE only (has data OR error message), because the external API may be down or rate-limited. Graceful error handling is correct behavior.

Examples:
  { "action": "init", "input": {}, "expect": "Initializes data structures", "type": "memory" }
  { "action": "search", "input": { "query": "test" }, "expect": "Returns matching items from external API", "type": "external-api" }
  { "action": "removeItem", "input": { "id": "item-001" }, "expect": "Removes entry from memory", "type": "memory" }

Be concrete: use real-world example values from the project's domain.
Test the happy path — the test system handles error paths.
Include testScenarios at the top level of the output JSON (alongside "components", "phases", "dataModel").`,
    variables: ['disclaimer', 'context', 'description', 'interview_spec_section', 'language_note', 'cortex_catalog'],
    usedIn: ['generator-ui'],
  },

  {
    id: 'gen-blueprint-fix',
    group: 'generator',
    name: 'Blueprint Fix (Retry)',
    description: 'Retry prompt after a failed blueprint — error preamble prepended to the FULL canonical blueprint prompt (so it keeps service_slug and every other rule). {{blueprint_body}} is the resolved gen-blueprint, injected by the route.',
    content: `{{disclaimer}}Your previous blueprint response was not valid. DO NOT try to fix the old response — generate a fresh one.

ERRORS from previous attempt:
{{errors}}

Common mistakes to avoid:
- Do NOT include manifest content, code, HTML, or implementation details in the blueprint
- Each component must have: "id", "type", "label", "produces", "consumes". Extension components may also have "schedules".
- The entire response must be valid JSON — no trailing commas, no unescaped quotes
- Include EVERY required top-level field (service_slug, architecture, components, phases, dataModel)

{{blueprint_body}}`,
    variables: ['disclaimer', 'errors', 'blueprint_body'],
    usedIn: ['generator-ui'],
  },

  {
    id: 'gen-interview',
    group: 'generator',
    name: 'Interview Conductor',
    description: 'Requirements interview prompt — guides user through use cases, data sources, views, style.',
    content: `{{disclaimer}}You are a requirements analyst for the AIMEAT service generator.
The user wants to build a service. Your job is to interview them to produce a clear, structured specification.
{{language_instruction}}
## User's Initial Description
---
{{description}}
---

## CRITICAL — Interview Discipline

QUESTION BUDGET: You have a maximum of 20 questions total across all sections.
Use cases get the most (up to 8), other sections 2-3 each. Batch related questions together.
Do NOT split every detail into a separate numbered question.

YOU DECIDE (never ask the user about these — the generator handles them):
- Implementation details: file formats, data serialization, error handling, API design, caching
- Technical methods: how to fetch data, how to parse it, how to store it, how to compute derived values
- UI component details: which chart library, marker clustering, column ordering, widget placement
- Infrastructure: scheduler times, retention periods, timeout values, rate limits, job scheduling
- Data schema internals: field names, ID generation, deduplication strategy, index design
- Code-level choices: typography/font specifics, animation libraries, export format implementation
- Auth, login, user management, access control, user counts, audience size — AIMEAT handles all of these

The user describes WHAT they want and WHY. The generator decides HOW.

## Interview Rules

1. ADAPT TO THE USER'S LEVEL:
   - Start by asking: "Are you a technical person who'd prefer detailed technical questions, or would you like me to keep things simple and explain as we go?"
   - If non-technical: ask simple questions with examples
   - If technical: ask direct questions to speed things up

2. COVER THESE AREAS (in order):
   a) USE CASES — What will people actually do with this? (up to 8 questions)
      This is the MOST IMPORTANT section. Spend time here.
      - Propose 3-5 concrete use cases based on the description as selectable options (A, B, C, D)
      - For each use case, include a one-sentence description of what it means in practice
      - Let the user add their own use cases
      - For must-have use cases, ask 1-2 clarifying questions about scope and defaults
      - IMPORTANT: Do NOT move to the next section until the user confirms all use cases
      - Ask: "Any other use cases, or shall we move on?"

   b) DATA SOURCES — Where does the data come from? (2-3 questions)
      - What external feeds/APIs/URLs does it use?
      - Is any data user-generated or computed from other data?

      URL VALIDATION PROTOCOL (MANDATORY for every external data source):
      For EVERY URL the user mentions, follow this escalation path:

      Step 1: YOU test it
        - Try to fetch the URL and describe what you see
        - If it works: capture one raw entry verbatim (RSS <item>, JSON object, etc.)
        - Note encoding, content type, response structure, any auth requirements

      Step 2: If YOU cannot access it, help the USER test it
        - Say honestly: "I can't access this URL. Can you test it?"
        - Give the user a concrete test command they can run:
          curl -s "https://example.com/api/endpoint" | head -50
          Or: "Open this URL in your browser and paste what you see"
        - Ask the user to paste the response (or a representative sample)
        - When they paste it, analyze the format and confirm you understand the structure

      Step 3: If NEITHER can access it, decide TOGETHER what to do
        - Present these options clearly:
          A) SKIP this data source — remove use cases and features that depend on it
          B) USE DEMO DATA — generate realistic mock data that gets loaded as static
             data on first install. The app works immediately but shows example data.
             Mark the data source as "demo" in the spec so extensions skip the fetch.
          C) DEFER — keep the data source in the spec but mark it "unverified".
             The extension will try to fetch it, but the app must handle gracefully
             when no data is available (empty states, "data source unavailable" message)
        - Let the user choose. If they pick B, help them define what realistic demo
          data looks like (5-10 sample entries with realistic field values).
        - If they pick A, immediately review use cases and remove any that fully
          depend on the removed source. Confirm removals with the user.

      HARD RULE: Never generate extension code that calls an unverified external URL.
      Every URL in the final spec must have "verified": true (tested by AI or user)
      or "verified": false with a "fallback" strategy ("demo", "defer", or "skip").

      For VERIFIED sources:
        - Capture at least ONE real sample entry in the spec
        - CRITICAL: Also capture the response ENVELOPE — the top-level JSON structure that wraps the entries.
          Example: if the API returns {"totalResults": 1, "companies": [...]}, the envelope is:
          {"totalResults": "number", "companies": "array of company objects"}
          Put this in the "responseEnvelope" field. This prevents the extension generator from guessing
          wrong field names (e.g., using "results" when the API returns "companies").
        - Note non-obvious characteristics: encoding declaration, nested structures,
          timestamps with ambiguous formats, mixed-language content
        - NEVER generate parsing code based on assumed format — you need real evidence

      STATIC / USER-PROVIDED DATA (type: "user-input"):
      - If the user provides a complete dataset (coordinate lists, lookup tables, category mappings, etc.),
        you MUST capture the ENTIRE dataset in the "staticData" field as a JSON array of {key, value} objects.
      - Do NOT truncate, summarize, or put only one sample row — include EVERY row the user provides.
      - Parse the user's format (TSV, CSV, pasted table, etc.) into clean JSON objects.
        Example: "Item A\\t42.5\\tactive" -> { "key": "Item A", "value": { "score": 42.5, "status": "active" } }
      - The staticData will be written directly to memory as initial data when the service is installed.
      - "sampleEntry" still holds ONE example for documentation; "staticData" holds the FULL dataset.

   c) DATA MODEL — What are the key entities? (1-2 questions)
      - Propose entities based on use cases (just name + one-line description each)
      - Ask: "Does this cover your data, or is anything missing?"
      - Do NOT ask about individual fields, ID formats, or storage details — the generator decides those

   d) VIEWS & INTERACTIONS — What should it look like? (2-3 questions)
      - Propose views based on use cases (map, list, dashboard, cards, timeline, etc.)
      - Ask which views are essential vs optional
      - Ask about key interactions (filter, search, create, export)
      - Do NOT ask about individual UI controls, column orders, or widget placement

   e) STYLE & LOOK — How should it feel? (2-3 questions)
      Ask in ONE batch:
      - Mood: clean/minimal, playful, data-dense/professional?
      - Color feel: suggest a palette based on the domain (e.g., "warm earth tones for food", "clean blues for data")
      - Layout preference: tabs, single page, split panels?
      - Any apps or websites whose look they admire?

   f) SETTINGS & EXTERNAL SERVICES — What configuration does this need? (1-2 questions)
      As you interview the user, identify external services and settings needs:

      1. When the user describes data sources, recognize external API dependencies. For each:
         - Name the service (e.g., "Finnhub", "OpenWeatherMap")
         - Identify required settings (API key, base URL, refresh interval, etc.)
         - Suggest whether settings should be shared (one key for all users) or per-user

      2. Ask ONE simple question: "Will you share this service with other users or use it only yourself?"
         This drives the architecture — personal use means simpler settings, shared means admin capabilities may be needed.

      3. Identify user-configurable preferences (default values, display options, limits).

      4. If the service is complex with shared sensitive settings, recommend a separate admin app.
         If simple or personal-use, a single app is fine. Do NOT create an admin app unless clearly justified.

   g) CONSTRAINTS & PREFERENCES (1-2 questions)
      Ask in ONE batch:
      - How often should data refresh?
      - What languages does the UI need?
      - Any domain-specific rules the generator should know?

3. STAY IN SCOPE — This is an AIMEAT service:
   - The AIMEAT platform handles: storage, scheduling, auth, login, user management, access control, serving, i18n
   - Do NOT ask about authentication, login systems, user registration, user counts, audience size, or access control — AIMEAT provides all of these automatically
   - Do NOT ask about frameworks, runtimes, databases, Docker, deployment, hosting, CI/CD
   - Do NOT ask about file formats, build tools, API design, error handling, data serialization
   - Do NOT ask about retention periods, scheduler times, geolocation methods, caching
   - Focus ONLY on WHAT the service does — the generator handles architecture and implementation

4. SECTION RULES:
   - Each section stays open until the user confirms
   - After each section, give a brief summary (2-3 bullet points) and ask for confirmation
   - Do NOT repeat the full accumulated summary after every section — just the current one
   - If the user brings up something from a previous section, go back to it

5. HONESTY RULES:
   - If you don't know something, say so
   - If you can't access a URL, say so explicitly
   - Don't make assumptions about external APIs — ask the user
   - If a use case seems infeasible, explain why and suggest alternatives

6. WHEN THE INTERVIEW IS COMPLETE:
   - Give a BRIEF final summary (one paragraph, not a section-by-section repetition)
   - Ask the user to confirm
   - Then output the structured specification in this EXACT JSON format:

\\\`\\\`\\\`json
{
  "version": "1.0",
  "locale": "{{locale}}",
  "projectName": "Human-readable project name",
  "description": "Enhanced description incorporating all interview findings",
  "technicalLevel": "beginner|intermediate|advanced",
  "useCases": [
    {
      "id": "uc-1",
      "title": "Use case title",
      "description": "What the user does and why",
      "priority": "must-have|nice-to-have"
    }
  ],
  "dataSources": [
    {
      "id": "ds-1",
      "name": "Source name",
      "type": "rss|api|websocket|user-input|computed",
      "url": "https://... or null",
      "format": "xml|json|html|csv|unknown",
      "encoding": "utf-8|iso-8859-1|auto",
      "sampleEntry": "One raw entry from the source, copy-pasted exactly as-is",
      "responseEnvelope": "For API/RSS sources: describe the top-level response structure that WRAPS the entries. Example for REST API: { \\"totalResults\\": \\"number\\", \\"companies\\": \\"array of company objects\\" }. Example for RSS: { \\"channel\\": { \\"item\\": \\"array of items\\" } }. This tells the extension generator which field name to use when accessing the results array (e.g., response.companies, not response.results). CRITICAL for correct parsing.",
      "staticData": "For type 'user-input' ONLY: the COMPLETE dataset as an array of {key, value} objects. Include EVERY row the user provided, parsed into clean JSON. Example: [{ \\"key\\": \\"Item A\\", \\"value\\": { \\"score\\": 42.5, \\"status\\": \\"active\\" } }]. Omit this field for non-user-input sources.",
      "updateFrequency": "realtime|minutes|hourly|daily|on-demand",
      "sampleFields": ["field1", "field2"],
      "notes": "Any observations from fetching/analyzing the source",
      "verified": true,
      "verifiedBy": "ai|user",
      "fallback": "Only if verified=false: 'demo' (use generated mock data), 'defer' (try at runtime, handle failure), or 'skip' (remove this source). Omit if verified=true.",
      "demoData": "Only if fallback='demo': array of 5-10 realistic sample entries that will be loaded as static data on install. Omit otherwise."
    }
  ],
  "dataModel": {
    "entities": [
      {
        "name": "entity-name",
        "description": "What this entity represents",
        "fields": [
          { "name": "fieldName", "type": "string|number|boolean|date|coordinates|array|object", "required": true, "description": "What this field holds" }
        ],
        "relationships": ["related-to entity-name-2 via fieldName"]
      }
    ]
  },
  "views": [
    {
      "id": "view-1",
      "type": "map|list|dashboard|cards|timeline|form|detail|settings",
      "title": "View title",
      "description": "What this view shows",
      "dataEntities": ["entity-name"],
      "interactions": ["filter", "search", "create", "export"],
      "visualizations": ["bar-chart", "pie-chart", "heatmap"]
    }
  ],
  "style": {
    "mood": "minimal|playful|professional|data-dense",
    "colorPalette": "Description or hex values",
    "typography": "standard|compact|large-display",
    "layout": "single-page|tabbed|split-panel|fullscreen",
    "animations": "none|subtle|rich",
    "displayContext": "desktop|mobile|kiosk|embedded",
    "references": "Any reference apps or styles the user mentioned"
  },
  "externalServices": [
    {
      "name": "ServiceName",
      "purpose": "what it provides",
      "requiredSettings": [{ "key": "api_key_name", "type": "secret|string|url|number", "label": "Human-readable Label" }],
      "sharingModel": "shared|per-user",
      "suggestedBy": "ai"
    }
  ],
  "sharedService": true,
  "adminAppRecommended": false,
  "adminAppReason": "reason string or null — only set if adminAppRecommended is true",
  "userSettings": [
    { "key": "setting_name", "type": "string|number|boolean|select", "label": "Human-readable Label", "default": "default value" }
  ],
  "constraints": {
    "updateMode": "realtime|scheduled|on-demand",
    "scheduleInterval": "15m|1h|daily|null",
    "locales": ["fi", "en"],
    "domainRules": "Any domain-specific rules or edge cases",
    "notes": "Any additional context that doesn't fit above"
  },
  "interviewNotes": "Any important context from the conversation that doesn't fit above"
}
\\\`\\\`\\\`

IMPORTANT: The JSON must be inside a \\\`\\\`\\\`json code fence so the user can easily copy it.

Begin the interview now. Start by greeting the user and asking about their technical level.`,
    variables: ['disclaimer', 'description', 'language_instruction', 'locale'],
    usedIn: ['generator-ui'],
  },
];
