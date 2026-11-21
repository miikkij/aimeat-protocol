---
name: aimeat-subagent-brief
description: "The shared contract a lead session hands to a subagent that writes code for the AIMEAT platform: the rules every brief used to restate (headers, the line ceiling, the theme's colours only, finite motion, destroy on shutdown, JSDoc, the gates it runs, what it may not touch, no browser, no node, no ports) and the report shape the lead wires from. Load when writing a brief for module-builder, or when you are the subagent and the brief says 'read the contract'. Triggers on: subagent brief, module agent, parallel build, agent contract, alagentti, brief."
license: MIT
metadata:
  audience: agent
---

# The contract between a lead and a module agent

Thirteen agents built thirteen modules in one evening (2026-09-02) and every brief restated the
same twelve rules; four agents also each built their own fake Phaser scene to test against. This
is the one copy of the rules. A brief carries this contract and then only what is specific: the
module, its seams, its demo.

**The lead pastes this contract into the brief.** module-builder has no AIMEAT tool and cannot
read the node, and the skill is visible to members only, so "read node:aimeat-subagent-brief" in a
brief reaches nothing. The lead reads it (`aimeat_skill_get node:aimeat-subagent-brief`) and pastes
the sections below.

## What the agent writes

- **Its own new files only.** Never `index.js`, never a sibling, never a stylesheet it was not
  given, never `package.json`, never a test runner config. A one-line change needed elsewhere is
  quoted in the report, exactly, for the lead to apply.
- **The agent works in the lead's own worktree**, which no other session shares: every session
  has its own worktree. `git status` may still show files that are not yours; they are the
  lead's or another subagent's, so leave every one of them.
- **Under 800 lines per file**, split by pure extraction into a sibling the entry re-exports;
  never trimmed comments or version history to fit.
- **File headers** on every file: `@file`, `@description` (the why, in prose), `@structure`,
  `@usage`, `@version-history` with today's date, as any source file in the directory shows.
- **JSDoc-typed ESM** with `.js` in relative imports, no backticks anywhere inside JSDoc (a
  stray one closes the template that carries a served lib), `pnpm typecheck:sdk` clean for a
  served lib, `pnpm typecheck` for the node.

## What the code obeys (served libraries and the Atelier kit)

- **The theme's colours only**: read them off the element (`theme(el)`, `look(scene)`), tone
  words (`accent`, `ink`, `ok`, `warn`, `err`, `ch1`..`ch4`), never a literal; the only `0x`
  in a file is a mask.
- **Finite motion**: every tween and timer ends by itself; nothing loops at idle; under the
  less-motion switch the decorative half stands down and the meaning stays (a walk still plays,
  a bob does not). Say in the header exactly what less motion does to this module.
- **Destroy on shutdown**: `scene.events.once('shutdown', destroy)`; destroy removes every
  object, texture, timer and listener it made; a second call is a no-op.
- **A class or texture name is a namespace** (docs/pitfalls.md 36): grep before naming, name
  the family after the module, never after the idea.
- **Phaser 4.2.1 is the vendored one** (`aimeat/public/lib/phaser@4.min.js`); when an API is in
  doubt, grep the min file, do not recall. Known: no `setTintFill` (use `setTint` +
  `setTintMode(FILL)`), `scale.resize` is a no-op in RESIZE mode, gamepad needs
  `input: { gamepad: true }`, `physics.overlapRect` exists.
- **Memory shape**: one key per player or per record, never one key per row; a store section,
  not a new key.

## What the agent does not do

No Playwright browser. Each session has its own browser, but it has one tab, and the lead runs
one browser agent (`browser-verifier`, `ui-conformance` or `ui-design-review`) at a time after the
modules are in; a module agent never drives it. No node start or restart, no port, no E2E suite,
no publish. No `pnpm build:sdk` unless the brief says so. Verification is a node script against
the shared stub harness (`aimeat/test/unit/phaser-stub.mjs` for Phaser modules, `makeDom()` for
DOM panels, `makeAudioContext()` for sound; the brief names others), written in the scratchpad
unless a repo unit test was asked for.

## Gates the agent runs

`pnpm exec eslint <own files>`, `node --check <own files>`, the typecheck named in the brief. An
error the typecheck reports in a file that is not yours belongs to whoever is writing it: say so
and make sure your own files are clean. `check:licenses` when a file under `public/lib` was
added; `check:plain-language` when a message a person reads was added.

## The report

Six parts, nothing else: (a) exports and their JSDoc shapes; (b) a table of what the module
offers, one line each; (c) the demo snippet of the size asked, using only the exported surface;
(d) any one-line change needed elsewhere, quoted; (e) gate outputs verbatim; (f) what was left
and why, including what the harness could not prove. No story of how the work went.

## Effort

module-builder runs at `low` by default (its definition says so); that suits a bounded piece with
a clear shape (a preset table, a skill text, a CSS partial). Give it `medium` for a state machine,
a scheduler or anything with timing; the lead decides and says so in the spawn.
