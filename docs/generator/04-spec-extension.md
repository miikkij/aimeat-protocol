# Artifact Format: Extension (manifest + scripts + ctx API)

> **Audience:** an AI coding agent (and advanced human devs) building an AIMEAT application by hand via the generator's prompt-driven workflow.
> **What this covers:** the deepest artifact in the stack — the server-side **extension**. How to author its `manifest.yaml` + action scripts, the exact `ctx` API surface the sandbox exposes, the `@activate`/init pattern, MSM/config pairing, how to install + activate it (REST and MCP), how to probe its live shape, and the spec contract the generator produces.
> **Read next:** [Cortex + App formats](./05-spec-cortex-app.md) (the layers that consume the extension), [Activation & registration reference](./06-activation-registration-reference.md) (all endpoints/tools in one table), [Browser testing](./07-browser-testing.md) (test mechanics, probe reconciliation in practice).

Everything below is verified against the actual source: `aimeat/src/routes/extensions.ts` (install/activate routes + the `ExtensionCtx` object that is built per request), `aimeat/src/mcp/extensions.ts` (MCP tools), `aimeat/src/services/generator-prompt-seeds.ts` (the prompt text served from the DB), `aimeat/src/models/schemas.ts` (`ExtensionInstallSchema`), and `aimeat/src/routes/generator.ts` (probe endpoint).

> **Accuracy note on the existing guide.** `docs/guides/building-extension-cortex-app-stack.md` section 4 shows a *simplified, aspirational* manifest (top-level `name:`, `ctx.api.get/post`, `ctx.task.create`, `ctx.notify('topic', payload)`). **That shape does NOT match the validated install route.** The route requires `metadata.{name,version,description,author}` and every action needs `id, method, path, script`; the runtime `ctx` has **no `ctx.api` and no `ctx.task`**, and `ctx.notify(message, opts)` takes a string message plus an options object. This document follows the real, enforced contract. Where the guide diverges, trust this doc.

---

## 1. What an extension is — and when to build one

An **extension** is server-side JavaScript that runs in a **bare QuickJS sandbox** (not Node, not a browser). It is the **only** layer in the stack allowed to:

- call **external APIs** (third-party HTTP behind CORS/auth, via `ctx.fetch`)
- run **scheduled jobs** (cron / `@activate`) with no browser open
- do work that must persist and run unattended

