---
name: aimeat-app-building
description: The research-first precondition for building any app on AIMEAT, and the repo-side rules for the app-building prompt system and the served browser SDK libs. Use when the task is to build, make, publish or fork an AIMEAT application (game or tool), or when editing src/services/build-app-prompt.ts, /v1/app-templates, or anything under src/static/sdk-libs/.
---

# Building an AIMEAT application

## Research first, before reading repo source

The moment the task is "build / make / publish an app on AIMEAT":

> You have `aimeat_*` MCP tools. Follow the research-first flow: load the skill `node:aimeat-app-builder` and call `aimeat_appdev_overview` first, then fetch `GET /v1/prompts/build-app` and `/v1/app-templates` and start from a template.

This is a hard precondition of the build, not an optional preamble, and it comes **before** reading repo source: existing published apps and the KB show which libs and patterns are already proven, so reuse beats re-deriving from lib sources. Skipping it once produced non-theming (hardcoded colours), meta-less, duplicate, low-polish apps.

Four node-side stores answer almost everything, and they are shared by every session:

- **`aimeat_appdev_overview`**: what apps, extensions and capabilities already exist. Check before building anything.
- **`aimeat_skill_list`** then **`aimeat_skill_get`**: most published apps carry their own operating guide as a skill (`user:{owner}/{app}-agent-guide`, `cadence-crm`, `operate-exchange`, `node:origami-boards`, …). If you are working on or against a named app, load its skill instead of reconstructing how it works.
- **App Development Notes**: the dev organism's workspace `fbb51de5-56d5-4143-9871-b998a1187655` / `ws-mslr8u99kzk`, one `appnote` document per app: locked design decisions, prod organism/workspace ids, traps hit while building, open questions the developer still owns. Read the app's note before changing it; write back what the next session would want.
- **`aimeat_appdev_pitfall_list`**: the app-building trap catalogue (curated plus what other sessions learned).

Where a new lesson goes depends on who needs it, and the three are not interchangeable:

| What you learned | Where it goes |
|---|---|
| How to use or operate the app | its skill: **public**, bound with `metadata.binding` |
| How it was built, and what is still open | an **App Development Notes** document |
| A trap that would bite anyone building here | `aimeat_appdev_pitfall_report` |

**Never put development notes in a skill.** Skills are published and app-bound; they are written for whoever uses the app, not for the developer building it.

Non-negotiables that flow enforces:

- Never hardcode theme colours. Light default plus `:root[data-theme="dark"]` CSS variables, or model on `prh.html` with vendored Tailwind `/lib/tailwindcss@4.js` + daisyUI `/lib/daisyui@5.css` + `/lib/aimeat-daisyui-bridge.css`.
- Include `<meta name="aimeat-scopes">`, and use only scopes that exist in the node's vocabulary. An invented scope means `INVALID_SCOPE` and nobody can log in.
- AIMEAT SDK libs load from `/v1/libs/`; vendored styling from `/lib/`. Do not mix the two.
- **Touch input goes through `aimeat-input`, never a hand-rolled `touchstart` listener.** `AIMEAT.input.tappable(el, fn)` for every button, card and row (built on `click`, so tap, mouse and Enter/Space each arrive once and a screen reader announces it); `AIMEAT.input.on(el, handlers, { axis })` when a click is not enough, declaring `axis` on anything that also scrolls. A hand-rolled touch listener fires twice, triggers mid-scroll, and locks out the keyboard. The mobile rules in the build-app prompt cover LAYOUT; this is the other half.
- Morsels are plain integers, never the meat emoji.
- Check `aimeat_appdev_overview.apps` for an existing app or capability before building. Reuse beats duplicate.

App sources live in the `aimeat-apps/` repo, not in this protocol repo.

## The app-building prompt system

The canonical prompt is **node-served** at `GET /v1/prompts/build-app`; source of truth is `src/services/build-app-prompt.ts`. It builds single-file HTML apps.

Two consumers: the app-catalog "Create new app" flow fetches it (`src/static/app-catalog/js/cortex.js` keeps only an offline fallback), and the OpenHands app-builder (`tools/aimeat-openhands/`, via its `aimeat-app-builder` skill) fetches the same spec at runtime. Agent-facing discovery is `/llms.txt` plus the bootstrap `app_building` block.

**Improve app-building guidance in the node service (`build-app-prompt.ts`), never in the catalog fallback.**

When editing that prompt or any app-building guidance, verify every API claim against the served browser SDK sources under `src/static/sdk-libs/<name>/` and `public/cortex-bundled/*.js`:

- extension data → `getPublic('ext:name', key)`
- user data, including translations and settings → `AIMEAT.data.get(key)`, never `getPublic('ext:...')`
- extension actions → `export default async function(ctx, input) { ... }`

### Memory record shape, decided before the first `set()`

An app that treats memory as a cell-per-fact burns the key budget and gains nothing. The measured
limits, from `src/config.ts`: **1024 kB per value**, **1000 keys per principal** by default. aimeat.io
runs the key ceiling at 100 000, which no other node does, so build against 1000.

- One key holds one entity a user can open on its own, or one collection they read as a unit. Never
  one key per field, never one key per row of a list the UI always renders together. A high-score
  table is one key holding an array.
- **The gate: if `keys_per_day × 365` exceeds 1000, the shape is wrong.** Fold per-item keys into a
  per-period record (`myapp.log.2026-08` holding an array); split only past ~256 kB serialised.
- Nesting is free for search: the key, its segments, the tags and the scalars inside the value are all
  indexed. Stay within 5 levels of the value root (Postgres stops collecting past 6).
- A key name is a stable address, not a sentence: no titles, no tag labels, no user-typed text.

Shared feeds still need one key per **author**, because a user may only write their own namespace.
That is not a reason for one key per entry: `getPublic(gaii, key)` needs a known key either way, and
the data SDK has no cross-owner enumeration at all, so the per-entry split buys no discovery.

Background and the numbers: **MEMORY KEY SHAPE AUDIT** in Platform Development Notes.

## Served browser SDK libs

Loading them is app work; **authoring or fixing one is platform work** and has its own rules (ESM
source under `src/static/sdk-libs/<name>/`, esbuild bundle, never JS inside a TypeScript template
string, cached bundle needs a restart). → skill `aimeat-library-authoring`.

The rule that matters from this side: when an app needs behaviour the platform should own, **fix the
lib, not the app**; the fix then reaches every app instead of one.

## Removed, do not revive

The SPA service generator (`public/js/services/generator-prompts-*.js`) and the Foundry were removed in July 2026. Do not reference `generator-*` files.
