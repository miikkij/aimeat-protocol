/**
 * @file src/data/app-templates/shells.ts
 * @description App-shell template bodies (T1 pure-client, T2 cortex, T3 extension) for the
 *   authoring-template registry. Pure data — the AI copies these skeletons instead of building
 *   from scratch. Consumed by ../app-templates.ts which assembles the TEMPLATES registry.
 * @structure SHELL_PURE_CLIENT · SHELL_CORTEX · SHELL_EXTENSION
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/data/app-templates.ts (max-file-lines)
 */

// ── T1 pure-client app shell ─────────────────────────────────────────
// Boot (auth + data), self-hosted Tailwind + daisyUI + theme bridge, a navbar with the login
// pill, a single content area, light/dark via data-theme, and private/shared data helpers with
// loading + error handling. Slots are marked {{LIKE_THIS}} for the AI to fill.

export const SHELL_PURE_CLIENT = `<!DOCTYPE html>
<!-- AIMEAT App Manifest
name: {{app-name}}
version: 1.0.0
description: {{one-line description — REQUIRED for publishing}}
entry: index.html
-->
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{App Title}}</title>
  <!-- Self-hosted Tailwind v4 + daisyUI 5 + theme bridge (served by the node, not a CDN) -->
  <link href="/lib/daisyui@5.css" rel="stylesheet" type="text/css" />
  <link href="/lib/aimeat-daisyui-bridge.css" rel="stylesheet" type="text/css" />
  <script src="/lib/tailwindcss@4.js"></script>
</head>
<body class="bg-base-100 text-base-content min-h-screen flex flex-col">
  <nav class="navbar bg-base-200 px-4 shadow-sm sticky top-0 z-50">
    <div class="flex-1"><span class="text-lg font-bold">{{App Title}}</span></div>
    <div class="flex-none"><span id="login"></span></div>
  </nav>

  <main id="app" class="flex-1 w-full max-w-3xl mx-auto p-4 flex flex-col gap-4">
    <div id="status" class="alert">Loading…</div>
    <!-- {{BUILD YOUR VIEWS HERE — cards/sections using daisyUI classes (card, btn-primary, input…)}} -->
  </main>

  <footer class="footer footer-center p-3 text-xs opacity-50">{{footer text}}</footer>

  <script src="/v1/libs/aimeat-auth.js"></script>
  <script src="/v1/libs/aimeat-data.js"></script>
  <script>
    var session = null;
    function setStatus(msg, cls) { var e = document.getElementById('status'); e.className = 'alert ' + (cls || ''); e.textContent = msg; }

    // PRIVATE data (only the logged-in owner can read it):
    //   await AIMEAT.data.set('{{app-name}}.key', value, { visibility: 'private' });
    //   var mine = await AIMEAT.data.get('{{app-name}}.key');
    // SHARED/community data (everyone reads; each user writes their own key):
    //   await AIMEAT.data.set('{{app-name}}.shared.' + id, entry, { visibility: 'public' });
    //   var theirs = await AIMEAT.data.getPublic(ownerGaii, '{{app-name}}.shared.' + id);
    // Always read back after a write to confirm it persisted; show loading + error states.

    function boot(s) {
      session = s;
      setStatus('Ready.', 'alert-success');
      // {{LOAD DATA + RENDER YOUR VIEWS — handle empty/loading/error states}}
    }

    var booted = false;
    function tryBoot() { if (booted) return; var s = AIMEAT.auth.getSession && AIMEAT.auth.getSession(); if (s && s.jwt) { booted = true; boot(s); } }
    AIMEAT.auth.mountLoginButton('#login', {
      onLogin: function () { tryBoot(); },
      onLogout: function () { booted = false; setStatus('Log in to continue.', 'alert-warning'); }
    });
    // App origin: the silent/grant login resolves async and may not call onLogin — poll getSession.
    var _iv = setInterval(function () { tryBoot(); if (booted) clearInterval(_iv); }, 300);
    tryBoot();
  </script>
</body>
</html>`;

// ── T2 client + cortex UI libs ───────────────────────────────────────
// T1 base, plus the node's bundled cortex UI libraries (data tables, forms, layouts) for
// richer, structured UIs without hand-rolling components.

