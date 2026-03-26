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

### Phase 0: Interview → Specification

**Requires:** User's description of what they want
**Produces:** Structured JSON specification
**Success:** All use cases captured, data sources verified with real sample data, views defined

### Phase 1: Specification → Blueprint

**Requires:** Interview spec + list of active cortex libraries on the node
**Produces:** Blueprint JSON with components, phases, structures, memoryKeys, actions, test scenarios
**Success:** Every view's data needs traced to a producer. Structures built from real sampleEntry data. All action inputs/outputs defined with $ref.

### Phase 2: DEFINE

#### 2a. CSM
**Requires from blueprint:** `structures` (raw source data fields only), service name
**Requires from interview:** `description`, `locale`
**Produces:** Registered CSM with data schema and service identity
**Success:** Validation passes, registered on node
**Tests:** None (CSM is declarative)

#### 2b. MSM (if external API needs auth)
**Requires from interview:** `dataSources[]` (URLs, auth type), `externalServices[]` (credentials)
**Produces:** Registered MSM with API contract
**Success:** Validation passes, registered on node
**Tests:** None (MSM is declarative)

### Phase 3: SEED

#### 3a. Memory
**Requires from blueprint:** `memoryKeys` entries where `producedBy` matches this component, with $ref to structures
**Requires from interview:** `userSettings[]` with defaults
**Produces:** Memory keys with initial values
**Success:** Validation passes, registered, keys readable via API
**Tests:** None (static seed data)

#### 3b. Translation FI
**Requires from interview:** `useCases[]`, `views[]` (to know what text is needed)
**Requires from blueprint:** `structures` property names (for field labels)
**Produces:** JSON with `"fi"` root key, flat dot-namespaced keys
**Success:** Validation passes, registered, 50+ keys covering all views and use cases
**Tests:** None (static content)

#### 3c. Translation EN
**Requires:** Same as FI, PLUS the registered FI component's actual key list
**Produces:** JSON with `"en"` root key, exact same keys as FI
**Success:** Validation passes, registered, key list matches FI 1:1
**Tests:** None (static content)

### Phase 4: CAPABILITY

#### 4a. Extension Test (generated FIRST, before extension code — test-first pattern)
**Requires from blueprint:** `actions` section with input/output $ref, `structures`
**Requires from interview:** `dataSources[].sampleEntry` (expected data shapes), test company/entity
**Produces:** Test code that defines what the extension must do — acts as a specification
**Why first:** The test is generated from the contract (blueprint), not from the implementation. This breaks the tautology — the test defines success before any code exists. The test also serves as source material for the extension generation prompt.

#### 4b. Extension
**Requires from blueprint:** `actions` section (ext:* entries with input/output $ref), `structures`, `memoryKeys` it produces, `schedules`
**Requires from interview:** `dataSources[]` (URLs, response envelopes, sample entries)
**Requires from MSM:** API contract (if paired)
**Requires from previous:** Registered CSM name, registered memory key names
**Requires from test:** The pre-generated test code (extension must pass this)
**Produces:** Registered and activated extension with all actions working
**Success flow:**
1. Validation passes (syntax/structure)
2. Contract verification passes (all blueprint action IDs exist in manifest)
3. **Explain step:** AI explains what the extension does, what it exports, what shapes it returns — compared against blueprint before proceeding
4. Registered
5. **Smoke test:** Can it activate without crashing? (5-second check)
6. Activated → @activate init runs
7. **Mandatory probe all actions** → golden samples captured
8. **Probe reconciliation:** Compare golden samples against interview `sampleEntry` — if shapes differ (API changed, stale sample), warn user and update structures
9. Run pre-generated test against the live extension
**Tests:** Server-side tests generated BEFORE the extension code, from blueprint `actions` definitions + structures. Zero implementation code in test prompt.

### Phase 5: CORTEX (layered — must be in order)

