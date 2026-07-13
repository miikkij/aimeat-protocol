/**
 * @file public/js/services/generator-prompts-template-app.js
 * @description App component prompt template for the generator. Extracted from generator-prompts-base.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from generator-prompts-base.js (max-file-lines)
 */

import { AIMEAT_CONTEXT } from './generator-prompts-context.js';
import { HTML_ENTITY_RULES } from './generator-prompts-shared-rules.js';
import { summarizeCortexApiForApp } from './generator-prompts-summaries.js';

export const appTemplate = (label, context, completedComponents) => {
    // Extract translation keys from completed translation components
    const translationComponents = (completedComponents || []).filter(c => c.type === 'translation');
    let translationKeysSection = '';
    if (translationComponents.length > 0) {
      const allKeys = new Set();
      for (const tc of translationComponents) {
        try {
          let raw = tc.result;
          // Strip markdown code fences if present
          if (typeof raw === 'string') {
            const fenceMatch = raw.match(/```(?:json)?\s*\n([\s\S]*?)```/);
            if (fenceMatch) raw = fenceMatch[1];
          }
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          // Translation result is { "fi": { "key": "value" } } or { "en": { ... } }
          const locale = Object.keys(parsed || {})[0];
          if (locale && parsed[locale]) {
            for (const key of Object.keys(parsed[locale])) allKeys.add(key);
          }
        } catch { /* skip unparseable */ }
      }
      if (allKeys.size > 0) {
        const sorted = [...allKeys].sort();
        translationKeysSection = `
## AVAILABLE TRANSLATION KEYS (from registered translation components — use EXACTLY these)

╔══════════════════════════════════════════════════════════════════════════╗
║  Your app MUST use these EXACT keys when calling t(key, translations). ║
║  Do NOT invent your own keys like "field.name" or "detail.addresses".  ║
║  The translation components have ALREADY defined these keys.           ║
╚══════════════════════════════════════════════════════════════════════════╝

${sorted.map(k => '- `' + k + '`').join('\n')}

Total: ${sorted.length} keys available. If you need a label, find the closest matching key from this list.
`;
      }
    }

    // Check if any cortex libraries are in completed components
    const cortexComponents = (completedComponents || []).filter(c => c.type === 'cortex');
    const hasCortex = cortexComponents.length > 0;

    let cortexInstructions = '';
    let cortexScriptLoads = '';
    if (hasCortex) {
      const cortexLibs = cortexComponents.map(c => {
        // Use registeredAs (set during registration) — it's the canonical name
        // Fallback: try regex on YAML metadata.name, then label
        const libName = c.registeredAs
          || c.result?.match?.(/metadata:\s*\n\s+name:\s*"?([^\s"]+)"?/)?.[1]
          || c.label;
        return { name: libName, label: c.label, result: c.result };
      });

      cortexScriptLoads = cortexLibs.map(lib =>
        `  await loadScript('/v1/cortex/${lib.name}/libs/${lib.name}.js');`
      ).join('\n');

      // Extract actual method names from cortex code exports
      const extractedMethods = [];
      for (const lib of cortexLibs) {
        // Extract actual LIB_NAME from cortex code (authoritative), fallback to camelCase conversion
        const libNameMatch = lib.result?.match?.(/const\s+LIB_NAME\s*=\s*['"]([^'"]+)['"]/);
        const camelName = libNameMatch ? libNameMatch[1] : lib.name.replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase());
        const exportsMatch = lib.result?.match?.(/(?:const|let|var)\s+\w*[Ee]xport\w*\s*=\s*\{([\s\S]*?)\}/);
        if (exportsMatch) {
          const methods = exportsMatch[1].split(',').map(m => m.trim().split(':')[0].trim()).filter(Boolean);
          for (const m of methods) {
            extractedMethods.push('- `AIMEAT.' + camelName + '.' + m + '()`');
          }
        }
      }

      let methodList = '';
      if (extractedMethods.length > 0) {
        methodList = `
### AVAILABLE CORTEX METHODS (extracted from actual code — use ONLY these):
${extractedMethods.join('\n')}

Do NOT call any method not in this list. Do NOT rename these methods.
`;
      }

      cortexInstructions = `
## CORTEX LIBRARIES (use these — do NOT call extensions or memory directly)

This project has Cortex libraries that wrap all extension APIs into clean domain methods.
Load them via <script> tags and use their API.

${(() => {
        // Collect probe results from extension components — real API response data
        const extProbeResults = (completedComponents || [])
          .filter(c => c.type === 'extension' && c.probeResults && c.probeResults.length > 0)
          .flatMap(c => c.probeResults.filter(p => p.status === 200 && p.response));
        return cortexLibs.map(lib => {
          const apiSummary = lib.result ? summarizeCortexApiForApp(lib.result, extProbeResults) : '  (no API info available)';
          return `### ${lib.label}
