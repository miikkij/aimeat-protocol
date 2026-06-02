# Artifact Formats: Cortex (data / component / app-domain) and App

> **Audience:** an AI coding agent (and advanced humans) walking the generator's prompt-driven pipeline to build a working AIMEAT app autonomously.
> **Covers:** the three cortex subtypes (data, component, app-domain), the App, their exact package/manifest formats, their spec contracts, and the REST + MCP install/activate calls — all verified against current source.
> **Read first:** [04-spec-extension.md](./04-spec-extension.md) (the extension your data cortex wraps), [03-spec-define-seed.md](./03-spec-define-seed.md) (CSM/memory/translation that seed owner data). **Then:** [06-activation-registration-reference.md](./06-activation-registration-reference.md) and [07-browser-testing.md](./07-browser-testing.md).

This is the top half of the stack. The extension (previous doc) is the only layer that can touch external APIs. Everything here runs in the **browser**: cortex libraries are node-served JS modules, and the app is a single HTML file loaded inline.

---

## 1. Cortex overview — the layering and the trust boundary

A **cortex** is client-side JavaScript shipped as an IIFE that attaches its public surface to `window.AIMEAT.{libName}`. The node stores the JS, serves it at `/v1/cortex/{name}/libs/{file}.js`, and the app loads it with a `<script>` tag.

There are three subtypes, and they layer strictly bottom-up:

```
  ┌──────────────────────────────────────────────────────────┐
  │  APP (single HTML file)                                   │  calls cortex public methods only
  └───────────────┬──────────────────────────────────────────┘
                  │
  ┌───────────────▼──────────────────────────────────────────┐
  │  APP-DOMAIN cortex   (composition: nav, auth, i18n, logic)│  AIMEAT.{appLib}
  └───────────────┬──────────────────────────────────────────┘
                  │ composes
  ┌───────────────▼──────────────────────────────────────────┐
  │  COMPONENT cortexes  (reusable UI pieces: render/destroy) │  AIMEAT.{componentLib}
  └───────────────┬──────────────────────────────────────────┘
                  │ get/modify data via
  ┌───────────────▼──────────────────────────────────────────┐
  │  DATA cortex   (wraps extension + AIMEAT.data)            │  AIMEAT.{dataLib}
  └───────────────┬──────────────────────────────────────────┘
                  │ callExt / getPublic
  ┌───────────────▼──────────────────────────────────────────┐
  │  EXTENSION  (server-side sandbox — external APIs)         │  ext:{name} namespace
  └──────────────────────────────────────────────────────────┘
```

### Trust boundary (do not violate)

- **App** calls cortex public methods (`AIMEAT.{lib}.method(...)`) and the platform libs (`AIMEAT.auth`, `AIMEAT.data`, `AIMEAT.storage`, `AIMEAT.ai`). It **never** calls `callExt`, raw `/v1/ext/...`, or `/v1/memory/ext:...`.
- **Data cortex** is the only client layer that talks to the extension. It reads the extension's public namespace via `AIMEAT.data.getPublic('ext:{name}', key)` and calls extension actions via `session.fetch('/v1/ext/{name}/{action}')`.
- Every layer trusts the API contract of the layer directly below and bypasses nothing.

### Two invariants that bite every agent

1. **callExt path is `/v1/ext/{name}/{action}`** — POST. Not `/v1/extensions/...`, not `/actions/...`.
2. **`session.fetch` returns ALREADY-PARSED JSON.** Use `resp.data` directly. Never call `resp.json()` — it does not exist on the result.

```javascript
async function callExt(actionId, body) {
  var resp = await AIMEAT.session.fetch('/v1/ext/' + EXT_NAME + '/' + actionId, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  return resp.data;            // ← parsed already
}
```

3. **Translations and settings are OWNER data, not extension data.** Read them with `AIMEAT.data.get('service.i18n.fi')`, never with `getPublic('ext:...')`. (See [03-spec-define-seed.md](./03-spec-define-seed.md).)