It owns the **`ext:{name}` memory namespace** — no other layer writes there. Anyone can *read* that namespace unauthenticated (it's public), which is how cortex/app/tests get the data back out.

### Build an extension when

- You need to fetch an external API the browser can't reach (CORS, server-side API key, SSRF-protected endpoint).
- You need a **cron** or **on-activation** background job (data ingestion, nightly aggregation).
- You need server-side computation/caching that survives with no client connected.

### Do NOT build an extension when

- A browser + `AIMEAT.data.get/set()` (owner memory) can do the whole job. If the work is "read/write the user's own data and render it," that belongs in a **cortex** (`05`), not an extension.
- You only need static seed data → that's a **Memory** artifact (`03`).
- You only need translations/settings → those live in the **owner namespace** as Memory/Translation artifacts (`03`), read directly by cortex via `AIMEAT.data.get()`. Do **not** route them through an extension.

---

## 2. Package format

An extension is delivered as a **ZIP** containing:

```
manifest.yaml          # at ZIP root
scripts/
  firstAction.js       # one file per action
  secondAction.js
  init.js
```

Equivalently, when installing **inline** (no ZIP), you send `{ manifest: "<yaml string>", scripts: { "firstAction.js": "<code>", ... } }`. The `script:` field of each action in the manifest must match a key in `scripts`.

### Full example `manifest.yaml`

This is the shape the install route actually validates (see `extensions.ts` lines 95–137 and the `gen-extension-code` seed). Every string value on **one line, double-quoted** — no YAML block scalars (`>` / `|`), they crash the parser.

```yaml
metadata:
  name: weather-data            # kebab-case; describes the PLATFORM CAPABILITY
  version: "1.0.0"
  description: "Fetches and caches weather observations from the open data API"
  author: generator
required_apis: [memory]
config:
  apiBase:
    type: string
    description: "Base URL of the upstream weather API"
    default: "https://api.example.com/weather"
    required: true
  cacheTtlMinutes:
    type: number
    description: "How long a cached observation stays fresh"
    default: 15
limits:
  memory_mb: 128
  timeout_ms: 30000           # 30000 for external-API extensions, 5000 for memory-only
  max_api_calls: 500          # 500 for collectors, 100 for simple actions
actions:
  - id: getObservations       # camelCase — appears in the URL and YAML
    description: "Fetch current observations for a station"
    method: POST              # ALL actions are invoked via POST regardless of this value
    path: /v1/ext/{name}/getObservations
    auth: required
    input:
      type: object
      properties:
        stationId:
          type: string
      required: [stationId]
    output:
      type: object
    script: getObservations.js
  - id: init
    description: "Initialize runtime data on activation and server restart"
    method: POST
    path: /v1/ext/{name}/init
    auth: required
    input: {}
    output: {}
    script: init.js
schedules:
  - id: refresh
    action: getObservations   # MUST reference an existing action id
    cron: "*/15 * * * *"      # standard 5-field cron, OR the special "@activate"
    description: "Refresh cached observations every 15 minutes"
    instance_scope: false
    input: { stationId: "helsinki" }
  - id: init-data
    action: init
    cron: "@activate"         # runs on activation AND on every server restart
    description: "Seed/refresh data on activation and restart"
    instance_scope: false
    input: {}
```

#### Field rules (enforced by the route)

- **`metadata.name`, `metadata.version`, `metadata.description`, `metadata.author`** are all **required**. Missing any → `400 INVALID_MANIFEST`.
- **`actions`** must be a non-empty array. Each action must have **`id`, `method`, `path`, `script`** — and `scripts[action.script]` must exist → else `400 MISSING_SCRIPT`.
- **Action IDs are camelCase** (`getObservations`, not `get-observations`). The ID is the last path segment of the invocation URL.
- **`method` is cosmetic for invocation** — the runtime only exposes `POST /v1/ext/{name}/{actionId}` (and the instance-scoped variant). The route checks `action.method !== 'POST' && action.method !== req.method`; since the route itself is POST-only, in practice **all actions are called with POST**. (The `gen-extension-consumption-rules` seed states this explicitly: "ALL actions use POST even if manifest says GET.")
- **`config`**: each key may be `{ type, description, required, default }`. At install time the route **collapses each config key to its `default` value** (see `extensions.ts` 197–209) and stores that as `ext.config`. The `type`/`description`/`required` metadata is not preserved into `ext.config` — only the default ends up in `ctx.config`. MSM/operator can later override these (see §6).
- **`limits`**: `memory_mb`, `timeout_ms`, `max_api_calls`. Each is **capped** at the node's configured maximum (`config.extension*`). You can request less, never more.
- **`required_apis`**, **`federation: { advertise, capabilities }`**, and **`instances: { supported, config_per_instance }`** are optional. `instances.supported` must be a boolean if present.
- **`schedules`** are stored under `ext.config.__schedules` and only registered with the scheduler **on activate** (see §5, §7). Each schedule needs `id`, `action`, `cron`; `instance_scope` and `input` are optional.

---

## 3. Action script format

Each action is one `.js` file. **The ONLY top-level statement allowed is the default export.** No top-level `const`/`let`/`var`/`function`/`class`/imports. All helpers go **inside** the function. This is the #1 silent-crash cause.

```javascript
// scripts/getObservations.js
export default async function(ctx, input) {
  // helpers live INSIDE — never at top level
  function normalize(raw) {
    return { temp: Number(raw.t), at: new Date(raw.ts).toISOString() };
  }

  if (!input || !input.stationId) return { error: 'stationId required' };

  // ctx.config.apiBase came from the manifest config default (or MSM override)
  const base = ctx.config.apiBase;
  // URLSearchParams is NOT available — build query strings by hand:
  const url = base + '?station=' + encodeURIComponent(input.stationId);

  const resp = await ctx.fetch(url);
  if (!resp.ok) {
    ctx.log.error('upstream failed', { status: resp.status });
    return { error: 'Request failed with status ' + resp.status };
  }
  const data = JSON.parse(resp.text);            // resp.text IS a raw string — parse it
  const obs = (data.observations || []).map(normalize);

  await ctx.memory.set('cache.' + input.stationId, { obs, fetchedAt: new Date().toISOString() });
  return { stationId: input.stationId, count: obs.length, observations: obs };
}
```

Key rules baked into the `gen-extension-code` seed:

- **`ctx.memory.get()` returns the ALREADY-PARSED value (or `null`).** Never `JSON.parse()` it. `JSON.parse(await ctx.memory.get(...))` crashes.
- **Always null-check memory reads** — on first run nothing exists: `const items = await ctx.memory.get('items') || [];`
- **`ctx.fetch().text` IS a raw string** — `JSON.parse(resp.text)` is correct here (the opposite of memory).
- **Actions cannot call each other.** There is no `ctx.callAction()`/`ctx.getData()`. If two actions share logic, **duplicate the helper** in both files, kept identical.
- **No HTML entities in code** (`&gt;`, `&amp;`, etc.) — the sandbox runs raw JS; entities are syntax errors.

### The special `@activate` / init action

An action wired to a `cron: "@activate"` schedule runs **when the extension is activated and on every server restart**. Use it to bootstrap runtime data. Because it runs repeatedly, it **MUST be idempotent** — check before overwriting:

```javascript
// scripts/init.js
export default async function(ctx, input) {
  // Idempotent: only seed if missing
  if (!(await ctx.memory.get('watchlist.items'))) {
    await ctx.memory.set('watchlist.items', []);
    ctx.log.info('Initialized empty watchlist');
  }
  return { ok: true };
}
```

---

## 4. The full `ctx` API surface

The `ctx` object is **constructed per request** in `extensions.ts` (non-instance route ~1118–1296; instance route ~875–1050) and in `mcp/extensions.ts` for MCP invocation. Below is exactly what exists — invoking anything not listed crashes ("ctx.X is not a function"). This matches the `gen-sandbox-constraints` seed.

### `ctx.memory`

| Method | Behavior |
|--------|----------|
| `get(key)` | Reads from **this extension's own namespace** `ext:{name}` (or `ext:{name}.{instanceId}` for instance actions). Returns the **already-parsed value** or `null`. |
| `set(key, value)` | Writes to the extension's own namespace. Stored with `visibility: 'public'`, so anyone can read it back. Auto-increments `version`. |
| `search(prefix)` | Returns **`{ key, value }[]`** — NOT strings. Loads ALL matching keys (no pagination); use specific prefixes. Iterate with `for (const { key, value } of results)`. |
| `delete(key)` | Deletes a key from the extension's namespace. |
| `getPublic(namespace, key)` | Reads a **public** memory value from **another** namespace. Returns the value only if its `visibility === 'public'`, else `null`. |

**The OWN-namespace-only caveat (critical):** `ctx.memory.get()` ONLY sees `ext:{name}`. Owner-authored data — Memory artifacts (seed/lookup tables), settings, translations — lives in the **owner's** namespace. To read it, use:

```javascript
const lookup   = await ctx.memory.getPublic(ctx.caller.gaii, 'lookup.data')   || [];
const settings = await ctx.memory.getPublic(ctx.caller.gaii, 'settings.config') || {};
```

`ctx.caller.gaii` is the resolved GHII/GAII of the invoking user (see `ctx.caller`). `getPublic` also resolves bare owner names to the owner's agent GAII, but passing `ctx.caller.gaii` is the canonical form.

### `ctx.fetch(url, opts?)`

The only outbound-internet primitive. SSRF-validated (`validateOutboundUrl`) before the request; blocked URLs throw `Fetch blocked: <reason>`. 30-second timeout. Returns:

```javascript
{ status: number, ok: boolean, text: string, headers: Record<string,string> }
```

- **`text` is a decoded Unicode string** — charset is auto-detected from the `Content-Type` header, then XML prolog, then HTML `<meta charset>`, with a guard that trusts valid UTF-8 multibyte over a mislabeled charset. You never decode manually.
- For JSON APIs: `const data = JSON.parse(resp.text);`. For XML/RSS: parse `resp.text` with regex/string methods.
- `opts`: `{ method, headers, body }`.

### `ctx.wallet`

```javascript
ctx.wallet.consume(amount, reason) // → { success: true } | { success: false, error }
ctx.wallet.getBalance()            // → number (the OWNER's GHII morsel balance)
```

- `consume` debits **only the calling agent/owner's own balance** (resolved to the GHII). It is capped at `config.extensionMaxDebitPerCall` per call (throws `DEBIT_LIMIT: ...` if exceeded) and records an `extension_consume` transaction.
- There is **no** `hold`/`release`/`transfer` — extensions cannot move other agents' funds.

### `ctx.consent`

```javascript
ctx.consent.check(gaii, scope)   // → boolean (is there an active consent with purpose === scope)
ctx.consent.require(gaii, scope) // → throws "CONSENT_REQUIRED: <scope>" if missing
```

### `ctx.trust`

```javascript
ctx.trust.getScore(gaii) // → number (agent's trustScore, or 0). System-computed; read-only — no adjust.
```

### `ctx.caller`

```javascript
ctx.caller.gaii  // resolved identity of the invoker (GHII for owners, GAII for agents)
ctx.caller.owner // bare owner name
ctx.caller.roles // e.g. ['owner'] or ['agent']
```

### `ctx.config`

The extension's config object — the manifest `config` keys collapsed to their defaults, plus any MSM/operator overrides (§6). Also carries `__schedules` internally. Read config values like `ctx.config.apiBase`.

### `ctx.instance` (instance-scoped actions only)

For multi-instance extensions, instance actions receive `ctx.instance = { id, config }`. Single-instance extensions do not get this property — don't reference it unless the blueprint requires multi-instance.

### `ctx.log`

```javascript
ctx.log.info(msg, data?)
ctx.log.warn(msg, data?)
ctx.log.error(msg, data?)
```

There is **no `console.log`** — use these.

### `ctx.notify(message, opts?)`

```javascript
await ctx.notify('Watchlist updated', { title: 'weather-data', priority: 'normal', channel: 'extension' });
```

Appends a notification object to the owner's private `notifications.<owner>` memory list (trimmed to last 100). Returns `true`. **Signature is `(message: string, opts?: { title?, priority?, channel? })`** — not a topic+payload pair.

### `ctx.email(to, subject, body)`

Returns `false` if SMTP isn't configured. Tiered authorization: self (caller's verified email), operator-granted `emailPolicy: 'unrestricted'`, or an active `extension_email` consent scoped to `ext:{name}`. **Not available via MCP invocation** (returns `false`).

