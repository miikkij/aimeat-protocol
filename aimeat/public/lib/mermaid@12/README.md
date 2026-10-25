# Vendored Mermaid 12

`mermaid.min.js` is the single-file UMD build of Mermaid v12.2.0 (MIT), byte-identical to
`https://cdn.jsdelivr.net/npm/mermaid@12.2.0/dist/mermaid.min.js`. It sets `window.mermaid`.
Served locally (no CDN), lazy-loaded by `aimeat-markdown` (`src/static/sdk-libs/markdown/`) and the
portal's `public/components/Mermaid.js` when a diagram is on screen.

What 12 changed against 11, and what it means here:

- **ELK is bundled and is the default layout** for flowchart, state, class, ER, requirement and
  use-case diagrams. Diagrams re-lay out. `mermaid.initialize({ layout: 'dagre' })` or a diagram's
  own `config: { layout: dagre }` keeps the v11 layout. The IIFE inlines ELK, so this file is
  5.5 MB against v11's 3.6 MB.
- **A new default look.** AIMEAT passes its own `theme` (`neutral`, or `dark` in the dark theme),
  so the node's screens keep their colours. `look: 'classic'` brings back the v11 shapes.
- **ES2024, Safari 17.4 and newer.** An older Safari cannot run this file.
- `flowchart.defaultRenderer` (and the same key under `class` and `state`) is ignored. AIMEAT does
  not set it.

To update within v12: replace the file with the newer v12 `dist/mermaid.min.js`, then bump the
version in `../VENDORED.md`, `../licenses.json` (component `mermaid12`) and the `mermaid` pack in
`src/data/library-packs/vendored.ts` with a changelog entry. A Mermaid 13 ships as `mermaid@13/`.
