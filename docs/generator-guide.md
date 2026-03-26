# AIMEAT Service Generator — Complete Guide

> This document describes how the AIMEAT service generator works, how it should work, what each component is, how they relate to each other, and how the whole system produces a working application from a user's description.

---

## 1. What AIMEAT Is

AIMEAT is an open protocol for AI agent infrastructure. A node running AIMEAT provides:

### Available Libraries (usable by any client-side code — cortex or app)

**Core platform libraries** (loaded via `<script src="/v1/libs/...">`)
| Library | Namespace | What it does |
|---------|-----------|-------------|
| aimeat-auth | AIMEAT.auth | Identity, session, login UI, JWT lifecycle, Ed25519 key management |
| aimeat-data | AIMEAT.data | Memory: get, set, delete, list, search, getPublic, update, micro-memory sets |
| aimeat-storage | AIMEAT.storage | File storage: upload, download, chunked upload, list, delete, drag & drop |
| aimeat-social | AIMEAT.social | Boards: createBoard, post, reply, react, subscribe, catalogue |
| aimeat-wallet | AIMEAT.wallet | Morsel economy: balance, transactions, request morsels, badge UI |
| aimeat-work | AIMEAT.work | Actions & work: catalogue, request, inbox, accept, deliver, rate |
| aimeat-tunnel | AIMEAT.tunnel | Personal node tunnel: WebSocket, heartbeat, mailbox sync |

**Pre-installed cortex libraries** (loaded via `<script src="/v1/cortex/...">`)
| Library | Namespace | What it does |
|---------|-----------|-------------|
| aimeat-ui-nav | AIMEAT['aimeat-ui-nav'] | Tabs, Breadcrumbs, Sidebar, BottomNav, BurgerMenu |
| aimeat-ui-layout | AIMEAT['aimeat-ui-layout'] | MainDetail, DashboardGrid, Split, Stacked, Header, Footer |
| aimeat-ui-viewers | AIMEAT['aimeat-ui-viewers'] | DataTable, Timeline, Grid, List, Gallery, Carousel |
| aimeat-ui-forms | AIMEAT['aimeat-ui-forms'] | Input, Select, Toggle, Checkbox, Radio, Textarea, FormGroup |
| aimeat-ui-dialogs | AIMEAT['aimeat-ui-dialogs'] | toast, Modal, Confirm, Alert, ContextMenu, Dropdown |
| aimeat-charts | AIMEAT.charts | ChartPanel, ChartBuilder (Chart.js wrapper) |
| aimeat-canvas | AIMEAT.canvas | DrawingCanvas (pen, shapes, text, export) |

All of these are available to both cortex libraries and apps. A cortex can use AIMEAT.data to read/write memory, AIMEAT.storage to upload files, AIMEAT.social to create board posts, and aimeat-ui-viewers to render a DataTable — all in the same library.

---

## 2. Terminology

| Term | What it is |
|------|-----------|
| **CSM** | Community Service Manifest. Defines a data schema for a namespace. Used to validate data when written. Gives the service its identity. |
| **MSM** | Micro Service Manifest. Defines an external API integration — authentication, endpoints, rate limits. |
| **Memory** | Seed data. Default settings, lookup tables, initial configuration stored in memory before anything runs. |
| **Translation** | User-visible text in a specific locale. Flat dot-namespaced keys. Both locales must have identical key structures. |
| **Extension** | Server-side V8 sandbox code. The only layer that can call external APIs and run scheduled background jobs. Adds new capabilities to the AIMEAT platform. |
| **Cortex** | Client-side JavaScript library. The brains of an application. Can do anything: data access, UI components, visualization, domain logic, composition of other cortex libraries and AIMEAT platform libraries. |
| **App** | The application the user interacts with. Thin UI focused on layout, responsiveness, and user journey. Uses cortex libraries for all logic, data, and components. |

---

## 3. How Components Relate