#### 5a. Data Cortex
**Requires from blueprint:** `actions` (cortex-data entries with $ref), `structures` it returns, `memoryKeys` it reads
**Requires from extension:** `registeredAs` name, probe golden samples (actual return data)
**Requires from node:** Available AIMEAT platform libraries (data, storage, social, wallet)
**Produces:** Registered cortex library exporting data access methods
**Success flow:**
1. Validation passes
2. Contract verification (all declared methods exist in exports)
3. **Explain step:** AI explains what methods it exports and what they return — compared against blueprint
4. Registered
5. **Smoke test:** Can it load in a browser script tag without JS errors?
6. **Mandatory probe** (load in browser, call each method, capture actual returns)
**Tests:** Browser tests from blueprint actions. Zero implementation code in test prompt. Integration test: data cortex calls extension action → response shape matches structure.

#### 5b. Feature Cortex (one per use case group)
**Requires from interview:** The specific `useCases[]` entry + matching `views[]` entry (type, interactions, description)
**Requires from data cortex:** Probe results (actual method names and return shapes)
**Requires from blueprint:** `structures` for data this feature handles, `uses` (platform UI cortex libraries)
**Requires from translations:** Registered translation keys relevant to this feature
**Requires from node:** Platform UI cortex library APIs with working code examples
**Produces:** Registered cortex library exporting `render(container)` function
**Success flow:**
1. Validation passes
2. Contract verification (render function exists, declared methods exist)
3. **Explain step**
4. Registered
5. **Smoke test:** Can it load without JS errors?
6. **Mandatory probe** (load in browser, call render(container), verify DOM elements created)
**Tests:** Browser tests from use case description. Zero implementation code in test prompt.

#### 5c. App-Domain Cortex
**Requires from feature cortex:** All registered feature cortex probe results (method names, render functions)
**Requires from blueprint:** App component's `consumes[]`
**Requires from node:** AIMEAT.auth pattern, other installed cortex libraries
**Produces:** Registered cortex library composing all features + auth + i18n
**Success flow:**
1. Validation passes
2. Contract verification
3. **Explain step**
4. Registered
5. **Smoke test**
6. **Mandatory probe** (verify init works, all feature renders accessible, translations load)
**Tests:** Browser tests verifying composition: auth initializes, translations load, each feature render() is callable.

### Phase 6: APP

#### 6a. App
**Requires from interview:** `useCases[]` (drives navigation), `views[]` (drives layout), `style` (mood, layout, responsive)
**Requires from app-domain cortex:** Probe results (actual API surface)
**Requires from translations:** App-level keys only (tab names, page titles)
**Produces:** Registered HTML app
**Success flow:**
1. Validation passes
2. Registered
3. **Smoke test:** Does it load without JS errors?
4. **Browser test** (navigate all views, complete all use cases, verify translations, verify responsive, verify no JS errors)
**Tests:** Browser user journey test covering every use case from the interview.

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

11. **Prompts define goals, not procedures.** Give the AI the scope (what component), the frame (what structures, what libraries are available), and the goal (what this component must achieve). Let the AI figure out the implementation details. Over-specifying with rigid rules produces worse results than a clear goal with room to move.

12. **Services can exist without extensions.** A personal notes app, a board-based discussion, a settings dashboard — these only need cortex + AIMEAT platform libraries. The blueprint should recognize when no external API is needed and skip the extension phase entirely.

---

## 8b. Additional Patterns

### Translation Interpolation

The `t()` function returns raw strings like `"Löytyi ${count} yritystä"`. Something must replace `${count}` with the actual value. The cortex or app needs an interpolation helper:

```javascript
function t(key, translations, vars) {
  var str = /* flat key lookup, then dot-path */;
  if (vars && typeof str === 'string') {
    Object.keys(vars).forEach(function(k) {
      str = str.replace('${' + k + '}', vars[k]);
    });
  }
  return str;
}

// Usage: t('search.results.count', translations, { count: 5 })
// → "Löytyi 5 yritystä"
```

This belongs in the cortex `t()` implementation. The translation prompt should document the `${variable}` convention and the cortex prompt should implement the interpolation.

### No-Extension Services

Some services use only AIMEAT internal capabilities:
- Personal notes → AIMEAT.data for storage, cortex for logic, app for UI
- Discussion forum → AIMEAT.social for boards, cortex for presentation
- File gallery → AIMEAT.storage for files, aimeat-ui-viewers for display
- Dashboard → AIMEAT.data for memory reads, aimeat-charts for visualization

For these, the blueprint produces no extension component. The data cortex uses AIMEAT platform libraries directly instead of wrapping extension actions. The pipeline skips Phase 4 (Capability) entirely.

