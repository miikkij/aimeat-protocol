---
name: aimeat-app-building
description: The research-first precondition for building any app on AIMEAT, and the repo-side rules for the app-building prompt system and the served browser SDK libs. Use when the task is to build, make, publish or fork an AIMEAT application (game or tool), or when editing src/services/build-app-prompt.ts, /v1/app-templates, or anything under src/static/sdk-libs/.
---

# Building an AIMEAT application

## Research first, before reading repo source

The moment the task is "build / make / publish an app on AIMEAT":

> You have `aimeat_*` MCP tools. Follow the research-first flow: load the skill `node:aimeat-app-builder` and call `aimeat_appdev_overview` first, then fetch `GET /v1/prompts/build-app` and `/v1/app-templates` and start from a template.

This is a hard precondition of the build, not an optional preamble, and it comes **before** reading repo source: existing published apps and the KB show which libs and patterns are already proven, so reuse beats re-deriving from lib sources. Skipping it once produced non-theming (hardcoded colours), meta-less, duplicate, low-polish apps.

Non-negotiables that flow enforces:

- Never hardcode theme colours. Light default plus `:root[data-theme="dark"]` CSS variables, or model on `prh.html` with vendored Tailwind `/lib/tailwindcss@4.js` + daisyUI `/lib/daisyui@5.css` + `/lib/aimeat-daisyui-bridge.css`.
- Include `<meta name="aimeat-scopes">`, and use only scopes that exist in the node's vocabulary. An invented scope means `INVALID_SCOPE` and nobody can log in.
- AIMEAT SDK libs load from `/v1/libs/`; vendored styling from `/lib/`. Do not mix the two.
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

## Served browser SDK libs

`/v1/libs/aimeat-*.js` are authored as componentized, JSDoc-typed ESM under `src/static/sdk-libs/<name>/` (DRY via `_core/`, under 800 lines per file), esbuild-bundled to a classic IIFE (`pnpm build:sdk`, guarded by `check:sdk` and `typecheck:sdk`), and served with a per-node config prelude by `src/routes/libs.ts`.

Never author a served lib as JavaScript inside a TypeScript template string. Edit the ESM source and rebuild. The bundle is cached, so a restart is needed to see changes. Full plan: `docs/internal/sdk-libs-migration-plan.md`.

## Removed, do not revive

The SPA service generator (`public/js/services/generator-prompts-*.js`) and the Foundry were removed in July 2026. Do not reference `generator-*` files.