```
User Interview
    ↓
Blueprint
    ↓
(see Section 3b for full blueprint details)
    ↓
┌──────────────────────────────────────────────────┐
│  DEFINE PHASE                                      │
│  CSM — data schema + service identity              │
│  MSM — external API contracts (paired w/ extension)│
├──────────────────────────────────────────────────┤
│  SEED PHASE                                        │
│  Memory — default settings, seed data              │
│  Translation FI — all UI text in Finnish           │
│  Translation EN — same keys, English               │
│  (Storage — initial files/assets, if needed)       │
├──────────────────────────────────────────────────┤
│  CAPABILITY PHASE                                  │
│  Extension — external API calls, scheduling,       │
│              background processing                  │
├──────────────────────────────────────────────────┤
│  CORTEX PHASE (layered)                            │
│                                                    │
│  1. Data cortex (prh-data)                         │
│     - Wraps extension for external data            │
│     - Uses AIMEAT.data for internal data           │
│     - Provides data repository for all other       │
│       cortex components                            │
│     - Tested independently                         │
│                                                    │
│  2. Feature cortex components (prh-search,         │
│     prh-settings, prh-comparison, etc.)            │
│     - Each is a use case from the interview        │
│     - Uses data cortex for data access             │
│     - Uses platform UI cortex libs for rendering   │
│     - Uses AIMEAT platform libs as needed          │
│     - Includes both data handling AND UI rendering │
│     - Self-contained: exports render(container)    │
│     - Tested independently                         │
│                                                    │
│  3. App-domain cortex (prh-app-cortex)             │
│     - Composes all feature cortex components       │
│     - Adds auth, init, translations                │
│     - Adds any other installed cortex libs needed  │
│     - Single entry point for the app               │
│     - Tested independently                         │
│                                                    │
├──────────────────────────────────────────────────┤
│  APP PHASE                                         │
│  App — thin UI shell                               │
│     - Loads app-domain cortex                      │
│     - Wires up navigation (tabs/routes)            │
│     - Calls cortex to render each view             │
│     - Handles responsive layout                    │
│     - Handles mobile + desktop                     │
│     - Tested via browser (user journey)            │
└──────────────────────────────────────────────────┘
```

---

## 3b. Blueprint — What It Does

The blueprint translates user requirements into a technical architecture. It receives the interview spec + list of available cortex libraries on the node, and produces:

**Component list** — each with ID, type, label, produces, consumes. Every data need is matched by a producer.

**Data pipeline verification** — for each view in the interview, traces the data path: what fields the view needs → where each field comes from (external API, computed, user input) → which component produces it. If a field has no path from source to view, the blueprint adds a component to fill the gap.

**Data model** — the single source of truth for all data shapes in the project. Has three parts:

1. **Structures** — reusable data type definitions, defined once, referenced everywhere via `$ref`. Built from the interview's verified sample data (real API responses). Example:

```json
"structures": {
  "Company": {
    "type": "object",
    "properties": {
      "businessId": { "type": "object", "properties": { "value": { "type": "string" } } },
      "names": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string" }, "type": { "type": "string" } } } },
      "companyForm": { "type": "object" },
      "mainBusinessLine": { "type": "object" },
      "website": { "type": "object", "properties": { "url": { "type": "string" } } },
      "addresses": { "type": "array" },
      "registeredEntries": { "type": "array" },
      "status": { "type": "string" },
      "registrationDate": { "type": "string" },
      "lastModified": { "type": "string" }
    }
  },
  "WatchlistItem": {
    "type": "object",
    "properties": {
      "businessId": { "type": "string" },
      "companyName": { "type": "string" },
      "addedAt": { "type": "string" },
      "lastSnapshot": { "$ref": "Company" }
    }
  },
  "SearchResult": {
    "type": "object",
    "properties": {
      "totalResults": { "type": "number" },
      "companies": { "type": "array", "items": { "$ref": "Company" } }
    }
  }
}
```

2. **Memory keys** — what gets stored, referencing structures:

```json
"memoryKeys": {
  "watchlist.items": { "type": "array", "items": { "$ref": "WatchlistItem" }, "producedBy": "ext-1", "consumedBy": ["cortex-data"] },
  "companies.cache.BUSINESS_ID": { "$ref": "Company", "producedBy": "ext-1", "consumedBy": ["cortex-data"] },
  "settings.config": { "type": "object", "properties": { "defaultLanguage": { "type": "string" } }, "producedBy": "memory-1", "consumedBy": ["ext-1", "cortex-data"] }
}
```

3. **Actions** — what extension and cortex methods accept and return, referencing the same structures:

