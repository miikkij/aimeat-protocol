/**
 * @file generator-prompts.js
 * @description Prompt templates for the service generator — blueprint analysis,
 *   per-component-type generation prompts, and fix/retry prompts.
 *   Used by generator-tab.js to produce copy-to-clipboard prompts for AI chat.
 * @structure
 *   - AIMEAT_CONTEXT: shared preamble describing building blocks
 *   - buildBlueprintPrompt(description): lightweight JSON blueprint prompt
 *   - buildComponentPrompt(type, label, ...): per-type generation prompt
 *   - buildInterviewPrompt(description): structured requirements interview prompt
 *   - buildBlueprintFixPrompt(description, errors): retry prompt for blueprint failures
 *   - buildFixPrompt(original, failed, errors): generic retry prompt for components
 *   - buildImpactPrompt(changeRequest, blueprint): change impact analysis prompt
 *   - buildEditPrompt(type, label, currentCode, changeRequest, upstreamChanges): targeted edit prompt
 *   - cortex template: IIFE domain library generation prompt
 * @usage import { buildBlueprintPrompt, buildComponentPrompt } from '/js/services/generator-prompts.js';
 * @version-history
 *   v1.0.0 — 2026-03-10 — Initial prompt templates
 *   v1.1.0 — 2026-03-14 — Tighten blueprint prompt to reject extra fields;
 *     add buildBlueprintFixPrompt that regenerates instead of patching
 *   v2.0.0 — 2026-03-14 — Fix MSM prompt to match real parseMsm() format
 *     (service/auth/actions structure, not name/endpoints); fix Extension prompt
 *     to match POST /v1/extensions format (metadata/actions with script refs)
 *   v2.1.0 — 2026-03-14 — Rewrite App prompt to use aimeat-auth.js library
 *     for automatic authentication instead of manual token/URL configuration
 *   v3.0.0 — 2026-03-14 — Major overhaul: add data standards to AIMEAT_CONTEXT,
 *     improve all prompts with sandbox limitations, real API limits, memory patterns,
 *     translation key conventions, app CDN/CSP guidance, ctx.fetch documentation
 *   v3.1.0 — 2026-03-15 — Generalize ext/cortex/app decision from case list to
 *     principle-based framework; harden JSON.parse prevention; fix translation locale
 *     key enforcement; add empty-state handling to cortex+app; HTML entity warnings;
 *     reduce completed-component context bloat
 *   v3.2.0 — 2026-03-15 — Add buildImpactPrompt and buildEditPrompt for Phase 6
 *     edit & change propagation
 *   v3.1.0 — 2026-03-14 — Fix app prompt: extension data lives in ext:{name}
 *     namespace, apps must use AIMEAT.data.getPublic() to read it, not .get()
 *   v4.0.0 — 2026-03-14 — Add buildInterviewPrompt for requirements interview,
 *     add cortex component type, pass interviewSpec through blueprint prompts
 *   v4.1.0 — 2026-03-14 — Make app template cortex-aware: detect completed cortex
 *     components, inject cortex script loads in boot(), show cortex API docs instead
 *     of raw extension/memory docs when cortex is available
 *   v4.2.0 — 2026-03-15 — Scope interview prompt to AIMEAT domain: remove
 *     framework/deployment/infra questions, add style/look-and-feel section,
 *     add style object to JSON spec output
 *   v4.3.0 — 2026-03-15 — Major interview prompt rewrite: add 20-question budget,
 *     explicit "YOU DECIDE" list for implementation details, batch questions per section,
 *     prioritize use cases (up to 8 questions), reduce other sections to 2-3 each,
 *     shorter summaries between sections
 *   v5.0.0 — 2026-03-15 — Phase 1-3 hardening: interview captures sample data + encoding,
 *     blueprint traces data pipeline + declares produces/consumes dependencies,
 *     extension prompt separates ctx.fetch from ctx.memory examples,
 *     app prompt adds CSS design system + CDN library menu + auth layout,
 *     buildComponentPrompt threads interviewSpec to extension prompts
 *   v5.1.0 — 2026-03-15 — Fix translation prompt: remove "MUST include BOTH locales"
 *     contradiction that caused duplicate generation; each component now generates
 *     only the single locale indicated by its label. Strengthen HTML entity prevention
 *     in extension prompt with prominent box warning. Improve examples to show
 *     single-locale output only.
 */

/* ── AIMEAT Capabilities Context ─────────────────────── */

const AIMEAT_CONTEXT = `
You are helping create an AIMEAT service. AIMEAT is an AI agent infrastructure protocol.

Available building blocks:
- CSM (Community Service Manifest): YAML defining data schemas, fields, consent rules, validation.
- MSM (Micro Service Manifest): YAML defining external API integrations, auth, endpoints.
- Extension: V8-sandboxed JavaScript logic with YAML manifest. Actions get ctx object with memory, wallet, consent, trust, fetch APIs.
- App: HTML/JS user interface published to the apps catalog.
- Memory: Key-value storage with namespace isolation.
- Translation: Per-locale i18n strings.
- Cortex: Client-side JS domain library (IIFE on AIMEAT namespace). Wraps extension APIs and memory reads into clean domain methods for apps.

Extensions run in an ISOLATED V8 sandbox with ONLY this API (no Node.js, no global fetch, no setTimeout, no require, no import):
  ctx.memory.get(key) → value or null (ALWAYS null-check before using: `|| []` or `|| {}`)
  ctx.memory.set(key, value) → void
  ctx.memory.search(prefix) → Array<{ key, value }> (NOT plain strings!)
  ctx.memory.delete(key) → boolean
  ctx.memory.getPublic(namespace, key) → value or null (read another extension's public data)
    Example: await ctx.memory.getPublic('ext:halytyskartta-rss', 'alerts.by-date.2026-03-14')
    Use this when your extension needs to read data written by ANOTHER extension.
  ctx.fetch(url, { method, headers, body }) → { status, ok, text, headers }
    Use ctx.fetch for ALL HTTP requests. Global fetch() is NOT available.
    Response body is always .text (string) — parse JSON with JSON.parse(resp.text).
    Encoding is handled automatically — the sandbox reads charset from the Content-Type header
    and decodes accordingly (e.g., ISO-8859-1 for RSS feeds). You get correct Unicode text.
  ctx.wallet.consume(amount, reason), ctx.wallet.getBalance()
  ctx.consent.check(gaii, scope), ctx.consent.require(gaii, scope)
  ctx.trust.getScore(gaii)
  ctx.caller = { gaii, owner, roles }
  ctx.config = extension config object (from manifest config section)
  ctx.instance = { id, config } (when called via instance endpoint)
  ctx.log.info/warn/error(msg, data)

AIMEAT Data Standards (MUST follow in ALL components):
  Dates/times: ISO 8601 ONLY — "2026-03-14T13:00:00.000Z". NEVER store RFC 2822 ("Sat, 14 Mar ..."), Unix timestamps, or locale-formatted dates. Convert all dates to ISO before storing.
  Memory keys: lowercase dot-namespaced — "alerts.by-date.2026-03-14". Dates in keys MUST use YYYY-MM-DD.
  IDs: URL-safe strings (kebab-case or hex hashes). No spaces, no special characters.
  Locale codes: BCP 47 — "fi", "en", "fi-FI", "en-US".
  Coordinates: { latitude: number, longitude: number } — WGS84 decimal degrees.
  Currency/amounts: integers (no floats) — morsels are whole numbers.
`.trim();

/* ── Blueprint Prompt ────────────────────────────────── */

