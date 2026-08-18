/**
 * @file src/data/app-templates/shells.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description App-shell template bodies (T1 pure-client, T2 cortex, T3 extension) for the
 *   authoring-template registry. Pure data — the AI copies these skeletons instead of building
 *   from scratch. Consumed by ../app-templates.ts which assembles the TEMPLATES registry.
 * @structure SHELL_PURE_CLIENT · SHELL_CORTEX · SHELL_EXTENSION
 * @version-history
 *   v1.3.0 — 2026-07-25 — Theme system v2: the head snippet restores the user's PALETTE
 *     (data-palette / 'aimeat-palette') next to the light/dark mode, so a generated app opens in
 *     the chosen look with no flash and no app code.
 *   v1.2.0 — 2026-07-25 — Themed by construction: all three shells link /lib/aimeat-theme.css and
 *     restore the user's light/dark choice in <head> (they used to hardcode data-theme="dark" and
 *     never load the theme, so an app opened in daisyUI indigo and ignored the AIMEAT pill). T2
 *     also loads aimeat-ui-motion and shows the two fixes that most change how a data app reads:
 *     statTiles for the numbers, skeleton instead of a spinner. Cards get a visible edge.
 *   v1.1.0 — 2026-07-19 — Mobile-safe by construction: viewport meta gains viewport-fit=cover +
 *     interactive-widget=resizes-content (keyboard resizes the layout), and body gets overflow-x-clip
 *     (kills the horizontal-overflow / shrink-to-fit class of bug). The login pill is compact-by-
 *     default on app origins (aimeat-auth v1.2.0), so these shells need no per-app mobile work.
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
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content" />
  <!-- Bilingual? Declare it and the login pill renders the language button. Delete this line if not. -->
  <meta name="aimeat-locales" content="en fi" />
  <title>{{App Title}}</title>
  <!-- Self-hosted Tailwind v4 + daisyUI 5 + theme bridge (served by the node, not a CDN) -->
  <link href="/lib/daisyui@5.css" rel="stylesheet" type="text/css" />
  <link href="/lib/aimeat-theme.css" rel="stylesheet" type="text/css" />
  <link href="/lib/aimeat-daisyui-bridge.css" rel="stylesheet" type="text/css" />
  <script src="/lib/tailwindcss@4.js"></script>
  <!-- Follow the user's AIMEAT choices — light/dark MODE and PALETTE — in <head> so there is
       no flash of the wrong look. aimeat-auth keeps both live after load; this covers first paint. -->
  <script>
    (function () {
      function mode(t) { document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light'); }
      function pal(p) { if (p && p !== 'aimeat') document.documentElement.setAttribute('data-palette', p); else document.documentElement.removeAttribute('data-palette'); }
      mode(localStorage.getItem('aimeat-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
      pal(localStorage.getItem('aimeat-palette'));
      addEventListener('storage', function (e) {
        if (e.key === 'aimeat-theme' && e.newValue) mode(e.newValue);
        if (e.key === 'aimeat-palette' && e.newValue) pal(e.newValue);
      });
    })();
  </script>
</head>
<body class="bg-base-100 text-base-content min-h-screen flex flex-col overflow-x-clip">
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
    // The language button lives in the pill (from the aimeat-locales meta above). React to it.
    var lang = AIMEAT.auth.getLang();
    window.addEventListener('aimeat-lang-change', function (e) { lang = e.detail.lang; /* {{RE-RENDER}} */ });
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
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content" />
  <!-- Bilingual? Declare it and the login pill renders the language button. Delete this line if not. -->
  <meta name="aimeat-locales" content="en fi" />
  <title>{{App Title}}</title>
  <link href="/lib/daisyui@5.css" rel="stylesheet" type="text/css" />
  <link href="/lib/aimeat-theme.css" rel="stylesheet" type="text/css" />
  <link href="/lib/aimeat-daisyui-bridge.css" rel="stylesheet" type="text/css" />
  <script src="/lib/tailwindcss@4.js"></script>
  <!-- Follow the user's AIMEAT choices — light/dark MODE and PALETTE — in <head> so there is
       no flash of the wrong look. aimeat-auth keeps both live after load; this covers first paint. -->
  <script>
    (function () {
      function mode(t) { document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light'); }
      function pal(p) { if (p && p !== 'aimeat') document.documentElement.setAttribute('data-palette', p); else document.documentElement.removeAttribute('data-palette'); }
      mode(localStorage.getItem('aimeat-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
      pal(localStorage.getItem('aimeat-palette'));
      addEventListener('storage', function (e) {
        if (e.key === 'aimeat-theme' && e.newValue) mode(e.newValue);
        if (e.key === 'aimeat-palette' && e.newValue) pal(e.newValue);
      });
    })();
  </script>
</head>
<body class="bg-base-100 text-base-content min-h-screen flex flex-col overflow-x-clip">
  <nav class="navbar bg-base-200 px-4 shadow-sm sticky top-0 z-50">
    <div class="flex-1"><span class="text-lg font-bold">{{App Title}}</span></div>
    <div class="flex-none"><span id="login"></span></div>
  </nav>
  <main id="app" class="flex-1 w-full max-w-4xl mx-auto p-4 flex flex-col gap-4">
    <div id="status" class="alert">Loading…</div>
    <!-- The numbers that matter, above the detail. Fill via AIMEAT.ui.motion.statTiles(). -->
    <div id="kpis"></div>
    <!-- Cards get an edge: the step alone reads as a lighter patch, the hairline reads as a card. -->
    <section class="card bg-base-200 card-border border-base-300">
      <div class="card-body gap-3">
        <div id="view"></div>
      </div>
    </section>
  </main>

  <script src="/v1/libs/aimeat-auth.js"></script>
  <script src="/v1/libs/aimeat-data.js"></script>
  <!-- Bundled cortex UI libraries (node-level — available on every AIMEAT node). Load only what you use. -->
  <script src="/v1/cortex/aimeat-ui-viewers/libs/aimeat-ui-viewers.js"></script>
  <script src="/v1/cortex/aimeat-ui-forms/libs/aimeat-ui-forms.js"></script>
  <!-- Motion: KPI tiles with count-up numbers, skeletons, staggered list reveals. A data app that
       renders a metric as plain body text and a spinner while loading looks unfinished; these are
       the two cheapest fixes there are. -->
  <script src="/v1/cortex/aimeat-ui-motion/libs/aimeat-ui-motion.js"></script>
  <!-- Also available: aimeat-ui-layout, aimeat-ui-nav, aimeat-ui-dialogs, aimeat-charts, aimeat-canvas -->
  <script>
    var session = null;
    function setStatus(m, c) { var e = document.getElementById('status'); e.className = 'alert ' + (c || ''); e.textContent = m; }
    function boot(s) {
      session = s;
      setStatus('Ready.', 'alert-success');
      var view = document.getElementById('view');

      // Shimmer in the SHAPE of the coming content — reads as fast, where a spinner reads as stuck.
      AIMEAT.ui.motion.skeleton(view, { lines: 4 });

      // Example — the numbers that matter get tile treatment, not a sentence:
      //   AIMEAT.ui.motion.statTiles(document.getElementById('kpis'), [
      //     { label: 'Entries', value: rows.length }, { label: 'This week', value: 12, trend: { value: 3, dir: 'up' } }]);
      // Example — structured data with the viewers cortex (replace with your data):
      //   AIMEAT.ui.viewers.DataTable({ target: view,
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
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content" />
  <!-- Bilingual? Declare it and the login pill renders the language button. Delete this line if not. -->
  <meta name="aimeat-locales" content="en fi" />
  <title>{{App Title}}</title>
  <link href="/lib/daisyui@5.css" rel="stylesheet" type="text/css" />
  <link href="/lib/aimeat-theme.css" rel="stylesheet" type="text/css" />
  <link href="/lib/aimeat-daisyui-bridge.css" rel="stylesheet" type="text/css" />
  <script src="/lib/tailwindcss@4.js"></script>
  <!-- Follow the user's AIMEAT choices — light/dark MODE and PALETTE — in <head> so there is
       no flash of the wrong look. aimeat-auth keeps both live after load; this covers first paint. -->
  <script>
    (function () {
      function mode(t) { document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light'); }
      function pal(p) { if (p && p !== 'aimeat') document.documentElement.setAttribute('data-palette', p); else document.documentElement.removeAttribute('data-palette'); }
      mode(localStorage.getItem('aimeat-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
      pal(localStorage.getItem('aimeat-palette'));
      addEventListener('storage', function (e) {
        if (e.key === 'aimeat-theme' && e.newValue) mode(e.newValue);
        if (e.key === 'aimeat-palette' && e.newValue) pal(e.newValue);
      });
    })();
  </script>
</head>
<body class="bg-base-100 text-base-content min-h-screen flex flex-col overflow-x-clip">
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
