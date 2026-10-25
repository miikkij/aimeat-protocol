# Vendored Mermaid 11 (superseded)

`mermaid.min.js` is the single-file UMD build of Mermaid v11.17.2 (MIT), byte-identical to
`https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js`.

**Superseded on 2026-10-25 by `../mermaid@12/mermaid.min.js`.** This file is kept unchanged for
the apps that name `/lib/mermaid/mermaid.min.js` themselves (`pnpm libs:usage` lists them). The
node's own loaders, `aimeat-markdown` and the portal's Mermaid component, load v12. Never update
this file in place: a Mermaid 11 patch would still land here, a v12 change never does.