---

## 2. Cortex package format (manifest + libs)

A cortex is installed from a YAML manifest plus a map of lib files. Two delivery shapes:

- **Inline (REST/MCP):** request body carries `manifest` (YAML string) + `libs` (`{ "file.js": "<code>" }`).
- **Upload (MCP, omit manifest):** the tool returns an `upload_url`; you PUT a **ZIP** with `manifest.yaml` at root and lib files under `libs/`.

### Manifest shape

The manifest is `apiVersion: cortex.aimeat.org/v1`, `kind: Extension`, with `metadata` and `spec.components[]`. (Despite `kind: Extension`, this is a *cortex* package — distinct from the server-side extension in doc 04.) Lib components are `type: lib` and list `exports` + an `api_surface`.

```yaml
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: weather-data            # kebab-case, == cortex name, owns no ext namespace
  namespace: community          # your owner name or "community"
  description: "Weather data access cortex"
  author: generator
  tags: [data, weather]
  labels:
    domain: weather
spec:
  version: "1.0.0"
  license: MIT
  components:
    - type: lib
      name: weather-data
      filename: weather-data.js
      exports: [getForecast, getCurrent, getTranslations, getSettings]
      api_surface: |
        AIMEAT.weatherData.getForecast({ city }) — Promise<{ days: [...] }>
        AIMEAT.weatherData.getCurrent({ city })  — Promise<{ temp, condition }>
```

A cortex package may also carry non-lib components — `prompt`, `ontology`, `schema`, `seed-data`, `action`, `board-template`. On activation these are materialised (schemas locked, prompts/ontology/seed-data written to memory under `__cortex__/{name}/...`, actions/boards created). For app-building you mostly ship `type: lib`.

### Register API shape — get this exactly right

The REST/MCP body uses `libs` as a **map of filename → code string**:

```jsonc
{
  "manifest": "<the YAML string above>",
  "libs": {
    "weather-data.js": "(function(AIMEAT){ /* ...IIFE... */ })(window.AIMEAT||(window.AIMEAT={}));"
  }
}
```

It is **`{ libs: { "file.js": code } }`** — NOT `{ lib: { filename, code } }`. (Verified: `aimeat/src/routes/cortex.ts` POST `/v1/cortex` destructures `{ manifest, libs }` and iterates `Object.entries(libs)`.)

### IIFE skeleton (the contract every cortex lib follows)

```javascript
(function (AIMEAT) {
  'use strict';
  const LIB_NAME = 'weatherData';   // camelCase of metadata.name → AIMEAT.weatherData
  // ... methods defined here ...
  const exports = { getForecast, getCurrent, getTranslations, getSettings };
  if (AIMEAT.register) AIMEAT.register(LIB_NAME, exports);
  AIMEAT[LIB_NAME] = exports;
})(window.AIMEAT || (window.AIMEAT = {}));
```

---

## 3. DATA cortex — pure data access

The data cortex is the data layer: it wraps each extension action in a clean async method, reads owner-namespace data through `AIMEAT.data`, returns clean shapes, and **returns `null` on failure** (no thrown exceptions; `console.warn` on error). UI never reaches past it to the extension.

### Spec contract (`buildDataApiSpecPrompt`, `generator-specs.js`)

The data-API spec is JSON with these fields:

```jsonc
{
  "name": "weather-data",          // kebab-case cortex name
  "libName": "weatherData",        // camelCase → AIMEAT.weatherData
  "description": "Weather data access for apps",
  "wrapsExtension": "weather",     // extension name from the extension spec
  "methods": [
    {
      "name": "getForecast",
      "description": "5-day forecast for a city",
      "params": "city: string",
      "returns": "Promise<{ days: Array<{ date: string, hi: number, lo: number }> }>",
      "example": "const r = await AIMEAT.weatherData.getForecast({ city: 'Helsinki' });",
      "returnsExample": { "days": [ { "date": "2026-06-02", "hi": 18, "lo": 9 } ] },
      "errorBehavior": "Returns null on failure, logs console.warn"
    }
  ],
  "translationAccess": "getTranslations(locale) → Promise<object> — reads from owner namespace",
  "settingsAccess":    "getSettings() → Promise<object> — reads from owner namespace"
}
```

