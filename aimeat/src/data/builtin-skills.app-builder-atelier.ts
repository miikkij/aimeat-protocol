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
 *   v1.6.0 — 2026-09-05 — Two steps join the shape of the work (wish-atelier-always-excellent,
 *     part 4): ASK THE KIT BEFORE YOU FORK — describe() and the six-step order (token, variant,
 *     slot, part selector, parts.row, fork) — and ACCEPT IT BESIDE THE GENRE, the screenshot at
 *     390 and 1440 in both themes placed next to the genre the app forked, with the seven
 *     measured checks under it. Copying a component instead of customising it joins the
 *     never-list.
 *   v1.5.0 — 2026-09-05 — Motion of one's own joins the never-list, because there is nothing left
 *     for it to do: arrivals, the three moves of a change, the count-up and the view crossings
 *     are the kit's defaults now, and the two opt-outs are named (wish-atelier-always-excellent).
 *   v1.4.0 — 2026-09-05 — The effects: a block's field or fx() in code, still on the words, a
 *     moment on a cue, living only behind them; a filter of one's own joins the never-list
 *     (wish-atelier-post-process-effects).
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
   weather, then name a preset with \`app({ ambient })\` (the spec lists the nine). An EFFECT
   is a field on a block of the stored arrangement (\`effect: { id, params? }\`) or
   \`AIMEAT.atelier.fx(el, { id })\` in your code: still on the words, a moment on a cue with
   \`fxPlay\`, and living motion only as \`ambient.post\` behind the words (the spec lists the
   nine, where each lands, and the knobs).
4. **Ask the kit before you fork.** Before you fork a component, ask the kit what it already gives
   you. \`AIMEAT.atelier.describe("<component>")\` returns
   \`{ parts, slots, variants, tokens, fork }\` for the eighteen components that carry the model,
   and \`describe()\` lists them; the answer is generated from each component's source and held to
   it by \`pnpm check:atelier-parts\`. The order, stopping at the first that works: a token
   (\`--ak-list-aside-size\` on your own element); a variant (\`variant: "dense"\`); a slot
   (\`extra\`, \`aside\`, \`before\`, \`after\` — the four the kit renders empty); a part selector
   inside your own scope (\`.myapp [data-ak-part="aside"] { … }\`); \`parts.row\`, which replaces
   the whole row and keeps it keyed, entered and picked; and a fork, with \`describe(id).fork\`
   read first so you know what that one costs. Two rules survive all six: the \`.ak-*\` selectors
   stay the kit's, and the motion stays the kit's.
5. **Imagery** — generate at most ONE hero and ONE empty-state image without asking
   (\`aimeat_image_generate\` → storage URL; the spec carries the style-word tables). Check the
   \`atelier.img.*\` cache first; never inline a data: URI. Zero images still looks finished.
6. **Verify** — 390×844, 1280×900 and 1280×460, both themes, no horizontal scroll, every state
   reachable, no console errors.
7. **Accept it beside the genre it forked.** An Atelier app is finished when a screenshot at 390
   and at 1440, in both themes, holds up NEXT TO the genre page it came from (open the genre at
   \`GET /v1/app-templates/genre-<id>\`, or the Design Book's genre shelf at
   \`GET /v1/designbook?kind=genre\`). Put the two pictures side by side and ask one question
   while looking: **would this pass beside the genre?** Element counts and a green matrix passed
   on pages the owner then rejected, so the picture is the evidence. Alongside it, seven measured
   checks: page width equal to the viewport at both sizes; no element past the viewport edge,
   including inside a box with \`overflow-x: clip\` or \`hidden\`; no visible text under 11 px; no
   control under 40 px at 390; contrast 4.5 for body text and 3.0 for large; no animation whose
   duration is over 1 ms under reduced motion (a collapsed one stays in
   \`document.getAnimations()\` for a frame, so count the duration rather than the objects); zero
   console errors.
8. **Publish** — \`aimeat_app_publish\` with \`spec_token\`; report the live URL in the owner's
   words.

## Never, on this track

- daisyUI/Tailwind classes outside a \`section\` body.
- Hand-written ARIA, focus management or animation code — the components carry them, and a
  hand-rolled control is an accessibility regression, not a shortcut.
- A copied component. When one is nearly what you need, customise it through the four doors above
  (a token, a variant, a slot, a part selector) and it keeps the keyed reconcile, the designed
  empty state, the accessibility wiring and every later fix. A fork gives all four away, and the
  dialog family is never forked at all — the focus trap, Escape and focus return are the
  browser's through native \`<dialog>\`, so your own markup goes in its \`body(host)\`.
- **Any motion of your own, anywhere.** It is already there: a block and a row arrive with a fade
  and a rise, a \`set()\` makes the rows that arrived rise in, the rows that left fade out where
  they stood and the rows that moved glide there, a changed figure counts to it, a tab or a
  bottom-bar pick crosses into the next view, and a dialog, drawer or toast enters and leaves.
  You call none of it. The pace and the distance are the look's, so a still register stays still
  from the same code. \`app({ motion: false })\` is the only switch, and one block stands still
  with \`motion: false\` in its props.
- A theme, palette or language control — the login pill owns all three.
- Colours in JavaScript or CSS — the \`--ak-*\` tokens are the entire look, and every preset ×
  palette × mode combination is verified arithmetically on this node.
- A background animation of your own — the ambient layer is the kit's, chosen by preset, and it
  pauses on a hidden tab, stills under Less motion and yields to the viewer's weather switch
  without a line from you.
- A filter of your own — the effects are the kit's nine (scanlines, vignette, duotone, recolour,
  distort, glitch, vhs, ripple, kaleidoscope), declared with bounds, refused where they would
  bend or recolour words, proven by the contrast matrix where they sit under them, and never
  living on content: a loop belongs behind the words, on the ambient layer.
- The Classic build spec.

When something will not complete or a decision needs a human, say so to the owner in their
words, or send it to \`support@operators\` with what you were doing and what happened instead.
`,
};