```json
"actions": {
  "ext:searchCompanies": { "input": { "query": "string" }, "output": { "$ref": "SearchResult" } },
  "ext:getCompany": { "input": { "businessId": "string" }, "output": { "$ref": "Company" } },
  "ext:addToWatchlist": { "input": { "businessId": "string", "companyName": "string" }, "output": { "status": "string" } },
  "cortex:searchCompanies": { "input": { "query": "string" }, "output": { "$ref": "SearchResult" } },
  "cortex:getCompany": { "input": { "businessId": "string" }, "output": { "$ref": "Company" } }
}
```

**Why `$ref`:** `Company` is defined once from the real PRH API sample entry. Every component that touches company data — extension stores it, cortex passes it, app renders it — references the same definition. No drift. If `businessId` is `{value: "3323553-5"}` in the structure, every component knows it's an object with a `.value` field, not a plain string.

**Cortex-modular architecture** — structures the service in layers:
1. Extensions at the bottom (external data, scheduling)
2. Data cortex (unifies extension data + AIMEAT platform data into single interface)
3. Feature cortex components (self-contained data+UI per use case)
4. App-domain cortex (composes all features + auth + translations)
5. App (thin shell)

**Scope assignment** — decides which layer handles each requirement:
- Extension scope: external API calls, scheduled background jobs, server-to-server communication, trusted server-side execution
- Cortex scope: data access via AIMEAT platform libraries (memory, storage, social, wallet), business logic, data transformation, UI component rendering, composition of other cortex libraries
- App scope: layout, navigation, responsiveness, user journey, presentation

**Available libraries** — queries what cortex libraries are installed on the node (aimeat-charts, aimeat-ui-nav, etc.) and lists their APIs so components can reference them in `uses` fields.

**Phase ordering** — define → seed → capability → cortex (data first, then features, then app-domain) → app.

**Test scenarios** — per component, with concrete inputs, expected outputs, and type classification (memory vs external-api).

**Settings** — inherited from interview spec. Service-level (shared) and user-level (per-user) settings with types, labels, defaults.

---

## 4. What Each Component Does

### Extension — Platform Capability

Adds new capabilities to AIMEAT at the platform level. Runs server-side in a V8 sandbox. Paired with MSM when the external API requires authentication or complex configuration.

**Scope:** External API calls, scheduled background jobs, heavy server-side processing, data that needs trusted server-side execution, server-to-server communication.

**What it knows:**
- MSM contract (if paired — API URLs, auth, endpoints)
- External API response formats, sample data
- Memory keys to write and their data shapes
- Schedules (cron expressions, @activate)
- V8 sandbox constraints
- ctx API (memory, fetch, wallet, consent, trust, caller, config, log, notify)
- ctx.caller.gaii for reading owner namespace

### Cortex — Application Brains

Client-side JavaScript library. This is where the intelligence of the application lives.

**Three levels:**

**Data cortex** — the data repository layer
- Wraps extension actions for external data
- Uses AIMEAT.data directly for internal data (memory, public reads)
- Uses AIMEAT.storage for file operations
- Uses AIMEAT.social for board interactions
- Provides clean data methods for all other cortex components
- Has no UI — pure data access

**Feature cortex** — use-case-specific modules (data + UI)
- Each one implements a specific use case from the interview
- Uses data cortex for data access
- Uses platform UI cortex libraries (Tabs, DataTable, Timeline, Forms, etc.) for rendering
- Creates DOM elements, injects CSS, handles events
- Self-contained: exports a `render(container)` function (like aimeat-charts exports `ChartPanel`)
- Handles its own translations
- Can use any AIMEAT platform library

**App-domain cortex** — the composition layer
- Composes all feature cortex components into one API
- Adds auth initialization
- Adds translation loading
- Adds settings management
- Entry point for the app

### App — The Application

The application the user interacts with. It can have logic, state, and complex interactions. It uses cortex libraries and AIMEAT platform libraries to deliver the user's use cases.

**Scope:**
- Loads the app-domain cortex and any additional libraries needed
- Sets up navigation (tabs/pages based on use cases)
- Calls cortex feature components to render into containers
- Handles responsive layout (mobile + desktop)
- Handles window resize, orientation changes
- Shows loading states, error states
- Runs the user through their use cases
- Focuses on presentation, responsiveness, and user experience
- Delegates data access and business logic to cortex
- Delegates UI component rendering to feature cortex and platform UI cortex libraries

---

## 5. The Generator Pipeline

### Step 1: Interview