The blueprint prompt already has the scope assignment logic for this — it checks whether any requirement needs external APIs or scheduling. If none do, no extension is created.

### Write Flows (User-Generated Content)

Services where users create data (not just read):
- User saves settings → cortex calls `AIMEAT.data.set('settings.config', {...})`
- User uploads a file → cortex calls `AIMEAT.storage.upload(file)`
- User posts to a board → cortex calls `AIMEAT.social.post(boardId, content)`
- User adds to watchlist → cortex calls extension action (because it needs to fetch external data for the snapshot)

The pattern: reads go through data cortex (which reads from extension memory or AIMEAT.data). Writes go through the appropriate layer — AIMEAT platform library for internal data, extension action for operations that need server-side execution.

### Template Packaging

After a service is working, it can be packaged as a template via the "Package as Template" button. This creates a reusable blueprint + component set that other users can install on their nodes. Templates include all component manifests, seed data, and translations — but not user-specific data or API keys.

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

### 9.2b Spec Quality Gate (automated, no AI needed)

After importing the specification, the generator automatically checks:
- Does every data source have a verified URL?
- Does every data source have a `sampleEntry` with actual data?
- Are there at least 2 use cases defined?
- Do views reference data entities that exist in the data model?
- Is a locale set?

If any check fails, the generator shows what's missing and asks the user to fix the interview spec before proceeding to blueprint.

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
  Read the source code of each aimeat-ui-* cortex library. Extract one complete working example per component (container creation, parameter shape, rendering, cleanup). Add these examples to the feature cortex prompt.
  Files: new `prompts-cortex-feature.js` or `generator-prompts-base.js`

- [ ] **10.4 Component prompts: inject $ref structures**
  Each component prompt should receive the relevant structures from the blueprint, not just raw JSON Schema. Extension prompt gets structures it produces. Cortex prompt gets structures it consumes and returns. App prompt gets structures it renders.
  Files: `generator-prompts-build.js`

- [ ] **10.5 Structured context bundles between steps** *(moved from P3)*
  After each successful registration + probe, create a structured summary:
  ```
  { name, type, registeredAs, exports: [...], probeResults: [...], memoryKeysWritten: [...] }
  ```
  Store in component state. Feed this bundle (not raw source code) into downstream prompts. This is the Lovable "context bundle" pattern — without it, downstream prompts reconstruct context from raw source code, which is the #1 cause of the planner-coder gap.
  Files: `generator-prompts-build.js`, `generator-detail.js`

- [ ] **10.6 Mandatory reflection before fix attempts** *(moved from P3)*
  When a component fails validation or testing, always run `buildReflectionPrompt()` first to get an explanation of what went wrong. Feed the reflection into the fix prompt. Research (LeDex) showed explain-then-fix improves repair quality by 15%+.
  Files: `generator-detail.js`

### Priority 2 — Prevents most integration failures

- [ ] **10.7 Contract verification after generation (Verify phase)**
  After validation but before registration: machine-compare the generated output against the blueprint contract.
  - Extension: parse YAML manifest, confirm all declared action IDs exist in JS files
  - Cortex: parse JS exports object, confirm all methods from blueprint `produces` exist
  - App: parse HTML, confirm cortex script tags are loaded
  Add as a step in the validator or as a new post-validation check.
  Files: `generator-validate.js`

- [ ] **10.8 Mandatory probes at every layer**
  After registration of extension AND each cortex: execute the component and capture real outputs.
  - Extension: probe each action with test inputs, capture golden samples (already exists, make mandatory)
  - Data cortex: load in browser test page, call each exported method, capture return values
  - Feature cortex: load in browser, call render(), capture DOM structure
  Package probe results as structured context bundle for the next component's prompt.
  Files: `generator-detail.js`, `generator-testing.js`, `generator-prompts-build.js`

- [ ] **10.9 Smoke test before full testing**
  After registration, before probe: can the component load without errors? Does it export what the blueprint says? 5-second check that catches 80% of failures.
  Files: `generator-testing.js` or new `generator-smoke.js`

