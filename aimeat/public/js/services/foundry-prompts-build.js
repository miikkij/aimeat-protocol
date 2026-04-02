/**
 * @file foundry-prompts-build.js
 * @description Build prompts for the service foundry — blueprint analysis,
 *   structured interview, and per-component-type generation prompts.
 * @structure
 *   - buildBlueprintPrompt: produces blueprint generation prompt
 *   - buildInterviewPrompt: produces requirements interview conductor prompt
 *   - buildComponentPrompt: per-type component generation prompt dispatcher
 * @usage
 *   import { buildBlueprintPrompt, buildInterviewPrompt, buildComponentPrompt } from '/js/services/foundry-prompts-build.js';
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from foundry-prompts.js
 *   v1.1.0 — 2026-03-24 — Add API URL usage rules + notes to extension data source details
 *   v2.0.0 — 2026-03-26 — Add skeleton prompt builders for multi-pass pipeline:
 *     buildSkeletonPrompt (dispatcher), buildExtensionSkeletonPrompt,
 *     buildDataCortexSkeletonPrompt, buildFeatureCortexSkeletonPrompt,
 *     buildAppDomainCortexSkeletonPrompt, buildAppSkeletonPrompt
 *   v3.0.0 — 2026-03-26 — Add unit fill + assembly prompt builders:
 *     buildExtensionUnitPrompt, buildCortexMethodUnitPrompt,
 *     buildFeatureCortexSectionPrompt, buildAppViewUnitPrompt,
 *     buildExtensionAssemblyPrompt, buildCortexAssemblyPrompt,
 *     buildAppAssemblyPrompt
 *   v3.1.0 — 2026-03-28 — Critical prompt fixes from pipeline test:
 *     - callExt: switched from raw fetch() to session.fetch() for proper auth
 *     - Extension assembly: added author/method/path fields, export default signature
 *     - App assembly: added full boot sequence with loadScript, auth, error collector
 *     - Cortex assembly: added readExtMemory, t(), dv() helpers
 *     - Feature sections: added default platform UI examples, async data loading pattern
 *     - App-domain skeleton: added mountLoginButton pattern, dv() helper
 *     - All assemblies: added HTML_ENTITY_RULES
 */

import { AIMEAT_CONTEXT, INSTRUCTION_DISCLAIMER, COMPONENT_TEMPLATES, EXTENSION_CONSUMPTION_RULES, HTML_ENTITY_RULES, SANDBOX_CONSTRAINTS, summarizeExtensionApi, summarizeCortexApi } from './foundry-prompts-base.js';

// Cortex prompt modules — eagerly loaded in browser, skipped on server.
// The modules are cached after first dynamic import.
let _cortexModules = null;
let _cortexModulesPromise = null;

// Pre-load cortex modules in background — awaited in buildComponentPrompt if needed
if (typeof window !== 'undefined') {
  _cortexModulesPromise = Promise.all([
    import('./foundry-prompts-cortex-data.js'),
    import('./foundry-prompts-cortex-feature.js'),
    import('./foundry-prompts-cortex-app.js'),
    import('./foundry-context-bundle.js'),
  ]).then(([data, feature, app, bundle]) => {
    _cortexModules = {
      buildDataCortexPrompt: data.buildDataCortexPrompt,
      buildFeatureCortexPrompt: feature.buildFeatureCortexPrompt,
      buildAppDomainCortexPrompt: app.buildAppDomainCortexPrompt,
      createBundle: bundle.createBundle,
      formatBundlesForPrompt: bundle.formatBundlesForPrompt,
    };
    return _cortexModules;
  }).catch(() => { /* server-side or import failure — cortex prompts unavailable */ });
}