The user describes what they want. The AI interviews them to produce a structured specification:
- Use cases (what the user wants to do)
- Data sources (external APIs with verified URLs and sample data)
- Views (how the user wants to see the data)
- Style preferences
- Settings and constraints

### Step 2: Blueprint

The specification is translated into a technical plan:
- Which components to build (CSM, Memory, Translations, Extension, Cortex components, App)
- Dependencies between components (produces/consumes)
- Which AIMEAT platform libraries are available on this node
- Which platform cortex libraries each component should use
- Data model with exact memory key schemas
- Test scenarios
- Generation order (respects dependencies)

The blueprint defines **multiple cortex components**:
1. Data cortex (always first)
2. Feature cortex components (one per use case or feature group)
3. App-domain cortex (always last)

### Step 3: Generate → Validate → Register → Test (per component)

For each component in order:

1. **Generate prompt** — the generator builds a prompt with everything that component needs to know
2. **Copy prompt** — the user copies it to their AI Chat (or subagent)
3. **Paste response** — the user pastes the AI's response back
4. **Validate** — the generator's validator checks the response for correctness
5. **Register** — the component is installed on the node
6. **Activate** (extension/cortex) — the component becomes live
7. **Test** — the generator's test prompt generates test code, which is executed
8. **Reflect** — if tests fail, the generator produces a diagnosis and fix prompt

Each component is tested immediately after registration. The pipeline does not move to the next component until the current one passes.

### Step 4: Browser Test (App)

After all components are registered, the app is tested in a browser:
- Navigate to each view
- Complete each use case (search, add to watchlist, etc.)
- Verify translations display correctly
- Verify responsive behavior

---

## 6. What Each Prompt Needs (and Where It Comes From)

### CSM Prompt
| Need | Source |
|------|--------|
| Project description | Interview spec → `description` |
| Data model fields (raw source data only) | Blueprint → `dataModel` (entries with `source: "external"` or `source: "static"`) |
| Locale | Interview spec → `locale` |

### MSM Prompt
| Need | Source |
|------|--------|
| External service name, URL | Interview spec → `dataSources[]` (verified URLs) |
| Auth type and credentials | Interview spec → `externalServices[]` |
| Endpoints with methods | Interview spec → `dataSources[].sampleEntry`, `responseEnvelope` |
| Response formats | Interview spec → `dataSources[].format`, `encoding` |

### Memory Prompt
| Need | Source |
|------|--------|
| Data model keys this component produces | Blueprint → `dataModel` (entries where `producedBy` matches this component) |
| Default values | Interview spec → `userSettings[]` with defaults |
| Locale | Interview spec → `locale` |

### Translation Prompt
| Need | Source |
|------|--------|
| All use cases | Interview spec → `useCases[]` |
| All views (tab names, headers, buttons) | Interview spec → `views[]` |
| Data model field names | Blueprint → `dataModel` property names |
| Common UI patterns | Built-in template (loading, error, empty states, buttons) |
| Locale | Interview spec → `locale` / component label indicates which locale |
| EN must match FI keys exactly | FI translation component result (when generating EN) |

### Extension Prompt
| Need | Source |
|------|--------|
| Data source URLs, response envelopes, sample entries | Interview spec → `dataSources[]` |
| Data model keys to write and their shapes | Blueprint → `dataModel` (entries where `producedBy` matches this component) |
| Schedules | Blueprint → component's `schedules[]` |
| Config keys | Blueprint → `settings.user[]` and `settings.service[]` |
| V8 sandbox rules and ctx API | Built-in template (static reference material) |
| Action IDs | Blueprint → component's `produces[]` and test scenarios |
| MSM contract (if paired) | Registered MSM component result (API endpoints, auth) |
| Already completed components | Previous components' `registeredAs` names |

### Data Cortex Prompt
| Need | Source |
|------|--------|
| Extension name (registeredAs) | Extension component's registration result |
| Extension actions and inputs/outputs | Extension component result (parsed from YAML manifest) |
| Extension memory keys and data shapes | Blueprint → `dataModel` + extension probe results (golden samples) |
| AIMEAT platform libraries available | Node → `GET /v1/libs/` (always available) |
| Which data methods to export | Blueprint → cortex component's `produces[]` |