- [ ] **10.10 Tests from blueprint contract, not from implementation (zero implementation code)**
  Update `buildTestPrompt()` to generate tests from: blueprint structures + actions + interview use cases + probe golden samples. **Hard rule: zero implementation code in test prompts.** The test designer sees only the contract and the golden samples. This breaks the tautology.
  Files: `generator-prompts-test.js`

- [ ] **10.11 Test-first for extensions**
  Generate extension test from blueprint BEFORE generating extension code. The test defines what the extension must do — it acts as a specification. The extension prompt then includes the pre-written test as a requirement the extension must pass. Research (TGen): +8-12% improvement.
  Files: `generator-prompts-test.js`, `generator-prompts-build.js`, `generator-detail.js`

- [ ] **10.12 Spec quality gate**
  After interview import, before blueprint: automated checks (no AI needed). Does every data source have a verified URL? A sampleEntry? Are there use cases? Do views reference existing entities? Reject specs that don't meet minimum quality.
  Files: `generator-detail.js` or `generator-validate.js`

- [ ] **10.13 Probe reconciliation (live data vs sampleEntry)**
  After extension probe: compare golden sample data shapes against interview `sampleEntry`. If they differ (API changed, stale sample, rate limited), warn the user and offer to update structures. Prevents silent contract violations from flowing downstream.
  Files: `generator-detail.js`, `generator-testing.js`

- [ ] **10.14 Explain step after generation**
  After generation, before validation: ask the AI to explain what the component does, what it exports, what shapes it returns. Compare explanation against blueprint contract. If they diverge, regenerate before even trying to validate. Catches semantic drift early. Different from reflection (which is after failure).
  Files: `generator-detail.js`, new prompt builder function

### Priority 3 — Improves quality

- [ ] **10.15 Prompt modularization**
  Split `generator-prompts-base.js` into per-component-type files: `prompts-extension.js`, `prompts-cortex-data.js`, `prompts-cortex-feature.js`, `prompts-cortex-app.js`, `prompts-app.js`, `prompts-translation.js`, etc. The current file is too large to maintain.
  Files: `generator-prompts-base.js` → multiple smaller files

- [ ] **10.16 Integration tests between layers**
  Add a new test type that tests component boundaries:
  - Data cortex calls extension action → verify response matches structure
  - Feature cortex calls data cortex method → verify data shape
  - App-domain cortex composes feature cortex → verify API surface
  Generate from blueprint's produces/consumes graph.
  Files: `generator-prompts-test.js`, `generator-testing.js`

- [ ] **10.17 Prompt size budgets**
  Set explicit token targets per prompt type: Interview ~2K, Blueprint ~4K, CSM/MSM/Memory ~2K, Translation ~3K, Extension ~8K, Data cortex ~6K, Feature cortex ~10K, App-domain cortex ~6K, App ~8K. When context exceeds budget, cut reference material first, keep goal and structures.

---

## 10b. Prompt Change List — Current → New (per component type)

Specific changes to each prompt compared to what exists today.

### Blueprint Prompt (`buildBlueprintPrompt` in `generator-prompts-build.js`)

| Change | Current | New |
|--------|---------|-----|
| Data model format | Flat `dataModel` with memory keys only | Three-part: `structures` (reusable types), `memoryKeys` ($ref to structures), `actions` (input/output with $ref) |
| Cortex components | Single `cortex-1` component | Three types: `cortex-data`, `cortex-feature-*`, `cortex-app` with sub-ordering |
| Action return shapes | Only `produces: ["api:methodName"]` — name only | `actions` section with input/output shapes referencing structures |
| Structure source | JSON Schema from field descriptions | Built from interview `sampleEntry` — real API response shapes |
| Available platform libs | Cortex libs listed with exports | Add core platform libs (aimeat-data, aimeat-storage, etc.) to available capabilities |

### CSM Prompt (`COMPONENT_TEMPLATES.csm` in `generator-prompts-base.js`)

| Change | Current | New |
|--------|---------|-----|
| Data model | Raw JSON Schema from blueprint | Structures from blueprint `structures` section (only raw source data fields) |
| No other changes | — | CSM prompt is simple and works well |

### MSM Prompt (`COMPONENT_TEMPLATES.msm` in `generator-prompts-base.js`)

| Change | Current | New |
|--------|---------|-----|
| Data source info | From interview `dataSources[]` | Same, plus link to extension that will consume this MSM |
| No major changes | — | MSM prompt is straightforward |

