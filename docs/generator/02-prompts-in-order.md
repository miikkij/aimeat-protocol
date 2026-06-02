# Every Prompt in Pipeline Order

> **Audience:** an AI coding agent (and advanced human devs) self-running the AIMEAT generator's prompt-driven workflow. **This doc covers:** every prompt the pipeline fires, in firing order, with its source file/seed id, the inputs it injects, the output shape it expects, and the gotchas. This is the *script* — when you play both interviewer and pipeline-walker, you fire these prompts in this order.
>
> **Read first:** [`01-prompt-driven-workflow.md`](./01-prompt-driven-workflow.md) (the pipeline + generator API endpoints). **Read next:** [`03-spec-define-seed.md`](./03-spec-define-seed.md), [`04-spec-extension.md`](./04-spec-extension.md), [`05-spec-cortex-app.md`](./05-spec-cortex-app.md).

---

## How prompts are sourced (two homes)

There are **two** places prompt text lives, and you must know which is authoritative for each prompt:

1. **Database seeds — the live source of truth for per-component code/spec/test prompts.**
   File: `aimeat/src/services/generator-prompt-seeds.ts` (array `GENERATOR_PROMPT_SEEDS`, each entry a `PromptSeedEntry`). These are fetched **at runtime** via
   `GET /v1/generator/:projectId/prompts/:componentId` (optionally `?type=spec` or `?type=test`).
   The route picks a seed **id** based on the component's `type`/`subtype`, then `buildPrompt()` resolves the `{{variable}}` placeholders (resolvers in `aimeat/src/services/generator-prompts/resolvers.ts`) using the live project state (blueprint, interview spec, completed components, specs). The seed header says it plainly: *"DO NOT summarize, rewrite, or 'improve' these. They are calibrated."*

2. **Browser JS builders — the interview & blueprint prompts (not yet migrated to seeds), plus reference/backup copies of everything else.**
   - Interview + blueprint: `aimeat/public/js/services/generator-prompts-build.js` → `buildInterviewPrompt()`, `buildBlueprintPrompt()`. These are also mirrored as seeds `gen-interview` / `gen-blueprint` and served via `GET /v1/generator/:projectId/prompts` (no componentId = blueprint prompt). Either copy is faithful; the seed is what the API returns.
   - Spec prompt builders: `generator-specs.js`.
   - Cortex code prompt builders: `generator-prompts-cortex-data.js` / `-feature.js` / `-app.js` (mirrored into seeds `gen-cortex-data` / `gen-cortex-component` / `gen-cortex-app-domain`).
   - Test prompt builders: `generator-prompts-test.js` (mirrored into the `gen-test-*` seeds).
   - Fix/reflection/edit/impact builders: `generator-prompts-fix.js` (a subset mirrored: `gen-reflection`, `gen-fresh-generation`, `gen-fix`).

   All of `generator-prompts-build.js`, `-test.js`, `-fix.js`, `-specs.js`, `-cortex-*.js` carry a `@deprecated`/"DEPRECATED — kept as backup/reference" header. They are accurate references, but **the API returns the seed text**, not these files.

> **Agent rule:** when you self-run the human path, you don't need to call the API at all if you're driving everything yourself — but if you *do* call `GET .../prompts/:componentId`, you get the calibrated seed with all `{{variables}}` already resolved from your project state. Prefer that over hand-assembling from the JS builders.

---

## Master firing order (one full project build)

This is the order prompts fire across an entire build. "Per component" rows repeat once for each component of that type in the blueprint. Spec → test → code is the per-component inner loop for extension/cortex/app; define/seed components (csm, memory, translation) are code-only.

