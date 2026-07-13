/**
 * @file public/js/services/generator-prompts-template-extension.js
 * @description Extension component prompt template for the generator. Extracted from generator-prompts-base.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from generator-prompts-base.js (max-file-lines)
 */

import { AIMEAT_CONTEXT } from './generator-prompts-context.js';
import { SANDBOX_CONSTRAINTS, HTML_ENTITY_RULES } from './generator-prompts-shared-rules.js';

export const extensionTemplate = (label, context) => `${AIMEAT_CONTEXT}

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
║  Use: /v1/ext/{name}/actionId                                          ║
║  NEVER add :instanceId unless the blueprint explicitly requires          ║
║  multi-instance support (e.g., per-store, per-tenant separation).       ║
╚══════════════════════════════════════════════════════════════════════════╝

- Default (single-instance): \`path: /v1/ext/{name}/actionId\`
- Multi-instance (only if needed): \`path: /v1/ext/{name}/:instanceId/actionId\`

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
    action: actionId
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
${HTML_ENTITY_RULES}`;
