---
paths:
  - "**/aimeat/**/*.{ts,js,mjs,css}"
---

<!-- Moved verbatim from CLAUDE.md on 2026-09-13. It loads when Claude reads a file matching `paths`, not at session start. -->

## Gates for this area

- **File headers** (`@file`, `@description`, `@version-history`) on the `.ts`/`.js`/`.css` files you touch. Any existing source file shows the format.
- **No file over 800 lines** (`aimeat/max-file-lines`, an error, so it blocks the commit). When one grows past it, split by **pure extraction**: move a coherent group out to a sibling and change nothing else, so the diff is a move and the tests still prove it. Do not shave comments or version history to squeeze under the limit; that is how a file loses the part explaining why it is the way it is.
