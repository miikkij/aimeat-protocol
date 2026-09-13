---
paths:
  - "**/aimeat/locales/**"
  - "**/aimeat/src/i18n.ts"
---

<!-- Moved verbatim from CLAUDE.md on 2026-09-13. It loads when Claude reads a file matching `paths`, not at session start. -->

## Gates for this area

- **`locales/en.json` is the source of truth for what keys exist**; the other languages (`fi`, `es`) follow through `pnpm locale:extract <tag> --prefix … ` → translate → `pnpm locale:merge <tag> <file>`, gated by `pnpm check:locales`. A key left out of a language falls back to English on its own, which is how a language gets filled in over several passes; a `[TODO:xx]` placeholder and a calque both fail the gate or the reader, and the same standard governs every non-English text this repo produces where no gate runs — prose, commit messages, records written to the node: the established term in that language, or the English one kept as is, never a form invented on the spot. A NEW language is that same loop plus two lines: the tag in `LOCALES` (`src/i18n.ts`) and an empty `locales/<tag>.json`. → skill `aimeat-writing`
