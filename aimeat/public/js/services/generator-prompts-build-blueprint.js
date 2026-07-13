/**
 * @file public/js/services/generator-prompts-build-blueprint.js
 * @description Blueprint generation prompt builder for the generator. Extracted from generator-prompts-build.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from generator-prompts-build.js (max-file-lines)
 */

import { AIMEAT_CONTEXT, INSTRUCTION_DISCLAIMER } from './generator-prompts-base.js';

export function buildBlueprintPrompt(description, interviewSpec = null, availableCortexLibs = null) {
  const specContext = interviewSpec ? `
## Refined Specification (from requirements interview)
\`\`\`json
${JSON.stringify(interviewSpec, null, 2)}
\`\`\`

Use the specification above to determine the exact components needed. The data sources, entities, views, and constraints have been validated with the user.
` : '';

  // Build cortex catalog if available
  let cortexCatalog = '';
  if (availableCortexLibs && availableCortexLibs.length > 0) {
    cortexCatalog = `
## Available Cortex Libraries (reuse these — do NOT recreate)

The following cortex libraries are already installed on this node. If the project needs their capabilities, reference them in the cortex component's "uses" field instead of reimplementing.

${availableCortexLibs.map(lib => {
  const libComps = (lib.components || []).filter(c => c.type === 'lib');
  const exports = libComps.map(c => c.exports || []).flat();
  const apiSurface = libComps.map(c => c.api_surface || '').filter(Boolean).join('\n');
  return `### ${lib.name} — ${lib.description || 'no description'}
- **Exports:** ${exports.join(', ') || 'none'}
${apiSurface ? `- **API:**\n\`\`\`\n${apiSurface.trim()}\n\`\`\`` : ''}
- **Load:** \`<script src="/v1/cortex/${lib.name}/libs/${libComps[0]?.filename || lib.name + '.js'}"></script>\``;
}).join('\n\n')}

When the blueprint's cortex component needs an existing library, add a "uses" field listing the library names:
{ "id": "cortex-1", "type": "cortex", "label": "...", "produces": [...], "consumes": [...], "uses": ["aimeat-charts"] }

The generated cortex should load the used library via <script> and call its API (e.g., AIMEAT.charts.ChartBuilder) — NOT reimplement chart rendering.
`;
  }

  // Thread language from interview spec to blueprint prompt
  const specLocale = interviewSpec?.locale;
  const langNote = specLocale && specLocale !== 'en'
    ? `\n## LANGUAGE\n\nThe user's language is "${specLocale}". Write all human-readable labels and descriptions in that language.\nJSON keys and technical identifiers stay in English.\n`
    : '';

  return `${INSTRUCTION_DISCLAIMER}${AIMEAT_CONTEXT}

The user wants to create this service:
---
${description}
---
${specContext}${langNote}${cortexCatalog}
Analyze this request and produce a JSON blueprint listing ALL components needed.

CRITICAL: Return ONLY a JSON object with "architecture", "components", "phases", "dataModel", and optionally "settings" and "testScenarios". Nothing else.
Each component has these fields: "id", "type", "label", "produces", "consumes". Extension components may also have "schedules".
Do NOT include manifest content, code, HTML, translations, or any implementation details.
The blueprint is a lightweight plan — actual content is generated later per component.

Format:
{
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

**Scheduled work ALWAYS belongs to the extension** — the extension manifest declares \`schedules\` entries and AIMEAT's built-in scheduler runs them automatically. The cortex and app NEVER schedule or trigger recurring background work.

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
  { "id": "component-company-card", "type": "cortex", "subtype": "component", "label": "Company Card" }
  { "id": "component-search-input", "type": "cortex", "subtype": "component", "label": "Search Input" }
  { "id": "component-watchlist-badge", "type": "cortex", "subtype": "component", "label": "Watchlist Badge" }
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
  { "action": "removeItem", "input": { "id": "abc-123" }, "expect": "Removes entry from memory", "type": "memory" }

Be concrete: use real-world example values (e.g., symbol "AAPL" for stock data, city "Helsinki" for weather).
Test the happy path — the test system handles error paths.
Include testScenarios at the top level of the output JSON (alongside "components", "phases", "dataModel").`;
}
