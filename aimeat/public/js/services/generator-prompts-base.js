/**
 * @file generator-prompts-base.js
 * @deprecated DEPRECATED — kept as backup/reference. Prompts now served from database seeds.
 * @description Base constants and helpers for generator prompts — shared context,
 *   instruction disclaimer, per-type component templates, and API summary helpers.
 * @structure
 *   - AIMEAT_CONTEXT: shared preamble for all prompts
 *   - INSTRUCTION_DISCLAIMER: instruction compliance prefix
 *   - COMPONENT_TEMPLATES: per-type template factory functions
 *   - summarizeExtensionApi: compact API summary for completed extensions
 *   - summarizeCortexApi: compact API summary for completed cortex libraries
 * @usage
 *   import { AIMEAT_CONTEXT, INSTRUCTION_DISCLAIMER, COMPONENT_TEMPLATES } from '/js/services/generator-prompts-base.js';
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from generator-prompts.js
 */

export const AIMEAT_CONTEXT = `
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
    Example — read owner's shared data: await ctx.memory.getPublic(ctx.caller.gaii, 'lookup.data')
    ╔═══════════════════════════════════════════════════════════════════════════════╗
    ║  IMPORTANT: ctx.memory.get() ONLY reads from the extension's OWN namespace. ║
    ║  Data stored by memory components (seed data, settings, translations) lives  ║
    ║  in the OWNER's namespace — use ctx.memory.getPublic(ctx.caller.gaii, key)  ║
    ║  to access it. ctx.caller.gaii is the caller's GHII identity (e.g. "testuser@node-id"). ║
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

export const INSTRUCTION_DISCLAIMER = `IMPORTANT: These are detailed instructions that you MUST read carefully and follow exactly. Every rule, constraint, format requirement, and example below exists for a reason. Do NOT skip sections, do NOT invent your own conventions, and do NOT deviate from the specified output format. If a rule says "MUST" or "NEVER", treat it as absolute.

`;

export const COMPONENT_TEMPLATES = {
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

${SANDBOX_CONSTRAINTS}

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
  // Use getPublic(ctx.caller.gaii, key) to read it:
  const lookup = await ctx.memory.getPublic(ctx.caller.gaii, "lookup.data") || [];
  const settings = await ctx.memory.getPublic(ctx.caller.gaii, "settings.config") || {};

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

### Init Action — Initialize Runtime Data Only

The init/@activate action should initialize extension-owned runtime data (watchlists, caches, logs).
Do NOT copy translations or settings to the extension namespace — cortex reads those
directly from the owner namespace via AIMEAT.data.get().

Pattern:
\`\`\`javascript
// Initialize extension runtime data if not already present
const watchlist = await ctx.memory.get('watchlist.items');
if (!watchlist) {
  await ctx.memory.set('watchlist.items', []);
  ctx.log.info('Initialized empty watchlist');
}
\`\`\`

Only initialize keys that the EXTENSION owns and writes to (runtime data).
Translations and settings live in the OWNER namespace — the cortex reads them directly.

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
  Use \`ctx.memory.getPublic(ctx.caller.gaii, key)\` to read them — NOT \`ctx.memory.get(key)\`.
  \`ctx.memory.get()\` only reads from the extension's own \`ext:{name}\` namespace.
  Common pattern: \`const data = await ctx.memory.getPublic(ctx.caller.gaii, "lookup.data") || [];\`
${HTML_ENTITY_RULES}`,

  app: (label, context, completedComponents) => {
    // Extract translation keys from completed translation components
    const translationComponents = (completedComponents || []).filter(c => c.type === 'translation');
    let translationKeysSection = '';
    if (translationComponents.length > 0) {
      const allKeys = new Set();
      for (const tc of translationComponents) {
        try {
          let raw = tc.result;
          // Strip markdown code fences if present
          if (typeof raw === 'string') {
            const fenceMatch = raw.match(/```(?:json)?\s*\n([\s\S]*?)```/);
            if (fenceMatch) raw = fenceMatch[1];
          }
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          // Translation result is { "fi": { "key": "value" } } or { "en": { ... } }
          const locale = Object.keys(parsed || {})[0];
          if (locale && parsed[locale]) {
            for (const key of Object.keys(parsed[locale])) allKeys.add(key);
          }
        } catch { /* skip unparseable */ }
      }
      if (allKeys.size > 0) {
        const sorted = [...allKeys].sort();
        translationKeysSection = `
## AVAILABLE TRANSLATION KEYS (from registered translation components — use EXACTLY these)

╔══════════════════════════════════════════════════════════════════════════╗
║  Your app MUST use these EXACT keys when calling t(key, translations). ║
║  Do NOT invent your own keys like "field.name" or "detail.addresses".  ║
║  The translation components have ALREADY defined these keys.           ║
╚══════════════════════════════════════════════════════════════════════════╝

${sorted.map(k => '- `' + k + '`').join('\n')}

Total: ${sorted.length} keys available. If you need a label, find the closest matching key from this list.
`;
      }
    }

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
        // Extract actual LIB_NAME from cortex code (authoritative), fallback to camelCase conversion
        const libNameMatch = lib.result?.match?.(/const\s+LIB_NAME\s*=\s*['"]([^'"]+)['"]/);
        const camelName = libNameMatch ? libNameMatch[1] : lib.name.replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase());
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

