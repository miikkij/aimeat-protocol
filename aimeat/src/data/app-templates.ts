/**
 * @file app-templates.ts
 * @description Authoring-template registry — the "booster kit" data. Curated starting points
 *   the app-prompt builders (app-catalog + landing) inject so the AI copies from a model instead
 *   of building from scratch. Templates are DATA: adding one is a new entry here (+ its content),
 *   no code change. Served as JSON at GET /v1/app-templates and consumed by both prompt surfaces.
 *
 *   kinds (layered — see docs/internal/authoring-templates/):
 *     - app-shell  : a full app skeleton (boot + auth + layout + theme). Tiers T1/T2/T3.
 *     - component  : a reusable block + its lib deps (future).
 *     - use-case   : composes an app-shell + components (+ optional package) (future).
 * @structure AppTemplate · getAppTemplates() · getAppTemplateIndex()
 * @version-history
 *   v1.0.0 — 2026-06-26 — initial registry + first app-shell (T1 pure-client).
 */

export interface AppTemplate {
  /** Stable id, e.g. "shell-pure-client". */
  id: string;
  kind: 'app-shell' | 'component' | 'use-case';
  /** Capability tier for app-shells: T1 pure client · T2 +cortex · T3 +extension. */
  tier?: 'T1' | 'T2' | 'T3';
  title: string;
  /** One line shown in the picker and in the prompt index. */
  description: string;
  /** Client libs the template loads (for the AI's awareness). */
  libs: string[];
  /** The model the AI copies from — a skeleton, not a finished app. */
  content: string;
}

// ── T1 pure-client app shell ─────────────────────────────────────────
// Boot (auth + data), self-hosted Tailwind + daisyUI + theme bridge, a navbar with the login
// pill, a single content area, light/dark via data-theme, and private/shared data helpers with
// loading + error handling. Slots are marked {{LIKE_THIS}} for the AI to fill.

const SHELL_PURE_CLIENT = `<!DOCTYPE html>
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

const TEMPLATES: AppTemplate[] = [
  {
    id: 'shell-pure-client',
    kind: 'app-shell',
    tier: 'T1',
    title: 'Pure client app (T1)',
    description: 'Single-file HTML app: login + private/shared memory, self-hosted Tailwind + daisyUI, light/dark theme. The 80% case — notes, trackers, boards, dashboards.',
    libs: ['aimeat-auth', 'aimeat-data'],
    content: SHELL_PURE_CLIENT,
  },
];

/** All authoring templates. */
export function getAppTemplates(): AppTemplate[] {
  return TEMPLATES;
}

/** Lightweight index (no content) — for injecting a menu into a prompt or rendering a picker. */
export function getAppTemplateIndex(): Array<Pick<AppTemplate, 'id' | 'kind' | 'tier' | 'title' | 'description' | 'libs'>> {
  return TEMPLATES.map(({ id, kind, tier, title, description, libs }) => ({ id, kind, tier, title, description, libs }));
}
