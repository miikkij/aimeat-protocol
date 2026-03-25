/**
 * @file generator-prompts-build.js
 * @description Build prompts for the service generator — blueprint analysis,
 *   structured interview, and per-component-type generation prompts.
 * @structure
 *   - buildBlueprintPrompt: produces blueprint generation prompt
 *   - buildInterviewPrompt: produces requirements interview conductor prompt
 *   - buildComponentPrompt: per-type component generation prompt dispatcher
 * @usage
 *   import { buildBlueprintPrompt, buildInterviewPrompt, buildComponentPrompt } from '/js/services/generator-prompts-build.js';
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from generator-prompts.js
 *   v1.1.0 — 2026-03-24 — Add API URL usage rules + notes to extension data source details
 */

import { AIMEAT_CONTEXT, INSTRUCTION_DISCLAIMER, COMPONENT_TEMPLATES, EXTENSION_CONSUMPTION_RULES, summarizeExtensionApi, summarizeCortexApi } from './generator-prompts-base.js';

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
  "components": [
    { "id": "csm-1", "type": "csm", "label": "Human-readable name", "produces": ["memory:service.schema"], "consumes": [] },
    { "id": "memory-1", "type": "memory", "label": "Human-readable name", "produces": ["memory:lookup.data"], "consumes": [] },
    { "id": "memory-2", "type": "memory", "label": "Human-readable name", "produces": ["memory:settings.config"], "consumes": [] },
    { "id": "translation-1", "type": "translation", "label": "Human-readable name (locale)", "produces": ["memory:i18n.fi"], "consumes": [] },
    { "id": "ext-1", "type": "extension", "label": "Human-readable name", "produces": ["memory:items.by-date.*", "memory:stats.daily.*"], "consumes": ["memory:lookup.data", "memory:settings.config"], "schedules": [{"action":"init","cron":"@activate"},{"action":"collect","cron":"*/15 * * * *"},{"action":"aggregate","cron":"0 2 * * *"}] },
    { "id": "cortex-1", "type": "cortex", "label": "Human-readable name", "produces": ["api:getItems", "api:getStats", "api:getSettings"], "consumes": ["memory:items.by-date.*", "memory:lookup.data", "memory:settings.config", "memory:i18n.fi"] },
    { "id": "app-1", "type": "app", "label": "Human-readable name", "produces": [], "consumes": ["api:getItems", "api:getStats", "api:getSettings"] }
  ],
  "phases": [
    { "id": "define", "label": "Define Service", "componentIds": ["csm-1"] },
    { "id": "seed", "label": "Seed Data", "componentIds": ["memory-1", "memory-2", "translation-1"] },
    { "id": "logic", "label": "Build Logic", "componentIds": ["ext-1"] },
    { "id": "connect", "label": "Connect & Integrate", "componentIds": ["cortex-1"] },
    { "id": "ui", "label": "Build UI", "componentIds": ["app-1"] }
  ],
  "dataModel": {
    "lookup.data": {
      "type": "array",
      "items": { "type": "object", "properties": { "key": { "type": "string" }, "value": { "type": "object" } } },
      "source": "static",
      "producedBy": "memory-1",
      "consumedBy": ["ext-1", "cortex-1"]
    },
    "settings.config": {
      "type": "object",
      "properties": { "refreshMinutes": { "type": "number" }, "defaultLocale": { "type": "string" } },
      "source": "config",
      "producedBy": "memory-2",
      "consumedBy": ["ext-1", "cortex-1"]
    },
    "items.by-date.YYYY-MM-DD": {
      "type": "array",
      "items": { "type": "object", "properties": { "id": { "type": "string" }, "title": { "type": "string" }, "timestamp": { "type": "string" } } },
      "source": "external",
      "producedBy": "ext-1",
      "consumedBy": ["cortex-1"]
    }
  }
}

NOTE: The example above uses GENERIC placeholder names (lookup.data, items.by-date, etc.). Replace them with domain-specific names from YOUR project (e.g., products.catalog, events.by-date, sensors.readings). Do NOT copy these placeholder names.

