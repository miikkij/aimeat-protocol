/**
 * @file cortex-code.ts
 * @description Cortex + app code generators (data cortex, feature cortex, app-domain cortex, app HTML).
 *   Extracted verbatim from generator-prompt-seeds.ts — content is calibrated, DO NOT edit values.
 *   Variables use {{name}} syntax, resolved by resolvers.ts at runtime.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from generator-prompt-seeds.ts (pure extraction, no logic change)
 */

import type { PromptSeedEntry } from '../prompt-defaults.js';

export const CORTEX_CODE_SEEDS: PromptSeedEntry[] = [
  // ═══════════════════════════════════════════════════════════════════
  // Cortex code generation — data, component, app-domain subtypes
  // Verbatim copies from public/js/services/generator-prompts-cortex-*.js
  // and generator-prompts-base.js app template. ${var} → {{var}}.
  // ═══════════════════════════════════════════════════════════════════

  {
    id: 'gen-cortex-data',
    group: 'generator',
    name: 'Data Cortex Generator',
    description: 'Data cortex IIFE — wraps extension into clean data access methods.',
    content: `{{disclaimer}}
Create a Data Cortex library for: {{label}}

Project: {{project_description}}

{{spec_section}}

## Goal

Build a client-side JavaScript library (IIFE) that provides data access methods.
This is the DATA LAYER — pure data access, no UI rendering.
Other cortex components will use this library to get and modify data.

## Structures (shared data types — use these exact shapes)

{{structures}}

## Methods to Export

{{methods_to_export}}

{{extension_section}}

## AIMEAT Platform Libraries Available

- **AIMEAT.data** — get(key), set(key, value), delete(key), list(opts), search(query), getPublic(gaii, key), getEntry(key), update(key, value, version)
- **AIMEAT.storage** — upload(file), download(key), list(), delete(key)
- **AIMEAT.social** — createBoard(name), post(boardId, content), boards(), posts(boardId)
- **AIMEAT.wallet** — balance(), transactions()
- **AIMEAT.auth** — login(), getSession(), mountLoginButton(container)

## Data Access Rules (CRITICAL — follow precisely)

Two namespaces, two different methods:

1. **Extension runtime data** (watchlist items, cached API results, change logs — data the EXTENSION wrote via ctx.memory.set):
   → Read with: \\\`AIMEAT.data.getPublic('ext:EXTENSION_NAME', key)\\\`
   → This reads from the extension's own namespace. Public, no auth needed.

2. **Owner/user data** (translations, settings, seed data — data stored by memory/translation components):
   → Read with: \\\`AIMEAT.data.get(key)\\\`
   → This reads from the CURRENT USER's own namespace. Requires auth session.

NEVER read translations or settings from ext: namespace. They live in the owner namespace.
NEVER read extension runtime data with data.get() — that reads the wrong namespace.

## Output Format

Return TWO separate, properly tagged code blocks.
The installer expects them separately — YAML defines the manifest, JS is the library file.

CRITICAL: Use \\\`\\\`\\\`yaml for the manifest and \\\`\\\`\\\`javascript for the library code.
Do NOT combine them into a single block. Do NOT use an untagged block.

First block — YAML manifest:
\\\`\\\`\\\`yaml
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: kebab-case-name
  namespace: community
  description: "What this data cortex does"
  author: generator
  tags: [data, domain-tag]
  labels:
    domain: specific-domain
spec:
  version: "1.0.0"
  license: MIT
  components:
    - type: prompt
      name: domain-assistant
      content: |
        You are using the {{metadata.name}} cortex library.
        Node URL: {{node_url}}

        Available API:
        AIMEAT.yourLib.methodName(params) — Description
        ...

        To load in an app:
        <script src="{{node_url}}/v1/cortex/kebab-case-name/libs/kebab-case-name.js"></script>

    - type: lib
      name: kebab-case-name
      filename: kebab-case-name.js
      exports: [methodName, ...]
      api_surface: |
        AIMEAT.yourLib.methodName(params) — Description and return type
        ...
\\\`\\\`\\\`

Second block — JavaScript library:
\\\`\\\`\\\`javascript
(function (AIMEAT) {
  'use strict';
  const LIB_NAME = 'yourLibName'; // camelCase of metadata.name
  const EXT_NAME = 'extension-name'; // kebab-case extension name from the extension section above

  // ── EXACT callExt implementation — DO NOT MODIFY THIS PATTERN ──
  // Calls an extension action via the AIMEAT API. Returns the action's return value.
  // URL pattern is ALWAYS: /v1/ext/{extensionName}/{actionId}
  // session.fetch returns ALREADY-PARSED JSON — use resp.data directly, NEVER resp.json()
  async function callExt(actionId, body) {
    var resp = await AIMEAT.session.fetch('/v1/ext/' + EXT_NAME + '/' + actionId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    return resp.data;
  }

  // ── EXACT readExtMemory implementation — DO NOT MODIFY THIS PATTERN ──
  // Reads extension runtime data from the ext:{name} namespace.
  async function readExtMemory(key) {
    return await AIMEAT.data.getPublic('ext:' + EXT_NAME, key);
  }

  // ── Public data access methods ──
  // CRITICAL: Every method takes a SINGLE OBJECT parameter and destructures it.
  // This matches the spec contract. The test will call: lib.methodName({ key: value })
  // Example:
  //   async function doSomething(params) {
  //     var id = params.id;
  //     var filter = params.filter || 'all';
  //     return await callExt('doSomething', { id: id, filter: filter });
  //   }
  // NEVER use positional parameters like methodName(a, b) — always methodName(params).
  // Method names in exports MUST match the blueprint "produces: api:XXX" names EXACTLY.
  // Do NOT rename them to match extension action names — use the blueprint names.

  async function methodName(params) { ... }

  // Register
  const exports = { methodName, ... };
  if (AIMEAT.register) AIMEAT.register(LIB_NAME, exports);
  AIMEAT[LIB_NAME] = exports;
})(window.AIMEAT || (window.AIMEAT = {}));
\\\`\\\`\\\``,
    variables: ['disclaimer', 'label', 'project_description', 'spec_section', 'structures', 'methods_to_export', 'extension_section'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-cortex-component',
    group: 'generator',
    name: 'Feature Cortex Generator',
    description: 'Feature cortex IIFE — self-contained UI module with render(container).',
    content: `{{disclaimer}}
Create a Feature Cortex component for: {{label}}

{{spec_section}}

## Use Case
{{use_case}}

## View
{{view_section}}

## Goal

Build a self-contained feature module (data + UI) as a cortex IIFE.
It must export a \\\`render(container)\\\` function that:
1. Renders UI using daisyUI CSS classes — semantic HTML with class names like "card", "table", "btn"
2. Fetches data from the data cortex
3. Uses daisyUI components for all visual elements — do NOT build raw unstyled HTML
4. Handles user interactions
5. Uses translation keys for all visible text

Think of it like aimeat-charts: \\\`ChartPanel({ target: container, ... })\\\` creates a complete chart.
Your \\\`render(container)\\\` creates a complete feature view.

## Data Structures
{{structures}}

{{data_cortex_api}}

{{platform_ui_section}}

{{translation_section}}

## Loading Translations

Translations are stored in the OWNER namespace (by the translation component).
The service slug for this project is: {{service_slug}}
Load translations inside your render() function BEFORE rendering any text:
\\\`\\\`\\\`javascript
// Load translations FIRST — call this at the start of render()
var translations = await AIMEAT.data.get('{{service_slug}}.i18n.' + locale) || {};
\\\`\\\`\\\`
IMPORTANT: If the app is public and other users will use it, replace data.get() with data.getPublic(OWNER_GHII, key) where OWNER_GHII is the app creator's identity. Otherwise translations will only work for the creator.

## Translation Helper
Use a t() function for all user-visible text:
\\\`\\\`\\\`javascript
function t(key, translations, vars) {
  if (!key || !translations) return key || '';
  var str = translations[key] != null ? translations[key] : key;
  if (vars && typeof str === 'string') {
    Object.keys(vars).forEach(function(k) {
      str = str.replace('$\\{' + k + '}', vars[k]);
    });
  }
  return str;
}
\\\`\\\`\\\`

## Nested Object Helper
API responses contain nested objects. Use this to safely render values:
\\\`\\\`\\\`javascript
function dv(val) {
  if (val == null) return '-';
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (val.value) return val.value;
  if (val.url) return val.url;
  if (val.name) return val.name;
  if (Array.isArray(val)) return val.map(dv).join(', ');
  return JSON.stringify(val);
}
\\\`\\\`\\\`

## Output Format

Return TWO separate, properly tagged code blocks.
CRITICAL: Use \\\`\\\`\\\`yaml for the manifest and \\\`\\\`\\\`javascript for the library code.

First block — YAML manifest:
\\\`\\\`\\\`yaml
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: kebab-case-feature-name
  namespace: community
  description: "Feature description"
  author: generator
  tags: [feature, domain-tag]
  labels:
    domain: specific-domain
spec:
  version: "1.0.0"
  license: MIT
  components:
    - type: lib
      name: kebab-case-feature-name
      filename: kebab-case-feature-name.js
      exports: [render]
      api_surface: |
        AIMEAT.featureLib.render(container) — Renders the feature UI into the given DOM element
\\\`\\\`\\\`

Second block — JavaScript library:
\\\`\\\`\\\`javascript
(function (AIMEAT) {
  'use strict';
  const LIB_NAME = 'featureLib'; // camelCase
  // Use daisyUI classes for all UI: class="card", class="table", class="btn", etc.
  // DaisyUI + Tailwind CSS is loaded on the page.
  // ... render(container) implementation
  var exports = { render: render };
  if (AIMEAT.register) AIMEAT.register(LIB_NAME, exports);
  AIMEAT[LIB_NAME] = exports;
})(window.AIMEAT || (window.AIMEAT = {}));
\\\`\\\`\\\``,
    variables: ['disclaimer', 'label', 'spec_section', 'use_case', 'view_section', 'structures', 'data_cortex_api', 'translation_section', 'service_slug', 'platform_ui_section'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-cortex-app-domain',
    group: 'generator',
    name: 'App-Domain Cortex Generator',
    description: 'App-domain cortex — composition layer combining all features + auth + translations.',
    content: `{{disclaimer}}
Create an App-Domain Cortex for: {{label}}

Project: {{project_description}}

{{spec_section}}

## Goal

Build the top-level cortex library that the APP will use. It composes:
1. All feature cortex components (renders them into containers)
2. Auth initialization (AIMEAT.auth)
3. Translation loading and management
4. Settings management
5. Navigation support

The app loads ONLY this cortex. This cortex provides everything the app needs.

## Feature Cortex Components (compose these)
{{feature_apis}}

{{platform_layout_section}}

## Data Cortex
{{data_cortex_section}}

## Translation Keys Available
{{translation_keys}}

## Methods to Export

- **init()** — Initialize auth, load translations, check data readiness. Returns { ready: boolean, authenticated: boolean }.
- **render(container)** — Render the full application UI into the container. Sets up navigation, renders feature views.
- **getTranslations(locale)** — Load translation strings for a locale. Returns the translation object.
- **t(key, vars)** — Translate a key with optional variable interpolation. Uses loaded translations.
- **switchLocale(locale)** — Change language, reload translations, re-render.

## Auth Pattern
\\\`\\\`\\\`javascript
// Restore session from storage (MUST call login() first — getSession() alone returns null)
var session = await AIMEAT.auth.login();
if (!session) {
  // No stored session — show login button
  // mountLoginButton takes a CSS SELECTOR string, not a DOM element
  // Give the container an ID first, then pass the selector
  container.id = container.id || 'app-auth';
  AIMEAT.auth.mountLoginButton('#' + container.id);
  return { ready: false, authenticated: false };
}
\\\`\\\`\\\`

## Translation Pattern
\\\`\\\`\\\`javascript
// Load translations — try service-prefixed key first, then plain key
async function loadTranslations(locale) {
  try {
    // Translations are stored in the OWNER namespace by the translation component
    // Key format: {{service_slug}}.i18n.LOCALE (dots throughout)
    return await AIMEAT.data.get('{{service_slug}}.i18n.' + locale)
        || await AIMEAT.data.get('i18n.' + locale)
        || {};
  } catch (e) { return {}; }
}

// Translate with interpolation
function t(key, vars) {
  var str = translations[key] || key;
  if (vars) {
    Object.keys(vars).forEach(function(k) {
      str = str.replace('$\\{' + k + '}', vars[k]);
    });
  }
  return str;
}
\\\`\\\`\\\`

## Output Format

Return TWO separate, properly tagged code blocks.
CRITICAL: Use \\\`\\\`\\\`yaml for the manifest and \\\`\\\`\\\`javascript for the library code.

First block — YAML manifest:
\\\`\\\`\\\`yaml
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: kebab-case-app-name
  namespace: community
  description: "App-domain cortex description"
  author: generator
  tags: [app, domain-tag]
  labels:
    domain: specific-domain
spec:
  version: "1.0.0"
  license: MIT
  components:
    - type: lib
      name: kebab-case-app-name
      filename: kebab-case-app-name.js
      exports: [init, render, t, switchLocale, getTranslations]
      api_surface: |
        AIMEAT.appLib.init() — Initialize auth, load translations. Returns { ready, authenticated }
        AIMEAT.appLib.render(container) — Render the full application into DOM container
        AIMEAT.appLib.t(key, vars) — Translate with interpolation
        AIMEAT.appLib.switchLocale(locale) — Change language and re-render
        AIMEAT.appLib.getTranslations(locale) — Load translations for locale
\\\`\\\`\\\`

Second block — JavaScript library. ADAPT this working template — change view definitions, component names, navigation labels to match the spec. Keep the structure intact.
\\\`\\\`\\\`javascript
{{app_domain_template}}
\\\`\\\`\\\`

CRITICAL: The header (AIMEAT logo, sign in) is NOT your responsibility. It is provided by the page shell.
Your render(container) receives a div#app — render your navigation + views INTO that container.
Use ONLY the EXACT translation keys from the Translation Keys section. Do NOT invent shortened keys like "nav.search" — use "app.nav.search".`,
    variables: ['disclaimer', 'label', 'project_description', 'spec_section', 'feature_apis', 'data_cortex_section', 'translation_keys', 'service_slug', 'platform_layout_section', 'app_domain_template'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },

  {
    id: 'gen-app',
    group: 'generator',
    name: 'App HTML Generator',
    description: 'Complete HTML app — loads cortex libraries via app-domain cortex.',
    content: `{{context}}

Create an AIMEAT App (HTML page) for: {{label}}

{{project_context}}

## Architecture

The app is a simple HTML page that:
1. Loads DaisyUI + Tailwind CSS (styling)
2. Loads AIMEAT auth + data libraries
3. Loads all cortex libraries (data, components, app-domain)
4. Has an AIMEAT header (logo + morselit + sign in) — FIXED, not part of app logic
5. Has a div#app where the app-domain cortex renders

The app-domain cortex handles ALL application logic (views, navigation, translations).
The app page just loads libraries and calls init() + render().

{{cortex_or_api_section}}

## Output: Complete HTML file

Return a complete HTML file using this EXACT structure. ADAPT only the marked sections.

\\\`\\\`\\\`html
<!-- AIMEAT App Manifest
name: {{app_name}}
version: 1.0.0
description: {{app_description}}
entry: index.html
-->
<!DOCTYPE html>
<html lang="{{app_locale}}" data-theme="{{app_theme}}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{app_title}}</title>
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'self';
    script-src 'self' 'unsafe-inline';
    style-src 'self' 'unsafe-inline';
    img-src 'self' data: https: blob:;
    connect-src 'self';
  ">
  <link href="/lib/daisyui@5.css" rel="stylesheet" type="text/css" />
  <link href="/lib/aimeat-daisyui-bridge.css" rel="stylesheet" type="text/css" />
  <script src="/lib/tailwindcss@4.js"></script>
</head>
<body class="bg-base-100 min-h-screen flex flex-col">

  <!-- AIMEAT Header — DO NOT MODIFY -->
  <nav class="navbar bg-base-200 shadow-sm px-4">
    <div class="flex-1 gap-4">
      <span class="text-lg font-bold">AIME<span style="color:#E8564A">&#9829;</span>AT</span>
      <span id="morsel-display" class="text-xs opacity-60"></span>
    </div>
    <div class="flex-none gap-2">
      <span id="header-auth"></span>
    </div>
  </nav>

  <!-- App area — app-domain cortex renders here -->
  <div id="app" class="flex-1"></div>

  <!-- Error collector (diagnostics) -->
  <script>
  (function() {
    var errors = [];
    window.onerror = function(msg, src, line) {
      errors.push(new Date().toISOString().slice(11,19) + ' ' + msg + ' (' + src + ':' + line + ')');
      showErrors();
    };
    window.addEventListener('unhandledrejection', function(e) {
      errors.push(new Date().toISOString().slice(11,19) + ' ' + String(e.reason));
      showErrors();
    });
    function showErrors() {
      var el = document.getElementById('app-errors');
      if (!el) { el = document.createElement('div'); el.id = 'app-errors'; el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#1a0000;color:#ff6b6b;font-size:12px;padding:8px 12px;max-height:120px;overflow:auto;z-index:9999;font-family:monospace;border-top:2px solid #ff4444'; document.body.appendChild(el); }
      el.innerHTML = errors.join('<br>');
    }
  })();
  </script>

  <!-- Load AIMEAT libraries -->
  <script>
  function loadScript(src) {
    return new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function boot() {
    try {
      await loadScript('/v1/libs/aimeat-auth.js');
      await loadScript('/v1/libs/aimeat-data.js');
{{cortex_script_loads}}

      // Mount sign-in button in header
      AIMEAT.auth.mountLoginButton('#header-auth', {
        onLogin: function() { startApp(); },
        onLogout: function() { location.reload(); }
      });

      // Try to restore session
      var session = await AIMEAT.auth.login();
      if (session) {
        // CRITICAL: Set AIMEAT.session so cortex libraries can use session.fetch()
        AIMEAT.session = session;
        startApp();
      }

      // Show morsel balance
      if (session) {
        try {
          var wallet = await session.fetch('/v1/wallet');
          if (wallet && wallet.data) {
            document.getElementById('morsel-display').textContent = wallet.data.balance + ' morsels';
          }
        } catch(e) {}
      }
    } catch (err) {
      document.getElementById('app').innerHTML =
        '<div class="alert alert-error m-4"><span>Failed to load: ' + err.message + '</span></div>';
    }
  }

  function startApp() {
    var appLib = AIMEAT.{{app_domain_lib}};
    if (!appLib) {
      document.getElementById('app').innerHTML =
        '<div class="alert alert-error m-4"><span>App-domain cortex not loaded</span></div>';
      return;
    }
    appLib.init().then(function() {
      appLib.render(document.getElementById('app'));
    });
  }

  boot();
  </script>
</body>
</html>
\\\`\\\`\\\`

## Rules
- DO NOT modify the AIMEAT header — it is fixed
- DO NOT add manual token/URL configuration — auth library handles everything
- ALL API paths MUST be relative (start with /)
- Use vanilla JS (no build step)
- The app-domain cortex handles ALL application logic — the HTML page just loads libraries and boots
{{cortex_rules}}
{{html_entity_rules}}`,
    variables: ['context', 'label', 'project_context', 'cortex_script_loads', 'cortex_or_api_section', 'cortex_rules', 'html_entity_rules', 'app_name', 'app_description', 'app_title', 'app_domain_lib', 'app_locale', 'app_theme'],
    usedIn: ['generator-autopilot', 'generator-ui'],
  },
];
