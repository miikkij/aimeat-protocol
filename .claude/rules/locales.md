---
paths:
  - "**/aimeat/locales/**"
  - "**/aimeat/src/i18n.ts"
---

<!-- Moved verbatim from CLAUDE.md on 2026-09-13. It loads when Claude reads a file matching `paths`, not at session start. -->

## Gates for this area

- **`locales/en.json` is the source of truth for what keys exist**; the other languages (`fi`, `es`) follow through `pnpm locale:extract <tag> --prefix … ` → translate → `pnpm locale:merge <tag> <file>`, gated by `pnpm check:locales`. A key left out of a language falls back to English on its own, which is how a language gets filled in over several passes; a `[TODO:xx]` placeholder and a calque both fail the gate or the reader, and the same standard governs every non-English text this repo produces where no gate runs — prose, commit messages, records written to the node: the established term in that language, or the English one kept as is, never a form invented on the spot. A NEW language is that same loop plus two lines: the tag in `LOCALES` (`src/i18n.ts`) and an empty `locales/<tag>.json`. → skill `aimeat-writing`
- **The commands for a pass:** `pnpm check:locales --list` says how much of `en.json` each language has translated; `pnpm locale:extract es --prefix profile.agents.` takes the next slice to translate; `pnpm locale:merge es locales/.todo-es.json` puts it back, validated. (Moved from CLAUDE.md's command list on 2026-11-15.)
- **Before writing any language but English, read the language context** (`references/language-context.md` in skill `aimeat-writing`): what each thing in this product is, in one sentence, and the word already settled on for it in all three languages. A word gets picked twice for one concept otherwise, weeks apart, by writers who cannot see each other, and that is where about a fifth of the jargon backlog came from. When you name something the table does not cover, add the row in the same change. **It is for the writer and never for the cold reader**, whose whole value is having no context: on a 45-key screen it prevented three terminology defects (a machine identifier, a register clash, an invented technical compound) and moved nothing else, because half of what a cold reader finds is information the source string never had. (Moved from CLAUDE.md on 2026-11-15.)