export function buildBlueprintPrompt(description, interviewSpec = null, availableCortexLibs = null) {
  const specContext = interviewSpec ? `
## Refined Specification (from requirements interview)
\`\`\`json
${JSON.stringify(interviewSpec, null, 2)}
\`\`\`

Use the specification above to determine the exact components needed. The data sources, entities, views, and constraints have been validated with the user.

CRITICAL — Data shape fidelity: If the specification includes a sampleEntry, your dataModel structures MUST match its EXACT nested shape. If a field in sampleEntry is an object (e.g., businessId: { value: "123", registrationDate: "2025-01-01" }), model it as type "object" with those exact properties — do NOT flatten it to type "string". Copy the structure from sampleEntry, do not simplify it.

CRITICAL — Feature count: Count the distinct views/screens described in the specification (e.g., search, detail, watchlist, changes, comparison, settings). Each one becomes its OWN feature cortex component. If the spec describes 6 views, you MUST create 6 feature cortexes — not fewer.
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

# Your Task

The user wants to create this service:
---
${description}
---
${specContext}${langNote}${cortexCatalog}
Analyze this request and produce a JSON blueprint — a lightweight plan that lists all components needed to build this service. Actual code and content are generated later, per component.

Return ONLY a raw JSON object. NO markdown fences (\`\`\`json). NO explanatory text before or after. The output must parse as valid JSON directly.

---

# Step 1: Understand the Architecture

Every AIMEAT service follows a layered architecture called "cortex-modular". Read each layer bottom-to-top — each layer depends only on the layer below it.

**Layer 1 — Foundation** (runs first, no dependencies)
  - \`csm\` — service schema definition
  - \`memory\` — pre-loaded settings and static data
  - \`translation\` — one component per locale (fi, en, etc.)

**Layer 2 — Extension** (server-side only)
  - Fetches data from external APIs via \`ctx.fetch()\`
  - Runs scheduled background jobs (cron)
  - Stores results in memory via \`ctx.memory.set()\`
  - ONLY for work that REQUIRES the server. If a browser can do it, it does NOT belong here.

**Layer 3 — Cortex** (client-side, layered into three subtypes)
  - **data** — reads extension memory + platform APIs, exposes a clean domain API
  - **feature** — one per UI feature (search, detail, settings, etc.), self-contained data+UI
  - **app-domain** — composes all features + auth + translations, single entry point

**Layer 4 — App** (client-side)
  - Loads app-domain cortex, wires navigation, handles layout

The blueprint declares components in this order. Phases group them into build stages that match these layers.

---

# Step 2: Decide What Components You Need

Walk through these questions in order:

**2a. What data does the service need?**
- External API data → create an \`extension\` component
- User-provided static data (lookup tables, reference sets) → create a \`memory\` component
- Default settings/config → create a \`memory\` component
- Translations → create one \`translation\` per locale

**2b. What does the extension do?**
Only create extension actions for server-required work:
- Fetching from external APIs (CORS, auth, server-to-server) → YES
- Scheduled background jobs (nightly data collection) → YES
- Filtering, sorting, computing, exporting → NO (cortex or app does this)
- Reading/writing settings or preferences → NO (cortex wraps memory)

**2c. What features does the UI have?**
Every distinct user-facing capability described in the specification MUST become its own feature cortex component. One view = one feature cortex. Do NOT merge or consolidate features.

Count the views in the spec: if it mentions search, detail view, watchlist, change history, comparison, and settings — that is 6 separate feature cortexes, not 3 or 4. Create ALL of them.

WRONG: "cortex-feature-search" that produces ["ui:searchView", "ui:detailView"]
CORRECT: separate "cortex-feature-search" and "cortex-feature-detail"

If the service has user-configurable settings (language, notifications, preferences), you MUST include a Settings feature cortex.

**2d. Verify the data pipeline.**
For each feature, trace: what data does it display → where does that data come from → which component produces it? Every field must have a path from source to screen. If a field has no path, add the component that produces it.

---

# Step 3: Build the JSON

The output has these top-level keys: "architecture", "components", "phases", "dataModel", and optionally "settings" and "testScenarios".

## 3a. Components

Each component is an object with: "id", "type", "label", "produces", "consumes".

**ID format:** \`{short-type}-{number}\` or \`cortex-{subtype}\` / \`cortex-feature-{name}\`.
  Examples: csm-1, memory-1, ext-1, cortex-data, cortex-feature-search, cortex-app, app-1
  The "id" prefix can be short (\`ext-1\`) but "type" MUST be the full name (\`"extension"\`, not \`"ext"\`).

**Component types and their fields:**

\`csm\` — service schema. Produces: ["memory:service.schema"]. Consumes: [].

\`memory\` — pre-loaded data. Produces: ["memory:{key}"]. Consumes: [].
  Create one for default settings (\`settings.config\`) and one per static dataset.

\`translation\` — one per locale. NEVER combine locales.
  translation-1 produces ["memory:i18n.fi"], translation-2 produces ["memory:i18n.en"].

\`extension\` — server-side logic. May have "schedules" field.
  Produces: ["memory:{key}"] for each data it stores.
  Consumes: ["memory:settings.config"] if it reads settings.
  Schedules: array of { "action": "actionName", "cron": "expression" }
    - "@activate" — runs on activation + every restart. Use for init/bootstrap. Must be idempotent.
    - Cron: exactly 5 fields. "0 2 * * *" (daily 02:00), "*/15 * * * *" (every 15 min).
      WRONG: "/15 * * * *" (missing asterisk), "0 2 * *" (4 fields).
  If no scheduled actions, omit "schedules" entirely.

\`cortex\` — has additional "subtype" and "uses" fields.
  subtype "data": produces ["api:methodName"], consumes ["memory:..."]
  subtype "feature": produces ["ui:viewName"], consumes ["api:..."], uses: ["aimeat-ui-viewers", ...]
  subtype "app-domain": produces ["api:init", "api:render"], consumes all ui:* views

\`app\` — final application. Produces: []. Consumes: ["api:init", "api:render"].

\`msm\` — ONLY for APIs requiring authentication/API keys. Public APIs do NOT need one.

**Produces/consumes format:**
  Memory: "memory:{namespace}.{key}" — e.g., "memory:watchlist.items", "memory:changes.log"
  API: "api:{methodName}" — e.g., "api:searchCompanies", "api:getSettings"
  UI: "ui:{viewName}" — e.g., "ui:searchView", "ui:settingsView"
  Every "consumes" entry must match a "produces" entry in another component.

## 3b. Phases

Group components into ordered build stages. Always use this structure:

  { "id": "define",          "componentIds": ["csm-1"] }
  { "id": "seed",            "componentIds": ["memory-1", "translation-1", "translation-2"] }
  { "id": "logic",           "componentIds": ["ext-1"] }
  { "id": "cortex-data",     "componentIds": ["cortex-data"] }
  { "id": "cortex-features", "componentIds": ["cortex-feature-*", ...all features...] }
  { "id": "cortex-app",      "componentIds": ["cortex-app"] }
  { "id": "ui",              "componentIds": ["app-1"] }

## 3c. Data Model

The "dataModel" has three sections: "structures", "memoryKeys", and "actions".

**structures** — JSON Schema definitions for every domain entity. These are the single source of truth.
  - Build from the interview's sampleEntry data — model the EXACT shapes from the verified API response.
  - If the API returns a nested object (e.g., businessId: { value, registrationDate, source }), model it as type "object" with those properties. Do NOT flatten to type "string".
  - All property names use English camelCase: "defaultLanguage", NOT "default_language".
  - Use "$ref" to reference structures from memoryKeys and actions. Every "$ref" must match a key in "structures".

**memoryKeys** — one entry per memory key. Each has: type, properties/items, source, producedBy, consumedBy.
  - "source": "static" (user data), "external" (API-fetched), "computed" (calculated), "config" (settings)
  - "producedBy": exactly ONE component ID
  - "consumedBy": array of component IDs that read this key
  - Standard key names: "settings.config", "i18n.fi", "i18n.en", then domain-specific: "watchlist.items", "changes.log", "comparisons.saved"
  - Do NOT invent custom namespace prefixes (no "prh.settings", no "app.config" — use "settings.config")

**actions** — extension and cortex actions with input/output schemas. Use "$ref" to reference structures.
  - Extension actions: "ext:actionName"
  - Cortex actions: "cortex:methodName"
  - Extension and cortex actions passing the same data MUST reference the SAME structure.

## 3d. Settings (optional)

If the InterviewSpec has settings, include them:

"settings": {
  "service": [/* from interviewSpec.externalServices[].requiredSettings */],
  "user": [/* from interviewSpec.userSettings — carry over key, type, label, default */]
}

User setting keys MUST use camelCase: "defaultLanguage", NOT "default_language".
Do not invent settings not in the InterviewSpec. If no settings, omit this section.

## 3e. Test Scenarios (optional but recommended)

For each component that produces data:

"testScenarios": [{
  "component": "ext-1",
  "scenarios": [
    { "action": "init", "input": {}, "expect": "Initializes memory structures", "type": "memory" },
    { "action": "search", "input": { "query": "test" }, "expect": "Returns results from API", "type": "external-api" }
  ]
}]

Types: "memory" (ctx.memory only, assert exact values) vs "external-api" (ctx.fetch, check shape only — API may be down).
Use real example values, not placeholders. Test the happy path.

---

# Full Example

IMPORTANT: This example shows a MINIMAL blueprint with only 3 features. YOUR blueprint will likely have MORE features — one per distinct view or capability described in the specification. If the spec describes 6 views, create 6 feature cortexes. Do NOT limit yourself to the example's feature count.

NOTE: Labels in this example use the spec's language. YOUR labels must also match YOUR spec's language. JSON keys stay in English.

{
  "architecture": "cortex-modular",
  "components": [
    { "id": "csm-1", "type": "csm", "label": "Palvelun skeema", "produces": ["memory:service.schema"], "consumes": [] },
    { "id": "memory-1", "type": "memory", "label": "Oletusasetukset", "produces": ["memory:settings.config"], "consumes": [] },
    { "id": "translation-1", "type": "translation", "label": "Käännökset (fi)", "produces": ["memory:i18n.fi"], "consumes": [] },
    { "id": "translation-2", "type": "translation", "label": "Käännökset (en)", "produces": ["memory:i18n.en"], "consumes": [] },
    { "id": "ext-1", "type": "extension", "label": "Tietojen haku", "produces": ["memory:items.data"], "consumes": ["memory:settings.config"], "schedules": [{"action":"init","cron":"@activate"},{"action":"collect","cron":"0 2 * * *"}] },
    { "id": "cortex-data", "type": "cortex", "subtype": "data", "label": "Tietokerros", "produces": ["api:getItem", "api:search", "api:getSettings", "api:saveSettings"], "consumes": ["memory:items.data", "memory:settings.config"], "uses": [] },
    { "id": "cortex-feature-search", "type": "cortex", "subtype": "feature", "label": "Haku", "produces": ["ui:searchView"], "consumes": ["api:search"], "uses": ["aimeat-ui-viewers", "aimeat-ui-forms"] },
    { "id": "cortex-feature-detail", "type": "cortex", "subtype": "feature", "label": "Tiedot", "produces": ["ui:detailView"], "consumes": ["api:getItem"], "uses": ["aimeat-ui-viewers"] },
    { "id": "cortex-feature-settings", "type": "cortex", "subtype": "feature", "label": "Asetukset", "produces": ["ui:settingsView"], "consumes": ["api:getSettings", "api:saveSettings"], "uses": ["aimeat-ui-forms"] },
    { "id": "cortex-app", "type": "cortex", "subtype": "app-domain", "label": "Sovelluskehys", "produces": ["api:init", "api:render"], "consumes": ["ui:searchView", "ui:detailView", "ui:settingsView"], "uses": ["aimeat-ui-nav"] },
    { "id": "app-1", "type": "app", "label": "Sovellus", "produces": [], "consumes": ["api:init", "api:render"] }
  ],
  "phases": [
    { "id": "define", "label": "Määrittely", "componentIds": ["csm-1"] },
    { "id": "seed", "label": "Perustiedot", "componentIds": ["memory-1", "translation-1", "translation-2"] },
    { "id": "logic", "label": "Taustalogiikka", "componentIds": ["ext-1"] },
    { "id": "cortex-data", "label": "Tietokerros", "componentIds": ["cortex-data"] },
    { "id": "cortex-features", "label": "Ominaisuudet", "componentIds": ["cortex-feature-search", "cortex-feature-detail", "cortex-feature-settings"] },
    { "id": "cortex-app", "label": "Sovelluskehys", "componentIds": ["cortex-app"] },
    { "id": "ui", "label": "Käyttöliittymä", "componentIds": ["app-1"] }
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
      "cortex:search": { "input": { "query": { "type": "string" } }, "output": { "$ref": "SearchResult" } },
      "cortex:getItem": { "input": { "id": { "type": "string" } }, "output": { "$ref": "Item" } }
    }
  }
}

---

# Pre-Generation Checklist

Before generating, verify:
- [ ] Each feature has its own cortex component (not merged)
- [ ] Settings feature cortex exists if user has configurable preferences
- [ ] Every "consumes" matches a "produces" in another component
- [ ] Data structures match the interview's sampleEntry shapes exactly (nested objects stay nested)
- [ ] All property names use camelCase (not snake_case)
- [ ] Memory keys use standard names: "settings.config", "i18n.{locale}", "{domain}.{key}"
- [ ] Memory keys do NOT have custom prefixes (no "prh.settings" — just "settings.config")
- [ ] Extension actions are only for server-required work (API calls, cron jobs)
- [ ] Cron expressions have exactly 5 fields
- [ ] Translation components: one per locale, never combined`;
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

  return `${INSTRUCTION_DISCLAIMER}You are a requirements analyst for the AIMEAT service foundry.
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

YOU DECIDE (never ask the user about these — the foundry handles them):
- Implementation details: file formats, data serialization, error handling, API design, caching
- Technical methods: how to fetch data, how to parse it, how to store it, how to compute derived values
- UI component details: which chart library, marker clustering, column ordering, widget placement
- Infrastructure: scheduler times, retention periods, timeout values, rate limits, job scheduling
- Data schema internals: field names, ID generation, deduplication strategy, index design
- Code-level choices: typography/font specifics, animation libraries, export format implementation
- Auth, login, user management, access control, user counts, audience size — AIMEAT handles all of these

The user describes WHAT they want and WHY. The foundry decides HOW.

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
          Put this in the "responseEnvelope" field. This prevents the extension foundry from guessing
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
      - Do NOT ask about individual fields, ID formats, or storage details — the foundry decides those

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
      - Any domain-specific rules the foundry should know?

3. STAY IN SCOPE — This is an AIMEAT service:
   - The AIMEAT platform handles: storage, scheduling, auth, login, user management, access control, serving, i18n
   - Do NOT ask about authentication, login systems, user registration, user counts, audience size, or access control — AIMEAT provides all of these automatically
   - Do NOT ask about frameworks, runtimes, databases, Docker, deployment, hosting, CI/CD
   - Do NOT ask about file formats, build tools, API design, error handling, data serialization
   - Do NOT ask about retention periods, scheduler times, geolocation methods, caching
   - Focus ONLY on WHAT the service does — the foundry handles architecture and implementation

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
      "responseEnvelope": "For API/RSS sources: describe the top-level response structure that WRAPS the entries. Example for REST API: { \"totalResults\": \"number\", \"companies\": \"array of company objects\" }. Example for RSS: { \"channel\": { \"item\": \"array of items\" } }. This tells the extension foundry which field name to use when accessing the results array (e.g., response.companies, not response.results). CRITICAL for correct parsing.",
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

export async function buildComponentPrompt(type, label, projectDescription, blueprint, completedComponents, interviewSpec) {
  const template = COMPONENT_TEMPLATES[type];
  if (!template) throw new Error(`No template for type: ${type}`);

  let context = `Project: ${projectDescription}\n`;
  if (blueprint) {
    context += `\nBlueprint components: ${blueprint.components.map(c => `${c.id} (${c.type}: ${c.label})`).join(', ')}\n`;
  }

  // Inject interview spec context for app and cortex — use cases, views, style
  if (interviewSpec && (type === 'app' || type === 'cortex')) {
    if (interviewSpec.useCases && interviewSpec.useCases.length > 0) {
      context += '\n## USE CASES (from user interview — the app MUST support ALL of these)\n';
      for (const uc of interviewSpec.useCases) {
        context += `- **${uc.title || uc.id}** [${uc.priority || 'must-have'}]: ${uc.description}\n`;
      }
      context += '\n';
    }
    if (interviewSpec.views && interviewSpec.views.length > 0) {
      context += '## VIEWS (from user interview — implement these as tabs/pages)\n';
      for (const v of interviewSpec.views) {
        context += `- **${v.title}** (${v.type}): ${v.description}`;
        if (v.interactions?.length) context += ` — interactions: ${v.interactions.join(', ')}`;
        context += '\n';
      }
      context += '\n';
    }
    if (interviewSpec.style) {
      const s = interviewSpec.style;
      context += `## STYLE: mood=${s.mood || 'professional'}, layout=${s.layout || 'tabbed'}, typography=${s.typography || 'standard'}\n\n`;
    }
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
    // Use context bundles when available — structured summaries from registration + probe
    const bundled = completedComponents.filter(c => c.contextBundle);
    const unbundled = completedComponents.filter(c => !c.contextBundle);

    if (bundled.length > 0) {
      const { formatBundlesForPrompt } = _cortexModules || {};
      if (formatBundlesForPrompt) {
        context += formatBundlesForPrompt(bundled.map(c => c.contextBundle));
      } else {
        // Fallback: simple listing if module not loaded
        context += '\nAlready completed:\n';
        for (const c of bundled) {
          const b = c.contextBundle;
          context += `- ${c.id} (${c.type}: ${c.label}): registered as "${b.registeredAs}"`;
          if (b.actions) context += ` — actions: ${b.actions.join(', ')}`;
          if (b.exports) context += ` — exports: ${b.exports.join(', ')}`;
          context += '\n';
        }
      }
    }

    // Fallback for components without bundles
    if (unbundled.length > 0) {
      context += '\nAlready completed:\n';
      for (const c of unbundled) {
        context += `- ${c.id} (${c.type}: ${c.label}): registered as "${c.registeredAs}"\n`;
        if (c.result && c.type === 'extension') {
          context += `  API summary:\n${summarizeExtensionApi(c.result)}\n`;
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
      // Platform cortex library API reference
      const platformApis = {
        'aimeat-ui-nav': 'Tabs(container, tabs, onSelect), Breadcrumbs(container, items), Sidebar(container, items, onSelect), BottomNav(container, items, onSelect), BurgerMenu(container, items, onSelect)',
        'aimeat-ui-layout': 'MainDetail(container, {main, detail}), DashboardGrid(container, cards), Split(container, {left, right}), Stacked(container, sections), Header(container, {title, actions}), Footer(container, content)',
        'aimeat-ui-viewers': 'DataTable(container, {columns, rows, onRowClick}), Timeline(container, events), Grid(container, items, renderItem), List(container, items, renderItem), Gallery(container, images), Carousel(container, slides)',
        'aimeat-ui-forms': 'Input(container, {label, value, onChange}), Select(container, {label, options, value, onChange}), Toggle(container, {label, checked, onChange}), Checkbox(container, {label, checked, onChange}), FormGroup(container, fields)',
        'aimeat-ui-dialogs': 'toast(message, type), Modal(container, {title, content, onClose}), Confirm({title, message, onConfirm}), Alert({title, message}), ContextMenu(container, items), Dropdown(container, items)',
        'aimeat-charts': 'ChartPanel(container, {type, data, options}), ChartBuilder(container, config), TYPES (bar, line, pie, doughnut, radar, scatter, bubble)',
        'aimeat-canvas': 'DrawingCanvas(container, {width, height, tools, onSave})',
      };
      for (const libName of comp.uses) {
        const camelName = libName.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        context += `- **${libName}**: Load via \`<script src="/v1/cortex/${libName}/libs/${libName}.js"></script>\`\n`;
        context += `  Access via \`AIMEAT['${libName}'].*\`\n`;
        if (platformApis[libName]) {
          context += `  API: ${platformApis[libName]}\n`;
        }
      }
      context += '\n';
    }
  }

  // Cortex subtype dispatch — use specialized templates for new multi-cortex architecture
  if (type === 'cortex' && blueprint) {
    const componentId = blueprint.components?.find(c => c.label === label)?.id;
    const comp = componentId && blueprint.components.find(c => c.id === componentId);
    const subtype = comp?.subtype;

    // Ensure cortex modules are loaded before dispatching
    if (subtype && !_cortexModules && _cortexModulesPromise) {
      await _cortexModulesPromise;
    }
    if (subtype && _cortexModules) {
      const { buildDataCortexPrompt, buildFeatureCortexPrompt, buildAppDomainCortexPrompt, createBundle } = _cortexModules;
      const bundles = (completedComponents || []).map(c => createBundle(c, c.probeResults));

    if (subtype === 'data') {
      return buildDataCortexPrompt(label, projectDescription, blueprint, bundles);
    }
    if (subtype === 'feature') {
      const useCase = interviewSpec?.useCases?.find(uc =>
        label.toLowerCase().includes(uc.title?.toLowerCase().split(' ')[0] || '___')
      ) || interviewSpec?.useCases?.[0];
      const view = interviewSpec?.views?.find(v =>
        label.toLowerCase().includes(v.title?.toLowerCase().split(' ')[0] || '___')
      ) || interviewSpec?.views?.[0];
      const dataCortexBundle = bundles.find(b => b.subtype === 'data');
      const structures = blueprint?.dataModel?.structures || {};
      const translationBundle = bundles.find(b => b.type === 'translation');
      const translationKeys = translationBundle?.keys || [];
      const usesLibs = comp?.uses || [];
      return buildFeatureCortexPrompt(label, useCase, view, dataCortexBundle, structures, translationKeys, usesLibs);
    }
    if (subtype === 'app-domain') {
      const featureBundles = bundles.filter(b => b.subtype === 'feature');
      const dataCortexBundle = bundles.find(b => b.subtype === 'data');
      const translationBundle = bundles.find(b => b.type === 'translation');
      return buildAppDomainCortexPrompt(label, projectDescription, featureBundles, dataCortexBundle, translationBundle);
    }
    // Fallback for unknown subtype — use generic cortex template
    return INSTRUCTION_DISCLAIMER + template(label, context, completedComponents);
    } // end if (subtype && _cortexModules)
  }

  // App and cortex templates receive completedComponents for cross-referencing
  if (type === 'app' || type === 'cortex') {
    return INSTRUCTION_DISCLAIMER + template(label, context, completedComponents);
  }

  return INSTRUCTION_DISCLAIMER + template(label, context);
}