| # | Prompt | When it fires | Seed id (API) | Builder fn (reference) | Source file |
|---|--------|---------------|---------------|------------------------|-------------|
| 1 | **Interview** | Once, at project start | `gen-interview` | `buildInterviewPrompt()` | `generator-prompts-build.js` |
| 2 | **Blueprint** | Once, after interview spec is confirmed | `gen-blueprint` | `buildBlueprintPrompt()` | `generator-prompts-build.js` |
| 2f | Blueprint Fix | Only if blueprint JSON fails validation | *(no seed)* | `buildBlueprintFixPrompt()` | `generator-prompts-fix.js` |
| 3 | **CSM** code | Phase: define (per csm component) | `gen-csm` | `buildComponentPrompt('csm', …)` | seeds |
| 3 | **MSM** code | Phase: define (only if external API needs auth) | *(no dedicated seed)* | — | see [`03`](./03-spec-define-seed.md) |
| 4 | **Memory** code | Phase: seed (per memory component) | `gen-memory` | `buildComponentPrompt('memory', …)` | seeds |
| 5 | **Translation** code | Phase: seed (per locale → one component each) | `gen-translation` | `buildComponentPrompt('translation', …)` | seeds |
| 6a | **Extension Spec** | Phase: logic, before ext code | `gen-extension-spec` | `buildExtensionSpecPrompt()` | `generator-specs.js` |
| 6b | **Extension Test** (test-first) | After spec, before ext code | `gen-test-extension-spec` | `buildExtensionTestFirstPrompt()` / `buildTestPrompt()` | `generator-prompts-test.js` |
| 6c | **Extension Code** | After spec (+ optional test) | `gen-extension-code` | — | seeds |
| 6r | Reflection → Fix (ext) | Only on validation/test failure | `gen-reflection` → `gen-fix` (then `gen-fresh-generation`) | `buildReflectionPrompt`/`buildFixPrompt`/`buildFreshGenerationPrompt` | `generator-prompts-fix.js` |
| 7a | **Data API Spec** | Phase: cortex-data | `gen-data-api-spec` | `buildDataApiSpecPrompt()` | `generator-specs.js` |
| 7b | **Data Cortex Code** | After data API spec | `gen-cortex-data` | `buildDataCortexPrompt()` | `generator-prompts-cortex-data.js` |
| 7t | Data Cortex Test | After data cortex code | `gen-test-cortex-spec` | `buildTestPrompt('cortex', …)` | `generator-prompts-test.js` |
| 8a | **Component Spec** | Phase: components (per component cortex) | `gen-component-spec` | `buildComponentSpecPrompt()` | `generator-specs.js` |
| 8b | **Component Cortex Code** | After component spec | `gen-cortex-component` | `buildFeatureCortexPrompt()` | `generator-prompts-cortex-feature.js` |
| 8t | Component Cortex Test | After component cortex code | `gen-test-cortex-component` | `buildTestPrompt('cortex', …)` | `generator-prompts-test.js` |
| 9a | **App-Domain Spec** | Phase: cortex-app (after all components) | `gen-app-domain-spec` | `buildAppDomainSpecPrompt()` | `generator-specs.js` |
| 9b | **App-Domain Cortex Code** | After app-domain spec | `gen-cortex-app-domain` | `buildAppDomainCortexPrompt()` | `generator-prompts-cortex-app.js` |
| 9t | App-Domain Cortex Test | After app-domain cortex code | `gen-test-cortex-app-domain` | `buildTestPrompt('cortex', …)` | `generator-prompts-test.js` |
| 10a | **App Spec** | Phase: ui (per app component) | `gen-app-spec` | — | seeds |
| 10b | **App HTML Code** | After app spec | `gen-app` | — | seeds |
| 10t | App Test | After app code | `gen-test-app` | `buildTestPrompt('app', …)` | `generator-prompts-test.js` |
| — | Explain | (optional) after any code gen, before validate | *(no seed)* | `buildExplainPrompt()` | `generator-prompts-fix.js` |
| — | Impact / Edit | Only on a change request to an installed app | *(no seed)* | `buildImpactPrompt()` / `buildEditPrompt()` | `generator-prompts-fix.js` |

The exact seed-id selection logic lives in `aimeat/src/routes/generator.ts` (`GET .../prompts/:componentId`, ~line 1406–1454): `?type=test` → `gen-test-*`, `?type=spec` → spec seeds, default → code seeds. Cortex subtype (`data`/`component`/`app-domain`) routes to `gen-cortex-data`/`gen-cortex-component`/`gen-cortex-app-domain` (and the matching spec/test ids).

---

## 1. Interview prompt

- **Fires:** once, at the very start. You (the agent) play the analyst *and* the user — conduct the interview against the user's initial description and emit the spec JSON.
- **Source:** `buildInterviewPrompt(description, locale)` in `generator-prompts-build.js`; seed `gen-interview` (variables `disclaimer`, `description`, `language_instruction`, `locale`).
- **Injects:** the user's raw description; a language instruction block when `locale !== 'en'` (conduct the whole interview in that language; JSON keys/identifiers stay English; emit `"locale"` in the output root).

### Structure you must reproduce