${(() => {
        // Collect probe results from extension components — real API response data
        const extProbeResults = (completedComponents || [])
          .filter(c => c.type === 'extension' && c.probeResults && c.probeResults.length > 0)
          .flatMap(c => c.probeResults.filter(p => p.status === 200 && p.response));
        return cortexLibs.map(lib => {
          const apiSummary = lib.result ? summarizeCortexApiForApp(lib.result, extProbeResults) : '  (no API info available)';
          return `### ${lib.label}
Load: \\\`<script src="/v1/cortex/${lib.name}/libs/${lib.name}.js"></script>\\\`
${apiSummary}
`;
        }).join('\n');
      })()}

${methodList}
RULES:
- Call \\\`AIMEAT.{libName}.init()\\\` on app start (libName is camelCase of cortex name, e.g., \\\`my-domain-lib\\\` → \\\`AIMEAT.myDomainLib.init()\\\`)
- Use cortex methods for ALL data access — never call extensions or memory directly
- NEVER call internal functions like callExt(), readExtMemory() — these are PRIVATE
- NEVER build retry loops — show an error message on failure, do NOT auto-retry
- Use EXACTLY the method names and return value shapes shown above

### AIMEAT Platform UI Libraries (load BEFORE your domain cortex)

\\\`\\\`\\\`html
<script src="/v1/cortex/aimeat-ui-nav/libs/aimeat-ui-nav.js"></script>
<script src="/v1/cortex/aimeat-ui-layout/libs/aimeat-ui-layout.js"></script>
<script src="/v1/cortex/aimeat-ui-viewers/libs/aimeat-ui-viewers.js"></script>
<script src="/v1/cortex/aimeat-ui-forms/libs/aimeat-ui-forms.js"></script>
<script src="/v1/cortex/aimeat-ui-dialogs/libs/aimeat-ui-dialogs.js"></script>
\\\`\\\`\\\`

Use these instead of raw HTML: \\\`Tabs\\\` for navigation, \\\`DataTable\\\` for tables, \\\`Input/Select/Toggle\\\` for forms, \\\`toast/Modal/Confirm\\\` for dialogs (never use native alert/confirm/prompt).
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
    // Platform UI libraries (pre-installed on every AIMEAT node)
    await loadScript('/v1/cortex/aimeat-ui-nav/libs/aimeat-ui-nav.js');
    await loadScript('/v1/cortex/aimeat-ui-layout/libs/aimeat-ui-layout.js');
    await loadScript('/v1/cortex/aimeat-ui-viewers/libs/aimeat-ui-viewers.js');
    await loadScript('/v1/cortex/aimeat-ui-forms/libs/aimeat-ui-forms.js');
    await loadScript('/v1/cortex/aimeat-ui-dialogs/libs/aimeat-ui-dialogs.js');
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

${translationKeysSection}
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

### Reading TRANSLATIONS (stored in owner namespace by translation components):
Translations are stored in the OWNER's namespace by the translation component during registration.
The key format is: \\\`{service-name}.i18n.{locale}\\\` (e.g. \\\`my-service.i18n.fi\\\`).
\\\`\\\`\\\`javascript
// Read translations from OWNER namespace (the translation component stored them here):
const fiStrings = await AIMEAT.data.get('my-service.i18n.fi') || await AIMEAT.data.get('i18n.fi') || {};
const enStrings = await AIMEAT.data.get('my-service.i18n.en') || await AIMEAT.data.get('i18n.en') || {};
\\\`\\\`\\\`
Use AIMEAT.data.get() — this reads from the current user's namespace where translations live.
If a cortex library has a getI18n(locale) method, use that instead (recommended).

### Calling extension actions (use AIMEAT.auth session for authenticated fetch):

╔══════════════════════════════════════════════════════════════════════════╗
║  CRITICAL: session.fetch() returns ALREADY-PARSED JSON, not Response.  ║
║  Do NOT call resp.json() — it will crash with "not a function".        ║
║  Access resp.ok, resp.data, resp.error directly.                       ║
╚══════════════════════════════════════════════════════════════════════════╝

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
- Use \`await AIMEAT.auth.login()\` to restore session from storage; if null, show a "Sign in" message. getSession() alone returns null until login() is called.
- Use vanilla JS (no build step needed)
- All dates displayed to users should be formatted from ISO 8601 strings (never store display-formatted dates)
- Has a clean, responsive UI with good mobile support
- Use CSS custom properties for theming where possible
${hasCortex ? '- Call cortex init() on app start — it handles everything automatically\n- Focus on UX/UI — the cortex handles data access and initialization' : ''}

## CRITICAL: Rendering API Data — Handle Nested Objects

API responses often contain nested objects instead of plain strings. For example:
- \`id: { value: "123", createdAt: "2026-01-01" }\` — access \`.value\`
- \`link: { url: "https://example.com", label: "More" }\` — access \`.url\`
- \`items: [{ name: "First", type: "A" }]\` — access \`[0].name\`

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

${HTML_ENTITY_RULES}

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

Translations are stored in the OWNER namespace by the translation component during registration.
The key format is: \\\`{service-slug}.i18n.{locale}\\\` (e.g. \\\`my-service.i18n.fi\\\`).
Read them with AIMEAT.data.get():
\\\`\\\`\\\`javascript
// Read translations from OWNER namespace (where translation component stored them):
const fiStrings = await AIMEAT.data.get(SERVICE_SLUG + '.i18n.fi') || {};
const enStrings = await AIMEAT.data.get(SERVICE_SLUG + '.i18n.en') || {};
\\\`\\\`\\\`

Do NOT use readExtMemory or getPublic('ext:...') for translations — they are NOT in the extension namespace.

### MANDATORY: t() helper function (MUST use this exact implementation)

Generator produces flat translation keys like \\\`"tab.search": "Haku"\\\`. The t() function
MUST check flat keys first, then fall back to nested dot-path traversal:

\\\`\\\`\\\`javascript
function t(key, translations) {
  if (!key || !translations) return key || '';
  // Flat key first (e.g., "tab.search" as direct property)
  if (translations[key] != null && typeof translations[key] !== 'object') return translations[key];
  // Then nested dot-path traversal
  var parts = key.split('.'); var val = translations;
  for (var i = 0; i < parts.length; i++) {
    if (val == null || typeof val !== 'object') return key;
    val = val[parts[i]];
  }
  return (val != null && typeof val !== 'object') ? val : key;
}
\\\`\\\`\\\`

This function is an INTERNAL helper — do NOT export it. Use it in public methods that
need translated text, e.g., \\\`t('tab.search', fiStrings)\\\`.

## IMPORTANT: How Settings Work

Default settings are stored in the OWNER namespace by the memory component.
The key is: \\\`{service-slug}.settings.config\\\`.
\\\`\\\`\\\`javascript
// Read settings from OWNER namespace (where memory component stored them):
const settings = await AIMEAT.data.get(SERVICE_SLUG + '.settings.config') || {};
\\\`\\\`\\\`

Do NOT use readExtMemory for settings — they are NOT in the extension namespace.

## Extension Action Calls (authenticated — internal helper, NOT exported)

callExt() is an INTERNAL helper inside the cortex IIFE. It is NOT part of the public API.
Apps MUST NOT call callExt() directly — use the cortex's exported methods instead.

\\\`\\\`\\\`javascript
// ALL extension actions are POST — the backend only has router.post() routes
async function callExt(extName, actionId, body) {
  try {
    if (!AIMEAT.auth || !AIMEAT.auth.getSession) return null;
    var session = AIMEAT.auth.getSession();
    if (!session) return null;
    var url = '/v1/ext/' + extName + '/' + actionId;
    var opts = { method: 'POST', body: JSON.stringify(body || {}) };
    var resp = await session.fetch(url, opts);
    if (!resp || !resp.ok) return null;
    return resp.data;
  } catch (e) {
    return null;
  }
}
\\\`\\\`\\\`

IMPORTANT: callExt is a PRIVATE helper inside the IIFE. Do NOT export it.
Apps use the cortex's public methods (init, searchCompanies, etc.), never callExt directly.

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

  // ── Memory helpers — use AIMEAT.data library (always available in browser) ──
  // The AIMEAT.data library handles auth, endpoints, and response parsing automatically.
  // Do NOT use raw fetch() or session.fetch() for memory operations.

  /** Read from extension namespace (public, no auth needed) */
  async function readExtMemory(extName, key) {
    try { return await AIMEAT.data.getPublic('ext:' + extName, key); }
    catch (e) { return null; }
  }

  /** Read from current user's own namespace */
  async function readOwnerMemory(key) {
    try { return await AIMEAT.data.get(key); }
    catch (e) { return null; }
  }

  /** Write to current user's own namespace */
  async function writeOwnerMemory(key, value) {
    try { await AIMEAT.data.set(key, value); return true; }
    catch (e) { return false; }
  }

  /** Delete from current user's own namespace */
  async function deleteOwnerMemory(key) {
    try { await AIMEAT.data.delete(key); return true; }
    catch (e) { return false; }
  }

  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  CRITICAL: session.fetch() returns ALREADY-PARSED JSON (not Response). ║
  // ║  Do NOT call resp.json() — it will crash. Use resp.data directly.      ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  // ALL extension actions are POST — the backend only has router.post() routes
  async function callExt(extName, actionId, body) {
    try {
      if (!AIMEAT.auth || !AIMEAT.auth.getSession) return null;
      const session = AIMEAT.auth.getSession();
      if (!session) return null;
      const url = '/v1/ext/' + extName + '/' + actionId;
      const opts = { method: 'POST', body: JSON.stringify(body || {}) };
      const resp = await session.fetch(url, opts);
      if (!resp || !resp.ok) return null;
      return resp.data;
    } catch (e) {
      return null;
    }
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
- Use \`AIMEAT.data.getPublic()\` for public memory reads (extension namespace data)
- Use \`AIMEAT.auth.getSession().fetch()\` for ALL authenticated calls — NEVER use raw fetch() for API calls
- The fallback path (when AIMEAT.data is not loaded) MUST also use session.fetch(), not raw fetch()
- Extension names in \`EXT\` object MUST exactly match the registered extension \`metadata.name\`
- \`init()\` MUST follow the init() contract below — no custom behavior
- All public methods must be async (return Promises)
- Handle errors gracefully — return null or empty arrays, don't throw for missing data
- Include the prompt component with documented API surface for downstream AI consumers

### MANDATORY: JSDoc for every public method

Every exported method MUST have a JSDoc comment with:
- \`@param\` for each parameter with its type and description
- \`@returns\` with the EXACT return shape — never use \`{Object}\`, always describe the fields

WRONG:
\\\`\\\`\\\`javascript
/** @returns {Object|null} Item data */
async function getItem(id) { ... }
\\\`\\\`\\\`

RIGHT:
\\\`\\\`\\\`javascript
/**
 * @param {string} id - Unique identifier
 * @returns {{ id: string, name: string, status: string, metadata: { createdAt: string, updatedAt: string } } | null}
 */
async function getItem(id) { ... }
\\\`\\\`\\\`

Use the ACTUAL API RESPONSES section (from probe data) to determine the exact return shapes.
Every field you see in the probe response MUST appear in the @returns type definition.
If probe data shows a nested object like \`field: { value: "abc", date: "2024-01-01" }\`, your @returns MUST reflect that: \`field: { value: string, date: string }\`.

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
/**
 * Extract only code blocks (```yaml ... ``` and ```javascript ... ```) from AI response.
 * Strips explanatory text that AI adds during fix rounds.
 */
export function extractCodeBlocks(text) {
  if (!text) return '';
  const blocks = [];
  const re = /```(\w*)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    blocks.push('```' + m[1] + '\n' + m[2] + '```');
  }
  return blocks.length > 0 ? blocks.join('\n\n') : text;
}