### Sandbox limits — what is NOT available

From `gen-sandbox-constraints`: no Node (`require`, `process`, `Buffer`, `fs`, `crypto`); no Web APIs (`URLSearchParams`, `URL`, `TextEncoder/Decoder`, `fetch` — use `ctx.fetch`, `atob/btoa`, `structuredClone`, Web Crypto); no browser globals (`document`, `window`, `navigator`); no timers (`setTimeout`/`setInterval`); no `console`; no `import`/`require` (except the single `export default`). ECMAScript built-ins (`JSON`, `Math`, `Date`, `RegExp`, `Promise`, `Map`, `Set`, `encodeURIComponent`, etc.) ARE available.

> **No `ctx.task` / `ctx.api` in the real runtime.** The guide's §4.3 task-assignment example uses `ctx.api.get/post` and `ctx.task.create` — these are **not** present in the `ExtensionCtx` built by `extensions.ts`. To dispatch work to an agent from server side, you'd have to model it within the listed `ctx` surface (e.g. write an assignment record to memory that an agent polls); the convenient `ctx.task` helper described in the guide is not wired into the sandbox.

---

## 5. The `@activate` / init pattern (copying owner seed data)

There are **two distinct positions** in the codebase on whether the init action should copy owner-namespace translations/settings into `ext:{name}`:

