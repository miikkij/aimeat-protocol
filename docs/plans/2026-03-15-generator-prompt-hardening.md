# Generator Prompt Hardening Plan

**Date:** 2026-03-15
**Based on:** [Generator V1 Post-Mortem](../analysis/2026-03-15-generator-v1-postmortem.md)
**Goal:** Make the generator produce working services from any domain by embedding general design principles — not project-specific patches

---

## The Meta-Problem

Every bug in the Hälytyskartta test traces to the same failure: **the generator made assumptions about data it never looked at**. It assumed RSS titles start with municipality names. It assumed data sources provide coordinates. It assumed memory values are JSON strings. It assumed Finnish text is UTF-8.

Project-specific fixes ("add RSS encoding guidance", "detect coordinate needs for maps") don't scale. The next project will have different data sources, different formats, different gaps. The generator needs principles that make it **ask the right questions and verify its assumptions** for any domain.

---

## Principle 1: Never Write a Parser Without a Sample

**Where:** Interview prompt (data sources section) + blueprint context propagation

### The General Rule

Before generating code that reads, parses, or transforms external data, the generator must have seen **at least one real example** of that data. This applies to RSS feeds, JSON APIs, CSV files, WebSocket messages, HTML pages — anything the code will consume.

### What the Interview Should Do

```
For EVERY external data source:
1. If a URL is provided, try to fetch ONE sample entry and include it verbatim in the spec
2. If you cannot access it, ask the user to paste one real entry
3. NEVER generate parsing code based on assumptions about format — you need evidence
4. Note any non-obvious characteristics: encoding declaration, nested structures,
   mixed-language content, timestamps with ambiguous formats, fields that look like
   one thing but are another
```

### What the Blueprint Should Do

Pass the sample data through to the extension prompt as context. The extension generator writes its parser **against the sample**, not against an imagined format.

### What This Catches (generalized)

- Any parsing bug where the actual format differs from the assumed format
- Timestamp formats that vary by locale or source
- Nested/wrapped data where fields aren't where you expect them
- Mixed encodings, BOM markers, CRLF vs LF

---

## Principle 2: Trace the Data Pipeline End-to-End Before Generating Code

**Where:** Blueprint prompt

### The General Rule

Before listing components, the blueprint must trace every piece of data from **source → storage → display** and verify that every required transformation exists. If a view needs data field X, there must be a clear path that produces X.

### What the Blueprint Should Do

```
Before listing components, trace each data flow:

For each VIEW in the spec:
  1. What fields does this view need to render? (list them)
  2. Where does each field come from? (source, computed, user input)
  3. Does the source provide this field directly?
     - YES → no transformation needed
     - NO → which component transforms/enriches it? Add that component.
  4. What format does the view need vs what format the source provides?
     - If they differ → which component handles the conversion?

If any field has no clear path from source to view, the blueprint is incomplete.
```

### What This Catches (generalized)

- Map views needing coordinates that the source doesn't provide → blueprint adds enrichment step
- List views needing human-readable labels that the source stores as codes → blueprint adds lookup/mapping
- Dashboard views needing aggregated stats that don't exist yet → blueprint plans aggregation
- Any view needing derived data that no component produces
- Display format mismatches (dates stored as ISO but displayed as "2 hours ago", etc.)

---

## Principle 3: Every API Boundary Has a Contract — Know It

**Where:** Extension prompt, cortex prompt

### The General Rule

At every point where code calls an API (ctx.memory, ctx.fetch, AIMEAT.data, extension actions), the code must match the API's actual return type. Don't guess — the prompt must specify what each API returns and the code must handle it correctly.

### What the Extension Prompt Should Do

The prompt already has warnings about `ctx.memory.get()` returning parsed values. But warnings alone don't work because LLMs pattern-match from nearby code examples. The fix:

1. **Never show a confusable pattern near the correct pattern.** If `JSON.parse(resp.text)` appears in the prompt, the AI will apply `JSON.parse()` to everything nearby. Keep `ctx.fetch()` examples and `ctx.memory` examples in separate, clearly labeled sections.