### Memory Prompt (`COMPONENT_TEMPLATES.memory` in `generator-prompts-base.js`)

| Change | Current | New |
|--------|---------|-----|
| Data model | Raw JSON Schema | Structures from blueprint via $ref |
| No major changes | — | Memory prompt works well |

### Translation Prompt (`COMPONENT_TEMPLATES.translation` in `generator-prompts-base.js`)

| Change | Current | New |
|--------|---------|-----|
| Use cases | Not included | ADD: interview `useCases[]` — so AI knows what UI text is needed |
| Views | Not included | ADD: interview `views[]` — tab names, section headers, buttons |
| EN key matching | Instruction only ("must match FI") | ADD: when generating EN, include actual FI key list from registered FI component |
| No other changes | — | — |

### Extension Prompt (`COMPONENT_TEMPLATES.extension` in `generator-prompts-base.js`)

| Change | Current | New |
|--------|---------|-----|
| Data model | Raw JSON Schema from blueprint | Structures via $ref — extension sees the exact types it must produce |
| Action definitions | Action IDs from blueprint produces | Action definitions from blueprint `actions` section with input/output $ref shapes |
| MSM reference | Not linked | ADD: if paired with MSM, include the registered MSM's API contract |
| ctx.caller | Fixed: uses `ctx.caller.gaii` | Same (already fixed this session) |
| Return values | Not specified — AI decides | ENFORCE: action return shapes from blueprint `actions` section |

### Data Cortex Prompt (NEW — does not exist yet)

| Item | Source |
|------|--------|
| Extension name | Extension component `registeredAs` |
| Extension actions with input/output | Blueprint `actions` section (ext:* entries with $ref) |
| Extension probe golden samples | Mandatory probe results after extension registration |
| AIMEAT platform libraries | Node `GET /v1/libs/` |
| Structures it returns | Blueprint `structures` relevant to this cortex |
| Methods to export | Blueprint cortex-data component `produces` |
| Template | New template — pure data access, no UI, wraps extension + AIMEAT.data |

### Feature Cortex Prompt (NEW — does not exist yet)

| Item | Source |
|------|--------|
| Use case | Interview `useCases[]` — the specific one this feature implements |
| View description | Interview `views[]` — matching view with type, interactions |
| Data cortex API | Data cortex probe results — actual method names and return shapes |
| Structures | Blueprint `structures` relevant to this feature |
| Platform UI cortex libraries | Blueprint `uses` field + working code examples |
| AIMEAT platform libraries | Node `GET /v1/libs/` |
| Translation keys | Registered translation component — keys relevant to this feature |
| Template | New template — data+UI module, exports render(container), like aimeat-charts |

### App-Domain Cortex Prompt (NEW — does not exist yet)

| Item | Source |
|------|--------|
| Feature cortex components | All registered feature cortex probe results — names, methods, render() functions |
| Auth pattern | Built-in template (AIMEAT.auth) |
| Translation loading | Built-in template |
| Settings | Data cortex methods for settings |
| Template | New template — composition layer, combines features + auth + i18n |

### App Prompt (`COMPONENT_TEMPLATES.app` in `generator-prompts-base.js`)

| Change | Current | New |
|--------|---------|-----|
| Use cases | Added this session but was missing | KEEP: interview `useCases[]` |
| Views | Added this session but was missing | KEEP: interview `views[]` with interactions |
| Style | Not injected | ADD: interview `style` (mood, layout, typography) |
| Cortex API | Parsed from cortex source code | CHANGE: from app-domain cortex probe results (actual exports) |
| Translation keys | Extracted from translation components | REDUCE: only app-level keys (navigation, page titles). Feature cortex handles its own translations |
| Platform UI libraries | Full API signatures injected | REDUCE: app delegates UI component usage to feature cortex. App only needs layout (responsive, mobile/desktop) |
| Nested object handling | displayValue() pattern added | REMOVE: app receives pre-processed data from cortex, not raw API objects |
| Prompt size | ~30K chars | TARGET: ~8-10K chars — use cases + views + cortex API + style + responsive rules |

### Test Prompts (`buildTestPrompt` in `generator-prompts-test.js`)

