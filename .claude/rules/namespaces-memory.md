---
paths:
  - "**/aimeat/src/{services,routes,storage,mcp,data}/**"
  - "**/aimeat/src/static/sdk-libs/**"
  - "**/aimeat/public/cortex-bundled/**"
  - "**/packages/**"
---

<!-- Moved verbatim from CLAUDE.md on 2026-09-13. It loads when Claude reads a file matching `paths`, not at session start. -->

## Extension, cortex and app namespaces

Full guide: `docs/coding-guidelines/extension-memory-architecture.md`.

| Namespace | Who writes | Who reads |
|-----------|-----------|-----------|
| **Owner** (`alice@node-id`) | the user via authenticated API | the user, and extensions via `ctx.memory.getPublic(gaii, key)` |
| **Extension** (`ext:{name}`) | only that extension, via `ctx.memory.set()` | anyone, no auth |

- **Extension** (WASM sandbox) owns `ext:{name}`, reads owner data via `ctx.memory.getPublic(ctx.caller.gaii, key)`, calls external APIs via `ctx.fetch()`.
- **Cortex** (browser IIFE) reads extension data via `AIMEAT.data.getPublic('ext:name', key)`, reads and writes user data via `AIMEAT.data.get/set()`, calls extension actions via `session.fetch('/v1/ext/name/actionId')`.
- **Translations and settings are user data.** Cortex reads them with `AIMEAT.data.get('service.i18n.fi')`, never from an `ext:` namespace.
- **Apps** call cortex public methods only. Never `callExt`, `readExtMemory`, `/v1/ext/` or `/v1/memory/ext:`.

The extension is sovereign: it decides storage, format and return shape. Cortex trusts the extension API, the app trusts cortex, and no layer bypasses the one below. Common mistakes: `docs/pitfalls.md` §8, plus §5 for translation keys.

**A memory value is a record, not a cell.** One key holds one entity a user can open on its own, or one collection they read as a unit. Never one key per field, and never one key per row of a list that is always rendered together. The budget, measured from `src/config.ts`: **1024 kB per value** and **1000 keys per principal** by default (aimeat.io runs the key ceiling at 100 000, which no other node does, so build against 1000). A whole small database fits in one key, search indexes the scalars inside it to six levels deep on Postgres and at any depth on SQLite, and a key name is a stable address rather than a sentence. The check before shipping anything that writes on a schedule: **if `keys_per_day × 365` exceeds 1000, the shape is wrong** and the per-item keys belong in a per-period record. This cost a 941-key article store sitting next to a working 448 kB key in the same namespace; the full measurement is the **MEMORY KEY SHAPE AUDIT** note in Platform Development Notes.