- **Question budget:** max **20 questions total**. Use cases get the most (**up to 8**), every other section 2–3. Batch related questions; do not split every detail.
- **"YOU DECIDE" list (never ask the user):** implementation details (file formats, serialization, error handling, API design, caching); technical methods (fetch/parse/store/derive); UI component internals (chart lib, clustering, column order, widget placement); infrastructure (scheduler times, retention, timeouts, rate limits); data-schema internals (field names, ID generation, dedup, indexes); code-level choices (typography specifics, animation libs, export format); **auth, login, user management, access control, user counts, audience size** — AIMEAT handles all of these. *The user describes WHAT and WHY; the generator decides HOW.*
- **Section order (ask in this order, each stays open until the user confirms):**
  - **a) Use cases** (up to 8 — the most important section). Propose 3–5 concrete use cases as selectable A/B/C/D options, each with a one-sentence "what it means in practice". Don't advance until confirmed.
  - **b) Data sources** (2–3). Apply the **URL VALIDATION PROTOCOL** below.
  - **c) Data model** (1–2). Propose entities (name + one-line desc). Do NOT ask about fields/IDs/storage.
  - **d) Views & interactions** (2–3). Propose views (map/list/dashboard/cards/timeline). Don't ask about individual controls/columns.
  - **e) Style & look** (2–3, one batch). Mood, color feel, layout, admired references.
  - **f) Settings & external services** (1–2). Identify external API deps + required settings; ask the single key question: *"Will you share this service with other users or use it only yourself?"*; only recommend an admin app if clearly justified.
  - **g) Constraints & preferences** (1–2, one batch). Refresh cadence, UI languages, domain rules.

### URL validation protocol (mandatory for every external source)

1. **You test it.** Fetch; if it works, capture one raw entry verbatim (RSS `<item>`, JSON object) + note encoding/content-type/structure/auth.
2. **If you can't, help the user test it.** Say so honestly; give a concrete command (`curl -s "URL" | head -50` or "open in browser and paste"); analyze what they paste.
3. **If neither can access it, decide together:** **A) SKIP** (remove dependent use cases), **B) DEMO** (generate realistic mock loaded as static data on install, mark source `"demo"`), **C) DEFER** (keep but `"verified": false`, app must handle empty gracefully).

**HARD RULE:** never generate extension code that calls an *unverified* URL. Every URL in the final spec is `"verified": true` (tested by AI or user) **or** `"verified": false` with a `"fallback"` of `demo`/`defer`/`skip`. For verified sources, capture **`sampleEntry`** *and* the **`responseEnvelope`** (top-level wrapper structure, e.g. `{"totalResults":"number","companies":"array of company objects"}`) so the extension generator uses the right field names. For `type: "user-input"` with a full dataset, capture the **entire** dataset in `staticData` as `[{key, value}]` — never truncate.

### Output JSON skeleton (emit inside a ` ```json ` fence)

```json
{
  "version": "1.0",
  "locale": "en",
  "projectName": "Human-readable project name",
  "description": "Enhanced description incorporating all interview findings",
  "technicalLevel": "beginner|intermediate|advanced",
  "useCases": [
    { "id": "uc-1", "title": "Use case title", "description": "What the user does and why", "priority": "must-have|nice-to-have" }
  ],
  "dataSources": [
    {
      "id": "ds-1",
      "name": "Source name",
      "type": "rss|api|websocket|user-input|computed",
      "url": "https://... or null",
      "format": "xml|json|html|csv|unknown",
      "encoding": "utf-8|iso-8859-1|auto",
      "sampleEntry": "One raw entry from the source, copy-pasted exactly as-is",
      "responseEnvelope": "Top-level structure that WRAPS the entries, e.g. { \"totalResults\": \"number\", \"companies\": \"array of company objects\" }",
      "staticData": "type 'user-input' ONLY: COMPLETE dataset as array of {key, value}. Omit otherwise.",
      "updateFrequency": "realtime|minutes|hourly|daily|on-demand",
      "sampleFields": ["field1", "field2"],
      "notes": "Observations from fetching/analyzing the source",
      "verified": true,
      "verifiedBy": "ai|user",
      "fallback": "verified=false only: 'demo'|'defer'|'skip'. Omit if verified=true.",
      "demoData": "fallback='demo' only: 5-10 realistic sample entries. Omit otherwise."
    }
  ],
  "dataModel": {
    "entities": [
      {
        "name": "entity-name",
        "description": "What this entity represents",
        "fields": [
          { "name": "fieldName", "type": "string|number|boolean|date|coordinates|array|object", "required": true, "description": "What this field holds" }
        ],
        "relationships": ["related-to entity-name-2 via fieldName"]
      }
    ]
  },
  "views": [
    {
      "id": "view-1",
      "type": "map|list|dashboard|cards|timeline|form|detail|settings",
      "title": "View title",
      "description": "What this view shows",
      "dataEntities": ["entity-name"],
      "interactions": ["filter", "search", "create", "export"],
      "visualizations": ["bar-chart", "pie-chart", "heatmap"]
    }
  ],
  "style": {
    "mood": "minimal|playful|professional|data-dense",
    "colorPalette": "Description or hex values",
    "typography": "standard|compact|large-display",
    "layout": "single-page|tabbed|split-panel|fullscreen",
    "animations": "none|subtle|rich",
    "displayContext": "desktop|mobile|kiosk|embedded",
    "references": "Any reference apps or styles the user mentioned"
  },
  "externalServices": [
    {
      "name": "ServiceName",
      "purpose": "what it provides",
      "requiredSettings": [{ "key": "api_key_name", "type": "secret|string|url|number", "label": "Human-readable Label" }],
      "sharingModel": "shared|per-user",
      "suggestedBy": "ai"
    }
  ],
  "sharedService": true,
  "adminAppRecommended": false,
  "adminAppReason": "reason string or null — only set if adminAppRecommended is true",
  "userSettings": [
    { "key": "setting_name", "type": "string|number|boolean|select", "label": "Human-readable Label", "default": "default value" }
  ],
  "constraints": {
    "updateMode": "realtime|scheduled|on-demand",
    "scheduleInterval": "15m|1h|daily|null",
    "locales": ["fi", "en"],
    "domainRules": "Any domain-specific rules or edge cases",
    "notes": "Any additional context that doesn't fit above"
  },
  "interviewNotes": "Any important context from the conversation that doesn't fit above"
}
```