| Change | Current | New |
|--------|---------|-----|
| Input | Component source code + blueprint + probe results | CHANGE: blueprint structures + actions + golden samples. Remove component source code from test context |
| Extension test | Tests action return shapes | SAME but assertions come from blueprint `actions` output $ref, not from reading the code |
| Cortex test | Tests method existence and return values | ADD: data cortex integration test (does it call extension correctly?) |
| Feature cortex test | Not tested | ADD: render(container) produces expected DOM, uses correct translation keys |
| App test | Browser user journey | SAME but driven by interview use cases list |

### Fix Prompt (`buildFixPrompt` in `generator-prompts-fix.js`)

| Change | Current | New |
|--------|---------|-----|
| Contract mismatches | Not included | ADD: when contract verification fails, include specific mismatches (expected vs actual) |
| Structure $ref | Not included | ADD: show the expected structure definition alongside the error |
| No other major changes | — | Fix prompt logic is solid |

### Reflection Prompt (`buildReflectionPrompt` in `generator-prompts-fix.js`)

| Change | Current | New |
|--------|---------|-----|
| Usage | Optional, only after test failure | CHANGE: mandatory before any fix attempt |
| No other changes | — | Reflection prompt is well-designed |

---

## 11. Failure Handling — What Happens When Things Go Wrong

The happy path is: generate → validate → register → probe → test → next. But every step can fail. Here's what to do at each failure point.

### 11.1 Validation Fails

**What happened:** The generated code doesn't pass the validator (bad YAML, missing required fields, wrong structure, anti-patterns detected).

**What the user sees:** Error messages listing what's wrong.

**Remedy:**
1. The generator builds a **fix prompt** automatically — it includes the original prompt + the generated result + the validation errors
2. Click **"Copy Prompt"** — the fix prompt is now on clipboard
3. Paste into AI Chat — the AI sees what went wrong and produces a corrected version
4. Paste corrected result back → Validate again

**Scope:** Only this component. Nothing downstream is affected because nothing was registered yet.

**Max rounds:** 3 fix attempts. After 3 failures, the generator offers a **fresh generation prompt** — this discards all previous attempts and starts from scratch with a "KNOWN PITFALLS" section listing what went wrong. The AI gets a clean slate with lessons learned.

### 11.2 Contract Verification Fails

**What happened:** The component passed validation (valid syntax/structure) but doesn't match the blueprint contract. Example: blueprint says extension must have action `searchCompanies` but the generated YAML has `searchCompany` (singular).

**What the user sees:** Contract mismatch errors: "Blueprint declares action 'searchCompanies' but generated manifest has 'searchCompany'."

**Remedy:**
1. Same as validation failure — fix prompt includes the contract mismatches
2. The fix prompt specifically says: "The blueprint contract requires these exact names: searchCompanies, getCompany, ..." and shows what was generated vs what was expected
3. AI corrects the names/shapes → paste back → re-validate + re-verify contract

**Scope:** Only this component. The contract is from the blueprint which is unchanged.

### 11.3 Registration Fails

**What happened:** The component passed validation and contract check, but the AIMEAT node rejected it. Common causes: name conflict (409), invalid manifest format the validator didn't catch (400), quota exceeded (413).

**What the user sees:** Registration error from the API.

**Remedy by error type:**

| Error | Cause | Action |
|-------|-------|--------|
| 409 CONFLICT | Component with this name already exists | The generator auto-handles: deactivate → delete → re-register. If still fails, user must manually delete the old component via Extensions/Cortex tab |
| 400 BAD REQUEST | Manifest has issues the validator missed | Treat as validation failure — fix prompt with the API error message |
| 413 QUOTA EXCEEDED | Too many extensions/cortex installed | User must uninstall unused components first |
| 500 SERVER ERROR | Server bug | Check server logs, restart server, retry |

**Scope:** Only this component.

### 11.4 Activation Fails

**What happened:** Extension or cortex registered but activation failed. Usually means the init/@activate action crashed.

**What the user sees:** Activation error, possibly with a stack trace.

**Remedy:**
1. Check server logs for the actual error (usually a runtime crash in the V8 sandbox)
2. Common causes: `ctx.caller.gaii` not available, memory key doesn't exist yet, `JSON.parse` on already-parsed value, `URLSearchParams` used in V8 sandbox
3. Fix prompt includes the activation error + the component code
4. AI fixes the runtime error → paste back → re-validate → re-register → re-activate

