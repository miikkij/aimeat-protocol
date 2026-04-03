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
    ║  to access it. ctx.caller.gaii is the caller's GHII identity               ║
║  (e.g. "testuser@node-id").                                                ║
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
  Resource IDs: URL-safe strings (kebab-case or hex hashes). No spaces, no special characters.
  Action IDs: camelCase — "getItems", "addToWatchlist", "checkChanges". NEVER kebab-case for actions.
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
║  Writing ctx.getData() or ctx.otherAction() will CRASH with:           ║
║    "ctx.getData is not a function"                                     ║
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
    A single graceful error is OK (API may be rate-limited), but if ALL external API actions return errors, FAIL — the extension is broken.`,
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

## Actions From Blueprint (MUST use these EXACT action IDs)

╔══════════════════════════════════════════════════════════════════════════╗
║  Your spec MUST include ALL actions listed below with the EXACT IDs.   ║
║  Do NOT rename them. Do NOT drop any. Do NOT merge them.               ║
║  The blueprint is the contract — every action must appear in your spec. ║
╚══════════════════════════════════════════════════════════════════════════╝

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
      "id": "<actionId>",
      "description": "<what this action does>",
      "method": "POST",
      "path": "/v1/ext/<name>/<actionId>",
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
    { "id": "<id>", "action": "<actionId>", "cron": "<expression>", "description": "<what>" }
  ],
  "config": { "<key>": "<type — description>" },
  "dataSources": [
    { "name": "<name>", "baseUrl": "<EXACT base URL from the data source above>", "notes": "<any important API details>" }
  ],
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
3. Extension name describes the PLATFORM CAPABILITY: e.g. "weather-data", not "weather-monitor-extension".
4. Do NOT mention any app, cortex, UI, or project.
5. The "dataSources" section MUST include the EXACT base URLs from the Data Sources section above. The code generator needs these URLs to implement the extension. Copy them character-for-character.
6. Action IDs MUST be camelCase: "getItems", NOT "get-items". This is the coding standard.
7. The "output" field MUST list actual field names and types — NEVER use "$ref". Expand all references into concrete field descriptions. The test generator needs real field names to write assertions.`,
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

## Required Methods (from blueprint — MUST use these EXACT names)

╔══════════════════════════════════════════════════════════════════════════╗
║  Your spec MUST include ALL methods listed below with the EXACT names. ║
║  Do NOT rename them. Do NOT use the extension action names instead.    ║
║  The blueprint is the contract — every method must appear in your spec. ║
╚══════════════════════════════════════════════════════════════════════════╝

{{blueprint_methods}}

Each method wraps one or more extension actions. Map them appropriately.
For example, if the blueprint requires "getItems" and the extension has "fetchAllItems",
create a method named "getItems" that internally calls the extension's "fetchAllItems".

## Rules
1. Method names MUST match the blueprint list above EXACTLY. Do NOT use extension action names as method names.
2. Return types MUST match extension spec output exactly.
3. Include getTranslations and getSettings — read from owner namespace.
4. All methods return null on failure. No exceptions.
5. params field MUST be an object type (e.g. "{ query: string, type: string }"), NEVER positional parameters.
6. name and libName MUST be ASCII only (a-z, 0-9, hyphens for name, camelCase for libName). Transliterate non-ASCII: ä→a, ö→o, å→a, ü→u.`,
    variables: ['disclaimer', 'extension_spec', 'structures', 'blueprint_methods'],
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
3. Keep props minimal.
4. name and libName MUST be ASCII only (a-z, 0-9, hyphens for name, camelCase for libName). Transliterate non-ASCII: ä→a, ö→o, å→a, ü→u.`,
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
}

## Rules
1. name and libName MUST be ASCII only (a-z, 0-9, hyphens for name, camelCase for libName). Transliterate non-ASCII: ä→a, ö→o, å→a, ü→u.`,
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
    content: `{{context}}

Create an AIMEAT Extension for: {{label}}

## YAML STRING RULES (read this FIRST — violations cause parse errors)

Every string value MUST be on ONE line wrapped in double quotes. No exceptions.
NEVER use > or | (block scalars). NEVER leave strings unquoted.

WRONG: description: > This is a folded string
WRONG: description: This has (parens) and colons: here
CORRECT: description: "This has (parens) and colons: here — all on one line"

{{sandbox_constraints}}

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

WRONG (CRASHES EVERY TIME):
  const data = JSON.parse(await ctx.memory.get("my.key"));  // "undefined" is not valid JSON

CORRECT:
  const data = await ctx.memory.get("my.key");
  if (!data) return { error: "No data found" };
  // data is already a JS object/array/value — use it directly

### ctx.memory.get() returns null when key does not exist — ALWAYS null-check!

╔══════════════════════════════════════════════════════════════════════════╗
║  ALWAYS check the return value before using it.                         ║
║  Arrays and objects from memory may be null on first run.              ║
╚══════════════════════════════════════════════════════════════════════════╝

WRONG (CRASHES on first run when no data exists yet):
  const index = await ctx.memory.get("items.__index");
  index.some(...)     // Cannot read properties of null (reading 'some')
  index.push(...)     // Cannot read properties of null (reading 'push')
  index.length        // Cannot read properties of null (reading 'length')

CORRECT:
  const index = await ctx.memory.get("items.__index") || [];
  index.some(...)     // works — falls back to empty array

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