Hard rules from the spec prompt:
1. **One method per extension action.** Clean verb names (`getForecast`), never the ext-prefixed name.
2. **Return types match the extension spec output exactly** — same field names, character-for-character.
3. **`returnsExample` is COPIED from the extension spec's `action.example.output`** — never invented.
4. **`getTranslations(locale)` and `getSettings()` read OWNER namespace** via `AIMEAT.data.get()` — not the ext namespace.
5. **Never expose internal helpers** (`callExt`, `readExtMemory`) in the spec — public methods only.

### Example data-cortex lib

```javascript
(function (AIMEAT) {
  'use strict';
  const LIB_NAME = 'weatherData';
  const EXT_NAME = 'weather';        // kebab-case extension name
  const SERVICE  = 'weather';        // service slug for owner-namespace keys

  // ── callExt: ALWAYS /v1/ext/{name}/{action}; resp.data is parsed JSON ──
  async function callExt(actionId, body) {
    var resp = await AIMEAT.session.fetch('/v1/ext/' + EXT_NAME + '/' + actionId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    return resp.data;
  }
  // ── readExtMemory: extension's own public namespace ──
  async function readExtMemory(key) {
    return await AIMEAT.data.getPublic('ext:' + EXT_NAME, key);
  }

  async function getForecast(params) {
    try { return await callExt('getForecast', { city: params.city }); }
    catch (e) { console.warn('getForecast failed', e); return null; }
  }
  async function getCurrent(params) {
    try { return await callExt('getCurrent', { city: params.city }); }
    catch (e) { console.warn('getCurrent failed', e); return null; }
  }

  // OWNER-namespace data (translations + settings) — AIMEAT.data.get, NOT getPublic
  async function getTranslations(locale) {
    try { return (await AIMEAT.data.get(SERVICE + '.i18n.' + locale)) || {}; }
    catch (e) { return {}; }
  }
  async function getSettings() {
    try { return (await AIMEAT.data.get(SERVICE + '.settings')) || {}; }
    catch (e) { return {}; }
  }

  const exports = { getForecast, getCurrent, getTranslations, getSettings };
  if (AIMEAT.register) AIMEAT.register(LIB_NAME, exports);
  AIMEAT[LIB_NAME] = exports;
})(window.AIMEAT || (window.AIMEAT = {}));
```

> Convention from the generator prompts: data-cortex methods take a **single object parameter** and destructure it (`getForecast({ city })`), so tests can call `lib.method({ key: value })` uniformly. Avoid positional params.

---

## 4. COMPONENT cortex — reusable UI piece

A component renders **one thing well** and is composed by the app-domain cortex. It does **not** load i18n and does **not** navigate or manage global state — the app-domain passes `locale` + `translations` and callbacks (`onSelect`, `onAdd`, `onRemove`) in as props.

### Render contract

```
AIMEAT.{libName}.render(container, props) → { el: HTMLElement, destroy(): void, update(props): void }
```

### Spec contract (`buildComponentSpecPrompt`, `generator-specs.js`)

```jsonc
{
  "name": "forecast-table",
  "libName": "forecastTable",
  "purpose": "Render a sortable 5-day forecast table",
  "render": {
    "signature": "AIMEAT.forecastTable.render(container, props)",
    "props": {
      "city": "string — which city's forecast to show",
      "translations": "object — i18n strings passed by the app-domain",
      "locale": "string — current locale",
      "onSelectDay": "function(date) — callback when a row is clicked"
    },
    "returns": "{ el: HTMLElement, destroy(): void, update(props): void }"
  },
  "dataAccess": ["getForecast"],
  "example": "const c = AIMEAT.forecastTable.render(box, { city:'Helsinki', translations:tr, locale:'fi', onSelectDay: d => openDay(d) });"
}
```

