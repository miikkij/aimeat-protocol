# The Prompt-Driven Workflow — Step by Step

> **Audience:** an AI coding agent (and advanced human devs) building a complete AIMEAT application autonomously through the generator's prompt-driven pipeline.
> **This doc covers:** the exact phase-by-phase pipeline mapped to the real `/v1/generator/*` REST API — what you do, which endpoint you call, the request/response shape, what success looks like, and how to recover from every failure mode.
> **Read next:** [02-prompts-in-order.md](./02-prompts-in-order.md) (which prompt at which step, and where each is sourced), then the spec-format docs ([03](./03-spec-define-seed.md), [04](./04-spec-extension.md), [05](./05-spec-cortex-app.md)) and the [activation/registration reference](./06-activation-registration-reference.md).

---

## 0. Two paths, one supported

The generator has **two** ways to drive the pipeline:

| Path | Who plays the AI | Status |
|------|------------------|--------|
| **Prompt-driven** (manual copy-paste in the UI; agent-replicated via REST) | A human's AI chat, OR an agent acting as both the operator and the chat | **Supported — this is the path.** |
| **LLM autopilot** (`/v1/generator/:projectId/autopilot/*`, server calls OpenRouter) | The server's OpenRouter key | **Incomplete — do not use.** Known Phase 4/5 bugs (wrong test prompt for component/app-domain cortex, app never tested). See `CLAUDE.md` → "Generator Pipeline — Known Phase 4/5 Bugs". |

This document describes the **prompt-driven path only**, expressed as REST calls an agent makes directly. The agent plays **both roles**: it conducts the interview the generator's interview prompt asks for, it produces the JSON spec / blueprint / per-component artifact in its own context, and it submits each result back through the generator API.

> **Critical distinction — agent path vs browser path.** The browser UI validates client-side (`public/js/services/generator-validate.js`) and registers by calling the catalogue APIs directly (`/v1/extensions`, `/v1/cortex`, `/v1/apps`, `/v1/memory`) via `registerComponent()` in `public/js/services/generator.js`. The **agent path** uses the generator's own `/submit` (server-side validation) and `/register` (server-side registration) endpoints, which do the same work behind one auth-scoped call. **Use the agent path** — it is the single source of truth for validation and the only path documented here. Source: `aimeat/src/routes/generator.ts`.

---

## 1. Auth, scopes, and identity

Every generator route requires `requireAuth()` and `requireRole('agent')` **or** `requireRole('owner')`. An owner JWT satisfies the agent role check (role hierarchy in `src/auth/middleware.ts`), so a human-owner session can call all of these too. The scopes enforced per route (for true agent sessions) are:

| Scope | Routes |
|-------|--------|
| `generator:read` | list/get project, get prompts |
| `generator:write` | create project, interview, settings, blueprint, component submit, delete |
| `generator:execute` | component register, log, complete |
| *(owner role, no scope)* | settings POST/GET, test, probe-extension, apply-settings, reset, debug, test-page |

**Identity:** all generator data is stored under the **owner's GHII** (`owner@nodeId`), regardless of whether an agent or the owner makes the call. The route computes this internally:

```ts
const ownerGhii = (req) => `${req.auth!.owner}@${config.nodeId}`;
```

So an agent (`claude#alice@node`) and the owner (`alice`) operate on the **same** `generator.{projectId}.*` memory keys. You never pass identity explicitly.

**Envelope:** every response is the standard AIMEAT envelope. Success bodies are under `data`; errors carry `error.code` + `error.message`. (`src/middleware/envelope.ts`.)

---

## 2. The pipeline at a glance

```
Create project
  └─> Interview  (get prompt → run it → import the JSON spec)
        └─> Spec-quality gate  (client-side check before blueprint)
              └─> Blueprint  (get prompt → run it → import the JSON blueprint;
              │                this seeds one component record per blueprint component)
              └─> Settings   (collect initial config values from the spec)
                    └─> PER-COMPONENT LOOP  (blueprint phase order)
                    │     ├─ get prompt        GET  …/prompts/:componentId[?type=spec|code|test]
                    │     ├─ run prompt in chat (produce the artifact)
                    │     ├─ submit/validate    POST …/components/:componentId/submit
                    │     ├─ register           POST …/components/:componentId/register
                    │     ├─ (ext) apply-settings + activate + PROBE
                    │     └─ test               POST …/test/:componentId
                    └─> Final app browser test  (drive the registered app in a browser)
                          └─> Complete           POST …/:projectId/complete
```