### Feature Cortex Prompt (per use case)
| Need | Source |
|------|--------|
| Use case description | Interview spec → `useCases[]` (the specific use case this feature implements) |
| Data cortex API | Data cortex component result (parsed exports) |
| Platform UI cortex libraries and their APIs | Node → `GET /v1/cortex?status=active` + blueprint `uses` field |
| AIMEAT platform libraries available | Node → `GET /v1/libs/` |
| Other installed cortex libraries | Node → `GET /v1/cortex?status=active` |
| Translation keys relevant to this feature | Registered translation component results (extracted keys) |
| What to render and how | Interview spec → `views[]` (the view matching this use case) |

### App-Domain Cortex Prompt
| Need | Source |
|------|--------|
| All feature cortex components and their APIs | Previously registered feature cortex component results (parsed exports) |
| Auth initialization pattern | Built-in template (AIMEAT.auth standard pattern) |
| Translation loading pattern | Built-in template (readExtMemory for i18n) |
| Settings management | Blueprint → `settings` + data cortex methods |
| What to compose into the final API | Blueprint → app component's `consumes[]` |

### App Prompt
| Need | Source |
|------|--------|
| Use cases | Interview spec → `useCases[]` |
| Views with layout and interactions | Interview spec → `views[]` |
| Style preferences | Interview spec → `style` (mood, layout, typography) |
| App-domain cortex API | App-domain cortex component result (parsed exports with @returns shapes) |
| Platform UI cortex libraries | Node → active cortex list + blueprint `uses` |
| Translation keys (app-level only) | Registered translation component results |
| Mobile + desktop requirements | Interview spec → `style.displayContext` |
| Test data | Interview spec → `dataSources[].sampleEntry` (known test entity) |

---

## 7. Testing Strategy

### Extension Tests (server-side)
- Use `callExt()` and `readExtMemory()` helpers
- Test each action with known inputs
- MEMORY actions: assert specific return values
- EXTERNAL API actions: assert response shape (graceful error = pass)
- Verify init copies shared data to extension namespace
- Return `{ passed, errors, details }`

### Cortex Tests (browser)
- Test each level independently
- Data cortex: verify data methods return correct shapes
- Feature cortex: verify render(container) creates expected DOM elements
- App-domain cortex: verify composition works, auth initializes, translations load
- Set `window.__testResults`

### App Tests (browser, user journey)
- Navigate each view (tab)
- Complete each use case end-to-end
- Search with known test data
- Verify translations display (no raw keys)
- Verify responsive layout
- Verify no JS errors in console

---

## 8. Key Design Principles

1. **Extension = platform capability.** It exists for external APIs and scheduling. Everything internal to AIMEAT can be done by cortex + platform libraries.

2. **Cortex = application brains.** It's not just a data bridge. It can render UI (like aimeat-charts), manage state, compose other cortex libraries, use all AIMEAT platform libraries directly.

3. **App = thin shell.** Layout, navigation, responsiveness. All logic and data lives in cortex.

4. **Cortex is layered.** Data cortex → Feature cortex (data+UI per use case) → App-domain cortex. Each layer tested independently.

5. **Use cases drive everything.** Interview → use cases → views → cortex components → app views. If a use case isn't in the interview, it doesn't get built.

6. **Platform libraries are first-class.** AIMEAT.data, AIMEAT.storage, AIMEAT.social, AIMEAT.wallet — these are capabilities that cortex uses directly, not things hidden behind extensions.

7. **Composition over reimplementation.** If aimeat-charts can render a chart, use it. If aimeat-ui-viewers has DataTable, use it. Never rebuild what exists.

8. **Test immediately.** Each component is tested right after registration. The pipeline doesn't proceed until tests pass.

9. **Prompts carry only what's needed.** Extension prompt knows about V8 sandbox and external APIs. App prompt knows about use cases and cortex API. No component sees information that belongs to another layer.

10. **The interview spec is the source of truth.** Use cases, views, style, data sources — everything traces back to what the user said they wanted.

---

## 9. User Journey — Step by Step

What the user does from clicking "+ New Project" to having a working, tested application. No "Run with AI" — manual copy-paste workflow.

### 9.1 Create Project

1. Click **"+ New Project"** in the Generator tab
2. Type a description of what you want to build
3. Click **"Analyze"**

### 9.2 Interview