Load: \\\`<script src="/v1/cortex/${lib.name}/libs/${lib.name}.js"></script>\\\`
${apiSummary}
`;
        }).join('\n');
      })()}

${methodList}
RULES:
- Call \\\`AIMEAT.{libName}.init()\\\` on app start (libName is camelCase of cortex name, e.g., \\\`my-domain-lib\\\` → \\\`AIMEAT.myDomainLib.init()\\\`)
- Use cortex methods for ALL data access — never call extensions or memory directly
- NEVER call internal functions like callExt(), readExtMemory() — these are PRIVATE
- NEVER build retry loops — show an error message on failure, do NOT auto-retry
- Use EXACTLY the method names and return value shapes shown above

### AIMEAT Platform UI Libraries (load BEFORE your domain cortex)

\\\`\\\`\\\`html
<script src="/v1/cortex/aimeat-ui-nav/libs/aimeat-ui-nav.js"></script>
<script src="/v1/cortex/aimeat-ui-layout/libs/aimeat-ui-layout.js"></script>
<script src="/v1/cortex/aimeat-ui-viewers/libs/aimeat-ui-viewers.js"></script>
<script src="/v1/cortex/aimeat-ui-forms/libs/aimeat-ui-forms.js"></script>
<script src="/v1/cortex/aimeat-ui-dialogs/libs/aimeat-ui-dialogs.js"></script>
\\\`\\\`\\\`

Use these instead of raw HTML: \\\`Tabs\\\` for navigation, \\\`DataTable\\\` for tables, \\\`Input/Select/Toggle\\\` for forms, \\\`toast/Modal/Confirm\\\` for dialogs (never use native alert/confirm/prompt).
`;
    }

    return `${AIMEAT_CONTEXT}

Create an AIMEAT App (HTML/JS) for: ${label}

${context}

## CRITICAL: App origin isolation & data access (read this first)

Your published app runs on an ISOLATED app origin (\`*.apps.<domain>\`, e.g. \`apps.aimeat.io\`) — a DIFFERENT browser origin from the AIMEAT node (\`aimeat.io\`). Consequences you MUST respect:
- The app has NO access to the user's AIMEAT login session, cookie, or localStorage. There is no ambient/owner session.
- NEVER call \`/v1/auth/refresh\` and NEVER fetch with \`credentials:'include'\` expecting the user's session — that pattern was removed for security (H-2) and now returns 401/403.
- Same-origin \`fetch('/v1/...')\` to the app origin still works (CORS \`*\`) for PUBLIC data that needs no auth — public memory (\`getPublic\`), the catalogue, public boards.
- For the user's OWN/PRIVATE data, you MUST use the explicit, revocable **app-grant** flow (OAuth-style, PKCE) below. The token you obtain is scoped and stored in YOUR OWN origin's localStorage; you call APIs with \`Authorization: Bearer <that token>\` — never the user's session.
- Apps that use the user's OpenRouter key via cortex (\`AIMEAT.ai.complete()\`) are UNAFFECTED — that path is separate; use it as documented.

### App-grant flow for private data (only when you need the user's own data)
1. Send the user to the trusted apex to approve (PKCE \`code_challenge\` = base64url(SHA-256(verifier)), method S256):
   \\\`\\\`\\\`javascript
   // scope = space-separated agent scopes: memory:read memory:write memory:delete
   //   catalogue:read social:read social:write wallet:read knowledge:read
   const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
   sessionStorage.setItem('pkce', verifier);
   const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
   const url = 'https://aimeat.io/v1/app-grants/authorize'
     + '?app=' + encodeURIComponent('<owner>/<file>')          // your published app id
     + '&response_type=code&scope=' + encodeURIComponent('memory:read')
     + '&redirect_uri=' + encodeURIComponent(location.origin + location.pathname)  // your URL on the app origin
     + '&state=' + state + '&code_challenge=' + challenge + '&code_challenge_method=S256';
   location.href = url;
   \\\`\\\`\\\`
2. On return, exchange the \`code\` for a scoped token (store it in YOUR localStorage):
   \\\`\\\`\\\`javascript
   const r = await fetch('https://aimeat.io/v1/app-grants/token', {
     method: 'POST', headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: location.origin + location.pathname })
   }).then(x => x.json());
   localStorage.setItem('aimeat_token', r.data.access_token);      // scoped, revocable
   localStorage.setItem('aimeat_refresh', r.data.refresh_token);    // re-exchange with grant_type:'refresh_token'
   \\\`\\\`\\\`
3. Call AIMEAT APIs with that Bearer token (NOT the user's session):
   \\\`\\\`\\\`javascript
   await fetch('https://aimeat.io/v1/memory/my.key', { headers: { Authorization: 'Bearer ' + localStorage.getItem('aimeat_token') } });
   \\\`\\\`\\\`
The user manages/revokes these tokens in Profile → Access → "Connected Apps". Request the FEWEST scopes you need.

### Library setup (copy this exactly — load BOTH libraries):
\`\`\`javascript
// Load AIMEAT libraries — auth handles login/JWT, data handles memory API
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function boot() {
  try {
    await loadScript('/v1/libs/aimeat-auth.js');
    await loadScript('/v1/libs/aimeat-data.js');
    // Platform UI libraries (pre-installed on every AIMEAT node)
    await loadScript('/v1/cortex/aimeat-ui-nav/libs/aimeat-ui-nav.js');
    await loadScript('/v1/cortex/aimeat-ui-layout/libs/aimeat-ui-layout.js');
    await loadScript('/v1/cortex/aimeat-ui-viewers/libs/aimeat-ui-viewers.js');
    await loadScript('/v1/cortex/aimeat-ui-forms/libs/aimeat-ui-forms.js');
    await loadScript('/v1/cortex/aimeat-ui-dialogs/libs/aimeat-ui-dialogs.js');
${hasCortex ? '\n' + cortexScriptLoads : ''}
    AIMEAT.auth.mountLoginButton('#auth-container', {
      onLogin: () => startApp(),
      onLogout: () => location.reload(),
    });
    AIMEAT.auth.login().then(session => { if (session) startApp(); }).catch(() => {});
  } catch (err) {
    document.body.innerHTML = '<div style="padding:2rem;color:#ef4444;font-family:system-ui">'
      + '<h2>Failed to load application</h2><p>' + err.message + '</p>'
      + '<p>Make sure the AIMEAT node is running and accessible.</p></div>';
  }
}
boot();
\`\`\`

${translationKeysSection}
${hasCortex ? cortexInstructions : `### AIMEAT.data API (memory read/write — handles auth and envelope automatically):
\\\`\\\`\\\`javascript
// Read YOUR OWN memory key — returns the stored value directly, or null
const myData = await AIMEAT.data.get('my.settings');

// Write a memory key (your own namespace)
await AIMEAT.data.set('my.key', { count: 42 });

// Delete your own memory key
await AIMEAT.data.delete('my.key');
\\\`\\\`\\\`

### Reading EXTENSION-produced data (CRITICAL — most apps need this):
Extensions store data in their OWN namespace (\\\`ext:{extension-name}\\\`).
To read data that an extension wrote, use \\\`getPublic()\\\`:
\\\`\\\`\\\`javascript
// WRONG — this reads YOUR memory, not the extension's:
const data = await AIMEAT.data.get('items.by-date.__index');  // returns null!

// CORRECT — read from the extension's namespace:
const data = await AIMEAT.data.getPublic('ext:my-collector-extension', 'items.by-date.__index');
\\\`\\\`\\\`
The first argument is the extension's memory owner: \\\`"ext:" + extensionName\\\` (the \\\`name\\\` field from the extension manifest metadata).
Use this for ALL data produced by extensions (collected data, computed stats, caches, etc.).
\\\`getPublic()\\\` returns the value directly (auto-unwraps), or null if not found.

### Reading TRANSLATIONS (stored in owner namespace by translation components):
Translations are stored in the OWNER's namespace by the translation component during registration.
The key format is: \\\`{service-name}.i18n.{locale}\\\` (e.g. \\\`my-service.i18n.fi\\\`).
\\\`\\\`\\\`javascript
// Read translations from OWNER namespace (the translation component stored them here):
const fiStrings = await AIMEAT.data.get('my-service.i18n.fi') || await AIMEAT.data.get('i18n.fi') || {};
const enStrings = await AIMEAT.data.get('my-service.i18n.en') || await AIMEAT.data.get('i18n.en') || {};
\\\`\\\`\\\`
Use AIMEAT.data.get() — this reads from the current user's namespace where translations live.
If a cortex library has a getI18n(locale) method, use that instead (recommended).

### Calling extension actions (use AIMEAT.auth session for authenticated fetch):

╔══════════════════════════════════════════════════════════════════════════╗
║  CRITICAL: session.fetch() returns ALREADY-PARSED JSON, not Response.  ║
║  Do NOT call resp.json() — it will crash with "not a function".        ║
║  Access resp.ok, resp.data, resp.error directly.                       ║
╚══════════════════════════════════════════════════════════════════════════╝

\\\`\\\`\\\`javascript
// Helper for extension calls (copy this EXACTLY):
// ALL extension actions are POST — the backend only has router.post() routes
async function extCall(extName, actionId, body = {}) {
  const session = await AIMEAT.auth.login();
  if (!session) throw new Error('Not logged in');
  const url = '/v1/ext/' + extName + '/' + actionId;
  const resp = await session.fetch(url, { method: 'POST', body: JSON.stringify(body) });
  // resp is ALREADY parsed JSON — never call resp.json()
  if (!resp.ok) throw new Error(resp.error?.message || 'Extension call failed');
  return resp.data;  // unwrapped payload
}

// Usage:
const results = await extCall('my-extension', 'search', { query: 'test' });
const detail = await extCall('my-extension', 'getDetail', { id: 'abc-123' });
\\\`\\\`\\\``}

