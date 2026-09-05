/**
 * @file src/data/builtin-skills.app-builder-atelier.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat-app-builder-atelier` built-in skill: the paved path for building an
 *   app on the ATELIER track (TARGET-074). A sibling of builtin-skills.app-builder.ts and a
 *   separate skill on purpose — the two tracks have their own guides, and a builder who loads
 *   this one is never taught daisyUI classes or hand-written boilerplate.
 *
 *   Its own file for the same reason app-builder has one: builtin-skills.ts lives near the
 *   max-file-lines cap, and a skill edited on a node must have exactly one repo home to merge
 *   back into. KEEP IT THE SUPERSET if a node's copy diverges.
 * @structure APP_BUILDER_ATELIER_SKILL_ENTRY
 * @usage import { APP_BUILDER_ATELIER_SKILL_ENTRY } from './builtin-skills.app-builder-atelier.js';
 * @version-history
 *   v1.3.0 — 2026-09-05 — The build starts from a genre, never from the bare shell: the genre
 *     list address joins the fetch table, the register meta is named, and step 3 says the
 *     publish refuses an Atelier app that names no register.
 *   v1.2.0 — 2026-09-05 — The look brings its own ambient (the one layer allowed to move at
 *     idle), and a background animation of one's own joins the never-list
 *     (wish-atelier-ambient-visuals).
 *   v1.1.0 — 2026-09-02 — The game shell is named beside the Atelier shell.
 *   v1.0.0 — 2026-08-27 — Initial (TARGET-074).
 */
import type { BuiltinSkill } from './builtin-skills.js';

export const APP_BUILDER_ATELIER_SKILL_ENTRY: BuiltinSkill =
{
    name: 'aimeat-app-builder-atelier',
    visibility: 'public',
    skillMd: `---
name: aimeat-app-builder-atelier
description: Build and publish apps on the ATELIER track — the component-kit way (AIMEAT.atelier, look presets, generated imagery, structural mobile and accessibility guarantees). Use when the owner chose the Atelier track for a "build an app" request; for the standard track use node:aimeat-app-builder instead. The two guides never mix.
license: MIT
metadata:
  audience: agent
---

# Building AIMEAT apps on the Atelier track

An Atelier app is still a **single self-contained HTML file** the node hosts — but its head is
eight lines and its UI is calls into the served component kit (\`AIMEAT.atelier\`), so the file
carries your app's logic and almost nothing else. The ceremony every app used to copy — theme
restore, login boot, mobile guards, designed loading/empty/error states, accessibility wiring,
motion — lives in the kit and reaches your app from the node.

**This track has its own spec. Fetch it first and follow it exactly:**

\`\`\`
GET /v1/prompts/build-app-atelier   ← the Atelier spec (re-fetch every time, it changes)
GET /v1/designbook?kind=genre       ← the genres: complete pages in a committed register. A build STARTS here
GET /v1/app-templates/genre-<id>    ← the genre to fork (swap the words, sources and images; keep the physics)
GET /v1/app-templates/shell-atelier ← the frame the genres are built on (read it for the structure; never publish it bare)
GET /v1/app-templates/shell-phaser-game ← a GAME starts here instead: canvas, menus, settings, leaderboard wired
GET /v1/appdev/pitfalls             ← what bites app builders
\`\`\`

**Never fetch or follow /v1/prompts/build-app on this track.** Its vocabulary (daisyUI classes,
hand-written boilerplate, the theme-restore snippet) does not apply here, and mixing the two
guides produces an app that belongs to neither. The shell's
\`<meta name="aimeat-track" content="atelier">\` records which guide built the file, and the
publish path stores it, so a later session loads the right one.

**Every Atelier app names its register.** \`<meta name="aimeat-register" content="genre-<id>">\`
is in every genre's head already, so a fork carries it; a page that commits to a look of its own
declares \`content="custom:<name>"\` (custom:game, custom:ledger; never "default"). The bare shell
carries a REPLACE-ME line in that place and the publish refuses it: the shell is a frame, not a
page, and an Atelier app that names no register does not go live.

**Carry the spec token.** The spec response includes \`spec_token\` (an \`atelier-\` prefixed
digest). Pass it on \`aimeat_app_publish\`; the publish answers \`spec_check\` so a spec that
moved under you says so.

## The shape of the work

1. **Interview** — what the app does, who uses it, how it should FEEL (this picks the look
   preset), which languages, what it must not do.
2. **Research first** — \`aimeat_appdev_overview\`, existing apps and skills, the pitfalls.
3. **Build** — start from a GENRE, never from the bare shell: pick the register the page belongs
   in from \`GET /v1/designbook?kind=genre\`, fork it from \`GET /v1/app-templates/genre-<id>\`,
   and keep its \`<meta name="aimeat-register">\` line (or name your own register with
   \`custom:<name>\`); the publish refuses an Atelier app that names none. Then compose screens
   from the catalogue in the spec (hero, list, listDetail, cardGrid, form, table, statRow,
   searchBar, timeline, tabs) where the page needs them; the \`section\`
   component is the ONLY place your own raw markup goes. One look via \`app({ look })\` —
   vivid unless the owner asked for something else; flat only on request. The look brings its
   own ambient, the one layer allowed to move at idle: leave it unless the owner asked for
   weather, then name a preset with \`app({ ambient })\` (the spec lists the six).
4. **Imagery** — generate at most ONE hero and ONE empty-state image without asking
   (\`aimeat_image_generate\` → storage URL; the spec carries the style-word tables). Check the
   \`atelier.img.*\` cache first; never inline a data: URI. Zero images still looks finished.
5. **Verify** — 390×844, 1280×900 and 1280×460, both themes, no horizontal scroll, every state
   reachable, no console errors.
6. **Publish** — \`aimeat_app_publish\` with \`spec_token\`; report the live URL in the owner's
   words.

## Never, on this track

- daisyUI/Tailwind classes outside a \`section\` body.
- Hand-written ARIA, focus management or animation code — the components carry them, and a
  hand-rolled control is an accessibility regression, not a shortcut.
- A theme, palette or language control — the login pill owns all three.
- Colours in JavaScript or CSS — the \`--ak-*\` tokens are the entire look, and every preset ×
  palette × mode combination is verified arithmetically on this node.
- A background animation of your own — the ambient layer is the kit's, chosen by preset, and it
  pauses on a hidden tab, stills under Less motion and yields to the viewer's weather switch
  without a line from you.
- The Classic build spec.

When something will not complete or a decision needs a human, say so to the owner in their
words, or send it to \`support@operators\` with what you were doing and what happened instead.
`,
};