1. The generator shows the **interview prompt** and a **"Copy Prompt"** button
2. Click **"Copy Prompt"** — the interview prompt is copied to clipboard
3. Open your AI Chat (Claude, ChatGPT, Gemini — any AI)
4. Paste the prompt into the AI Chat
5. The AI interviews you — asks about use cases, data sources, views, style, settings
6. Answer the questions until the AI produces a **JSON specification**
7. Copy the AI's final JSON response
8. Back in the generator, paste it into the **"Step 2: Paste the JSON Specification"** textarea
9. Click **"Import Specification"**

### 9.3 Blueprint

1. The generator shows the **blueprint prompt** and a **"Copy Prompt"** button
2. Click **"Copy Prompt"**
3. Paste into your AI Chat
4. The AI analyzes the specification and produces a **JSON blueprint** (components, phases, data model, test scenarios)
5. Copy the AI's response
6. Paste into the **"Blueprint JSON"** textarea
7. Click **"Import Blueprint"**

### 9.4 Settings

1. The generator shows any service settings that need initial values (from the interview)
2. Review the defaults, adjust if needed
3. Click **"Save and continue"**

### 9.5 Component Generation (repeat for each component)

The generator shows all components in the sidebar, organized by phase. The first component's prompt is already visible.

**For each component (CSM, MSM, Memory, Translations, Extension, Cortex components, App):**

1. The component's **prompt** is shown in the Prompt section
2. Click **"Copy Prompt"**
3. Paste into your AI Chat
4. The AI generates the component (YAML, JSON, JS, or HTML depending on type)
5. Copy the AI's response
6. Paste into the **"Result"** textarea
7. Click **"Validate"**
   - If **validation passes**: a green checkmark appears and the **"Register"** button becomes active
   - If **validation fails**: errors are shown. Click **"Copy Prompt"** again — the prompt now includes the errors as a fix prompt. Paste into AI Chat, get a corrected response, paste back, validate again. (Max 3 rounds before fresh regeneration.)
8. Click **"Register"** — the component is installed on the node
9. The generator auto-advances to the next component

**For Extension — after registration:**

10. The extension is activated automatically
11. The **@activate** init job runs (copies shared data, initializes memory)

**For each component with tests (Extension, Cortex, App):**

12. After registration, a **"Copy test prompt"** button appears in the Test section
13. Click **"Copy test prompt"**
14. Paste into your AI Chat
15. The AI generates test code
16. Copy the test code
17. Paste into the **test code textarea**
18. Click **"Run Test"**
    - If **test passes**: green checkmark, proceed to next component
    - If **test fails**: errors and diagnostic trace are shown. The generator may show a **reflection prompt** — copy it, paste into AI Chat for diagnosis. Then use the fix prompt to correct the component or the test. Re-register if the component changed, re-run test.
19. The generator auto-advances to the next component

### 9.6 Extension Probing (between registration and testing)

1. After the extension is registered and activated, the generator can **probe** each action
2. Click **"Probe"** (if available) — this calls each extension action with test inputs from the blueprint
3. The probe captures **golden samples** — real API responses with exact data shapes
4. These golden samples are fed into the **test prompt** and **cortex prompt** so downstream components know the exact data they'll receive

### 9.7 Final Browser Test (App)

1. After all components are registered and tested, click **"Launch App"**
2. The app opens in a new tab
3. Walk through each use case from the interview:
   - Search for the test company
   - View company details
   - Add to watchlist
   - Check change history
   - Compare companies
   - Change settings
   - Switch language
4. Verify:
   - All tabs/views are present
   - Translations display correctly (no raw keys)
   - Data loads and renders
   - Responsive layout works (resize the window)
   - No JavaScript errors in console

### 9.8 Done

The service is live. All components registered, tested, and working. The user can share the app URL or find it in the app catalog.

---

## 10. Implementation Todo (before next pipeline run)

Prioritized list of changes needed to make the generator work. Only items we can code and deploy — no theoretical improvements.

### Priority 1 — Blocks working applications

- [ ] **10.1 Blueprint: structures + $ref + action shapes**
  Update `buildBlueprintPrompt()` to produce the new data model format with `structures`, `memoryKeys`, and `actions` sections. Structures are built from interview spec's `sampleEntry` data. Actions define input/output with `$ref` to structures. All component prompts reference the same structure definitions.
  Files: `generator-prompts-build.js`

