/**
 * @file public/js/services/generator-prompts-template-cortex.js
 * @description Cortex component prompt template for the generator. Extracted from generator-prompts-base.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from generator-prompts-base.js (max-file-lines)
 */

import { AIMEAT_CONTEXT } from './generator-prompts-context.js';
import { summarizeExtensionApi } from './generator-prompts-summaries.js';

export const cortexTemplate = (label, context, completedComponents) => {
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
  };