export function buildBlueprintPrompt(description, interviewSpec = null) {
  const specContext = interviewSpec ? `
## Refined Specification (from requirements interview)
\`\`\`json
${JSON.stringify(interviewSpec, null, 2)}
\`\`\`

Use the specification above to determine the exact components needed. The data sources, entities, views, and constraints have been validated with the user.
` : '';

  // Thread language from interview spec to blueprint prompt
  const specLocale = interviewSpec?.locale;
  const langNote = specLocale && specLocale !== 'en'
    ? `\n## LANGUAGE\n\nThe user's language is "${specLocale}". Write all human-readable labels and descriptions in that language.\nJSON keys and technical identifiers stay in English.\n`
    : '';

  return `${AIMEAT_CONTEXT}

The user wants to create this service:
---
${description}
---
${specContext}${langNote}
Analyze this request and produce a JSON blueprint listing ALL components needed.

CRITICAL: Return ONLY a JSON object with "components" and "phases" arrays. Nothing else.
Each component has EXACTLY five fields: "id", "type", "label", "produces", "consumes". No other fields.
Do NOT include manifest content, code, HTML, translations, or any implementation details.
The blueprint is a lightweight plan — actual content is generated later per component.

Format:
{
  "components": [
    { "id": "csm-1", "type": "csm", "label": "Human-readable name", "produces": ["memory:service.schema"], "consumes": [] },
    { "id": "ext-1", "type": "extension", "label": "Human-readable name", "produces": ["memory:alerts.by-date.*"], "consumes": [] },
    { "id": "cortex-1", "type": "cortex", "label": "Human-readable name", "produces": ["api:getAlerts"], "consumes": ["memory:alerts.by-date.*"] },
    { "id": "app-1", "type": "app", "label": "Human-readable name", "produces": [], "consumes": ["api:getAlerts"] }
  ],
  "phases": [
    { "id": "define", "label": "Define Service", "componentIds": ["csm-1"] },
    { "id": "logic", "label": "Build Logic", "componentIds": ["ext-1"] },
    { "id": "connect", "label": "Connect & Integrate", "componentIds": ["cortex-1"] },
    { "id": "ui", "label": "Build UI", "componentIds": ["app-1"] }
  ]
}

Rules:
- Component types: csm, msm, extension, app, memory, translation, cortex
- IDs use format: {type}-{number} (e.g., csm-1, ext-1, app-1)
- Each component object has these fields: "id", "type", "label", "produces", "consumes"
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
- CORTEX: Cortex is the middleware between memory and apps. It wraps ALL memory access into clean domain methods: data queries, settings, i18n, computed values. Apps should NEVER read memory directly — they call cortex methods.

## Data Pipeline Verification (do this BEFORE listing components)

For each VIEW in the spec, trace the data path:
1. What fields does this view need to render?
2. Where does each field come from? (external source, computed, user input)
3. Does the source provide this field directly, or does a component need to transform/enrich it?
4. If a field has no clear path from source to view, add a component that produces it.

Example: A map view needs lat/lng coordinates. If the data source only has city names,
the blueprint must include a component that maps city names to coordinates.

## Component Dependencies

Each component MUST declare what it produces and consumes:
- Extensions produce memory keys (e.g., "memory:alerts.by-date.*")
- Cortex libraries produce API methods (e.g., "api:getAlerts") and consume memory keys
- Apps consume API methods or memory keys
- Every "consumes" entry must be matched by a "produces" entry in another component

## CRITICAL: Extension vs Cortex vs App — Decision Framework

### The One Rule: EXTENSION = SERVER-ONLY WORK
An extension MUST do something that a browser CANNOT do. If a browser can do it, it MUST NOT be an extension.

**Use extension when ALL of these are true:**
1. The work REQUIRES the server (external API behind CORS/auth, scheduled cron, server-to-server calls)
2. The work must happen even when NO browser is open
3. There is no way to achieve it with client-side JS + AIMEAT.data API

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
The memory component's "produces" should reflect the memory key pattern (e.g., "memory:municipalities.*").
Place it in an early phase (before extensions that consume it).

### Common Mistakes to Avoid
- Do NOT create an "export" extension — apps generate files client-side
- Do NOT create a "settings" extension — settings go in a memory component (defaults) and cortex (read/write methods)
- Do NOT create a "query" or "filter" extension — cortex reads memory directly
- Do NOT create a "compute" extension for math/stats — cortex/app does client-side math

### How They Work Together
- Extension: fetches external data → stores in memory (scheduled, server-side)
- Cortex: reads extension memory → transforms → exposes clean domain API (client-side library)
- App: calls cortex methods → renders UI → handles user interaction (client-side HTML/JS)`;
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

  return `You are a requirements analyst for the AIMEAT service generator.
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
      - If the user mentions a URL: try to fetch it and describe what you see
        - If you CANNOT access it, say so honestly — NEVER pretend you accessed something
      - For EVERY external source: capture at least ONE real sample entry in the spec
        - If you can fetch it, include one raw entry verbatim (one RSS <item>, one JSON object, etc.)
        - If you CANNOT fetch it, ask the user to paste one real sample entry
        - NEVER generate parsing code based on assumed format — you need real evidence
      - Note any non-obvious characteristics: encoding declaration, nested structures,
        timestamps with ambiguous formats, mixed-language content
      - Is any data user-generated or computed from other data?

      STATIC / USER-PROVIDED DATA (type: "user-input"):
      - If the user provides a complete dataset (coordinate lists, lookup tables, category mappings, etc.),
        you MUST capture the ENTIRE dataset in the "staticData" field as a JSON array of {key, value} objects.
      - Do NOT truncate, summarize, or put only one sample row — include EVERY row the user provides.
      - Parse the user's format (TSV, CSV, pasted table, etc.) into clean JSON objects.
        Example: "Helsinki\\t60.166°N, 24.943°E" → { "key": "Helsinki", "value": { "lat": 60.166, "lon": 24.943 } }
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
      - Color feel: suggest a palette based on the domain (e.g., "neutral + severity colors" for alerts)
      - Layout preference: tabs, single page, split panels?
      - Any apps or websites whose look they admire?

   f) CONSTRAINTS & PREFERENCES (1-2 questions)
      Ask in ONE batch:
      - How often should data refresh?
      - What languages does the UI need?
      - Any domain-specific rules the generator should know?

3. STAY IN SCOPE — This is an AIMEAT service:
   - The AIMEAT platform handles: storage, scheduling, auth, serving, i18n
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
      "staticData": "For type 'user-input' ONLY: the COMPLETE dataset as an array of {key, value} objects. Include EVERY row the user provided, parsed into clean JSON. Example: [{ \"key\": \"Helsinki\", \"value\": { \"lat\": 60.166, \"lon\": 24.943 } }]. Omit this field for non-user-input sources.",
      "updateFrequency": "realtime|minutes|hourly|daily|on-demand",
      "sampleFields": ["field1", "field2"],
      "notes": "Any observations from fetching/analyzing the source",
      "verified": true
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

/* ── Component Prompts ───────────────────────────────── */

const COMPONENT_TEMPLATES = {
  csm: (label, context) => `${AIMEAT_CONTEXT}

Create a CSM (Community Service Manifest) YAML for: ${label}

${context}

## YAML STRING RULES (read this FIRST — violations cause parse errors)

Every string value MUST be on ONE line wrapped in double quotes. No exceptions.
NEVER use > or | (block scalars). NEVER leave strings unquoted.

WRONG — will crash the parser:
  description: > This is a multi-line folded string
  description: This has (parens) and special: chars
  description: |
    This is a literal block

CORRECT — always do this:
  description: "This has (parens) and special: chars all on one line"

## Structure

Return ONLY valid YAML in a yaml code block. Copy this structure EXACTLY:
\`\`\`yaml
csm: "1.0"
service:
  name: kebab-case-name
  type: directory
  description: "What this service does — keep on ONE line in double quotes"
  version: "1.0"
schema_mode: open
data_schema:
  required:
    fieldName:
      type: string
    anotherField:
      type: number
  optional:
    optionalField:
      type: string
      enum: [value1, value2]
consent_requirements:
  visibility_default: public
  requires_consent: false
  consent_purpose: "Why consent is needed"
  data_retention: "365_days"
moderation:
  flags_enabled: true
  auto_hide_threshold: 5
  appeals_enabled: false
ui_hints:
  list_view: [fieldName, anotherField]
  detail_view: [fieldName, anotherField, optionalField]
  search_fields: [fieldName]
\`\`\`

## Additional rules
- data_schema.required and data_schema.optional are MAPS (fieldName: {type: ...}), NOT arrays (- name: ...)
- data_schema.required MUST have at least one field
- Field types: string, number, integer, boolean, array, object
- All date/time fields MUST be type: string with description mentioning ISO 8601 format
- Keep fields reasonable — only what the service actually needs`,

  msm: (label, context) => `${AIMEAT_CONTEXT}

Create an MSM (Micro Service Manifest) YAML for: ${label}

${context}

## YAML STRING RULES (read this FIRST — violations cause parse errors)

Every string value MUST be on ONE line wrapped in double quotes. No exceptions.
NEVER use > or | (block scalars). NEVER leave strings unquoted.

WRONG: description: > This is a folded string
WRONG: description: This has (parens) and colons: here
CORRECT: description: "This has (parens) and colons: here — all on one line"

## Structure

Return ONLY valid YAML in a yaml code block. Copy this structure EXACTLY:
\`\`\`yaml
msm: "1.0"
service:
  name: "Human Readable Service Name"
  description: "What this integration does — one line, double quoted"
  homepage: "https://api.example.com"
  category: data
  tags: [tag1, tag2]
auth:
  type: none
  param_name: ""
  env_var: ""
actions:
  - id: action-id
    display_name: "Human Readable Action Name"
    description: "What this action does"
    endpoint:
      method: GET
      url: "https://api.example.com/path?q={input.query}"
    input:
      query:
        type: string
        required: true
        description: "Search query"
    output:
      result:
        type: string
        description: "The result"
\`\`\`

## Additional rules
- \`service\` section with \`name\`, \`description\`, \`category\` is REQUIRED
- \`category\` must be one of: data, utility, image, communication, analytics, analysis
- \`auth.type\` must be one of: bearer, query_param, oauth2, api_key, none
- For public APIs (RSS feeds, open data) use \`auth.type: none\` — many APIs don't require authentication
- \`actions\` is an array — each action needs: id, display_name, description, endpoint (method + url), input, output
- Each action output MUST have at least one field`,

  extension: (label, context) => `${AIMEAT_CONTEXT}

Create an AIMEAT Extension for: ${label}

${context}

## YAML STRING RULES (read this FIRST — violations cause parse errors)

Every string value MUST be on ONE line wrapped in double quotes. No exceptions.
NEVER use > or | (block scalars). NEVER leave strings unquoted.

WRONG: description: > This is a folded string
WRONG: description: This has (parens) and colons: here
CORRECT: description: "This has (parens) and colons: here — all on one line"

## V8 Sandbox Constraints (CRITICAL — read before writing code)

Extension code runs in an ISOLATED V8 sandbox. The following are NOT available:
- No \`require()\`, no \`import\` (except \`export default\` for the action entry point)
- No Node.js APIs (fs, path, crypto, Buffer, process, etc.)
- No \`fetch()\` global — use \`ctx.fetch()\` instead
- No \`setTimeout\`, \`setInterval\`, \`setImmediate\`
- No \`console.log\` — use \`ctx.log.info/warn/error()\`
- No DOM APIs (document, window, etc.)

What IS available:
- Standard JS built-ins: JSON, Math, Date, String, Array, Object, Map, Set, RegExp, Promise, etc.
- \`ctx\` API object (memory, fetch, wallet, consent, trust, caller, config, log)
- \`export default async function(ctx, input) { ... }\` — the action entry point

## ctx.memory API — CRITICAL details

### ctx.memory.get(key) — WILL CRASH if you use JSON.parse()

ctx.memory.get() returns the VALUE directly (already a JS object/array/value), or null.
It is NOT a string. Calling JSON.parse() on it will CRASH with "null is not valid JSON".

╔══════════════════════════════════════════════════════════════╗
║  NEVER WRITE: JSON.parse(await ctx.memory.get(...))         ║
║  NEVER WRITE: JSON.parse(ctx.memory.get(...))               ║
║  NEVER WRITE: const x = JSON.parse(someMemoryValue)         ║
║  These ALL crash. The value is ALREADY PARSED.               ║
╚══════════════════════════════════════════════════════════════╝

WRONG (CRASHES EVERY TIME):
  const data = JSON.parse(await ctx.memory.get("my.key"));  // "undefined" is not valid JSON

CORRECT:
  const data = await ctx.memory.get("my.key");
  if (!data) return { error: "No data found" };
  // data is already a JS object/array/value — use it directly

### ctx.memory.get() returns null when key does not exist — ALWAYS null-check!

╔══════════════════════════════════════════════════════════════╗
║  ALWAYS check the return value before using it.              ║
║  Arrays and objects from memory may be null on first run.    ║
╚══════════════════════════════════════════════════════════════╝

WRONG (CRASHES on first run when no data exists yet):
  const index = await ctx.memory.get("alerts.__index");
  index.some(...)     // 💥 Cannot read properties of null (reading 'some')
  index.push(...)     // 💥 Cannot read properties of null (reading 'push')
  index.length        // 💥 Cannot read properties of null (reading 'length')

CORRECT:
  const index = await ctx.memory.get("alerts.__index") || [];
  index.some(...)     // ✓ works — falls back to empty array

CORRECT (for objects):
  const stats = await ctx.memory.get("daily.stats") || {};
  stats.count = (stats.count || 0) + 1;

### ctx.memory.set(key, value) stores any JSON-serializable value
  await ctx.memory.set("alerts.2026-03-14", { items: [...], count: 5 });

### ctx.memory.search(prefix) returns objects, NOT strings — returns ALL matching keys (no pagination)
WARNING: search() loads ALL matching keys into memory at once. If your prefix matches thousands of keys, the V8 sandbox may run out of memory. Use specific prefixes (e.g., "alerts.by-date.2026-03-14" not "alerts.")

WRONG:
  const keys = await ctx.memory.search("prefix.");
  for (const key of keys) { await ctx.memory.get(key); }  // ERROR: key is {key,value} not string

CORRECT:
  const results = await ctx.memory.search("prefix.");
  for (const entry of results) {
    const key = entry.key;    // string
    const value = entry.value; // the stored value — already parsed, NOT a string
  }

## Output format — SINGLE block, copy-paste friendly

Return EVERYTHING in ONE code block. The YAML manifest first, then all JavaScript files separated by // actions/filename.js comments. The user will copy-paste the entire response at once.

\`\`\`
metadata:
  name: kebab-case-name
  version: "1.0.0"
  description: "What this extension does — one line, double quoted"
  author: generator
required_apis: [memory]
config: {}
limits:
  memory_mb: 128
  timeout_ms: 30000
  max_api_calls: 500
actions:
  - id: action-id
    description: "What this action does"
    method: POST
    path: /v1/ext/{name}/:instanceId/action-id
    auth: required
    input: {}
    output: {}
    script: action-id.js
// actions/action-id.js
export default async function(ctx, input) {
  // ── Reading from EXTERNAL APIs (ctx.fetch) ──
  // ctx.fetch() returns { ok, status, text } — text is a RAW string, parse it yourself
  const resp = await ctx.fetch('https://example.com/api');
  if (!resp.ok) {
    ctx.log.error('API request failed', { status: resp.status });
    return { error: 'Request failed with status ' + resp.status };
  }
  const data = JSON.parse(resp.text);  // ← correct: resp.text IS a string

  // ── Reading from AIMEAT MEMORY (ctx.memory) ──
  // ctx.memory.get() returns a JS value directly — NEVER use JSON.parse
  const stored = await ctx.memory.get("my.key");
  if (!stored) return { items: [] };  // ← stored is already an object, or undefined

  // ── Writing to AIMEAT MEMORY ──
  await ctx.memory.set("results.today", { items: data.results, fetchedAt: new Date().toISOString() });

  return { result: stored };
}
\`\`\`

CRITICAL: Do NOT use separate code blocks. Put YAML manifest and ALL JavaScript files in ONE block.
Each JavaScript file MUST start with a comment line: // actions/{filename}.js

## Additional rules
- \`metadata\` section MUST have: name, version, description, author
- \`actions\` array MUST NOT be empty — each action needs: id, method, path, script
- Each action's \`script\` field value must match a \`// actions/{script}\` comment below the YAML
- \`limits.timeout_ms\`: use 30000 for extensions that call external APIs, 5000 for memory-only
- \`limits.max_api_calls\`: use 500 for data collectors (many memory writes per run), 100 for simple actions
- All helper functions must be defined INSIDE the same script file — no imports, no cross-file references
- If two actions need the same helper (e.g., date parsing, data normalization), DUPLICATE the helper in BOTH script files — copy it exactly, do NOT refactor into a shared module
- NEVER reference functions from another action's script — each script runs in its own ISOLATED V8 sandbox scope
- When duplicating helpers across actions, keep them IDENTICAL — if you fix a bug in one copy, fix it in all copies
- ╔═ NEVER call JSON.parse() on ctx.memory.get() results — they are already parsed JS values ═╗
- Always check for undefined/null before using memory values — on first run, NOTHING exists yet
- Always convert dates to ISO 8601 before storing in memory
- NEVER output HTML entities in JavaScript code — this crashes the V8 sandbox. See rules below.

## CRITICAL: No HTML Entities in JavaScript (violations CRASH the sandbox)

╔════════════════════════════════════════════════════════════════════╗
║  Your JavaScript code MUST use real operators, NOT HTML entities.  ║
║  The V8 sandbox executes raw JS — HTML entities are syntax errors. ║
╚════════════════════════════════════════════════════════════════════╝

WRONG (crashes):  const gt = a =&gt; a &gt; 0 &amp;&amp; b;
CORRECT:          const gt = a => a > 0 && b;

Check your ENTIRE output before responding. If you see &gt; &lt; &amp; &quot; &#39; anywhere in JavaScript code, replace them with > < & " ' respectively.`,

  app: (label, context, completedComponents) => {
    // Check if any cortex libraries are in completed components
    const cortexComponents = (completedComponents || []).filter(c => c.type === 'cortex');
    const hasCortex = cortexComponents.length > 0;

    let cortexInstructions = '';
    let cortexScriptLoads = '';
    if (hasCortex) {
      const cortexLibs = cortexComponents.map(c => {
        // Use registeredAs (set during registration) — it's the canonical name
        // Fallback: try regex on YAML metadata.name, then label
        const libName = c.registeredAs
          || c.result?.match?.(/metadata:\s*\n\s+name:\s*"?([^\s"]+)"?/)?.[1]
          || c.label;
        return { name: libName, label: c.label, result: c.result };
      });

      cortexScriptLoads = cortexLibs.map(lib =>
        `  await loadScript('/v1/cortex/${lib.name}/libs/${lib.name}.js');`
      ).join('\n');

      cortexInstructions = `
## CORTEX LIBRARIES (use these — do NOT call extensions or memory directly)

This project has Cortex libraries that wrap all extension APIs into clean domain methods.
Load them via <script> tags and use their API.

${cortexLibs.map(lib => `### ${lib.label}
Load: \\\`<script src="/v1/cortex/${lib.name}/libs/${lib.name}.js"></script>\\\`
${lib.result ? `Full cortex code (use EXACTLY these method names and return shapes):\n${lib.result}` : ''}
`).join('\n')}