- [ ] **10.2 Blueprint: multi-cortex architecture**
  Update `buildBlueprintPrompt()` to produce multiple cortex components: data cortex (always), feature cortex (per use case group), app-domain cortex (always). Update phase ordering. Update `generator-validate.js` to accept multiple cortex components.
  Files: `generator-prompts-build.js`, `generator-validate.js`

- [ ] **10.3 Platform UI component working examples**
  Read the source code of each aimeat-ui-* cortex library. Extract one complete working example per component (container creation, parameter shape, rendering, cleanup). Add these examples to the feature cortex prompt and app prompt.
  Files: `generator-prompts-base.js` (cortex template, app template)

- [ ] **10.4 Component prompts: inject $ref structures**
  Each component prompt should receive the relevant structures from the blueprint, not just raw JSON Schema. Extension prompt gets structures it produces. Cortex prompt gets structures it consumes and returns. App prompt gets structures it renders.
  Files: `generator-prompts-build.js`

### Priority 2 — Prevents most integration failures

- [ ] **10.5 Contract verification after generation (Verify phase)**
  After validation but before registration: machine-compare the generated output against the blueprint contract.
  - Extension: parse YAML manifest, confirm all declared action IDs exist in JS files
  - Cortex: parse JS exports object, confirm all methods from blueprint `produces` exist
  - App: parse HTML, confirm cortex script tags are loaded
  Add as a step in the validator or as a new post-validation check.
  Files: `generator-validate.js`

- [ ] **10.6 Mandatory probes at every layer**
  After registration of extension AND each cortex: execute the component and capture real outputs.
  - Extension: probe each action with test inputs, capture golden samples (already exists, make mandatory)
  - Data cortex: load in browser test page, call each exported method, capture return values
  - Feature cortex: load in browser, call render(), capture DOM structure
  Package probe results as structured context bundle for the next component's prompt.
  Files: `generator-detail.js`, `generator-testing.js`, `generator-prompts-build.js`

- [ ] **10.7 Smoke test before full testing**
  After registration, before running the full test suite: can the component load without errors? Does it export what the blueprint says? Quick check that catches 80% of failures in seconds.
  Files: `generator-testing.js` or new `generator-smoke.js`

- [ ] **10.8 Tests from blueprint contract, not from implementation**
  Update `buildTestPrompt()` to generate tests from: blueprint data model (structures + actions) + interview use cases + probe golden samples. Remove or reduce the injection of the component's own source code into the test prompt. The test designer should verify the contract, not transcribe the implementation.
  Files: `generator-prompts-test.js`

### Priority 3 — Improves quality

- [ ] **10.9 Mandatory reflection before fix attempts**
  When a component fails validation or testing, always run `buildReflectionPrompt()` first to get an explanation of what went wrong. Feed the reflection into the fix prompt. Currently exists but is optional/underused.
  Files: `generator-detail.js`

- [ ] **10.10 Structured context bundles between steps**
  After each successful registration + probe, create a structured summary:
  ```
  { name, type, registeredAs, exports: [...], probeResults: [...], memoryKeysWritten: [...] }
  ```
  Store in component state. Feed this bundle (not raw source code) into downstream prompts. More reliable than parsing exports from source.
  Files: `generator-prompts-build.js`, `generator-detail.js`

- [ ] **10.11 Prompt modularization**
  Split `generator-prompts-base.js` into per-component-type files: `prompts-extension.js`, `prompts-cortex.js`, `prompts-app.js`, `prompts-translation.js`, etc. The current file is too large to maintain.
  Files: `generator-prompts-base.js` → multiple smaller files

- [ ] **10.12 Integration tests between layers**
  Add a new test type that tests component boundaries:
  - Data cortex calls extension action → verify response matches structure
  - Feature cortex calls data cortex method → verify data shape
  - App-domain cortex composes feature cortex → verify API surface
  Generate from blueprint's produces/consumes graph.
  Files: `generator-prompts-test.js`, `generator-testing.js`

### Excluded (cannot deliver now)

| Item | Why excluded |
|------|-------------|
| Episodic memory / learning from past runs | System doesn't learn between runs |
| Mutation testing | Requires new test infrastructure |
| Live preview between steps (WebContainer) | Requires browser runtime infrastructure |
| Dependency-aware rollback | UI doesn't support rolling back to earlier components |
| AutoFix post-processing | Requires streaming interception of AI output |