**Scope:** Only this component. But if the init action was supposed to copy shared data (translations, settings) to the extension namespace, downstream components (cortex, app) will also fail until init works.

### 11.5 Probe Fails

**What happened:** Component is registered and active, but when probed with test inputs, an action returns an error or unexpected data.

**What the user sees:** Probe results showing which actions failed, with the error response or unexpected output.

**Remedy:**
1. Probe failure means the component's code has a runtime bug — it compiles but does the wrong thing
2. Fix prompt includes: the action that failed, the input that was sent, the response that came back, and what was expected (from blueprint's action definitions with $ref structures)
3. AI fixes the runtime bug → paste → re-validate → re-register → re-activate → re-probe

**Scope:** This component + all downstream components that depend on it. If extension probe fails, data cortex prompt will lack golden samples. If data cortex probe fails, feature cortex won't have verified method signatures.

**Important:** After a probe fix, all previously captured golden samples for this component must be refreshed. The generator should re-probe after re-registration.

### 11.6 Test Fails

**What happened:** Component is registered, activated, probed successfully, but the generated test code reports failures.

**What the user sees:** Test results with errors and a diagnostic trace.

**Two possible causes:**

**A) The component is broken** (test correctly found a bug):
1. The generator builds a **reflection prompt** — asks the AI to diagnose what went wrong without coding
2. Click "Copy reflection prompt" → paste into AI Chat → AI explains the root cause
3. The generator builds a **fix prompt** with: original prompt + component code + test errors + reflection diagnosis
4. AI produces fixed component → paste → re-validate → re-register → re-probe → re-test

**B) The test is broken** (component works, test has wrong expectations):
1. If the probe passed but the test fails, the test likely has wrong assertions
2. The generator can regenerate the test code using updated golden samples from the probe
3. Click "Copy test prompt" → AI generates new test → paste → run test

**How to tell A from B:** Compare probe results with test assertions. If the probe returned valid data but the test expected a different shape, the test is wrong. If the probe also returned unexpected data, the component is wrong.

**Scope for A:** This component + downstream re-probe + re-test. Same as probe failure.
**Scope for B:** Only the test code for this component. Nothing else changes.

### 11.7 Browser Test Fails (App)

**What happened:** All components registered and tested, but the app doesn't work in the browser. Missing tabs, broken search, [object Object], raw translation keys, JS errors.

**What the user sees:** A broken app. Console errors. Missing functionality.

**Diagnosis — trace the failure back to its source:**

| Symptom | Likely cause | Fix scope |
|---------|-------------|-----------|
| No data / null responses | Data cortex or extension broken | Re-probe extension, then data cortex |
| Wrong field names / [object Object] | Data shape mismatch — structure $ref not followed | Fix the component that returns wrong shape, re-register, re-probe downstream |
| Raw translation keys showing | Translation keys don't match what app/cortex uses | Compare translation component keys with cortex/app usage, fix translations or cortex |
| UI components don't render (Tabs, DataTable) | Platform UI library usage wrong | Fix the feature cortex or app that calls the library — need working examples |
| JS errors in console | Runtime bug in app or cortex | Read the error, identify which component, fix prompt for that component |
| Auth errors (401) | Server restarted, JWT expired | Re-login in the app — the auth library should handle this |

**Remedy:**
1. Identify which layer is broken (extension? data cortex? feature cortex? app?)
2. Go back to that component in the generator sidebar
3. Click it to see its current state
4. Use the fix prompt with the browser error as context
5. Re-register the fixed component
6. Re-probe if it's extension or cortex
7. Re-test
8. Re-check browser

**Scope:** The broken component + everything downstream. If you fix the data cortex, you may need to re-probe feature cortex components and re-register the app.

### 11.8 Cascade Failures — When Fixing One Component Breaks Another

**What happened:** You fixed extension's searchCompanies return shape, but now the data cortex that was built against the old shape breaks.

**This is the most common and most expensive failure mode.**

