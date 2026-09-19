---
name: aimeat-library-authoring
description: How shared code is authored on the AIMEAT platform: served browser SDK libs, cortex libs, sandboxed extensions and library packs, each with its own source layout, build and gate. Use before writing or editing anything under src/static/sdk-libs/, public/cortex-bundled/, src/data/library-packs, public/lib/, an extension manifest, or when deciding where a piece of reusable code belongs.
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

About forty libs (count the directories under `src/static/sdk-libs/`, leaving out `_core` and `dist`). Authored as **componentized, JSDoc-typed ESM** under `src/static/sdk-libs/<name>/`,
sharing code through `_core/`, **under 800 lines per file**, esbuild-bundled to a classic IIFE with
`pnpm build:sdk`, and served with a per-node config prelude by `src/routes/libs.ts`. Guarded by
`check:sdk` (bundle in sync with sources), which runs in `pnpm gate` and CI, and `typecheck:sdk`, which runs in the pre-commit hook. A stale bundle therefore passes a commit and is caught by the gate, so run `pnpm build:sdk` before you commit.

- **Never author a served lib as JavaScript inside a TypeScript template string.** That was the old
  `lib-*.ts` / `auth-lib-part*.ts` pattern, removed 2026-07-19. Edit the ESM source and rebuild.
- **No backticks in a served lib's JSDoc** while any template-string path remains. A stray one
  closes the literal and typecheck fails with TS1005.
- **The bundle is cached: restart the dev server** or you are testing the previous build.
- A lib is the right home for behaviour every app would otherwise re-implement. When an app needs
  something the platform should own, fix the lib rather than the app; the fix then reaches every app.

## Cortex libs

Browser IIFE installed on the node as a pack (manifest + `libs/`). The manifest wants
`spec.version`, a `filename`, `exports` as a list of strings and a **string** `api_surface` (a YAML
block scalar); anything else is refused naming the field. Every lib component's `filename` needs
its source under `libs` in the same call (`{ manifest, libs: { "x.js": "..." } }`), or the install
is refused; it serves from the bare name.

- **The seeder is version-aware:** editing a bundled cortex `.js` without bumping the yaml
  `spec.version` will not refresh an installed node.
- Updating is `PUT /v1/cortex/<name>` with `{manifest, libs}`.
- **A cortex pack cannot import a served SDK lib**, and the portal under `public/js/` cannot either.
  When one needs a function a lib already has, it carries a copy whose header names the original,
  and a unit test feeds both the same inputs: `test/unit/cortex-surface-parse-amount.test.ts` holds
  two copies of `parseAmount` to `commerce/amount.js`. A third hand-written variant is how
  `'1,500.00'` came to read as 1.5 in three places at once.
- Cortex is the layer that reads extension data and calls extension actions. It never bypasses the
  extension, and an app never bypasses cortex.

## Extensions

Server-side, sandboxed. `export default async function(ctx, input) { ... }` per action.

**The full `ctx` table, and which run gets which member, is the node's build-extension prompt**
(`GET /v1/prompts/build-extension`, source `src/services/build-extension-prompt.ts`).
`test/unit/build-extension-prompt.test.ts` runs a script in the sandbox and fails when a member the
guest receives is missing from that table, so change the table in the same commit as the sandbox.

- **Write manifest schemas in YAML block style.** A flow mapping containing a comma breaks the
  scalar, the rest is read as a new key, and the action schema becomes garbage that fails validation
  as a 500 on install. Quote a description containing `: `; an install that does not parse answers
  with the line and column.
- `aimeat_extension_install` does not upsert: pass `update: true` (it survives the presigned path).
- **The node does not check `input` against the action's `input` schema.** The schema is published
  for callers and the market; the script checks the fields it reads.
- **On a schedule, a workflow step or an `ai.start` `on_done` action, a normal return is a success
  whatever it contains.** A missing capability or a failed precondition must `throw`. Test the method
  (`ctx.wallet.consume`), not the object: `ctx.wallet` is always an object.
- An `undefined` or `null` argument to a `ctx` call throws, naming the method and the position
  (until 2026-09-13 it crossed the bridge as the text "undefined").
- `ctx.ai.start` starts a background model call, billed to the extension's owner, and is absent on a
  schedule and a workflow step. For a synchronous paid answer, call the provider through `ctx.fetch`
  with a `type: secret` config or a `{{secret:NAME}}` header. A secret nobody set is `undefined` in
  `ctx.config` (until 2026-09-13 it read as the descriptor object or the mask, both truthy).
- `ctx.memory` is the extension's own sovereign `ext:{name}` namespace, and a key is **public unless
  the write passes `{ visibility: 'private' }`**. The flag belongs on every write that holds personal
  data (a write without it stores the key public again), and a code fix does not re-secure rows
  already stored. An owner-only view is a private key served through an action that compares
  `ctx.extension.owner` with `ctx.caller.owner`.
- `ctx.workspace` is how an extension reaches an organism workspace, and it does so **as the caller**:
  the manifest declares `workspace: { read: true, write: true }` at the top level, and `index`, `get`,
  `write`, `writeDoc` and `publish` then run the same operations `aimeat_workspace_read/_write/_publish`
  run, with the same refusals (membership, the contributor grant, `memory:write` on an agent or app
  token, the locked schema, `ifVersion`, the publish gate) thrown as `CODE: message`. It is absent on
  a scheduled run and absent without the declaration; check `if (!ctx.workspace)`. Do not reach a
  workspace through `ctx.fetch` or `ctx.memory`: the first cannot reach the node and the second is
  fenced to `ext:`.
- **A collector writes one key per PERIOD, never one per item fetched.** The namespace carries the
  same budget as any principal: 1024 kB per value, 1000 keys by default. `ext:halytyskartta-ext` keeps
  a whole day of alerts in `alerts.byDate.{date}` at a 74 kB median and is fine; `ext:luotain` kept one
  key per article and reached 1,014 keys, over the shipped ceiling, while a 448 kB `index` key sat in
  the same namespace proving the megabyte works. The gate before shipping a scheduled collector: if
  `keys_per_day × 365` exceeds 1000, fold. Carry a `<prefix>.__index` key listing the periods held so
  a reader finds them without a scan.
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