Rules: props carry callbacks (component does not navigate), props carry `locale`+`translations` (component does not load i18n), the component may call data-API methods for its own data, props stay minimal, and component names describe **what they render** (`forecast-table`, `watchlist-badge`) not where they sit.

### Example using a platform UI lib (DataTable)

```javascript
(function (AIMEAT) {
  'use strict';
  const LIB_NAME = 'forecastTable';

  function render(container, props) {
    const t = (k) => (props.translations && props.translations[k]) || k;
    let table;

    async function draw() {
      const data = await AIMEAT.weatherData.getForecast({ city: props.city });
      const rows = (data && data.days) || [];
      table = AIMEAT['aimeat-ui-viewers'].DataTable({
        columns: [
          { key: 'date', label: t('col.date'), sortable: true },
          { key: 'hi',   label: t('col.hi') },
          { key: 'lo',   label: t('col.lo') }
        ],
        rows: rows,
        sortable: true,
        pageSize: 7
      });
      container.innerHTML = '';
      container.appendChild(table);
    }
    draw();

    return {
      el: container,
      destroy() { container.innerHTML = ''; },
      update(next) { Object.assign(props, next); draw(); }
    };
  }

  const exports = { render };
  if (AIMEAT.register) AIMEAT.register(LIB_NAME, exports);
  AIMEAT[LIB_NAME] = exports;
})(window.AIMEAT || (window.AIMEAT = {}));
```

### Platform UI cortex libraries available (pre-installed, loaded via `/v1/cortex/...`)

| Library | Namespace | Provides |
|---------|-----------|----------|
| aimeat-ui-nav     | `AIMEAT['aimeat-ui-nav']`     | Tabs, Breadcrumbs, Sidebar, BottomNav, BurgerMenu |
| aimeat-ui-layout  | `AIMEAT['aimeat-ui-layout']`  | MainDetail, DashboardGrid, Split, Stacked, Header, Footer |
| aimeat-ui-viewers | `AIMEAT['aimeat-ui-viewers']` | DataTable, Timeline, Grid, List, Gallery, Carousel |
| aimeat-ui-forms   | `AIMEAT['aimeat-ui-forms']`   | Input, Select, Toggle, Checkbox, Radio, Textarea, FormGroup |
| aimeat-ui-dialogs | `AIMEAT['aimeat-ui-dialogs']` | toast, Modal, Confirm, Alert, ContextMenu, Dropdown |
| aimeat-charts     | `AIMEAT.charts`               | ChartPanel, ChartBuilder (Chart.js wrapper) |
| aimeat-canvas     | `AIMEAT.canvas`               | DrawingCanvas (pen, shapes, text, export) |

API gotchas (from `docs/generator-guide.md` §1 and the feature-cortex prompt): **Tabs uses `onChange`** (not `onSelect`); **DataTable has no `onRowClick`** — for clickable rows build a card/List with `onItemClick`; **Input/Select return `{ el, getValue(), setValue() }` objects** — append `.el`, read with `.getValue()`; **Toggle has `onChange`**.

---

## 5. APP-DOMAIN cortex — composition + business logic

This is the top cortex. It composes components into views, owns navigation, auth, i18n, and all business logic (validation, computed values, workflows, constraints). The app loads **only this** cortex (plus its dependencies) and calls its methods.

### Methods

```
init()              → async () → { session, translations, settings }  (after auth on boot)
render(container)   → (HTMLElement) → void  (renders the full UI)
t(key)              → (string) → string     (translate via current locale)
switchLocale(loc)   → (string) → void       (switch language + re-render)
```

### Spec contract (`buildAppDomainSpecPrompt`, `generator-specs.js`)

