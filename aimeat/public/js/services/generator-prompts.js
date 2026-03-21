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
 *   v5.2.0 — 2026-03-15 — Fix CSM prompt: no derived/computed fields in schema,
 *     short service.name, no redundant fields. Fix memory prompt: prefer fewer large
 *     keys over many small ones, add __staticData placeholder for auto-injection of
 *     interview datasets at registration time.
 *   v6.0.0 — 2026-03-15 — Add Domain Data Model: blueprint now produces "dataModel"
 *     section with JSON Schema definitions for every memory key. buildComponentPrompt
 *     injects relevant dataModel entries per component type. Replaces ad-hoc memory
 *     shape guessing with centralized data contract.
 *   v6.1.0 — 2026-03-15 — Fix extension path template: remove :instanceId from default
 *     action paths. Most extensions are single-instance; instanceId only when blueprint
 *     explicitly requires multi-instance support.
 *   v7.0.0 — 2026-03-15 — Fix responsibility boundaries across all three prompts:
 *     Blueprint: extension components can now declare "schedules" (action + cron).
 *     Extension: add schedules YAML section, inject blueprint schedules into prompt.
 *     Cortex: init() is now UI readiness check only — NEVER triggers backend logic.
 *     Scheduled work belongs exclusively to extension scheduler, not cortex/app.
 *   v7.1.0 — 2026-03-15 — Add cortex library catalog to blueprint prompt: dynamically
 *     fetches installed cortex libs and injects their API surfaces so LLM can reuse
 *     existing libraries (e.g., aimeat-charts, aimeat-canvas). Blueprint cortex
 *     components can declare "uses" to reference existing libs. Cortex prompt now
 *     describes full capability range (UI components, DOM, CSS, not just data access).
 *   v7.2.0 — 2026-03-15 — Add @activate trigger support: blueprint schedules can use
 *     cron "@activate" for init jobs that run on extension activation AND every server
 *     restart. Extension prompt documents @activate semantics, idempotent init pattern,
 *     and dependency ordering (init checks stale data before populating).
 *   v7.3.0 — 2026-03-15 — Fix app CSP template: add tile server to connect-src
 *     (Leaflet maps blocked without it), add guidance for map tile CSP requirements
 *   v8.0.0 — 2026-03-16 — Fix critical namespace issue: owner data (memory components,
 *     settings, translations) lives in owner namespace, NOT extension namespace.
 *     Extensions must use ctx.memory.getPublic(ctx.caller.owner, key) to read shared data.
 *     ctx.memory.get() only reads ext:{name} namespace. Updated AIMEAT_CONTEXT, extension
 *     template example, and additional rules with prominent box warning.
 *     Also fix ctx.fetch() encoding docs: now detects charset from XML prolog and HTML meta.
 *   v8.1.0 — 2026-03-16 — Blueprint prompt hardening: enforce cron 5-field syntax with
 *     explicit warning, enforce short ID prefixes (ext-1 not extension-1), enforce static
 *     data schema must match interview format, standardize enum naming conventions
 *     (trends: rising/falling/steady, field names: English camelCase, source values: keep as-is),
 *     add memory key naming conventions (settings.config, i18n.{locale}, domain namespaces),
 *     fix static data injection to use getPublic instead of get
 *   v8.2.0 — 2026-03-16 — Cortex prompt: change output format from two separate
 *     code blocks (yaml + javascript) to single untagged block with // lib/ separator.
 *     Prevents LLMs from splitting output across messages. Add explicit const LIB_NAME
 *     requirement. Matches extension prompt's proven single-block pattern.
 *   v9.0.0 — 2026-03-16 — Interview: add URL validation protocol — AI tests every URL,
 *     escalates to user if inaccessible, then decides together (skip/demo/defer).
 *     dataSources spec gains verifiedBy, fallback, demoData fields.
 *     Cortex prompt: revert to two separate code blocks (yaml + javascript) — single
 *     block caused persistent parsing failures during cortex registration.
 *     Cortex prompt: add critical rule that ext: namespace is read-only from client-side.
 *     Client CANNOT PUT to /v1/memory/ext:name/key — must use callExt() for shared writes
 *     or writeOwnerMemory() for personal data. Add data storage decision table.
 *   v10.0.0 — 2026-03-21 — Interview: add settings detection section (external services,
 *     sharing model, admin app recommendation, user settings). Blueprint: add cortex-modular
 *     architecture guidance, settings inheritance from InterviewSpec, test scenario generation,
 *     "architecture" field at output top level.
 *   v10.1.0 — 2026-03-21 — Add testContext parameter to buildFixPrompt for test-driven
 *     fix loops: includes test errors, dependency results, and blueprint component spec
 *   v10.2.0 — 2026-03-21 — Replace full extension/cortex code injection with compact API
 *     summaries (summarizeExtensionApi, summarizeCortexApi). Prevents prompt bloat that
 *     overwhelms AI with thousands of lines of upstream code. Summaries include action
 *     endpoints, memory keys, data shapes, and public methods.
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
  ctx.memory.getPublic(namespace, key) → value or null (read data from a DIFFERENT namespace)
    Use this to read: (a) another extension's public data, (b) the OWNER's shared data (memory components, translations, settings).
    Example — read another extension's data: await ctx.memory.getPublic('ext:other-ext', 'some.key')
    Example — read owner's shared data: await ctx.memory.getPublic(ctx.caller.owner, 'lookup.data')
    ╔═══════════════════════════════════════════════════════════════════════════════╗
    ║  IMPORTANT: ctx.memory.get() ONLY reads from the extension's OWN namespace. ║
    ║  Data stored by memory components (seed data, settings, translations) lives  ║
    ║  in the OWNER's namespace — use ctx.memory.getPublic(ctx.caller.owner, key)  ║
    ║  to access it. ctx.caller.owner is automatically set to the installing user. ║
    ╚═══════════════════════════════════════════════════════════════════════════════╝
  ctx.fetch(url, { method, headers, body }) → { status, ok, text, headers }
    Use ctx.fetch for ALL HTTP requests. Global fetch() is NOT available.
    Response body is always .text (string) — parse JSON with JSON.parse(resp.text).
    Encoding is handled automatically — the runtime detects charset from: (1) Content-Type header,
    (2) XML prolog encoding attribute, (3) HTML meta charset tag. Falls back to UTF-8.
    You always get correct Unicode text — no manual decoding needed, even for ISO-8859-1 feeds.
  ctx.wallet.consume(amount, reason), ctx.wallet.getBalance()
  ctx.consent.check(gaii, scope), ctx.consent.require(gaii, scope)
  ctx.trust.getScore(gaii)
  ctx.caller = { gaii, owner, roles }
  ctx.config = extension config object (from manifest config section)
  ctx.instance = { id, config } (when called via instance endpoint)
  ctx.log.info/warn/error(msg, data)

