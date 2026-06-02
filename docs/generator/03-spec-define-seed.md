# Artifact Formats: CSM, MSM, Memory, Translation (Define + Seed phases)

> **Audience:** an AI coding agent (and advanced human devs) building an AIMEAT application by following the generator's prompt-driven workflow.
> **This doc covers** the four *declarative* artifacts produced in the Define and Seed phases — CSM, MSM, Memory seed, and Translation. For each: what it is, the exact YAML/JSON format with a real example, the validation rules enforced server-side, the registration endpoint (REST) + MCP tool if any, and how (or whether) it "activates". These four are declarative: **the pipeline runs no functional test on them** — registration success *is* the verification.
> **Read next:** [Extension format](./04-spec-extension.md) and [Cortex/App format](./05-spec-cortex-app.md) for the executable artifacts, [Activation & registration reference](./06-activation-registration-reference.md) for the full endpoint/MCP table, [Prompts in order](./02-prompts-in-order.md) for which prompt produces each artifact.

---

## Overview: where these four sit in the pipeline

The generator decomposes a blueprint into typed components. Four of those types are purely declarative — they describe data and integrations rather than execute code:

| Type | What it declares | Output format | Register endpoint | Activate? |
|------|------------------|---------------|-------------------|-----------|
| **CSM** | The service identity + data schema + consent + moderation + UI hints | YAML | `POST /v1/csm` | No — registration installs a schema lock |
| **MSM** | An external HTTP API integration (auth, endpoints, rate limits) | YAML | `POST /v1/msm` | No — declarative record only |
| **Memory** | Seed/default data (settings, config, static datasets) | JSON map of `{key: value}` | `POST /v1/memory` per key | No — writing the key *is* the install |
| **Translation** | Per-locale i18n strings | JSON `{locale: {flatKey: value}}` | `POST /v1/memory` per locale | No — writing the key *is* the install |

None of them have a "deactivate" or a probe/test step. Once the register call returns `201`/`200`, the artifact is live. (Extensions, cortexes and apps — the executable artifacts — *do* have activate/deactivate and tests; see [04](./04-spec-extension.md) and [05](./05-spec-cortex-app.md).)

> **Identity note.** All four are registered by an **owner session** (the agent acting as the human, `roles: ['owner']`). The memory/translation writes land in the **owner namespace** (GHII = `owner@node-id`) because `POST /v1/memory` resolves the caller's identity via `resolveIdentity()`. This is exactly why cortex reads translations/settings with `AIMEAT.data.get(...)` (owner namespace) and **never** from the `ext:` namespace.

---

## 1. CSM — Community Service Manifest

### What it is

The CSM is the **service identity**. One CSM per app. It declares:

- `service.name` / `type` / `description` — the service's identity (the `name` becomes the schema-lock prefix and the catalogue entry).
- `data_schema.required` / `optional` — the **raw source-data fields** the service stores. The parser turns this into a JSON Schema and locks it under the key prefix `csm.{service.name}` so that every `POST /v1/memory` write whose key starts with that prefix is validated.
- `consent_requirements`, `moderation`, `ui_hints` — metadata the clients use, not the backend.

> **CRITICAL — raw fields only.** The CSM `data_schema` carries **only fields that exist in the raw source data** (the blueprint "structures"). Computed/derived values — aggregates, scores, trends, risk levels, statistics — are produced by the **extension** and stored in *separate* memory keys; they do **not** belong in the CSM schema. The generator prompt enforces this (`generator-prompt-seeds.ts` → `gen-csm`): *"ONLY include fields that exist in the raw source data."* Avoid redundant fields (don't add a second `id` when the source already has a `guid`; don't store a constant).

### Exact format (real example)

This mirrors the EXACT template the CSM generator prompt produces (`generator-prompt-seeds.ts` → `gen-csm`):

```yaml
csm: "1.0"
service:
  name: bird-sightings
  type: directory
  description: "Community-reported bird sightings with species, location and date"
  version: "1.0"
schema_mode: open
data_schema:
  required:
    species:
      type: string
    observedAt:
      type: string          # ISO 8601 datetime — date/time fields are ALWAYS type: string
    lat:
      type: number
    lon:
      type: number
  optional:
    notes:
      type: string
      max: 500
    rarity:
      type: string
      enum: [common, uncommon, rare]
    count:
      type: integer
      min: 1
consent_requirements:
  visibility_default: public
  requires_consent: false
  consent_purpose: "Share sightings publicly with the birding community"
  data_retention: "365_days"
moderation:
  flags_enabled: true
  auto_hide_threshold: 5
  appeals_enabled: false
ui_hints:
  list_view: [species, observedAt, rarity]
  detail_view: [species, observedAt, lat, lon, count, notes]
  search_fields: [species, notes]
```