```jsonc
{
  "name": "weather-app-domain",
  "libName": "weatherApp",
  "description": "Composes forecast + settings views",
  "methods": {
    "init": "async () → { session, translations, settings } — call after auth on app boot",
    "render": "(container: HTMLElement) → void — renders full app UI into container",
    "t": "(key: string) → string — translate using current locale",
    "switchLocale": "(locale: string) → void — switch language and re-render"
  },
  "views": ["forecast", "settings"],
  "navigation": "tabs",
  "viewComposition": {
    "forecast": ["forecast-table"],
    "settings": ["settings-form"]
  },
  "scriptDependencies": [
    "/v1/cortex/aimeat-ui-nav/libs/aimeat-ui-nav.js",
    "/v1/cortex/aimeat-ui-viewers/libs/aimeat-ui-viewers.js",
    "/v1/cortex/weather-data/libs/weather-data.js",
    "/v1/cortex/forecast-table/libs/forecast-table.js",
    "/v1/cortex/settings-form/libs/settings-form.js",
    "/v1/cortex/weather-app-domain/libs/weather-app-domain.js"
  ],
  "example": "await AIMEAT.weatherApp.init();\nAIMEAT.weatherApp.render(document.getElementById('app'));"
}
```

**`scriptDependencies` is ORDERED and load order matters:** platform UI cortexes first → data cortex → each component → app-domain cortex last. Each entry depends on the ones before it. `viewComposition` may only reference components from the available component specs, and `views` must cover **every** use case from the interview.

### Example app-domain lib (auth + i18n patterns)

```javascript
(function (AIMEAT) {
  'use strict';
  const LIB_NAME = 'weatherApp';
  const SERVICE = 'weather';
  let translations = {}, locale = 'fi', session = null;

  async function init() {
    // Restore session: MUST call login() — getSession() alone returns null on cold start
    session = await AIMEAT.auth.login();
    translations = await AIMEAT.weatherData.getTranslations(locale);
    const settings = await AIMEAT.weatherData.getSettings();
    return { session, translations, settings };
  }

  function t(key) { return translations[key] || key; }

  async function switchLocale(loc) {
    locale = loc;
    translations = await AIMEAT.weatherData.getTranslations(loc);
    if (window.__weatherRoot) render(window.__weatherRoot);
  }

  function render(container) {
    window.__weatherRoot = container;
    if (!session) {
      container.id = container.id || 'weather-app';
      AIMEAT.auth.mountLoginButton('#' + container.id);  // takes a CSS SELECTOR string
      return;
    }
    const body = document.createElement('div');
    AIMEAT['aimeat-ui-nav'].Tabs({
      target: container,
      tabs: [
        { id: 'forecast', label: t('tab.forecast') },
        { id: 'settings', label: t('tab.settings') }
      ],
      active: 'forecast',
      onChange: (id) => paint(id, body)
    });
    container.appendChild(body);
    paint('forecast', body);
  }

  function paint(view, box) {
    box.innerHTML = '';
    if (view === 'forecast') {
      AIMEAT.forecastTable.render(box, { city: 'Helsinki', translations, locale });
    } else {
      AIMEAT.settingsForm.render(box, { translations, locale });
    }
  }

  const exports = { init, render, t, switchLocale };
  if (AIMEAT.register) AIMEAT.register(LIB_NAME, exports);
  AIMEAT[LIB_NAME] = exports;
})(window.AIMEAT || (window.AIMEAT = {}));
```

> `AIMEAT.auth.mountLoginButton` takes a **CSS selector string**, not a DOM element. Give the container an `id` first, then pass `'#' + id`.

---

## 6. Install + activate for cortex

### REST (`aimeat/src/routes/cortex.ts`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET`  | `/v1/cortex` | any auth | List installed cortex packages |
| `POST` | `/v1/cortex` | owner | Install — body `{ manifest, libs }`. Returns `201` with an `activate` hint |
| `GET`  | `/v1/cortex/:name` | any auth | Details (components, status, activation_artifacts) |
| `POST` | `/v1/cortex/:name/activate` | owner | Activate — materialises components |
| `POST` | `/v1/cortex/:name/deactivate` | owner | Deactivate — tears down schemas/prompts/actions/boards (keeps seed-data + lib files) |
| `DELETE` | `/v1/cortex/:name` | owner | Uninstall — deactivates, removes seed-data + lib files |
| `GET`  | `/v1/cortex/:name/export` | owner | Get back `{ manifest, libs }` for editing |
| `GET`  | `/v1/cortex/:name/libs/:libFile` | none | **Serve the JS** — only when status is `active` |