- **The generator's current guidance** (`gen-namespace-rules`, `gen-extension-code` "Init Action" section): **Do NOT copy translations/settings.** Cortex reads owner data (`service.i18n.fi`, `settings.config`) **directly** via `AIMEAT.data.get(key)`. The init action should only initialize **extension-owned runtime data** (empty watchlists, caches, logs).

  ```javascript
  // init.js — generator-preferred: runtime data only
  export default async function(ctx) {
    if (!(await ctx.memory.get('watchlist.items'))) {
      await ctx.memory.set('watchlist.items', []);
      ctx.log.info('Initialized empty watchlist');
    }
    return { ok: true };
  }
  ```

- **The older stack guide** (`building-extension-cortex-app-stack.md` §4.2) shows copying `mytool.i18n.fi`/`settings` from the owner namespace into `ext:{name}` so cortex can read them unauthenticated.

**Follow the generator's guidance** when building via this pipeline: translations and settings are **owner data**, cortex reads them with `AIMEAT.data.get()`, and the init action does **not** copy them. Copy into `ext:{name}` only data the **extension itself owns and serves** to unauthenticated readers.

Registration mechanics (verified in `extensions.ts` activate route, 452–512): on activate, each manifest schedule becomes a `ScheduledJobRecord` (id `ext:{name}:{schedule.id}`) and is added to the scheduler if not already present; then `scheduler.runActivateJobs(name)` fires all `@activate` jobs immediately. On deactivate/uninstall those jobs are removed.