/* ── Skeleton Prompt Builders (Multi-Pass Pipeline) ──── */

/**
 * Build skeleton prompt for any multi-pass component type.
 * Dispatches to the type-specific skeleton builder.
 */
export function buildSkeletonPrompt(params) {
  const type = params.blueprintComponent?.type;
  const subtype = params.blueprintComponent?.subtype;

  if (type === 'extension') return buildExtensionSkeletonPrompt(params);
  if (type === 'cortex' && subtype === 'data') return buildDataCortexSkeletonPrompt(params);
  if (type === 'cortex' && subtype === 'feature') return buildFeatureCortexSkeletonPrompt(params);
  if (type === 'cortex' && subtype === 'app-domain') return buildAppDomainCortexSkeletonPrompt(params);
  if (type === 'app') return buildAppSkeletonPrompt(params);

  throw new Error(`No skeleton prompt builder for type=${type} subtype=${subtype}`);
}

/**
 * Build the skeleton prompt for an extension component.
 * Produces a YAML skeleton with action signatures, schemas, memory keys — no implementation.
 */
export function buildExtensionSkeletonPrompt({ label, description, blueprint, blueprintComponent, interviewSpec }) {
  const structures = blueprint.dataModel?.structures || {};
  const memoryKeys = blueprint.dataModel?.memoryKeys || {};
  const actions = blueprint.dataModel?.actions || {};

  // Collect data sources relevant to this extension
  const dataSources = (interviewSpec?.dataSources || []).map(ds => ({
    name: ds.name,
    url: ds.url,
    sampleResponse: ds.sampleResponse || ds.sampleEntry || null,
    notes: ds.notes || '',
  }));

  // Collect schedules from blueprint
  const schedules = blueprintComponent.schedules || [];

  // Collect config keys
  const settingsArr = Array.isArray(blueprint.settings) ? blueprint.settings : (blueprint.settings?.user || []);
  const configKeys = settingsArr.map(s => s.key);

  return `${INSTRUCTION_DISCLAIMER}
# Task: Generate Extension Skeleton

You are generating a SKELETON for an AIMEAT extension. A skeleton defines the complete structure — action signatures, input/output schemas, memory keys, schedules — with ZERO implementation code.

## Project
${description}

## Component
Label: ${label}
Type: Extension (server-side V8 sandbox)

## Data Sources
${dataSources.map(ds => `- ${ds.name}: ${ds.url}${ds.sampleResponse ? `\n  Sample response: ${JSON.stringify(ds.sampleResponse, null, 2).slice(0, 2000)}` : ''}${ds.notes ? `\n  Notes: ${ds.notes}` : ''}`).join('\n')}

## Data Model Structures
${Object.entries(structures).length > 0 ? Object.entries(structures).map(([name, schema]) => `### ${name}\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``).join('\n\n') : 'No structures defined in blueprint.'}

## Memory Keys This Extension Uses
${Object.entries(memoryKeys).filter(([, v]) => v.producedBy === blueprintComponent.id || v.consumedBy?.includes(blueprintComponent.id)).map(([key, def]) => `- \`${key}\`: ${def.description || ''} (${def.producedBy === blueprintComponent.id ? 'writes' : 'reads'})`).join('\n') || 'None declared in blueprint.'}

## Actions From Blueprint
${Object.entries(actions).filter(([, v]) => v.component === blueprintComponent.id).map(([name, def]) => `- \`${name}\`: ${def.description || ''}\n  Input: ${JSON.stringify(def.input || {})}\n  Output: ${JSON.stringify(def.output || {})}`).join('\n\n') || 'None declared — infer from data sources and use cases.'}

## Schedules
${schedules.length > 0 ? schedules.map(s => `- ${s.action}: ${s.cron} — ${s.description || ''}`).join('\n') : 'None.'}

## Config Keys
${configKeys.length > 0 ? configKeys.map(k => `- ${k}`).join('\n') : 'None.'}

## Output Format

Produce a YAML skeleton document. Use EXACTLY this structure:

\`\`\`yaml
component: extension
name: <kebab-case-name>
version: 1.0.0
description: <one-line description>

memory:
  writes:
    - key: <memory-key>
      schema: <inline JSON schema of the value>
  reads:
    - key: <memory-key>
      schema: <inline JSON schema>

actions:
  - id: <action-id>
    method: POST
    path: /<path>
    input: <JSON schema of input parameters>
    output: <JSON schema of return value>
    dataSource: <URL if this action calls an external API>
    sampleResponse: |
      <actual JSON from sample data — copy field names exactly>
    notes: "<any transformation notes>"
    reads: [<memory-keys-read>]
    writes: [<memory-keys-written>]
    schedule: "<cron expression if scheduled>"
    depends: [<other-action-ids-it-calls>]

config:
  keys: [<config-memory-keys>]

activate:
  initCopies: []
\`\`\`

## CRITICAL RULES

1. **ZERO implementation code.** No function bodies, no ctx calls, no logic. Only signatures and schemas.
2. **Use EXACT field names from sample responses.** If the API returns \`results\`, write \`results\` not \`companies\`. Copy the field names character-for-character from the sampleResponse.
3. **Every action from the blueprint must appear.** Do not skip or rename actions.
4. **Output schemas must match the actual API response structure**, not an idealized version.
5. **Include sampleResponse verbatim** for every action that calls an external API — this is used for validation.
`;
}