Install → activate, end to end:

```bash
# 1. install
curl -X POST "$NODE/v1/cortex" -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{ "manifest": "'"$YAML"'", "libs": { "weather-data.js": "'"$CODE"'" } }'

# 2. activate (the lib is NOT served until this succeeds)
curl -X POST "$NODE/v1/cortex/weather-data/activate" -H "Authorization: Bearer $JWT"

# 3. confirm it's served
curl -sS "$NODE/v1/cortex/weather-data/libs/weather-data.js" | head -1
```

> Note: `GET /v1/cortex/:name/libs/:libFile` returns **404 if the cortex is not active**. An inactive cortex's JS is invisible to the app. Always activate before browser-testing.

### MCP (`aimeat/src/mcp/cortex.ts`)

| Tool | Args | Notes |
|------|------|-------|
| `aimeat_cortex_list` | — | List installed |
| `aimeat_cortex_install` | `manifest?`, `libs?` | Omit `manifest` → returns presigned `upload_url` for a ZIP (manifest.yaml + libs/*.js) |
| `aimeat_cortex_activate` | `name` | Flip to active |
| `aimeat_cortex_deactivate` | `name` | Flip to inactive |
| `aimeat_cortex_delete` | `name` | Deactivate + remove lib files + delete |

> **Source discrepancy worth knowing:** the **REST** activate runs the full `activateExtension()` routine (locks schemas, writes prompts/ontology/seed-data to memory, creates actions/boards, records `activationArtifacts`). The **MCP** `aimeat_cortex_activate` only flips `status` to `active` (and kicks capability aggregation) — it does **not** run that materialisation, and MCP `delete` does not strip seed-data/memory artifacts the way REST `DELETE` does. For a pure `type: lib` cortex (the common app-building case) both paths give you a served lib, so either works. If your cortex carries `schema`/`prompt`/`seed-data`/`action`/`board-template` components, **activate via REST** so they actually materialise.

### CRITICAL re-activation pitfall

Activate is **idempotent**: calling `activate` on an already-active cortex returns `{ status: 'active', message: 'Extension is already active' }` and **does nothing else** — it silently skips re-materialisation/init. So **re-activating does NOT deploy new code.**

To push updated lib code, you must replace the record:

```
deactivate → (re-install / update libs) → activate
        — or —
delete → install → activate
```

A plain second `activate` after editing leaves the old code live. This is the #1 "my changes aren't showing up" cause in the cortex flow.

---

## 7. APP — single-file HTML

The app is plain HTML5 + CSS + JS in one file. It is loaded **inline** at:

```
/v1/apps/<gaii>/<filename>?mode=inline
```

(Direct/raw download is `?mode=download`; inline mode sets the app CSP and `Cache-Control: no-cache, must-revalidate` so republishes go live.)

### What the app may and may not do

- **May call:** cortex public methods (`AIMEAT.{lib}.method()`) and platform libs `AIMEAT.auth`, `AIMEAT.data`, `AIMEAT.storage`, `AIMEAT.ai`.
- **Must NOT call:** `callExt`, raw `/v1/ext/...`, `/v1/memory/ext:...`, or any extension route. Those belong to the data cortex.

### CSP note

Inline apps run under a moderate Content-Security-Policy (set in `aimeat/src/routes/apps.ts` for `mode=inline`). **No external CDN frameworks** — they get blocked. Load scripts only from `/v1/libs/...`, `/v1/cortex/...`, and same-origin. Inline `<style>`/`<script>` and `connect-src 'self'` (plus https/ws) are allowed; bundle/inline what you can.

### Minimal app skeleton

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Weather</title>
  <style> body { font-family: system-ui; margin: 0; } </style>
</head>
<body>
<div id="app">Loading…</div>
<script>
(async function () {
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  // 1. Load platform libs (always available from the node)
  await loadScript('/v1/libs/aimeat-auth.js');
  await loadScript('/v1/libs/aimeat-data.js');

  // 2. Load cortex deps IN ORDER (app-domain.scriptDependencies):
  //    platform UI → data → components → app-domain
  await loadScript('/v1/cortex/aimeat-ui-nav/libs/aimeat-ui-nav.js');
  await loadScript('/v1/cortex/aimeat-ui-viewers/libs/aimeat-ui-viewers.js');
  await loadScript('/v1/cortex/weather-data/libs/weather-data.js');
  await loadScript('/v1/cortex/forecast-table/libs/forecast-table.js');
  await loadScript('/v1/cortex/weather-app-domain/libs/weather-app-domain.js');

  // 3. Ensure a session
  const session = await AIMEAT.auth.ensureSession();
  if (!session) {
    document.getElementById('app').innerHTML =
      '<button onclick="AIMEAT.auth.login()">Log in</button>';
    return;
  }

  // 4. Init the app-domain cortex, then render — app only touches cortex methods
  await AIMEAT.weatherApp.init();
  AIMEAT.weatherApp.render(document.getElementById('app'));
})();
</script>
</body>
</html>
```

### Publish

**REST (`aimeat/src/routes/apps.ts`, `POST /v1/apps`, requires auth).** Two modes:

- **Inline:** body `{ filename, content, mime_type?, name?, description?, version?, category?, tags?, icon?, uses_cortex? }` where `content` is **base64** of the HTML (strict base64 — raw HTML is rejected). Best for tiny files.
- **Presigned (recommended >1 KB):** body `{ filename, mode: "presigned", name?, ... }` → returns `{ upload_url, upload_method: "PUT", content_type: "text/html" }`. PUT the raw HTML to `upload_url`.

Each publish auto-increments `version_number`; old versions are preserved. Download URL is `/v1/apps/<owner>/<filename>`; inline URL adds `?mode=inline`.

**MCP (`aimeat/src/mcp/apps.ts`, `aimeat_app_publish`).** Args `filename`, `name` (required), plus `content_base64?`, `description?`, `category?`, `tags?`, `icon?`, `version?`. **Omit `content_base64`** → the tool returns a presigned `upload_url`; PUT the raw HTML to it (the PUT response contains the publish result JSON). Companion tools: `aimeat_app_list`, `aimeat_app_get`, `aimeat_app_delete`, `aimeat_app_versions`.

```bash
# MCP-style: omit content → get upload_url, then PUT the raw HTML
# aimeat_app_publish { filename: "weather.html", name: "Weather", icon: "🌤", category: "utility" }
curl -X PUT --data-binary "@weather.html" -H "Content-Type: text/html" "$UPLOAD_URL"
```

> **Always reuse the SAME filename** on every republish. Mixing filenames (`weather.html` vs `weather-v2.html`) is the top cause of "why isn't my update live?" — a new filename is a new app, not a new version.

---

## See also

- [04-spec-extension.md](./04-spec-extension.md) — the extension your data cortex wraps (`ctx` API, `/v1/ext/{name}/{action}`, probe).
- [03-spec-define-seed.md](./03-spec-define-seed.md) — CSM/MSM/Memory/Translation; where owner-namespace translations and settings come from.
- [06-activation-registration-reference.md](./06-activation-registration-reference.md) — full register/activate endpoint + MCP tool reference across all artifact types.
- [07-browser-testing.md](./07-browser-testing.md) — driving the finished app in the browser to verify it works.
- [02-prompts-in-order.md](./02-prompts-in-order.md) — every pipeline prompt in order and where each is sourced.
- [01-prompt-driven-workflow.md](./01-prompt-driven-workflow.md) — the end-to-end pipeline and generator API endpoints.
