---
name: aimeat-library-authoring
description: How shared code is authored on the AIMEAT platform — served browser SDK libs, cortex libs, sandboxed extensions and library packs — each with its own source layout, build and gate. Use before writing or editing anything under src/static/sdk-libs/, public/cortex-bundled/, src/data/library-packs, public/lib/, an extension manifest, or when deciding where a piece of reusable code belongs.
---

# Authoring shared code

Four kinds of shared code, four different homes. Putting one in the wrong place is the recurring
mistake, so start by naming which one you are writing.

| Kind | Runs where | Source | Reached as |
|---|---|---|---|
| **Served SDK lib** | the browser | `src/static/sdk-libs/<name>/` (ESM) | `/v1/libs/aimeat-<name>.js` |
| **Cortex lib** | the browser | its own package, installed on the node | `/v1/cortex/<pack>/libs/<file>.js` |
| **Extension** | the node, QuickJS WASM sandbox | manifest + `scripts/` | `/v1/ext/<name>/<action>` |
| **Library pack** | the browser (vendored third-party) | `public/lib/` + registry entry | `/lib/<name>@<major>.js` |

**Two prefixes, never mixed:** AIMEAT SDK libs load from `/v1/libs/`, vendored styling and
third-party packs from `/lib/`. Mixing them 404s.

## Served SDK libs (`/v1/libs/aimeat-*.js`)

29 libs today. Authored as **componentized, JSDoc-typed ESM** under `src/static/sdk-libs/<name>/`,
sharing code through `_core/`, **under 800 lines per file**, esbuild-bundled to a classic IIFE with
`pnpm build:sdk`, and served with a per-node config prelude by `src/routes/libs.ts`. Guarded by
`check:sdk` (bundle in sync with sources) and `typecheck:sdk`, both in the pre-commit hook.

- **Never author a served lib as JavaScript inside a TypeScript template string.** That was the old
  `lib-*.ts` / `auth-lib-part*.ts` pattern, removed 2026-07-19. Edit the ESM source and rebuild.
- **No backticks in a served lib's JSDoc** while any template-string path remains — a stray one
  closes the literal and typecheck fails with TS1005.
- **The bundle is cached: restart the dev server** or you are testing the previous build.
- A lib is the right home for behaviour every app would otherwise re-implement. When an app needs
  something the platform should own, fix the lib rather than the app — the fix then reaches every app.

## Cortex libs

Browser IIFE installed on the node as a pack (manifest + `libs/`). The manifest wants
`spec.version`, a `filename`, and a **string** `api_surface`; it serves from the bare name.

- **The seeder is version-aware:** editing a bundled cortex `.js` without bumping the yaml
  `spec.version` will not refresh an installed node.
- Updating is `PUT /v1/cortex/<name>` with `{manifest, libs}`.
- Cortex is the layer that reads extension data and calls extension actions. It never bypasses the
  extension, and an app never bypasses cortex.

## Extensions

Server-side, sandboxed. `export default async function(ctx, input) { ... }` per action.

- **Write manifest schemas in YAML block style.** A flow mapping containing a comma breaks the
  scalar, the rest is read as a new key, and the action schema becomes garbage that fails validation
  as a 500 on install. Parse the manifest locally before uploading.
- `aimeat_extension_install` does not upsert — pass `update: true` (it survives the presigned path).
- There is no `ctx.ai` in the sandbox: a paid AI capability calls the model through `ctx.fetch` with
  a config secret. An unset secret config reads back as a truthy mask, so `if (ctx.config.key)`
  happily sends a bogus credential.
- `ctx.memory` is the extension's own sovereign `ext:{name}` namespace, and it is **world-readable**.
  "Visible to the operator only" is not something it can express.
- The sandbox has no `Date.now()` you should trust for reproducibility: take `input.now` or `ctx.now()`.

## Library packs (vendored third-party)

Registry `src/data/library-packs.ts` (+ `library-packs/{sdk,cortex,vendored}.ts`) is the **single
source every AI-facing list derives from**: the build-app prompt, `GET /v1/libs`, the bootstrap
`sdk_libraries` block and the llms.txt table. Drift is E2E-enforced, so add the pack to the registry
rather than to any of those lists.

**Version policy (`public/lib/VENDORED.md`): the major-pinned filename IS the contract.** Minor and
patch land in place with a changelog entry written *for an AI*; a major is a NEW file and the old one
is never removed. Cortex wrappers are append-only within a name; a breaking change takes a `-v2` name.

Each pack carries a `modelTier`: `any` (pin matches what models know), `frontier` (the pin breaks
against the version dominant in training data, so a weak model writes the old API and crashes) or
`needs-doc` (AIMEAT-authored, no priors, must fetch the doc). A frontier pack must carry an
`apiCaveat`, and that caveat is inlined into the build prompt because a weak model skips the doc.

## Where a new lesson goes

A trap in a lib the platform serves is platform knowledge: `docs/pitfalls.md` and, when it is
repeatable, a line here. A trap that only bites someone *building an app on top* goes to the appdev
KB via `aimeat_appdev_pitfall_report`. See the `aimeat-app-building` skill for that side.
