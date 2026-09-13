---
paths:
  - "**/aimeat/public/lib/**"
  - "**/package.json"
  - "**/aimeat/scripts/*{licen,notices}*"
---

<!-- Moved verbatim from CLAUDE.md on 2026-09-13. It loads when Claude reads a file matching `paths`, not at session start. -->

## Gates for this area

- **Licensing is a gate, not a table.** MIT plus commercial users means "can a company ship this" has to keep being answerable, and a hand-kept dependency table cannot answer it: the one in `docs/coding-guidelines/dependency-management.md` had drifted three packages out of date. `pnpm check:licenses` reads the production tree AND `public/lib/` — twenty-odd browser libraries that no npm licence tool has ever looked at, and which is where the problems were — and `pnpm gen:notices` regenerates `THIRD-PARTY-NOTICES.md`, the file that carries every copyright notice. **Serving a file to a browser is distribution**, so a new file under `public/lib/` needs an entry in `licenses.json` with its licence, copyright holder and source; the gate refuses one nothing claims. A non-permissive licence needs the developer's approval and an `EXCEPTIONS` entry saying what it costs an operator. → `docs/pitfalls.md` §35