The **blueprint defines the component list and their order** (`blueprint.components[]` with `id`, `type`, `label`, and for cortex a `subtype`). Phases run define/seed components first (csm, msm, memory, translation), then capability (extension), then cortex (data → component/feature → app-domain), then app. See [02-prompts-in-order.md](./02-prompts-in-order.md) for the exact ordering rationale.

---

## 3. Phase: Create project

**(a) What you do:** invent a project name and a one-paragraph description of what you're building. The description is later threaded into the interview and blueprint prompts.

**(b) Endpoint:**
```
POST /v1/generator/projects        (scope: generator:write)
```

**(c) Request:**
```json
{ "name": "PRH Company Watch", "description": "Search Finnish companies, watch them, see changes." }
```
`name` is required (string). `description` optional.

**(d) Response (201):**
```json
{ "data": { "projectId": "gen-1719500000000-a1b2c3",
            "project": { "projectId": "...", "name": "...", "description": "...",
                         "status": "draft", "blueprint": null,
                         "createdAt": "...", "updatedAt": "..." } } }
```
Capture `projectId` — every subsequent call needs it.

**(e) Success:** HTTP 201 with a `projectId`.

**(f) Failure:** `400 INVALID_BODY` if `name` is missing/not a string. Fix the body and retry.

> **List / inspect:** `GET /v1/generator/projects` (returns `{ data: { projects: [...] } }`, owner-scoped) and `GET /v1/generator/:projectId` (returns `{ data: { project, interviewSpec, components, session } }`). Use the single-project GET at any time to read the current state of every component record.

---

## 4. Phase: Interview

**(a) What you do:**
1. Fetch the interview prompt.
2. **Run it yourself** — as the agent, conduct the interview the prompt describes (use cases, data sources with verified URLs + a real `sampleEntry`, views, style, settings, locale) and produce the **JSON specification** the prompt asks for. Because you are the AI, you "answer" using the project description and any domain knowledge; if you genuinely lack a fact (e.g. a real API URL), say so rather than inventing one.
3. Import the JSON spec.

**(b) Endpoints:**
```
GET  /v1/generator/:projectId/prompts?type=interview[&locale=fi]   (scope: generator:read)
POST /v1/generator/:projectId/interview                            (scope: generator:write)
```
The interview prompt is built from the DB template `gen-interview` via `buildPrompt()` and is parameterised with `projectDescription` and `locale`. (See [02](./02-prompts-in-order.md) for prompt sourcing — per-component prompt **text** lives in `aimeat/src/services/generator-prompt-seeds.ts`; interview/blueprint templates are seeded from the same DB-backed system.)

**(c) Import request:**
```json
{ "interviewSpec": { /* the JSON object the AI produced */ } }
```
`interviewSpec` is the parsed object (not a string). The route runs `validateInterviewSpec(JSON.stringify(interviewSpec))`.

**(d) Import response:** `{ "data": { "saved": true } }` (HTTP 200). The spec is written to `generator.{projectId}.interview-spec` with `visibility: 'owner'`.

**(e) Success:** `saved: true`.

**(f) Failure:**
- `404 NOT_FOUND` — project id wrong.
- `422 VALIDATION_ERROR` — the spec failed schema validation; the response carries `{ errors: [...] }`. Read the errors, regenerate the spec to satisfy them, re-import. Do **not** proceed to blueprint with an invalid spec.

### 4b. Spec-quality gate (before blueprint)

The UI runs an automated, **AI-free** quality gate after import and before allowing blueprint generation (`docs/generator-guide.md` §9.2b). There is no dedicated server endpoint for it — it is a content check you must replicate before generating the blueprint:

- Every data source has a **verified URL**.
- Every data source has a `sampleEntry` with actual data.
- At least **2 use cases** are defined.
- Views reference data entities that exist in the data model.
- A `locale` is set.

If any check fails, fix the interview spec and re-import (`POST …/interview`) before continuing. Skipping this gate is the most common root cause of downstream contract failures.

---

## 5. Phase: Blueprint