---

## 6. MSM pairing — config injection via `ctx.config`

An extension is a **project-agnostic platform capability**. Anything project- or deployment-specific (API base URL, auth tokens, tuning thresholds) is delivered through **config**, surfaced to the script as `ctx.config`.

- The manifest `config:` block declares keys and their **defaults**. At install these defaults populate `ctx.config`.
- An **MSM** (Manifest/Service definition) or operator can override config values after install. The extension code reads them generically:

  ```javascript
  const base = ctx.config.apiBase;                 // from manifest default or MSM override
  const ttl  = ctx.config.cacheTtlMinutes || 15;   // null-safe default
  ```

The extension never hard-codes a project's API endpoint — it reads `ctx.config.apiBase` (and the **spec's `dataSources[].baseUrl`** tells the code generator which real URL to wire as the default). This keeps one extension reusable across nodes/deployments.

---

## 7. Install + activate

### REST (verified in `extensions.ts`)

| Step | Request | Notes |
|------|---------|-------|
| Install | `POST /v1/extensions` | Body `{ manifest: "<yaml>", scripts: { "file.js": "<code>" } }` (`ExtensionInstallSchema`: manifest ≤100 KB, each script ≤512 KB). Requires `operator` role, or `owner` if `config.extInstallRole === 'owner'`. Returns `201` with the created record (status `inactive`). |
| Activate | `POST /v1/extensions/:name/activate` | `requireRole('owner')`. Sets status `active`, registers schedules, runs `@activate` jobs. |
| Deactivate | `POST /v1/extensions/:name/deactivate` | Removes scheduled jobs. |
| Get detail | `GET /v1/extensions/:name` | Add `?full=true` (auth required) to include `scriptContent`. |
| Uninstall | `DELETE /v1/extensions/:name` | Cleans `ext:{name}` (and instance) memory + scheduled jobs. |
| Update one action's script | `PATCH /v1/extensions/:name/actions/:actionId` | Body `{ scriptContent }`. |

> Note: the REST install body is `{ manifest, scripts }` (JSON), **not** a multipart `-F file=@.zip` upload. The ZIP form is the **presigned-upload / MCP** path described below. The guide's `curl -F file=@mytool.zip` against `/v1/extensions` does not match the JSON-body route.