**Remedy:**
1. After fixing any component, re-probe it to get fresh golden samples
2. Check: do downstream components still reference the correct shapes? (Contract verification against updated probes)
3. If downstream components reference the old shape, they need regeneration:
   - Click the downstream component
   - Click "Refresh prompt" — the prompt rebuilds with the updated context from the fixed component
   - Click "Copy Prompt" → AI Chat → paste corrected version → validate → re-register → re-probe → re-test
4. Continue down the dependency chain until all components pass

**The dependency chain is always:** Extension → Data Cortex → Feature Cortex → App-Domain Cortex → App

A fix at the extension level can cascade through everything. A fix at the app level affects only the app.

**Prevention:** This is why structures + $ref and mandatory probes exist. If all components reference the same structure definition, and probes verify actual shapes match, cascade failures are caught early instead of at the app level.

### 11.9 Summary: Failure → Prompt → Paste → Scope

| Failure point | What prompt to copy | Where to paste the AI response | Scope of fix |
|---------------|--------------------|---------------------------------|-------------|
| Validation fails | Fix prompt (auto-generated) | Same component's Result textarea | This component only |
| Contract fails | Fix prompt with contract mismatches | Same component's Result textarea | This component only |
| Registration fails (409) | Auto-handled (deactivate+delete+retry) | — | This component only |
| Registration fails (400) | Fix prompt with API error | Same component's Result textarea | This component only |
| Probe fails | Fix prompt with probe error + expected shape | Same component's Result textarea → re-register | This component + re-probe downstream |
| Test fails (component bug) | Reflection prompt → then fix prompt | Same component's Result textarea → re-register | This component + re-probe + re-test downstream |
| Test fails (test bug) | Re-generated test prompt | Test code textarea → re-run test | Test code only |
| Browser test fails | Fix prompt for the broken layer | That layer's Result textarea → re-register | Broken layer + everything downstream |
| Cascade failure | Refresh prompt for downstream component | Downstream component's Result textarea → re-register | Each downstream component in dependency order |

### Excluded (cannot deliver now)

| Item | Why excluded |
|------|-------------|
| Episodic memory / learning from past runs | System doesn't learn between runs |
| Mutation testing | Requires new test infrastructure |
| Live preview between steps (WebContainer) | Requires browser runtime infrastructure |
| Dependency-aware rollback | UI doesn't support rolling back to earlier components |
| AutoFix post-processing | Requires streaming interception of AI output |

---

## 12. Fallback: Multi-Pass Skeleton Generation

> **Status: NOT APPROVED FOR IMPLEMENTATION.** This approach is only to be used if all Priority 1-3 improvements from Section 10 have been implemented, tested, and the pipeline still fails to produce working applications. Requires explicit approval before starting.

### The idea

Instead of generating a complete component in one AI pass (500+ lines), break it into multiple smaller passes:

1. **Pass 1 — Skeleton:** Generate the component structure: manifest, function stubs, exports, shared helpers. No implementation logic. This IS the contract — it defines signatures, return types, key names.

2. **Pass 2-N — Fill one section at a time:** For each stub function, generate just that function's implementation. The AI sees only the skeleton + the specific requirements for this one function.

3. **Validate after each pass:** After filling in each function, validate that it didn't break the skeleton. Run smoke test.

4. **Same for tests:** Generate test skeleton from blueprint, then fill in one test case at a time.

### Why it could work

- **Smaller context per pass** — less "lost in the middle", AI focuses on one thing
- **Each pass is independently verifiable** — if action 2 breaks, regenerate only action 2
- **The skeleton IS the contract** — constrains the AI, prevents signature drift
- **Partial success is possible** — 4/6 actions working beats 0/6 from full-component failure

### Why we try current approach first

- More round-trips per component (6 passes for extension vs 1)
- The current single-pass approach works when given clear structures + golden samples + good prompts
- The Priority 1-3 improvements (structures/$ref, context bundles, probes, contract verification) may be sufficient
- Multi-pass adds complexity to the generator UI and pipeline flow

### When to activate this fallback

Only after ALL of these are true:
1. All Priority 1 items (10.1-10.6) are implemented
2. All Priority 2 items (10.7-10.14) are implemented
3. A full pipeline run has been completed with all improvements
4. The pipeline still fails to produce a working application
5. The failures are traced to "AI generates wrong code despite correct prompt context" (not "prompt is missing information")
6. Explicit approval given to proceed