/**
 * Build skeleton prompt for data cortex.
 */
export function buildDataCortexSkeletonPrompt({ label, description, blueprint, blueprintComponent, extensionSkeleton, extensionProbes }) {
  return `${INSTRUCTION_DISCLAIMER}
# Task: Generate Data Cortex Skeleton

You are generating a SKELETON for an AIMEAT data cortex. A data cortex wraps extension actions into clean JavaScript methods. No UI, no rendering — pure data access.

## Project
${description}

## Component
Label: ${label}
Type: Data Cortex (browser-side IIFE)

## Extension It Wraps
${extensionSkeleton || 'No extension skeleton available.'}

## Extension Probe Results (Real API Responses)
${extensionProbes ? Object.entries(extensionProbes).map(([action, result]) => `### ${action}\n\`\`\`json\n${JSON.stringify(result, null, 2).slice(0, 1500)}\n\`\`\``).join('\n\n') : 'No probes available yet.'}

## Output Format

\`\`\`yaml
component: data-cortex
name: <kebab-case-name>
extension: <extension-registered-as-name>

methods:
  - name: <camelCaseMethodName>
    params: <JSON schema of parameters>
    returns: <JSON schema of return value — use EXACT field names from probe results>
    calls: <extension-action-id>
  - name: <methodName>
    returns: <schema>
    reads: <memory-key>
\`\`\`

## CRITICAL RULES

1. ZERO implementation code. Only method signatures and schemas.
2. Return schemas MUST use exact field names from probe results, not invented names.
3. Every extension action that downstream components need must have a corresponding method.
`;
}

/**
 * Build skeleton prompt for feature cortex.
 */