### MCP tools (verified in `mcp/extensions.ts`)

| Tool | Purpose |
|------|---------|
| `aimeat_extension_install` | Inline mode: pass `manifest` (YAML string) + `scripts` (map). **Upload mode:** omit `manifest` → returns `{ mode: 'upload', upload_url, upload_method: 'PUT', content_type: 'application/zip', ... }`. PUT a ZIP (`manifest.yaml` at root, `scripts/*.js`) to that URL. |
| `aimeat_extension_activate` | Sets status `active` (also triggers capability aggregation). |
| `aimeat_extension_deactivate` | Sets status `inactive`. |
| `aimeat_extension_delete` | Deactivates first if active, then deletes. |
| `aimeat_extension_invoke` | Runs an action: `{ extension_name, action_id, input?, instance_id? }`. |
| `aimeat_extension_get` / `aimeat_extension_list` | Read installed extensions (list shows only active ones). |

**Presigned upload mode** (the file never passes through the AI context): call `aimeat_extension_install` with no `manifest`, get `upload_url`, `PUT` the raw ZIP. Single-use token, 60-min TTL, size-capped.

> **MCP-vs-REST runtime difference (verified):** the MCP `_invoke` `ctx.fetch` does **not** run the SSRF `validateOutboundUrl` check and has simpler charset handling; its `ctx.wallet.consume` lacks the per-call debit cap. For test/probe fidelity, prefer invoking via the REST `POST /v1/ext/...` path (which the generator's probe endpoint uses).

### Invoking an action

```
POST /v1/ext/{name}/{actionId}                  # single-instance
POST /v1/ext/{name}/{instanceId}/{actionId}     # instance-scoped
```

The response is the AIMEAT envelope: `{ ok: true, data: <action return value>, ... }`. **`ok` is always `true`** even when the action returned an error — the actual result (success data or `{ error: "..." }`) is in `data`. Extension must be `active` (else `503 EXTENSION_INACTIVE`).

---

## 8. Probe + golden samples + reconciliation

After the extension is installed and activated, you **probe** it to capture the **real** response shapes — then feed those shapes into the cortex/app prompts so downstream code is written against reality, not against the interview's guessed `sampleEntry`.

**Generator probe endpoint** (verified, `generator.ts` 559–614):

```
POST /v1/generator/:projectId/probe-extension
Body: { extensionName, scenarios: [ { action, input } , ... ] }
```

For each scenario it does a real `POST /v1/ext/{extensionName}/{action}` (server-to-server, with the owner's bearer token) and returns:

```json
{ "extensionName": "weather-data",
  "results": [
    { "action": "getObservations", "input": {"stationId":"helsinki"},
      "status": 200, "response": <unwrapped data field of the envelope> }
  ] }
```

Note it **unwraps the envelope** (`response = body.data ?? body`), so you see the action's actual return value.

**Probe reconciliation** = compare the **live shape** (real field names/types from the probe) against the **interview's `sampleEntry`** (the shape you described up front). Where they differ, the live shape wins — update the spec's `output`/`example` and the memory-key examples to use the EXACT field names returned. The `gen-extension-spec` seed insists on this ("Use EXACT field names from data source sample entries. Copy character-for-character.") precisely so the probe and the spec line up.

For the mechanics of running probes and golden-sample tests as part of the autopilot/manual loop, see **[Browser testing](./07-browser-testing.md)**.

---

## 9. The Extension SPEC contract

Before generating extension *code*, the pipeline generates an extension **spec** — a formal JSON contract that is **project-agnostic** (it knows nothing about any app, cortex, or UI). The exact prompt is the `gen-extension-spec` seed in `generator-prompt-seeds.ts`. The spec carries:

```json
{
  "name": "<kebab-case platform-capability name>",
  "description": "<one line>",
  "actions": [
    { "id": "<camelCase>", "description": "...", "method": "POST",
      "path": "/v1/ext/<name>/<actionId>",
      "input":  { "<param>": "<type and description>" },
      "output": { "<field>": "<type>" },
      "example": { "input": { ... }, "output": { ... } },   // REAL data from interview samples
      "errors": "<how errors are returned>" }
  ],
  "memoryKeys": [ { "key": "...", "type": "<TS type>", "description": "...", "example": "..." } ],
  "schedules":  [ { "id": "...", "action": "<actionId>", "cron": "...", "description": "..." } ],
  "config":     { "<key>": "<type — description>" },
  "dataSources": [ { "name": "...", "baseUrl": "<EXACT base URL>", "notes": "..." } ],
  "usage": {
    "callPattern": "POST /v1/ext/<name>/<actionId> with JSON body",
    "authRequired": true,
    "memoryNamespace": "ext:<name>",
    "readMemory": "GET /v1/memory/ext%3A<name>/<key> (public, no auth)"
  }
}
```

Spec rules that matter for the agent: action IDs **must** be camelCase; every action **must** carry a real `example` from the interview samples; `dataSources[].baseUrl` must be the **exact** upstream URL (the code generator wires it as the config default); `output` must list **concrete field names** — never `$ref` — because the test generator writes assertions against them. The name describes the **capability** ("weather-data"), not a project or "-monitor"/"-extension" suffix.

---

## 10. Known runtime pitfalls (checklist)

1. **`JSON.parse` on an already-parsed value.** `ctx.memory.get()` returns a parsed JS value (or `null`). `JSON.parse(await ctx.memory.get(...))` crashes. (But `JSON.parse(resp.text)` on a `ctx.fetch` result **is** correct — fetch `text` is a raw string.)
2. **Top-level statements.** Only `export default async function(ctx, input){...}`. Any top-level `const`/`let`/`function`/`class`/`import` crashes silently.
3. **`ctx.caller.gaii` is required for owner-data reads.** Use `ctx.memory.getPublic(ctx.caller.gaii, key)` — it's the GAII/GHII, not a bare username.
4. **Memory key may not exist yet.** First run returns `null`. Always `|| []` / `|| {}` before `.push`/`.length`/`.some`.
5. **`search()` returns `{ key, value }` objects, not strings.** Iterate `for (const { key, value } of results)`. It also loads ALL matches — use specific prefixes.
6. **No `URLSearchParams`/`URL`.** Build query strings manually with `encodeURIComponent`.
7. **No HTML entities in code.** `&gt;`/`&amp;` etc. are syntax errors in the raw-JS sandbox.
8. **Actions can't call each other.** No `ctx.callAction`. Duplicate shared helpers, kept identical.
9. **All actions are POST.** Regardless of the manifest `method`, invoke via `POST /v1/ext/{name}/{action}`.
10. **Envelope `ok` is always true.** The action's real result (incl. `{ error }`) is in `data`. Inspect `data`, not `ok`.
11. **`@activate` must be idempotent.** It runs on every activation and server restart — check before overwriting.
12. **`ctx.config` only holds defaults at install.** A config key with no `default` won't appear in `ctx.config` until an MSM/operator sets it — null-check.
13. **No `ctx.task` / `ctx.api`.** Despite the older guide, the real `ctx` has neither. Stay within the listed surface.

---

## See also

- [Spec formats: CSM / MSM / Memory / Translation (define + seed)](./03-spec-define-seed.md) — the owner-namespace artifacts the extension reads via `getPublic(ctx.caller.gaii, ...)`.
- [Cortex + App formats](./05-spec-cortex-app.md) — the browser layers that consume `ext:{name}` data and call extension actions.
- [Activation & registration reference](./06-activation-registration-reference.md) — every register/activate endpoint and MCP tool in one place.
- [Browser testing](./07-browser-testing.md) — probe execution, golden samples, and reconciliation mechanics.
- [Prompts in pipeline order](./02-prompts-in-order.md) — where the extension spec/code/test prompts sit in the sequence.
- [Agent playbook](./00-agent-playbook.md) — end-to-end use of this material.