2. **Show the contract at the point of use**, not in a separate "warnings" section:
```
ctx.memory.get(key) → returns: Object | Array | string | number | null (ALREADY PARSED)
ctx.memory.search(prefix) → returns: Array<{key: string, value: any}>
ctx.fetch(url) → returns: {ok: boolean, status: number, text: string} (text is RAW — parse it yourself)
```

3. **Code template must demonstrate correct usage** — the example code in the Output Format section is what the AI actually copies. If the template shows the right pattern, the generated code follows it.

### What This Catches (generalized)

- JSON.parse on already-parsed values (ctx.memory.get)
- Treating {key, value} objects as strings (ctx.memory.search)
- Missing null checks on any API that can return null/undefined
- Wrong HTTP method or request format for any API call

---

## Principle 4: Every Component Must Work When Its Dependencies Have No Data

**Where:** Cortex prompt, app prompt, extension prompt

### The General Rule

On first run, nothing exists. Every component must handle the case where upstream data hasn't been produced yet. This isn't an edge case — it's the **first thing the user experiences**.

### What Each Prompt Should Enforce

```
Extension: If the memory key you're reading doesn't exist yet, return a meaningful
empty result — don't crash, don't call JSON.parse on undefined.

Cortex: init() tries to bootstrap data, but if it fails, every method returns
graceful empty values ([], {}, null). Never chain dependent extension calls — if
collector hasn't run, don't call aggregator.

App: Every data-dependent view has an empty state. "No data yet" is a valid UI state,
not an error. The app should work (show empty states) even if zero extensions have
ever run.
```

### What This Catches (generalized)

- Cascade failures where one missing piece crashes everything downstream
- Apps that show blank screens instead of helpful empty states
- Cortex methods that throw on null instead of returning defaults
- Extensions that crash when reading non-existent prerequisite data

---

## Principle 5: Validate Generated Code Against Known Anti-Patterns

**Where:** Generator UI (generator-tab.js), post-generation

### The General Rule

Don't trust the AI output blindly. Before installing any generated component, scan it for patterns that are **always wrong** in the AIMEAT context. These aren't style checks — they're crash-prevention.

### Universal Anti-Pattern Checks

| Pattern | Applies to | Why it's always wrong |
|---------|-----------|----------------------|
| `JSON.parse(ctx.memory` or `JSON.parse(await ctx.memory` | extension | memory.get returns parsed values |
| `require(` or `import X from` (not `export default`) | extension | V8 sandbox has no module system |
| `fetch(` without `ctx.` prefix | extension | global fetch not available in sandbox |
| `console.log` | extension | not available, use ctx.log |
| `&gt;` `&lt;` `&amp;` in JS/YAML code | any | HTML entities crash execution |
| `setTimeout` `setInterval` | extension | not available in sandbox |
| Translation root key doesn't match requested locale | translation | wrong language content |

These are simple regex scans that run in the generator UI before install. They catch mechanical errors that the AI makes regardless of how good the prompt is.

---

## Principle 6: Provide a Design System, Not Ad-Hoc Styles

**Where:** App prompt, interview (style section)

### The General Rule

Every generated app reinvents CSS from scratch. The AI picks random colors, inconsistent spacing, different button styles. The result looks "AI-generated" — functional but generic. Instead, the generator should provide a **structured theming system** that the AI fills in, and a **library menu** it can pick from.

### Theming System

The app prompt should include a base CSS design system with variables the AI customizes:

```css
:root {
  /* AI fills these based on interview style preferences */
  --color-primary: #E8564A;
  --color-secondary: #2563eb;
  --color-success: #22c55e;
  --color-warning: #f59e0b;
  --color-danger: #ef4444;
  --color-bg: #ffffff;
  --color-bg-card: #f8fafc;
  --color-text: #1e293b;
  --color-text-dim: #64748b;
  --color-border: #e2e8f0;
  --radius: 8px;
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --font-sans: system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.07);
}
```

The AI defines the palette and values, then uses `var(--color-primary)` everywhere instead of hardcoded hex values. This makes theming consistent and changeable.

### CDN Library Menu

The app prompt should list available CDN libraries with their capabilities, so the AI picks the right tool instead of reimplementing:

