/**
 * @file public/js/services/generator-prompts-shared-rules.js
 * @description Shared platform-rule constants (namespaces, sandbox, consumption, init, HTML entities) for generator prompts. Extracted from generator-prompts-base.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from generator-prompts-base.js (max-file-lines)
 */

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