export const SHELL_CORTEX = `<!DOCTYPE html>
<!-- AIMEAT App Manifest
name: {{app-name}}
version: 1.0.0
description: {{one-line description — REQUIRED for publishing}}
entry: index.html
-->
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{App Title}}</title>
  <link href="/lib/daisyui@5.css" rel="stylesheet" type="text/css" />
  <link href="/lib/aimeat-daisyui-bridge.css" rel="stylesheet" type="text/css" />
  <script src="/lib/tailwindcss@4.js"></script>
</head>
<body class="bg-base-100 text-base-content min-h-screen flex flex-col">
  <nav class="navbar bg-base-200 px-4 shadow-sm sticky top-0 z-50">
    <div class="flex-1"><span class="text-lg font-bold">{{App Title}}</span></div>
    <div class="flex-none"><span id="login"></span></div>
  </nav>
  <main id="app" class="flex-1 w-full max-w-4xl mx-auto p-4 flex flex-col gap-4">
    <div id="status" class="alert">Loading…</div>
    <div id="view"></div>
  </main>

  <script src="/v1/libs/aimeat-auth.js"></script>
  <script src="/v1/libs/aimeat-data.js"></script>
  <!-- Bundled cortex UI libraries (node-level — available on every AIMEAT node). Load only what you use. -->
  <script src="/v1/cortex/aimeat-ui-viewers/libs/aimeat-ui-viewers.js"></script>
  <script src="/v1/cortex/aimeat-ui-forms/libs/aimeat-ui-forms.js"></script>
  <!-- Also available: aimeat-ui-layout, aimeat-ui-nav, aimeat-ui-dialogs, aimeat-charts, aimeat-canvas -->
  <script>
    var session = null;
    function setStatus(m, c) { var e = document.getElementById('status'); e.className = 'alert ' + (c || ''); e.textContent = m; }
    function boot(s) {
      session = s;
      setStatus('Ready.', 'alert-success');
      // Example — render structured data with the viewers cortex (replace with your data):
      //   AIMEAT.ui.viewers.DataTable({ target: document.getElementById('view'),
      //     columns: [{key:'name',label:'Name'}], rows: [{name:'…'}], sortable:true, filterable:true });
      // Forms via AIMEAT.ui.forms.FormGroup({ target, fields:[…], onSubmit }).
      // {{BUILD YOUR VIEWS — load data from AIMEAT.data, render with the cortex libs}}
    }
    var booted = false;
    function tryBoot() { if (booted) return; var s = AIMEAT.auth.getSession && AIMEAT.auth.getSession(); if (s && s.jwt) { booted = true; boot(s); } }
    AIMEAT.auth.mountLoginButton('#login', { onLogin: function () { tryBoot(); }, onLogout: function () { booted = false; setStatus('Log in to continue.', 'alert-warning'); } });
    var _iv = setInterval(function () { tryBoot(); if (booted) clearInterval(_iv); }, 300);
    tryBoot();
  </script>
</body>
</html>`;

// ── T3 client + server extension ─────────────────────────────────────
// For apps that need SERVER-SIDE work (fetch an external API, scheduled jobs). The app is the
// client; a sandboxed extension does the server work and the app calls its actions. Build the
// extension separately (Profile → Cortex/Extensions → Create with AI) or ship it in a package.

export const SHELL_EXTENSION = `<!DOCTYPE html>
<!-- AIMEAT App Manifest
name: {{app-name}}
version: 1.0.0
description: {{one-line description — REQUIRED for publishing}}
entry: index.html
-->
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{App Title}}</title>
  <link href="/lib/daisyui@5.css" rel="stylesheet" type="text/css" />
  <link href="/lib/aimeat-daisyui-bridge.css" rel="stylesheet" type="text/css" />
  <script src="/lib/tailwindcss@4.js"></script>
</head>
<body class="bg-base-100 text-base-content min-h-screen flex flex-col">
  <nav class="navbar bg-base-200 px-4 shadow-sm sticky top-0 z-50">
    <div class="flex-1"><span class="text-lg font-bold">{{App Title}}</span></div>
    <div class="flex-none"><span id="login"></span></div>
  </nav>
  <main id="app" class="flex-1 w-full max-w-3xl mx-auto p-4 flex flex-col gap-4">
    <div id="status" class="alert">Loading…</div>
    <div id="view"></div>
  </main>

  <script src="/v1/libs/aimeat-auth.js"></script>
  <script src="/v1/libs/aimeat-data.js"></script>
  <script>
    // SERVER-SIDE work lives in an extension. Build "{{extension-name}}" with actions like
    // "{{action}}" (it does the external fetch / cron and writes to memory), then call it here.
    // The extension enforces auth + does CORS-free server-to-server fetches the browser can't.
    var EXT = '/v1/ext/{{extension-name}}';
    var session = null;
    function setStatus(m, c) { var e = document.getElementById('status'); e.className = 'alert ' + (c || ''); e.textContent = m; }
    function callExt(action, body) {
      return session.fetch(EXT + '/' + action, { method: 'POST', body: JSON.stringify(body || {}) });
    }
    function boot(s) {
      session = s;
      setStatus('Ready.', 'alert-success');
      // Example: var r = await callExt('{{action}}', { /* input */ }); render(r.data);
      // {{CALL YOUR EXTENSION ACTIONS + RENDER — handle loading/empty/error}}
    }
    var booted = false;
    function tryBoot() { if (booted) return; var s = AIMEAT.auth.getSession && AIMEAT.auth.getSession(); if (s && s.jwt) { booted = true; boot(s); } }
    AIMEAT.auth.mountLoginButton('#login', { onLogin: function () { tryBoot(); }, onLogout: function () { booted = false; setStatus('Log in to continue.', 'alert-warning'); } });
    var _iv = setInterval(function () { tryBoot(); if (booted) clearInterval(_iv); }, 300);
    tryBoot();
  </script>
</body>
</html>`;