| Library | CDN | Use for |
|---------|-----|---------|
| **Motion** | `https://cdn.jsdelivr.net/npm/motion@11/dist/motion.js` | Animations, transitions, scroll effects. Global: `Motion.animate()` |
| **Leaflet** | `https://unpkg.com/leaflet@1/dist/leaflet.js` | Maps, markers, geospatial |
| **Chart.js** | `https://cdn.jsdelivr.net/npm/chart.js` | Bar, line, pie, radar charts |
| **Phaser 3** | `https://cdn.jsdelivr.net/npm/[email protected]/dist/phaser.min.js` | Games, interactive canvases, physics simulations |
| **uiverse.io patterns** | (CSS-only) | Fancy buttons, cards, toggles, loaders — copy CSS directly |

The interview's "Style & Look" section should let users choose animation level (none/subtle/rich) and map to specific libraries.

### Auth UI Layout

Every app needs to account for the AIMEAT auth UI elements:
- Login button container (`#auth-container`) at top of page
- The auth library renders a session indicator bar when logged in
- App layout must reserve space for this and not overlap it

---

## Principle 7: Editing After Generation Must Be Easy

**Where:** Generator UI (generator-tab.js), blueprint structure, new prompt type

### The Problem

The user generates 20 components, installs them, opens the app, and sees that municipality names show as numbers. Now what? They stare at the sidebar with 20 components and have no idea which one to touch. Even if they guess correctly (ext-1's parser), changing it might break the cortex and app that read its output. The current options are:

1. Regenerate everything from scratch (loses all working code)
2. Manually figure out which components to change, copy each prompt to AI Chat one by one (death by a thousand round-trips)
3. Give up

### The User Experience: "What Do I Click?"

**Scenario:** User sees municipality showing "23" instead of "Tampere" in the running app.

#### Step 1: User opens the generator dashboard and clicks "Edit Service"

A new mode (alongside the existing component sidebar). Shows a simple text field:

```
┌─────────────────────────────────────────────────────┐
│ What do you want to change?                         │
│                                                     │
│ Municipality shows numbers like "23" instead of     │
│ city names like "Tampere". The RSS title format is   │
│ "23:52:57 Tampere vahingontorjunta: keskisuuri"     │
│ and the parser is using the hour as the municipality.│
│                                                     │
│ [Analyze Impact]                                    │
└─────────────────────────────────────────────────────┘
```

The user describes the problem in plain language. No need to know which components are involved.

#### Step 2: Generator analyzes and shows the impact

The system builds an "impact prompt" — it sends the change request + the blueprint (with `produces`/`consumes` metadata) to AI Chat. The AI identifies affected components:

```
┌─────────────────────────────────────────────────────┐
│ Change Impact Analysis                              │
│                                                     │
│ Your change affects 3 of 12 components:             │
│                                                     │
│ ● ext-1 (Alert Ingest)          ROOT CAUSE          │
│   parseTitle() needs to strip HH:MM:SS prefix       │
│   before extracting municipality name               │
│                                                     │
│ ○ cortex-1 (Alert Cortex)       DATA SHAPE SAME     │
│   No change needed — reads municipality as string   │
│   regardless of content                             │
│                                                     │
│ ○ app-1 (Alert Map App)         DATA SHAPE SAME     │
│   No change needed — displays municipality as-is    │
│                                                     │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ Unaffected (9 components): csm-1, msm-1, msm-2,    │
│ mem-1 through mem-6, translation-1, translation-2   │
│                                                     │
│ [Generate Fix for ext-1]  [Generate Fix for All 3]  │
└─────────────────────────────────────────────────────┘
```

Key: the user sees a human-readable explanation, not a dependency graph. The system tells them what needs to change and what doesn't.

#### Step 3: User generates the fix prompt

Clicking "Generate Fix for ext-1" creates a **targeted edit prompt** — not a full regeneration prompt. This prompt contains:

1. The currently installed code for ext-1
2. The specific change request
3. Instruction: "Modify ONLY the parseTitle() function. Keep everything else identical."

The user copies this to AI Chat, gets back the fixed code, pastes it, validates, re-registers. One round-trip, one component.

#### Step 4: If the data shape changed

If the fix changes what ext-1 writes to memory (e.g., municipality was a number, now it's a string with a different format), the system flags downstream components:

```
┌─────────────────────────────────────────────────────┐
│ ⚠️ Data shape changed                               │
│                                                     │
│ ext-1 now writes municipality as a city name string │
│ ("Tampere") instead of a number ("23").             │
│                                                     │
│ These components read ext-1's data:                 │
│ ● ext-2 (Aggregator) — groups by municipality       │
│ ● cortex-1 — exposes getAlerts() to app             │
│                                                     │
│ [Generate update prompts for affected components]   │
└─────────────────────────────────────────────────────┘
```

Each downstream component gets its own targeted edit prompt that says: "The upstream data changed — municipality is now a name string. Update your code to match."

### What This Requires in the Blueprint

Each component needs `produces` and `consumes` fields so the system can trace dependencies:

```json
{
  "id": "ext-1", "type": "extension", "label": "Alert Ingest",
  "produces": ["memory:alerts.by-date.*"],
  "consumes": []
},
{
  "id": "ext-2", "type": "extension", "label": "Aggregator",
  "produces": ["memory:aggregates.daily.*"],
  "consumes": ["memory:alerts.by-date.*"]
},
{
  "id": "cortex-1", "type": "cortex", "label": "Alert Cortex",
  "produces": ["api:getAlerts", "api:getDailyStats"],
  "consumes": ["memory:alerts.by-date.*", "memory:aggregates.daily.*"]
},
{
  "id": "app-1", "type": "app", "label": "Alert Map App",
  "consumes": ["api:getAlerts", "api:getDailyStats"]
}
```

### What This Requires in the Generator UI

1. **"Edit Service" button** on the project dashboard — opens the change request view
2. **Impact analysis prompt** — `buildImpactPrompt(changeRequest, blueprint, installedCode)` — new prompt type
3. **Targeted edit prompt** — `buildEditPrompt(component, currentCode, changeRequest)` — new prompt type
4. **Per-component "Modify" action** — alongside existing "Regenerate prompt", adds a "Modify this component" that includes the current installed code + change instructions
5. **Re-register overwrites** — registering a component that already exists should update (upsert), not fail

### What This Requires in Prompts

Two new prompt builders:

**`buildImpactPrompt(changeRequest, blueprint)`** — sent to AI Chat to analyze which components are affected:
```
Here is the blueprint for an AIMEAT service with dependency metadata.
The user wants to make this change: "{changeRequest}"

Analyze which components need to be modified. For each component, say:
- ROOT CAUSE: this component directly causes the problem
- NEEDS UPDATE: this component's code must change because upstream data changed
- NO CHANGE: this component is unaffected

Return JSON: { "affected": [{ "id": "ext-1", "reason": "...", "severity": "root|update|none" }] }
```

**`buildEditPrompt(type, label, currentCode, changeRequest, upstreamChanges)`** — generates a targeted fix:
```
You are modifying an existing AIMEAT {type} component: {label}

CURRENT INSTALLED CODE:
{currentCode}

CHANGE REQUEST:
{changeRequest}

{upstreamChanges ? "UPSTREAM DATA CHANGES:\n" + upstreamChanges : ""}

Rules:
- Modify ONLY what the change request asks for
- Keep ALL other code identical — do not refactor, restyle, or "improve" unrelated code
- Return the complete modified component in the same format as the original
```

### Spec Editing (Simpler Alternative)

For bigger changes, the user can also go back to the interview spec:

1. Click "Edit Spec" → shows the stored interview JSON in an editable text area
2. User modifies it (e.g., adds a sample RSS entry they forgot)
3. Click "Re-analyze" → system identifies which blueprint components are affected
4. User regenerates only those components

This is the "go back to the beginning without losing everything" path.

---

## Principle 8: One-Click Activate, Deactivate, and Teardown

**Where:** Generator UI (generator-tab.js)

### The Problem

After generating and registering 20 components, the user has to manually:
1. Go to Extensions tab → activate each extension one by one
2. Go to app-catalog → find the app → launch it
3. When something fails, go back to Extensions → deactivate each one
4. To clean up a failed experiment: delete each extension, each cortex, the app, the CSMs, the MSMs — individually

This takes longer than the actual generation. And you have to remember which components belong to which project.

### The User Experience

The generator dashboard already shows all components in the sidebar. After all components are registered, the dashboard should show:

```
┌─────────────────────────────────────────────────────┐
│ Hälytyskartta                          All registered│
│                                                     │
│ [▶ Activate All]  [Launch App]  [⏹ Deactivate All]  │
│                                                     │
│ Components:                                         │
│ ✅ ext-1 (Alert Ingest)           active │ deactivate│
│ ✅ ext-2 (Aggregator)             active │ deactivate│
│ ✅ cortex-1 (Alert Cortex)        active │ deactivate│
│ ✅ app-1 (Alert Map)              published │ launch │
│ ✅ csm-1 (Alert CSM)              registered         │
│ ✅ msm-1 (Tilannehuone MSM)       registered         │
│ ...                                                 │
│                                                     │
│ [🗑 Remove All...]                                   │
└─────────────────────────────────────────────────────┘
```

### Actions

**Activate All** — loops through all registered extensions and cortexes, calls:
- `POST /v1/extensions/{name}/activate` for each extension
- `POST /v1/cortex/{name}/activate` for each cortex
- Shows progress: "Activating ext-1... ext-2... cortex-1... Done (3/3)"

**Deactivate All** — same loop, calls `/deactivate` endpoints. Extensions stop their schedulers, cortexes go inactive. Nothing is deleted — easy to reactivate.

**Launch App** — opens the generated app in app-catalog inline mode:
- `window.open('/app-catalog.html?app=' + encodeURIComponent(appFilename))`
- Or directly: `window.open('/v1/apps/' + owner + '/' + filename + '?mode=inline')`

**Remove All** — shows a checklist before deleting:
```
┌─────────────────────────────────────────────────────┐
│ Remove Hälytyskartta components?                    │
│                                                     │
│ ☑ ext-1 (Alert Ingest)         — DELETE extension   │
│ ☑ ext-2 (Aggregator)           — DELETE extension   │
│ ☑ cortex-1 (Alert Cortex)      — DELETE cortex      │
│ ☑ app-1 (Alert Map)            — DELETE app          │
│ ☐ csm-1 (Alert CSM)            — keep (other services│
│                                   might use it)      │
│ ☐ msm-1 (Tilannehuone MSM)     — keep               │
│                                                     │
│ ☐ Also delete memory data written by extensions      │
│                                                     │
│ [Cancel]  [Remove Selected]                          │
└─────────────────────────────────────────────────────┘
```

User picks what to remove. Defaults: extensions, cortexes, and app checked. CSMs, MSMs, and memory unchecked (they might be shared or you want to keep the data).

### What This Requires

**Generator stores `registeredAs` for each component** — already done (component.registeredAs in the project state). This is the name/ID used to call the activate/deactivate/delete APIs.

**New functions in generator.js:**
```javascript
async function activateAll(projectId) { ... }     // loops registered extensions + cortexes
async function deactivateAll(projectId) { ... }   // loops registered extensions + cortexes
async function removeComponents(projectId, componentIds, includeMemory) { ... }
async function getComponentStatuses(projectId) { ... }  // checks live status of each
```

**Status polling:** The dashboard should check the live status of each registered component (active/inactive/error) by calling `GET /v1/extensions` and `GET /v1/cortex` and matching against the project's registeredAs names.

---

## Principle 9: Built-in Diagnostics for Generated Services

**Where:** Generator UI (generator-tab.js), generated app code

### The Problem

When the generated app fails, the user:
1. Opens browser DevTools → Console tab → copies errors
2. Opens Network tab → finds failed requests → copies responses
3. Opens server logs → finds matching error lines → copies them
4. Pastes everything into Claude/AI Chat
5. Waits for analysis
6. Gets told "the extension crashes because JSON.parse on undefined"

This is 5-10 minutes of manual copy-paste archaeology every time something breaks.

### The User Experience

#### Option A: Diagnostics Panel in Generator Dashboard

After activating and launching, the generator dashboard shows a live diagnostics panel:

```
┌─────────────────────────────────────────────────────┐
│ Diagnostics                              [Refresh]  │
│                                                     │
│ ❌ ext-1 aggregate-daily — 500 EXTENSION_ERROR      │
│    "undefined" is not valid JSON                    │
│    Last: 2 min ago │ 3 failures in last hour        │
│                                                     │
│ ❌ ext-2 aggregate-nightly — 500 EXTENSION_ERROR    │
│    Unexpected token '&' at line 4                   │
│    Last: 15 min ago │ 1 failure                     │
│                                                     │
│ ✅ ext-1 collect-alerts — 200 OK                    │
│    Last: 5 min ago │ Collected 12 alerts            │
│                                                     │
│ ⚠️ cortex-1 — loaded but getDailyStats() returns   │
│    null (upstream ext failed)                       │
│                                                     │
│ [Copy Diagnostics Report]  [Generate Fix Prompt]    │
└─────────────────────────────────────────────────────┘
```

**"Copy Diagnostics Report"** — bundles all errors, recent extension action logs, and component statuses into a structured report the user can paste into AI Chat.

**"Generate Fix Prompt"** — takes the diagnostics + the component code and creates a targeted fix prompt automatically. Combines Principle 7 (editing) with real error data.

#### How It Gets the Data

The AIMEAT server already logs extension action results. The diagnostics panel queries:

1. **Extension action history** — `GET /v1/extensions/{name}` returns recent action results with errors
2. **Extension scheduler status** — whether scheduled jobs are running and their last result
3. **Server logs** — the generator could query a recent-errors endpoint (may need a new lightweight API)
4. **App-side errors** — the generated app could report client-side errors back (see Option B)

#### Option B: Error Reporting in Generated Apps

Add to the app prompt template: generated apps should catch and display errors in a debug panel:

```javascript
// Error collector — add to every generated app
const _errors = [];
window.addEventListener('error', e => _errors.push({ type: 'js', msg: e.message, time: Date.now() }));
window.addEventListener('unhandledrejection', e => _errors.push({ type: 'promise', msg: e.reason?.message || String(e.reason), time: Date.now() }));

// Intercept fetch errors for AIMEAT API calls
const _origFetch = window.fetch;
window.fetch = async (...args) => {
  const resp = await _origFetch(...args);
  if (!resp.ok && String(args[0]).includes('/v1/')) {
    const body = await resp.clone().json().catch(() => null);
    _errors.push({ type: 'api', url: args[0], status: resp.status, error: body?.error, time: Date.now() });
  }
  return resp;
};
```

The app shows a small error badge when errors exist. Clicking it shows the error log + a "Copy for debugging" button that formats everything for pasting into AI Chat.

This means the user doesn't need DevTools at all — the app itself tells them what went wrong.

### What This Requires

**Generator dashboard:**
- Diagnostics panel component that polls extension statuses
- "Copy Diagnostics Report" formatter
- Integration with Principle 7's "Generate Fix" flow

**App prompt:**
- Error collector snippet in the app template
- Debug badge UI (small, unobtrusive, only visible when errors exist)
- "Copy for debugging" formatter

**Possibly new API:**
- `GET /v1/extensions/{name}/logs?limit=20` — recent action execution logs with errors
- Or reuse existing extension status data if it includes error history

---

## Implementation

### Phase 1: Data Integrity (Principles 1-2)

**Interview prompt:**
- Data sources: require sample data capture (fetch or user-paste)
- Add `sampleEntry` and `encoding` to dataSources schema
- Auth questions already removed (v3.1.0)

**Blueprint prompt:**
- Add data pipeline tracing step: source → storage → display for every field
- Blueprint must show reasoning: "View X needs field Y, source provides Z, component W transforms Z→Y"
- Add `produces`/`consumes` dependency declarations to each component

**Context propagation:**
- Thread interview spec (dataSources with samples) through `buildComponentPrompt()` to extension prompts

### Phase 2: API Contracts + Empty State (Principles 3-4)

**Extension prompt:**
- Separate ctx.fetch examples from ctx.memory examples (no confusable patterns)
- Show API contracts inline at point of use
- Code template in Output Format must demonstrate correct memory handling

**Cortex + App prompts:**
- Empty-state handling (done in v3.1.0)
- No cascading extension calls on empty data

### Phase 3: Design System (Principle 6)

**App prompt:**
- Add CSS custom property theming system (palette, spacing, radius, shadows)
- Add CDN library menu (Motion, Leaflet, Chart.js, Phaser, uiverse.io patterns)
- Add auth UI layout guidance (reserve space for `#auth-container`)

**Interview prompt:**
- Style section maps animation preference to specific libraries
- "References" field can include uiverse.io components the user likes

### Phase 4: Validation (Principle 5)

**Generator UI:**
- Post-generation regex scan for anti-patterns
- Block install for critical patterns, warn for suspicious ones

### Phase 5: Lifecycle Management (Principle 8)

**Generator service (generator.js):**
- `activateAll(projectId)` — loop registered extensions + cortexes, call activate endpoints
- `deactivateAll(projectId)` — loop registered, call deactivate endpoints
- `removeComponents(projectId, componentIds, includeMemory)` — selective deletion with checklist
- `getComponentStatuses(projectId)` — poll live status from extensions/cortex APIs

**Generator UI (generator-tab.js):**
- "Activate All" / "Deactivate All" / "Launch App" buttons on project dashboard
- Per-component status indicator (active/inactive/error)
- "Remove All" with checkbox selection (defaults: ext+cortex+app checked, csm+msm unchecked)

### Phase 6: Editing & Change Propagation (Principle 7)

**Blueprint prompt:**
- Add `produces`/`consumes` to component schema — blueprint AI must declare data flow
- Store dependency metadata with the project

**New prompt builders (generator-prompts.js):**
- `buildImpactPrompt(changeRequest, blueprint)` — "what's affected?" analysis prompt
- `buildEditPrompt(type, label, currentCode, changeRequest, upstreamChanges)` — targeted fix prompt

**Generator UI (generator-tab.js):**
- "Edit Service" button on project dashboard → opens change request text field
- Impact analysis view: shows which components are affected + why
- Per-component "Modify" action: includes current code + change request (not full regen)
- "Edit Spec" button: reopen interview spec for editing, re-analyze affected components
- Re-register must upsert (overwrite existing), not fail on duplicate

### Phase 7: Diagnostics (Principle 9)

**Generator UI:**
- Diagnostics panel: polls extension action statuses, shows errors with timestamps
- "Copy Diagnostics Report" — bundles errors + statuses into paste-ready format
- "Generate Fix Prompt" — combines diagnostics with component code for targeted fix

**App prompt template:**
- Error collector snippet (catches JS errors, unhandled rejections, failed API calls)
- Debug badge UI (shows error count, click to expand, "Copy for debugging" button)
- Unobtrusive — hidden when no errors

**Possibly new API:**
- Recent extension action logs endpoint (or extend existing status response)

---

## Already Completed (v3.1.0)

- Extension vs cortex vs app principle-based decision framework
- JSON.parse warning (ASCII box) — needs strengthening per Principle 3
- Translation locale key enforcement
- Empty-state handling in cortex and app prompts
- HTML entity warning in fix/retry prompt
- Reduced completed-component context bloat
- Auth question removed from interview (platform handles it)

---

## Success Criteria

The changes are general enough if they pass this test: **describe a completely different service** (e.g., a recipe manager pulling from a cooking API, a stock tracker pulling from a financial feed, a game built with Phaser) and the generator:

1. Captures a sample entry from the data source before generating parsers
2. Traces data from source→storage→display and identifies missing transformations
3. Generates code that correctly uses every API it calls (no type mismatches)
4. Every component works on first run with no data
5. Anti-patterns are caught before install
6. App uses consistent CSS custom properties, not hardcoded values
7. User can edit one component and see which others are affected
8. User can regenerate only affected components, not everything from scratch
9. User can activate, launch, deactivate, and remove the entire service from the generator dashboard
10. When the app fails, the user can copy a diagnostics report and generate a fix prompt without touching DevTools

If these hold for any domain, the generator is hardened. If they only work for emergency alert maps, we failed.