export function buildFeatureCortexSkeletonPrompt({ label, description, blueprint, blueprintComponent, dataCortexSkeleton, dataCortexProbes, interviewSpec }) {
  const useCase = (interviewSpec?.useCases || []).find(uc =>
    blueprintComponent.consumes?.some(c => c.includes(uc.name?.toLowerCase?.()))
  ) || interviewSpec?.useCases?.[0];

  const view = (interviewSpec?.views || []).find(v =>
    v.name?.toLowerCase?.().includes(blueprintComponent.label?.toLowerCase?.())
  ) || interviewSpec?.views?.[0];

  return `${INSTRUCTION_DISCLAIMER}
# Task: Generate Feature Cortex Skeleton

You are generating a SKELETON for an AIMEAT feature cortex. A feature cortex combines data access + UI rendering for one use case. It exports a \`render(container)\` function.

## Project
${description}

## Component
Label: ${label}
Type: Feature Cortex (browser-side IIFE)

## Use Case
${useCase ? JSON.stringify(useCase, null, 2) : 'Not specified.'}

## View Definition
${view ? JSON.stringify(view, null, 2) : 'Not specified.'}

## Data Cortex API (upstream)
${dataCortexSkeleton || 'No data cortex skeleton available.'}

## Data Cortex Probe Results (Real Return Values)
${dataCortexProbes ? Object.entries(dataCortexProbes).map(([method, result]) => `### ${method}\n\`\`\`json\n${JSON.stringify(result, null, 2).slice(0, 1000)}\n\`\`\``).join('\n\n') : 'No probes available yet.'}

## Output Format

\`\`\`yaml
component: feature-cortex
name: <kebab-case-name>
useCase: "<use case description>"
view: <view-id>

dataCortex: <data-cortex-name>

sections:
  - id: <section-id>
    description: "<what this section renders>"
    uses:
      data: [<dataCortexMethodNames>]
      ui: [<PlatformUIComponents>]
    translationKeys: [<key1>, <key2>]

exports:
  - name: render
    params: { container: HTMLElement }
\`\`\`

## CRITICAL RULES

1. ZERO implementation code. Only section definitions and dependencies.
2. Each section should be a self-contained UI area (e.g., search form, results table, detail card).
3. Translation keys must follow the project's flat dot-notation pattern.
`;
}

/**
 * Build skeleton prompt for app-domain cortex.
 */
export function buildAppDomainCortexSkeletonPrompt({ label, description, featureCortexSkeletons, featureCortexProbes }) {
  return `${INSTRUCTION_DISCLAIMER}
# Task: Generate App-Domain Cortex Skeleton

You are generating a SKELETON for an AIMEAT app-domain cortex. This is the composition layer: it combines all feature cortex components + auth + i18n + settings.

## Project
${description}

## Feature Cortex Components
${featureCortexSkeletons?.map((s, i) => `### Feature ${i + 1}\n${s}`).join('\n\n') || 'No feature cortex skeletons available.'}

## Output Format

\`\`\`yaml
component: app-domain-cortex
name: <kebab-case-name>

features:
  - cortex: <feature-cortex-name>
    renderTarget: "#<container-id>"

exports:
  - name: init
    description: "Auth check, load locale, apply settings"
  - name: render
    params: { container: HTMLElement }
    description: "Render tab navigation, mount features"
  - name: t
    params: { key: string }
    returns: string
  - name: switchLocale
    params: { locale: string }
  - name: getTranslations
    returns: object
\`\`\`

## Translation Loading Pattern

The app-domain cortex MUST load translations from the owner's memory namespace:
\`\`\`javascript
// Translations are stored by the translation component in the OWNER namespace
// Key pattern: i18n.{locale} — loaded via AIMEAT.data.get()
const translations = await AIMEAT.data.get('i18n.' + locale) || {};
// If that returns null, try with service prefix:
// const translations = await AIMEAT.data.get('SERVICE_NAME.i18n.' + locale) || {};
\`\`\`

The t() function MUST use loaded translations to return human-readable text, NOT raw keys.

## Auth Pattern

\`\`\`javascript
// Restore session from storage — MUST call login() first
// getSession() alone returns null until login() is called
var session = await AIMEAT.auth.login();
if (!session) {
  // No stored session — show login button
  // mountLoginButton takes a CSS SELECTOR string, NOT a DOM element
  container.id = container.id || 'app-auth';
  AIMEAT.auth.mountLoginButton('#' + container.id);
  return { ready: false, authenticated: false };
}
\`\`\`

## Nested Object Helper (MUST include)
API responses contain nested objects. Include this helper in the IIFE:
\`\`\`javascript
function dv(val) {
  if (val == null) return '-';
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (val.value) return val.value;
  if (val.url) return val.url;
  if (val.name) return val.name;
  if (Array.isArray(val)) return val.map(dv).join(', ');
  return JSON.stringify(val);
}
\`\`\`

## CRITICAL RULES

1. ZERO implementation code in the skeleton — only structure.
2. List ALL feature cortex components that will be composed.
3. Export names must be exactly: init, render, t, switchLocale, getTranslations.
4. init() MUST call AIMEAT.auth.login() first, THEN load translations.
5. init() MUST load translations via AIMEAT.data.get('SERVICE_PREFIX.i18n.' + locale) with fallback to AIMEAT.data.get('i18n.' + locale).
6. t(key) MUST return the translated string from loaded translations, NOT the raw key.
7. render() MUST call init() first if translations aren't loaded yet.
8. Store translations in AIMEAT._translations so feature cortexes can access them.
`;
}

/**
 * Build skeleton prompt for app.
 */
export function buildAppSkeletonPrompt({ label, description, blueprint, interviewSpec, appDomainCortexSkeleton, appDomainCortexProbe }) {
  const views = interviewSpec?.views || [];
  const style = interviewSpec?.style || {};

  return `${INSTRUCTION_DISCLAIMER}
# Task: Generate App Skeleton

You are generating a SKELETON for an AIMEAT app. An app is an HTML page that loads the app-domain cortex and renders feature cortex components into containers.

## Project
${description}

## Views
${views.map(v => `- ${v.name}: ${v.description || ''}`).join('\n') || 'Not specified.'}

## Style Preferences
${JSON.stringify(style, null, 2)}

## App-Domain Cortex API
${appDomainCortexSkeleton || 'Not available.'}

## App-Domain Cortex Probe (Real API Surface)
${appDomainCortexProbe ? JSON.stringify(appDomainCortexProbe, null, 2).slice(0, 2000) : 'Not available.'}

## Output Format

\`\`\`yaml
component: app
name: <App Display Name>
version: 1.0.0

cortex: <app-domain-cortex-name>

views:
  - id: <view-id>
    tab: <translation-key-for-tab-label>
    feature: <feature-cortex-name>
    layout: "<layout description>"

navigation: tabs
auth: required
locales: [fi, en]
defaultLocale: fi
\`\`\`

## CRITICAL RULES

1. ZERO implementation code. Only view definitions and layout descriptions.
2. Every view from the interview spec must appear.
3. Tab labels must use translation keys, not hardcoded text.
`;
}

/* ── Unit Fill Prompt Builders (Multi-Pass Pipeline) ──── */

/**
 * Build prompt for implementing a single extension action.
 * Produces just the handler function body — no manifest, no boilerplate.
 */
export function buildExtensionUnitPrompt({ skeleton, unitDef, dataSources, testExcerpt }) {
  // Pick only the sandbox APIs this action needs
  const apis = [];
  if (unitDef.dataSource) apis.push('ctx.fetch(url, { method, headers, body }) → { status, ok, text, headers }. Body is always .text (string) — parse with JSON.parse(resp.text).');
  if (unitDef.reads?.length || unitDef.writes?.length) {
    apis.push('ctx.memory.get(key) → value|null. ctx.memory.set(key, value). ctx.memory.search(prefix) → Array<{key,value}>. ctx.memory.delete(key) → boolean.');
    apis.push('ctx.memory.getPublic(namespace, key) → value|null. Use for owner data: ctx.memory.getPublic(ctx.caller.gaii, key).');
  }
  if (unitDef.schedule) apis.push('Scheduled actions run automatically via cron. The handler receives empty input and ctx.');

  // Find the relevant data source
  const ds = dataSources?.find(d => unitDef.dataSource && d.url === unitDef.dataSource);

  return `${INSTRUCTION_DISCLAIMER}
# Task: Implement Extension Action — \`${unitDef.id}\`

You are implementing ONE action handler for an AIMEAT extension. Return ONLY the function body.

## Skeleton (full contract — do not deviate)
\`\`\`yaml
${typeof skeleton === 'string' ? skeleton : JSON.stringify(skeleton, null, 2)}
\`\`\`

## This Action's Contract
- **ID:** ${unitDef.id}
- **Method:** ${unitDef.method || 'POST'}
- **Path:** ${unitDef.path || '/' + unitDef.id}
- **Input:** \`${JSON.stringify(unitDef.input || {})}\`
- **Output:** \`${JSON.stringify(unitDef.output || {})}\`
${unitDef.reads?.length ? `- **Reads:** ${unitDef.reads.join(', ')}` : ''}
${unitDef.writes?.length ? `- **Writes:** ${unitDef.writes.join(', ')}` : ''}
${unitDef.schedule ? `- **Schedule:** ${unitDef.schedule}` : ''}
${unitDef.notes ? `- **Notes:** ${unitDef.notes}` : ''}
${ds ? `
## Data Source
- **URL:** ${ds.url}
- **Sample Response:**
\`\`\`
${typeof ds.sampleResponse === 'string' ? ds.sampleResponse.slice(0, 2000) : JSON.stringify(ds.sampleResponse, null, 2).slice(0, 2000)}
\`\`\`
${ds.notes ? `- **Notes:** ${ds.notes}` : ''}` : ''}

