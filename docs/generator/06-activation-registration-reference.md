# Registration & Activation Reference

> **Audience:** an AI coding agent (or advanced human dev) building an AIMEAT app via the prompt-driven generator workflow.
> **What this covers:** the canonical, grep-able way to register and activate every artifact type — through (a) the generator pipeline endpoint, (b) the direct platform REST endpoint, and (c) the MCP tool — plus the generator's own orchestration endpoints, the MCP tool inventory for app-building, and the activation gotchas that trip agents up.
> **Read next:** [03-spec-define-seed.md](./03-spec-define-seed.md) (CSM/MSM/Memory/Translation formats), [04-spec-extension.md](./04-spec-extension.md) (Extension format + ctx API), [05-spec-cortex-app.md](./05-spec-cortex-app.md) (Cortex/App formats).

All paths below are verified against source in `aimeat/src/routes/{generator,extensions,cortex,apps,csm,msm,memory}.ts` and `aimeat/src/mcp/{extensions,cortex,apps,core,memory-extended}.ts`. Every response uses the AIMEAT envelope from `src/middleware/envelope.ts` — see [Response envelope](#response-envelope) at the bottom.

> **Which path should an agent use?** When walking the prompt-driven pipeline, the **generator pipeline endpoints** are the supported route: they validate first, store the artifact in `generator.*` memory, and (for some types) activate internally. The **direct REST endpoints** and **MCP tools** are equivalent lower-level entry points — useful for one-off registration, debugging, or when not inside a generator project. The autopilot/LLM path is **not** the path to use.

---

## Master table

| Artifact | Generator pipeline (validate → store → register) | Direct platform REST | MCP tool | Activation |
|----------|--------------------------------------------------|----------------------|----------|------------|
| **CSM** | `submit` then `register` (`type:"csm"`) | `POST /v1/csm` | — (no dedicated MCP install tool) | None — active on register |
| **MSM** | `submit` then `register` (`type:"msm"`) | `POST /v1/msm` | — | None — active on register |
| **Memory** (seed data) | `submit` then `register` (`type:"memory"`) | `POST /v1/memory` / `PUT /v1/memory/:key` | `aimeat_memory_write` | None — live on write |
| **Translation** | `submit` then `register` (`type:"translation"`) | `POST /v1/memory` (writes `{slug}.i18n.{locale}`) | `aimeat_memory_write` | None — live on write |
| **Extension** | `submit` then `register` (`type:"extension"`) — **registers INACTIVE** | `POST /v1/extensions` | `aimeat_extension_install` | **Separate step** — `POST /v1/extensions/:name/activate` / `aimeat_extension_activate` |
| **Cortex** (data / component / app-domain) | `submit` then `register` (`type:"cortex"`) — **register deactivate→activate internally** | `POST /v1/cortex` | `aimeat_cortex_install` | `POST /v1/cortex/:name/activate` / `aimeat_cortex_activate` (generator register does this for you) |
| **App** | `submit` then `register` (`type:"app"`) | `POST /v1/apps` | `aimeat_app_publish` | None — published apps are served immediately |

**Two activation models to remember:**
- **Cortex** — generator's `register` runs `(re-register) → deactivate → activate` inline, so the cortex is live after register. Direct REST/MCP require you to call activate yourself.
- **Extension** — generator's `register` stores the extension `status: 'inactive'` (`registerExtension()` in `src/services/generator-registration.ts` sets `status: 'inactive'` and never activates). You **must** activate as a separate step. Same for direct REST/MCP.
- **CSM, MSM, Memory, Translation, App** — no activation concept; the artifact is effective the moment it is written/registered.

---

## Per-artifact detail

### CSM (Consent/Service Model)

Full format: [03-spec-define-seed.md](./03-spec-define-seed.md).

- **Generator:** `POST /v1/generator/:projectId/components/:componentId/submit` with `{ type: "csm", content: "<yaml or json>" }` → then `POST /v1/generator/:projectId/components/:componentId/register`. Internally calls `registerCsm(content, ownerName, storage)`.
- **Direct REST:** `POST /v1/csm` — `requireRole('owner')`. Accepts either raw YAML (set `Content-Type: text/yaml`) or a JSON CSM definition object as the body. Returns `success(...)` with the stored definition. List: `GET /v1/csm`; get one: `GET /v1/csm/:name`; delete: `DELETE /v1/csm/:name` (owner).
- **MCP:** no dedicated install tool — use the generator pipeline or `POST /v1/csm`.
- **Activation:** none.

### MSM (Marketplace/Service Manifest)

- **Generator:** `submit` (`type: "msm"`) → `register` → `registerMsm(content, ownerName, storage)`.
- **Direct REST:** `POST /v1/msm` — `requireRole(config.msmInstallRole)`. List `GET /v1/msm`; get `GET /v1/msm/:name`; delete `DELETE /v1/msm/:name` (owner).
- **MCP:** none dedicated.
- **Activation:** none.

### Memory (seed data)

- **Generator:** `submit` (`type: "memory"`) → `register`. On register, the generator reads `blueprint.service_slug` and writes each key as `{slug}.{rawKey}` (it prefixes the slug if missing) with `visibility: 'public'`, under the owner's GHII. **A blueprint with `service_slug` is required** — without it register returns `400 NO_SERVICE_SLUG`.
- **Direct REST:** `POST /v1/memory` (`requireRole('agent')`, scope `memory:write`) body `{ key, value, visibility, tags?, ttl_hours? }`; or `PUT /v1/memory/:key`. Read with `GET /v1/memory/:key`, list `GET /v1/memory`, public cross-read `GET /v1/memory/:gaii/:key`.
- **MCP:** `aimeat_memory_write` / `aimeat_memory_read` / `aimeat_memory_list` / `aimeat_memory_search` / `aimeat_memory_read_public`.
- **Activation:** none — data is live the moment it is stored.

### Translation

- **Generator:** `submit` (`type: "translation"`) → `register`. The generator iterates the top-level locale keys and writes each as `{slug}.i18n.{locale}` with `visibility: 'public'`. Same `service_slug` requirement as memory.
- **Direct REST:** `POST /v1/memory` writing key `{slug}.i18n.{locale}` (e.g. `myservice.i18n.fi`), value = the flat string map, `visibility: 'public'`.
- **Reading in cortex/app:** translations are **owner/user data** — read them with `AIMEAT.data.get('{slug}.i18n.fi')`, **never** via `getPublic('ext:...')`.
- **Activation:** none.

### Extension

Full format + `ctx` API: [04-spec-extension.md](./04-spec-extension.md).

- **Generator:** `submit` (`type: "extension"`) → `register`. `registerExtension()` splits the content into manifest YAML + embedded `` ```javascript `` action scripts, validates that every `actions[].script` is present, deletes any existing extension of the same name (generator always overwrites), and **stores the record `status: 'inactive'`**. It does **not** activate.
- **Direct REST:** `POST /v1/extensions` body `{ manifest: "<yaml>", scripts: { "actions/foo.js": "<code>" } }`. Activate: `POST /v1/extensions/:name/activate` (owner). Deactivate: `POST /v1/extensions/:name/deactivate`. Delete: `DELETE /v1/extensions/:name`. Get: `GET /v1/extensions/:name`. List: `GET /v1/extensions`. Invoke an action: `POST /v1/ext/:extName/:actionId` (note: **`/v1/ext/...`**, not `/v1/extensions/.../actions/...`).
- **MCP:** `aimeat_extension_install` (presigned ZIP mode available), `aimeat_extension_activate`, `aimeat_extension_deactivate`, `aimeat_extension_invoke`, `aimeat_extension_get`, `aimeat_extension_list`, `aimeat_extension_delete`.
- **Activation — REQUIRED separate step.** After register (or install), call activate. On activate the server registers any `__schedules` cron jobs and runs `@activate` jobs immediately (`scheduler.runActivateJobs(name)`). **`@activate` runs on every activate AND on every server restart — write it idempotently** (see gotchas).
- **Probe:** before generating dependent cortex/app, capture real action response shapes with `POST /v1/generator/:projectId/probe-extension` (see below).

### Cortex (data / component / app-domain — same endpoints for all three subtypes)

Full format: [05-spec-cortex-app.md](./05-spec-cortex-app.md).

- **Generator:** `submit` (`type: "cortex"`) → `register`. The register handler parses the `` ```yaml `` manifest and `` ```javascript `` lib from the component content, then:
  1. `POST /v1/cortex` with `{ manifest, libs: { "<name>.js": "<code>" } }`.
  2. If that 409s (already installed), it does `POST /v1/cortex/:name/deactivate` → `DELETE /v1/cortex/:name` → `POST /v1/cortex` again.
  3. Then `POST /v1/cortex/:name/deactivate` → `POST /v1/cortex/:name/activate`.
  So after a generator `register`, a cortex is **registered AND active**.
- **Direct REST:** `POST /v1/cortex` body `{ manifest: "<yaml>", libs: { "name.js": "<code>" } }` (owner). Activate `POST /v1/cortex/:name/activate`; deactivate `POST /v1/cortex/:name/deactivate`; delete `DELETE /v1/cortex/:name`; get `GET /v1/cortex/:name`; list `GET /v1/cortex`; lib file served at `GET /v1/cortex/:name/libs/:libFile` (no auth, for `<script src>`).
- **MCP:** `aimeat_cortex_install` (presigned ZIP mode), `aimeat_cortex_activate`, `aimeat_cortex_deactivate`, `aimeat_cortex_list`, `aimeat_cortex_delete`.
- **Activation — manual via REST/MCP, automatic via generator register.** `POST /v1/cortex/:name/activate` is **idempotent: if `status === 'active'` it returns early and DOES NOT re-run the init artifacts.** To redeploy a data cortex's init step you must deactivate first, then activate (see gotchas).
- The three subtypes (`data`, `component`, `app-domain`) are distinguished only by the manifest/blueprint `subtype` field — they share these exact endpoints.

### App

Full format: [05-spec-cortex-app.md](./05-spec-cortex-app.md).

- **Generator:** `submit` (`type: "app"`) → `register` → `registerApp(content, ownerName, callerGaii, storage)`. Accepts base64 or raw HTML.
- **Direct REST:** `POST /v1/apps` (`requireAuth`) body `{ filename, content (base64), mime_type?, name?, description?, version?, category?, tags?, uses_cortex?, ... }`. **Presigned mode:** send `{ filename, mode: "presigned", ... }` (omit `content`) → response gives `upload_url` + `upload_method: "PUT"`; PUT the raw HTML there. Get `GET /v1/apps/:owner/:filename`; list `GET /v1/apps`; versions `GET /v1/apps/:owner/:filename/versions`; update metadata `PATCH /v1/apps/:filename`; delete `DELETE /v1/apps/:filename`.
- **MCP:** `aimeat_app_publish` (presigned mode), `aimeat_app_get`, `aimeat_app_list`, `aimeat_app_versions`, `aimeat_app_delete`.
- **Activation:** none — a published app is served immediately. (Be aware of BUILD_ID cache busting for JS the app loads; see gotchas.)

---

## Generator orchestration endpoints

These live in `aimeat/src/routes/generator.ts` and drive the pipeline. All require an agent role + the noted scope (an owner JWT satisfies the agent role check). Generator data is stored under the **owner's GHII** regardless of who calls.

| Step | Endpoint | Scope | What it does | Triggers activation? |
|------|----------|-------|--------------|----------------------|
| Create project | `POST /v1/generator/projects` | `generator:write` | Creates `gen-...` project record | No |
| List projects | `GET /v1/generator/projects` | `generator:read` | — | No |
| Get project state | `GET /v1/generator/:projectId` | `generator:read` | Returns `{ project, interviewSpec, components, session }` | No |
| Delete project | `DELETE /v1/generator/:projectId` | `generator:write` | Cascade-deletes all `generator.{id}.*` keys + screenshots | No |
| Save interview | `POST /v1/generator/:projectId/interview` | `generator:write` | Validates + stores interview spec | No |
| Settings (set) | `POST /v1/generator/:projectId/settings` | owner | Stores `{ values, secretKeys? }` (plain text, owner-scoped) | No |
| Settings (get) | `GET /v1/generator/:projectId/settings` | owner | Returns stored values | No |
| **apply-settings** | `POST /v1/generator/:projectId/apply-settings/:extensionName` | owner | Merges project settings into the extension's `config` (so `ctx.config` sees them) | No (but changes runtime config) |
| **probe-extension** | `POST /v1/generator/:projectId/probe-extension` | owner | Calls `POST /v1/ext/:name/:action` for each `{ action, input }` scenario, returns real response shapes (for cortex/app prompts) | No |
| **submit** (validate) | `POST /v1/generator/:projectId/components/:componentId/submit` | `generator:write` | Validates content for `type`; on success stores component `status: 'ready'`; on failure returns `422 VALIDATION_FAILED` and does NOT store | No |
| Blueprint | `POST /v1/generator/:projectId/steps/blueprint` | `generator:write` | Validates + stores blueprint; seeds component records; `409 BLUEPRINT_LOCKED` if components already submitted | No |
| **register** | `POST /v1/generator/:projectId/components/:componentId/register` | `generator:execute` | Component must be `status: 'ready'`. Dispatches by type (see below). Marks component `status: 'registered'` | **Cortex yes** (deactivate→activate inline); **Extension no** (stored inactive); others n/a |
| reset | `POST /v1/generator/:projectId/components/:componentId/reset` | owner | Clears generated content back to blueprint-derived fields | No |
| **test** (per-component) | `POST /v1/generator/:projectId/test/:componentId` | owner | Runs AI-generated `testCode` — server (HTTP) for csm/extension/etc., browser (Playwright) for cortex/app | No |
| test (bulk) | `POST /v1/generator/:projectId/test` | owner | Walks blueprint components in dependency order at a `level` | No |
| test-page | `GET /v1/generator/test-page/:projectId/:componentId` | owner | Serves a self-contained HTML harness (loads cortex deps + auth + testCode) that Playwright navigates to | No |
| Get component prompt | `GET /v1/generator/:projectId/prompts/:componentId` | `generator:read` | Returns the code/`?type=spec`/`?type=test` prompt for the component | No |
| Get blueprint/interview prompt | `GET /v1/generator/:projectId/prompts` | `generator:read` | `?type=interview` or default blueprint prompt | No |
| Log | `POST /v1/generator/:projectId/log` | `generator:execute` | Writes a log entry to memory | No |
| **complete** | `POST /v1/generator/:projectId/complete` | `generator:execute` | Marks project `status: 'active'`; requires ≥1 registered component (else `400 NO_COMPONENTS`); releases the session | No |

**register dispatch (from `generator.ts`):**
- `csm` → `registerCsm()` · `msm` → `registerMsm()` · `extension` → `registerExtension()` (stays inactive) · `app` → `registerApp()`
- `cortex` → POST `/v1/cortex` (+ deactivate→delete→re-POST on conflict) → deactivate → **activate**
- `memory` / `translation` → writes `{slug}.*` (and `{slug}.i18n.{locale}`) memory keys directly; needs `blueprint.service_slug`

---

## MCP tool inventory (app-building)

Grouped by domain. One line each; schemas are fetched on demand via tool search.

**Extension**
- `aimeat_extension_install` — install an extension (manifest + scripts, or presigned ZIP)
- `aimeat_extension_activate` — activate (runs `@activate`, registers schedules)
- `aimeat_extension_deactivate` — deactivate
- `aimeat_extension_invoke` — call an action (`/v1/ext/:name/:action`)
- `aimeat_extension_get` — fetch one extension's details
- `aimeat_extension_list` — list installed extensions
- `aimeat_extension_delete` — delete an extension

**Cortex**
- `aimeat_cortex_install` — install a cortex (manifest + libs, or presigned ZIP)
- `aimeat_cortex_activate` — activate (idempotent; skips init if already active)
- `aimeat_cortex_deactivate` — deactivate
- `aimeat_cortex_list` — list cortex extensions
- `aimeat_cortex_delete` — delete a cortex

**App**
- `aimeat_app_publish` — publish an app HTML file (inline base64 or presigned PUT)
- `aimeat_app_get` — fetch an app
- `aimeat_app_list` — list apps
- `aimeat_app_versions` — list version history of an app
- `aimeat_app_delete` — delete an app

**Memory**
- `aimeat_memory_write` — write a key (owner/agent namespace)
- `aimeat_memory_read` — read own key
- `aimeat_memory_list` — list keys
- `aimeat_memory_search` — search keys
- `aimeat_memory_read_public` — read a public key by `{gaii}/{key}` (e.g. `ext:name` data)

**Storage (binary files)**
- `aimeat_storage_upload` — upload a file (inline or presigned PUT)
- `aimeat_storage_download` — download a file

### Presigned-upload mode (apps / storage / extension / cortex install)

For `aimeat_app_publish`, `aimeat_storage_upload`, `aimeat_extension_install`, and `aimeat_cortex_install`: **omit the content parameter** to receive an `upload_url`. PUT the raw file/ZIP directly to that URL — the bytes go disk → server without passing through the AI context window.
- **App / Storage:** PUT the raw file (HTML, binary).
- **Extension / Cortex:** PUT a **ZIP** containing `manifest.yaml` + `scripts/` (extension) or `libs/` (cortex).
- **Token:** single-use, **60-minute TTL**, size-capped.
- **Inline fallback:** passing content inline still works (backward-compatible). For the `/v1/apps` REST route, presigned is requested via `{ mode: "presigned" }` and returns `upload_url` + `upload_method: "PUT"`.

---

## Activation gotchas

1. **Cortex re-activation silently skips init.** `POST /v1/cortex/:name/activate` is idempotent: if the cortex is already `active`, it returns success **without re-running the activation artifacts (the init step)**. To redeploy a data cortex (e.g. after changing its init) you must **deactivate → activate**. This is exactly why the generator's cortex register always does `deactivate` immediately before `activate`.

2. **Extension `@activate` runs on activate AND every server restart.** Activation runs `scheduler.runActivateJobs(name)`, and the scheduler also fires `@activate` jobs on server start. **Write `@activate` action scripts to be idempotent** — e.g. check-then-write into `ext:{name}` memory, never blindly append or re-credit. Remember the sandbox rule: the only top-level statement is `export default async function(ctx, input){...}`; all helpers go inside it (see [04-spec-extension.md](./04-spec-extension.md)).

3. **409 conflict → deactivate + delete + re-register.** Installing an artifact whose name already exists returns `409 CONFLICT` (cortex: `"Extension ... already installed"`). The recovery sequence is: `POST /v1/cortex/:name/deactivate` → `DELETE /v1/cortex/:name` → `POST /v1/cortex` again (the generator does this automatically for cortex). For extensions, `registerExtension()` deletes an existing same-name extension before creating the new one, so the generator path won't 409 — but direct `POST /v1/extensions` will if the name exists; delete first.

4. **BUILD_ID cache busting affects app/cortex JS updates.** `portal.ts` stamps a fresh `BUILD_ID` per server restart onto every importmap/module URL, so the SPA fetches new module versions only after a restart. When you republish an app or redeploy a cortex lib **without** restarting the dev server, a browser tab that already loaded the old module may keep serving it from the ES module registry. After redeploying JS, restart `pnpm dev` (or hard-reload a fresh tab) before browser-testing — see [07-browser-testing.md](./07-browser-testing.md).

---

## Response envelope

Every endpoint above returns the AIMEAT envelope (`src/middleware/envelope.ts`):

```jsonc
// success(nodeId, data, hints?, meta?)
{
  "ok": true,
  "protocol": "aimeat",
  "version": "v1",
  "node": "<nodeId>",
  "timestamp": "<iso>",
  "request_id": "<id>",
  "data": { /* payload */ },
  "hints": { "next_actions": [ { "description": "...", "method": "POST", "url": "/v1/..." } ], "help_url": "/v1/docs" }
}

// error(nodeId, code, message, httpStatus?, details?, hints?)
{
  "ok": false,
  "protocol": "aimeat",
  "version": "v1",
  "node": "<nodeId>",
  "timestamp": "<iso>",
  "request_id": "<id>",
  "error": { "code": "VALIDATION_FAILED", "message": "...", "details": { /* optional */ } },
  "hints": { "next_actions": [ ... ], "help_url": "/v1/docs" }
}
```

Always branch on `ok`. On failure, the validation errors you need are in `error.message` (and sometimes `error.details`) — e.g. generator `submit` returns `422` with `error.message` joining the validator errors; feed those back into the generation prompt and retry. **`session.fetch()` already returns parsed JSON — use `resp.data`, never call `resp.json()`.**

---

## See also

- [03-spec-define-seed.md](./03-spec-define-seed.md) — CSM, MSM, Memory, Translation formats + activation
- [04-spec-extension.md](./04-spec-extension.md) — Extension manifest + scripts + `ctx` API + activation + probe
- [05-spec-cortex-app.md](./05-spec-cortex-app.md) — Cortex (data/component/app-domain) + App formats + activation
- [01-prompt-driven-workflow.md](./01-prompt-driven-workflow.md) — the full pipeline + generator API flow
- [02-prompts-in-order.md](./02-prompts-in-order.md) — every prompt in pipeline order + where each is sourced
- [07-browser-testing.md](./07-browser-testing.md) — testing the finished app in the browser
- [README.md](./README.md) — overview + index