## CDN Libraries & Design Resources

The AIMEAT app catalog allows external CDN scripts. Available libraries:

| Library | Script Tag | Use for |
|---------|-----------|---------|
| Leaflet | \`<script src="https://unpkg.com/leaflet@1/dist/leaflet.js"></script>\` + CSS link: \`<link rel="stylesheet" href="https://unpkg.com/leaflet@1/dist/leaflet.css">\` | Maps, markers, geospatial |
| Chart.js | \`<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>\` | Bar, line, pie, radar charts |
| Motion | \`<script src="https://cdn.jsdelivr.net/npm/motion@11/dist/motion.js"></script>\` | Animations via \`Motion.animate(el, {x: 100}, {duration: 0.5})\` |
| Phaser 3 | \`<script src="https://cdn.jsdelivr.net/npm/[email protected]/dist/phaser.min.js"></script>\` | Games, interactive canvas, physics |

### CSP (Content Security Policy) — the app HTML MUST include a meta tag

AIMEAT enforces CSP headers. If your app loads CDN scripts/styles, you MUST add a \`<meta>\` tag:
\\\`\\\`\\\`html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net;
  style-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net https://fonts.googleapis.com;
  img-src 'self' data: https: blob:;
  font-src 'self' https://fonts.gstatic.com;
  connect-src 'self' https://*.tile.openstreetmap.org https://cdn.jsdelivr.net https://unpkg.com;
">
\\\`\\\`\\\`
Only include CDN domains you actually use. Without this tag, CDN scripts will be BLOCKED silently.

IMPORTANT: If your app uses Leaflet or any map library that loads tiles from external servers,
you MUST add the tile server domain to \`connect-src\`. For OpenStreetMap: \`https://*.tile.openstreetmap.org\`.
Without this, the map will appear but tiles will be blocked and it shows a grey/empty map.

For UI inspiration, reference uiverse.io for fancy buttons, cards, toggles, and loaders (CSS-only patterns).

## CSS Design System

Use CSS custom properties for ALL styling. Define a theme at the top, then use var() everywhere:
\`\`\`css
:root {
  --color-primary: #3b82f6;      /* main action color — customize per project */
  --color-secondary: #64748b;
  --color-success: #22c55e;
  --color-warning: #f59e0b;
  --color-danger: #ef4444;
  --color-bg: #ffffff;
  --color-bg-card: #f8fafc;
  --color-text: #1e293b;
  --color-text-dim: #64748b;
  --color-border: #e2e8f0;
  --radius: 8px;
  --radius-lg: 12px;
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;
  --font-sans: system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.07);
  --shadow-lg: 0 10px 15px rgba(0,0,0,0.1);
  --transition: 150ms ease;
}
\`\`\`

NEVER use hardcoded hex colors in component styles. Always use var(--color-*).
Customize the palette based on the project's domain and the style preferences from the spec.

## Auth UI Layout

The #auth-container renders a login button and session bar at the top of the page.
Reserve space for it in your layout — do not overlap or hide it:
\`\`\`html
<body>
  <div id="auth-container"></div>  <!-- AIMEAT login/session UI — always at top -->
  <header><!-- your app header --></header>
  <main id="app"><!-- your content --></main>
</body>
\`\`\`

## Rules
- DO NOT add manual configuration fields for API URL, Bearer Token, or Instance ID
- DO NOT use prompt() or manual token entry — the auth library handles everything
- ALL API paths MUST be relative (start with /) — never use absolute URLs or NODE_URL
- Use \`await AIMEAT.auth.login()\` to restore session from storage; if null, show a "Sign in" message. getSession() alone returns null until login() is called.
- Use vanilla JS (no build step needed)
- All dates displayed to users should be formatted from ISO 8601 strings (never store display-formatted dates)
- Has a clean, responsive UI with good mobile support
- Use CSS custom properties for theming where possible
${hasCortex ? '- Call cortex init() on app start — it handles everything automatically\n- Focus on UX/UI — the cortex handles data access and initialization' : ''}

## CRITICAL: Rendering API Data — Handle Nested Objects

API responses often contain nested objects instead of plain strings. For example:
- \`id: { value: "123", createdAt: "2026-01-01" }\` — access \`.value\`
- \`link: { url: "https://example.com", label: "More" }\` — access \`.url\`
- \`items: [{ name: "First", type: "A" }]\` — access \`[0].name\`

╔══════════════════════════════════════════════════════════════════════════╗
║  NEVER render an object directly as text — it will show [object Object] ║
║  ALWAYS check: if (typeof val === 'object' && val !== null)             ║
║  Then access the appropriate sub-field (.value, .url, .name, etc.)      ║
╚══════════════════════════════════════════════════════════════════════════╝

Helper pattern:
\\\`\\\`\\\`javascript
function displayValue(val) {
  if (val == null) return '-';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (val.value) return val.value;  // { value: "..." } pattern
  if (val.url) return val.url;      // { url: "..." } pattern
  if (val.name) return val.name;    // { name: "..." } pattern
  if (Array.isArray(val)) return val.map(displayValue).join(', ');
  return JSON.stringify(val);        // last resort — never [object Object]
}
\\\`\\\`\\\`

## CRITICAL: Empty-State Handling

On first run, extension data does NOT exist yet. The app MUST show a friendly empty state:
- Check every data response for null/empty before rendering
- Show helpful messages: "No data yet — extensions will collect data on their next scheduled run"
- NEVER crash on null/undefined data — always provide fallback UI

## Built-in Error Collector (diagnostics)

Add this error collector at the TOP of your main <script>, before any other code:
\\\`\\\`\\\`javascript
// Error collector — surfaces runtime errors in the UI for diagnostics
(function() {
  var errors = [];
  window.onerror = function(msg, src, line, col) {
    errors.push({ msg: msg, src: src, line: line, col: col, at: new Date().toISOString() });
    showErrors();
  };
  window.addEventListener('unhandledrejection', function(e) {
    errors.push({ msg: String(e.reason), src: 'promise', line: 0, col: 0, at: new Date().toISOString() });
    showErrors();
  });
  function showErrors() {
    var el = document.getElementById('app-errors');
    if (!el) { el = document.createElement('div'); el.id = 'app-errors'; el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#1a0000;color:#ff6b6b;font-size:12px;padding:8px 12px;max-height:120px;overflow:auto;z-index:9999;font-family:monospace;border-top:2px solid #ff4444'; document.body.appendChild(el); }
    el.innerHTML = errors.map(function(e) { return e.at.slice(11,19) + ' ' + e.msg + ' (' + e.src + ':' + e.line + ')'; }).join('<br>');
  }
})();
\\\`\\\`\\\`
This lets users see runtime errors without opening the browser console.

${HTML_ENTITY_RULES}

Return a complete HTML file with an app manifest comment at the top:

\`\`\`html
<!-- AIMEAT App Manifest
name: kebab-case-name
version: 1.0.0
description: What this app does
entry: index.html
-->
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>App Name</title></head>
<body>
  <div id="auth-container"></div>
  <div id="app"></div>
  <script>
    // Auth setup + API helper + app logic here
  </script>
</body>
</html>
\`\`\``;
  };