${SANDBOX_CONSTRAINTS}

${testExcerpt ? `## Test Excerpt (your code must pass this)\n\`\`\`\n${testExcerpt.slice(0, 1500)}\n\`\`\`` : ''}

${HTML_ENTITY_RULES}

## Output Format

Return ONLY the action function. No YAML, no manifest, no wrapping:

\`\`\`javascript
export default async function(ctx, input) {
  // your implementation here
}
\`\`\`

CRITICAL: The function signature MUST be \`export default async function(ctx, input)\` — ctx is the FIRST parameter, input is the SECOND. The V8 sandbox requires this exact format.
`;
}

/**
 * Build prompt for implementing a single cortex method (data or feature cortex).
 * Produces just the method function — no IIFE wrapper, no registration.
 */
export function buildCortexMethodUnitPrompt({ skeleton, unitDef, extensionProbeResult, componentSubtype }) {
  const isDataCortex = componentSubtype === 'data';

  // Show the right pattern based on how the method accesses data
  let accessPattern = '';
  if (unitDef.calls) {
    accessPattern = `
## Extension Call Pattern
\`\`\`javascript
// callExt helper is defined at the top of the IIFE — use it for ALL extension calls
// It uses AIMEAT.auth session.fetch() for proper auth handling
async function callExt(actionId, body) {
  try {
    if (!AIMEAT.auth || !AIMEAT.auth.getSession) {
      console.warn('[cortex] callExt(' + actionId + '): auth not available');
      return null;
    }
    var session = AIMEAT.auth.getSession();
    if (!session || !session.fetch) {
      console.warn('[cortex] callExt(' + actionId + '): no session — login required');
      return null;
    }
    var resp = await session.fetch('/v1/ext/' + EXT_NAME + '/' + actionId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    if (!resp || !resp.ok) {
      console.warn('[cortex] callExt(' + actionId + '): failed', resp?.error || resp?.status);
      return null;
    }
    return resp.data?.result ?? resp.data ?? null;
  } catch(e) {
    console.warn('[cortex] callExt(' + actionId + '):', e.message);
    return null;
  }
}

// Usage in your method:
const result = await callExt('${unitDef.calls}', { /* input */ });
// ALWAYS null-check: if (!result) return fallbackValue;
\`\`\`
IMPORTANT: session.fetch() returns ALREADY-PARSED JSON — do NOT call resp.json(). Use resp.data directly.
IMPORTANT: ALWAYS null-check the result — callExt returns null on auth failure or network error.`;
  } else if (unitDef.reads) {
    accessPattern = `
## Memory Read Pattern
\`\`\`javascript
// Read extension data from ext: namespace
const data = await AIMEAT.data.getPublic('ext:<extension-name>', '${unitDef.reads}');
// ALWAYS null-check: data may be null on first run
\`\`\`
IMPORTANT: Do NOT use session.fetch — it does not exist in cortex scope.`;
  }

  return `${INSTRUCTION_DISCLAIMER}
# Task: Implement Cortex Method — \`${unitDef.name}\`

You are implementing ONE method for an AIMEAT ${isDataCortex ? 'data' : 'feature'} cortex. Return ONLY the function.

## Skeleton (full contract)
\`\`\`yaml
${typeof skeleton === 'string' ? skeleton : JSON.stringify(skeleton, null, 2)}
\`\`\`

## This Method's Contract
- **Name:** ${unitDef.name}
- **Params:** \`${JSON.stringify(unitDef.params || {})}\`
- **Returns:** \`${JSON.stringify(unitDef.returns || {})}\`
${unitDef.calls ? `- **Calls extension action:** ${unitDef.calls}` : ''}
${unitDef.reads ? `- **Reads memory key:** ${unitDef.reads}` : ''}
${accessPattern}
${extensionProbeResult ? `
## Extension Probe Result (real data — match this shape)
\`\`\`json
${JSON.stringify(extensionProbeResult, null, 2).slice(0, 2000)}
\`\`\`` : ''}

## Output Format

Return ONLY the method function:

\`\`\`javascript
async function ${unitDef.name}(${unitDef.params ? Object.keys(unitDef.params).join(', ') : ''}) {
  // your implementation here
}
\`\`\`
`;
}

/**
 * Build prompt for implementing a single feature cortex UI section.
 * Produces the section's render function — one self-contained UI area.
 */
export function buildFeatureCortexSectionPrompt({ skeleton, sectionDef, dataCortexProbe, platformUiExample, translationKeys }) {
  // Default platform UI examples for common component types
  const defaultUiExamples = {
    input: `var nameInput = AIMEAT['aimeat-ui-forms'].Input({ label: 'Hakusana', placeholder: 'Hae...', type: 'text' });
container.appendChild(nameInput.el);
// Read value: nameInput.getValue()
// Listen: nameInput.el.querySelector('input').addEventListener('input', function(e) { ... });`,
    button: `var btn = document.createElement('button');
btn.textContent = t('search.button') || 'Hae';
btn.onclick = async function() { /* action */ };
container.appendChild(btn);`,
    table: `var table = AIMEAT['aimeat-ui-viewers'].DataTable({
  columns: [{ key: 'name', label: 'Nimi', sortable: true }, { key: 'id', label: 'ID' }],
  rows: data,
  sortable: true, filterable: true, pageSize: 20
});
container.appendChild(table);
// NOTE: DataTable does NOT have onRowClick. Build your own card list for clickable rows.`,
    timeline: `var timeline = AIMEAT['aimeat-ui-viewers'].Timeline({
  events: changes.map(function(c) {
    return { date: c.detectedAt, title: c.field, description: (c.oldValue || '-') + ' → ' + (c.newValue || '-') };
  })
});
container.appendChild(timeline);`,
    list: `// Build a simple list with items
items.forEach(function(item) {
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;justify-content:space-between;padding:8px;border-bottom:1px solid #eee;';
  row.textContent = item.name || item.id;
  container.appendChild(row);
});`,
    card: `var card = document.createElement('div');
card.style.cssText = 'padding:16px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;';
card.innerHTML = '<h3>' + title + '</h3><p>' + content + '</p>';
container.appendChild(card);`,
    tabs: `var tabs = AIMEAT['aimeat-ui-nav'].Tabs({
  target: container,
  tabs: [{ id: 'tab1', label: 'Tab 1' }, { id: 'tab2', label: 'Tab 2' }],
  active: 'tab1',
  onChange: function(tabId) { switchTab(tabId); }
});`,
    toggle: `var toggle = AIMEAT['aimeat-ui-forms'].Toggle({
  label: 'Ilmoitukset', checked: true,
  onChange: function(checked) { savePref(checked); }
});
container.appendChild(toggle.el);`,
    select: `var sel = AIMEAT['aimeat-ui-forms'].Select({
  label: 'Kieli', options: [{ value: 'fi', label: 'Suomi' }, { value: 'en', label: 'English' }]
});
container.appendChild(sel.el);
// Read value: sel.getValue()`,
  };

  // Show only the platform UI components this section uses
  let uiExampleText = '';
  const uiComponents = sectionDef.uses?.ui || [];
  if (uiComponents.length > 0) {
    uiExampleText = `
## Platform UI Components (only the ones this section uses)
${uiComponents.map(comp => {
    const example = platformUiExample?.[comp] || defaultUiExamples[comp];
    return example ? `### ${comp}\n\`\`\`javascript\n${example}\n\`\`\`` : `### ${comp}\n(use standard DOM creation)`;
  }).join('\n\n')}`;
  }

  return `${INSTRUCTION_DISCLAIMER}
# Task: Implement Feature Cortex Section — \`${sectionDef.id}\`

You are implementing ONE UI section for a feature cortex. Return ONLY the section render function.