Rules:
- Component types: csm, msm, extension, app, memory, translation, cortex
- IDs use format: {type}-{number} (e.g., csm-1, ext-1, app-1). ID prefixes can be short (ext-1) but the "type" field MUST be the full name: "extension" (not "ext").
- Each component object has these fields: "id", "type", "label", "produces", "consumes"
- Extension components may also have "schedules": array of { "action": "action-id", "cron": "cron-expression" }
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
- Cortex components go in a "Connect & Integrate" phase AFTER translations, BEFORE app
- Cortex libraries are client-side JS that wrap extension APIs into clean domain methods for the app
- Default to ONE cortex per project unless complexity clearly warrants splitting
- Only include what's actually needed — don't pad with unnecessary components
- TRANSLATIONS: Create ONE translation component PER locale. If the spec has locales ["fi", "en"], create translation-1 for fi AND translation-2 for en. NEVER combine multiple locales into one component.
- MSM: Only create an MSM if the external API requires authentication, API keys, or complex endpoint configuration. Public URLs (RSS feeds, open APIs, open data) do NOT need an MSM — extensions fetch them directly with ctx.fetch().
- MEMORY: Create memory components for (a) static/seed data provided by the user (lookup tables, reference datasets) and (b) default settings/configuration that the service needs on first run. Pre-populating defaults in memory means the app works immediately without hardcoded fallbacks.
- MEMORY KEY NAMING: Use consistent namespace prefixes. Standard conventions: "settings.config" for config, "i18n.{locale}" for translations, descriptive namespace for domain data (e.g., "orders.by-date.*", "stats.daily.*", "scores.by-date.*"). Use dot-separated namespaces, not nested objects.
- CORTEX: Cortex is the middleware between memory and apps. It wraps ALL memory access into clean domain methods: data queries, settings, i18n, computed values. Apps should NEVER read memory directly — they call cortex methods.

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

For each VIEW in the spec, trace the data path:
1. What fields does this view need to render?
2. Where does each field come from? (external source, computed, user input)
3. Does the source provide this field directly, or does a component need to transform/enrich it?
4. If a field has no clear path from source to view, add a component that produces it.

Example: A view needs enriched data. If the source only provides raw identifiers,
the blueprint must include a component that enriches them (e.g., resolving IDs to names, adding computed scores).

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

Structure the service using cortex layers, not monolithic apps:

1. **Extensions** at the bottom — fetch external data, handle storage
2. **Data Cortex** — unifies extension data into a single interface. ALWAYS create when there are extensions.
3. **UI Cortexes** — self-contained view components (list, detail, settings). Each is a complete functional unit like charts-cortex or drawing-board.
4. **Admin Cortex** — only if adminAppRecommended in interview spec. Handles settings management, moderation.
5. **App** — lightweight shell that composes cortexes. No heavy logic, just layout + cortex composition.
6. **Admin App** — only if admin cortex exists. Uses type "app" with "role": "admin" in component metadata.

Cortexes can use other cortexes. UI cortexes consume data cortex. Data cortex consumes extensions.

IMPORTANT: Do NOT add user management — AIMEAT handles that already.

Include "architecture": "cortex-modular" at the top level of the output JSON (alongside "components", "phases", "dataModel").

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
        "action": "action-name",
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

/* ── Interview Prompt ──────────────────────────────────── */

/**
 * Build an interview prompt that the user copies to AI Chat.
 * AI Chat interviews the user and produces a structured JSON spec.
 */
export function buildInterviewPrompt(description, locale = 'en') {
  const langMap = { fi: 'Finnish (suomi)', en: 'English', sv: 'Swedish (svenska)', de: 'German (Deutsch)', fr: 'French (français)', es: 'Spanish (español)', ja: 'Japanese (日本語)', zh: 'Chinese (中文)' };
  const langName = langMap[locale] || locale;
  const langInstruction = locale !== 'en'
    ? `\n## LANGUAGE\n\nCONDUCT THIS ENTIRE INTERVIEW IN ${langName.toUpperCase()}.\nAll your questions, summaries, options, and explanations must be in ${langName}.\nThe final JSON specification field values (descriptions, titles, notes) should also be in ${langName}.\nJSON keys and technical identifiers (field names, type values) stay in English.\nInclude "locale": "${locale}" in the output JSON root so downstream prompts continue in the same language.\n`
    : '';

  return `${INSTRUCTION_DISCLAIMER}You are a requirements analyst for the AIMEAT service generator.
The user wants to build a service. Your job is to interview them to produce a clear, structured specification.
${langInstruction}
## User's Initial Description
---
${description}
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
        Example: "Item A\\t42.5\\tactive" → { "key": "Item A", "value": { "score": 42.5, "status": "active" } }
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
  "locale": "${locale}",
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
      "responseEnvelope": "For API/RSS sources: describe the top-level response structure that WRAPS the entries. Example for REST API: { \"totalResults\": \"number\", \"companies\": \"array of company objects\" }. Example for RSS: { \"channel\": { \"item\": \"array of items\" } }. This tells the extension generator which field name to use when accessing the results array (e.g., response.companies, not response.results). CRITICAL for correct parsing.",
      "staticData": "For type 'user-input' ONLY: the COMPLETE dataset as an array of {key, value} objects. Include EVERY row the user provided, parsed into clean JSON. Example: [{ \"key\": \"Item A\", \"value\": { \"score\": 42.5, \"status\": \"active\" } }]. Omit this field for non-user-input sources.",
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

Begin the interview now. Start by greeting the user and asking about their technical level.`;
}

