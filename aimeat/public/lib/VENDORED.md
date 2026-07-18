# Vendored third-party assets (self-hosted, not CDN)

These assets are vendored into `aimeat/public/lib/` and served at `/lib/...`
(via `express.static`, 7-day cache — see `aimeat/src/server-bootstrap/static-files.ts`).
Published apps load them from our own node instead of an external CDN.
App-facing libraries here are registered as **library packs** in
`aimeat/src/data/library-packs/vendored.ts` (served at `GET /v1/library-packs`
with per-lib AI docs + changelogs) — keep this table and the registry in sync.

| File | Package | Version | Pack id | Source | License |
|------|---------|---------|---------|--------|---------|
| `tailwindcss@4.js` | `@tailwindcss/browser` | 4.3.1 | `styling` | `https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4` | MIT |
| `daisyui@5.css` | `daisyui` | 5.5.23 | `styling` | `https://cdn.jsdelivr.net/npm/daisyui@5` | MIT |
| `aimeat-daisyui-bridge.css` | AIMEAT-local (theme bridge) | — | `styling` | this repo | MIT |
| `chartjs@4.js` | `chart.js` (UMD) | 4.5.1 | `chartjs` | `https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js` | MIT |
| `mermaid/mermaid.min.js` | `mermaid` (UMD) | 11.15.0 | `mermaid` | `node_modules/mermaid/dist` (see mermaid/README.md) | MIT |
| `three.min.js` | `three` (r128 UMD) | r128 | `three` | `https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js` | MIT |
| `p5@1.min.js` | `p5` | 1.11.13 | `p5` | `https://cdn.jsdelivr.net/npm/p5@1/lib/p5.min.js` | LGPL-2.1 (owner-approved 2026-07-16) |
| `pixi@8.min.js` | `pixi.js` | 8.19.0 | `pixi` | `https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.min.js` | MIT |
| `pixi-unsafe-eval@8.min.js` | `pixi.js` (unsafe-eval companion — REQUIRED after pixi under the app CSP) | 8.19.0 | `pixi` | `https://cdn.jsdelivr.net/npm/pixi.js@8/dist/packages/unsafe-eval.min.js` | MIT |
| `phaser@3.min.js` | `phaser` | 3.90.0 | `phaser` | `https://cdn.jsdelivr.net/npm/phaser@3/dist/phaser.min.js` | MIT |
| `drawflow@0.min.js` + `.min.css` | `drawflow` (engine INSIDE the aimeat-flow cortex — apps use AIMEAT.flow, never Drawflow directly) | 0.0.60 | `aimeat-flow` | `https://cdn.jsdelivr.net/npm/drawflow@0.0.60/dist/` | MIT |
| `realtime.js` | AIMEAT-local (WS/WebRTC/Yjs client + `SharedClock` synced timeline) | 1 | `realtime` | this repo | MIT |
| `toastui/toastui-editor-all.min.js` + `.min.css` | TOAST UI Editor | (SPA-internal) | — | `https://uicdn.toast.com` | MIT |
| `preact.mjs`, `preact-hooks.mjs`, `htm.mjs`, `yaml.mjs`, `minidenticons.min.js` | preact / htm / yaml / minidenticons (ESM) | (SPA-internal, importmap) | — | jsdelivr | MIT |
| `live-updates.js` | AIMEAT-local (SSE ESM wrapper) | (SPA-internal) | — | this repo | MIT |
| `samples/` | audio samples for aimeat-audio | — | — | CC | CC |

## Version policy — the major-pinned filename IS the compatibility contract

Published apps reference these files forever, so:

1. **Minor/patch updates land in place** (same filename, semver-compatible only).
   Bump the version in this table AND append a `changelog` entry to the pack in
   `library-packs/vendored.ts` — the summary is written *for an AI*: what changed
   and what it means for existing apps.
2. **A major version ships as a NEW file** (`chartjs@5.js` next to `chartjs@4.js`).
   The old file is never removed or changed — apps that keep their include lines
   keep working. The pack registry then either adds a new pack or bumps the pack's
   `include`/`majorPin` so NEW apps get the new file (with a changelog entry).
3. **Never rewrite a vendored file with breaking content under the same name.**
   (`three.min.js` predates this convention and stays as-is — a future three upgrade
   ships under a new, version-suffixed name.)

The same append-only rule applies to the node-bundled cortex wrappers
(`aimeat/public/cortex-bundled/`): a wrapper's API within a cortex name only ever
*adds*; a breaking wrapper change ships under a new cortex name (`-v2`).

## Usage in a published app (replaces the CDN incantation)

```html
<link href="/lib/daisyui@5.css" rel="stylesheet" type="text/css" />
<link href="/lib/aimeat-daisyui-bridge.css" rel="stylesheet" type="text/css" />
<script src="/lib/tailwindcss@4.js"></script>
<!-- charts: <script src="/lib/chartjs@4.js"></script> before aimeat-charts -->
```

> Note: `@tailwindcss/browser` is an in-browser JIT compiler (Tailwind's "not for
> production" build). Self-hosting removes the external-CDN dependency; it does not
> change that compilation happens in the browser. This is the pragmatic fit for
> AI-authored single-file apps whose utility classes can't be precompiled.

## Adding a new vendored library (pack checklist)

1. License check (Rule 5): MIT/Apache-2.0/ISC/BSD OK; GPL/AGPL need explicit approval.
2. Download the pinned dist file to `aimeat/public/lib/<name>@<major>.<ext>` and add a row here.
3. Add a `LibraryPack` entry in `aimeat/src/data/library-packs/vendored.ts`
   (`status: 'preview'`, include line(s), a real 10–40 line `aiDoc`, one changelog entry).
4. Add a demo template in `aimeat/src/data/app-templates/` and set `demoTemplateId`.
5. Run the drift suite: `--test=library-packs` (include URLs must 200, versions must match).
6. Flip to `status: 'stable'` only with a recorded AEB acceleration result (B beats A).

## Updating

Re-download the same pinned source URL, bump the version in this table + the pack's
`version`, and append the pack changelog entry. Keep the major-pinned filename stable.