╔══════════════════════════════════════════════════════════════════════════╗
║  Read the cortex code above CAREFULLY.                                 ║
║  Use EXACTLY the method names shown (e.g., getAlerts, getDailyStats).  ║
║  Use EXACTLY the return value shapes — do NOT invent field names.      ║
║  If cortex returns { items: [...] }, use .items, NOT .data or .entries. ║
╚══════════════════════════════════════════════════════════════════════════╝

IMPORTANT:
- Call \\\`AIMEAT.{libName}.init()\\\` on app start (libName is camelCase of the cortex metadata.name, e.g., \\\`alert-map-lib\\\` → \\\`AIMEAT.alertMapLib.init()\\\`)
- Use the cortex methods for ALL data access — never call extensions or memory directly
- The cortex handles authentication, error handling, and data transformation
`;
    }

    return `${AIMEAT_CONTEXT}

Create an AIMEAT App (HTML/JS) for: ${label}

${context}

## CRITICAL: Authentication & API Calls

The app runs on the SAME ORIGIN as the AIMEAT node. Use relative API paths (e.g., "/v1/ext/..."), NOT absolute URLs.

### Library setup (copy this exactly — load BOTH libraries):
\`\`\`javascript
// Load AIMEAT libraries — auth handles login/JWT, data handles memory API
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function boot() {
  try {
    await loadScript('/v1/libs/aimeat-auth.js');
    await loadScript('/v1/libs/aimeat-data.js');
${hasCortex ? '\n' + cortexScriptLoads : ''}
    AIMEAT.auth.mountLoginButton('#auth-container', {
      onLogin: () => startApp(),
      onLogout: () => location.reload(),
    });
    AIMEAT.auth.login().then(session => { if (session) startApp(); }).catch(() => {});
  } catch (err) {
    document.body.innerHTML = '<div style="padding:2rem;color:#ef4444;font-family:system-ui">'
      + '<h2>Failed to load application</h2><p>' + err.message + '</p>'
      + '<p>Make sure the AIMEAT node is running and accessible.</p></div>';
  }
}
boot();
\`\`\`

${hasCortex ? cortexInstructions : `### AIMEAT.data API (memory read/write — handles auth and envelope automatically):
\\\`\\\`\\\`javascript
// Read YOUR OWN memory key — returns the stored value directly, or null
const myData = await AIMEAT.data.get('my.settings');

// Write a memory key (your own namespace)
await AIMEAT.data.set('my.key', { count: 42 });

// Delete your own memory key
await AIMEAT.data.delete('my.key');
\\\`\\\`\\\`

### Reading EXTENSION-produced data (CRITICAL — most apps need this):
Extensions store data in their OWN namespace (\\\`ext:{extension-name}\\\`).
To read data that an extension wrote, use \\\`getPublic()\\\`:
\\\`\\\`\\\`javascript
// WRONG — this reads YOUR memory, not the extension's:
const data = await AIMEAT.data.get('alerts.by-date.__index');  // returns null!

// CORRECT — read from the extension's namespace:
const data = await AIMEAT.data.getPublic('ext:my-collector-extension', 'alerts.by-date.__index');
\\\`\\\`\\\`
The first argument is the extension's memory owner: \\\`"ext:" + extensionName\\\` (the \\\`name\\\` field from the extension manifest metadata).
Use this for ALL data produced by extensions (alerts, stats, risk profiles, caches, etc.).
\\\`getPublic()\\\` returns the value directly (auto-unwraps), or null if not found.

### Reading TRANSLATIONS (stored in owner memory, NOT a /v1/i18n route):
Translations are stored in memory at \\\`i18n.{locale}\\\` keys. Read them with \\\`AIMEAT.data.get()\\\`:
\\\`\\\`\\\`javascript
// Read translation strings for a locale:
const enStrings = await AIMEAT.data.get('i18n.en');  // { "app.title": "My App", ... }
const fiStrings = await AIMEAT.data.get('i18n.fi');  // { "app.title": "Sovellus", ... }
\\\`\\\`\\\`
There is NO /v1/i18n/ route. NEVER fetch from /v1/i18n/. Use AIMEAT.data.get('i18n.{locale}').
If a cortex library has a getI18n(locale) method, use that instead.

### Calling extension actions (use AIMEAT.auth session for authenticated fetch):
\\\`\\\`\\\`javascript
// Helper for extension calls (copy this):
async function extCall(extName, actionId, body = {}, instanceId = null) {
  const session = AIMEAT.auth.getSession();
  if (!session) throw new Error('Not logged in');
  const path = instanceId
    ? '/v1/ext/' + extName + '/' + instanceId + '/' + actionId
    : '/v1/ext/' + extName + '/' + actionId;
  const resp = await session.fetch(path, { method: 'POST', body: JSON.stringify(body) });
  if (!resp.ok) throw new Error(resp.error?.message || 'Extension call failed');
  return resp.data;  // unwrapped payload
}

// Usage:
const result = await extCall('my-extension', 'my-action', { query: 'test' });
\\\`\\\`\\\``}