**(a) What you do:** fetch the blueprint prompt, run it (produce the JSON blueprint: `components[]`, phases, `data model` with `structures`/`memoryKeys`/`actions`, `service_slug`, test scenarios), import it.

**(b) Endpoints:**
```
GET  /v1/generator/:projectId/prompts[?type=blueprint]   (scope: generator:read)   ← default type is "blueprint"
POST /v1/generator/:projectId/steps/blueprint            (scope: generator:write)
```
The blueprint prompt (`gen-blueprint` template) is built with `projectDescription`, the saved `interviewSpec`, and a **live cortex catalog** — the route fetches `GET /v1/cortex` and includes active cortexes that expose `lib` components, so the blueprint can reference available platform UI libraries.

**(c) Import request:**
```json
{ "blueprint": "{ \"service_slug\": \"prh\", \"components\": [ ... ], ... }" }
```
> **Note:** `blueprint` MUST be a **string** here (the route checks `typeof blueprint !== 'string'`), unlike `interviewSpec` which is an object. The route validates it with `validateBlueprint()` and stores the **extracted** (parsed) form.

**(d) Import response:**
```json
{ "data": { "valid": true, "errors": [], "warnings": [ ... ] } }
```
On success the route also **seeds one component record per blueprint component** under `generator.{projectId}.component.{id}` with `status: 'not_started'`. These are the records the per-component loop operates on. Project status becomes `blueprint_ready`.

**(e) Success:** `valid: true`.

**(f) Failure:**
- `400 INVALID_BODY` — `blueprint` not a string.
- `422 VALIDATION_FAILED` — `error.message` is the joined validation errors. Regenerate, re-import.
- `404 NOT_FOUND` — bad project id.
- `409 BLUEPRINT_LOCKED` — components are already `ready`/`registered`; you cannot overwrite the blueprint. Either delete those components or create a new project. This guard protects work-in-progress.

---

## 6. Phase: Settings

**(a) What you do:** the interview/blueprint may declare service settings (API keys, toggles, defaults). Collect initial values and store them. They are later merged into the extension's runtime `ctx.config` via `apply-settings`.

**(b) Endpoints:**
```
POST /v1/generator/:projectId/settings   (role: owner)
GET  /v1/generator/:projectId/settings   (role: owner)
```