AIMEAT Data Standards (MUST follow in ALL components):
  Dates/times: ISO 8601 ONLY — "2026-03-14T13:00:00.000Z". NEVER store RFC 2822 ("Sat, 14 Mar ..."), Unix timestamps, or locale-formatted dates. Convert all dates to ISO before storing.
  Memory keys: lowercase dot-namespaced — "items.by-date.2026-03-14". Dates in keys MUST use YYYY-MM-DD.
  IDs: URL-safe strings (kebab-case or hex hashes). No spaces, no special characters.
  Locale codes: BCP 47 — "fi", "en", "fi-FI", "en-US".
  Coordinates: { latitude: number, longitude: number } — WGS84 decimal degrees.
  Currency/amounts: integers (no floats) — morsels are whole numbers.
`.trim();

/* ── Instruction Disclaimer (prepended to every prompt) ── */

const INSTRUCTION_DISCLAIMER = `IMPORTANT: These are detailed instructions that you MUST read carefully and follow exactly. Every rule, constraint, format requirement, and example below exists for a reason. Do NOT skip sections, do NOT invent your own conventions, and do NOT deviate from the specified output format. If a rule says "MUST" or "NEVER", treat it as absolute.

`;

/* ── Blueprint Prompt ────────────────────────────────── */

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
        "expect": "natural language description of expected result"
      }
    ]
  }
]

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
- service.name: concise kebab-case identifier, 1-3 words. Use the project's own name when it has one. Do NOT invent generic abbreviations or add redundant suffixes like "-service" or "-monitor".
- ONLY include fields that exist in the raw source data. Computed/derived values (aggregates, scores, trends, risk levels, statistics) are calculated by extensions and stored in separate memory keys — they do NOT belong in the CSM data_schema.
- Avoid redundant fields. If the source provides a unique identifier (e.g. guid), do not add a second id field. If a value is always the same (e.g. single data source), do not include it as a field.`,

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
- No \`ctx.notify()\`, \`ctx.email()\`, \`ctx.sms()\`, \`ctx.push()\` — these DO NOT EXIST
- No \`ctx.http\`, \`ctx.request\`, \`ctx.axios\` — use \`ctx.fetch()\` for ALL HTTP requests

╔══════════════════════════════════════════════════════════════════════════╗
║  The ctx object has ONLY these properties:                              ║
║  ctx.memory (get/set/search/delete/getPublic)                          ║
║  ctx.fetch(url, opts)                                                   ║
║  ctx.wallet (consume/deposit/balance)                                   ║
║  ctx.consent (check/request)                                            ║
║  ctx.trust (getScore)                                                   ║
║  ctx.caller (gaii/owner/roles)                                          ║
║  ctx.config (extension config object)                                   ║
║  ctx.log (info/warn/error)                                              ║
║  ctx.notify(message, {title?, priority?, channel?}) → boolean           ║
║  ctx.email(to, subject, body) → boolean (requires SMTP configured)      ║
║  ctx.instance (id/config — only for instance-scoped actions)            ║
║  NOTHING ELSE. Do NOT invent methods that are not listed here.          ║
╚══════════════════════════════════════════════════════════════════════════╝

What IS available:
- Standard JS built-ins: JSON, Math, Date, String, Array, Object, Map, Set, RegExp, Promise, etc.
- \`ctx\` API object (ONLY the properties listed above)
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
  const index = await ctx.memory.get("items.__index");
  index.some(...)     // 💥 Cannot read properties of null (reading 'some')
  index.push(...)     // 💥 Cannot read properties of null (reading 'push')
  index.length        // 💥 Cannot read properties of null (reading 'length')

CORRECT:
  const index = await ctx.memory.get("items.__index") || [];
  index.some(...)     // ✓ works — falls back to empty array

CORRECT (for objects):
  const stats = await ctx.memory.get("daily.stats") || {};
  stats.count = (stats.count || 0) + 1;

### ctx.memory.set(key, value) stores any JSON-serializable value
  await ctx.memory.set("items.2026-03-14", { entries: [...], count: 5 });

### ctx.memory.search(prefix) returns objects, NOT strings — returns ALL matching keys (no pagination)
WARNING: search() loads ALL matching keys into memory at once. If your prefix matches thousands of keys, the V8 sandbox may run out of memory. Use specific prefixes (e.g., "items.by-date.2026-03-14" not "items.")

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
  - id: first-action
    description: "What this action does"
    method: POST
    path: /v1/ext/{name}/first-action
    auth: required
    input: {}
    output: {}
    script: first-action.js
  - id: second-action
    description: "Another action"
    method: POST
    path: /v1/ext/{name}/second-action
    auth: required
    input:
      type: object
      properties:
        name:
          type: string
      required: [name]
    output:
      type: object
    script: second-action.js
schedules: []

YAML actions format — EVERY action MUST have "- id:" as the FIRST key:
  CORRECT: - id: myAction        (id: is explicit key)
  WRONG:   - myAction            (bare value — causes YAML parse error)
  WRONG:   - myAction:           (colon after name — causes YAML parse error)
NEVER omit "id:" from any action entry. This is the #1 cause of validation failures.
// actions/action-id.js
export default async function(ctx, input) {
  // ── Reading from EXTERNAL APIs (ctx.fetch) ──
  // ctx.fetch() returns { ok, status, text, headers } — text is a RAW string, parse it yourself
  // Encoding is auto-detected (Content-Type header, XML prolog, HTML meta) — you get Unicode text
  const resp = await ctx.fetch('https://example.com/api');
  if (!resp.ok) {
    ctx.log.error('API request failed', { status: resp.status });
    return { error: 'Request failed with status ' + resp.status };
  }
  const data = JSON.parse(resp.text);  // ← correct: resp.text IS a string (for JSON APIs)
  // For XML/RSS: resp.text is already decoded Unicode — parse with regex or string methods

  // ── Reading from EXTENSION'S OWN MEMORY (ctx.memory.get) ──
  // ctx.memory.get() returns a JS value directly — NEVER use JSON.parse
  const stored = await ctx.memory.get("my.key");
  if (!stored) return { items: [] };  // ← stored is already an object, or null

  // ── Reading OWNER'S SHARED DATA (memory components, settings, translations) ──
  // Data stored by memory-1, memory-2 etc. lives in the OWNER's namespace, NOT the extension's.
  // Use getPublic(ctx.caller.owner, key) to read it:
  const lookup = await ctx.memory.getPublic(ctx.caller.owner, "lookup.data") || [];
  const settings = await ctx.memory.getPublic(ctx.caller.owner, "settings.config") || {};

  // ── Writing to EXTENSION'S OWN MEMORY ──
  await ctx.memory.set("results.today", { items: data.results, fetchedAt: new Date().toISOString() });

  return { result: stored };
}
\`\`\`

CRITICAL: Do NOT use separate code blocks. Put YAML manifest and ALL JavaScript files in ONE block.
Each JavaScript file MUST start with a comment line: // actions/{filename}.js

## Action path — instance vs non-instance

╔══════════════════════════════════════════════════════════════════════════╗
║  Most extensions are SINGLE-INSTANCE (no :instanceId in path).          ║
║  Use: /v1/ext/{name}/action-id                                          ║
║  NEVER add :instanceId unless the blueprint explicitly requires          ║
║  multi-instance support (e.g., per-store, per-tenant separation).       ║
╚══════════════════════════════════════════════════════════════════════════╝

- Default (single-instance): \`path: /v1/ext/{name}/action-id\`
- Multi-instance (only if needed): \`path: /v1/ext/{name}/:instanceId/action-id\`

## Scheduled Jobs (schedules section)

Extensions can declare recurring background jobs via \`schedules\` in the manifest.
AIMEAT's built-in scheduler runs these automatically — no browser needed.

╔══════════════════════════════════════════════════════════════════════════╗
║  If the blueprint has "schedules" for this extension, you MUST include  ║
║  a schedules section in the YAML manifest. This is the ONLY way to     ║
║  register recurring jobs — cortex and apps CANNOT schedule work.       ║
╚══════════════════════════════════════════════════════════════════════════╝

Format:
\`\`\`yaml
schedules:
  - id: unique-job-id
    action: action-id-from-actions-list
    cron: "*/15 * * * *"
    description: "What this scheduled job does"
    instance_scope: false
    input: {}
\`\`\`

Rules:
- \`action\` MUST reference an existing action id from the \`actions\` array
- \`cron\` uses standard 5-field cron syntax (minute hour day-of-month month day-of-week) OR the special value \`@activate\`
- \`@activate\` trigger: runs when the extension is activated AND on every server restart. Use for init/bootstrap jobs.
- \`instance_scope: false\` for single-instance extensions (most cases)
- \`input\` is optional static input passed to the action on each run
- Common patterns: \`@activate\` (init/bootstrap), \`*/15 * * * *\` (every 15 min), \`0 2 * * *\` (daily at 02:00), \`0 */6 * * *\` (every 6 hours)
- If a nightly job depends on data from a periodic job (e.g., aggregation needs fresh data), schedule it AFTER the last periodic run (e.g., collection at */15, aggregation at 02:00)
- If the blueprint has no "schedules" for this extension, set \`schedules: []\`

### @activate Init Pattern

If the extension collects or computes data, add an \`@activate\` scheduled job that:
1. Checks if data exists and is fresh (not stale)
2. If missing or stale, runs the init/collection logic
3. If data is already fresh, does nothing (returns early)

This solves the cold-start problem: after first activation or a server restart, the extension's data is immediately populated instead of waiting for the next cron tick.

Example @activate action script pattern:
\`\`\`javascript
// Check if data already exists and is recent
const lastRun = await ctx.memory.get('last-ingest-timestamp');
if (lastRun) {
  const age = Date.now() - new Date(lastRun).getTime();
  if (age < 15 * 60 * 1000) return; // Data is fresh (< 15 min), skip
}
// Data is missing or stale — run the init/collection logic
// ... fetch data, store in memory ...
await ctx.memory.set('last-ingest-timestamp', new Date().toISOString());
\`\`\`

Schedule entry:
\`\`\`yaml
  - id: init-data
    action: init
    cron: "@activate"
    description: "Initialize/refresh data on activation and server restart"
    instance_scope: false
    input: {}
\`\`\`

IMPORTANT: @activate actions MUST be idempotent — they will run multiple times (every restart). Always check existing data before overwriting.

### CRITICAL: Copy Shared Data to Extension Namespace

The init/@activate action MUST copy shared service data (translations, settings, lookup tables)
from the OWNER's memory to the extension's OWN memory. This makes the data accessible to ALL users
of the service, not just the owner who installed it.

Pattern — add this to the BEGINNING of your init action:
\`\`\`javascript
// Copy shared data from owner namespace to extension namespace (accessible to all users)
const SHARED_KEYS = ['i18n.fi', 'i18n.en', 'settings.config', 'municipalities.lookup'];
// Adjust SHARED_KEYS based on what this service's memory/translation components produced
for (const key of SHARED_KEYS) {
  const existing = await ctx.memory.get(key);
  if (!existing) {
    // Try service-prefixed key first, then plain key
    const extName = ctx.config?.name || '';
    const prefixed = extName ? extName + '.' + key : key;
    const ownerData = await ctx.memory.getPublic(ctx.caller.owner, prefixed)
                   || await ctx.memory.getPublic(ctx.caller.owner, key);
    if (ownerData) {
      await ctx.memory.set(key, ownerData);
      ctx.log.info('Copied shared data to extension namespace', { key });
    }
  }
}
\`\`\`

Why: Memory/translation components store data in the OWNER's namespace. Other users cannot read it.
By copying to \`ext:{name}\` namespace (via \`ctx.memory.set\`), it becomes public and accessible to
everyone via \`getPublic('ext:{name}', key)\`.

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
- ╔═ OWNER DATA: seed data (memory components), settings, and translations are in the OWNER's namespace ═╗
  Use \`ctx.memory.getPublic(ctx.caller.owner, key)\` to read them — NOT \`ctx.memory.get(key)\`.
  \`ctx.memory.get()\` only reads from the extension's own \`ext:{name}\` namespace.
  Common pattern: \`const data = await ctx.memory.getPublic(ctx.caller.owner, "lookup.data") || [];\`
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

      // Extract actual method names from cortex code exports
      const extractedMethods = [];
      for (const lib of cortexLibs) {
        const camelName = lib.name.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        const exportsMatch = lib.result?.match?.(/(?:const|let|var)\s+\w*[Ee]xport\w*\s*=\s*\{([\s\S]*?)\}/);
        if (exportsMatch) {
          const methods = exportsMatch[1].split(',').map(m => m.trim().split(':')[0].trim()).filter(Boolean);
          for (const m of methods) {
            extractedMethods.push('- `AIMEAT.' + camelName + '.' + m + '()`');
          }
        }
      }

      let methodList = '';
      if (extractedMethods.length > 0) {
        methodList = `
