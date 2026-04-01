/**
 * @file generator-prompt-seeds.ts
 * @description Generator prompt seeds — EXACT content from the original browser JS files.
 *   These templates are the SAME text that produced working output in V7/V8 pipeline tests.
 *   DO NOT summarize, rewrite, or "improve" these. They are calibrated.
 *   Variables use {{name}} syntax, resolved by resolvers.ts at runtime.
 * @version-history
 *   v1.0.0 — 2026-04-01 — Initial seeds (summaries — BROKEN)
 *   v2.0.0 — 2026-04-01 — Replaced with EXACT original content from generator-prompts-base.js
 */

import type { PromptSeedEntry } from './prompt-defaults.js';

export const GENERATOR_PROMPT_SEEDS: PromptSeedEntry[] = [

  // ═══════════════════════════════════════════════════════════════════
  // Shared Fragments — EXACT text from generator-prompts-base.js
  // ═══════════════════════════════════════════════════════════════════

  {
    id: 'gen-context',
    group: 'generator',
    name: 'AIMEAT Context',
    description: 'Shared preamble — building blocks, extension sandbox API, data standards. Injected into all prompts via {{context}}.',
    content: `You are helping create an AIMEAT service. AIMEAT is an AI agent infrastructure protocol.

Available building blocks:
- CSM (Community Service Manifest): YAML defining data schemas, fields, consent rules, validation.
- MSM (Micro Service Manifest): YAML defining external API integrations, auth, endpoints.
- Extension: V8-sandboxed JavaScript logic with YAML manifest. Actions get ctx object with memory, wallet, consent, trust, fetch APIs.
- App: HTML/JS user interface published to the apps catalog.
- Memory: Key-value storage with namespace isolation.
- Translation: Per-locale i18n strings.
- Cortex: Client-side JS domain library (IIFE on AIMEAT namespace). Wraps extension APIs and memory reads into clean domain methods for apps.

Extensions run in an ISOLATED V8 sandbox with ONLY this API (no Node.js, no global fetch, no setTimeout, no require, no import):
  ctx.memory.get(key) → value or null (ALWAYS null-check before using: \`|| []\` or \`|| {}\`)
  ctx.memory.set(key, value) → void
  ctx.memory.search(prefix) → Array<{ key, value }> (NOT plain strings!)
  ctx.memory.delete(key) → boolean
  ctx.memory.getPublic(namespace, key) → value or null (read data from a DIFFERENT namespace)
    Use this to read: (a) another extension's public data, (b) the OWNER's shared data (memory components, translations, settings).
    Example — read another extension's data: await ctx.memory.getPublic('ext:other-ext', 'some.key')
    Example — read owner's shared data: await ctx.memory.getPublic(ctx.caller.gaii, 'lookup.data')
    ╔═══════════════════════════════════════════════════════════════════════════════╗
    ║  IMPORTANT: ctx.memory.get() ONLY reads from the extension's OWN namespace. ║
    ║  Data stored by memory components (seed data, settings, translations) lives  ║
    ║  in the OWNER's namespace — use ctx.memory.getPublic(ctx.caller.gaii, key)  ║
    ║  to access it. ctx.caller.gaii is the caller's GHII identity.               ║
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
  Currency/amounts: integers (no floats) — morsels are whole numbers.`,
    variables: [],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-disclaimer',
    group: 'generator',
    name: 'Instruction Disclaimer',
    description: 'Prefix for all generator prompts — instructs the AI to follow rules exactly.',
    content: `IMPORTANT: These are detailed instructions that you MUST read carefully and follow exactly. Every rule, constraint, format requirement, and example below exists for a reason. Do NOT skip sections, do NOT invent your own conventions, and do NOT deviate from the specified output format. If a rule says "MUST" or "NEVER", treat it as absolute.`,
    variables: [],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-sandbox-constraints',
    group: 'generator',
    name: 'V8 Sandbox Constraints',
    description: 'EXACT sandbox rules from generator-prompts-base.js SANDBOX_CONSTRAINTS constant.',
    content: `## V8 Sandbox Environment

╔══════════════════════════════════════════════════════════════════════════╗
║  This is a BARE V8 JavaScript engine — NOT Node.js, NOT a browser.     ║
║  Only ECMAScript built-in objects and the ctx API exist.                ║
║  The ONLY way to interact with the outside world is through ctx.       ║
╚══════════════════════════════════════════════════════════════════════════╝

### What IS available (ECMAScript built-ins):
JSON, Math, Date, RegExp, Promise, async/await, String, Array, Object,
Map, Set, WeakMap, WeakSet, Symbol, Proxy, Reflect,
encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, isFinite

### What is NOT available:

**Node.js APIs** — no require, no import, no Buffer, no process, no fs, no path, no crypto
**Web APIs** — no URLSearchParams, no URL, no TextEncoder, no TextDecoder,
  no Headers, no Request, no Response, no FormData, no Blob, no File,
  no AbortController, no atob, no btoa, no structuredClone, no crypto (Web Crypto),
  no queueMicrotask, no performance
**Browser APIs** — no document, no window, no fetch (use ctx.fetch), no navigator
**Timers** — no setTimeout, no setInterval, no setImmediate
**Console** — no console.log (use ctx.log.info/warn/error)
**Modules** — no require(), no import (except export default for action entry point)

### URL construction (URLSearchParams is NOT available):
\`\`\`
WRONG:  const params = new URLSearchParams(); params.set('name', query);
WRONG:  const url = new URL(baseUrl); url.searchParams.set('name', query);
RIGHT:  const url = baseUrl + '?name=' + encodeURIComponent(query);
RIGHT:  const url = baseUrl + '?name=' + encodeURIComponent(query) + '&id=' + encodeURIComponent(id);
\`\`\`

### The ctx API — ONLY these properties exist:

╔══════════════════════════════════════════════════════════════════════════╗
║  ctx.memory (get/set/search/delete/getPublic)                          ║
║  ctx.fetch(url, opts) → { ok, status, text, headers }                  ║
║  ctx.wallet (consume/getBalance)                                        ║
║  ctx.consent (check/require)                                            ║
║  ctx.trust (getScore)                                                   ║
║  ctx.caller (gaii/owner/roles)                                          ║
║  ctx.config (extension config object)                                   ║
║  ctx.log (info/warn/error)                                              ║
║  ctx.notify(message, {title?, priority?, channel?}) → boolean           ║
║  ctx.email(to, subject, body) → boolean (requires SMTP configured)      ║
║  ctx.instance (id/config — only for instance-scoped actions)            ║
║  NOTHING ELSE. Do NOT invent methods that are not listed here.          ║
╚══════════════════════════════════════════════════════════════════════════╝

### Actions are INDEPENDENT — CANNOT call each other

╔══════════════════════════════════════════════════════════════════════════╗
║  Each action is a SEPARATE function. Actions CANNOT call each other.   ║
║  There is NO ctx.otherAction() or ctx.callAction() method.             ║
║  Writing ctx.getCompany() or ctx.searchItems() will CRASH with:        ║
║    "ctx.getCompany is not a function"                                  ║
║                                                                        ║
║  If multiple actions need the same logic, define a HELPER FUNCTION     ║
║  above the action exports and duplicate it in each script file.        ║
╚══════════════════════════════════════════════════════════════════════════╝

### ctx.memory.get — returns PARSED value, NOT string

╔══════════════════════════════════════════════════════════════════════════╗
║  NEVER WRITE: JSON.parse(await ctx.memory.get(...))                    ║
║  The value is ALREADY PARSED. JSON.parse on it will CRASH.             ║
║  CORRECT: const data = await ctx.memory.get("key") || [];              ║
╚══════════════════════════════════════════════════════════════════════════╝

### ctx.fetch — returns { ok, status, text, headers }
- text is a RAW string — parse JSON with JSON.parse(resp.text)
- Encoding auto-detected (Content-Type, XML prolog, HTML meta)
- You always get Unicode text — no manual decoding needed`,
    variables: [],
    usedIn: ['generator-autopilot'],
  },

  {
    id: 'gen-namespace-rules',
    group: 'generator',
    name: 'Namespace Rules',
    description: 'EXACT namespace rules from generator-prompts-base.js NAMESPACE_RULES constant.',
    content: `## AIMEAT Namespace Rules

AIMEAT has TWO types of memory namespaces — understanding this is CRITICAL:

1. **Owner namespace** — where the human user's data lives
   - Memory components (seed data, lookup tables) store here
   - Translation components store here (i18n.fi, i18n.en)
   - Settings components store here (settings.config)
   - Accessible via: ctx.memory.getPublic(ctx.caller.gaii, key) [from extension]
   - Accessible via: /v1/memory/{key} [from HTTP with owner's JWT]

2. **Extension namespace** (\`ext:{name}\`) — where extension runtime data lives
   - Extension writes here via ctx.memory.set(key, value)
   - Accessible to ALL users via: ctx.memory.getPublic('ext:{name}', key)
   - Accessible via: readExtMemory(name, key) [from cortex/app]
   - NOT accessible via /v1/memory/{key} (that reads owner namespace!)

╔══════════════════════════════════════════════════════════════════════════╗
║  Extension ctx.memory.get(key) ONLY reads from ext:{name} namespace.  ║
║  Seed data (memory components), settings, translations live in the     ║
║  OWNER's namespace — use ctx.memory.getPublic(ctx.caller.gaii, key). ║
║                                                                        ║
║  From OUTSIDE (cortex, app, tests):                                    ║
║  - Read extension data: getPublic('ext:{name}', key) or readExtMemory ║
║  - Read owner data: /v1/memory/{key} or AIMEAT.data.get(key)          ║
║  - Write extension data: call an extension ACTION (callExt)            ║
║  - You CANNOT PUT to ext:{name} namespace from client — returns 404   ║
╚══════════════════════════════════════════════════════════════════════════╝

### Init Action
Extensions should initialize runtime data (empty watchlists, caches, logs) in their @activate init action.
Do NOT copy translations or settings — cortex reads those from the owner namespace directly.`,
    variables: [],
    usedIn: ['generator-autopilot'],
  },

  {
    id: 'gen-html-entity-rules',
    group: 'generator',
    name: 'HTML Entity Rules',
    description: 'EXACT HTML entity rules from generator-prompts-base.js HTML_ENTITY_RULES constant.',
    content: `## No HTML Entities in Code

╔════════════════════════════════════════════════════════════════════╗
║  Your code MUST use real operators, NOT HTML entities.             ║
║  The V8 sandbox executes raw JS — HTML entities are syntax errors. ║
╚════════════════════════════════════════════════════════════════════╝

WRONG (crashes):  const gt = a =&gt; a &gt; 0 &amp;&amp; b;
CORRECT:          const gt = a => a > 0 && b;

Check your ENTIRE output. If you see &gt; &lt; &amp; &quot; &#39; anywhere
in code, replace them with > < & " ' respectively.`,
    variables: [],
    usedIn: ['generator-autopilot'],
  },

  {
    id: 'gen-extension-consumption-rules',
    group: 'generator',
    name: 'Extension Consumption Rules',
    description: 'EXACT extension consumption rules from generator-prompts-base.js EXTENSION_CONSUMPTION_RULES constant.',
    content: `## How to Consume Extensions (callExt / readExtMemory pattern)

Extensions expose TWO interfaces to the outside world:

### 1. Call actions via HTTP POST
  POST /v1/ext/{extensionName}/{actionId}
  Body: JSON input
  Response: { ok: true, data: { ...action return value... } }

  - ALL actions use POST (even if manifest says GET — the route is POST-only)
  - The {actionId} is the action's "id" field from the YAML manifest
  - r.body.ok is the AIMEAT envelope — ALWAYS true even when the action fails
  - Check r.body.data for the ACTUAL result (success data OR error message)

### 2. Read extension memory via getPublic
  Extension data lives in ext:{name} namespace.
  Read it: getPublic('ext:{name}', key) or readExtMemory(name, key)

  NEVER read extension data via /v1/memory/{key} — that reads the OWNER's
  namespace, not the extension's. You'll get null.

### Testing extensions — use callExt and readExtMemory
  The test sandbox provides callExt() and readExtMemory() — the SAME helpers
  that cortex uses in production. Use these instead of raw testFetch:

  callExt('ext-name', 'actionId', { input })  → action's return value (unwrapped)
  readExtMemory('ext-name', 'key')              → value from ext:{name} namespace

  DO NOT use testFetch for extension actions — use callExt.
  DO NOT use /v1/memory/ to read extension data — use readExtMemory.
  DO NOT create custom getMemory/setMemory helpers.

### Action types for testing
  - [MEMORY] actions: use ONLY ctx.memory (no external API). Tests MUST assert specific return values.
  - [EXTERNAL API] actions: call ctx.fetch to third-party URLs. Tests check response SHAPE only
    (has data fields OR error message), because the external API may be down/rate-limited.
    Graceful error handling is correct behavior — only FAIL on HTTP 500 (extension crashed).`,
    variables: [],
    usedIn: ['generator-autopilot'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // Component Templates — EXACT text from COMPONENT_TEMPLATES in generator-prompts-base.js
  // The ${AIMEAT_CONTEXT} is replaced by {{context}}, ${label} by {{label}}, ${context} by {{component_context}}
  // ═══════════════════════════════════════════════════════════════════

  {
    id: 'gen-csm',
    group: 'generator',
    name: 'CSM Generator',
    description: 'EXACT CSM template from COMPONENT_TEMPLATES.csm in generator-prompts-base.js.',
    content: `{{context}}

Create a CSM (Community Service Manifest) YAML for: {{label}}

{{component_context}}

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
    variables: ['context', 'label', 'component_context'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-memory',
    group: 'generator',
    name: 'Memory Generator',
    description: 'EXACT memory template from COMPONENT_TEMPLATES.memory in generator-prompts-base.js.',
    content: `{{context}}

Define memory structure for: {{label}}

{{component_context}}

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
    variables: ['context', 'label', 'component_context'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-translation',
    group: 'generator',
    name: 'Translation Generator',
    description: 'EXACT translation template from COMPONENT_TEMPLATES.translation in generator-prompts-base.js.',
    content: `{{context}}

Create translations for: {{label}}

{{component_context}}

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
\`\`\`

{{matching_keys_section}}`,
    variables: ['context', 'label', 'component_context', 'matching_keys_section'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // Spec Generation Prompts — kept from v1 (these were already correct)
  // ═══════════════════════════════════════════════════════════════════

  {
    id: 'gen-extension-spec',
    group: 'generator',
    name: 'Extension Spec Generator',
    description: 'Generates formal JSON contract for an extension — actions, memory keys, schedules, config.',
    content: `{{disclaimer}}

# Task: Generate Extension Spec

You are designing the PUBLIC CONTRACT for an AIMEAT platform extension. This spec defines what the extension provides — actions, memory keys, schedules, config — with exact types and real examples from the data source.

This is a SPEC, not code. No implementation, no function bodies, no ctx calls.
This extension is a PLATFORM CAPABILITY — it knows nothing about any app, cortex, or UI.

## Data Sources
{{data_sources}}

## Actions From Blueprint
{{blueprint_actions}}

## Data Structures
{{structures}}

## Memory Keys
{{memory_keys}}

## Schedules
{{schedules}}

## Config Keys
{{config_keys}}

## Output Format

Return ONLY valid JSON. No markdown fences, no explanation text.

{
  "name": "<kebab-case — describes the PLATFORM CAPABILITY>",
  "description": "<one-line: what this extension provides>",
  "actions": [
    {
      "id": "<action-id>",
      "description": "<what this action does>",
      "method": "POST",
      "path": "/v1/ext/<name>/<action-id>",
      "input": { "<param>": "<type and description>" },
      "output": { "<field>": "<type>" },
      "example": {
        "input": { "<real example from data source>" },
        "output": { "<real example — EXACT field names from sample data>" }
      },
      "errors": "<how errors are returned>"
    }
  ],
  "memoryKeys": [
    { "key": "<key>", "type": "<TypeScript type>", "description": "<what>", "example": "<value>" }
  ],
  "schedules": [
    { "id": "<id>", "action": "<action-id>", "cron": "<expression>", "description": "<what>" }
  ],
  "config": { "<key>": "<type — description>" },
  "usage": {
    "callPattern": "POST /v1/ext/<name>/<actionId> with JSON body",
    "authRequired": true,
    "memoryNamespace": "ext:<name>",
    "readMemory": "GET /v1/memory/ext%3A<name>/<key> (public, no auth)"
  }
}

## CRITICAL RULES
1. Use EXACT field names from data source sample entries. Copy character-for-character.
2. Every action MUST have an "example" with real data from the interview's sample entries.
3. Extension name describes the PLATFORM CAPABILITY: "prh-ytj", not "company-monitor-extension".
4. Do NOT mention any app, cortex, UI, or project.`,
    variables: ['disclaimer', 'data_sources', 'blueprint_actions', 'structures', 'memory_keys', 'schedules', 'config_keys'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-data-api-spec',
    group: 'generator',
    name: 'Data API Spec Generator',
    description: 'Generates data cortex spec — method signatures wrapping extension actions.',
    content: `{{disclaimer}}

# Task: Generate Data API Spec

Design the public API for a DATA CORTEX — a client-side JS library wrapping an AIMEAT extension.

## Extension Spec
\`\`\`json
{{extension_spec}}
\`\`\`

{{structures}}

## Output Format
Return ONLY valid JSON:
{
  "name": "<kebab-case>",
  "libName": "<camelCase — AIMEAT.<libName>>",
  "description": "<one-line>",
  "wrapsExtension": "<extension name>",
  "methods": [
    { "name": "<method>", "description": "<what>", "params": "<type>", "returns": "Promise<type>",
      "example": "const r = await AIMEAT.<libName>.<name>(<args>);",
      "returnsExample": "<from extension spec>",
      "errorBehavior": "Returns null on failure" }
  ],
  "translationAccess": "getTranslations(locale) → Promise<object>",
  "settingsAccess": "getSettings() → Promise<object>"
}

## Rules
1. One method per extension action. Clean names (searchCompanies, not extSearchCompanies).
2. Return types MUST match extension spec output exactly.
3. Include getTranslations and getSettings — read from owner namespace.
4. All methods return null on failure. No exceptions.`,
    variables: ['disclaimer', 'extension_spec', 'structures'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-component-spec',
    group: 'generator',
    name: 'Component Spec Generator',
    description: 'Generates reusable UI component spec — render signature, props, data access.',
    content: `{{disclaimer}}

# Task: Generate Component Spec

Design a REUSABLE UI COMPONENT — renders one thing well, composed by app-domain cortex.

## Component: {{component_label}}
{{view_context}}

## Available Data API
\`\`\`json
{{data_api_spec}}
\`\`\`

## Translation Keys
{{translation_keys}}

## Output Format
Return ONLY valid JSON:
{
  "name": "<kebab-case>",
  "libName": "<camelCase>",
  "purpose": "<one-line>",
  "render": {
    "signature": "AIMEAT.<libName>.render(container, props)",
    "props": { "<name>": "<type — description>" },
    "returns": "{ el: HTMLElement, destroy(): void, update(props): void }"
  },
  "dataAccess": ["<data API methods used>"],
  "example": "<usage showing render() with realistic props>"
}

## Rules
1. Props include callbacks for interactions (onSelect, onAdd) — component doesn't navigate.
2. Component receives locale + translations as props.
3. Keep props minimal.`,
    variables: ['disclaimer', 'component_label', 'view_context', 'data_api_spec', 'translation_keys'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-app-domain-spec',
    group: 'generator',
    name: 'App-Domain Spec Generator',
    description: 'Generates app-domain cortex spec — composes components, manages navigation.',
    content: `{{disclaimer}}

# Task: Generate App-Domain Cortex Spec

Design the top-level composition layer — composes components into views, manages auth, translations, business logic.

## Available Components
{{component_specs}}

## Available Data API
\`\`\`json
{{data_api_spec}}
\`\`\`

## Use Cases
{{use_cases}}

## Views
{{views}}

## Translation Keys
{{translation_keys}}

## Output Format
Return ONLY valid JSON:
{
  "name": "<kebab-case>",
  "libName": "<camelCase>",
  "methods": {
    "init": "async () → { session, translations, settings }",
    "render": "(container) → void",
    "t": "(key) → string",
    "switchLocale": "(locale) → void"
  },
  "views": ["<view>"],
  "navigation": "<sidebar | tabs>",
  "viewComposition": { "<view>": ["<components>"] },
  "scriptDependencies": ["<ordered script URLs>"],
  "example": "await AIMEAT.<libName>.init(); AIMEAT.<libName>.render(el);"
}`,
    variables: ['disclaimer', 'component_specs', 'data_api_spec', 'use_cases', 'views', 'translation_keys'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // Code generation — extension code template uses {{context}}, {{label}}, {{spec_section}}
  // ═══════════════════════════════════════════════════════════════════

  {
    id: 'gen-extension-code',
    group: 'generator',
    name: 'Extension Code Generator',
    description: 'Full extension code template — YAML manifest + JS action files.',
    content: `{{disclaimer}}

{{context}}

Create an AIMEAT Extension for: {{label}}

{{spec_section}}

{{sandbox_constraints}}

{{namespace_rules}}

## ctx.memory API — CRITICAL details

### ctx.memory.get(key) — WILL CRASH if you use JSON.parse()

ctx.memory.get() returns the VALUE directly (already a JS object/array/value), or null.
It is NOT a string. Calling JSON.parse() on it will CRASH with "null is not valid JSON".

╔══════════════════════════════════════════════════════════════════════════╗
║  NEVER WRITE: JSON.parse(await ctx.memory.get(...))                    ║
║  NEVER WRITE: JSON.parse(ctx.memory.get(...))                          ║
║  NEVER WRITE: const x = JSON.parse(someMemoryValue)                   ║
║  These ALL crash. The value is ALREADY PARSED.                          ║
╚══════════════════════════════════════════════════════════════════════════╝

CORRECT:
  const data = await ctx.memory.get("my.key");
  if (!data) return { error: "No data found" };

### ctx.memory.search(prefix) returns objects, NOT strings
  const results = await ctx.memory.search("prefix.");
  for (const entry of results) {
    const key = entry.key;    // string
    const value = entry.value; // already parsed
  }

## Output format — SINGLE block

Return YAML manifest + all JS files in ONE block, separated by // actions/filename.js comments.

## Rules
- metadata: name, version, description, author required
- actions array MUST NOT be empty
- Each action script: export default async function(ctx, input) { ... }
- NEVER call JSON.parse on ctx.memory.get results
- Always null-check memory values
- Each action is INDEPENDENT — no cross-file references

{{html_entity_rules}}

{{completed_context}}`,
    variables: ['disclaimer', 'context', 'label', 'spec_section', 'sandbox_constraints', 'namespace_rules', 'html_entity_rules', 'completed_context'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-fix',
    group: 'generator',
    name: 'Fix Prompt',
    description: 'Fix validation/test failures — includes original prompt, code, and errors.',
    content: `{{disclaimer}}

The following code was generated but has errors. Fix them.

## Original prompt (what was requested):
{{original_prompt}}

## Generated code (has errors):
{{code}}

## Errors to fix:
{{errors}}

## Rules
- Fix ONLY the listed errors
- Do NOT change working parts
- Return the COMPLETE fixed code, not just the changed parts
- Same output format as the original prompt`,
    variables: ['disclaimer', 'original_prompt', 'code', 'errors', 'component_type'],
    usedIn: ['generator-autopilot'],
  },

  {
    id: 'gen-test-extension-spec',
    group: 'generator',
    name: 'Extension Test (from Spec)',
    description: 'Test code from extension spec — asserts exact field names from spec examples.',
    content: `{{disclaimer}}

# Task: Generate Extension Test From Spec

Test that the extension matches its SPEC CONTRACT. If the test fails, the CODE is wrong — not the spec.

## Extension: {{extension_name}}

## Actions to Test
{{spec_actions}}

## Memory Keys to Verify
{{memory_keys}}

## Environment: Server-side sandbox
Helpers: callExt(extName, actionId, body), readExtMemory(extName, key)
End with: return { passed: boolean, errors: string[], details: string }

## Rules
- Assert EXACT field names from the spec
- For external APIs: check shape, not specific values
- For memory writes: read back and verify
- Test must be idempotent

Return ONLY executable JavaScript. No markdown fences.`,
    variables: ['disclaimer', 'extension_name', 'spec_actions', 'memory_keys'],
    usedIn: ['generator-autopilot'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // Cortex code generation — data, component, app-domain subtypes
  // ═══════════════════════════════════════════════════════════════════

  {
    id: 'gen-cortex-data',
    group: 'generator',
    name: 'Data Cortex Generator',
    description: 'Data cortex IIFE — wraps extension into clean data access methods.',
    content: `{{disclaimer}}

Create a Data Cortex library for: {{label}}

## Goal

Build a client-side JavaScript library (IIFE) that provides data access methods.
This is the DATA LAYER — pure data access, no UI rendering.
Other cortex components will use this library to get and modify data.

## Structures (shared data types — use these exact shapes)

{{structures}}

{{extension_spec}}

## AIMEAT Platform Libraries Available

- **AIMEAT.data** — get(key), set(key, value), delete(key), list(opts), search(query), getPublic(gaii, key), getEntry(key), update(key, value, version)
- **AIMEAT.storage** — upload(file), download(key), list(), delete(key)
- **AIMEAT.auth** — login(), getSession(), mountLoginButton(container)

## Data Access Rules (CRITICAL — follow precisely)

Two namespaces, two different methods:

1. **Extension runtime data** (watchlist items, cached API results, change logs — data the EXTENSION wrote via ctx.memory.set):
   → Read with: \`AIMEAT.data.getPublic('ext:EXTENSION_NAME', key)\`
   → This reads from the extension's own namespace. Public, no auth needed.

2. **Owner/user data** (translations, settings, seed data — data stored by memory/translation components):
   → Read with: \`AIMEAT.data.get(key)\`
   → This reads from the CURRENT USER's own namespace. Requires auth session.

NEVER read translations or settings from ext: namespace. They live in the owner namespace.
NEVER read extension runtime data with data.get() — that reads the wrong namespace.

## Output Format

Return TWO separate, properly tagged code blocks.
CRITICAL: Use \\\`\\\`\\\`yaml for the manifest and \\\`\\\`\\\`javascript for the library code.

First block — YAML manifest:
\\\`\\\`\\\`yaml
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: kebab-case-name
  namespace: community
  description: "What this data cortex does"
  author: generator
  tags: [data, domain-tag]
spec:
  version: "1.0.0"
  license: MIT
  components:
    - type: lib
      name: kebab-case-name
      filename: kebab-case-name.js
      exports: [methodName, ...]
      api_surface: |
        AIMEAT.yourLib.methodName(params) — Description and return type
\\\`\\\`\\\`

Second block — JavaScript library:
\\\`\\\`\\\`javascript
(function (AIMEAT) {
  'use strict';
  const LIB_NAME = 'yourLibName'; // camelCase of metadata.name
  // Public data access methods
  async function methodName(params) { ... }
  // Register
  const exports = { methodName, ... };
  if (AIMEAT.register) AIMEAT.register(LIB_NAME, exports);
  AIMEAT[LIB_NAME] = exports;
})(window.AIMEAT || (window.AIMEAT = {}));
\\\`\\\`\\\`

session.fetch returns ALREADY-PARSED JSON — use resp.data, never resp.json().

{{completed_context}}`,
    variables: ['disclaimer', 'label', 'extension_spec', 'structures', 'completed_context'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-cortex-component',
    group: 'generator',
    name: 'Feature Cortex Generator',
    description: 'Feature cortex IIFE — self-contained UI module with render(container).',
    content: `{{disclaimer}}

Create a Feature Cortex component for: {{label}}

## Goal

Build a self-contained feature module (data + UI) as a cortex IIFE.
It must export a \`render(container)\` function that:
1. Creates all DOM elements for this feature
2. Fetches data from the data cortex
3. Renders the data using platform UI components
4. Handles user interactions
5. Uses translation keys for all visible text

Think of it like aimeat-charts: ChartPanel({ target: container, ... }) creates a complete chart.
Your render(container) creates a complete feature view.

{{data_api_spec}}

## Platform UI Cortex Libraries — Working Examples

All components take an options object. They return a DOM element you append to your container.

### Tabs (AIMEAT['aimeat-ui-nav'].Tabs)
\\\`\\\`\\\`javascript
var tabs = AIMEAT['aimeat-ui-nav'].Tabs({
  target: container,
  tabs: [
    { id: 'search', label: 'Haku', icon: '🔍' },
    { id: 'watchlist', label: 'Seuranta', icon: '⭐' }
  ],
  active: 'search',
  onChange: function(tabId) { renderTabContent(tabId); }
});
\\\`\\\`\\\`

### DataTable (AIMEAT['aimeat-ui-viewers'].DataTable)
\\\`\\\`\\\`javascript
var table = AIMEAT['aimeat-ui-viewers'].DataTable({
  columns: [
    { key: 'name', label: 'Nimi', sortable: true },
    { key: 'businessId', label: 'Y-tunnus' }
  ],
  rows: dataRows,
  sortable: true,
  filterable: true,
  pageSize: 20
});
container.appendChild(table);
// NOTE: DataTable does NOT have onRowClick.
\\\`\\\`\\\`

### Timeline (AIMEAT['aimeat-ui-viewers'].Timeline)
\\\`\\\`\\\`javascript
var timeline = AIMEAT['aimeat-ui-viewers'].Timeline({
  events: [{ date: '2026-03-26', title: 'Change', description: 'Details' }]
});
container.appendChild(timeline);
\\\`\\\`\\\`

### Form components (AIMEAT['aimeat-ui-forms'])
\\\`\\\`\\\`javascript
var nameInput = AIMEAT['aimeat-ui-forms'].Input({ label: 'Hakusana', placeholder: 'Hae...', type: 'text' });
container.appendChild(nameInput.el);
// Read: nameInput.getValue(), Set: nameInput.setValue('test')

var langSelect = AIMEAT['aimeat-ui-forms'].Select({
  label: 'Kieli',
  options: [{ value: 'fi', label: 'Suomi' }, { value: 'en', label: 'English' }]
});
container.appendChild(langSelect.el);

var toggle = AIMEAT['aimeat-ui-forms'].Toggle({
  label: 'Ilmoitukset', checked: true,
  onChange: function(checked) { savePref(checked); }
});
container.appendChild(toggle.el);
\\\`\\\`\\\`

### Dialogs (AIMEAT['aimeat-ui-dialogs'])
\\\`\\\`\\\`javascript
AIMEAT['aimeat-ui-dialogs'].toast('Saved!', 'success');
var confirmed = await AIMEAT['aimeat-ui-dialogs'].Confirm({ title: 'Delete?', message: 'Are you sure?', confirmLabel: 'Delete', cancelLabel: 'Cancel' });
var modal = AIMEAT['aimeat-ui-dialogs'].Modal({ title: 'Details', content: detailElement, width: 'lg' });
\\\`\\\`\\\`

## Translation Keys
{{translation_keys}}

## Loading Translations

Translations are stored in the OWNER namespace (by the translation component).
Load with AIMEAT.data.get() — NOT from ext: namespace:
\\\`\\\`\\\`javascript
var translations = await AIMEAT.data.get('SERVICE_NAME.i18n.fi') || {};
\\\`\\\`\\\`

## Translation Helper
\\\`\\\`\\\`javascript
function t(key, translations, vars) {
  if (!key || !translations) return key || '';
  var str = translations[key] != null ? translations[key] : key;
  if (vars && typeof str === 'string') {
    Object.keys(vars).forEach(function(k) { str = str.replace('$\{' + k + '}', vars[k]); });
  }
  return str;
}
\\\`\\\`\\\`

## Nested Object Helper
\\\`\\\`\\\`javascript
function dv(val) {
  if (val == null) return '-';
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (val.value) return val.value;
  if (val.url) return val.url;
  if (val.name) return val.name;
  if (Array.isArray(val)) return val.map(dv).join(', ');
  return JSON.stringify(val);
}
\\\`\\\`\\\`

## Output Format

Return TWO separate, properly tagged code blocks.
CRITICAL: Use \\\`\\\`\\\`yaml for the manifest and \\\`\\\`\\\`javascript for the library code.

First block — YAML manifest:
\\\`\\\`\\\`yaml
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: kebab-case-feature-name
  namespace: community
  description: "Feature description"
  author: generator
  tags: [feature, domain-tag]
spec:
  version: "1.0.0"
  license: MIT
  components:
    - type: lib
      name: kebab-case-feature-name
      filename: kebab-case-feature-name.js
      exports: [render]
      api_surface: |
        AIMEAT.featureLib.render(container) — Renders the feature UI into the given DOM element
\\\`\\\`\\\`

Second block — JavaScript library:
\\\`\\\`\\\`javascript
(function (AIMEAT) {
  'use strict';
  const LIB_NAME = 'featureLib'; // camelCase
  // ... render(container) implementation
  var exports = { render: render };
  if (AIMEAT.register) AIMEAT.register(LIB_NAME, exports);
  AIMEAT[LIB_NAME] = exports;
})(window.AIMEAT || (window.AIMEAT = {}));
\\\`\\\`\\\`

{{completed_context}}`,
    variables: ['disclaimer', 'label', 'data_api_spec', 'translation_keys', 'view_context', 'completed_context'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-cortex-app-domain',
    group: 'generator',
    name: 'App-Domain Cortex Generator',
    description: 'App-domain cortex — composition layer combining all features + auth + translations.',
    content: `{{disclaimer}}

Create an App-Domain Cortex for: {{label}}

## Goal

Build the top-level cortex library that the APP will use. It composes:
1. All feature cortex components (renders them into containers)
2. Auth initialization (AIMEAT.auth)
3. Translation loading and management
4. Settings management
5. Navigation support

The app loads ONLY this cortex. This cortex provides everything the app needs.

## Feature Cortex Components (compose these)
{{component_specs}}

## Data Cortex
{{data_api_spec}}

## Translation Keys Available
{{translation_keys}}

## Methods to Export

- **init()** — Initialize auth, load translations, check data readiness. Returns { ready: boolean, authenticated: boolean }.
- **render(container)** — Render the full application UI into the container. Sets up navigation, renders feature views.
- **getTranslations(locale)** — Load translation strings for a locale. Returns the translation object.
- **t(key, vars)** — Translate a key with optional variable interpolation. Uses loaded translations.
- **switchLocale(locale)** — Change language, reload translations, re-render.

## Auth Pattern
\\\`\\\`\\\`javascript
var session = await AIMEAT.auth.login();
if (!session) {
  container.id = container.id || 'app-auth';
  AIMEAT.auth.mountLoginButton('#' + container.id);
  return { ready: false, authenticated: false };
}
\\\`\\\`\\\`

## Translation Pattern
\\\`\\\`\\\`javascript
async function loadTranslations(locale) {
  try {
    return await AIMEAT.data.get('SERVICE_PREFIX.i18n.' + locale)
        || await AIMEAT.data.get('i18n.' + locale)
        || {};
  } catch (e) { return {}; }
}

function t(key, vars) {
  var str = translations[key] || key;
  if (vars) {
    Object.keys(vars).forEach(function(k) { str = str.replace('$\{' + k + '}', vars[k]); });
  }
  return str;
}
\\\`\\\`\\\`

## Output Format

Return TWO separate, properly tagged code blocks.
CRITICAL: Use \\\`\\\`\\\`yaml for the manifest and \\\`\\\`\\\`javascript for the library code.

First block — YAML manifest:
\\\`\\\`\\\`yaml
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: kebab-case-app-name
  namespace: community
  description: "App-domain cortex description"
  author: generator
  tags: [app, domain-tag]
spec:
  version: "1.0.0"
  license: MIT
  components:
    - type: lib
      name: kebab-case-app-name
      filename: kebab-case-app-name.js
      exports: [init, render, t, switchLocale, getTranslations]
      api_surface: |
        AIMEAT.appLib.init() — Initialize auth, load translations. Returns { ready, authenticated }
        AIMEAT.appLib.render(container) — Render the full application into DOM container
        AIMEAT.appLib.t(key, vars) — Translate with interpolation
        AIMEAT.appLib.switchLocale(locale) — Change language and re-render
        AIMEAT.appLib.getTranslations(locale) — Load translations for locale
\\\`\\\`\\\`

Second block — JavaScript library:
\\\`\\\`\\\`javascript
(function (AIMEAT) {
  'use strict';
  const LIB_NAME = 'appLib'; // camelCase
  var exports = { init, render, t, switchLocale, getTranslations };
  if (AIMEAT.register) AIMEAT.register(LIB_NAME, exports);
  AIMEAT[LIB_NAME] = exports;
})(window.AIMEAT || (window.AIMEAT = {}));
\\\`\\\`\\\`

{{completed_context}}`,
    variables: ['disclaimer', 'label', 'component_specs', 'data_api_spec', 'use_cases', 'translation_keys', 'completed_context'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-app',
    group: 'generator',
    name: 'App HTML Generator',
    description: 'Complete HTML app — loads cortex libraries, handles auth, renders UI.',
    content: `{{context}}

Create an AIMEAT App (HTML/JS) for: {{label}}

Style: {{style}}

{{app_domain_spec}}

## CRITICAL: Authentication & API Calls

The app runs on the SAME ORIGIN as the AIMEAT node. Use relative API paths (e.g., "/v1/ext/..."), NOT absolute URLs.

### Library setup (copy this exactly — load BOTH libraries):
\\\`\\\`\\\`javascript
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
    // Platform UI libraries (pre-installed on every AIMEAT node)
    await loadScript('/v1/cortex/aimeat-ui-nav/libs/aimeat-ui-nav.js');
    await loadScript('/v1/cortex/aimeat-ui-layout/libs/aimeat-ui-layout.js');
    await loadScript('/v1/cortex/aimeat-ui-viewers/libs/aimeat-ui-viewers.js');
    await loadScript('/v1/cortex/aimeat-ui-forms/libs/aimeat-ui-forms.js');
    await loadScript('/v1/cortex/aimeat-ui-dialogs/libs/aimeat-ui-dialogs.js');
    // Load domain cortex libraries here (added by resolver)
{{cortex_script_loads}}
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
\\\`\\\`\\\`

{{translation_keys_section}}

{{cortex_instructions}}

### AIMEAT.data API (memory read/write — handles auth and envelope automatically):
\\\`\\\`\\\`javascript
// Read YOUR OWN memory key — returns the stored value directly, or null
const myData = await AIMEAT.data.get('my.settings');

// Write a memory key (your own namespace)
await AIMEAT.data.set('my.key', { count: 42 });

// Delete your own memory key
await AIMEAT.data.delete('my.key');
\\\`\\\`\\\`

### Reading EXTENSION-produced data (CRITICAL — most apps need this):
Extensions store data in their OWN namespace (\`ext:{extension-name}\`).
To read data that an extension wrote, use \`getPublic()\`:
\\\`\\\`\\\`javascript
// WRONG — this reads YOUR memory, not the extension's:
const data = await AIMEAT.data.get('items.by-date.__index');  // returns null!

// CORRECT — read from the extension's namespace:
const data = await AIMEAT.data.getPublic('ext:my-collector-extension', 'items.by-date.__index');
\\\`\\\`\\\`
The first argument is the extension's memory owner: \`"ext:" + extensionName\` (the \`name\` field from the extension manifest metadata).
Use this for ALL data produced by extensions (collected data, computed stats, caches, etc.).
\`getPublic()\` returns the value directly (auto-unwraps), or null if not found.

### Reading TRANSLATIONS (stored in owner namespace by translation components):
Translations are stored in the OWNER's namespace by the translation component during registration.
The key format is: \`{service-name}.i18n.{locale}\` (e.g. \`my-service.i18n.fi\`).
\\\`\\\`\\\`javascript
// Read translations from OWNER namespace (the translation component stored them here):
const fiStrings = await AIMEAT.data.get('my-service.i18n.fi') || await AIMEAT.data.get('i18n.fi') || {};
const enStrings = await AIMEAT.data.get('my-service.i18n.en') || await AIMEAT.data.get('i18n.en') || {};
\\\`\\\`\\\`
Use AIMEAT.data.get() — this reads from the current user's namespace where translations live.
If a cortex library has a getI18n(locale) method, use that instead (recommended).

### Calling extension actions (use AIMEAT.auth session for authenticated fetch):

\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
\u2551  CRITICAL: session.fetch() returns ALREADY-PARSED JSON, not Response.  \u2551
\u2551  Do NOT call resp.json() \u2014 it will crash with "not a function".        \u2551
\u2551  Access resp.ok, resp.data, resp.error directly.                       \u2551
\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D

\\\`\\\`\\\`javascript
// Helper for extension calls (copy this EXACTLY):
// ALL extension actions are POST — the backend only has router.post() routes
async function extCall(extName, actionId, body = {}) {
  const session = await AIMEAT.auth.login();
  if (!session) throw new Error('Not logged in');
  const url = '/v1/ext/' + extName + '/' + actionId;
  const resp = await session.fetch(url, { method: 'POST', body: JSON.stringify(body) });
  // resp is ALREADY parsed JSON — never call resp.json()
  if (!resp.ok) throw new Error(resp.error?.message || 'Extension call failed');
  return resp.data;  // unwrapped payload
}

// Usage:
const results = await extCall('my-extension', 'search', { query: 'test' });
const detail = await extCall('my-extension', 'getDetail', { id: 'abc-123' });
\\\`\\\`\\\`

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
\\\`\\\`\\\`css
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
\\\`\\\`\\\`

NEVER use hardcoded hex colors in component styles. Always use var(--color-*).
Customize the palette based on the project's domain and the style preferences from the spec.

## Auth UI Layout

The #auth-container renders a login button and session bar at the top of the page.
Reserve space for it in your layout — do not overlap or hide it:
\\\`\\\`\\\`html
<body>
  <div id="auth-container"></div>  <!-- AIMEAT login/session UI — always at top -->
  <header><!-- your app header --></header>
  <main id="app"><!-- your content --></main>
</body>
\\\`\\\`\\\`

## Rules
- DO NOT add manual configuration fields for API URL, Bearer Token, or Instance ID
- DO NOT use prompt() or manual token entry — the auth library handles everything
- ALL API paths MUST be relative (start with /) — never use absolute URLs or NODE_URL
- Use \`await AIMEAT.auth.login()\` to restore session from storage; if null, show a "Sign in" message. getSession() alone returns null until login() is called.
- Use vanilla JS (no build step needed)
- All dates displayed to users should be formatted from ISO 8601 strings (never store display-formatted dates)
- Has a clean, responsive UI with good mobile support
- Use CSS custom properties for theming where possible
- Call cortex init() on app start if cortex libraries are loaded — it handles everything automatically
- Focus on UX/UI — the cortex handles data access and initialization

## CRITICAL: Rendering API Data — Handle Nested Objects

API responses often contain nested objects instead of plain strings. For example:
- \`businessId: { value: "3323553-5", registrationDate: "2022-11-07" }\` — access \`.value\`
- \`euId: { value: "FIFPRO.3323553-5", source: "1" }\` — access \`.value\`
- \`website: { url: "www.example.com", registrationDate: "..." }\` — access \`.url\`
- \`names: [{ name: "Company Oy", type: "1" }]\` — access \`[0].name\`

\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
\u2551  NEVER render an object directly as text \u2014 it will show [object Object] \u2551
\u2551  ALWAYS check: if (typeof val === 'object' && val !== null)             \u2551
\u2551  Then access the appropriate sub-field (.value, .url, .name, etc.)      \u2551
\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D

Helper pattern:
\\\`\\\`\\\`javascript
function displayValue(val) {
  if (val == null) return '-';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (val.value) return val.value;  // { value: "..." } pattern
  if (val.url) return val.url;      // { url: "..." } pattern
  if (val.name) return val.name;    // { name: "..." } pattern
  if (Array.isArray(val)) return val.map(displayValue).join(', ');
  return JSON.stringify(val);        // last resort — never [object Object]
}
\\\`\\\`\\\`

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

{{html_entity_rules}}

Return a complete HTML file with an app manifest comment at the top:

\\\`\\\`\\\`html
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
\\\`\\\`\\\``,
    variables: ['context', 'label', 'app_domain_spec', 'style', 'translation_keys_section', 'cortex_script_loads', 'cortex_instructions', 'html_entity_rules'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-test-cortex-spec',
    group: 'generator',
    name: 'Data Cortex Test (from Spec)',
    description: 'Test code from data API spec — tests each method via AIMEAT global.',
    content: `{{disclaimer}}

# Task: Generate Data Cortex Test From Spec

Test that cortex methods match their spec contracts.

## Cortex: AIMEAT.{{lib_name}}
Wraps: {{wraps_extension}}

## Methods to Test
{{spec_methods}}

## Environment: Browser (page.evaluate sandbox)
Access: window.AIMEAT.{{lib_name}}
Auth IS available.
Set results: window.__testResults = { passed, errors, details }

## Rules
- Assert EXACT field names from spec
- Methods return null on failure (not throw)
- For arrays: assert Array.isArray and length > 0

Return ONLY executable JavaScript. No markdown fences.`,
    variables: ['disclaimer', 'lib_name', 'wraps_extension', 'spec_methods'],
    usedIn: ['generator-autopilot'],
  },

];
