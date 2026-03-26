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
│  MSM — external API contracts (if needed)          │
├──────────────────────────────────────────────────┤
│  SEED PHASE                                        │
│  Memory — default settings, seed data              │
│  Translation FI — all UI text in Finnish           │
│  Translation EN — same keys, English               │
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

**Data model** — JSON Schema for every memory key in the project. Single source of truth. Each entry has: type/properties (JSON Schema), source (static/external/computed/config), producedBy (one component), consumedBy (array of components).

**Cortex-modular architecture** — structures the service in layers:
1. Extensions at the bottom (external data, scheduling)
2. Data cortex (unifies extension data + AIMEAT platform data into single interface)
3. Feature cortex components (self-contained data+UI per use case)
4. App-domain cortex (composes all features + auth + translations)
5. App (thin shell)

**Extension vs cortex decision** — applies the rule: does this need the server (external API, cron, server-to-server)? If yes → extension. If no → cortex or app. Reading/writing AIMEAT memory, file uploads, board posts, wallet operations, data transformation, UI rendering → all cortex.

**Available libraries** — queries what cortex libraries are installed on the node (aimeat-charts, aimeat-ui-nav, etc.) and lists their APIs so components can reference them in `uses` fields.

**Phase ordering** — define → seed → capability → cortex (data first, then features, then app-domain) → app.

**Test scenarios** — per component, with concrete inputs, expected outputs, and type classification (memory vs external-api).

**Settings** — inherited from interview spec. Service-level (shared) and user-level (per-user) settings with types, labels, defaults.

---

## 4. What Each Component Does

### Extension — Platform Capability

Adds new capabilities to AIMEAT at the platform level. Runs server-side in a V8 sandbox.

**When needed:** External API calls, scheduled background jobs, heavy server-side processing, data that needs trusted execution.

**When NOT needed:** Reading/writing AIMEAT memory, uploading files, posting to boards, managing wallet — cortex can do all of these directly using AIMEAT platform libraries.

**What it knows:**
- External API URLs, response formats, sample data
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

### App — Thin UI Shell

The application the user sees. Focused on presentation, not logic.

**What it does:**
- Loads the app-domain cortex
- Sets up navigation (tabs/pages based on use cases)
- Calls cortex feature components to render into containers
- Handles responsive layout (mobile + desktop)
- Handles window resize, orientation changes
- Shows loading states, error states
- Runs the user through their use cases

**What it does NOT do:**
- Data fetching (cortex does this)
- Business logic (cortex does this)
- DOM component creation (feature cortex does this)
- Translation management (cortex does this)

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

## 6. What Each Prompt Needs

### CSM Prompt
- Project description
- Data model fields (raw source data only)
- Locale

### MSM Prompt
- External service name, URL, auth type
- Endpoints with methods
- Response formats

### Memory Prompt
- Data model keys this component produces
- Default values
- Locale

### Translation Prompt
- All use cases (to know what text is needed)
- All views (tab names, headers, buttons)
- Data model field names
- Common UI patterns
- Locale
- (EN must match FI keys exactly)

### Extension Prompt
- Data source URLs, response envelopes, sample entries
- Data model keys to write and their shapes
- Schedules
- Config keys
- V8 sandbox rules and ctx API
- Action IDs from blueprint

### Data Cortex Prompt
- Extension name (registeredAs)
- Extension actions and their inputs/outputs
- Extension memory keys and data shapes
- AIMEAT platform libraries available (data, storage, social, etc.)
- Which data methods to export

### Feature Cortex Prompt (per use case)
- Use case description (what the user wants to do)
- Data cortex API (methods available for data access)
- Platform UI cortex libraries available and their APIs
- AIMEAT platform libraries available
- Other installed cortex libraries
- Translation keys relevant to this feature
- What to render and how (from interview views)

### App-Domain Cortex Prompt
- All feature cortex components and their APIs
- Auth initialization pattern
- Translation loading pattern
- Settings management
- What to compose into the final API

### App Prompt
- Use cases (what the user wants to do — drives navigation and views)
- App-domain cortex API (method names and return shapes)
- Platform UI cortex libraries (for layout, if cortex doesn't handle all rendering)
- Style preferences (mood, layout, responsive requirements)
- Mobile + desktop requirements
- Test data (known company for verification)

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