## Skeleton (full contract)
\`\`\`yaml
${typeof skeleton === 'string' ? skeleton : JSON.stringify(skeleton, null, 2)}
\`\`\`

## This Section's Definition
- **ID:** ${sectionDef.id}
- **Description:** ${sectionDef.description || ''}
- **Data methods used:** ${sectionDef.uses?.data?.join(', ') || 'none'}
- **UI components used:** ${sectionDef.uses?.ui?.join(', ') || 'none'}
- **Translation keys:** ${(sectionDef.translationKeys || []).join(', ') || 'none'}
${dataCortexProbe ? `
## Data Cortex Probe Results (real data for the methods this section uses)
${Object.entries(dataCortexProbe).filter(([method]) => sectionDef.uses?.data?.includes(method)).map(([method, result]) => `### ${method}()\n\`\`\`json\n${JSON.stringify(result, null, 2).slice(0, 1000)}\n\`\`\``).join('\n\n')}` : ''}
${uiExampleText}

## Translation Helper Pattern
\`\`\`javascript
// t() is available in scope — use for all user-visible text
var label = t('${(translationKeys || [])[0] || 'section.title'}');
\`\`\`

## Async Data Loading Pattern (CRITICAL)
Data cortex methods return Promises. Handle loading states:
\`\`\`javascript
// Show loading state
container.innerHTML = '<p>Ladataan...</p>';
// Call data cortex method
var data = await dataCortex.someMethod();
// ALWAYS null-check — callExt returns null on auth failure or first run
if (!data || (Array.isArray(data) && data.length === 0)) {
  container.innerHTML = '<p>' + (t('empty.key') || 'Ei dataa') + '</p>';
  return;
}
// Now render the data...
\`\`\`

## Nested Object Helper
API responses contain nested objects. Use this to safely render values:
\`\`\`javascript
function dv(val) {
  if (val == null) return '-';
  if (typeof val === 'string' || typeof val === 'number') return String(val);
  if (val.value) return val.value;
  if (val.url) return val.url;
  if (val.name) return val.name;
  if (Array.isArray(val)) return val.map(dv).join(', ');
  return JSON.stringify(val);
}
\`\`\`

## Output Format

Return ONLY the section render function:

\`\`\`javascript
function render${sectionDef.id.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('')}(container, { dataCortex, t }) {
  // your implementation here
}
\`\`\`
`;
}

/**
 * Build prompt for implementing a single app view.
 * Produces the view's HTML fragment + mount function.
 */
export function buildAppViewUnitPrompt({ skeleton, viewDef, featureCortexRenderSpec, translationKeys }) {
  return `${INSTRUCTION_DISCLAIMER}
# Task: Implement App View — \`${viewDef.id}\`

You are implementing ONE view for an AIMEAT app. Return the view HTML + mount function.

## Skeleton (full contract)
\`\`\`yaml
${typeof skeleton === 'string' ? skeleton : JSON.stringify(skeleton, null, 2)}
\`\`\`

## This View's Definition
- **ID:** ${viewDef.id}
- **Tab label key:** ${viewDef.tab || viewDef.id}
- **Feature cortex:** ${viewDef.feature || 'none'}
- **Layout:** ${viewDef.layout || 'default'}
${translationKeys?.length ? `- **Translation keys:** ${translationKeys.join(', ')}` : ''}
${featureCortexRenderSpec ? `
## Feature Cortex Render Spec
The feature cortex exposes \`render(container)\`. Call it to render the feature into the view container.
\`\`\`
${typeof featureCortexRenderSpec === 'string' ? featureCortexRenderSpec.slice(0, 1500) : JSON.stringify(featureCortexRenderSpec, null, 2).slice(0, 1500)}
\`\`\`` : ''}

## Output Format

Return the view HTML and mount function:

\`\`\`html
<!-- View: ${viewDef.id} -->
<div id="view-${viewDef.id}" class="app-view" style="display:none;">
  <!-- view content -->
</div>
\`\`\`

\`\`\`javascript
function mount${viewDef.id.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('')}(container, { cortex, t }) {
  // mount feature cortex into container
}
\`\`\`
`;
}

/* ── Assembly Prompt Builders (Multi-Pass Pipeline) ──── */

/**
 * Combine extension skeleton + all unit implementations into final YAML manifest + JS actions.
 * Assembly is mechanical — no new logic, just combining pieces.
 */
export function buildExtensionAssemblyPrompt({ skeleton, units, label }) {
  return `${INSTRUCTION_DISCLAIMER}
# Task: Assemble Extension — ${label}

You are ASSEMBLING a complete AIMEAT extension from a skeleton and pre-built unit implementations. This is MECHANICAL assembly — do NOT modify the unit implementations.

## Skeleton (the contract)
\`\`\`yaml
${typeof skeleton === 'string' ? skeleton : JSON.stringify(skeleton, null, 2)}
\`\`\`

## Unit Implementations
${units.map((u, i) => `### Action: ${u.id} (unit ${i + 1})\n\`\`\`javascript\n${u.code}\n\`\`\``).join('\n\n')}

## Output Format

Produce the complete extension: YAML manifest first, then fenced JS blocks per action.

\`\`\`yaml
metadata:
  name: <kebab-case-name>
  version: "1.0.0"
  description: "<from skeleton — double-quoted, one line>"
  author: foundry
  required_apis: [memory]
  config: {}
  limits:
    memory_mb: 128
    timeout_ms: 30000
    max_api_calls: 500
actions:
  - id: <action-id>
    description: "<from skeleton>"
    method: POST
    path: /v1/ext/<extension-name>/<action-path-from-skeleton>
    auth: required
    input: <schema>
    output: <schema>
    script: <action-id>.js
  # ... repeat for EVERY action from the skeleton
schedules:
  - id: <schedule-id>
    action: <action-id>
    cron: "<expression>"
    description: "<what it does>"
    instance_scope: false
    input: {}
\`\`\`

Then one fenced JS block per action (use \`// actions/<action-id>.js\` comment):

\`\`\`javascript
// actions/<action-id>.js
export default async function(ctx, input) {
  // EXACT code from the unit implementation above — do NOT modify
}
\`\`\`

## CRITICAL RULES

1. **Do NOT modify the unit implementations.** Copy each action function exactly as provided.
2. **Use action IDs, schemas, and config from the skeleton.** Do not rename or reorder.
3. **Every action in the skeleton must appear in the manifest AND have a JS block.**
4. **Assembly is mechanical.** You are combining pieces, not generating new logic.
5. **metadata MUST include \`author: foundry\`** — the validator requires this field.
6. **Every action MUST have \`method: POST\` and \`path: /v1/ext/<name>/<path>\`** — the validator requires these.
7. **All action JS MUST use \`export default async function(ctx, input)\`** — the V8 sandbox requires ES module default export.

${HTML_ENTITY_RULES}
`;
}

/**
 * Combine cortex skeleton + all unit implementations into final cortex YAML manifest + JS IIFE.
 */
