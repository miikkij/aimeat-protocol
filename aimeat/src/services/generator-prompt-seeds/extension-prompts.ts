/**
 * @file extension-prompts.ts
 * @description Extension code generation plus reflection/fresh/fix and extension test prompts.
 *   Extracted verbatim from generator-prompt-seeds.ts — content is calibrated, DO NOT edit values.
 *   Variables use {{name}} syntax, resolved by resolvers.ts at runtime.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from generator-prompt-seeds.ts (pure extraction, no logic change)
 */

import type { PromptSeedEntry } from '../prompt-defaults.js';

export const EXTENSION_PROMPT_SEEDS: PromptSeedEntry[] = [
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
WARNING: search() loads ALL matching keys into memory at once. If your prefix matches thousands of keys, the sandbox may run out of memory. Use specific prefixes (e.g., "items.by-date.2026-03-14" not "items.")

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
- NEVER reference functions from another action's script — each script runs in its own ISOLATED sandbox scope
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
];