**(c) Request:**
```json
{ "values": { "PRH_API_BASE": "https://avoindata.prh.fi/...", "pageSize": 20 },
  "secretKeys": ["PRH_API_KEY"] }
```
`values` is a flat object of `string | number | boolean`. `secretKeys` is accepted but values are stored **as-is** (no encryption — they're already protected by owner-scoped memory; see the route comment).

**(d) Response:** POST → `{ "data": { "stored": <count> } }`. GET → `{ "data": { "values": { ... } } }`.

**(e) Success:** `stored` equals the number of keys you sent.

**(f) Failure:** `400 INVALID_BODY` if `values` is missing/not an object; `404 NOT_FOUND` for bad project id.

---

## 7. Phase: Per-component loop

Iterate the blueprint components **in phase order**. For each component, run the inner pipeline: **get prompt → run it → submit → register → (extension only: apply-settings + activate + probe) → test**.

### 7.1 Get the component prompt

```
GET /v1/generator/:projectId/prompts/:componentId[?type=code|spec|test]   (scope: generator:read)
```
- `type=code` (default) — the artifact-generation prompt (YAML/JSON/JS/HTML per component type).
- `type=spec` — only for `extension` and `cortex` (and `app`); produces a structured spec you generate and store **before** the code. The route maps subtype → prompt id: data→`gen-data-api-spec`, component→`gen-component-spec`, app-domain→`gen-app-domain-spec`, extension→`gen-extension-spec`, app→`gen-app-spec`.
- `type=test` — the test-code prompt; only for `extension`, `cortex`, `app`.

The prompt id is resolved from `component.type` (+ cortex `subtype`) and built with full context: the blueprint, interview spec, completed components, the component's own stored spec (`selfSpec`), the extension spec, the data-api spec, and accumulated translation keys. (`buildPrompt()` in `src/services/generator-prompts/index.js`; mapping table in `generator.ts` lines ~1409-1454.) See [02-prompts-in-order.md](./02-prompts-in-order.md) for the full id table.

**Response:** `{ "data": { "componentId", "type", "label", "prompt": "<text>" } }`.

**Failure:** `400 NO_BLUEPRINT` (blueprint not submitted), `404 NOT_FOUND` (component not in blueprint), `400 NO_TEST` / `400 NO_SPEC` (type doesn't use that prompt kind), `500 PROMPT_BUILD_FAILED` (template error — `error.message` names the failing prompt id).

> For `extension` and the cortex types, the recommended order is **spec first**: GET `?type=spec`, run it, then generate the code prompt which references that spec. The spec is stored at `generator.{projectId}.spec.{componentId}` and is read back by later prompts (the route loads `selfSpec`/`extensionSpec`/`dataApiSpec` from these records). The agent path stores specs by the same mechanism the browser uses (`saveSpec()` → memory); the generator does not have a dedicated spec-submit route, so write the spec via the standard Memory API under that key, or rely on the browser flow if mixing paths.

### 7.2 Run the prompt

Produce the artifact in your own context. Output format per type (see [03](./03-spec-define-seed.md), [04](./04-spec-extension.md), [05](./05-spec-cortex-app.md) for exact formats):
- **csm / msm** → YAML manifest.
- **memory / translation** → JSON object.
- **extension** → fenced YAML manifest + fenced JS action scripts. **Sandbox rule:** the only top-level statement in each action script is `export default async function(ctx, input){ … }` — no top-level `const`/`let`/`function`/`class`; helpers go inside.
- **cortex** → fenced YAML manifest + fenced ` ```javascript ` lib code (IIFE registering on `AIMEAT.*`).
- **app** → a single HTML document.

### 7.3 Submit (server-side validate + store)

```
POST /v1/generator/:projectId/components/:componentId/submit   (scope: generator:write)
```
**Request:**
```json
{ "type": "extension", "content": "<the full artifact text>" }
```
`type` must be one of `csm | msm | extension | app | memory | translation | cortex`. `content` is a string. The route requires the blueprint to exist and the `componentId` to be present in it, then runs `validateComponent(type, content)`.

**Response (200):**
```json
{ "data": { "valid": true, "errors": [], "warnings": [...], "extracted": <parsed/cleaned content> } }
```
On success the component record becomes `status: 'ready'` with `result`/`content` set to the **extracted** content.

**Failure:**
- `400 INVALID_BODY` — bad `type` or missing `content`.
- `400 NO_BLUEPRINT` — submit before blueprint.
- `404 NOT_FOUND` — componentId not in blueprint.
- `422 VALIDATION_FAILED` — `error.message` lists the validation errors. **Do not register.** Fetch the prompt again (it can include the errors as a fix prompt), regenerate, re-submit. The guide allows up to ~3 fix rounds before a fresh regeneration.
- `409 ALREADY_REGISTERED` — the component is already registered; you cannot re-submit it through this route. To change it, `reset` first (§7.7).

### 7.4 Register (server-side install into the catalogue)

```
POST /v1/generator/:projectId/components/:componentId/register   (scope: generator:execute)
```
No body. The component must be in `status: 'ready'`. The route dispatches by type:
- `csm` → `registerCsm()`, `msm` → `registerMsm()`, `extension` → `registerExtension()`, `app` → `registerApp()` (helpers in `src/services/generator-registration.ts`).
- `cortex` → POSTs the manifest+libs to `/v1/cortex`; if that 409s it **deactivate → delete → re-POST**, then **deactivate → activate** (so cortex is registered *and activated* by this one call). It parses `name:` out of the YAML manifest and the lib code out of the ` ```javascript ` fence.
- `memory` / `translation` → writes the JSON under `{service_slug}.{key}` (or `{service_slug}.i18n.{locale}` for translations) as `visibility: 'public'` memory. **Requires `blueprint.service_slug`** — returns `400 NO_SERVICE_SLUG` if missing (regenerate the blueprint).

**Response:** `{ "data": { "registered": true, "componentId": "..." } }`. The component record becomes `status: 'registered'` with `registeredAt`.

**Failure:**
- `404 NOT_FOUND` — component not found (submit first).
- `400 NOT_READY` — status isn't `ready` (submit/validate first).
- `400 NO_SERVICE_SLUG` — memory/translation without `service_slug`.
- `400 UNSUPPORTED_TYPE` — type can't be registered.
- `500 REGISTRATION_ERROR` — the underlying register helper or catalogue call threw; `error.message` has the cause (e.g. manifest parse error, duplicate name not auto-resolved). Read it, fix the artifact, `reset` + regenerate + re-submit + re-register.

> **Extension and (non-cortex) activation note.** `registerExtension()` installs the extension; for the agent path you must **activate** it explicitly before probing/testing (the browser test flow calls `POST /v1/extensions/:name/activate`). Cortex is auto-activated **inside** the register route as described above. See [06-activation-registration-reference.md](./06-activation-registration-reference.md) for every activate/deactivate endpoint and the equivalent MCP tools.

### 7.5 Apply settings + activate (extension only)

Before probing/testing an **extension**, mirror what the UI does (`use-test-execution.js`):
```
POST /v1/generator/:projectId/apply-settings/:extensionName   (role: owner)   ← merge settings into ctx.config
POST /v1/extensions/:extensionName/activate                    (role: owner)   ← idempotent
```
`apply-settings` reads `generator.{projectId}.settings` and merges those values into the extension's `config` object (preserving internal `__`-prefixed keys). Response: `{ "data": { "applied": <n>, "keys": [...] } }`. If no settings exist it returns `applied: 0` (not an error). The extension name is its `registeredAs` value.

### 7.6 Probe (extension → golden samples)

```
POST /v1/generator/:projectId/probe-extension   (role: owner)
```
**Request:**
```json
{ "extensionName": "prh-companies",
  "scenarios": [ { "action": "searchCompanies", "input": { "query": "Kone" } },
                 { "action": "getCompany",     "input": { "businessId": "1234567-8" } } ] }
```
The route calls each `POST /v1/ext/{extensionName}/{action}` with the given input and captures the **real** response shape (`body.data ?? body`). **Response:**
```json
{ "data": { "extensionName": "prh-companies",
            "results": [ { "action": "...", "input": {...}, "status": 200, "response": <real data> } ] } }
```
These golden samples feed downstream cortex/test prompts so they know the exact data shapes they'll receive. **Why it matters:** without real shapes, downstream components reconstruct contracts from source code — the #1 cause of integration failures. Run a probe after every extension registration, before generating any cortex that consumes it.

**Failure:** `400 INVALID_BODY` (missing `extensionName`/`scenarios`), `404 NOT_FOUND` (bad project). A failed action surfaces as `status: 500` with `response.error` in its result entry — that's a probe finding, not an HTTP error; treat it as a contract problem to fix in the extension.

### 7.7 Test

**Per-component test (the one you use in the loop):**
```
POST /v1/generator/:projectId/test/:componentId   (role: owner)
```
**Request:**
```json
{ "testCode": "<AI-generated test code>", "environment": "browser" }
```
You must generate `testCode` first — fetch `GET …/prompts/:componentId?type=test`, run it, paste the result here. `environment` is optional; the route defaults to `browser` for `cortex`/`app` and `server` for everything else. The route **saves `testCode` onto the component record** before running, then:
- **server** → `executeHttpTest()` (uses a `testFetch` helper against `http://localhost:{port}`).
- **browser** → builds the self-contained test page at `GET /v1/generator/test-page/:projectId/:componentId` and runs it under Playwright (`executePlaywrightTest()`); requires Playwright available, else the result is `status: 'skipped'`.

**Response:**
```json
{ "data": { "result": { "componentId", "type", "status": "passed|failed|skipped",
                         "scenarios", "passed", "errors": [...], "screenshots": [...],
                         "fixRound", "trace": [...] } } }
```
`status: 'passed'` is success. On `failed`, `errors[]` and (for server tests) `trace[]` show each call's args + extracted response shape — use these to diagnose. Screenshots are served at `GET /v1/generator/:projectId/screenshots/:filename` (no auth, project-scoped PNGs).

**Bulk test (summary only — not a substitute for per-component):**
```
POST /v1/generator/:projectId/test   (role: owner)   body: { "level": "none|basic|comprehensive" }
```
This returns a `report` enumerating blueprint components but **does not execute AI-generated code** — it marks them `passed` as a placeholder and hints you to run per-component tests. Use the **per-component** endpoint for real verification.

**Failure handling:** if a component test fails, do **not** advance. Diagnose from `errors`/`trace`/screenshots, fix the component (`reset` → regenerate → submit → register) or fix the test code, and re-run. Re-register if the component source changed.

### 7.8 Reset (regenerate a component)

```
POST /v1/generator/:projectId/components/:componentId/reset   (role: owner)
```
No body. Clears `result`, `spec`, `registeredAs`, `testCode`, `testResult`, `validationErrors`, `probeResults`, sets `status: 'pending'`, and deletes the separate `…spec.{id}` and `…prompt.{id}` records. Use this to redo a component (it does **not** uninstall an already-registered catalogue object — for that, deactivate/delete via the catalogue/MCP, see [06](./06-activation-registration-reference.md)).

---

## 8. Phase: Final app browser test

After **all** components are registered and individually tested, exercise the finished app end-to-end in a real browser (this is the human-equivalent of "Launch App"). Drive the registered app, walk each interview use case (search, detail, write/watch, history, settings, language switch) and verify: all views render, translations resolve (no raw keys), data loads, layout is responsive, and the console is clean. Full procedure and the browser-driving tooling are in [07-browser-testing.md](./07-browser-testing.md).

---

## 9. Phase: Complete

```
POST /v1/generator/:projectId/complete   (scope: generator:execute)
```
No body. **Guard:** at least one component must be `status: 'registered'`, else `400 NO_COMPONENTS`. On success the project status becomes `active`, `completedAt` is set, and the session record is released.

**Response:** `{ "data": { "status": "active", "registeredComponents": <n> } }`.

**Auxiliary endpoints used throughout:**
- `POST /v1/generator/:projectId/log` — write a project log entry. Body: `{ "level": "info|warn|error", "message", "componentId"?, "meta"? }`. Returns `{ logged: true, logId }`. Use it to leave an audit trail at each step.
- `DELETE /v1/generator/:projectId` — cascade-delete the project, all `generator.{projectId}.*` memory keys, and test screenshots. Returns `{ deleted: true, keysRemoved: <n> }`.

---

## 10. Failure matrix (whole pipeline)

Adapted from `docs/generator-guide.md` §11, with endpoints verified against `src/routes/generator.ts`.

| Stage | Symptom | Endpoint / code | What to do |
|-------|---------|-----------------|------------|
| **Spec validation** | Interview import rejected | `POST …/interview` → `422 VALIDATION_ERROR`, `{errors}` | Regenerate the spec to satisfy each error; re-import. Never proceed on an invalid spec. |
| **Spec-quality gate** | Missing URL / sampleEntry / <2 use cases / view↔entity mismatch / no locale | client-side check (no endpoint) | Fix the interview spec, re-import, then generate blueprint. |
| **Blueprint validation** | Blueprint import rejected | `POST …/steps/blueprint` → `422 VALIDATION_FAILED` | Regenerate blueprint; re-import. |
| **Blueprint locked** | Can't overwrite blueprint | `409 BLUEPRINT_LOCKED` | Components already submitted; delete them (`reset`) or start a new project. |
| **Component validation** | Submit rejected | `POST …/submit` → `422 VALIDATION_FAILED` | Read errors; re-fetch prompt (fix-prompt variant), regenerate, re-submit (≤3 rounds, then fresh regen). |
| **Already registered** | Can't re-submit | `409 ALREADY_REGISTERED` | `reset` the component first, then regenerate + submit. |
| **Contract mismatch** | Artifact valid but doesn't match blueprint (missing action/export) | surfaces at register `500` or at test | Compare artifact against blueprint `actions`/`produces`; regenerate to match the contract. |
| **Registration** | Install threw | `POST …/register` → `500 REGISTRATION_ERROR` (or `400 NOT_READY` / `NO_SERVICE_SLUG`) | Read `error.message`; fix manifest/scripts/slug; reset → regen → submit → register. |
| **Activation** | Extension/cortex not active before test | `POST /v1/extensions/:name/activate` / cortex auto-activate in register | Activate explicitly (extension); for cortex confirm register's deactivate→activate ran. See [06](./06-activation-registration-reference.md). |
| **Settings not applied** | Extension lacks API key/config at runtime | `POST …/apply-settings/:name` → `applied: 0` | Ensure `POST …/settings` stored the values; re-run apply-settings; check the keys list in the response. |
| **Probe** | Action errored | `POST …/probe-extension` → result entry `status: 500`, `response.error` | Treat as a contract bug in the extension action; fix the action, re-register, re-probe. |
| **Test (server)** | `status: 'failed'` | `POST …/test/:id` → `result.errors` + `result.trace` | Diagnose from trace (per-call args + extracted shapes); fix component or test code; re-run. |
| **Test (browser)** | `status: 'failed'` or `'skipped'` | same; screenshots at `…/screenshots/:file` | `skipped` = Playwright unavailable (install it). `failed` = inspect screenshots + errors; fix; re-run. |
| **Browser app test** | App view broken / raw i18n keys / no data | manual browser drive (see [07](./07-browser-testing.md)) | Identify which layer (translation/cortex/app) is wrong; reset that component, regen, re-register, re-test. |
| **Complete blocked** | Can't finish | `POST …/complete` → `400 NO_COMPONENTS` | Register at least one component first. |
| **Cascade cleanup** | Need to start over | `DELETE /v1/generator/:projectId` | Removes all project memory + screenshots; create a fresh project. |

---

## 11. Happy-path API transcript (one extension component)

Pseudocode; assumes `PID = projectId`, owner/agent JWT in `Authorization: Bearer …`. Bodies abbreviated.

```http
# ── project + interview + blueprint already done; loop now on the "ext-prh" extension ──

# 1. Spec first (extension)
GET  /v1/generator/{PID}/prompts/ext-prh?type=spec      → { data.prompt }
#    (run prompt → produce spec JSON → store at generator.{PID}.spec.ext-prh via Memory API)

# 2. Code prompt
GET  /v1/generator/{PID}/prompts/ext-prh?type=code      → { data.prompt }
#    (run prompt → produce YAML manifest + JS action scripts)

# 3. Submit (server validates)
POST /v1/generator/{PID}/components/ext-prh/submit
     { "type": "extension", "content": "<manifest+scripts>" }
                                                        → { data.valid: true }

# 4. Register (installs the extension)
POST /v1/generator/{PID}/components/ext-prh/register
                                                        → { data.registered: true }

# 5. Apply settings + activate
POST /v1/generator/{PID}/apply-settings/prh-companies   → { data.applied: 2 }
POST /v1/extensions/prh-companies/activate              → 200

# 6. Probe → golden samples
POST /v1/generator/{PID}/probe-extension
     { "extensionName": "prh-companies",
       "scenarios": [ { "action": "searchCompanies", "input": { "query": "Kone" } } ] }
                                                        → { data.results: [ { status: 200, response: {...} } ] }

# 7. Test prompt → test code → run
GET  /v1/generator/{PID}/prompts/ext-prh?type=test      → { data.prompt }
#    (run prompt → produce testCode)
POST /v1/generator/{PID}/test/ext-prh
     { "testCode": "<...>", "environment": "server" }   → { data.result.status: "passed" }

# 8. Log progress, advance to next blueprint component
POST /v1/generator/{PID}/log
     { "level": "info", "message": "ext-prh passed", "componentId": "ext-prh" }
```

When the last component passes, drive the app in a browser ([07](./07-browser-testing.md)), then:

```http
POST /v1/generator/{PID}/complete                       → { data.status: "active" }
```

---

## See also

- [00-agent-playbook.md](./00-agent-playbook.md) — how an agent uses this whole doc set end-to-end.
- [02-prompts-in-order.md](./02-prompts-in-order.md) — every prompt in pipeline order and where each is sourced.
- [03-spec-define-seed.md](./03-spec-define-seed.md) — CSM / MSM / Memory / Translation formats + activation.
- [04-spec-extension.md](./04-spec-extension.md) — Extension manifest + scripts + `ctx` API + activation + probe.
- [05-spec-cortex-app.md](./05-spec-cortex-app.md) — Cortex (data/component/app-domain) + App formats + activation.
- [06-activation-registration-reference.md](./06-activation-registration-reference.md) — every register/activate endpoint + MCP tool.
- [07-browser-testing.md](./07-browser-testing.md) — driving the finished app in a real browser.
