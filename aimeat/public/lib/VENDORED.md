# Vendored third-party assets (self-hosted, not CDN)

These assets are vendored into `aimeat/public/lib/` and served at `/lib/...`
(via `express.static`, 7-day cache — see `aimeat/src/server-bootstrap/static-files.ts`).
Published apps load them from our own node instead of an external CDN.
App-facing libraries here are registered as **library packs** in
`aimeat/src/data/library-packs/vendored.ts` (served at `GET /v1/library-packs`
with per-lib AI docs + changelogs) — keep this table and the registry in sync.

**Adding a library here is distribution, so it needs a licence entry.** Serving a file to a browser
carries the same obligation a tarball does, and most of these are minified builds with no copyright
line left in them, so the file alone satisfies nothing. [`licenses.json`](licenses.json) is the
machine-readable inventory — licence, copyright holder, source, and for copyleft a complete-source
offer — and `LICENSES/` holds each licence text. `pnpm check:licenses` refuses a served file that no
entry claims, which is the gate that stops a library arriving without its notice, and
`pnpm gen:notices` regenerates `THIRD-PARTY-NOTICES.md` from it. This table stays the version and
compatibility contract; the licence half lives in the JSON so tools can read it.

| File | Package | Version | Pack id | Source | License |
|------|---------|---------|---------|--------|---------|
| `tailwindcss@4.js` | `@tailwindcss/browser` | 4.3.3 | `styling` | `https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4` | MIT |
| `daisyui@5.css` | `daisyui` | 5.7.22 | `styling` | `https://cdn.jsdelivr.net/npm/daisyui@5` | MIT |
| `aimeat-theme.css` | AIMEAT-local (the theme SYSTEM: 5 palettes × light+dark on the `data-theme` × `data-palette` axes, self-hosted faces, elevation/motion/type tokens; verified by `pnpm check:theme`) | 2.0.0 | `styling` | this repo | MIT |
| `aimeat-daisyui-bridge.css` | AIMEAT-local (theme bridge; `@import`s the theme) | — | `styling` | this repo | MIT |
| `chartjs@4.js` | `chart.js` (UMD) | 4.5.1 | `chartjs` | `https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js` | MIT |
| `d3@7.min.js` | `d3` (UMD — `window.d3`; the full v7 bundle: selection, scales, shapes, hierarchy, force, geo) | 7.9.0 | `d3` | `https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js` | ISC |
| `mermaid/mermaid.min.js` | `mermaid` (UMD) | 11.17.2 | `mermaid` | `node_modules/mermaid/dist` (see mermaid/README.md) | MIT |
| `three.min.js` | `three` (r128 UMD; SUPERSEDED by `three-world@1.min.js`, which is r185 with the same `window.THREE` — three ships no UMD build any more, so there is no newer file to put here) | r128 | `three` (deprecated) | `https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js` | MIT |
| `three-world@1.min.js` | `three` + addons OrbitControls, Sky, RGBELoader (esbuild IIFE — `window.THREE`, addons on `THREE.Addons`; never load together with `three.min.js`) | 0.185.1 (r185), bundle v1 | `three-world` | built by `aimeat/scripts/vendor-three-world.mjs` from `registry.npmjs.org/three/-/three-0.185.1.tgz` | MIT |
| `three-world-loaders@1.min.js` | three.js example addons GLTFLoader, RoomEnvironment, BufferGeometryUtils, SkeletonUtils (esbuild IIFE that binds to the already-loaded `window.THREE` and attaches to `THREE.Addons`; loaded lazily by the Atelier kit's scene3d kind `model` AFTER three-world@1) | 0.185.1 (r185), bundle v1 | — (kit-internal) | built by `aimeat/scripts/vendor-three-loaders.mjs` from `cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/` | MIT |
| `aimeat-atlas@1.json` | Natural Earth 110m country shapes pre-projected to SVG paths (geometry DATA for the Atelier kit's `atlas` component — not a script; loaded lazily by the kit itself) | world-atlas 2.0.2 | — (kit-internal) | built by `aimeat/scripts/vendor-atlas-data.mjs` from `cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json` | data: public domain (Natural Earth); packaging: ISC |
| `leaflet@1/` | Leaflet (leaflet.js + leaflet.css + images/) — the real interactive map; tiles come from OpenStreetMap at runtime with the licence-required attribution | 1.9.4 | `leaflet` | `https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/` | BSD-2-Clause |
| `p5@1.min.js` | `p5` (SUPERSEDED by `p5@2.min.js`; kept forever for the sketches that name it) | 1.11.13 | `p5` (deprecated) | `https://cdn.jsdelivr.net/npm/p5@1/lib/p5.min.js` | LGPL-2.1 (owner-approved 2026-07-16) |
| `p5@2.min.js` | `p5` | 2.3.2 | `p5v2` | `https://cdn.jsdelivr.net/npm/p5@2.3.2/lib/p5.min.js` | LGPL-2.1 (owner-approved 2026-08-31) |
| `pixi@8.min.js` | `pixi.js` | 8.20.1 | `pixi` | `https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.min.js` | MIT |
| `pixi-unsafe-eval@8.min.js` | `pixi.js` (unsafe-eval companion — REQUIRED after pixi under the app CSP) | 8.20.1 | `pixi` | `https://cdn.jsdelivr.net/npm/pixi.js@8/dist/packages/unsafe-eval.min.js` | MIT |
| `phaser@3.min.js` | `phaser` (SUPERSEDED by `phaser@4.min.js`; kept forever for the games that name it) | 3.90.0 | `phaser` (deprecated) | `https://cdn.jsdelivr.net/npm/phaser@3/dist/phaser.min.js` | MIT |
| `phaser@4.min.js` | `phaser` | 4.2.1 | `phaser4` | `https://cdn.jsdelivr.net/npm/phaser@4.2.1/dist/phaser.min.js` | MIT |
| `drawflow@0.min.js` + `.min.css` | `drawflow` (engine INSIDE the aimeat-flow cortex — apps use AIMEAT.flow, never Drawflow directly) | 0.0.60 | `aimeat-flow` | `https://cdn.jsdelivr.net/npm/drawflow@0.0.60/dist/` | MIT |
| `fonts.css` + `fonts/*.woff2` | Baloo 2 + Bangers display fonts (the `fonts` pack, via `fonts.css`) AND the theme-system faces Inter, Space Grotesk, Fraunces, JetBrains Mono (declared by `aimeat-theme.css`, lazy-loaded per family). All latin + latin-ext (ä/ö); see `fonts/LICENSE.md` | Baloo 2 v23 · Bangers v25 · Inter v20 · Space Grotesk v22 · Fraunces v38 · JetBrains Mono v24 | `fonts` / `styling` | Google Fonts CDN (see `fonts/LICENSE.md`) | OFL-1.1 |
| `realtime.js` | AIMEAT-local (WS/WebRTC/Yjs client + `SharedClock` synced timeline) | 1 | `realtime` | this repo | MIT |
| `toastui/toastui-editor-all.min.js` + `.min.css` | TOAST UI Editor | (SPA-internal) | — | `https://uicdn.toast.com` | MIT |
| `pdfjs@6/pdf.min.mjs` + `pdf.worker.min.mjs` | `pdfjs-dist` (ESM + worker) | 6.3.289 | `pdfjs` | `https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/` | Apache-2.0 |
| `ffmpeg-core@0.12.6/ffmpeg-core.js` + `.umd.js` + `ffmpeg-core.wasm` | `@ffmpeg/core` (SUPERSEDED by `ffmpeg-core@0.12.10/`; kept forever for the apps that name this path) | 0.12.6 | `ffmpeg-core` | `https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/` (UMD loader from `dist/umd/`) | GPL-2.0-or-later (the compiled ffmpeg: `--enable-gpl --enable-libx264 --enable-libx265`; the npm `license: MIT` covers only the packaging) |
| `ffmpeg-core@0.12.10/ffmpeg-core.js` + `.umd.js` + `ffmpeg-core.wasm` | `@ffmpeg/core` (ffmpeg 5.1.4, single-threaded) | 0.12.10 | `ffmpeg-core` | `https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm/` (UMD loader from `dist/umd/`) | GPL-2.0-or-later, same build flags as 0.12.6 |
| `duckdb-wasm@1.32.0/duckdb-browser.js` + `duckdb-browser-eh.worker.js` + `duckdb-eh.wasm` + `extensions/v1.4.3/wasm_eh/parquet.duckdb_extension.wasm` | `@duckdb/duckdb-wasm` (eh = single-threaded) + `apache-arrow` bundled in | 1.32.0 (arrow 17.0.0) | `duckdb-wasm` | built by `aimeat/scripts/vendor-duckdb-wasm.mjs`; the two .wasm files fetched by `pnpm vendor:libs` | MIT (arrow: Apache-2.0) |
| `yaml.mjs` | `yaml` (ESM) | 2.x | `yaml` | jsdelivr | ISC |
| `preact.mjs`, `preact-hooks.mjs`, `htm.mjs`, `minidenticons.min.js` | preact / htm / minidenticons (ESM). The exact version is in each file's own banner — read it there before guessing, which is how these three sat at "10" and "3" in the inventory and were skipped by every scanner. | preact 10.29.8 · htm 3.1.1 · minidenticons 4.2.1 | — (SPA-internal, importmap) | `cdn.jsdelivr.net/npm/preact@10.29.8/dist/` (preact AND hooks from the same dist — mixing build variants breaks the app) · jsdelivr | MIT (htm: Apache-2.0) |
| `live-updates.js` | AIMEAT-local (SSE ESM wrapper) | (SPA-internal) | — | this repo | MIT |
| `samples/` | audio samples for aimeat-audio | — | — | CC | CC |

## Assets that are fetched, not committed

Anything listed in [`vendored-assets.json`](vendored-assets.json) is **not in git**, for one of two
reasons. **Size:** a repository carries every version of every binary it has ever held, and one
32 MB blob per ffmpeg bump is a permanent tax on every clone. **Licence:** an asset marked
`"distribute": false` is one AIMEAT must not ship at all, and the build skips it when copying
`public/` into `dist/` (see `scripts/copy-dist-assets.mjs`) so it cannot reach a package.

```bash
pnpm vendor:libs       # download what is missing, verify the pinned sha256 (idempotent)
pnpm check:vendored    # "are they in place?" — non-zero exit and the missing paths if not
```

`postinstall`, `pnpm dev` and `pnpm build` all run the fetch, so a normal install or deploy has the
files without anyone remembering. The server also names any missing asset at boot, because a 404 on
a library path otherwise looks like an application bug for a day. Offline machine:
`AIMEAT_SKIP_VENDOR=1` opts out, and the affected `/lib/` paths then 404.

Fetched assets are **hash-pinned**, not just URL-pinned: if the registry ever serves different bytes
the script refuses them rather than shipping something nobody reviewed. Add a new one by appending
to `vendored-assets.json` (path, url, sha256, bytes) and to the table above.

This is also how a GPL binary sits next to an MIT codebase without a licence question: all three
ffmpeg files are **installed separately** by the fetch step and are in neither the repository nor
any AIMEAT distribution. AIMEAT stays MIT; the node serves an unmodified upstream build whose
source is at [ffmpegwasm/ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) (build scripts) and
[ffmpeg.org](https://ffmpeg.org) (ffmpeg 5.1.4). Owner-approved 2026-07-31, same route as the
LGPL p5 pack.

**That sentence was false until 2026-08-31, and the shape of the mistake is worth keeping.** Only
the 32 MB `.wasm` was excluded. The two emscripten loaders beside it — `ffmpeg-core.js` and
`ffmpeg-core.umd.js`, 112 kB each — were committed, because they were judged by size rather than by
licence, and a compiler's output of a GPL work is that work. Worse, the `.wasm` reached the npm
package anyway: `pnpm build` runs the fetch and then copies `public/` into `dist/`, and
`files: ["dist/"]` published all 32 MB of it. Every `aimeat` release up to 3.10.0 shipped a GPL
ffmpeg build inside an MIT package while this file said it did not. Three things now hold the
sentence up, and no single one of them would have: the assets are marked `"distribute": false`, the
build's copy step skips them, and `pnpm check:licenses` fails when a GPL asset is either unmarked or
tracked by git.

Directories that pin a **full** version (`ffmpeg-core@0.12.6/`) are served `immutable` for a year —
that path can never change, since even a patch bump ships as a new directory. Major-only pins
(`pdfjs@6/`, `chartjs@4.js`) keep revalidating, because minor updates land in them in place.

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
<link href="/lib/aimeat-theme.css" rel="stylesheet" type="text/css" />
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