## CDN Libraries & Design Resources

The AIMEAT app catalog allows external CDN scripts. Available libraries:

| Library | Script Tag | Use for |
|---------|-----------|---------|
| Leaflet | \`<script src="https://unpkg.com/leaflet@1/dist/leaflet.js"></script>\` + CSS link: \`<link rel="stylesheet" href="https://unpkg.com/leaflet@1/dist/leaflet.css">\` | Maps, markers, geospatial |
| Chart.js | \`<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>\` | Bar, line, pie, radar charts |
| Motion | \`<script src="https://cdn.jsdelivr.net/npm/motion@11/dist/motion.js"></script>\` | Animations via \`Motion.animate(el, {x: 100}, {duration: 0.5})\` |
| Phaser 3 | \`<script src="https://cdn.jsdelivr.net/npm/[email protected]/dist/phaser.min.js"></script>\` | Games, interactive canvas, physics |

### CSP (Content Security Policy) — the app HTML MUST include a meta tag

AIMEAT enforces CSP headers. If your app loads CDN scripts/styles, you MUST add a \`<meta>\` tag:
\\\`\\\`\\\`html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net;
  style-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net https://fonts.googleapis.com;
  img-src 'self' data: https: blob:;
  font-src 'self' https://fonts.gstatic.com;
  connect-src 'self';
">
\\\`\\\`\\\`
Only include CDN domains you actually use. Without this tag, CDN scripts will be BLOCKED silently.

For UI inspiration, reference uiverse.io for fancy buttons, cards, toggles, and loaders (CSS-only patterns).

## CSS Design System

Use CSS custom properties for ALL styling. Define a theme at the top, then use var() everywhere:
\`\`\`css
:root {
  --color-primary: #3b82f6;      /* main action color — customize per project */
  --color-secondary: #64748b;
  --color-success: #22c55e;
  --color-warning: #f59e0b;
  --color-danger: #ef4444;
  --color-bg: #ffffff;
  --color-bg-card: #f8fafc;
  --color-text: #1e293b;
  --color-text-dim: #64748b;
  --color-border: #e2e8f0;
  --radius: 8px;
  --radius-lg: 12px;
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;
  --font-sans: system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.07);
  --shadow-lg: 0 10px 15px rgba(0,0,0,0.1);
  --transition: 150ms ease;
}
\`\`\`

NEVER use hardcoded hex colors in component styles. Always use var(--color-*).
Customize the palette based on the project's domain and the style preferences from the spec.

## Auth UI Layout

The #auth-container renders a login button and session bar at the top of the page.
Reserve space for it in your layout — do not overlap or hide it:
\`\`\`html
<body>
  <div id="auth-container"></div>  <!-- AIMEAT login/session UI — always at top -->
  <header><!-- your app header --></header>
  <main id="app"><!-- your content --></main>
</body>
\`\`\`

## Rules
- DO NOT add manual configuration fields for API URL, Bearer Token, or Instance ID
- DO NOT use prompt() or manual token entry — the auth library handles everything
- ALL API paths MUST be relative (start with /) — never use absolute URLs or NODE_URL
- Use \`window.AIMEAT.auth.getSession()\` to check if logged in; show a "Sign in" message if not
- Use vanilla JS (no build step needed)
- All dates displayed to users should be formatted from ISO 8601 strings (never store display-formatted dates)
- Has a clean, responsive UI with good mobile support
- Use CSS custom properties for theming where possible
${hasCortex ? '- Call cortex init() on app start — it handles everything automatically\n- Focus on UX/UI — the cortex handles data access and initialization' : ''}

## CRITICAL: Empty-State Handling

On first run, extension data does NOT exist yet. The app MUST show a friendly empty state:
- Check every data response for null/empty before rendering
- Show helpful messages: "No data yet — extensions will collect data on their next scheduled run"
- NEVER crash on null/undefined data — always provide fallback UI

## Built-in Error Collector (diagnostics)

Add this error collector at the TOP of your main <script>, before any other code:
\\\`\\\`\\\`javascript
// Error collector — surfaces runtime errors in the UI for diagnostics
(function() {
  var errors = [];
  window.onerror = function(msg, src, line, col) {
    errors.push({ msg: msg, src: src, line: line, col: col, at: new Date().toISOString() });
    showErrors();
  };
  window.addEventListener('unhandledrejection', function(e) {
    errors.push({ msg: String(e.reason), src: 'promise', line: 0, col: 0, at: new Date().toISOString() });
    showErrors();
  });
  function showErrors() {
    var el = document.getElementById('app-errors');
    if (!el) { el = document.createElement('div'); el.id = 'app-errors'; el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#1a0000;color:#ff6b6b;font-size:12px;padding:8px 12px;max-height:120px;overflow:auto;z-index:9999;font-family:monospace;border-top:2px solid #ff4444'; document.body.appendChild(el); }
    el.innerHTML = errors.map(function(e) { return e.at.slice(11,19) + ' ' + e.msg + ' (' + e.src + ':' + e.line + ')'; }).join('<br>');
  }
})();
\\\`\\\`\\\`
This lets users see runtime errors without opening the browser console.

## CRITICAL: Code Quality — No HTML Entities in JavaScript

Your output MUST use proper JavaScript operators. NEVER output HTML entities in code:
- Use => NOT =&gt;
- Use && NOT &amp;&amp;
- Use >= NOT &gt;=
- Use < NOT &lt;
- Use > NOT &gt;
If your output contains &amp; &lt; &gt; inside JavaScript code, the app WILL crash.

Return a complete HTML file with an app manifest comment at the top:

\`\`\`html
<!-- AIMEAT App Manifest
name: kebab-case-name
version: 1.0.0
description: What this app does
entry: index.html
-->
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>App Name</title></head>
<body>
  <div id="auth-container"></div>
  <div id="app"></div>
  <script>
    // Auth setup + API helper + app logic here
  </script>
</body>
</html>
\`\`\``;
  },

  memory: (label, context) => `${AIMEAT_CONTEXT}

Define memory structure for: ${label}

${context}

## Memory Key Conventions

AIMEAT memory uses dot-namespaced keys with a standard metadata pattern:

- \`namespace.__meta\` — describes the namespace (version, key format, description)
- \`namespace.__index\` — lightweight index for fast lookups (list of dates, counts, rankings)
- \`namespace.__config\` — configuration for the namespace (TTLs, thresholds, weights)
- \`namespace.YYYY-MM-DD\` — date-bucketed data (one key per day)
- \`namespace.item-id\` — individual items

Values are JSON objects. Keep individual values under 100KB.

## Rules
- All keys MUST be lowercase with dots as namespace separators
- Date-bucketed keys MUST use YYYY-MM-DD format: "alerts.by-date.2026-03-14"
- All date/time values inside objects MUST be ISO 8601: "2026-03-14T13:00:00.000Z"
- Include __meta with version and description for every namespace
- Include __index if consumers need to discover which keys exist (e.g., list of dates with data)
- Keep __index lightweight — just key names, counts, and pointers. NOT full data copies.
- Use arrays for ordered collections within a bucket (e.g., alerts per day)
- Use meaningful field names that match the CSM data_schema where applicable

Return a JSON object where keys are memory key names and values are the initial/template data:
\`\`\`json
{
  "namespace.__meta": {
    "version": "1.0",
    "description": "What this namespace stores",
    "keyFormat": "namespace.YYYY-MM-DD"
  },
  "namespace.__index": {
    "dates": [],
    "totalItems": 0,
    "lastUpdated": ""
  },
  "namespace.YYYY-MM-DD": {
    "date": "YYYY-MM-DD",
    "items": []
  }
}
\`\`\``,

  translation: (label, context) => `${AIMEAT_CONTEXT}

Create translations for: ${label}

${context}

## Translation Key Conventions

- Keys use dot-namespaced paths matching the UI structure: "app.alerts.title", "app.filters.severity"
- Group by UI section: "app.nav.*", "app.map.*", "app.filters.*", "app.stats.*"
- Include domain-specific terms: incident types, severity levels, status labels
- Use interpolation with \${variable} syntax for dynamic values: "Found \${count} alerts"

## CRITICAL: Generate ONLY the locale indicated by the label

Each translation component covers ONE locale. The label tells you which one:
- "Finnish (fi) Strings" → generate ONLY Finnish translations under the "fi" root key
- "English (en) Strings" → generate ONLY English translations under the "en" root key

╔══════════════════════════════════════════════════════════════════════════╗
║  NEVER generate both locales in one component.                         ║
║  If the label says "Finnish", output ONLY { "fi": { ... } }.           ║
║  If the label says "English", output ONLY { "en": { ... } }.           ║
║  The other locale is handled by a SEPARATE component in the blueprint. ║
╚══════════════════════════════════════════════════════════════════════════╝

## Rules
- The root key MUST match the locale in the label: "en" for English, "fi" for Finnish
- NEVER include the other locale — it will be generated in its own component
- Finnish translations must be natural Finnish with correct characters (ä, ö, å) — not machine-translated
- Include ALL text that appears in the UI — labels, buttons, tooltips, empty states, error messages
- Keep keys consistent with what the App component will reference
- Use plural-aware keys where needed: "alert.one" / "alert.many"
- Both locale components MUST use the SAME key structure — the app uses the same keys for both

Return JSON with translations for the SINGLE locale from the label:

Example — if label is "Finnish (fi) Strings":
\`\`\`json
{
  "fi": {
    "app.title": "Sovelluksen nimi",
    "app.nav.home": "Etusivu",
    "app.filters.severity": "Vakavuus",
    "app.filters.all": "Kaikki",
    "app.empty": "Tietoja ei löytynyt",
    "app.error": "Jokin meni pieleen",
    "domain.type.fire": "Tulipalo",
    "domain.severity.small": "Pieni"
  }
}
\`\`\`

Example — if label is "English (en) Strings":
\`\`\`json
{
  "en": {
    "app.title": "App Title",
    "app.nav.home": "Home",
    "app.filters.severity": "Severity",
    "app.filters.all": "All",
    "app.empty": "No data found",
    "app.error": "Something went wrong",
    "domain.type.fire": "Fire",
    "domain.severity.small": "Small"
  }
}
\`\`\``,

  cortex: (label, context, completedComponents) => {
    // Build extension reference from completed components
    const extComponents = (completedComponents || []).filter(c => c.type === 'extension');
    let extRef = '';
    if (extComponents.length > 0) {
      extRef = `\n## Registered Extensions (your cortex wraps these)\n`;
      for (const ext of extComponents) {
        // Use registeredAs (canonical name from registration), fallback to regex then label
        const extName = ext.registeredAs
          || ext.result?.match?.(/name:\s*"?([^\s"]+)"?/)?.[1]
          || ext.label;
        extRef += `- **${extName}** (${ext.label}): memory owner = \`ext:${extName}\`\n`;
        if (ext.result) {
          // Include FULL extension code — cortex MUST see exact memory keys, data
          // shapes, and action logic to generate correct wrapper methods.
          extRef += `  Full extension code:\n${ext.result}\n`;
        }
      }
    }

    return `${AIMEAT_CONTEXT}

Create a Cortex extension (client-side JS domain library) for: ${label}

${context}
${extRef}
## What is a Cortex Library?

A Cortex library is a client-side JavaScript library that bridges V8 extensions and the app layer.
It wraps raw AIMEAT API calls (extension actions, memory reads from extension namespaces) into
clean, documented domain methods. Apps import the cortex and call simple methods like
\`AIMEAT.myLib.getData()\` instead of knowing about memory namespaces and extension names.

## CRITICAL: Read the Extension Code Above CAREFULLY

The extension code shown above is the ACTUAL code running on the server. Your cortex MUST match it EXACTLY:

╔══════════════════════════════════════════════════════════════════════════╗
║  1. Find every ctx.memory.set() call → those are the EXACT keys        ║
║  2. Look at the value passed to set() → that is the EXACT data shape   ║
║  3. Find every ctx.memory.get() call → those are keys you can read     ║
║  4. Your getPublic() calls MUST use those EXACT same keys              ║
║  5. Your methods MUST return data in the EXACT shape the extension     ║
║     stores it — do NOT invent new field names or structures            ║
╚══════════════════════════════════════════════════════════════════════════╝

Example: if the extension does \`ctx.memory.set("alerts.by-date.2026-03-14", { items: [...] })\`
then your cortex must read \`getPublic('ext:extension-name', 'alerts.by-date.2026-03-14')\`
and return objects with an \`items\` array — NOT \`data\`, NOT \`entries\`, NOT \`results\`.

## Design Principles

1. **Domain Cohesion**: Group related operations into a single API surface
2. **Facade Pattern**: Hide extension namespaces (\`ext:{name}\`), memory key patterns, and error handling
3. **DRY / Genericity**: If a capability is reusable across projects, make it generic
4. **Smart Init**: \`init()\` checks if data exists; if not, triggers extension collectors — see init() rules below
5. **Composability**: Cortex libs can use other cortex libs via \`AIMEAT.{otherLib}\`
6. **Self-Documenting**: Export clear, named functions with consistent patterns

## IMPORTANT: How Extension Memory Works

Extensions store data in their OWN namespace. To read extension data from client-side:
\\\`\\\`\\\`javascript
// If AIMEAT.data is loaded (preferred):
const value = await AIMEAT.data.getPublic('ext:my-collector', 'alerts.by-date.__index');

// Fallback without AIMEAT.data:
const url = NODE_URL + '/v1/memory/' + encodeURIComponent('ext:my-collector') + '/' + encodeURIComponent(key);
const resp = await fetch(url);
const json = await resp.json();
const value = json.ok ? json.data.value : null;
\\\`\\\`\\\`

## IMPORTANT: How Translations Work

Translation components store i18n strings in the OWNER's memory at \\\`i18n.{locale}\\\` keys.
To read translations, use AIMEAT.data.get() (NOT getPublic — translations are in the owner's namespace):
\\\`\\\`\\\`javascript
// Read translation for a locale — returns flat { "app.title": "...", "app.nav.home": "..." } object
const enStrings = await AIMEAT.data.get('i18n.en');
const fiStrings = await AIMEAT.data.get('i18n.fi');
\\\`\\\`\\\`

There is NO /v1/i18n/ route. Translations are stored in memory, NOT served from a dedicated API.
Your cortex's getI18n() method should read from AIMEAT.data.get('i18n.' + locale).
The translation keys use dot-namespaced paths like "app.title", "app.nav.home", "domain.type.fire".

## Extension Action Calls (authenticated)

\\\`\\\`\\\`javascript
async function callExt(extName, actionId, body) {
  const session = AIMEAT.auth && AIMEAT.auth.getSession();
  if (!session) throw new Error('Not logged in');
  const resp = await session.fetch('/v1/ext/' + extName + '/' + actionId, {
    method: 'POST', body: JSON.stringify(body || {}),
  });
  if (!resp.ok) throw new Error((resp.error && resp.error.message) || 'Extension call failed');
  return resp.data;
}
\\\`\\\`\\\`

## Output Format

Return TWO code blocks:

1. A \\\`\\\`\\\`yaml block with the Cortex manifest
2. A \\\`\\\`\\\`javascript block with the library code

### YAML Manifest Structure:
\\\`\\\`\\\`yaml
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: my-domain-lib
  namespace: community
  description: "What this library does"
  author: generator
  tags: [domain, tag1, tag2]
  labels:
    domain: specific-domain
spec:
  version: "1.0.0"
  license: MIT
  components:
    - type: prompt
      name: domain-assistant
      content: |
        You are using the {{metadata.name}} cortex library.
        Node URL: {{node_url}}

        Available API:
        AIMEAT.myLib.init() — Initialize and trigger data collection if needed
        AIMEAT.myLib.getData(filters) — Get filtered data
        AIMEAT.myLib.getStats(date) — Get statistics for a date

        To load in an app:
        <script src="{{node_url}}/v1/cortex/my-domain-lib/libs/my-domain-lib.js"></script>

    - type: lib
      name: my-domain-lib
      filename: my-domain-lib.js
      exports: [init, getData, getStats]
      api_surface: |
        AIMEAT.myLib.init() — Smart initialization, triggers collectors if no data
        AIMEAT.myLib.getData({hours, type}) — Filtered domain data
        AIMEAT.myLib.getStats(date) — Aggregated statistics
\\\`\\\`\\\`

### JavaScript Library Pattern:
\\\`\\\`\\\`javascript
(function (AIMEAT) {
  'use strict';

  const LIB_NAME = 'myLib';
  // Extension names this cortex wraps — MUST match the registered extension names
  const EXT = {
    collector: 'my-collector-extension',
    aggregator: 'my-aggregator-extension',
  };

  // ── Internal helpers ──

  function nodeUrl() { return window.location.origin; }

  async function readExtMemory(extName, key) {
    if (AIMEAT.data && AIMEAT.data.getPublic) {
      return AIMEAT.data.getPublic('ext:' + extName, key);
    }
    const url = nodeUrl() + '/v1/memory/' + encodeURIComponent('ext:' + extName) + '/' + encodeURIComponent(key);
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const json = await resp.json();
    return json.ok ? json.data.value : null;
  }

  async function callExt(extName, actionId, body) {
    const session = AIMEAT.auth && AIMEAT.auth.getSession();
    if (!session) throw new Error('Not logged in');
    const resp = await session.fetch('/v1/ext/' + extName + '/' + actionId, {
      method: 'POST', body: JSON.stringify(body || {}),
    });
    if (!resp.ok) throw new Error((resp.error && resp.error.message) || 'Extension call failed');
    return resp.data;
  }

  // ── Public API ──

  async function init() {
    const index = await readExtMemory(EXT.collector, 'my-data.__index');
    if (!index || !index.dates || index.dates.length === 0) {
      await callExt(EXT.collector, 'collect', {});
    }
    return { ready: true };
  }

  async function getData(filters) {
    // Read from extension memory, apply filters, return clean data
  }

  // ── Register ──
  const exports = { init, getData };
  if (AIMEAT.register) AIMEAT.register(LIB_NAME, exports);
  AIMEAT[LIB_NAME] = exports;

})(window.AIMEAT || (window.AIMEAT = {}));
\\\`\\\`\\\`

## Rules

### CRITICAL: Name Consistency
The YAML \`metadata.name\` and the JS \`LIB_NAME\` MUST follow this convention:
- YAML \`metadata.name\`: kebab-case (e.g., \`my-domain-lib\`)
- JS \`LIB_NAME\`: camelCase version of the SAME name (e.g., \`myDomainLib\`)
- \`AIMEAT.register(LIB_NAME, exports)\` uses the camelCase name
- Apps load via: \`/v1/cortex/{metadata.name}/libs/{metadata.name}.js\`
- Apps access via: \`AIMEAT.{LIB_NAME}.method()\`

Example: YAML name \`alert-map-lib\` → LIB_NAME = \`alertMapLib\` → \`AIMEAT.alertMapLib.init()\`

- The library MUST be a single IIFE that registers on \`window.AIMEAT\`
- Use \`AIMEAT.register(name, exports)\` if available, always set \`AIMEAT[name] = exports\`
- Use \`AIMEAT.data.getPublic()\` when aimeat-data.js is loaded, fallback to raw fetch
- Use \`AIMEAT.auth.getSession()\` for authenticated extension calls
- Extension names in \`EXT\` object MUST exactly match the registered extension \`metadata.name\`
- \`init()\` MUST follow the init() contract below — no custom behavior
- All public methods must be async (return Promises)
- Handle errors gracefully — return null or empty arrays, don't throw for missing data
- Include the prompt component with documented API surface for downstream AI consumers

## init() Contract (MUST follow exactly)

\\\`\\\`\\\`javascript
async function init() {
  // 1. Check if data exists by reading the primary index/key
  const index = await readExtMemory(EXT.collector, 'data.__index');

  // 2. If data exists → return { ready: true }, do NOT trigger collection
  if (index && Array.isArray(index.dates) && index.dates.length > 0) {
    return { ready: true };
  }

  // 3. If NO data → trigger collector(s) once, return { ready: true, triggered: true }
  try {
    await callExt(EXT.collector, 'collect', {});
  } catch (err) {
    // Log but don't throw — app should still render empty state
    console.warn('init: collector failed:', err.message);
  }
  return { ready: true, triggered: true };
}
\\\`\\\`\\\`

Rules for init():
- NEVER set up intervals, timers, or recurring triggers — scheduled jobs handle that
- NEVER call init() automatically inside the cortex IIFE — let the app call it
- NEVER trigger MULTIPLE collectors simultaneously — call them sequentially
- init() MUST be idempotent — calling it twice must not cause duplicate data
- Return \`{ ready: true }\` always — the app checks this to know the cortex is loaded
- If collector fails, return \`{ ready: true, triggered: true }\` anyway (app shows empty state)

## CRITICAL: Empty-State Handling (first-run scenario)

On first run, NO extension data exists yet (no RSS collected, no aggregation done).
Every method MUST handle missing data gracefully:

\\\`\\\`\\\`javascript
// WRONG — crashes if index doesn't exist:
async function getAlerts() {
  const index = await readExtMemory(EXT.collector, 'alerts.__index');
  return index.dates.map(d => ...);  // TypeError: Cannot read 'dates' of null
}

// CORRECT — return empty data:
async function getAlerts() {
  const index = await readExtMemory(EXT.collector, 'alerts.__index');
  if (!index || !index.dates || index.dates.length === 0) return [];
  // ... process data
}
\\\`\\\`\\\`

EVERY readExtMemory/getPublic call must be followed by a null/undefined check.
NEVER assume data exists — the user may open the app before any extension has run.`;
  },
};