\\\`\\\`\\\`
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
  - id: firstAction
    description: "What this action does"
    method: POST
    path: /v1/ext/{name}/firstAction
    auth: required
    input: {}
    output: {}
    script: firstAction.js
  - id: secondAction
    description: "Another action"
    method: POST
    path: /v1/ext/{name}/secondAction
    auth: required
    input:
      type: object
      properties:
        name:
          type: string
      required: [name]
    output:
      type: object
    script: secondAction.js
schedules: []

YAML actions format — EVERY action MUST have "- id:" as the FIRST key:
  CORRECT: - id: myAction        (id: is explicit key)
  WRONG:   - myAction            (bare value — causes YAML parse error)
  WRONG:   - myAction:           (colon after name — causes YAML parse error)
NEVER omit "id:" from any action entry. This is the #1 cause of validation failures.
// actions/myAction.js
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

  // ── IMPORTANT: API call patterns ──
  // Use the EXACT base URL from the spec's dataSources section.
  // Most open data APIs use QUERY PARAMETERS for all lookups:
  //   CORRECT: baseUrl + '?id=' + encodeURIComponent(id)
  //   WRONG:   baseUrl + '/' + id   ← path params often return 400/404
  // Check the data source notes for the supported parameter names.
  // If the data source URL ends with a collection name (e.g. /companies),
  // it is a SEARCH endpoint — use query params, NOT path params.

  // ── Reading from EXTENSION'S OWN MEMORY (ctx.memory.get) ──
  // ctx.memory.get() returns a JS value directly — NEVER use JSON.parse
  const stored = await ctx.memory.get("my.key");
  if (!stored) return { items: [] };  // ← stored is already an object, or null

  // ── Reading OWNER'S SHARED DATA (memory components, settings, translations) ──
  // Data stored by memory-1, memory-2 etc. lives in the OWNER's namespace, NOT the extension's.
  // Use getPublic(ctx.caller.gaii, key) to read it:
  const lookup = await ctx.memory.getPublic(ctx.caller.gaii, "lookup.data") || [];
  const settings = await ctx.memory.getPublic(ctx.caller.gaii, "settings.config") || {};

  // ── Writing to EXTENSION'S OWN MEMORY ──
  await ctx.memory.set("results.today", { items: data.results, fetchedAt: new Date().toISOString() });

  return { result: stored };
}
\\\`\\\`\\\`

CRITICAL: Do NOT use separate code blocks. Put YAML manifest and ALL JavaScript files in ONE block.
Each JavaScript file MUST start with a comment line: // actions/{filename}.js

## Action path — instance vs non-instance

╔══════════════════════════════════════════════════════════════════════════╗
║  Most extensions are SINGLE-INSTANCE (no :instanceId in path).          ║
║  Use: /v1/ext/{name}/actionId                                            ║
║  NEVER add :instanceId unless the blueprint explicitly requires          ║
║  multi-instance support (e.g., per-store, per-tenant separation).       ║
╚══════════════════════════════════════════════════════════════════════════╝

- Default (single-instance): \\\`path: /v1/ext/{name}/actionId\\\`
- Multi-instance (only if needed): \\\`path: /v1/ext/{name}/:instanceId/actionId\\\`

## Scheduled Jobs (schedules section)

Extensions can declare recurring background jobs via \\\`schedules\\\` in the manifest.
AIMEAT's built-in scheduler runs these automatically — no browser needed.

╔══════════════════════════════════════════════════════════════════════════╗
║  If the blueprint has "schedules" for this extension, you MUST include  ║
║  a schedules section in the YAML manifest. This is the ONLY way to     ║
║  register recurring jobs — cortex and apps CANNOT schedule work.       ║
╚══════════════════════════════════════════════════════════════════════════╝

Format:
\\\`\\\`\\\`yaml
schedules:
  - id: unique-job-id
    action: actionId
    cron: "*/15 * * * *"
    description: "What this scheduled job does"
    instance_scope: false
    input: {}
\\\`\\\`\\\`

Rules:
- \\\`action\\\` MUST reference an existing action id from the \\\`actions\\\` array
- \\\`cron\\\` uses standard 5-field cron syntax (minute hour day-of-month month day-of-week) OR the special value \\\`@activate\\\`
- \\\`@activate\\\` trigger: runs when the extension is activated AND on every server restart. Use for init/bootstrap jobs.
- \\\`instance_scope: false\\\` for single-instance extensions (most cases)
- \\\`input\\\` is optional static input passed to the action on each run
- Common patterns: \\\`@activate\\\` (init/bootstrap), \\\`*/15 * * * *\\\` (every 15 min), \\\`0 2 * * *\\\` (daily at 02:00), \\\`0 */6 * * *\\\` (every 6 hours)
- If a nightly job depends on data from a periodic job (e.g., aggregation needs fresh data), schedule it AFTER the last periodic run (e.g., collection at */15, aggregation at 02:00)
- If the blueprint has no "schedules" for this extension, set \\\`schedules: []\\\`

### @activate Init Pattern

If the extension collects or computes data, add an \\\`@activate\\\` scheduled job that:
1. Checks if data exists and is fresh (not stale)
2. If missing or stale, runs the init/collection logic
3. If data is already fresh, does nothing (returns early)

This solves the cold-start problem: after first activation or a server restart, the extension's data is immediately populated instead of waiting for the next cron tick.

Example @activate action script pattern:
\\\`\\\`\\\`javascript
// Check if data already exists and is recent
const lastRun = await ctx.memory.get('last-ingest-timestamp');
if (lastRun) {
  const age = Date.now() - new Date(lastRun).getTime();
  if (age < 15 * 60 * 1000) return; // Data is fresh (< 15 min), skip
}
// Data is missing or stale — run the init/collection logic
// ... fetch data, store in memory ...
await ctx.memory.set('last-ingest-timestamp', new Date().toISOString());
\\\`\\\`\\\`

Schedule entry:
\\\`\\\`\\\`yaml
  - id: init-data
    action: init
    cron: "@activate"
    description: "Initialize/refresh data on activation and server restart"
    instance_scope: false
    input: {}
\\\`\\\`\\\`

IMPORTANT: @activate actions MUST be idempotent — they will run multiple times (every restart). Always check existing data before overwriting.

### Init Action — Initialize Runtime Data Only

The init/@activate action should initialize extension-owned runtime data (watchlists, caches, logs).
Do NOT copy translations or settings to the extension namespace — cortex reads those
directly from the owner namespace via AIMEAT.data.get().

Pattern:
\\\`\\\`\\\`javascript
// Initialize extension runtime data if not already present
const watchlist = await ctx.memory.get('watchlist.items');
if (!watchlist) {
  await ctx.memory.set('watchlist.items', []);
  ctx.log.info('Initialized empty watchlist');
}
\\\`\\\`\\\`

Only initialize keys that the EXTENSION owns and writes to (runtime data).
Translations and settings live in the OWNER namespace — the cortex reads them directly.

## Additional rules
- \\\`metadata\\\` section MUST have: name, version, description, author
- \\\`actions\\\` array MUST NOT be empty — each action needs: id, method, path, script
- Each action's \\\`script\\\` field value must match a \\\`// actions/{script}\\\` comment below the YAML
- \\\`limits.timeout_ms\\\`: use 30000 for extensions that call external APIs, 5000 for memory-only
- \\\`limits.max_api_calls\\\`: use 500 for data collectors (many memory writes per run), 100 for simple actions
- Action IDs MUST be camelCase: \\\`getItems\\\`, NOT \\\`get-items\\\`. The ID appears in URLs and YAML — camelCase is the standard.
- All helper functions must be defined INSIDE the same script file — no imports, no cross-file references
- If two actions need the same helper (e.g., date parsing, data normalization), DUPLICATE the helper in BOTH script files — copy it exactly, do NOT refactor into a shared module
- NEVER reference functions from another action's script — each script runs in its own ISOLATED V8 sandbox scope
- When duplicating helpers across actions, keep them IDENTICAL — if you fix a bug in one copy, fix it in all copies
- NEVER call JSON.parse() on ctx.memory.get() results — they are already parsed JS values
- Always check for undefined/null before using memory values — on first run, NOTHING exists yet
- Always convert dates to ISO 8601 before storing in memory
- OWNER DATA: seed data (memory components), settings, and translations are in the OWNER's namespace.
  Use \\\`ctx.memory.getPublic(ctx.caller.gaii, key)\\\` to read them — NOT \\\`ctx.memory.get(key)\\\`.
  \\\`ctx.memory.get()\\\` only reads from the extension's own \\\`ext:{name}\\\` namespace.
  Common pattern: \\\`const data = await ctx.memory.getPublic(ctx.caller.gaii, "lookup.data") || [];\\\`

{{html_entity_rules}}

## NOW: Implement this spec

{{spec_section}}

{{completed_context}}`,
    variables: ['context', 'label', 'spec_section', 'sandbox_constraints', 'html_entity_rules', 'completed_context'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // Reflection + Fresh generation — verbatim from generator-prompts-fix.js
  // ═══════════════════════════════════════════════════════════════════

  {
    id: 'gen-reflection',
    group: 'generator',
    name: 'Reflection Diagnosis',
    description: 'Diagnose failure without writing code — root cause analysis for fix prompts.',
    content: `You are debugging a failed component. Your job is to DIAGNOSE the problem — do NOT write code.

## Failed Code
{{failed_code}}

## Spec Contract (the code was supposed to implement this)
{{spec_contract}}

## Errors
{{errors}}
{{test_context}}

## Your Task

Analyze the errors and the ACTUAL API RESPONSES above. In 2-5 sentences, explain:
1. What is the ROOT CAUSE of each error?
2. What specific data shapes or field names does the code assume vs what the API actually returns?
3. What specific lines or patterns in the code need to change?

Be precise — reference exact field names from the API responses. Do NOT write code.`,
    variables: ['failed_code', 'errors', 'test_context'],
    usedIn: ['generator-autopilot'],
  },

  {
    id: 'gen-fresh-generation',
    group: 'generator',
    name: 'Fresh Generation (Final Round)',
    description: 'Regenerate from scratch with pitfalls from all previous rounds — no broken code shown.',
    content: `{{original_prompt}}
{{pitfalls}}{{test_trace}}
IMPORTANT: This is a fresh generation. Do NOT reference any previous code.
Study the ACTUAL API RESPONSES above carefully and match those exact data shapes.`,
    variables: ['original_prompt', 'pitfalls', 'test_trace'],
    usedIn: ['generator-autopilot'],
  },

  {
    id: 'gen-fix',
    group: 'generator',
    name: 'Fix Prompt',
    description: 'Fix validation/test failures — type-specific constraints, previous attempts, test context.',
    content: `{{disclaimer}}The following result had validation errors. Fix ONLY the errors listed below.

{{html_entity_rules}}
{{type_constraints}}
ORIGINAL PROMPT:
{{original_prompt}}

FAILED RESULT:
{{code}}

ERRORS:
{{errors}}
{{test_context}}{{previous_attempts}}{{reflection_diagnosis}}
Return the corrected result in the same format as the original.`,
    variables: ['disclaimer', 'original_prompt', 'code', 'errors', 'component_type', 'type_constraints', 'html_entity_rules', 'test_context', 'previous_attempts', 'reflection_diagnosis'],
    usedIn: ['generator-autopilot'],
  },

  {
    id: 'gen-test-extension-spec',
    group: 'generator',
    name: 'Extension Test (from Spec)',
    description: 'Test code from extension spec — asserts exact field names from spec examples.',
    content: `{{disclaimer}}You are generating TEST CODE for a component in an AIMEAT service.

## Component Under Test
- Type: extension
- Label: {{extension_name}}
- Registered as: {{extension_name}}
{{golden_samples}}{{extension_spec}}
{{test_scenarios}}
## Data Structures (from blueprint — test against THESE shapes)
{{structures}}

## Action Contracts (from blueprint — test THESE methods with THESE shapes)
{{action_contracts}}

{{project_context}}

## Test Environment: Server-side sandbox (new Function)

CRITICAL SANDBOX RULES — violating ANY will crash the test:
- NO import/require/export statements
- You are inside an async function body. Just write sequential code.
- Available variables: testFetch, baseUrl, callExt, readExtMemory
- No Node.js APIs, no fs, no path, no process

Available helpers:

  // LOW-LEVEL: raw HTTP call (use only for memory/translation tests, NOT for extensions)
  const resp = await testFetch(url, { method, body, headers });
  // resp = { status, ok, body }. Auth token injected automatically.

  // HIGH-LEVEL: call extension action (PREFERRED for extension tests)
  const result = await callExt('ext-name', 'actionId', { key: 'value' });
  // Returns action's return value directly (envelope unwrapped)

  // HIGH-LEVEL: read extension memory
  const data = await readExtMemory('ext-name', 'memory.key');
  // Returns value from ext:{name} namespace, or null

Your code MUST end with: return { passed: boolean, errors: string[], details: string }

## Test Idempotency
Tests MUST work on every run — first run or re-run after previous failure.
Before the first scenario, clean stale data using the extension's OWN actions:
  1. Read lists with readExtMemory
  2. Call remove/delete actions for each existing item
  3. Call init

## JavaScript Pitfalls
- NEVER compare arrays/objects with === or !== (\\\`value !== []\\\` is ALWAYS true). Use \\\`Array.isArray(v) && v.length === 0\\\`.
- Check null with \\\`=== null\\\`, not \\\`== null\\\`.

## Example (server-side extension test)
\\\`\\\`\\\`
const errors = [];

// CLEANUP: remove stale data via extension actions
const existing = await readExtMemory('{{extension_name}}', 'items.list');
if (existing && Array.isArray(existing)) {
  for (const item of existing) {
    await callExt('{{extension_name}}', 'removeItem', { id: item.id });
  }
}

// [MEMORY] init
const r0 = await callExt('{{extension_name}}', 'init', {});
if (!r0) errors.push('init: no response');
else if (r0.error) errors.push('init: ' + r0.error);

// [EXTERNAL API] — check shape only
const r1 = await callExt('{{extension_name}}', 'fetchData', { query: 'test' });
if (r1 === null) errors.push('fetchData: no response at all');

// [MEMORY] error handling
const r2 = await callExt('{{extension_name}}', 'addItem', {});
if (r2 === null) errors.push('addItem(empty): no response');
else if (!r2.error) errors.push('addItem(empty): no error for invalid input');

return { passed: errors.length === 0, errors, details: 'Tested N actions' };
\\\`\\\`\\\`

## Platform Rules
{{sandbox_constraints}}

{{extension_consumption_rules}}

## Output Rules
1. Return ONLY executable JavaScript code — NO markdown fences, NO explanation text
2. NO import/require/export — sandbox environment
3. Your code runs INSIDE an existing async function. Write sequential statements starting with variable declarations. The runtime already provides the async wrapper.
4. End with: return { passed, errors, details }`,
    variables: ['disclaimer', 'extension_name', 'golden_samples', 'test_scenarios', 'structures', 'action_contracts', 'project_context', 'sandbox_constraints', 'extension_consumption_rules'],
    usedIn: ['generator-autopilot'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // Cortex code generation — data, component, app-domain subtypes
  // Verbatim copies from public/js/services/generator-prompts-cortex-*.js
  // and generator-prompts-base.js app template. ${var} → {{var}}.
  // ═══════════════════════════════════════════════════════════════════

  {
    id: 'gen-cortex-data',
    group: 'generator',
    name: 'Data Cortex Generator',
    description: 'Data cortex IIFE — wraps extension into clean data access methods.',
    content: `{{disclaimer}}
Create a Data Cortex library for: {{label}}

Project: {{project_description}}

{{spec_section}}

## Goal

Build a client-side JavaScript library (IIFE) that provides data access methods.
This is the DATA LAYER — pure data access, no UI rendering.
Other cortex components will use this library to get and modify data.

## Structures (shared data types — use these exact shapes)

{{structures}}

## Methods to Export

{{methods_to_export}}

{{extension_section}}

## AIMEAT Platform Libraries Available

- **AIMEAT.data** — get(key), set(key, value), delete(key), list(opts), search(query), getPublic(gaii, key), getEntry(key), update(key, value, version)
- **AIMEAT.storage** — upload(file), download(key), list(), delete(key)
- **AIMEAT.social** — createBoard(name), post(boardId, content), boards(), posts(boardId)
- **AIMEAT.wallet** — balance(), transactions()
- **AIMEAT.auth** — login(), getSession(), mountLoginButton(container)

## Data Access Rules (CRITICAL — follow precisely)

Two namespaces, two different methods:

1. **Extension runtime data** (watchlist items, cached API results, change logs — data the EXTENSION wrote via ctx.memory.set):
   → Read with: \\\`AIMEAT.data.getPublic('ext:EXTENSION_NAME', key)\\\`
   → This reads from the extension's own namespace. Public, no auth needed.

2. **Owner/user data** (translations, settings, seed data — data stored by memory/translation components):
   → Read with: \\\`AIMEAT.data.get(key)\\\`
   → This reads from the CURRENT USER's own namespace. Requires auth session.

NEVER read translations or settings from ext: namespace. They live in the owner namespace.
NEVER read extension runtime data with data.get() — that reads the wrong namespace.

## Output Format

Return TWO separate, properly tagged code blocks.
The installer expects them separately — YAML defines the manifest, JS is the library file.

CRITICAL: Use \\\`\\\`\\\`yaml for the manifest and \\\`\\\`\\\`javascript for the library code.
Do NOT combine them into a single block. Do NOT use an untagged block.

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
        AIMEAT.yourLib.methodName(params) — Description
        ...

        To load in an app:
        <script src="{{node_url}}/v1/cortex/kebab-case-name/libs/kebab-case-name.js"></script>

    - type: lib
      name: kebab-case-name
      filename: kebab-case-name.js
      exports: [methodName, ...]
      api_surface: |
        AIMEAT.yourLib.methodName(params) — Description and return type
        ...
\\\`\\\`\\\`

Second block — JavaScript library:
\\\`\\\`\\\`javascript
(function (AIMEAT) {
  'use strict';
  const LIB_NAME = 'yourLibName'; // camelCase of metadata.name
  const EXT_NAME = 'extension-name'; // kebab-case extension name from the extension section above

  // ── EXACT callExt implementation — DO NOT MODIFY THIS PATTERN ──
  // Calls an extension action via the AIMEAT API. Returns the action's return value.
  // URL pattern is ALWAYS: /v1/ext/{extensionName}/{actionId}
  // session.fetch returns ALREADY-PARSED JSON — use resp.data directly, NEVER resp.json()
  async function callExt(actionId, body) {
    var resp = await AIMEAT.session.fetch('/v1/ext/' + EXT_NAME + '/' + actionId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    return resp.data;
  }

  // ── EXACT readExtMemory implementation — DO NOT MODIFY THIS PATTERN ──
  // Reads extension runtime data from the ext:{name} namespace.
  async function readExtMemory(key) {
    return await AIMEAT.data.getPublic('ext:' + EXT_NAME, key);
  }

  // ── Public data access methods ──
  // CRITICAL: Every method takes a SINGLE OBJECT parameter and destructures it.
  // This matches the spec contract. The test will call: lib.methodName({ key: value })
  // Example:
  //   async function doSomething(params) {
  //     var id = params.id;
  //     var filter = params.filter || 'all';
  //     return await callExt('doSomething', { id: id, filter: filter });
  //   }
  // NEVER use positional parameters like methodName(a, b) — always methodName(params).
  // Method names in exports MUST match the blueprint "produces: api:XXX" names EXACTLY.
  // Do NOT rename them to match extension action names — use the blueprint names.

  async function methodName(params) { ... }

  // Register
  const exports = { methodName, ... };
  if (AIMEAT.register) AIMEAT.register(LIB_NAME, exports);
  AIMEAT[LIB_NAME] = exports;
})(window.AIMEAT || (window.AIMEAT = {}));
\\\`\\\`\\\``,
    variables: ['disclaimer', 'label', 'project_description', 'spec_section', 'structures', 'methods_to_export', 'extension_section'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-cortex-component',
    group: 'generator',
    name: 'Feature Cortex Generator',
    description: 'Feature cortex IIFE — self-contained UI module with render(container).',
    content: `{{disclaimer}}
Create a Feature Cortex component for: {{label}}

{{spec_section}}

## Use Case
{{use_case}}

## View
{{view_section}}

## Goal

Build a self-contained feature module (data + UI) as a cortex IIFE.
It must export a \\\`render(container)\\\` function that:
1. Creates all DOM elements for this feature
2. Fetches data from the data cortex
3. Renders the data using platform UI components
4. Handles user interactions
5. Uses translation keys for all visible text

Think of it like aimeat-charts: \\\`ChartPanel({ target: container, ... })\\\` creates a complete chart.
Your \\\`render(container)\\\` creates a complete feature view.

## Data Structures
{{structures}}

{{data_cortex_api}}

## Platform UI Cortex Libraries — Working Examples

All components take an options object. They return a DOM element you append to your container.

### Tabs (AIMEAT['aimeat-ui-nav'].Tabs)
\\\`\\\`\\\`javascript
var tabs = AIMEAT['aimeat-ui-nav'].Tabs({
  target: container,  // DOM element or CSS selector string
  tabs: [
    { id: 'search', label: 'Haku', icon: '🔍' },
    { id: 'watchlist', label: 'Seuranta', icon: '⭐' },
    { id: 'settings', label: 'Asetukset', icon: '⚙' }
  ],
  active: 'search',  // which tab is active initially
  onChange: function(tabId) {
    // called when user clicks a tab
    renderTabContent(tabId);
  }
});
\\\`\\\`\\\`

### DataTable (AIMEAT['aimeat-ui-viewers'].DataTable)
\\\`\\\`\\\`javascript
var table = AIMEAT['aimeat-ui-viewers'].DataTable({
  columns: [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'id', label: 'ID' },
    { key: 'status', label: 'Status' }
  ],
  rows: dataRows,  // array of objects matching the column keys
  sortable: true,
  filterable: true,
  pageSize: 20
});
container.appendChild(table);
// NOTE: DataTable does NOT have onRowClick. For clickable rows, build your own
// card list with click handlers, or use the List component with onItemClick.
\\\`\\\`\\\`

### Timeline (AIMEAT['aimeat-ui-viewers'].Timeline)
\\\`\\\`\\\`javascript
var timeline = AIMEAT['aimeat-ui-viewers'].Timeline({
  events: [
    { date: '2026-03-26', title: 'Osoite muuttui', description: 'Vanha: Mannerheimintie 1 → Uusi: Pohjantie 8' },
    { date: '2026-03-20', title: 'Toimiala päivittyi', description: 'Uusi: Ohjelmistojen suunnittelu' }
  ]
});
container.appendChild(timeline);
\\\`\\\`\\\`

### Form components (AIMEAT['aimeat-ui-forms'])
\\\`\\\`\\\`javascript
// Text input — returns { el, getValue(), setValue(v), setError(msg), clearError() }
var nameInput = AIMEAT['aimeat-ui-forms'].Input({
  label: 'Hakusana',
  placeholder: 'Hae nimellä...',
  type: 'text'
});
container.appendChild(nameInput.el);
// Read value: nameInput.getValue()
// Set value: nameInput.setValue('test')
// Listen for changes: nameInput.el.querySelector('input').addEventListener('input', function(e) { doSearch(e.target.value); });

// Select dropdown — returns { el, getValue(), setValue(v) }
var langSelect = AIMEAT['aimeat-ui-forms'].Select({
  label: 'Kieli',
  options: [
    { value: 'fi', label: 'Suomi' },
    { value: 'en', label: 'English' }
  ]
});
container.appendChild(langSelect.el);
// Read value: langSelect.getValue()

// Toggle switch — returns { el, getValue(), setValue(v) }
// Toggle HAS onChange callback
var notifToggle = AIMEAT['aimeat-ui-forms'].Toggle({
  label: 'Ilmoitukset',
  checked: true,
  onChange: function(checked) { saveNotificationPref(checked); }
});
container.appendChild(notifToggle.el);
\\\`\\\`\\\`

### Dialogs (AIMEAT['aimeat-ui-dialogs'])
\\\`\\\`\\\`javascript
// Toast notification
AIMEAT['aimeat-ui-dialogs'].toast('Tallennettu!', 'success');
AIMEAT['aimeat-ui-dialogs'].toast('Virhe tapahtui', 'error');

// Confirm dialog (returns Promise)
var confirmed = await AIMEAT['aimeat-ui-dialogs'].Confirm({
  title: 'Poista kohde?',
  message: 'Haluatko varmasti poistaa tämän?',
  confirmLabel: 'Poista',
  cancelLabel: 'Peruuta'
});
if (confirmed) { deleteItem(id); }

// Modal
var modal = AIMEAT['aimeat-ui-dialogs'].Modal({
  title: 'Yrityksen tiedot',
  content: detailElement,  // DOM element
  width: 'lg'  // 'sm', 'md', 'lg'
});
\\\`\\\`\\\`

{{translation_section}}

## Loading Translations

Translations are stored in the OWNER namespace (by the translation component).
Load them with AIMEAT.data.get() — NOT from ext: namespace:
\\\`\\\`\\\`javascript
// CORRECT — reads from owner namespace where translation component stored them:
var translations = await AIMEAT.data.get('SERVICE_NAME.i18n.fi') || {};

// WRONG — ext: namespace does NOT contain translations:
// var translations = await AIMEAT.data.getPublic('ext:...', 'i18n.fi'); // ← NEVER do this
\\\`\\\`\\\`
Replace SERVICE_NAME with the actual service slug (from the CSM/extension name).

## Translation Helper
Use a t() function for all user-visible text:
\\\`\\\`\\\`javascript
function t(key, translations, vars) {
  if (!key || !translations) return key || '';
  var str = translations[key] != null ? translations[key] : key;
  if (vars && typeof str === 'string') {
    Object.keys(vars).forEach(function(k) {
      str = str.replace('$\\{' + k + '}', vars[k]);
    });
  }
  return str;
}
\\\`\\\`\\\`

## Nested Object Helper
API responses contain nested objects. Use this to safely render values:
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
  labels:
    domain: specific-domain
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
\\\`\\\`\\\``,
    variables: ['disclaimer', 'label', 'spec_section', 'use_case', 'view_section', 'structures', 'data_cortex_api', 'translation_section'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-cortex-app-domain',
    group: 'generator',
    name: 'App-Domain Cortex Generator',
    description: 'App-domain cortex — composition layer combining all features + auth + translations.',
    content: `{{disclaimer}}
Create an App-Domain Cortex for: {{label}}

Project: {{project_description}}

{{spec_section}}

## Goal

Build the top-level cortex library that the APP will use. It composes:
1. All feature cortex components (renders them into containers)
2. Auth initialization (AIMEAT.auth)
3. Translation loading and management
4. Settings management
5. Navigation support

The app loads ONLY this cortex. This cortex provides everything the app needs.

## Feature Cortex Components (compose these)
{{feature_apis}}

## Data Cortex
{{data_cortex_section}}

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
// Restore session from storage (MUST call login() first — getSession() alone returns null)
var session = await AIMEAT.auth.login();
if (!session) {
  // No stored session — show login button
  // mountLoginButton takes a CSS SELECTOR string, not a DOM element
  // Give the container an ID first, then pass the selector
  container.id = container.id || 'app-auth';
  AIMEAT.auth.mountLoginButton('#' + container.id);
  return { ready: false, authenticated: false };
}
\\\`\\\`\\\`

## Translation Pattern
\\\`\\\`\\\`javascript
// Load translations — try service-prefixed key first, then plain key
async function loadTranslations(locale) {
  try {
    // Translations are stored in the OWNER namespace by the translation component
    // Key format: SERVICE_PREFIX.i18n.LOCALE (dots throughout)
    return await AIMEAT.data.get('SERVICE_PREFIX.i18n.' + locale)
        || await AIMEAT.data.get('i18n.' + locale)
        || {};
  } catch (e) { return {}; }
}

// Translate with interpolation
function t(key, vars) {
  var str = translations[key] || key;
  if (vars) {
    Object.keys(vars).forEach(function(k) {
      str = str.replace('$\\{' + k + '}', vars[k]);
    });
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
  labels:
    domain: specific-domain
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
  // ... init/render implementation
  var exports = { init, render, t, switchLocale, getTranslations };
  if (AIMEAT.register) AIMEAT.register(LIB_NAME, exports);
  AIMEAT[LIB_NAME] = exports;
})(window.AIMEAT || (window.AIMEAT = {}));
\\\`\\\`\\\``,
    variables: ['disclaimer', 'label', 'project_description', 'spec_section', 'feature_apis', 'data_cortex_section', 'translation_keys'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-app',
    group: 'generator',
    name: 'App HTML Generator',
    description: 'Complete HTML app — loads cortex libraries, handles auth, renders UI.',
    content: `{{context}}

Create an AIMEAT App (HTML/JS) for: {{label}}

{{project_context}}

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
{{cortex_or_api_section}}

## CDN Libraries & Design Resources

The AIMEAT app catalog allows external CDN scripts. Available libraries:

| Library | Script Tag | Use for |
|---------|-----------|---------|
| Leaflet | \\\`<script src="https://unpkg.com/leaflet@1/dist/leaflet.js"></script>\\\` + CSS link: \\\`<link rel="stylesheet" href="https://unpkg.com/leaflet@1/dist/leaflet.css">\\\` | Maps, markers, geospatial |
| Chart.js | \\\`<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>\\\` | Bar, line, pie, radar charts |
| Motion | \\\`<script src="https://cdn.jsdelivr.net/npm/motion@11/dist/motion.js"></script>\\\` | Animations via \\\`Motion.animate(el, {x: 100}, {duration: 0.5})\\\` |
| Phaser 3 | \\\`<script src="https://cdn.jsdelivr.net/npm/[email protected]/dist/phaser.min.js"></script>\\\` | Games, interactive canvas, physics |

### CSP (Content Security Policy) — the app HTML MUST include a meta tag

AIMEAT enforces CSP headers. If your app loads CDN scripts/styles, you MUST add a \\\`<meta>\\\` tag:
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
you MUST add the tile server domain to \\\`connect-src\\\`. For OpenStreetMap: \\\`https://*.tile.openstreetmap.org\\\`.
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
- Use \\\`await AIMEAT.auth.login()\\\` to restore session from storage; if null, show a "Sign in" message. getSession() alone returns null until login() is called.
- Use vanilla JS (no build step needed)
- All dates displayed to users should be formatted from ISO 8601 strings (never store display-formatted dates)
- Has a clean, responsive UI with good mobile support
- Use CSS custom properties for theming where possible
{{cortex_rules}}

## CRITICAL: Rendering API Data — Handle Nested Objects

API responses often contain nested objects instead of plain strings. For example:
- \\\`id: { value: "123", createdAt: "2026-01-01" }\\\` — access \\\`.value\\\`
- \\\`link: { url: "https://example.com", label: "More" }\\\` — access \\\`.url\\\`
- \\\`items: [{ name: "First", type: "A" }]\\\` — access \\\`[0].name\\\`

╔══════════════════════════════════════════════════════════════════════════╗
║  NEVER render an object directly as text — it will show [object Object] ║
║  ALWAYS check: if (typeof val === 'object' && val !== null)             ║
║  Then access the appropriate sub-field (.value, .url, .name, etc.)      ║
╚══════════════════════════════════════════════════════════════════════════╝

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
    variables: ['context', 'label', 'project_context', 'cortex_script_loads', 'translation_keys_section', 'cortex_or_api_section', 'cortex_rules', 'html_entity_rules'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-test-cortex-spec',
    group: 'generator',
    name: 'Cortex Test (from Spec)',
    description: 'Browser-side cortex test — 6-step quality pattern, golden samples, full example.',
    content: `{{disclaimer}}You are generating TEST CODE for a CORTEX LIBRARY in an AIMEAT service.

## Component Under Test
- Type: cortex
- Label: {{lib_name}}
- Registered as: {{wraps_extension}}

{{cortex_methods}}

## CRITICAL: What to Test and What NOT to Test

╔══════════════════════════════════════════════════════════════════════════╗
║  Test ONLY the cortex library methods listed above.                     ║
║  Access them via: window.AIMEAT.{{lib_name}}.methodName(params)         ║
║                                                                         ║
║  Do NOT call init(), checkChanges(), or any scheduled/bootstrap actions. ║
║  Do NOT use callExt(), readExtMemory(), or testFetch() — these do NOT   ║
║  exist in the browser test page.                                        ║
║  Do NOT call extension actions directly — only call cortex methods.     ║
║                                                                         ║
║  Every method takes a SINGLE OBJECT parameter: lib.search({query: '...'})║
║  NEVER use positional params: lib.search('...') is WRONG.              ║
╚══════════════════════════════════════════════════════════════════════════╝

{{golden_samples}}{{test_scenarios}}
## Data Structures (from blueprint — test against THESE shapes)
{{structures}}

## Cortex Action Contracts (test THESE methods with THESE shapes)
{{action_contracts}}

{{project_context}}

## Test Environment: Browser (page.evaluate sandbox)

CRITICAL SANDBOX RULES — violating ANY will crash the test:
- NO import/require/export statements
- Your code runs inside page.evaluate() in a real browser page
- You have access to: window, document, fetch, DOM APIs
- Set results on: window.__testResults = { passed: boolean, errors: string[], details: string }

For CORTEX tests:
- The cortex library is already loaded on the test page
- Access it via: window.AIMEAT.{{lib_name}}
- Authentication IS available — session.fetch() works

## QUALITY REQUIREMENTS (MANDATORY)

Every test MUST follow this pattern for EVERY API call:

1. **Call** — invoke the method with real, meaningful parameters as an OBJECT: \\\`lib.methodName({key: value})\\\`
2. **Log** — log the FULL response: \\\`log('method returned: ' + JSON.stringify(result))\\\`
3. **Assert not null** — \\\`if (result === null) fail('method: got null')\\\`
4. **Assert shape** — check specific field names and types from the cortex code
5. **Assert values** — for external APIs, verify arrays have length > 0, objects have expected fields
6. **Verify side effects** — after writes, READ BACK and check the data is there

NEVER do this:
\\\`\\\`\\\`
if (result === null) log('returned null (expected without auth)');  // WRONG — auth IS available
\\\`\\\`\\\`

ALWAYS do this:
\\\`\\\`\\\`
if (result === null) fail('method: returned null — should return data');
if (!result.items) fail('method: missing items field');
if (!Array.isArray(result.items)) fail('method: items should be array');
log('method returned: ' + JSON.stringify(result));
\\\`\\\`\\\`

## CORTEX TEST EXAMPLE (follow this pattern exactly)

\\\`\\\`\\\`javascript
// ALWAYS declare results and helpers FIRST, before any checks
const results = { passed: false, errors: [], details: '' };
const log = (msg) => { results.details += msg + '\\n'; };
const fail = (msg) => { results.errors.push(msg); log('FAIL: ' + msg); };
const pass = (msg) => { log('PASS: ' + msg); };

const lib = window.AIMEAT.myDomainLib;
if (!lib) { fail('Library not loaded'); window.__testResults = results; return; }

// 1. SEARCH — verify real API data comes back (object params!)
const searchResult = await lib.search({query: 'test'});
log('search returned: ' + JSON.stringify(searchResult));
if (!searchResult) fail('search: returned null');
else if (!Array.isArray(searchResult.items)) fail('search: items should be array');
else if (searchResult.items.length === 0) fail('search: got empty results for known query');
else pass('search: got ' + searchResult.items.length + ' results');

// 2. GET — verify single item retrieval
const item = await lib.getItem({id: searchResult.items[0].id});
log('getItem returned: ' + JSON.stringify(item));
if (!item) fail('getItem: returned null');
else pass('getItem: returned item');

// 3. WRITE — add item, then READ BACK to verify
const addResult = await lib.addItem({id: 'test-id', name: 'Test Name'});
log('addItem returned: ' + JSON.stringify(addResult));
if (!addResult) fail('addItem: returned null');
else pass('addItem: succeeded');

// 3b. READ BACK — verify the item was actually saved
const listAfterAdd = await lib.getItems();
log('getItems after add: ' + JSON.stringify(listAfterAdd));
if (!listAfterAdd || !Array.isArray(listAfterAdd)) fail('getItems: returned null after add');
else {
  const found = listAfterAdd.find(i => i.id === 'test-id');
  if (!found) fail('addItem: item not found in list after add');
  else pass('addItem: item persisted and readable');
}

// 4. DELETE — remove item, then READ BACK to verify
const removeResult = await lib.removeItem({id: 'test-id'});
log('removeItem returned: ' + JSON.stringify(removeResult));
if (!removeResult) fail('removeItem: returned null');

// 4b. READ BACK — verify removal
const listAfterRemove = await lib.getItems();
log('getItems after remove: ' + JSON.stringify(listAfterRemove));
if (listAfterRemove && Array.isArray(listAfterRemove)) {
  const stillThere = listAfterRemove.find(i => i.id === 'test-id');
  if (stillThere) fail('removeItem: item still in list after remove');
  else pass('removeItem: item removed successfully');
}

window.__testResults = results;
\\\`\\\`\\\`

Apply this EXACT pattern to the component under test. Use the actual method names and field names from the component code.

## Output Rules
1. Return ONLY executable JavaScript code — NO markdown fences, NO explanation text
2. NO import/require/export — sandbox environment
3. Your code runs INSIDE an existing async function. Write sequential statements starting with variable declarations. The runtime already provides the async wrapper — write bare statements like \\\`const results = {...};\\\` not \\\`(async () => {...})()\\\`
4. Set window.__testResults = { passed, errors, details } as the LAST statement`,
    variables: ['disclaimer', 'lib_name', 'wraps_extension', 'golden_samples', 'test_scenarios', 'structures', 'action_contracts', 'project_context', 'cortex_methods'],
    usedIn: ['generator-autopilot'],
  },

  {
    id: 'gen-test-cortex-component',
    group: 'generator',
    name: 'Component Cortex Test (render)',
    description: 'Browser-side test for component cortexes — tests render(), DOM output, interactions.',
    content: `{{disclaimer}}You are generating TEST CODE for a UI COMPONENT CORTEX in an AIMEAT service.

## Component Under Test
- Type: cortex (component)
- Label: {{component_label}}
- Registered as: {{registered_as}}
- Library: window.AIMEAT.{{lib_name}}

## What This Component Does
This is a UI COMPONENT — it exports render(container, props) that creates DOM elements.
It does NOT export data methods like searchCompanies or getWatchlist.
Those belong to the DATA CORTEX (a separate library).

{{spec_section}}

## Data Cortex Available on Test Page
{{data_cortex_info}}

{{project_context}}

## Test Environment: Browser (page.evaluate sandbox)

CRITICAL SANDBOX RULES:
- NO import/require/export statements
- Your code runs inside page.evaluate() in a real browser page
- You have access to: window, document, fetch, DOM APIs
- Set results on: window.__testResults = { passed: boolean, errors: string[], details: string }

The component library AND the data cortex library are both loaded on the test page.
Authentication IS available — the data cortex methods work.

## How to Test a UI Component

1. Get real data from the DATA CORTEX (it's loaded on the page)
2. Create a container element
3. Call lib.render(container, props) with the real data
4. Check that DOM elements were created
5. Check text content is real data (not placeholder or translation keys)
6. Check that buttons/links exist

## EXAMPLE (follow this pattern)

\\\`\\\`\\\`javascript
const results = { passed: false, errors: [], details: '' };
const log = (msg) => { results.details += msg + '\\n'; };
const fail = (msg) => { results.errors.push(msg); log('FAIL: ' + msg); };
const pass = (msg) => { log('PASS: ' + msg); };

const lib = window.AIMEAT.myComponentLib;
if (!lib) { fail('Library not loaded'); window.__testResults = results; return; }
if (typeof lib.render !== 'function') { fail('render is not a function'); window.__testResults = results; return; }

// 1. GET REAL DATA from the data cortex (object params!)
const dataCortex = window.AIMEAT.myDataLib;
if (!dataCortex) { fail('Data cortex not loaded'); window.__testResults = results; return; }

const item = await dataCortex.getItem({id: 'test-id'});
log('Got data: ' + JSON.stringify(item));
if (!item) { fail('Could not get test data from data cortex'); window.__testResults = results; return; }

// 2. CREATE CONTAINER and RENDER
const container = document.createElement('div');
document.body.appendChild(container);

const result = lib.render(container, {
  data: item,
  locale: 'fi',
  translations: {},
  onAction: (id) => log('Action callback: ' + id)
});

// 3. WAIT FOR ASYNC RENDER — components fetch data internally, DOM populates async
await new Promise(r => setTimeout(r, 3000));

// 4. CHECK DOM OUTPUT
log('Container HTML length: ' + container.innerHTML.length);
if (container.innerHTML.length < 50) fail('render: container is nearly empty after 3s wait');
else pass('render: produced HTML content');

// 5. CHECK REAL DATA IN DOM — use textContent to verify rendered data
const text = container.textContent || '';
log('Container text (first 200): ' + text.substring(0, 200));

// NOTE: Data cortex returns NESTED objects. Check the spec for exact field paths.
// Example: company.businessId.value (not company.businessId), company.names[0].name (not company.name)
if (text.length > 50) pass('render: has substantial text content');
else fail('render: text content is too short (' + text.length + ' chars)');

// 6. SNAPSHOT — capture the rendered state for screenshots BEFORE cleanup
window.__renderSnapshot = container.innerHTML;

// 7. CHECK DESTROY
if (result && typeof result.destroy === 'function') {
  result.destroy();
  pass('destroy: function exists and called without error');
} else {
  log('Note: no destroy function returned');
}

if (results.errors.length === 0) results.passed = true;
window.__testResults = results;
\\\`\\\`\\\`

Test the ACTUAL component. Use REAL data from the data cortex. Check the DOM output.
CRITICAL: Components render ASYNCHRONOUSLY. After calling render(), WAIT 3 seconds before checking the DOM.
CRITICAL: The data cortex returns NESTED objects (see Methods and Return Shapes above). Check textContent for the actual rendered text, not for raw data field values.

## Output Rules
1. Return ONLY executable JavaScript code — NO markdown fences, NO explanation text
2. NO import/require/export — sandbox environment
3. Your code runs INSIDE an existing async function. Write sequential statements starting with variable declarations.
4. BEFORE calling destroy(), capture the rendered HTML: window.__renderSnapshot = container.innerHTML;
5. Set window.__testResults = { passed, errors, details } as the LAST statement`,
    variables: ['disclaimer', 'component_label', 'registered_as', 'lib_name', 'spec_section', 'data_cortex_info', 'project_context'],
    usedIn: ['generator-autopilot'],
  },

  {
    id: 'gen-test-cortex-app-domain',
    group: 'generator',
    name: 'App-Domain Cortex Test (init + render)',
    description: 'Browser-side test for app-domain cortex — tests init(), render(), navigation.',
    content: `{{disclaimer}}You are generating TEST CODE for an APP-DOMAIN CORTEX in an AIMEAT service.

## Component Under Test
- Type: cortex (app-domain)
- Label: {{component_label}}
- Registered as: {{registered_as}}
- Library: window.AIMEAT.{{lib_name}}

## What This Component Does
This is the APP-DOMAIN CORTEX — the top-level composition layer. It exports:
- init() — initializes auth, loads translations, returns readiness status
- render(container) — renders the full application UI with navigation

It composes all feature component cortexes into a complete application.

{{spec_section}}

## Feature Components Available
{{feature_components}}

## Data Cortex Available
{{data_cortex_info}}

{{project_context}}

## Test Environment: Browser (page.evaluate sandbox)

CRITICAL SANDBOX RULES:
- NO import/require/export statements
- Your code runs inside page.evaluate() in a real browser page
- You have access to: window, document, fetch, DOM APIs
- Set results on: window.__testResults = { passed: boolean, errors: string[], details: string }

ALL cortex libraries (data, components, app-domain) are loaded on the test page.
Authentication IS available.

## How to Test an App-Domain Cortex

1. Call init() — check it returns without error
2. Create a container and call render(container)
3. Check that the container has meaningful DOM content
4. Check that navigation elements exist (tabs, sidebar, etc.)
5. Verify the app didn't crash on render

## EXAMPLE

\\\`\\\`\\\`javascript
const results = { passed: false, errors: [], details: '' };
const log = (msg) => { results.details += msg + '\\n'; };
const fail = (msg) => { results.errors.push(msg); log('FAIL: ' + msg); };
const pass = (msg) => { log('PASS: ' + msg); };

const lib = window.AIMEAT.myAppDomainLib;
if (!lib) { fail('Library not loaded'); window.__testResults = results; return; }

// 1. TEST INIT
log('Testing init...');
try {
  const initResult = await lib.init();
  log('init returned: ' + JSON.stringify(initResult));
  if (initResult === null || initResult === undefined) fail('init: returned null');
  else pass('init: completed successfully');
} catch (e) {
  fail('init: threw error: ' + e.message);
}

// 2. TEST RENDER
log('Testing render...');
const container = document.createElement('div');
container.style.width = '1024px';
container.style.height = '768px';
document.body.appendChild(container);

try {
  lib.render(container);
  // Wait for async rendering
  await new Promise(r => setTimeout(r, 2000));

  log('Container HTML length: ' + container.innerHTML.length);
  if (container.innerHTML.length < 100) fail('render: container is nearly empty');
  else pass('render: produced HTML content (' + container.innerHTML.length + ' chars)');

  // Check for navigation elements
  const hasNav = container.querySelector('nav') || container.querySelector('[class*=nav]') || container.querySelector('[class*=tab]');
  if (hasNav) pass('render: navigation elements found');
  else log('Note: no nav/tab elements found (may use different pattern)');

} catch (e) {
  fail('render: threw error: ' + e.message);
}

if (results.errors.length === 0) results.passed = true;
window.__testResults = results;
\\\`\\\`\\\`

Test the ACTUAL component. Check that init() and render() work without crashing.

## Output Rules
1. Return ONLY executable JavaScript code — NO markdown fences, NO explanation text
2. NO import/require/export — sandbox environment
3. Your code runs INSIDE an existing async function. Write sequential statements starting with variable declarations.
4. BEFORE cleanup, capture rendered HTML: window.__renderSnapshot = container.innerHTML;
5. Set window.__testResults = { passed, errors, details } as the LAST statement`,
    variables: ['disclaimer', 'component_label', 'registered_as', 'lib_name', 'spec_section', 'feature_components', 'data_cortex_info', 'project_context'],
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