export function buildCortexAssemblyPrompt({ skeleton, units, label, subtype }) {
  const subtypeLabel = subtype === 'data' ? 'Data Cortex' : subtype === 'feature' ? 'Feature Cortex' : 'App-Domain Cortex';

  return `${INSTRUCTION_DISCLAIMER}
# Task: Assemble ${subtypeLabel} — ${label}

You are ASSEMBLING a complete AIMEAT cortex library from a skeleton and pre-built unit implementations. This is MECHANICAL assembly — do NOT modify the unit implementations.

## Skeleton (the contract)
\`\`\`yaml
${typeof skeleton === 'string' ? skeleton : JSON.stringify(skeleton, null, 2)}
\`\`\`

## Unit Implementations
${units.map((u, i) => `### ${u.name || u.id} (unit ${i + 1})\n\`\`\`javascript\n${u.code}\n\`\`\``).join('\n\n')}

## Output Format

Produce the complete cortex: YAML manifest block, then the JS IIFE.

\`\`\`yaml
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: <kebab-case-name>
  version: "1.0.0"
  description: "<from skeleton>"
components:
  - type: lib
    filename: <name>.js
    exports: [<method-names>]
\`\`\`

\`\`\`javascript
// <name>.js — ${subtypeLabel} IIFE
(function (AIMEAT) {
  'use strict';
  const LIB_NAME = '<camelCaseName>'; // kebab "my-lib" → camelCase "myLib"
  const EXT_NAME = '<extension-name>'; // the extension this cortex wraps

  // --- callExt helper — uses session.fetch() for proper auth ---
  async function callExt(actionId, body) {
    try {
      if (!AIMEAT.auth || !AIMEAT.auth.getSession) {
        console.warn('[' + LIB_NAME + '] callExt(' + actionId + '): auth not available');
        return null;
      }
      var session = AIMEAT.auth.getSession();
      if (!session || !session.fetch) {
        console.warn('[' + LIB_NAME + '] callExt(' + actionId + '): no active session — login required');
        return null;
      }
      var resp = await session.fetch('/v1/ext/' + EXT_NAME + '/' + actionId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      });
      if (!resp || !resp.ok) {
        console.warn('[' + LIB_NAME + '] callExt(' + actionId + '): failed', resp?.error || resp?.status);
        return null;
      }
      return resp.data?.result ?? resp.data ?? null;
    } catch(e) {
      console.warn('[' + LIB_NAME + '] callExt(' + actionId + '):', e.message);
      return null;
    }
  }

  // --- readExtMemory helper — reads extension-owned data ---
  async function readExtMemory(key) {
    try { return await AIMEAT.data.getPublic('ext:' + EXT_NAME, key); }
    catch(e) { return null; }
  }

  // --- Translation helper — reads from AIMEAT._translations (set by app-domain cortex init) ---
  function t(key) {
    var translations = AIMEAT._translations || {};
    return translations[key] || '';
  }

  // --- Nested object display helper ---
  function dv(val) {
    if (val == null) return '-';
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (val.value) return val.value;
    if (val.url) return val.url;
    if (val.name) return val.name;
    if (Array.isArray(val)) return val.map(dv).join(', ');
    return JSON.stringify(val);
  }

  // --- Unit implementations (copied exactly) ---
  // PASTE each unit function here.

  // --- Registration ---
  const exports = { /* all public method names */ };
  if (AIMEAT.register) AIMEAT.register(LIB_NAME, exports);
  AIMEAT[LIB_NAME] = exports;
})(window.AIMEAT || (window.AIMEAT = {}));
\`\`\`

YAML manifest MUST include \`namespace: community\` under metadata.

## CRITICAL RULES

1. **Do NOT modify the unit implementations.**
2. **YAML metadata.name (kebab-case) and JS LIB_NAME (camelCase) must correspond.** Example: \`prh-tietokerros\` → \`prhTietokerros\`.
3. **YAML metadata MUST have namespace: community.**
4. **Every method from the skeleton must appear in the exports object.**
5. **Use (function(AIMEAT){...})(window.AIMEAT||(window.AIMEAT={}))** — NOT (function(){...})().
6. **Must have \`const exports = { ... }\`** — the validator checks for this pattern.
7. **Assembly is mechanical.** Combine pieces, don't generate new logic.
8. **callExt uses session.fetch()** which returns ALREADY-PARSED JSON. Use \`resp.data\`, NEVER \`resp.json()\`.
9. **callExt returns null on error** — all methods MUST null-check results before using them.
10. **ALWAYS handle null from callExt gracefully** — return empty arrays \`[]\` or empty objects \`{}\`, NEVER crash.

${HTML_ENTITY_RULES}
`;
}

/**
 * Combine app skeleton + all view unit implementations into complete HTML document.
 */
export function buildAppAssemblyPrompt({ skeleton, units, label, appDomainCortexName, designSystem }) {
  return `${INSTRUCTION_DISCLAIMER}
# Task: Assemble App — ${label}

You are ASSEMBLING a complete AIMEAT app HTML document from a skeleton and pre-built view implementations. This is MECHANICAL assembly — do NOT modify the unit implementations.

## Skeleton (the contract)
\`\`\`yaml
${typeof skeleton === 'string' ? skeleton : JSON.stringify(skeleton, null, 2)}
\`\`\`

## View Implementations
${units.map((u, i) => `### View: ${u.id} (unit ${i + 1})\n**HTML:**\n\`\`\`html\n${u.html || ''}\n\`\`\`\n**JS:**\n\`\`\`javascript\n${u.code || ''}\n\`\`\``).join('\n\n')}

## App-Domain Cortex
Name: ${appDomainCortexName || '<from skeleton>'}
${designSystem ? `\n## Design System\n${designSystem}` : ''}

## Output Format

Produce the complete HTML document. EVERY section below is MANDATORY:

\`\`\`html
<!-- AIMEAT App Manifest
name: <kebab-case-name>
version: 1.0.0
description: <one-line description>
entry: index.html
-->
<!DOCTYPE html>
<html lang="fi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${label}</title>
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; connect-src 'self';">
  <style>
    :root {
      --color-primary: #3b82f6;
      --color-secondary: #64748b;
      --color-success: #22c55e;
      --color-danger: #ef4444;
      --color-bg: #ffffff;
      --color-text: #1e293b;
      --color-text-dim: #64748b;
      --color-border: #e2e8f0;
      --radius: 8px;
      --spacing-sm: 8px;
      --spacing-md: 16px;
      --spacing-lg: 24px;
      --font-sans: system-ui, -apple-system, sans-serif;
    }
    body { font-family: var(--font-sans); margin: 0; padding: 0; color: var(--color-text); }
    #app { max-width: 900px; margin: 0 auto; padding: var(--spacing-md); }
    /* Add your app styles here */
  </style>
</head>
<body>
  <!-- Error collector — surfaces runtime errors in UI -->
  <script>
    (function() {
      var errors = [];
      window.onerror = function(msg, src, line) {
        errors.push({ msg: msg, src: src, line: line, at: new Date().toISOString() });
        showErrors();
      };
      window.addEventListener('unhandledrejection', function(e) {
        errors.push({ msg: String(e.reason), src: 'promise', line: 0, at: new Date().toISOString() });
        showErrors();
      });
      function showErrors() {
        var el = document.getElementById('app-errors');
        if (!el) {
          el = document.createElement('div');
          el.id = 'app-errors';
          el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#1a0000;color:#ff6b6b;font-size:12px;padding:8px;max-height:120px;overflow:auto;z-index:9999;font-family:monospace;border-top:2px solid #f44';
          document.body.appendChild(el);
        }
        el.innerHTML = errors.map(function(e) { return e.at.slice(11,19) + ' ' + e.msg; }).join('<br>');
      }
    })();
  </script>

  <div id="auth-container"></div>
  <!-- View containers (from unit HTML — copy exactly) -->
  <div id="app"></div>

  <script>
    // loadScript helper — loads scripts sequentially
    function loadScript(src) {
      return new Promise(function(resolve, reject) {
        var s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = function() { reject(new Error('Failed to load: ' + src)); };
        document.head.appendChild(s);
      });
    }

    // Boot sequence — MUST load libraries in correct order
    (async function() {
      try {
        // 1. Load AIMEAT platform libraries FIRST
        await loadScript('/v1/libs/aimeat-auth.js');
        await loadScript('/v1/libs/aimeat-data.js');

        // 2. Load platform UI libraries
        await loadScript('/v1/cortex/aimeat-ui-nav/libs/aimeat-ui-nav.js');
        await loadScript('/v1/cortex/aimeat-ui-layout/libs/aimeat-ui-layout.js');
        await loadScript('/v1/cortex/aimeat-ui-viewers/libs/aimeat-ui-viewers.js');
        await loadScript('/v1/cortex/aimeat-ui-forms/libs/aimeat-ui-forms.js');
        await loadScript('/v1/cortex/aimeat-ui-dialogs/libs/aimeat-ui-dialogs.js');

        // 3. Load domain cortex libraries (data cortex → feature cortexes → app-domain)
        // ADD ALL cortex script tags here in dependency order

        // 4. Auth: try to restore session
        AIMEAT.auth.mountLoginButton('#auth-container', {
          onLogin: function() { startApp(); },
          onLogout: function() { location.reload(); }
        });
        var session = await AIMEAT.auth.login();
        if (session) startApp();

      } catch(err) {
        document.getElementById('app').innerHTML =
          '<div style="padding:2rem;color:#ef4444"><h2>Failed to load</h2><p>' + err.message + '</p></div>';
      }
    })();

    async function startApp() {
      var cortex = AIMEAT['<camelCaseName>'];  // app-domain cortex
      if (!cortex) {
        document.getElementById('app').innerHTML = '<p>App cortex not loaded</p>';
        return;
      }
      await cortex.init();
      cortex.render(document.getElementById('app'));
    }
  </script>
</body>
</html>
\`\`\`

## CRITICAL RULES

1. **MUST start with \`<!-- AIMEAT App Manifest ... -->\` comment** — the validator checks for this.
2. **MUST load aimeat-auth.js and aimeat-data.js** before any cortex scripts.
3. **MUST call AIMEAT.auth.mountLoginButton('#auth-container', ...)** for login UI.
4. **MUST call AIMEAT.auth.login()** to restore session before starting the app.
5. **MUST load cortex scripts in dependency order**: data cortex → feature cortexes → app-domain cortex.
6. **startApp() is called ONLY after successful login** — the cortex init() and render() require auth.
7. **Do NOT modify the view unit implementations.** Copy HTML and JS exactly as provided.
8. **Include the error collector script** at the top of body for diagnostics.
9. **Include CSP meta tag** if loading any CDN scripts.

${HTML_ENTITY_RULES}
`;
}
