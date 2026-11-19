/**
 * @file src/data/app-templates/shells.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Atelier app-shell template body for the authoring-template registry. Pure data —
 *   the AI copies this frame instead of building from scratch. Consumed by ../app-templates.ts which
 *   assembles the TEMPLATES registry.
 * @structure SHELL_ATELIER
 * @version-history
 *   v2.0.0 — 2026-11-19 — The three Classic shells (T1 pure-client, T2 cortex, T3 extension) are gone
 *     with the Classic track (decision-atelier-is-the-only-app-build-guide-classic-and-t1-t2-t3-are).
 *     The Atelier shell is unchanged.
 *   v1.7.1 — 2026-11-08 — shell-atelier says sign-in is on by default and names requireLogin: false
 *     for an app used signed out; a prototype built from it shipped as "Log in to continue" only.
 *   v1.7.0 — 2026-10-31 — The first-paint restore is light unless the person chose: a stored 'dark'
 *     is dark, a stored 'auto' follows the OS, anything else is light (Jouni, v31 K65), as
 *     /lib/aimeat-boot.js decides.
 *   v1.6.0 — 2026-09-19 — The three Classic shells sign in with `onSession`. They started the app from
 *     `onLogin` and polled getSession every 300 ms for the silent sign-in, while the build specification
 *     has taught `onSession(session, { restored })` since 2026-09-13 as the one handler for a restored
 *     session, the silent one on an app address and a sign-in. A builder that compared the shell with
 *     the specification found them disagreeing and reported it.
 *   v1.6.0 — 2026-09-19 — The three classic shells carry `aimeat-app` (with a placeholder the
 *     publish lint names when it is left in) and `aimeat-scopes` (the default grant). Neither was in
 *     a shell, the lint warns about both on every app, and every measured cold-agent build
 *     published twice: once to be told, once to add them.
 *   v1.5.0 — 2026-09-05 — SHELL_ATELIER carries a REPLACE-ME `aimeat-register` line on purpose:
 *     the publish gate refuses it, so the bare shell cannot go live as a page. A builder forks a
 *     genre (which names its own register) or replaces the line with `custom:<name>`.
 *   v1.4.0 — 2026-08-27 — SHELL_ATELIER (TARGET-074): the Atelier track's shell. Eight-line head
 *     (aimeat-boot.js replaces the inline theme-restore IIFE), the ceremony lives in the served
 *     kit's app() call, and the aimeat-track meta records which guide built the file.
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

// ── ATELIER track shell ──────────────────────────────────────────────
// The Atelier track's starting point (TARGET-074): the ceremony lives in the served kit, so the
// head is a handful of lines and the app is the spec calls plus its own logic. Guided by
// GET /v1/prompts/build-app-atelier and node:aimeat-app-builder-atelier — NEVER by the Classic
// spec; the aimeat-track meta records which guide built this file.
export const SHELL_ATELIER = `<!DOCTYPE html>
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
  <meta name="aimeat-track" content="atelier" />
  <meta name="aimeat-register" content="REPLACE-ME: fork a genre from the Design Book (GET /v1/designbook?kind=genre) or name your own register" />
  <meta name="aimeat-locales" content="en fi" />
  <!-- Your published filename, exactly as you publish it. On an app subdomain the page cannot work it out. -->
  <meta name="aimeat-app" content="REPLACE-WITH-YOUR-FILENAME.html" />
  <!-- EVERY scope the app uses; sign-in asks the person to approve these. This is the default grant: add memory:delete, ai:use and the rest only when you use them. -->
  <meta name="aimeat-scopes" content="memory:read memory:write storage:read storage:write" />
  <title>{{App Title}}</title>
  <link href="/lib/aimeat-atelier.css" rel="stylesheet" type="text/css" />
  <script src="/lib/aimeat-boot.js"></script>
</head>
<body>
  <script src="/v1/libs/aimeat-auth.js"></script>
  <script src="/v1/libs/aimeat-data.js"></script>
  <script src="/v1/libs/aimeat-atelier.js"></script>
  <script>
    // The shell carries the ceremony: login pill + boot, language re-render, loading/empty/error
    // states, the bottom chrome reserve, the one scrolling region. You fill a.main with the kit's
    // components and your own logic — see GET /v1/prompts/build-app-atelier for the catalogue.
    var a = AIMEAT.atelier.app({
      title: '{{App Title}}',
      look: 'vivid', // vivid | calm-card | editorial | sticker | neon-dense | poster | flat
      footer: '{{footer text}}',
      onReady: function (session) { render(session); },
      // Sign-in is ON by default: a signed-out visitor sees only "Log in to continue". For an app
      // anyone uses signed out, set requireLogin: false; onReady then runs with a null session.
      // requireLogin: false,
    });

    function render(session) {
      // {{BUILD YOUR VIEWS HERE — hero/list/cardGrid/form/table into a.main, e.g.:
      //   AIMEAT.atelier.hero({ target: a.main, title: '{{App Title}}', sub: '…' });
      //   var l = AIMEAT.atelier.list({ target: a.main, items: [], onPick: open });
      //   load data with AIMEAT.data.get/list, then l.set({ items: rows });
      // Handle empty/loading/error with a.status(...) — never a bare string.}}
    }

    window.addEventListener('aimeat-lang-change', function () { /* {{RE-RENDER app strings}} */ });
  </script>
</body>
</html>`;