export function buildComponentPrompt(type, label, projectDescription, blueprint, completedComponents, interviewSpec) {
  const template = COMPONENT_TEMPLATES[type];
  if (!template) throw new Error(`No template for type: ${type}`);

  let context = `Project: ${projectDescription}\n`;
  if (blueprint) {
    context += `\nBlueprint components: ${blueprint.components.map(c => `${c.id} (${c.type}: ${c.label})`).join(', ')}\n`;
  }

  // Inject relevant dataModel entries — the centralized data contract
  if (blueprint?.dataModel) {
    const componentId = blueprint.components?.find(c => c.label === label)?.id;
    const relevant = {};
    for (const [key, schema] of Object.entries(blueprint.dataModel)) {
      // CSM: show all data model keys (CSM defines the service schema)
      if (type === 'csm') {
        relevant[key] = schema;
      }
      // Memory component: show keys it produces
      if (type === 'memory' && schema.producedBy === componentId) {
        relevant[key] = schema;
      }
      // Extension: show keys it produces AND consumes
      if (type === 'extension' && (schema.producedBy === componentId || schema.consumedBy?.includes(componentId))) {
        relevant[key] = schema;
      }
      // Cortex: show all keys it consumes
      if (type === 'cortex' && schema.consumedBy?.includes(componentId)) {
        relevant[key] = schema;
      }
      // App: show all keys it consumes (via cortex)
      if (type === 'app' && schema.consumedBy?.includes(componentId)) {
        relevant[key] = schema;
      }
      // Translation: show i18n keys it produces
      if (type === 'translation' && schema.producedBy === componentId) {
        relevant[key] = schema;
      }
    }
    if (Object.keys(relevant).length > 0) {
      // Strip pipeline metadata (source, producedBy, consumedBy) — these are NOT part of the data shape
      // and AI copies them into the actual values if they're present
      const cleaned = {};
      for (const [key, schema] of Object.entries(relevant)) {
        const { source, producedBy, consumedBy, ...dataSchema } = schema;
        cleaned[key] = dataSchema;
      }
      context += '\n## Domain Data Model (EXACT schemas — follow these precisely)\n';
      context += 'These are the memory key schemas for this component. Use these exact key names and data shapes.\n\n';
      context += '```json\n' + JSON.stringify(cleaned, null, 2) + '\n```\n\n';
    }
  }

  if (completedComponents && completedComponents.length > 0) {
    context += '\nAlready completed:\n';
    for (const c of completedComponents) {
      context += `- ${c.id} (${c.type}: ${c.label}): registered as "${c.registeredAs}"\n`;
      // For extensions and cortex: include API summary instead of full code to avoid
      // prompt bloat that overwhelms the AI. Full code is injected by the cortex/app
      // template only for the specific components that template needs.
      if (c.result && c.type === 'extension') {
        context += `  API summary:\n${summarizeExtensionApi(c.result)}\n`;
        // Inject probe results — real API responses captured from live execution
        if (c.probeResults && Array.isArray(c.probeResults) && c.probeResults.length > 0 && (type === 'cortex' || type === 'app' || type === 'extension')) {
          context += `\n  ## ACTUAL API RESPONSES (captured from live execution of ${c.registeredAs})\n`;
          context += `  Study these carefully — your code MUST handle these exact data shapes.\n\n`;
          for (const probe of c.probeResults) {
            if (probe.status === 200 && probe.response) {
              context += `  POST /v1/ext/${c.registeredAs}/${probe.action} ${JSON.stringify(probe.input)}\n`;
              context += `  → ${JSON.stringify(probe.response)}\n\n`;
            }
          }
        }
      } else if (c.result && c.type === 'cortex') {
        context += `  API summary:\n${summarizeCortexApi(c.result)}\n`;
      }
    }
  }

  // For memory components with static data: only include if this component's dataModel has source:"static"
  if (type === 'memory' && interviewSpec?.dataSources && blueprint?.dataModel) {
    const componentId = blueprint.components?.find(c => c.label === label)?.id;
    const hasStaticKey = componentId && Object.values(blueprint.dataModel).some(
      schema => schema.source === 'static' && schema.producedBy === componentId
    );
    if (hasStaticKey) {
      const staticSources = interviewSpec.dataSources.filter(ds => ds.staticData && Array.isArray(ds.staticData));
      if (staticSources.length > 0) {
        context += '\n## Static Data from Interview\n';
        context += 'The user provided complete datasets. Store each as a SINGLE memory key (one array value, not one key per entry).\n';
        context += 'The dataModel above shows the exact schema. Include ALL entries in the value.\n\n';
        for (const ds of staticSources) {
          context += `### ${ds.name} (${ds.staticData.length} entries)\n`;
          context += '```json\n' + JSON.stringify(ds.staticData, null, 2) + '\n```\n\n';
        }
      }
    }
  }

  // Inject scheduled jobs from blueprint to extension prompts
  if (type === 'extension' && blueprint?.components) {
    const componentId = blueprint.components.find(c => c.label === label)?.id;
    const comp = componentId && blueprint.components.find(c => c.id === componentId);
    if (comp?.schedules && comp.schedules.length > 0) {
      context += '\n## Scheduled Jobs (from blueprint — MUST include in manifest)\n';
      context += 'This extension has recurring background jobs. Add a `schedules` section to the YAML manifest:\n\n';
      context += '```yaml\nschedules:\n';
      for (const s of comp.schedules) {
        context += `  - id: ${s.action}-scheduled\n    action: ${s.action}\n    cron: "${s.cron}"\n    description: "Scheduled: ${s.action}"\n    instance_scope: false\n    input: {}\n`;
      }
      context += '```\n\n';
      context += 'The scheduler runs these automatically in the background — no browser needed.\n';
    }
  }

  // Inject blueprint settings as extension config keys
  // The user enters settings values BEFORE generation. These values are injected into ctx.config
  // at runtime. The extension MUST use these EXACT key names in ctx.config.
  if (type === 'extension' && blueprint?.settings) {
    const allSettings = [...(blueprint.settings.service || []), ...(blueprint.settings.user || [])];
    if (allSettings.length > 0) {
      context += '\n## Extension Config Keys (from blueprint settings — use EXACTLY these)\n';
      context += 'These settings are injected into `ctx.config` at runtime. Use these EXACT key names:\n\n';
      context += '```yaml\nconfig:\n';
      for (const s of allSettings) {
        const yamlType = s.type === 'secret' ? 'string' : s.type === 'boolean' ? 'boolean' : s.type === 'number' ? 'number' : 'string';
        context += `  ${s.key}:\n    type: ${yamlType}\n    description: "${s.label}"\n`;
        if (s.required) context += `    required: true\n`;
      }
      context += '```\n\n';
      context += 'In your action code, read these as: `ctx.config?.${allSettings[0].key}`\n';
      context += 'Do NOT rename these keys. Do NOT use different key names like "apiKey" when the blueprint says "' + allSettings[0].key + '".\n\n';
    }
  }

  // Inject required action/method names from blueprint testScenarios
  // These are the EXACT names the component MUST implement — tests will call them by name
  if ((type === 'extension' || type === 'cortex' || type === 'app') && blueprint?.testScenarios) {
    const componentId = blueprint.components?.find(c => c.label === label)?.id;
    const scenarios = (blueprint.testScenarios || [])
      .filter(ts => ts.component === componentId)
      .flatMap(ts => ts.scenarios || []);
    if (scenarios.length > 0) {
      const names = [...new Set(scenarios.map(s => s.action))];
      if (type === 'extension') {
        context += '\n## Required Action IDs (from blueprint — use EXACTLY these names)\n';
        context += 'The blueprint specifies these EXACT action IDs. Your extension MUST use these names:\n\n';
        for (const s of scenarios) {
          context += `- **${s.action}** — ${s.expect.split('.')[0]}.\n`;
          if (Object.keys(s.input).length > 0) context += `  Input: ${JSON.stringify(s.input)}\n`;
        }
        context += `\nDo NOT rename these actions. Use "${names.join('", "')}" as the action id values in your YAML manifest.\n`;
        context += 'If you use different names (e.g., "getCandles" instead of "fetchCandles"), validation WILL fail.\n\n';
      } else if (type === 'cortex') {
        context += '\n## Required Method Names (from blueprint — use EXACTLY these)\n';
        context += 'Tests will call these methods by name. Your cortex MUST export them:\n\n';
        for (const s of scenarios) {
          context += `- **${s.action}()** — ${s.expect.split('.')[0]}.\n`;
          if (Object.keys(s.input).length > 0) context += `  Args: ${JSON.stringify(s.input)}\n`;
        }
        context += '\nDo NOT rename these methods. Validation WILL fail if names don\'t match.\n\n';
      } else if (type === 'app') {
        context += '\n## Required User Flows (from blueprint — the app MUST support these)\n';
        context += 'Tests will verify these workflows exist and function in the UI:\n\n';
        for (const s of scenarios) {
          context += `- **${s.action}** — ${s.expect}\n`;
        }
        context += '\n';
      }
    }
  }

  // Cortex: inject EXTENSION_CONSUMPTION_RULES so cortex knows ALL actions are POST
  if (type === 'cortex') {
    context += '\n' + EXTENSION_CONSUMPTION_RULES + '\n';
  }

  // Cortex: if blueprint produces api:t, cortex MUST include translation helper methods
  if (type === 'cortex' && blueprint?.components) {
    const componentId = blueprint.components.find(c => c.label === label)?.id;
    const comp = componentId && blueprint.components.find(c => c.id === componentId);
    if (comp?.produces && comp.produces.some(p => p === 'api:t')) {
      context += `\n## REQUIRED: Translation Helper Methods

Your cortex MUST include these translation methods (blueprint produces "api:t"):

\`\`\`javascript
// Translation helper — MUST be included
async function getTranslations(locale) {
  const strings = await readExtMemory(EXT.name, 'i18n.' + (locale || 'fi'));
  return strings || {};
}

function t(key, translations) {
  if (!translations) return key;
  const parts = key.split('.');
  let val = translations;
  for (const p of parts) {
    val = val?.[p];
    if (val === undefined) return key;
  }
  return val;
}
\`\`\`

Export both as public methods: getTranslations(locale) and t(key, translations).
The app calls getTranslations() during startup and t() for every UI string.
If these are missing, the app WILL crash with "getTranslations is not a function".\n`;
    }
  }

  // Thread interview data source details to extension prompts
  if (type === 'extension' && interviewSpec?.dataSources) {
    context += '\n## Data Source Details (from interview — use these to write correct parsers)\n';
    for (const ds of interviewSpec.dataSources) {
      context += `- **${ds.name}** (${ds.type}): ${ds.url || 'user-input'}\n`;
      if (ds.url) {
        context += `  ⚠️ Use this EXACT URL as the base. Do NOT guess or modify the URL structure — read the notes below for how to construct requests.\n`;
      }
      if (ds.encoding) context += `  Encoding: ${ds.encoding}\n`;
      if (ds.notes) context += `  Notes: ${ds.notes}\n`;
      if (ds.responseEnvelope) {
        context += `  Response envelope (top-level JSON structure): \`${typeof ds.responseEnvelope === 'string' ? ds.responseEnvelope : JSON.stringify(ds.responseEnvelope)}\`\n`;
        context += `  ⚠️ Use the EXACT field names from this envelope to access the results array. Do NOT guess field names like "results" or "data" — use what the API actually returns.\n`;
      }
      if (ds.sampleEntry) context += `  Sample entry (ONE item from the results array — write your parser against this):\n  \`\`\`\n  ${ds.sampleEntry}\n  \`\`\`\n`;
      if (ds.staticData && Array.isArray(ds.staticData)) {
        context += `  **STATIC DATA (${ds.staticData.length} entries) — pre-loaded in OWNER memory. Read with ctx.memory.getPublic(ctx.caller.owner, key), do NOT re-create it.**\n`;
      }
    }
  }

  // Inject use cases from interview spec to app prompts — drives UI design
  if (type === 'app' && interviewSpec?.useCases) {
    const cases = interviewSpec.useCases.map(uc => {
      if (typeof uc === 'string') return uc;
      if (uc?.description) return uc.description;
      if (uc?.title) return uc.title;
      return JSON.stringify(uc);
    }).filter(Boolean);
    if (cases.length > 0) {
      context += '\n## Use Cases (from interview — the app MUST support ALL of these)\n';
      cases.forEach((c, i) => { context += `${i + 1}. ${c}\n`; });
      context += '\nDesign the UI around these workflows. Every use case must be reachable.\n\n';
    }
  }

  // Thread language preference from interview spec to all component prompts
  const specLocale = interviewSpec?.locale;
  if (specLocale && specLocale !== 'en') {
    context += `\n## LANGUAGE\n\nThe user works in "${specLocale}". Write all human-readable text (labels, descriptions, comments, UI strings, variable names for display) in that language.\nCode identifiers, JSON keys, YAML keys, and API names stay in English.\n`;
  }

  // For translation components: if another locale is already done, inject its keys
  // so AI generates matching keys for this locale
  if (type === 'translation' && completedComponents?.length > 0) {
    const otherTranslations = completedComponents.filter(c => c.type === 'translation' && c.result);
    for (const t of otherTranslations) {
      try {
        const parsed = JSON.parse(typeof t.result === 'string' ? t.result : JSON.stringify(t.result));
        const locale = Object.keys(parsed).find(k => typeof parsed[k] === 'object');
        if (locale && parsed[locale]) {
          const keys = Object.keys(parsed[locale]);
          context += `\n## REQUIRED: Match these EXACT keys from the "${locale}" translation\n`;
          context += `The other locale has these ${keys.length} keys. You MUST use the SAME keys:\n`;
          context += `\`\`\`\n${keys.join('\n')}\n\`\`\`\n`;
          context += `Do NOT add extra keys and do NOT omit any keys — the sets must be identical.\n`;
        }
      } catch { /* ignore parse errors */ }
    }
  }

  // Inject MANDATORY API methods from blueprint produces list into cortex prompt
  // This is THE critical contract: cortex MUST implement exactly these methods
  if (type === 'cortex' && blueprint?.components) {
    const componentId = blueprint.components.find(c => c.label === label)?.id;
    const comp = componentId && blueprint.components.find(c => c.id === componentId);
    if (comp?.produces && comp.produces.length > 0) {
      const apiMethods = comp.produces
        .filter(p => p.startsWith('api:'))
        .map(p => p.replace('api:', ''));
      if (apiMethods.length > 0) {
        context += '\n## MANDATORY API METHODS (from blueprint — you MUST implement ALL of these)\n\n';
        context += '╔══════════════════════════════════════════════════════════════════════════╗\n';
        context += '║  Your cortex MUST export EXACTLY these methods. Do NOT rename them.     ║\n';
        context += '║  Do NOT add extra public methods. Do NOT omit any method.               ║\n';
        context += '║  The app component depends on these EXACT names.                        ║\n';
        context += '╚══════════════════════════════════════════════════════════════════════════╝\n\n';
        context += 'Required exports:\n';
        for (const m of apiMethods) {
          context += `- \`${m}()\` — MUST be in the exports object\n`;
        }
        context += '\nThe `exports` object at the bottom of your IIFE must include ALL of these:\n';
        context += '```javascript\nconst exports = { ' + apiMethods.join(', ') + ' };\n```\n\n';
      }
    }

    // Also inject consumes so cortex knows which memory keys to read
    if (comp?.consumes && comp.consumes.length > 0) {
      const memoryKeys = comp.consumes
        .filter(c => c.startsWith('memory:'))
        .map(c => c.replace('memory:', ''));
      if (memoryKeys.length > 0) {
        context += '\n## CONSUMED DATA (memory keys this cortex reads)\n';
        for (const k of memoryKeys) {
          context += `- \`${k}\`\n`;
        }
        context += '\n';
      }
    }
  }

  // Inject "uses" cortex dependencies from blueprint
  if (type === 'cortex' && blueprint?.components) {
    const componentId = blueprint.components.find(c => c.label === label)?.id;
    const comp = componentId && blueprint.components.find(c => c.id === componentId);
    if (comp?.uses && comp.uses.length > 0) {
      context += '\n## Reusable Cortex Libraries (from blueprint — load and use these)\n';
      context += 'This cortex component should use the following existing cortex libraries.\n';
      context += 'Load them via `<script>` tags in the prompt component and call their API.\n';
      context += 'Do NOT reimplement their functionality.\n\n';
      for (const libName of comp.uses) {
        context += `- **${libName}**: Load via \`<script src="/v1/cortex/${libName}/libs/${libName}.js"></script>\`\n`;
        context += `  Access via \`AIMEAT.${libName.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}.*\`\n`;
      }
      context += '\n';
    }
  }

  // App and cortex templates receive completedComponents for cross-referencing
  if (type === 'app' || type === 'cortex') {
    return INSTRUCTION_DISCLAIMER + template(label, context, completedComponents);
  }

  return INSTRUCTION_DISCLAIMER + template(label, context);
}