/** @deprecated Use component.spec (formal JSON contract) instead of regex-extracted summaries. */
export function summarizeExtensionApi(result) {
  console.warn('[DEPRECATED] summarizeExtensionApi — use component.spec instead. See generator-specs.js.');
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
/** @deprecated Use component.spec (formal JSON contract) instead of regex-extracted summaries. */
export function summarizeCortexApi(result) {
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

/**
 * Summarize cortex API for the app prompt — shows ONLY public methods and return shapes.
 * Never shows internal functions (callExt, readExtMemory, etc.) to prevent apps from
 * bypassing the cortex and calling extensions directly.
 */
/**
 * Generate a JSDoc-style API reference from cortex source code for the app prompt.
 * Shows ONLY public methods with parameters and return types.
 * Never exposes internal functions (callExt, readExtMemory, etc.).
 */
/** @deprecated Use component.spec (formal JSON contract) instead of regex-extracted summaries. */
export function summarizeCortexApiForApp(result, probeResults) {
  if (!result) return '  (no API info available)';

  // Extract LIB_NAME
  const libMatch = result.match(/const\s+LIB_NAME\s*=\s*['"]([^'"]+)['"]/);
  const libName = libMatch ? libMatch[1] : 'unknownLib';

  // Extract exported method names from the exports object
  const exportsMatch = result.match(/(?:const|var)\s+exports\s*=\s*\{([\s\S]*?)\}/);
  const exportedNames = new Set();
  if (exportsMatch) {
    for (const m of exportsMatch[1].split(',')) {
      const name = m.trim().split(':')[0].trim();
      if (name && !name.startsWith('//')) exportedNames.add(name);
    }
  }

  // Extract function signatures + JSDoc comments for exported methods only
  const jsdocEntries = [];
  // Match JSDoc + function pairs: /** ... */ followed by async function name(...)
  const funcRegex = /(\/\*\*[\s\S]*?\*\/)\s*(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
  let match;
  while ((match = funcRegex.exec(result)) !== null) {
    const [, docComment, funcName, params] = match;
    if (!exportedNames.has(funcName)) continue; // skip internal functions
    jsdocEntries.push({ name: funcName, params, doc: docComment });
  }

  // Also catch functions without JSDoc (fallback)
  const bareFuncRegex = /(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*\{/g;
  while ((match = bareFuncRegex.exec(result)) !== null) {
    const [, funcName, params] = match;
    if (!exportedNames.has(funcName)) continue;
    if (jsdocEntries.some(e => e.name === funcName)) continue; // already captured
    jsdocEntries.push({ name: funcName, params, doc: null });
  }

  // Build JSDoc-style output
  const lines = [];
  lines.push(`/**`);
  lines.push(` * Cortex library: AIMEAT.${libName}`);
  lines.push(` * Load: <script src="/v1/cortex/.../${libName.replace(/([A-Z])/g, '-$1').toLowerCase()}.js"></script>`);
  lines.push(` *`);
  lines.push(` * Call these methods from your app. They handle all backend communication internally.`);
  lines.push(` * Do NOT call callExt(), readExtMemory(), writeOwnerMemory() or /v1/ext/ directly.`);
  lines.push(` */`);
  lines.push('');

  for (const entry of jsdocEntries) {
    if (entry.doc) {
      // Include the original JSDoc comment
      lines.push(entry.doc.trim());
    }
    lines.push(`async AIMEAT.${libName}.${entry.name}(${entry.params})`);

    // Extract @returns shape from JSDoc for prominent display
    if (entry.doc) {
      const returnsMatch = entry.doc.match(/@returns\s+\{([^}]+)\}/);
      if (returnsMatch) {
        lines.push(`  ⚠️ RETURNS: ${returnsMatch[1].trim()}`);
        lines.push(`  Use EXACTLY these field names when accessing the result.`);
      }
    }

    // Attach real response example from probe if available
    if (probeResults && probeResults.length > 0) {
      const probe = probeResults.find(p => p.action === entry.name);
      if (probe && probe.response) {
        const example = JSON.stringify(probe.response, null, 2);
        const truncated = example.length > 600 ? example.substring(0, 600) + '...' : example;
        lines.push(`  ACTUAL RESPONSE (from live probe — use these EXACT field names):`);
        lines.push(`  ${truncated.split('\n').join('\n  ')}`);
      }
    }
    lines.push('');
  }

  // If no JSDoc entries found, fall back to api_surface from YAML
  if (jsdocEntries.length === 0) {
    const apiSurfaceMatch = result.match(/api_surface:\s*\|\n([\s\S]*?)(?=\n\s{4}\w|\n\s{2}-|\n[^\s])/);
    if (apiSurfaceMatch) {
      lines.push('Public API:');
      for (const sl of apiSurfaceMatch[1].split('\n').map(l => l.trim()).filter(Boolean)) {
        lines.push('  ' + sl);
      }
    } else {
      // Last resort: just list method names
      for (const name of exportedNames) {
        lines.push(`async AIMEAT.${libName}.${name}()`);
      }
    }
  }

  lines.push('');
  lines.push('╔══════════════════════════════════════════════════════════════════════════╗');
  lines.push('║  Use EXACTLY the field names shown in @returns and ACTUAL RESPONSE      ║');
  lines.push('║  above. If @returns says { companies: Array }, use .companies            ║');
  lines.push('║  NOT .results, .data, .items, or any other guessed name.                ║');
  lines.push('║  These are the ONLY methods available. NEVER call callExt(),            ║');
  lines.push('║  readExtMemory(), or /v1/ext/ directly.                                  ║');
  lines.push('╚══════════════════════════════════════════════════════════════════════════╝');

  return lines.join('\n');
}

/* ── Shared Platform Rules ─────────────────────────────────────────────── */
// These constants are shared across multiple prompts (extension, cortex, test, fix, edit)
// to ensure consistent platform knowledge. When a rule changes, it propagates everywhere.

/**
 * NAMESPACE_RULES — How AIMEAT data is organized across namespaces.
 * Used by: extension template, cortex template, test prompt, fix prompt
 */
export const NAMESPACE_RULES = `
## AIMEAT Namespace Rules

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
Do NOT copy translations or settings — cortex reads those from the owner namespace directly.
`.trim();

/**
 * SANDBOX_CONSTRAINTS — V8 sandbox rules for extension code.
 * Used by: extension template, test prompt, fix prompt
 */
export const SANDBOX_CONSTRAINTS = `
## V8 Sandbox Environment

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
- You always get Unicode text — no manual decoding needed
`.trim();

/**
 * EXTENSION_CONSUMPTION_RULES — How to call/read extensions from outside.
 * Used by: cortex template, test prompt, fix prompt
 */
export const EXTENSION_CONSUMPTION_RULES = `
## How to Consume Extensions (callExt / readExtMemory pattern)

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
    Graceful error handling is correct behavior — only FAIL on HTTP 500 (extension crashed).
`.trim();

/**
 * INIT_CONTRACT — Extension @activate and cortex init() rules.
 * Used by: extension template, cortex template, test prompt
 */
export const INIT_CONTRACT = `
## Init Contracts

### Extension @activate init
- Runs on activation AND every server restart
- MUST be idempotent (check existing data before overwriting)
- Initialize extension-owned runtime data (watchlists, caches, logs) if not present
- Should check if data exists and is fresh — skip if already populated
- Do NOT copy translations or settings — cortex reads those from owner namespace directly
- Pattern: check existing data → initialize missing runtime keys → return status

### Cortex init()
- UI readiness check ONLY — NEVER triggers backend logic
- MUST return { ready: true/false, hasData: true/false }
- NEVER call callExt() from init() — the extension scheduler handles background work
- NEVER set up timers or intervals
- Apps show empty state when hasData === false
- init() runs BEFORE any other method — app waits for it
`.trim();

/**
 * HTML_ENTITY_RULES — Prevent HTML entities in generated code.
 * Used by: extension template, app template, fix prompt, edit prompt
 */
export const HTML_ENTITY_RULES = `
## No HTML Entities in Code

╔════════════════════════════════════════════════════════════════════╗
║  Your code MUST use real operators, NOT HTML entities.             ║
║  The V8 sandbox executes raw JS — HTML entities are syntax errors. ║
╚════════════════════════════════════════════════════════════════════╝

WRONG (crashes):  const gt = a =&gt; a &gt; 0 &amp;&amp; b;
CORRECT:          const gt = a => a > 0 && b;

Check your ENTIRE output. If you see &gt; &lt; &amp; &quot; &#39; anywhere
in code, replace them with > < & " ' respectively.
`.trim();