### AVAILABLE CORTEX METHODS (extracted from actual code — use ONLY these):
${extractedMethods.join('\n')}

Do NOT call any method not in this list. Do NOT rename these methods.
`;
      }

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
║  Use EXACTLY the method names shown (e.g., getItems, getStats).        ║
║  Use EXACTLY the return value shapes — do NOT invent field names.      ║
║  If cortex returns { items: [...] }, use .items, NOT .data or .entries. ║
╚══════════════════════════════════════════════════════════════════════════╝
${methodList}
IMPORTANT:
- Call \\\`AIMEAT.{libName}.init()\\\` on app start (libName is camelCase of the cortex metadata.name, e.g., \\\`my-domain-lib\\\` → \\\`AIMEAT.myDomainLib.init()\\\`)
- Use the cortex methods for ALL data access — never call extensions or memory directly
- The cortex handles authentication, error handling, and data transformation

### UI CORTEX RULES (if aimeat-ui-* libraries are loaded):
- NEVER use native alert(), confirm(), or prompt() — use AIMEAT.ui.dialogs.Confirm(), AIMEAT.ui.dialogs.toast(), AIMEAT.ui.dialogs.Modal() instead
- If aimeat-ui-layout is available, use its layout components (MainDetail, DashboardGrid, Split, etc.) for page structure
- If aimeat-ui-forms is available, use its form components (Input, Select, Toggle, FormGroup) instead of raw HTML <input>/<select> elements
- If aimeat-ui-viewers is available, use Grid/List/DataTable/Carousel for data display instead of custom HTML/CSS
- If aimeat-ui-nav is available, use Tabs/BurgerMenu/Sidebar for navigation instead of custom nav HTML
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
const data = await AIMEAT.data.get('items.by-date.__index');  // returns null!

// CORRECT — read from the extension's namespace:
const data = await AIMEAT.data.getPublic('ext:my-collector-extension', 'items.by-date.__index');
\\\`\\\`\\\`
The first argument is the extension's memory owner: \\\`"ext:" + extensionName\\\` (the \\\`name\\\` field from the extension manifest metadata).
Use this for ALL data produced by extensions (collected data, computed stats, caches, etc.).
\\\`getPublic()\\\` returns the value directly (auto-unwraps), or null if not found.

### Reading TRANSLATIONS (stored in extension namespace, accessible to all users):
Translations are copied to the extension namespace during init. Read them via \\\`getPublic\\\`:
\\\`\\\`\\\`javascript
// Read translations from extension namespace (works for ALL users):
const fiStrings = await AIMEAT.data.getPublic('ext:my-extension', 'i18n.fi');
const enStrings = await AIMEAT.data.getPublic('ext:my-extension', 'i18n.en');
\\\`\\\`\\\`
Do NOT use AIMEAT.data.get('i18n.fi') — that reads from the CURRENT USER's namespace and fails for other users.
If a cortex library has a getI18n(locale) method, use that instead (recommended).

### Calling extension actions (use AIMEAT.auth session for authenticated fetch):

╔══════════════════════════════════════════════════════════════════════════╗
║  CRITICAL: session.fetch() returns ALREADY-PARSED JSON, not Response.  ║
║  Do NOT call resp.json() — it will crash with "not a function".        ║
║  Access resp.ok, resp.data, resp.error directly.                       ║
╚══════════════════════════════════════════════════════════════════════════╝

\\\`\\\`\\\`javascript
// Helper for extension calls (copy this EXACTLY):
// method MUST match the extension action's declared HTTP method (GET or POST)
async function extCall(extName, actionId, body = {}, method = 'POST') {
  const session = AIMEAT.auth.getSession();
  if (!session) throw new Error('Not logged in');
  const basePath = '/v1/ext/' + extName + '/' + actionId;
  const opts = { method };
  if (method === 'POST' || method === 'PUT') {
    opts.body = JSON.stringify(body || {});
  }
  const url = method === 'GET' && body && Object.keys(body).length > 0
    ? basePath + '?' + new URLSearchParams(body).toString()
    : basePath;
  const resp = await session.fetch(url, opts);
  // resp is ALREADY parsed JSON — never call resp.json()
  if (!resp.ok) throw new Error(resp.error?.message || 'Extension call failed');
  return resp.data;  // unwrapped payload
}

// Usage — check the extension manifest for each action's method:
const result = await extCall('my-extension', 'my-action', { query: 'test' }, 'POST');
const data = await extCall('my-extension', 'get-data', {}, 'GET');
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
  connect-src 'self' https://*.tile.openstreetmap.org https://cdn.jsdelivr.net https://unpkg.com;
">
\\\`\\\`\\\`
Only include CDN domains you actually use. Without this tag, CDN scripts will be BLOCKED silently.

IMPORTANT: If your app uses Leaflet or any map library that loads tiles from external servers,
you MUST add the tile server domain to \`connect-src\`. For OpenStreetMap: \`https://*.tile.openstreetmap.org\`.
Without this, the map will appear but tiles will be blocked and it shows a grey/empty map.

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

Values are JSON objects — a single value can hold arrays, nested objects, and large datasets (up to several MB). There is NO reason to split a dataset across multiple keys when it logically belongs together.

## Rules
- All keys MUST be lowercase with dots as namespace separators
- Date-bucketed keys MUST use YYYY-MM-DD format: "items.by-date.2026-03-14"
- All date/time values inside objects MUST be ISO 8601: "2026-03-14T13:00:00.000Z"
- Include __meta with version and description for every namespace
- Include __index if consumers need to discover which keys exist (e.g., list of dates with data)
- Keep __index lightweight — just key names, counts, and pointers. NOT full data copies.
- Use arrays for ordered collections within a bucket (e.g., entries per day)
- Use meaningful field names that match the CSM data_schema where applicable
- PREFER fewer, larger keys over many small keys. A lookup table, reference dataset, or configuration object should be ONE key containing the full data structure (object or array), NOT split into one key per entry. For example, a list of 300 items should be ONE key "catalog.data" containing the full array — NOT 300 separate keys.

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

- Keys use dot-namespaced paths matching the UI structure: "app.list.title", "app.filters.status"
- Group by UI section: "app.nav.*", "app.map.*", "app.filters.*", "app.stats.*"
- Include domain-specific terms: categories, statuses, types relevant to the project
- Use interpolation with \${variable} syntax for dynamic values: "Found \${count} items"

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
- Use plural-aware keys where needed: "item.one" / "item.many"
- Both locale components MUST use the SAME key structure — the app uses the same keys for both

Return JSON with translations for the SINGLE locale from the label:

Example — if label is "Finnish (fi) Strings":
\`\`\`json
{
  "fi": {
    "app.title": "Sovelluksen nimi",
    "app.nav.home": "Etusivu",
    "app.filters.status": "Tila",
    "app.filters.all": "Kaikki",
    "app.empty": "Tietoja ei löytynyt",
    "app.error": "Jokin meni pieleen",
    "domain.type.example_category": "Esimerkkikategoria",
    "domain.status.active": "Aktiivinen"
  }
}
\`\`\`

Example — if label is "English (en) Strings":
\`\`\`json
{
  "en": {
    "app.title": "App Title",
    "app.nav.home": "Home",
    "app.filters.status": "Status",
    "app.filters.all": "All",
    "app.empty": "No data found",
    "app.error": "Something went wrong",
    "domain.type.example_category": "Example Category",
    "domain.status.active": "Active"
  }
}
\`\`\``,

  cortex: (label, context, completedComponents) => {
    // Build extension reference from completed components
    const extComponents = (completedComponents || []).filter(c => c.type === 'extension');
    let extRef = '';
    if (extComponents.length > 0) {
      extRef = `\n## Registered Extensions (your cortex wraps these)\n`;
      extRef += `\nIMPORTANT: Use readExtMemory(EXT.name, 'key') to read from extension namespace.\n`;
      extRef += `The extension name in EXT object MUST exactly match the registered metadata.name.\n\n`;
      for (const ext of extComponents) {
        // Use registeredAs (canonical name from registration), fallback to regex then label
        const extName = ext.registeredAs
          || ext.result?.match?.(/name:\s*"?([^\s"]+)"?/)?.[1]
          || ext.label;
        extRef += `- **${extName}** (${ext.label}): memory owner = \`ext:${extName}\`\n`;
        if (ext.result) {
          // Include API summary with memory keys and data shapes — NOT full code.
          // This gives the cortex enough info to generate correct wrapper methods
          // without overwhelming the AI with thousands of lines of extension code.
          extRef += summarizeExtensionApi(ext.result);
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

## CRITICAL: Use the Extension API Summary Above

The extension API summary shows the EXACT memory keys and data shapes. Your cortex MUST match them:

╔══════════════════════════════════════════════════════════════════════════╗
║  1. Use the "Memory writes" keys as your readExtMemory() keys          ║
║  2. Use the "Data shape" info to know what fields the data contains    ║
║  3. Your getPublic() calls MUST use those EXACT same keys              ║
║  4. Your methods MUST return data in the EXACT shape the extension     ║
║     stores it — do NOT invent new field names or structures            ║
║  5. Use the "Action" endpoints for callExt() on-demand calls           ║
╚══════════════════════════════════════════════════════════════════════════╝

Example: if the extension writes to key "orders.data" with shape { id, title, ... }
then your cortex must read \`getPublic('ext:extension-name', 'orders.data')\`
and return objects with the SAME structure — NOT \`data\`, NOT \`entries\`, NOT \`results\`.

## Design Principles

1. **Domain Cohesion**: Group related operations into a single API surface
2. **Facade Pattern**: Hide extension namespaces (\`ext:{name}\`), memory key patterns, and error handling
3. **DRY / Genericity**: If a capability is reusable across projects, make it generic
4. **Smart Init**: \`init()\` checks if data exists and returns status — see init() rules below
5. **Composability**: Cortex libs can use other cortex libs via \`AIMEAT.{otherLib}\`
6. **Self-Documenting**: Export clear, named functions with consistent patterns

## What Cortex Libraries Can Contain

Cortex is a CLIENT-SIDE JavaScript library. It can contain:

- **Data access methods**: read/write AIMEAT memory, call extension actions (on-demand only)
- **UI components**: functions that create DOM elements, render HTML, inject CSS
- **Visualization helpers**: chart builders, map renderers, interactive widgets
- **Event handling**: click handlers, ResizeObserver, custom events
- **Domain logic**: client-side data transformation, filtering, sorting, formatting

Example: \`aimeat-charts\` cortex exports \`ChartPanel()\` and \`ChartBuilder()\` — functions that create \`<canvas>\` elements, inject CSS styles, and render interactive Chart.js visualizations.

A cortex library is NOT limited to data access — it can be a full UI component library.
However, it MUST NOT contain backend/server logic (no scheduling, no data collection, no recurring tasks — that belongs to extensions).

## IMPORTANT: How Extension Memory Works

Extensions store data in their OWN namespace (\`ext:{name}\`).

╔══════════════════════════════════════════════════════════════════════════╗
║  CRITICAL: Extension namespace is READ-ONLY from client-side.          ║
║                                                                        ║
║  ✅ Client CAN READ:   getPublic('ext:my-collector', 'some.key')       ║
║  ❌ Client CANNOT WRITE: PUT /v1/memory/ext:name/key → 404             ║
║                                                                        ║
║  To WRITE extension data, call an extension ACTION via callExt()       ║
║  which runs server-side and uses ctx.memory.set().                     ║
║                                                                        ║
║  For USER data (watches, settings, preferences), use writeOwnerMemory  ║
║  which writes to the CURRENT USER's namespace via PUT /v1/memory/:key  ║
╚══════════════════════════════════════════════════════════════════════════╝

To READ extension data from client-side:
\\\`\\\`\\\`javascript
// If AIMEAT.data is loaded (preferred):
const value = await AIMEAT.data.getPublic('ext:my-collector', 'items.by-date.__index');

// Fallback without AIMEAT.data:
const url = NODE_URL + '/v1/memory/' + encodeURIComponent('ext:my-collector') + '/' + encodeURIComponent(key);
const resp = await fetch(url);
const json = await resp.json();
const value = json.ok ? json.data.value : null;
\\\`\\\`\\\`

To WRITE data that belongs to the extension (shared across all users):
\\\`\\\`\\\`javascript
// WRONG — will 404:
await session.fetch('/v1/memory/ext:my-collector/' + key, { method: 'PUT', ... });

// CORRECT — call an extension action that does ctx.memory.set() server-side:
await callExt('my-collector', 'updateWatches', { watches: updatedList });
\\\`\\\`\\\`

To WRITE data that belongs to the current user (personal preferences):
\\\`\\\`\\\`javascript
// CORRECT — writes to user's own namespace:
await writeOwnerMemory('settings.config', { locale: 'fi', notifications: true });
\\\`\\\`\\\`

## IMPORTANT: How Translations Work

Translations are stored in the EXTENSION's memory namespace (copied there during init).
Read them via readExtMemory — this works for ALL users, not just the service owner:
\\\`\\\`\\\`javascript
// Read translation via extension namespace (accessible to everyone):
const fiStrings = await readExtMemory(EXT.collector, 'i18n.fi');
const enStrings = await readExtMemory(EXT.collector, 'i18n.en');
\\\`\\\`\\\`

Do NOT use AIMEAT.data.get('i18n.fi') — that reads from the CURRENT USER's namespace
and will fail for users who didn't install the service.

## IMPORTANT: How Settings Work

Default settings are in the extension namespace (copied during init).
User-specific settings are in each user's OWN namespace:
\\\`\\\`\\\`javascript
// Read defaults from extension namespace:
const defaults = await readExtMemory(EXT.collector, 'settings.config') || {};

// Read user's personal overrides (may be null for new users):
const userSettings = await readOwnerMemory('settings.config');

// Merge: user overrides win
const settings = { ...defaults, ...(userSettings || {}) };
\\\`\\\`\\\`

## Extension Action Calls (authenticated)

Use callExt() for TWO purposes:
1. **On-demand user actions** (search, refresh, manual trigger)
2. **Writing shared data** — extension actions run server-side and CAN write to ext: namespace

\\\`\\\`\\\`javascript
// method MUST match the extension action's declared method (GET or POST)
async function callExt(extName, actionId, body, method = 'POST') {
  const session = AIMEAT.auth && AIMEAT.auth.getSession();
  if (!session) throw new Error('Not logged in');
  const opts = { method };
  if (method === 'POST' || method === 'PUT') {
    opts.body = JSON.stringify(body || {});
  }
  const url = method === 'GET' && body && Object.keys(body).length > 0
    ? '/v1/ext/' + extName + '/' + actionId + '?' + new URLSearchParams(body).toString()
    : '/v1/ext/' + extName + '/' + actionId;
  const resp = await session.fetch(url, opts);
  if (!resp.ok) throw new Error((resp.error && resp.error.message) || 'Extension call failed');
  return resp.data;
}
\\\`\\\`\\\`

CRITICAL: Check the extension manifest above — each action declares its HTTP method.
Use \`callExt(EXT.name, 'actionId', {input}, 'GET')\` for GET actions and
\`callExt(EXT.name, 'actionId', {input})\` for POST actions. Using the WRONG method will fail.

### Where to store different types of data

| Data type | Where to store | How to write |
|-----------|---------------|-------------|
| Shared/service data (feeds, stats, reference) | ext:{name} namespace | Extension scheduler via ctx.memory.set() |
| Shared user-generated data (watches, alerts) | ext:{name} namespace | Extension action via callExt() → ctx.memory.set() |
| Personal user preferences (settings, locale) | User's own namespace | writeOwnerMemory() via PUT /v1/memory/:key |

## Output format — TWO separate code blocks

Return the YAML manifest and JavaScript library as TWO separate, properly tagged code blocks.
The installer expects to receive them separately — the YAML defines the manifest, the JS is the library file.

CRITICAL: Use \\\`\\\`\\\`yaml for the manifest and \\\`\\\`\\\`javascript for the library code.
Do NOT combine them into a single block. Do NOT use an untagged block.

First block — YAML manifest:
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
        AIMEAT.myLib.init() — Check data readiness and return status
        AIMEAT.myLib.getData(filters) — Get filtered data
        AIMEAT.myLib.getStats(date) — Get statistics for a date

        To load in an app:
        <script src="{{node_url}}/v1/cortex/my-domain-lib/libs/my-domain-lib.js"></script>

    - type: lib
      name: my-domain-lib
      filename: my-domain-lib.js
      exports: [init, getData, getStats]
      api_surface: |
        AIMEAT.myLib.init() — Check data readiness, returns { ready, hasData }
        AIMEAT.myLib.getData({hours, type}) — Filtered domain data
        AIMEAT.myLib.getStats(date) — Aggregated statistics
\\\`\\\`\\\`

Second block — JavaScript library:
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

  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  CRITICAL: session.fetch() returns ALREADY-PARSED JSON (not Response). ║
  // ║  Do NOT call resp.json() — it will crash. Use resp.data directly.      ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  // method MUST match extension action's declared method (GET or POST)
  async function callExt(extName, actionId, body, method = 'POST') {
    const session = AIMEAT.auth && AIMEAT.auth.getSession();
    if (!session) return null;
    const opts = { method };
    if (method === 'POST' || method === 'PUT') {
      opts.body = JSON.stringify(body || {});
    }
    const url = method === 'GET' && body && Object.keys(body).length > 0
      ? '/v1/ext/' + extName + '/' + actionId + '?' + new URLSearchParams(body).toString()
      : '/v1/ext/' + extName + '/' + actionId;
    const resp = await session.fetch(url, opts);
    if (!resp || !resp.ok) return null;
    return resp.data;  // ALREADY parsed — never call resp.json()
  }

  // ── Public API ──

  async function init() {
    // Check if extension scheduler has produced data yet
    const cursor = await readExtMemory(EXT.collector, 'data.cursor');
    return { ready: true, hasData: !!cursor };
    // App shows empty state if hasData is false — scheduler will populate data in background
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

CRITICAL: Use TWO separate code blocks — \\\`\\\`\\\`yaml for the manifest and \\\`\\\`\\\`javascript for the library.
The JavaScript filename MUST match the \`filename\` field in the YAML lib component.

## Rules

### CRITICAL: Name Consistency
The YAML \`metadata.name\` and the JS \`LIB_NAME\` MUST follow this convention:
- YAML \`metadata.name\`: kebab-case (e.g., \`my-domain-lib\`)
- JS \`LIB_NAME\`: MUST be declared with \`const\` (not var or let): \`const LIB_NAME = 'myDomainLib';\`
- JS \`LIB_NAME\`: camelCase version of the SAME name (e.g., \`myDomainLib\`)
- \`AIMEAT.register(LIB_NAME, exports)\` uses the camelCase name
- Apps load via: \`/v1/cortex/{metadata.name}/libs/{metadata.name}.js\`
- Apps access via: \`AIMEAT.{LIB_NAME}.method()\`

Example: YAML name \`my-domain-lib\` → LIB_NAME = \`myDomainLib\` → \`AIMEAT.myDomainLib.init()\`

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

╔══════════════════════════════════════════════════════════════════════════╗
║  init() is a UI READINESS CHECK — it does NOT trigger backend logic.    ║
║  The extension scheduler handles all data collection and computation.   ║
║  Cortex init() only checks what data is available and returns status.  ║
╚══════════════════════════════════════════════════════════════════════════╝

\\\`\\\`\\\`javascript
async function init() {
  // 1. Check if data exists by reading the primary cursor/index key
  const cursor = await readExtMemory(EXT.collector, 'data.cursor');

  // 2. Return status so the app knows what to show
  if (cursor) {
    return { ready: true, hasData: true };
  }

  // 3. No data yet — scheduler hasn't run. App should show empty/loading state.
  return { ready: true, hasData: false };
}
\\\`\\\`\\\`

Rules for init():
- NEVER trigger extension actions (callExt) from init() — the extension scheduler handles all recurring work
- NEVER set up intervals, timers, or recurring triggers
- NEVER call init() automatically inside the cortex IIFE — let the app call it
- init() MUST be idempotent — calling it twice returns the same status
- Return \`{ ready: true }\` always — the app checks this to know the cortex is loaded
- Return \`{ hasData: false }\` when no data exists yet — the app shows an appropriate empty state ("Data is being collected, please wait...")
- The ONLY place where callExt() is appropriate in a cortex is for ON-DEMAND user actions (e.g., findNearby, manual refresh button) — never for scheduled/background work

## CRITICAL: Empty-State Handling (first-run scenario)

On first run, the extension scheduler may not have run yet — NO data exists.
init() returns \`{ ready: true, hasData: false }\` and the app shows a waiting state.
Every method MUST handle missing data gracefully:

\\\`\\\`\\\`javascript
// WRONG — crashes if index doesn't exist:
async function getData() {
  const index = await readExtMemory(EXT.collector, 'items.__index');
  return index.dates.map(d => ...);  // TypeError: Cannot read 'dates' of null
}

// CORRECT — return empty data:
async function getData() {
  const index = await readExtMemory(EXT.collector, 'items.__index');
  if (!index || !index.dates || index.dates.length === 0) return [];
  // ... process data
}
\\\`\\\`\\\`

EVERY readExtMemory/getPublic call must be followed by a null/undefined check.
NEVER assume data exists — the user may open the app before any extension has run.`;
  },
};

/**
 * Summarize extension code into a compact API reference (actions, memory keys, data shapes).
 * Avoids injecting thousands of lines of full extension code into prompts.
 */
function summarizeExtensionApi(result) {
  if (!result) return '  (no code available)\n';
  const lines = typeof result === 'string' ? result.split('\n') : [];
  const summary = [];

  // Extract metadata.name
  const nameMatch = result.match(/name:\s*"?([^\s"]+)"?/);
  if (nameMatch) summary.push(`  Extension name: ${nameMatch[1]}`);

  // Extract actions (id, method, path, description)
  const actionRegex = /- id:\s*(\S+)/g;
  const descRegex = /description:\s*"([^"]+)"/g;
  const methodRegex = /method:\s*(\S+)/g;
  const pathRegex = /path:\s*(\S+)/g;

  // Parse YAML actions section
  const actionsStart = result.indexOf('actions:');
  const schedulesStart = result.indexOf('schedules:');
  const actionsSection = actionsStart >= 0
    ? result.substring(actionsStart, schedulesStart >= 0 ? schedulesStart : undefined)
    : '';

  if (actionsSection) {
    const actionBlocks = actionsSection.split(/\n  - id:/);
    for (const block of actionBlocks.slice(1)) {
      const id = block.split('\n')[0].trim();
      const desc = block.match(/description:\s*"([^"]+)"/)?.[1] || '';
      const method = block.match(/method:\s*(\S+)/)?.[1] || 'POST';
      const path = block.match(/path:\s*(\S+)/)?.[1] || '';
      summary.push(`  Action: ${method} ${path} (${id}) — ${desc}`);
      // Extract input properties
      const inputProps = block.match(/properties:\n((?:\s+\w+:\n(?:\s+\w+:.*\n)*)*)/);
      if (inputProps) {
        const propNames = [...inputProps[1].matchAll(/^\s{8}(\w+):/gm)].map(m => m[1]);
        if (propNames.length) summary.push(`    Input: { ${propNames.join(', ')} }`);
      }
    }
  }

  // Extract memory keys from ctx.memory.set() and ctx.memory.get() calls
  const memSetKeys = new Set();
  const memGetKeys = new Set();
  for (const match of result.matchAll(/ctx\.memory\.set\(['"]([^'"]+)['"]/g)) {
    memSetKeys.add(match[1]);
  }
  for (const match of result.matchAll(/ctx\.memory\.get\(['"]([^'"]+)['"]/g)) {
    memGetKeys.add(match[1]);
  }
  if (memSetKeys.size > 0) summary.push(`  Memory writes: ${[...memSetKeys].join(', ')}`);
  if (memGetKeys.size > 0) summary.push(`  Memory reads: ${[...memGetKeys].join(', ')}`);

  // Extract data shapes from ctx.memory.set() values (first occurrence)
  for (const key of memSetKeys) {
    const setPattern = new RegExp(`ctx\\.memory\\.set\\(['"]${key.replace(/\./g, '\\.')}['"],\\s*\\{([^}]{1,200})`);
    const shapeMatch = result.match(setPattern);
    if (shapeMatch) {
      summary.push(`  Data shape for "${key}": { ${shapeMatch[1].trim()} ... }`);
    }
  }

  return summary.join('\n') + '\n';
}

/**
 * Summarize cortex code into a compact API reference (public methods).
 */
function summarizeCortexApi(result) {
  if (!result) return '  (no code available)\n';
  const summary = [];

  // Extract metadata.name
  const nameMatch = result.match(/name:\s*"?([^\s"]+)"?/);
  if (nameMatch) summary.push(`  Cortex name: ${nameMatch[1]}`);

  // Extract LIB_NAME
  const libMatch = result.match(/const\s+LIB_NAME\s*=\s*['"]([^'"]+)['"]/);
  if (libMatch) summary.push(`  JS access: AIMEAT.${libMatch[1]}`);

  // Extract public methods (async function declarations that are exported)
  const methodRegex = /async\s+function\s+(\w+)\s*\(/g;
  const methods = [];
  let match;
  while ((match = methodRegex.exec(result)) !== null) {
    methods.push(match[1]);
  }
  if (methods.length > 0) summary.push(`  Public methods: ${methods.join(', ')}`);

  // Extract EXT object (extension names this cortex wraps)
  const extMatch = result.match(/const\s+EXT\s*=\s*\{([^}]+)\}/);
  if (extMatch) summary.push(`  Wraps extensions: ${extMatch[1].trim()}`);

  // Extract readExtMemory calls (memory keys this cortex reads)
  const readKeys = new Set();
  for (const m of result.matchAll(/readExtMemory\([^,]+,\s*['"]([^'"]+)['"]/g)) {
    readKeys.add(m[1]);
  }
  if (readKeys.size > 0) summary.push(`  Reads memory keys: ${[...readKeys].join(', ')}`);

  return summary.join('\n') + '\n';
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

  // Thread interview data source details to extension prompts
  if (type === 'extension' && interviewSpec?.dataSources) {
    context += '\n## Data Source Details (from interview — use these to write correct parsers)\n';
    for (const ds of interviewSpec.dataSources) {
      context += `- **${ds.name}** (${ds.type}): ${ds.url || 'user-input'}\n`;
      if (ds.encoding) context += `  Encoding: ${ds.encoding}\n`;
      if (ds.sampleEntry) context += `  Sample entry (REAL DATA — write your parser against this):\n  \`\`\`\n  ${ds.sampleEntry}\n  \`\`\`\n`;
      if (ds.staticData && Array.isArray(ds.staticData)) {
        context += `  **STATIC DATA (${ds.staticData.length} entries) — pre-loaded in OWNER memory. Read with ctx.memory.getPublic(ctx.caller.owner, key), do NOT re-create it.**\n`;
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

/* ── Fix Prompts ─────────────────────────────────────── */

export function buildBlueprintFixPrompt(description, errors, interviewSpec = null) {
  return `${INSTRUCTION_DISCLAIMER}Your previous blueprint response was not valid. DO NOT try to fix the old response — generate a fresh one.

ERRORS from previous attempt:
${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

Common mistakes to avoid:
- Do NOT include manifest content, code, HTML, or implementation details in the blueprint
- Each component must have: "id", "type", "label", "produces", "consumes". Extension components may also have "schedules".
- The entire response must be valid JSON — no trailing commas, no unescaped quotes

${buildBlueprintPrompt(description, interviewSpec)}`;
}

export function buildFixPrompt(originalPrompt, failedResult, errors, componentType, testContext) {
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

  return `${INSTRUCTION_DISCLAIMER}The following result had validation errors. Fix ONLY the errors listed below.

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
${testContext ? buildTestContextSection(testContext) : ''}
Return the corrected result in the same format as the original.`;
}

/** Build a test failure context section for fix prompts */
function buildTestContextSection(testContext) {
  let section = '\n\n## Test Failure Context\n';
  section += 'Test errors:\n' + testContext.errors.join('\n') + '\n';
  if (testContext.dependencyResults) {
    section += '\nDependency test results (these passed):\n';
    for (const dep of testContext.dependencyResults) {
      section += '- ' + dep.componentId + ': ' + dep.status + '\n';
    }
  }
  if (testContext.blueprintComponent) {
    const bc = testContext.blueprintComponent;
    section += '\nBlueprint component spec:\n';
    section += '- type: ' + bc.type + ', produces: ' + (bc.produces || []).join(', ') + ', consumes: ' + (bc.consumes || []).join(', ') + '\n';
  }
  return section;
}

/* ── Test Generation Prompts (Prompt-Driven) ─────────── */

/**
 * Build a prompt for the AI to generate executable test code for a component.
 * The AI writes JavaScript that will be executed to test the component.
 * Same flow as component generation: prompt → AI → result → execute.
 *
 * For server-side tests (extension, MSM, memory, translation):
 *   AI generates JS that uses testFetch(url, opts) and returns { passed, errors, details }
 *
 * For client-side tests (cortex, app):
 *   AI generates JS that runs in browser (Playwright), sets window.__testResults = { passed, errors }
 */
export function buildTestPrompt(componentType, componentCode, componentLabel, registeredAs, blueprint, interviewSpec) {
  const testEnvDoc = componentType === 'cortex' || componentType === 'app'
    ? `## Test Environment: Browser (page.evaluate sandbox)

CRITICAL SANDBOX RULES — violating ANY of these will crash the test:
- NO import statements — FORBIDDEN
- NO require() calls — FORBIDDEN
- NO export statements — FORBIDDEN
- Your code runs inside page.evaluate() in a real browser page
- You have access to: window, document, fetch, DOM APIs
- Set results on: window.__testResults = { passed: boolean, errors: string[], details: string }

For CORTEX tests:
- The cortex library is loaded at: /v1/cortex/{name}/libs/{name}.js
- Access it via: window.AIMEAT.{camelCaseName}
- Test init() AND every public method
- Call methods with realistic arguments based on the component code
- Verify return values are not null/undefined and have expected shape

For APP tests:
- The app is already loaded in the page
- Wait for data to render: await new Promise(r => setTimeout(r, 3000));
- Check DOM elements exist: document.querySelector(...)
- Click buttons and navigation, verify results
- Check no error messages visible
- Take note of what the interview spec says the use cases are`
    : `## Test Environment: Server-side sandbox (new Function)

CRITICAL SANDBOX RULES — violating ANY of these will crash the test:
- NO import statements (import x from '...')  — FORBIDDEN, causes "Cannot use import statement"
- NO require() calls — FORBIDDEN, not available
- NO export statements — FORBIDDEN
- NO top-level declarations with const/let outside of the function body scope
- You are inside an async function body. Just write sequential code.
- You have exactly TWO variables available: testFetch and baseUrl
- No other globals, no Node.js APIs, no fs, no path, no process

Available helper:

  const resp = await testFetch(url, { method, body, headers });
  // resp = { status: number, ok: boolean, body: object }
  // Auth token is injected automatically. Do NOT set Authorization header.

URLs must start with / (e.g., /v1/ext/my-ext/actionId)
baseUrl is available but testFetch prepends it automatically for / URLs.

Your code MUST end with: return { passed: boolean, errors: string[], details: string }
- passed: true if ALL checks succeeded
- errors: array of failure descriptions (empty array if passed)
- details: human-readable summary of what was tested

PATTERN — follow this exact structure:
\`\`\`
const errors = [];

// Test 1
const r1 = await testFetch('/v1/ext/${registeredAs}/actionName', { method: 'POST', body: JSON.stringify({ key: 'value' }) });
if (!r1.ok) errors.push('actionName failed: status ' + r1.status);
else if (!r1.body?.data) errors.push('actionName returned no data');

// Test 2 ...

return { passed: errors.length === 0, errors, details: 'Tested N actions' };
\`\`\`

For EXTENSION tests:
- Call each action endpoint: /v1/ext/{registeredName}/{actionId}
- NOT /v1/extensions/... — correct path is /v1/ext/{name}/{actionId}
- Use the correct HTTP method (GET/POST as declared in the extension manifest)
- For GET actions: append query params to URL (e.g., /v1/ext/name/action?param=value)
- For POST actions: pass input as JSON body with JSON.stringify()
- Verify response has ok:true and meaningful data field
- Test with realistic input based on what the extension does

For MEMORY tests:
- Write a test value with PUT /v1/memory/{key}, read with GET /v1/memory/{key}, verify, cleanup

For TRANSLATION tests:
- Read the translation key, verify it has content`;

  const bpComponents = blueprint?.components?.map(c => `- ${c.id} (${c.type}): ${c.label}`).join('\n') || '';
  const useCases = interviewSpec?.useCases?.map((uc, i) => `${i + 1}. ${uc}`).join('\n') || 'No use cases specified';

  return `${INSTRUCTION_DISCLAIMER}You are generating TEST CODE for a component in an AIMEAT service.

## Component Under Test
- Type: ${componentType}
- Label: ${componentLabel}
- Registered as: ${registeredAs || 'unknown'}

## Component Code
\`\`\`
${componentCode}
\`\`\`

## Project Context
Blueprint components:
${bpComponents}

Use cases from interview:
${useCases}

${testEnvDoc}

## Output Rules

1. Return ONLY executable JavaScript code — NO markdown fences, NO explanation text, NO comments outside code
2. NO import/require/export — your code runs in a sandbox (new Function for server, page.evaluate for browser)
3. Code must be a self-contained async function body (you are already inside an async function)
4. For server tests: you MUST return { passed: boolean, errors: string[], details: string }
5. For browser tests: you MUST set window.__testResults = { passed: boolean, errors: string[], details: string }

## What to test

- Does the component actually work? Not just "does it exist"
- Call real endpoints with real input data based on the component code above
- Verify response shapes match what the code produces
- Test error handling (empty input, missing fields)
- For apps: verify the use cases from the interview actually work in the UI
- DO NOT write placeholder tests — every assertion must verify real behavior

## Complete server-side example (extension with two actions)

const errors = [];

// Test getItems action (GET)
const r1 = await testFetch('/v1/ext/my-service/getItems?limit=5');
if (!r1.ok) errors.push('getItems: HTTP ' + r1.status);
else if (!r1.body?.data) errors.push('getItems: no data in response');
else if (!Array.isArray(r1.body.data.items)) errors.push('getItems: items is not an array');

// Test addItem action (POST)
const r2 = await testFetch('/v1/ext/my-service/addItem', {
  method: 'POST',
  body: JSON.stringify({ name: 'Test Item', value: 42 })
});
if (!r2.ok) errors.push('addItem: HTTP ' + r2.status);
else if (!r2.body?.data?.id) errors.push('addItem: no id returned');

// Test edge case: empty body
const r3 = await testFetch('/v1/ext/my-service/addItem', {
  method: 'POST',
  body: JSON.stringify({})
});
if (r3.ok) errors.push('addItem with empty body should fail but returned ok');

return { passed: errors.length === 0, errors, details: 'Tested getItems, addItem, edge case: ' + (3 - errors.length) + '/3 passed' };`;
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

  return `${INSTRUCTION_DISCLAIMER}You are analyzing the impact of a change to an AIMEAT service.

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

  return `${INSTRUCTION_DISCLAIMER}${AIMEAT_CONTEXT}

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