export function buildComponentPrompt(type, label, projectDescription, blueprint, completedComponents, interviewSpec) {
  const template = COMPONENT_TEMPLATES[type];
  if (!template) throw new Error(`No template for type: ${type}`);

  let context = `Project: ${projectDescription}\n`;
  if (blueprint) {
    context += `\nBlueprint components: ${blueprint.components.map(c => `${c.id} (${c.type}: ${c.label})`).join(', ')}\n`;
  }
  if (completedComponents && completedComponents.length > 0) {
    context += '\nAlready completed:\n';
    for (const c of completedComponents) {
      context += `- ${c.id} (${c.type}: ${c.label}): registered as "${c.registeredAs}"\n`;
      // Include full result for extensions and cortex — downstream components MUST see
      // the complete code to know exact memory keys, data shapes, and API methods.
      // Truncating caused downstream components to guess keys/shapes incorrectly.
      if (c.result && (c.type === 'extension' || c.type === 'cortex')) {
        context += `  Full code:\n${c.result}\n`;
      }
    }
  }

  // Thread staticData to memory component prompts — include the FULL dataset
  if (type === 'memory' && interviewSpec?.dataSources) {
    const staticSources = interviewSpec.dataSources.filter(ds => ds.staticData && Array.isArray(ds.staticData));
    if (staticSources.length > 0) {
      context += '\n## Static Data to Include (from interview — include ALL entries as memory keys)\n';
      context += 'The user provided complete datasets during the interview. Write EVERY entry as a memory key.\n';
      context += 'Use the pattern: namespace.{key} for each entry.\n\n';
      for (const ds of staticSources) {
        context += `### ${ds.name} (${ds.staticData.length} entries)\n`;
        context += '```json\n' + JSON.stringify(ds.staticData, null, 2) + '\n```\n\n';
      }
    }
  }

  // Thread interview data source details to extension prompts
  if (type === 'extension' && interviewSpec?.dataSources) {
    context += '\n## Data Source Details (from interview — use these to write correct parsers)\n';
    for (const ds of interviewSpec.dataSources) {
      context += `- **${ds.name}** (${ds.type}): ${ds.url || 'user-input'}\n`;
      if (ds.encoding) context += `  Encoding: ${ds.encoding}\n`;
      if (ds.sampleEntry) context += `  Sample entry (REAL DATA — write your parser against this):\n  \`\`\`\n  ${ds.sampleEntry}\n  \`\`\`\n`;
      if (ds.staticData && Array.isArray(ds.staticData)) {
        context += `  **STATIC DATA (${ds.staticData.length} entries) — pre-loaded in memory. Read with ctx.memory.get(), do NOT re-create it.**\n`;
      }
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

  // App and cortex templates receive completedComponents for cross-referencing
  if (type === 'app' || type === 'cortex') {
    return template(label, context, completedComponents);
  }

  return template(label, context);
}

/* ── Fix Prompts ─────────────────────────────────────── */

export function buildBlueprintFixPrompt(description, errors, interviewSpec = null) {
  return `Your previous blueprint response was not valid. DO NOT try to fix the old response — generate a fresh one.

ERRORS from previous attempt:
${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

Common mistakes to avoid:
- Do NOT include manifest content, code, HTML, or implementation details in the blueprint
- Each component must have EXACTLY five fields: "id", "type", "label", "produces", "consumes"
- The entire response must be valid JSON — no trailing commas, no unescaped quotes

${buildBlueprintPrompt(description, interviewSpec)}`;
}

export function buildFixPrompt(originalPrompt, failedResult, errors, componentType) {
  // Type-specific constraints that must be preserved during fixes
  const typeRules = {
    extension: `
EXTENSION CONSTRAINTS (V8 sandbox):
- No require(), no import (except export default for entry point)
- No Node.js APIs (fs, path, crypto, Buffer, process)
- No fetch() global — use ctx.fetch() instead
- No setTimeout, setInterval, console.log — use ctx.log.*
- All helpers must be INSIDE the same script file
- Always null-check ctx.memory.get() results: \`const data = await ctx.memory.get("key") || []\``,
    cortex: `
CORTEX CONSTRAINTS (browser IIFE):
- Must be a single IIFE registering on window.AIMEAT
- YAML metadata.name (kebab-case) and JS LIB_NAME (camelCase) must match
- init() must follow the init() contract: check data, trigger collector if empty, return { ready: true }
- Every readExtMemory/getPublic call must be null-checked`,
    app: `
APP CONSTRAINTS (browser HTML):
- Include CSP meta tag if using CDN scripts
- Use AIMEAT.auth for login, AIMEAT.data for memory access
- Call cortex init() before accessing data
- Handle empty state gracefully (no data on first run)`,
  };

  const typeConstraint = typeRules[componentType] || '';

  return `The following result had validation errors. Fix ONLY the errors listed below.

CRITICAL: Your output MUST use proper JavaScript/YAML syntax. NEVER output HTML entities:
- Use => NOT =&gt;
- Use && NOT &amp;&amp;
- Use >= NOT &gt;=
- Use < NOT &lt;  and > NOT &gt;
HTML entities in code will crash the V8 sandbox or the browser.
${typeConstraint}
ORIGINAL PROMPT:
${originalPrompt}

FAILED RESULT:
${failedResult}

ERRORS:
${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

Return the corrected result in the same format as the original.`;
}

/* ── Impact & Edit Prompts (Phase 6) ────────────────── */

/**
 * Build a prompt that analyzes which components are affected by a proposed change.
 * User copies this to AI Chat to get an impact analysis.
 */
export function buildImpactPrompt(changeRequest, blueprint) {
  const componentList = (blueprint?.components || []).map(c => {
    const produces = (c.produces || []).join(', ') || 'none';
    const consumes = (c.consumes || []).join(', ') || 'none';
    return `- ${c.id} (${c.type}: ${c.label})\n  produces: ${produces}\n  consumes: ${consumes}`;
  }).join('\n');

  return `You are analyzing the impact of a change to an AIMEAT service.

## Service Blueprint

${componentList}

## Proposed Change

${changeRequest}

## Your Task

Analyze which components need to be modified for this change. For EACH component, classify as:

- **ROOT CAUSE** — this component directly causes the problem or is the primary target of the change
- **NEEDS UPDATE** — this component must change because upstream data shape or API changed
- **NO CHANGE** — this component is unaffected

Return a JSON object:
\`\`\`json
{
  "analysis": [
    {
      "id": "ext-1",
      "label": "Component Label",
      "impact": "root|update|none",
      "reason": "One sentence explaining why this component is/isn't affected",
      "suggestedChange": "Brief description of what to change, or null if no change needed"
    }
  ],
  "summary": "One paragraph overview of the change and its blast radius"
}
\`\`\`

Rules:
- Be conservative — if you're unsure whether a component needs updating, mark it as "update" not "none"
- If the change affects data shape (fields, types, formats), ALL downstream consumers need "update"
- If the change is purely visual/UI, only the app needs updating
- Include ALL components in the analysis, even those with "none" impact`;
}

/**
 * Build a targeted edit prompt for modifying a single component.
 * Includes the current installed code and the specific change request.
 */
export function buildEditPrompt(type, label, currentCode, changeRequest, upstreamChanges) {
  const typeLabel = type === 'csm' ? 'CSM manifest' :
    type === 'msm' ? 'MSM manifest' :
    type === 'extension' ? 'Extension' :
    type === 'cortex' ? 'Cortex library' :
    type === 'app' ? 'App (HTML/JS)' :
    type === 'translation' ? 'Translation file' :
    type === 'memory' ? 'Memory structure' : type;

  // Type-specific constraints to include in edit prompt
  const typeConstraints = {
    extension: `
## Extension Constraints (V8 sandbox — do NOT violate during edit)
- No require(), no import, no Node.js APIs, no fetch() global — use ctx.fetch()
- No setTimeout/setInterval/console.log — use ctx.log.*
- All helpers INSIDE the same script file — no cross-file references
- Always null-check ctx.memory.get() results`,
    cortex: `
## Cortex Constraints (browser IIFE — do NOT violate during edit)
- Must remain a single IIFE on window.AIMEAT
- init() must follow contract: check data, trigger if empty, return { ready: true }
- Every readExtMemory/getPublic call must be null-checked`,
    app: `
## App Constraints (browser HTML — do NOT violate during edit)
- Keep CSP meta tag if using CDN scripts
- Keep AIMEAT.auth/data setup intact
- Handle empty state gracefully`,
  };

  let upstreamSection = '';
  if (upstreamChanges) {
    upstreamSection = `
## Upstream Data Changes

The following upstream components have been modified. Your code may need to adapt:

${upstreamChanges}

Make sure your code correctly handles the new data format described above.
`;
  }

  return `${AIMEAT_CONTEXT}

You are modifying an existing AIMEAT ${typeLabel}: **${label}**
${typeConstraints[type] || ''}
## Current Installed Code

\`\`\`
${currentCode}
\`\`\`

## Change Request

${changeRequest}
${upstreamSection}
## Rules

- Modify ONLY what the change request asks for
- Keep ALL other code, structure, and logic identical
- Do NOT refactor, restyle, rename, or "improve" unrelated code
- Do NOT add features, comments, or documentation beyond what's requested
- Return the COMPLETE modified component in the same format as the original
- If the component is YAML + JavaScript (extension), return both in the same format
- If the change request is unclear, make the minimal change that addresses it

Return the complete modified ${typeLabel} — not a diff, not a partial snippet.`;
}