**YAML string rule (causes parse errors if violated):** every string value must be on **one line, double-quoted**. Never use `>` or `|` block scalars; never leave a string with special characters (`:`, `()`) unquoted. (`gen-csm` prompt opens with this rule because it is the #1 cause of failures.)

**Field shape rules:**
- `data_schema.required` and `data_schema.optional` are **maps** (`fieldName: { type: ... }`), not arrays.
- Field `type` ∈ `string | number | integer | boolean | array | object`.
- Constraints map to JSON Schema: `min`/`max` → `minLength/maxLength` (string), `minimum/maximum` (number/integer), `minItems/maxItems` (array); `enum` → `enum`; `format` → `format`. `array` takes `items` (a type string or nested field def); `object` takes `properties`.
- **All date/time fields are `type: string`** (description should mention ISO 8601).

### Validation (server-side, `validateCsm` in `services/csm-parser.ts`)

Registration is rejected with `400 VALIDATION_ERROR` if any of these fail:

- `csm` version present, `service.name`, `service.type`, `service.description` all non-empty.
- `data_schema.required` has **at least one field**.
- Every field (required + optional) has a `type`.
- `consent_requirements.visibility_default` ∈ `private | dmz | local | federation | public`.

Defaults applied by `parseCsm` when omitted: `schema_mode` → `open` (anything other than the literal `strict` becomes `open`), `type` → `directory`, `visibility_default` → `federation`, `requires_consent` → `true`, `auto_hide_threshold` → `5`. In `strict` mode the generated JSON Schema gets `additionalProperties: false`.

### Registration

| | |
|---|---|
| **REST** | `POST /v1/csm` — owner role required. Accepts **raw YAML** with `Content-Type: text/yaml` (or `application/x-yaml`), **or** JSON `{ "yaml": "<string>" }`, **or** a pre-parsed CSM JSON object. |
| **MCP tool** | *(none dedicated)* — the generator uses the REST route. |
| **Conflict** | `409 CSM_NAME_TAKEN` if `service.name` already exists. The generator namespaces the service name with the owner (`namespacedYaml`) to avoid cross-owner collisions, so the registered name is typically `{owner}-{name}` or similar. |

**On success** (`201`) the server: (1) generates the JSON Schema via `csmToJsonSchema`, (2) registers it in the Schema Locking system under `csm.{service.name}` with `applyTo: 'prefix'`, (3) stores the CSM record. From then on, any memory write to a key beginning `csm.{service.name}` is schema-validated (`422 SCHEMA_VALIDATION_FAILED` on mismatch).

### Activation

**None.** A CSM is fully live the moment `POST /v1/csm` returns `201`. There is no separate activate call. Verify with `GET /v1/csm/{name}` (returns the definition) or `GET /v1/memory/{schemaKey}/schema`.

### Tests

The pipeline runs **no functional test** on a CSM. The `201` response (schema locked, record stored) is the verification. The only way it "fails" later is if a memory write violates the locked schema — which surfaces during the *memory/seed* or *app* phases, not here.

---

## 2. MSM — Micro Service Manifest

### What it is

An MSM declares an **external HTTP API integration**: its auth scheme, its callable actions (endpoint, input/output field maps), category, and optional health check. It is a *declarative record* — the backend stores it but does not, by itself, proxy calls. An MSM is paired with an **extension** that actually performs the outbound `ctx.fetch()` calls (see [04](./04-spec-extension.md)); the MSM documents the contract and holds the auth-config env-var *names* (never the secret values).

### When to create one vs skip

| Situation | Create an MSM? |
|-----------|----------------|
| External API needs an **API key / bearer token / OAuth2 / query-param secret** | **Yes** — the MSM names the env var (`env_var` / `env_var_secret`) holding the credential, keeping it out of code and out of the AI context. |
| External API is a **public URL with no auth** | **No** — skip the MSM; the extension just `ctx.fetch()`es the public URL directly. |
| You only read/write AIMEAT memory and call other extensions | **No** — no external API, no MSM. |

> The MSM is the *registry of credentialed integrations*. If there is no credential to protect and no contract worth publishing, an extension fetching a public endpoint directly is simpler and correct.

### Exact format (real example)

```yaml
msm: "1.0"
service:
  name: weather-api
  description: "Current weather lookup by coordinates"
  homepage: "https://openweathermap.org"
  category: data
  tags: [weather, geo]
auth:
  type: query_param
  param_name: appid
  env_var: OPENWEATHER_API_KEY
actions:
  - id: current
    display_name: "Current weather"
    description: "Returns current conditions for a lat/lon pair"
    endpoint:
      method: GET
      url: "https://api.openweathermap.org/data/2.5/weather"
    input:
      lat: { type: number, required: true }
      lon: { type: number, required: true }
    output:
      temp: { type: number, from: "main.temp" }
      conditions: { type: string, from: "weather.0.main" }
    estimated_time_seconds: 2
health:
  endpoint: "https://api.openweathermap.org/data/2.5/weather"
  method: GET
  expected_status: 401
```

Field-def shorthand: a field may be a bare type string (`temp: number`) or an object (`temp: { type: number, required: true, from: "main.temp", enum: [...], items: ..., properties: {...} }`). The `from` key documents the JSON path in the external response that supplies the value.

### Validation (`validateMsm` in `services/msm-parser.ts`)

`400 VALIDATION_ERROR` unless all hold:

- `msm` version, `service.name`, `service.description`, `service.category` present.
- `service.category` ∈ `data | utility | image | communication | analytics | analysis`.
- `auth.type` ∈ `bearer | query_param | oauth2 | api_key | none`, and the conditional requirements:
  - `query_param` → `auth.param_name` required.
  - `oauth2` → `auth.token_url` required.
  - `api_key` → at least one of `auth.header`, `auth.param_name`, `auth.env_var`.
- **At least one action**, and each action needs `id`, `display_name`, `description`, `endpoint.method`, `endpoint.url`, and **at least one `output` field**.
- If `health` is present: `health.endpoint` and `health.method` required.

### Registration

| | |
|---|---|
| **REST** | `POST /v1/msm` — role gated by `config.msmInstallRole` (owner/operator per node config). Same body forms as CSM: raw YAML (`text/yaml`), `{ "yaml": "..." }`, or pre-parsed JSON. |
| **MCP tool** | *(none dedicated)* — REST route. |
| **Conflict** | `409 MSM_NAME_TAKEN`. The generator namespaces the name per owner. |

**Security note:** `GET /v1/msm/:name` is unauthenticated and **strips `env_var` / `env_var_secret`** from the returned definition so credential env-var names aren't leaked.

### Activation

**None.** The `201` response is the install. Verify with `GET /v1/msm/{name}`.

### Tests

No functional test in the pipeline. The MSM is exercised indirectly when its paired extension runs and actually calls the external API; that surfaces in the **extension** phase (see [04](./04-spec-extension.md)), not here.

---

## 3. Memory — seed data

### What it is

The Memory artifact is the app's **initial key-value seed**: settings/config defaults and any static datasets the app needs on day one (lookup tables, reference data, category lists, an empty index scaffold). The generator's `gen-memory` prompt produces a **JSON map** of `{ memoryKey: value }`; each entry is written with one `POST /v1/memory` call.

### The golden rule: one dataset = ONE key

> **PREFER fewer, larger keys.** A lookup table, reference dataset, or config object is **ONE key holding the full array/object** — NOT one key per row. A list of 300 items is one key `catalog.data` containing the full array, not 300 keys. A single memory value can hold arrays + nested objects up to several MB. (`gen-memory` prompt: *"There is NO reason to split a dataset across multiple keys when it logically belongs together."*)

This is how **static interview data flows into the app**: whatever fixed dataset the interview/blueprint captured (categories, a seed catalogue, default thresholds) becomes one or a few memory keys here, read at runtime by the cortex/app via `AIMEAT.data.get(key)`.

### Key & value conventions

- **Keys**: lowercase, dot-namespaced (`namespace.sub.key`). The generator service-prefixes raw keys with the `serviceSlug` (e.g. `bird-sightings.catalog.data`) to avoid cross-service collisions; keys that already start with the slug, and `__meta`/`__index` keys, are left as-is.
- **Standard metadata pattern** (from `gen-memory`):
  - `namespace.__meta` — `{ version, description, keyFormat }`.
  - `namespace.__index` — a *lightweight* index (list of dates, counts, pointers) — **not** a copy of the data.
  - `namespace.__config` — TTLs, thresholds, weights.
  - `namespace.YYYY-MM-DD` — date-bucketed data (one key per day) — **dates MUST be `YYYY-MM-DD`**.
  - `namespace.item-id` — individual items (use sparingly; prefer one big key).
- **All date/time values inside objects MUST be ISO 8601**: `"2026-03-14T13:00:00.000Z"`.

### Exact format (real example)

```json
{
  "settings.__meta": {
    "version": "1.0",
    "description": "Default app settings for the bird-sightings service",
    "keyFormat": "settings.<group>"
  },
  "settings.config": {
    "defaultRadiusKm": 25,
    "rarityColors": { "common": "#9CA3AF", "uncommon": "#3B82F6", "rare": "#EF4444" },
    "pageSize": 50
  },
  "catalog.data": [
    { "code": "EU-ROBIN", "common": "European Robin", "latin": "Erithacus rubecula" },
    { "code": "GR-TIT",   "common": "Great Tit",       "latin": "Parus major" }
  ],
  "sightings.__index": {
    "dates": [],
    "totalItems": 0,
    "lastUpdated": ""
  }
}
```

After registration with `serviceSlug = "bird-sightings"`, these are written as `bird-sightings.settings.config`, `bird-sightings.catalog.data`, etc.

### Validation (server-side, in `routes/memory.ts`)

There is no CSM-style structural validator for seed data, but `POST /v1/memory` still enforces:

- **Per-value size** ≤ `config.memoryMaxValueSizeKb` (else `413 QUOTA_EXCEEDED`).
- **Per-agent key count** ≤ `config.memoryMaxKeysPerAgent` (else `413`). This is the *real* cost of one-key-per-row — it burns the key quota.
- **Total memory quota** (default 10 MB) — `413` if exceeded.
- **Schema locking**: if the key matches a locked schema prefix (e.g. a `csm.*` prefix from a registered CSM), the value is validated → `422 SCHEMA_VALIDATION_FAILED` on mismatch. Seed keys under your own `namespace.*` are typically *not* under a CSM lock, so they write freely.

### Registration

| | |
|---|---|
| **REST** | `POST /v1/memory` with body `{ key, value, visibility }`. The route is declared `requireRole('agent')` + `requireScope('memory:write')`, but an **owner session passes** because owners bypass scopes and `resolveIdentity()` maps the owner to their GHII. The value lands in the **owner namespace**. The generator writes every seed key with `visibility: 'public'` so cortex/app (and other users, if public) can read it via `AIMEAT.data.getPublic(OWNER_GHII, key)`. |
| **MCP tool** | `aimeat_memory_write` (write), `aimeat_memory_read` / `aimeat_memory_read_public` / `aimeat_memory_list` / `aimeat_memory_search` (read). |
| **Update** | `PUT /v1/memory/:key` (optimistic-locked by `version`). The seed phase uses `POST` (create/overwrite). |

> **Visibility / namespace recap.** `private` = only the owner. `owner` = the owner's DMZ (agents under the same owner). `public` = readable by anyone (federation zone). Seed data and translations are written `public` so the runtime cortex/app can read them without auth.

### Activation

**None.** Writing the key *is* the install. Verify with `GET /v1/memory/{key}` (owner session) or `GET /v1/memory/{ownerGhii}/{key}` (public read).

### Tests

No functional test. A `201`/`200` per key is the verification. (The pipeline does not, for example, assert the seed values are "correct" — they are author-provided data.)

---

## 4. Translation — per-locale i18n

### What it is

Translation artifacts are the app's **i18n strings**, one component **per locale**. The generator's `gen-translation` prompt produces JSON for a **single** locale (`{ "fi": { ... } }` *or* `{ "en": { ... } }`, never both in one component — the blueprint has a separate component for each locale). Each locale is stored as one owner-namespace memory key.

### Where it's stored

- Key format: **`{service-slug}.i18n.{locale}`** (e.g. `bird-sightings.i18n.fi`, `bird-sightings.i18n.en`). With no slug it falls back to legacy `i18n.{locale}`.
- Stored in the **owner namespace** via `POST /v1/memory` with `visibility: 'public'` — exactly like seed data.
- **CRITICAL:** translations are **owner data**, not extension data. The cortex/app reads them with `AIMEAT.data.get('{slug}.i18n.{locale}')` (owner namespace). **NEVER** read translations from the `ext:` namespace via `getPublic('ext:...')`. The extension init action does **not** copy translations.

### Key conventions

- **Flat, dot-namespaced keys** grouped by UI section: `app.list.title`, `app.filters.status`, `app.nav.home`, plus domain terms (`domain.type.*`, `domain.status.*`).
- **`${variable}` interpolation** for dynamic values: `"Found ${count} items"`.
- **EN must mirror FI exactly** — both locale components MUST use the **identical key structure**, because the app looks up the same key in either locale. A key present in one locale but missing in the other is a bug (the app falls back to showing the raw key).
- Include *all* visible text: labels, buttons, tooltips, empty states, error messages. Use plural-aware keys where needed (`item.one` / `item.many`).
- Finnish must be natural Finnish with correct characters (ä, ö, å).

### Exact format (real example)

Finnish component (`gen-translation` with label "Finnish (fi) Strings"):

```json
{
  "fi": {
    "app.title": "Lintuhavainnot",
    "app.nav.home": "Etusivu",
    "app.filters.status": "Tila",
    "app.filters.all": "Kaikki",
    "app.list.count": "Löytyi ${count} havaintoa",
    "app.empty": "Havaintoja ei löytynyt",
    "app.error": "Jokin meni pieleen",
    "domain.rarity.rare": "Harvinainen"
  }
}
```

English component (must mirror the *same* keys):

```json
{
  "en": {
    "app.title": "Bird Sightings",
    "app.nav.home": "Home",
    "app.filters.status": "Status",
    "app.filters.all": "All",
    "app.list.count": "Found ${count} sightings",
    "app.empty": "No sightings found",
    "app.error": "Something went wrong",
    "domain.rarity.rare": "Rare"
  }
}
```

### The `t()` lookup convention

The app/cortex uses a small `t(key, translations, vars)` helper (generated into the app, see `generator-prompts-base.js`). Behaviour:

1. **Flat key first** — look up the literal flat key (`translations["app.list.title"]`). The generator emits flat dot-keys, so this is the normal hit path.
2. **Then dot-path** — if not found as a flat key, walk the dot path into a nested object (legacy/nested translation files).
3. **Fallback** — if still not found, return the key string itself (so missing keys are visible, not blank).
4. **Interpolate** `${var}` tokens from `vars`.

> The flat-key-first order matters: the generator produces `"tab.search": "Haku"` (a single flat key), so `t()` must check the flat key *before* attempting to resolve `tab.search` as a nested path. (Noted in CLAUDE.md "Common mistakes": *Flat translation keys — `t()` must check flat key before nested path.*)

### Validation

No dedicated translation validator. Each locale is a `POST /v1/memory` write, subject to the same memory quotas as seed data. The "EN mirrors FI" rule is enforced by the generation prompt and by app correctness at runtime — **not** by the server. If the two locale objects diverge, registration still succeeds; the bug only shows up when the app renders the missing-key fallback.

### Registration

| | |
|---|---|
| **REST** | `POST /v1/memory` per locale, body `{ key: "{slug}.i18n.{locale}", value: {flatKeyMap}, visibility: "public" }`. Owner session (see Memory section for why the agent-scoped route accepts owners). |
| **MCP tool** | `aimeat_memory_write` (same as any memory key). |

### Activation

**None.** Writing the locale key *is* the install. Verify with `GET /v1/memory/{slug}.i18n.{locale}`.

### Tests

No functional test. Two `201`/`200` responses (one per locale) is the verification.

---

## Phase summary checklist

When walking the Define + Seed phases for an app, the agent should, per declarative component:

1. Run the matching generation prompt (`gen-csm` / *(MSM has no seed prompt — author by hand from `msm-parser.ts` rules and `GET /v1/msm/templates`)* / `gen-memory` / `gen-translation`) — see [Prompts in order](./02-prompts-in-order.md).
2. POST to the right endpoint: `/v1/csm`, `/v1/msm`, or `/v1/memory` (per key/locale).
3. Confirm `201`/`200`. **There is no activate step and no test step** for these four — a successful register is done.
4. For CSM: remember the schema is now *locked* at prefix `csm.{name}`; later memory writes under that prefix must conform.
5. For Memory/Translation: remember they live in the **owner namespace** and are read at runtime via `AIMEAT.data.get(...)` / `getPublic(OWNER_GHII, ...)`, **never** from `ext:`.

> **Source discrepancy worth flagging:** the prompt-seed file (`generator-prompt-seeds.ts`) contains `gen-csm`, `gen-memory`, and `gen-translation` but **no MSM seed prompt** — there is no `gen-msm` entry. MSM YAML is authored from the parser's validation contract (`services/msm-parser.ts`) and the live templates at `GET /v1/msm/templates`. Treat MSM as a less-automated, by-hand artifact relative to the other three.

---

## See also

- [Prompts in pipeline order](./02-prompts-in-order.md) — which prompt produces each artifact and where its text is sourced.
- [Extension format](./04-spec-extension.md) — the executable artifact that pairs with an MSM and computes derived values stored in separate memory keys.
- [Cortex / App format](./05-spec-cortex-app.md) — the runtime that reads these seed/translation keys via `AIMEAT.data.get` / `getPublic`.
- [Activation & registration reference](./06-activation-registration-reference.md) — full table of every register/activate endpoint and MCP tool.
- [Agent playbook](./00-agent-playbook.md) — end-to-end use of this material.