**Gotchas:** the JSON MUST be inside a ` ```json ` fence (the generator extracts it that way). `responseEnvelope` is what stops the extension from guessing `results` when the API returns `companies`. `staticData` must contain *every* row — the memory component writes it verbatim.

---

## 2. Blueprint prompt

- **Fires:** once, after the interview spec is confirmed. Decomposes the spec into components, phases, and a centralized data model.
- **Source:** `buildBlueprintPrompt(description, interviewSpec, availableCortexLibs)` in `generator-prompts-build.js`; seed `gen-blueprint` (variables `disclaimer`, `description`, `interview_spec_section`, `language_note`, `cortex_catalog`).
- **Injects:** the description; the full refined interview spec JSON; a language note if `locale !== 'en'`; an optional catalog of already-installed cortex libs to *reuse* (referenced via a component's `uses` field, not reimplemented).

### Output JSON skeleton

```json
{
  "architecture": "cortex-modular",
  "components": [
    { "id": "csm-1", "type": "csm", "label": "...", "produces": ["memory:service.schema"], "consumes": [] },
    { "id": "memory-1", "type": "memory", "label": "...", "produces": ["memory:settings.config"], "consumes": [] },
    { "id": "translation-1", "type": "translation", "label": "... (fi)", "produces": ["memory:i18n.fi"], "consumes": [] },
    { "id": "translation-2", "type": "translation", "label": "... (en)", "produces": ["memory:i18n.en"], "consumes": [] },
    { "id": "ext-1", "type": "extension", "label": "...", "produces": ["memory:items.*"], "consumes": ["memory:settings.config"],
      "schedules": [ {"action":"init","cron":"@activate"}, {"action":"collect","cron":"0 2 * * *"} ] },
    { "id": "cortex-data", "type": "cortex", "subtype": "data", "label": "Data layer",
      "produces": ["api:getData","api:search","api:addItem","api:removeItem"], "consumes": ["memory:items.*","memory:settings.config"], "uses": [] },
    { "id": "component-item-card", "type": "cortex", "subtype": "component", "label": "Item Card",
      "produces": ["ui:item-card"], "consumes": ["api:getData"], "uses": ["aimeat-ui-viewers"] },
    { "id": "component-search-input", "type": "cortex", "subtype": "component", "label": "Search Input",
      "produces": ["ui:search-input"], "consumes": ["api:search"], "uses": ["aimeat-ui-forms"] },
    { "id": "cortex-app", "type": "cortex", "subtype": "app-domain", "label": "App domain",
      "produces": ["api:init","api:render"], "consumes": ["ui:item-card","ui:search-input"], "uses": ["aimeat-ui-nav"] },
    { "id": "app-1", "type": "app", "label": "...", "produces": [], "consumes": ["api:init","api:render"] }
  ],
  "phases": [
    { "id": "define",     "label": "Define Service", "componentIds": ["csm-1"] },
    { "id": "seed",       "label": "Seed Data",      "componentIds": ["memory-1","translation-1","translation-2"] },
    { "id": "logic",      "label": "Capabilities",   "componentIds": ["ext-1"] },
    { "id": "cortex-data","label": "Data Layer",     "componentIds": ["cortex-data"] },
    { "id": "components", "label": "UI Components",   "componentIds": ["component-item-card","component-search-input"] },
    { "id": "cortex-app", "label": "App Domain",      "componentIds": ["cortex-app"] },
    { "id": "ui",         "label": "Application",     "componentIds": ["app-1"] }
  ],
  "dataModel": {
    "structures": {
      "Item": { "type": "object", "properties": {
        "id": {"type":"string"}, "title": {"type":"string"}, "status": {"type":"string"},
        "createdAt": {"type":"string","description":"ISO 8601"} } },
      "SearchResult": { "type": "object", "properties": {
        "totalResults": {"type":"number"}, "items": {"type":"array","items":{"$ref":"Item"}} } }
    },
    "memoryKeys": {
      "settings.config": { "type":"object", "properties": {"locale":{"type":"string"},"refreshHours":{"type":"number"}},
        "source":"config", "producedBy":"memory-1", "consumedBy":["ext-1","cortex-data"] },
      "items.data": { "type":"array", "items":{"$ref":"Item"},
        "source":"external", "producedBy":"ext-1", "consumedBy":["cortex-data"] }
    },
    "actions": {
      "ext:search":     { "input": {"query":{"type":"string"}}, "output": {"$ref":"SearchResult"} },
      "ext:addItem":    { "input": {"id":{"type":"string"},"name":{"type":"string"}}, "output": {"$ref":"Item"} },
      "cortex:search":  { "input": {"query":{"type":"string"}}, "output": {"$ref":"SearchResult"} },
      "cortex:addItem": { "input": {"id":{"type":"string"},"name":{"type":"string"}}, "output": {"$ref":"Item"} }
    }
  },
  "settings": { "service": [], "user": [] },
  "testScenarios": [
    { "component": "ext-1", "scenarios": [
      { "action": "init",   "input": {},                 "expect": "Initializes data structures", "type": "memory" },
      { "action": "search", "input": {"query":"AAPL"},   "expect": "Returns matching items from external API", "type": "external-api" }
    ] }
  ]
}
```

### Rules to enforce while producing the blueprint

- **`$ref` discipline:** build `structures` from the interview's real `sampleEntry`. **Every** memory key and every action input/output references a structure via `$ref`, and every `$ref` matches a key in `structures`. Extension and cortex actions that pass the *same* data must `$ref` the *same* structure (prevents shape drift).
- **dataModel completeness:** one entry per memory key pattern (use `YYYY-MM-DD` for date buckets); `source` ∈ `static|external|computed|config`; exactly one `producedBy`; array `consumedBy`. Stored field names are English camelCase even if the source differs. Prefer fewer, larger keys (a lookup table = one key).
- **Cron:** standard 5-field cron **or** `@activate`. Every field is required (`"0 2 * * *"`, `"*/15 * * * *"` — note the leading `*`). `@activate` runs on activation *and* every server restart, so it MUST be idempotent. If an extension has no schedules, omit the field.
- **Component decomposition (CRITICAL):** do **not** create one monolithic "feature cortex" per view. Identify **reusable components** (`subtype: "component"` — company-card, search-input, watchlist-badge, change-timeline) composed by **one** app-domain cortex. Always ≥3 cortex components: one `data`, one+ `component`, one `app-domain` (last).
- **Extension vs cortex vs app decision:** **EXTENSION = SERVER-ONLY WORK.** It must do something a browser cannot (external API behind CORS/auth, scheduled cron, server-to-server) *and* must work with no browser open. Quick test: "Does this fetch from an external server or run on a schedule?" YES → extension; NO → cortex/app. Do NOT create export/settings/query/filter/compute extensions. Reading/filtering/transforming memory → cortex; settings/i18n → cortex; export/download → app; display formatting → app.
- **Data pipeline verification (do BEFORE listing components):** *Step 1 — trace RENDER paths*: for each view, what fields does it need, where does each come from, is a transform needed; add a component for any field with no path. *Step 2 — trace USER ACTION paths*: for each use case, trace UI component → cortex-data `api:` method → extension action; both reads AND writes need complete paths. A write action with no `api:` method = a gap.
- **Translations:** one component per locale (never combine). **MSM:** only if the external API needs auth/keys/complex endpoints; public URLs need none. **Memory:** create for static/seed datasets and default config.

**Gotchas:** the example component names are generic placeholders — replace with domain names, don't copy them. `id` prefixes may be short (`ext-1`) but the `type` field is the full word (`extension`). `testScenarios` lives at the top level. Each scenario's `type` is `memory` (assert exact return values) or `external-api` (assert shape only; graceful error = pass). If blueprint JSON validation fails, the recovery is **`buildBlueprintFixPrompt(description, errors, interviewSpec)`** (`generator-prompts-fix.js`) — it lists the errors then re-embeds the full blueprint prompt and tells the model to generate fresh, not patch.

---

## 3. Spec prompts — "spec is king"

Before code, extension/cortex/app components first generate a **JSON spec** (the formal contract). Code is then generated to match the spec; probes validate code against the spec; on mismatch the **code** is regenerated, the spec stays. All four builders live in `generator-specs.js` and prefix with `INSTRUCTION_DISCLAIMER`; each says **"Return ONLY valid JSON. No markdown fences, no explanation."** `formatSpecForPrompt(spec, label)` renders a completed spec into downstream code prompts as a "formal contract — your code MUST match this exactly" section.

### 3a. Extension Spec — `buildExtensionSpecPrompt({ blueprint, blueprintComponent, interviewSpec })` · seed `gen-extension-spec`
Project-agnostic — describes a platform capability, no mention of cortex/app/UI. Injects: data sources (url, `responseEnvelope`, `sampleEntry`/`sampleResponse`, notes), blueprint actions for this component, data structures, this component's memory keys (reads/writes), schedules, config keys. **Output contract:** `{ name, description, actions[] (id, description, method:"POST", path:"/v1/ext/<name>/<id>", input, output, example{input,output}, errors), memoryKeys[] (key, type, description, example), schedules[], config{}, usage{callPattern, authRequired, memoryNamespace:"ext:<name>", readMemory} }`. **Rules:** copy field names character-for-character from sample entries; every action needs a real `example`; output types match the example; name = the capability (`weather-data`, not `weather-monitor-extension`); memory-key types precise enough to test (`Array<{ businessId: string, addedAt: string }>`, not `array`). See [`04-spec-extension.md`](./04-spec-extension.md).

### 3b. Data API Spec — `buildDataApiSpecPrompt({ extensionSpec, blueprint })` · seed `gen-data-api-spec`
Designs the client-side data-cortex library that wraps the extension. Injects the full extension spec + structures. **Output contract:** `{ name, libName (AIMEAT.<libName>), description, wrapsExtension, methods[] (name, description, params, returns:"Promise<…>", example, returnsExample (copied from the ext spec action's example.output), errorBehavior), translationAccess, settingsAccess }`. **Rules:** one method per extension action, clean verb names (no `ext` prefix); return types match the extension spec exactly; include `getTranslations(locale)` + `getSettings()` reading from the **owner** namespace via `AIMEAT.data.get()` (NOT the ext namespace); all methods return `null` on failure (no throws); do not list internal helpers (`callExt`, `readExtMemory`).

### 3c. Component Spec — `buildComponentSpecPrompt({ dataApiSpec, componentLabel, viewDefinition, translationKeys })` · seed `gen-component-spec`
Designs one reusable UI component. Injects the data API spec, the component label, optional view context, available translation keys. **Output contract:** `{ name, libName, purpose, render{ signature:"AIMEAT.<libName>.render(container, props)", props{}, returns:"{ el, destroy(), update(props) }" }, dataAccess[], example }`. **Rules:** props include interaction callbacks (`onSelect`, `onAdd`, `onRemove`) — the component never navigates or owns global state; props include `locale` + `translations` (component doesn't load i18n itself); names describe what they render.

### 3d. App-Domain Spec — `buildAppDomainSpecPrompt({ componentSpecs, dataApiSpec, useCases, translationKeys, views })` · seed `gen-app-domain-spec`
Designs the top composition layer. Injects all component specs, the data API spec, use cases, views, translation keys. **Output contract:** `{ name, libName, description, methods{init, render, t, switchLocale}, views[], navigation, viewComposition{view → [components]}, scriptDependencies[] (ORDERED: platform UI → data → components → this), example }`. **Rules:** `scriptDependencies` order matters; views cover ALL use cases and are reachable via navigation; `viewComposition` only references available components; business logic lives here, not in components.

App spec (`gen-app-spec`, builder for the app HTML) is covered in [`05-spec-cortex-app.md`](./05-spec-cortex-app.md).

---

## 4. Per-component generation prompts (DB seeds)

These produce the actual artifacts and are fetched live from `generator-prompt-seeds.ts` via `GET /v1/generator/:projectId/prompts/:componentId` (code prompt by default). `{{variables}}` are resolved by `resolvers.ts` from project state. **These are calibrated — do not rewrite.**

### Code seeds (default, no `?type`)

| Seed id | Component (`type`/`subtype`) | Reference builder | Key resolved variables |
|---------|------------------------------|-------------------|------------------------|
| `gen-csm` | `csm` | `buildComponentPrompt('csm')` | `context`, `label`, `component_context` |
| `gen-memory` | `memory` | `buildComponentPrompt('memory')` | `context`, `label`, `component_context` |
| `gen-translation` | `translation` | `buildComponentPrompt('translation')` | `context`, `label`, `component_context` |
| `gen-extension-code` | `extension` | seed-native | `context`, `label`, `spec_section`, `sandbox_constraints`, `html_entity_rules`, `completed_context` |
| `gen-cortex-data` | `cortex` / `data` | `buildDataCortexPrompt()` | `disclaimer`, `label`, `project_description`, `spec_section`, `structures`, `methods_to_export`, `extension_section` |
| `gen-cortex-component` | `cortex` / `component` | `buildFeatureCortexPrompt()` | `label`, `spec_section`, `use_case`, `view_section`, `data_cortex_api`, `translation_section`, `service_slug`, `platform_ui_section` |
| `gen-cortex-app-domain` | `cortex` / `app-domain` | `buildAppDomainCortexPrompt()` | `label`, `project_description`, `spec_section`, `feature_apis`, `data_cortex_section`, `translation_keys`, `service_slug`, `platform_layout_section`, `app_domain_template` |
| `gen-app` | `app` | seed-native | `context`, `label`, `cortex_script_loads`, `cortex_or_api_section`, `app_name`, `app_domain_lib`, `app_locale`, `app_theme`, … |

### Shared fragments (injected into many seeds via `{{…}}`)

- `gen-context` (`{{context}}`) — building blocks (CSM/MSM/Extension/App/Memory/Translation/Cortex), the **full `ctx` sandbox API** (`ctx.memory.get/set/search/delete/getPublic`, `ctx.fetch`, `ctx.wallet`, `ctx.consent`, `ctx.trust`, `ctx.caller`, `ctx.config`, `ctx.instance`, `ctx.log`), and AIMEAT Data Standards (ISO 8601 dates, dot-namespaced lowercase keys, camelCase action ids, BCP 47 locales, integer amounts).
- `gen-disclaimer` (`{{disclaimer}}`) — "follow every rule exactly" preamble.
- `gen-sandbox-constraints` (`{{sandbox_constraints}}`) — "BARE QuickJS engine — NOT Node.js, NOT a browser"; the only outside-world access is `ctx`.
- `gen-namespace-rules`, `gen-html-entity-rules`, `gen-extension-consumption-rules` — the last one teaches cortex that **all** extension actions are `POST /v1/ext/{name}/{action}`.

**Runtime fetch:** `GET /v1/generator/:projectId/prompts/:componentId` (requires agent role + `generator:read` scope) loads the project, finds the blueprint component by id, picks the seed id (see master table / `generator.ts` ~1406–1454), loads any upstream specs (extension spec for cortex, data-API spec for component/app-domain), gathers translation keys from completed components, then `buildPrompt(storage, promptId, runtimeData)` resolves `{{variables}}`. Response: `{ componentId, type, label, prompt }`. Add `?type=spec` or `?type=test` to get the spec/test seed instead.

**Extension top-level rule (non-negotiable):** in an extension action script the **only** top-level statement is `export default async function(ctx, input){ … }` — no top-level `const`/`let`/`function`/`class`. Helpers go *inside* the function. The seed `gen-extension-code` shows the exact shape (`export default async function(ctx, input) { … }`) and the YAML actions rule that every action entry begins with `- id:`. The cortex code builders live in `generator-prompts-cortex-data.js` / `-feature.js` / `-app.js`; details in [`05-spec-cortex-app.md`](./05-spec-cortex-app.md).

---

## 5. Test prompts

Produced by `buildTestPrompt(componentType, …)` and `buildExtensionTestFirstPrompt(blueprint, interviewSpec)` in `generator-prompts-test.js`; served via `?type=test`. Seed ids:

| Seed id | For | Notes |
|---------|-----|-------|
| `gen-test-extension-spec` | extension | Server-side sandbox; asserts exact field names from spec/golden samples |
| `gen-test-cortex-spec` | data cortex | Browser sandbox (`page.evaluate`) |
| `gen-test-cortex-component` | component cortex | Browser; tests `render(container, props)` |
| `gen-test-cortex-app-domain` | app-domain cortex | Browser; tests `init()` + `render()` |
| `gen-test-app` | app | Browser; verifies DOM, real content (not `i18n.keys`), live data |

**Zero-implementation-code rule:** test prompts emit *only* executable test code (no markdown fences, no `import`/`require`/`export`). Server tests end with `return { passed, errors, details }`; browser tests set `window.__testResults = { passed, errors, details }`. Tests are derived from **blueprint structures + actions + golden samples** (real probe responses captured from the live extension — "do NOT invent field names"). Test type drives assertion strictness: `[MEMORY]` → assert exact return values; `[EXTERNAL API]` → assert shape only, graceful error = PASS.

**Test-first for extensions:** `buildExtensionTestFirstPrompt()` generates the test *before* the extension exists — the test is the spec the extension must pass. It uses a placeholder ext name (`EXT_NAME`) and only the contract (structures + `ext:` actions + one sample entry); server-side helpers are `callExt(extName, actionId, body)` (envelope-unwrapped result) and `readExtMemory(extName, key)`.

Server sandbox helpers: `testFetch(url, opts)` (raw HTTP, auth injected), `callExt`, `readExtMemory`. **Idempotency:** before the first scenario, clean stale data via the extension's own remove/delete actions, then `init`. **JS pitfalls** the prompt warns about: never `===`/`!==` on arrays/objects (`value !== []` is always true — use `Array.isArray(v) && v.length === 0`); null-check with `=== null`. Browser cortex tests get the library at `window.AIMEAT.<camelCaseName>`, auth available, and must follow Call → Log full JSON → assert-not-null → assert-shape → assert-values → verify-side-effects (write then read back).

---

## 6. Fix / reflection / fresh / edit prompts

All in `generator-prompts-fix.js`. Only `gen-reflection`, `gen-fresh-generation`, `gen-fix` are mirrored as seeds; the rest are reference builders. Recovery escalates: **reflect → fix → (on repeated failure) fresh**.

- **`buildExplainPrompt(componentType, generatedResult, blueprintComponent)`** — *after* generation, *before* validation. Asks (2–5 sentences, no code): what does it export, what shapes does it return, does it match the blueprint `produces`. Catches contract drift early.
- **`buildReflectionPrompt(failedResult, errors, testContext)`** (seed `gen-reflection`) — **diagnose, do NOT write code.** Given the failed code, the errors, and the actual API responses, explain root cause + assumed-vs-actual field names + which lines must change. The diagnosis feeds the fix prompt (reflection-before-fix).
- **`buildFixPrompt(originalPrompt, failedResult, errors, componentType, testContext, previousAttempts, reflectionDiagnosis)`** (seed `gen-fix`) — fix ONLY the listed errors; injects type-specific constraints (extension → sandbox + namespace rules; cortex → namespace + extension-consumption rules + IIFE constraints; app → namespace + CSP/auth/cortex-init/empty-state rules), HTML-entity rules, the reflection diagnosis, and a "PREVIOUS FIX ATTEMPTS — do not repeat" section that forces a fundamentally different approach on later rounds.
- **`buildFreshGenerationPrompt(originalPrompt, previousAttempts, testContext)`** (seed `gen-fresh-generation`) — the **final** round (used after ~3 failed fixes). Regenerates from scratch (broken code is NOT shown, to avoid anchoring), injects de-duplicated KNOWN PITFALLS from all prior rounds + the actual API-response trace, and orders the model to ignore previous code and match the real data shapes.
- **`buildImpactPrompt(changeRequest, blueprint)`** — only on a change request to an installed app. Classifies every component as ROOT / NEEDS UPDATE / NO CHANGE and returns `{ analysis[], summary }`. Conservative: if unsure, mark `update`; any data-shape change propagates `update` to all downstream consumers.
- **`buildEditPrompt(type, label, currentCode, changeRequest, upstreamChanges)`** — targeted single-component edit. Modify ONLY what's asked; keep everything else identical; no refactor/rename/restyle; return the complete modified component (not a diff). Injects type-specific constraints + any upstream data-shape changes to adapt to.

---

## See also

- [`README.md`](./README.md) — doc-set overview + index
- [`00-agent-playbook.md`](./00-agent-playbook.md) — end-to-end agent run of this material
- [`01-prompt-driven-workflow.md`](./01-prompt-driven-workflow.md) — the pipeline + generator API endpoints
- [`03-spec-define-seed.md`](./03-spec-define-seed.md) — CSM/MSM/Memory/Translation formats + activation
- [`04-spec-extension.md`](./04-spec-extension.md) — extension manifest, scripts, `ctx` API, activation, probe
- [`05-spec-cortex-app.md`](./05-spec-cortex-app.md) — cortex (data/component/app-domain) + app formats + activation
- [`06-activation-registration-reference.md`](./06-activation-registration-reference.md) — register/activate endpoints + MCP tools
- [`07-browser-testing.md`](./07-browser-testing.md) — browser-testing the finished app
