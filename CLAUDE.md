# CLAUDE.md: AIMEAT Protocol

## What this is for

Read this before proposing anything. When a design question is genuinely open, these decide it, and every one of them has cost a rewrite when it was forgotten.

**The goal is that people become AI-native.** Success is someone doing their work through their own AI and finding the system worth having. Logging into a website to type into forms is the fallback, not the destination.

**AI chat is the primary interface, and MCP is the preferred road in.** The web is the machine room: it shows status and holds the controls that genuinely need a screen. So a capability reachable only by clicking is not finished. Design the chat path first, then the surface that shows what happened.

**The data is refined knowledge the user brought and owns.** Ownership is the product. That is why identity, consent and provenance are load-bearing rather than compliance overhead, and why a feature that erodes ownership is wrong even when it is convenient.

**Agents are first-class users.** They arrive through device authorization, the hello-integration flow and the `aimeat-crewai` liaison package, and an agent should be able to do what a person can do. An agent-shaped door added after the fact is a symptom that the feature was designed for a screen.

**People's intelligences come from different vendors and arrive from different directions.** The system's job is to let them share what they know without a migration and without a lock-in. Organisms, workspaces and skills exist for that.

**Knowledge has a lifecycle.** What matters stays relevant; what stopped mattering ages, gets marked, or is cleaned away. A store with no way to forget becomes what this project's own local memory became by 2026-08-09: 1.6 MB that loaded whether or not it applied. Any surface that accumulates knowledge needs an answer to "how does this go stale".

One more, from how this is sold rather than built: lead with what a person gets, not with the protocol.

---

The AIMEAT protocol (AI Memory Exchange and Action Transfer) and its reference implementation. Three parts:

- **The spec.** `openapi.yaml` is the canonical API contract. `docs/AIMEAT-RFC-v4.0-Core-full.md` (generic federatable Core) + `docs/AIMEAT-RFC-v4.0-Platform-full.md` (the aimeat.io platform on top of it). v4.0 reframes the economy as meters rather than currencies and deprecates micro-memory, OTK/Tier 0.5 and the legacy Ed25519 owner-key login; micro-memory and the three OTK write routes were then deleted from the code on 2026-08-23. **Boards were deprecated and reinstated on 2026-08-30**, so they are current: 57 live on aimeat.io, they have a Boards page, a front-page block and `AIMEAT.social`. v4.0 is a conceptual reframe, not an API break.
- **The node** in `aimeat/`: Node 24, TypeScript, Express 5, port 40050, pnpm. Frontend is a Preact + HTM SPA with no build step (the app-catalog is the one exception, an esbuild build).
- **`python/aimeat-crewai/`**, a pip-installable CrewAI integration. Part of this repo, with its own version line. When agent-facing capabilities change (offers, workflow signals, onboarding, MCP surface), keep it in sync. The node schema wins on any mismatch.

**Prompt-driven workflow** is the road in for everyone MCP cannot reach, and it ranks under the MCP path above rather than beside it. Some tools connect over MCP (Claude, Claude Code, Codex, Cursor, VS Code); others cannot (a consumer Gemini app, Copilot without Copilot Studio, ChatGPT without a paid Developer mode), and for those the app composes a ready-made prompt, the user runs it in their own chat and brings the result back, with earlier results feeding later prompts. It is free, AI-agnostic, and the user sees everything before it is submitted. When adding to such a flow, the work is in the prompt text, not in UI buttons or backend logic.

## Two ways of working, and where each one's knowledge lives

**Platform work** is this repo: the node core and the libs it serves. **Application work** builds *on* the platform: apps live in `aimeat-apps/` and are published to the node. An app may add its own libs, extensions or cortex packs; it does not edit core.

Know which one you are doing, because the knowledge sits in different places and mixing them wastes a session:

- **Platform work** reads `docs/pitfalls.md` (traps by symptom), `docs/known_gaps.md` (deferred, developer-approved only) and `docs/coding-guidelines/`, plus the **Platform Development Notes** workspace in the dev organism (`fbb51de5-…` / `ws-mslunjvcgxj`, 166 documents) for how a capability was actually built. Design specs and plans live in the **Development** workspace (`ws-mq664uyfz21`); the notes say what shipped, what broke and what is still open.
- **Application work** reads the node, which is shared by every session and is the source of truth: `aimeat_appdev_overview` for what already exists, `aimeat_skill_list` + `aimeat_skill_get` for a named app's operating guide, the **App Development Notes** workspace in the dev organism (`fbb51de5-…` / `ws-mslr8u99kzk`, one document per app) for how it was built, and `aimeat_appdev_pitfall_list` for app-building traps. Start there, per the `aimeat-app-building` skill.

Nothing in this repo describes an individual application, and nothing should. A durable lesson about one has three possible homes, and they are not interchangeable:

| What you learned | Where it goes |
|---|---|
| How to **use or operate** the app | its own skill: public, bound to the app with `metadata.binding` |
| How it was **built**: locked decisions, prod ids, traps hit, open questions | a document in **App Development Notes** (developer-facing, not public) |
| A trap that would bite **anyone building an app** here | the appdev KB, via `aimeat_appdev_pitfall_report` |

Development notes never go in a skill: skills are published and app-bound, written for whoever uses the app. They also never go in a repo file or a local memory, where only this repo or this session can see them.

**Platform knowledge splits the same way.** A rule belongs in this file, in a path rule under `.claude/rules/`, or in a skill. A repeatable trap in platform code belongs in `docs/pitfalls.md`. What a capability's build actually cost, and what it left open, belongs in a **Platform Development Notes** document. The appdev KB on the node is for traps that bite someone building an app on top, which is a different audience.

## Working with Jouni

Enterprise architect, ex-CTO, thirty years in. Do not explain fundamentals and do not perform confidence; he sees through it. No effort or time estimates. Prompts and code comments stay English.

**Answer first, then the evidence.** The failure this prevents happens most turns otherwise: work gets reported in the order it was done rather than the order he decides in, so the answer to what he asked sits under six paragraphs of narration and he has to classify each sentence as finding, fix, leftover or suggestion. That classification is the job, and it does not belong to him.

- A status question ("is it done", "what needs doing") is answered in the **first sentence**, in one of three shapes: **done, nothing needs you** · **done, except X, which needs your decision** · **not done, it is at X**. Everything after that is evidence for the first sentence.
- **Do not hedge finished work.** Done is done. A related thing you noticed is not an exception to "done"; it is a separate note, and it earns a mention only if it needs a decision. "All done except…" about something that needs nothing turns a non-task into a debt he now has to carry.
- **Label the register when a report mixes them.** Found, fixed, left, and suggested are four different things, and a reader should never have to work out which one a sentence is.
- One term, one meaning, per conversation. Two senses of the same word (the node's Platform feedback versus a memory typed `feedback`) makes him check whether you are even discussing the same thing.

**Writing is judged, in chat and in every file.** → skill `aimeat-writing`. The short version, which applies to everything without waiting for the skill:

- **Answer in Finnish when he writes Finnish, and compose it in Finnish.** A translated sentence reads as translated and costs a correction round every time. Write it right the first time; that is cheaper than the iteration it saves.
- **Replies to Jouni use ASD-STE100 Simplified Technical English.** Before you write any direct response to him, ensure it is written in ASD-STE100 Simplified Technical English, do not use techno-babble of any kind, do not physicalize things, always use the simplest turn of phrase, no need for synonymous phrases for variety, and use active voice.
- **In Finnish, the same rule is selkeä kieli (SFS-ISO 24495-1, Kotus).** Not selkokieli, which is for special reader groups. Finnish has no controlled language like STE, so: main point first, one matter per sentence; verbs over nouns ("tarkistan", not "suoritan tarkistuksen"), no -minen chains; name the doer ("sinä hyväksyt"), passive only when the doer does not matter, never "toimesta"; a Finnish word over an anglicism; one word for one thing.
- **Banned outright:** "delve", "crucial", "pivotal", "tapestry", "foundational", "robust", "seamless", "landscape", "realm", "Here's the thing", "Hope this helps", "After careful consideration", "I wanted to provide a quick update", and "Most people…" openers.
- **Banned patterns**, which matter more than the word list because they survive a find-and-replace: negative parallelism ("it's not X, it's Y"), the grand pronouncement ("This isn't a budget. It's a statement of intent."), and adverb abuse ("quietly runs", "simply add", "essentially the same").
- **Speak human.** A term from the system's own vocabulary carries its meaning in the same sentence, or it does not appear. "agentAutonomy is L3 and meta.decisions is alwaysGate" says nothing; "the agent may write on its own, but decisions and gaps wait for your approval" says the same thing and can be acted on. An identifier or a config key is evidence, and the sentence still has to work without it.
- No em-dashes. No decorative emoji (✓ ✗ → ↩ only).

- **Ask before:** spending money or changing AI settings, importing data automatically, touching infrastructure (wsl/docker are off limits), building something not yet agreed.
- **A locked plan gets finished**, not sliced, and not followed by "next we could".
- **Name the exact scope of a deletion** before deleting.
- **Evidence before assertions.** Verify with real content, not fixtures. Clean up test data fully. A test must fail first. The pass-criterion discipline is its own section below.
- **Test at the size production actually has.** Ask of every change what grows with the user's data, and get the real number from prod rather than guessing. A green test proved the feature and not the failure: listing every app origin in a CSP header passed with 2 apps and took down every app subdomain at 76, because the header outgrew nginx's 4 kB buffer.
- **Never claim anything about prod without probing it.** `curl /v1/build` gives the restart time (`parseInt(build,36)`), and grepping a live asset for a marker from the change is the definitive proof. Saying "you are on old code" when the developer had deployed cost trust twice.
- **Iterate locally, migrate once.** Build against the local dev server and a throwaway target, then take one migration to prod. Seven half-finished deploys onto a live paid extension is the failure this prevents.
- **Reuse what exists** rather than inventing a parallel list, surface or page type. A feature's data is a memory record under a key prefix plus a prompt that reads it; a new MCP tool, route or table needs a reason memory could not cover it.
- **Do not rewrite prompts that work**: additive changes only, and only when asked.

Tooling that has bitten before: the dev server does not watch backend `src/` (restart for a new route) · Playwright MCP needs `--isolated` and cannot use `file://` · **any** recursive delete follows a junction, `git worktree remove --force` as much as `rm -rf`, so never link a worktree into the shared `node_modules` (recovery: `pnpm install --force`) → `docs/pitfalls.md` §13 · `cd x && python` can fail silently, so check the exit status · backticks vanish inside `python -c`, use Write instead · a curl argument mangles UTF-8 on Windows, use `--data-binary @file` · Python text mode rewrites a whole file to CRLF, which used to land a one-line edit as a whole-file diff; `.gitattributes` normalises on `git add` now, so it cannot reach the repo, but `write_bytes(read_bytes()...)` is still the way to script an edit.

**Finished work goes to `main`, and nobody is asked.** Commit and push, as a merge onto `main`, in the session that did the work. It is not a question: a branch, a pull request or "shall I push this?" is friction on a repo with one developer. **The origin is PUBLIC**, so a work branch pushed there shows half-done work to everyone: push `main` only, and look at the work on your own sandbox. Ruled 2026-09-06, after it had been asked once too often. Two things are still owed before the word "done" is said, and they are the whole of the discipline: `pnpm gate` once on the finished piece, and **CI green on the pushed commit**, checked rather than assumed. Reporting done and then discovering the push was red is the failure that made this look like a process problem when it was a verification problem.

Git: **every session works in its own worktree, and starts or moves into it through Claude Code**: `claude --worktree cc-<owner>-<tag>` from the main checkout, or, in a session already open there (VS Code), ask for the `EnterWorktree` tool with that name. The `WorktreeCreate` hook (`.claude/hooks/worktree-create.sh`) then runs the whole recipe: `.worktrees/<name>` at `origin/main`, its own `cd aimeat && pnpm install`, and `pnpm test:env:init`. The session's working directory becomes the worktree, so it loads that worktree's CLAUDE.md and rules once, and Claude Code refuses its edits and git commands aimed at the main checkout (measured 2026-09-13, about 40 s from nothing to a ready worktree). By hand, the same recipe is `git worktree add .worktrees/<session> origin/main`, then `cd aimeat && pnpm install`, then **`pnpm test:env:init`**: never copy `.env.test.*` in by hand, because the examples ship one port and one Postgres database for everybody and the runner EMPTIES that database between suites, so two sessions testing at once wipe each other rather than interleave; `AIMEAT_E2E_PORT=<the port your claim names> pnpm test:env:init` takes the board's port instead of the derived one); the main checkout is for a person, never for a session, and never for two at once. Measured on 2026-09-05, when three sessions edited it together: hook refusals for each other's half-written files, a commit that had to be made from a fresh worktree anyway, a whole-checkout rebase to fold the copies back, and four rounds of messages to agree who touched which file · never `git add -A` (it sweeps another session's files) · the pre-commit hook reads the worktree, not the index, so an uncommitted fix greens it falsely · no scratch files in the repo root · no `Co-Authored-By` trailer.

**Iterate against your own sandbox, not against a test run.** `pnpm sandbox` stands up a node of your own on its own port (40600 upward, so it collides with neither the dev server on 40050 nor the E2E runner) with its own SQLite file, and in it: three owners with passwords and fresh tokens (the first is the operator, the second is for anything cross-owner, the third is a third-party member), an agent of the first owner, two published apps, a record each, and everything a fresh node seeds itself: the Design Book, the bundled cortexes, the example packages, the built-in skills. Measured 2026-09-05: ten seconds from nothing to all of that, and then it stays up. **A look at whether a change works is a browser reload or one curl against it**, never a restart of the shared dev server and never an E2E suite; on a Design Book change, standing the world up had been taking nine tenths of the clock. `pnpm sandbox` again reuses the node and refreshes the tokens (they last a day), `pnpm sandbox --reset` throws the data away and seeds again, `--stop` keeps the data, `--status` says whether it is up. Every credential is printed and written to `aimeat/.sandbox.json` (gitignored, with the private keys). It is not a test: no assertion, no isolation between looks, nothing to clean up. `pnpm gate` is what says whether the work holds.

**Working beside other sessions and other projects.** Up to eight Claude Code sessions, several machines, more than one account and more than one repository develop through one floor, and the coordination lives on aimeat.io, not in chat: organism **AIMEAT CODING CENTRAL** (`da438a5f-609b-41e5-ad9f-8dd2cc76cbe1`), read and written through the **Lifecycle Central** app (lifecycle-central.apps.aimeat.io) and its tools. It holds the **projects** attached to it (this repository is project `aimeat-protocol`), the **shared goals** the projects serve (a goal spans projects and is the filter through which everything below is read: an incident, a ruling or a wish tagged with a goal is seen by every project under it), the **watches** (goals that never finish: an agent, a cadence, what it watches; a red round opens an incident), the wish bucket, **claims** (who holds which area and which E2E port, in which project), **incidents** (what is broken on main right now), **decisions** (the rulings) and **handoffs** (what a session left unfinished). The ritual is skill `aimeat-dev-session` on the node (`aimeat_skill_get`): name the session and the project (`AIMEAT_SESSION=cc-<owner>-<tag>` and `AIMEAT_PROJECT=aimeat-protocol`, stamped on every commit as `Session:` and `Project:` trailers by the hook), read the board with your project (`board_read { project }` also returns what the goals your project serves have broken, ruled and asked for, and which sessions of other projects work under them), claim an area and the E2E port you will use (any free port from 40251 up; the board shows the ones in use, there is no pool and no cap; a claim without a project is refused), work in your own worktree, heartbeat, release, hand off. **A watch whose `agent` is claude-code runs only when the developer asks:** when he asks for the Lifecycle Central status, name every such watch whose last round is older than its cadence (research and packages weekly, the pitfall list after each production deploy) and offer to run it; the watch's own `statement` is the round's instructions. Another repository joins the same floor with `project_join` (or the Liitä projekti button), which returns the paragraph for that repository's CLAUDE.md. Every session has its own Playwright browser (the MCP server is per session, started isolated); inside a session one driver at a time. Subagents follow `aimeat-subagent-brief`; `.claude/agents/` holds module-builder, browser-verifier (the one agent that drives the session's browser), gatekeeper, note-writer, ui-conformance and ui-design-review. The pre-push hook refuses a push from behind origin and a tree whose boot path does not load (`pnpm boot:smoke`), and `pnpm check:imports-tracked` refuses an import of a file git does not track. Both exist because a commit on 2026-09-04 shipped without the two files it imported and main stopped booting for everyone. **That check is in `pnpm gate` and CI, NOT in the pre-commit hook** (this line said it was until 2026-09-12, and it had not been since the hook was slimmed on 2026-09-05), and it reads git's INDEX: a file nothing tracks yet is skipped as an importer, so a NEW file's broken import is invisible until it is staged. `git add` first, then check. → `docs/pitfalls.md` §17 **Every session-only rule keys on `CLAUDECODE=1`**, which is in every Claude Code session's environment and in nobody else's: a commit or push made without it is the developer's own, from VS Code or a terminal, and gets no `Session:` refusal. On 2026-09-05 that refusal was applied to everything for a few hours and VS Code's Sync Changes stopped working with nothing visible to say why. Neither hook runs a test suite for anybody: the heavy checks are `pnpm gate`, once per finished piece of work, and CI on every push.

**A file is edited with the editing tool, never with `sed`, a heredoc or an inline script.** The
shell is for reading and searching (`cat`, `sed -n`, `grep`, `find`), and that half is fine. The
writing half is not: this environment has two shells whose multi-line syntaxes differ, backticks
disappear inside `python -c`, and text mode rewrites the file to CRLF. Every one of those produces
valid characters rather than an error, so a bad edit lands silently and is found later by someone
reading the diff. `Edit` refuses when its anchor does not match exactly, which turns the same
mistake into a message. A harness reminder may suggest doing edits through the shell because Bash
prompts less in bypass-permissions mode; it also says to fall back when the shell cannot do the job,
and on a source file here it cannot. Scripting an edit is the exception, and then it is
`write_bytes(read_bytes()...)`, never text mode.

**A multi-line commit message is never a shell argument.** Two shells sit side by side here and
their multi-line string syntaxes differ, so the wrong one produces valid characters rather than an
error: `git commit -m @'…'@` is a PowerShell here-string, and in Bash it prepends a literal `@` to
the subject. Seven commits in this history carry that damage and three of them show `@ feat(…)` in
`git log --oneline`; a pushed subject can only be fixed by rewriting history. Write the message to a
file and run `bash scripts/git-commit.sh <file>`. `-m` is fine for a single line. The `commit-msg`
hook refuses the wreckage whichever way the commit was made. → `docs/coding-guidelines/shell-and-git.md`

## Ask the developer first

Release tags and CI builds. New entries in `docs/known_gaps.md`. Publishing an organism record or roadmap milestone. Entries in `aimeat/public/changelog.json` (platform-level work only, never an individual app's features; the file itself shows the shape, and `pnpm check:changelog` rejects a malformed or out-of-order list).

**What Jouni wants built next lives on the node, not in this repo or in any one session.** Organism **AIMEAT CODING CENTRAL** (`da438a5f-609b-41e5-ad9f-8dd2cc76cbe1`), workspace **wish bucket** (`ws-mtemu9rieuk`): one `wish` record per thing he asked for, in his words, and a `brief` document when it needs more than a paragraph. A wish is born in a **shared goal** and gets its **project** when someone takes it to build; until then it sits in the goal's "no project yet" column on the Tavoitteet door of Lifecycle Central, which is the question "who builds?". When he says "teeppä X" and X is not on the screen, read the bucket before building; when he asks for something new, write it there first (the `wish_add` tool, with `goals`) and give him the id. Skill `aimeat-wish-bucket` (on the node, `aimeat_skill_get`) carries the flows and the record's fields; the workspace readme is the process.

**The bucket is a queue, and keeping it true is part of the work.** Close the wish in the session that shipped it, BEFORE telling him it is done: a wish left at `building` after its work is live makes the list lie, and on 2026-09-05 the AI Music Charts wish still read `building` although the app had shipped sixteen versions, so the bucket could not say what remained. Then take it out: a `done` wish leaves the bucket once its lasting knowledge has a home (the app's skill, App or Platform Development Notes, `docs/pitfalls.md`, or a rule in this file), because the wish is the request and the notes are the record. Every session that opens the bucket owes it two minutes: close what plainly shipped, and park what nobody will pick up, with the reason and the date. A bucket that only grows stops being read, and then he has to ask twice for everything.

**Searching the old notes.** Until 2026-08-09 this project kept everything it learned in local Claude Code memory. That store is empty now and its contents moved to the node, which is where to look first: **Platform Development Notes** (`ws-mslunjvcgxj`, 166 documents) and **App Development Notes** (`ws-mslr8u99kzk`, 44). Both are readable with `aimeat_workspace_read` and searchable with the librarian, and every session sees the same copy.

A local mirror sits in `docs/internal/memory-archive/` (gitignored) for a fast grep when you already know the term: `platform-notes/` (166), `app-memories/` (44), `folded/` (50, now rules in this file or a skill), `deleted/` (9, dead), `originals/` (270, the pre-condensation snapshot with the fullest text). It is a copy, so the node wins on any difference.

```bash
grep -ril "<term>" docs/internal/memory-archive/platform-notes    # which notes mention it
grep -i -C3 "<term>" docs/internal/memory-archive/platform-notes/<file>.md
```

**Read `memory-archive/README.md` before trusting a hit.** These are point-in-time observations, some months old, and a large part of the archive describes things that no longer exist: 43 notes discuss MongoDB and 19 discuss Prisma, both **removed entirely on 2026-07-16**, and notes about the Generator, Foundry, SSR and four-backend migrations are history in the same way. A hit is a lead that someone met this symptom before, not a fact and never an instruction. Verify against current code, and if what you find is still true and still matters, it belongs in this file, a skill, or the node, not back in memory.

**Test accounts, logins and the browser-verification recipe: `docs/internal/TESTING.md`** (gitignored, so it and `docs/internal/memory-archive/` exist only in the main checkout on the developer's main machine, never in a worktree. Without it, use the sandbox accounts in `aimeat/.sandbox.json` and ask the developer for anything on production). Four accounts: the prod owner, a second prod identity for anything cross-owner, a third-party prod member for a paying service's member path, and the local dev owner.

## Gates

- **E2E on both backends.** `postgres-kysely` is the production backend and `sqlite` is the fast local one; both must pass. Run the suites your change can plausibly affect: targeted runs are what you owe, and they are enough for Jouni to do acceptance testing. **The full sweep (`pnpm test:e2e:postgres-kysely` + `pnpm test:e2e:sqlite`) is NEVER started on your own initiative:** it takes about two hours, and it runs only after Jouni has looked at the work and approved it, or when he asks for it. If he says to go with lighter testing only, that is the instruction. A failure in an area you touched means not done. A failure elsewhere: confirm it pre-exists on `main`, mention it, leave it. New features ship with E2E tests (happy path plus a failure mode). Never report done without having run them. → `docs/coding-guidelines/testing-requirements.md`
- **Before writing any language but English, read the language context** (`references/language-context.md` in skill `aimeat-writing`): what each thing in this product is, in one sentence, and the word already settled on for it in all three languages. A word gets picked twice for one concept otherwise, six weeks apart, by writers who cannot see each other, and that is where about a fifth of the jargon backlog came from. When you name something the table does not cover, add the row in the same change. **It is for the writer and never for the cold reader**, whose whole value is having no context. Measured 2026-09-12 on a 45-key screen, two writers with the same brief and only one holding the file: it prevented three terminology defects (`tunnus` for a machine identifier, a colloquial register clash, an invented technical compound) and moved nothing else, because half of what a cold reader finds is information the source string never had.
- **Shared code has one home per kind.** Served browser libs, cortex libs, extensions and library packs each have their own authoring rules and their own build. → skill `aimeat-library-authoring`
- **Subagents run on Opus.** `model: "opus"` or omit it.
- **Never `MEAT` as a standalone prefix.** `AimeatConfig`, `AIMEAT_*`, `aimeat-local-001-dev`.

## Rules that load by path

The rules that apply only to certain code live in `.claude/rules/`, and each loads when Claude reads a file its `paths` name. A session that never opens a route does not carry the route rules, and neither do its subagents. A citation such as "CLAUDE.md, Backend" in a source comment means the rule file in this table.

| Former section or Gates bullet | Rule file | Loads when a file is read under |
|---|---|---|
| Backend; openapi in the same commit; dependency-cruiser | `backend.md` | `aimeat/src/`, `openapi.yaml` |
| Security; the six audit rules; the owner sees their agents' data; `resolveIdentity` | `security.md` | `aimeat/src/` routes, auth, services, storage, mcp, middleware, utils, commerce, server-bootstrap, cli |
| A tool has three surfaces | `tool-surfaces.md` | `aimeat/src/mcp/`, `aimeat/src/cli/`, `python/aimeat-crewai/` |
| Extension, cortex and app namespaces; a memory value is a record | `namespaces-memory.md` | `aimeat/src/` services, routes, storage, mcp, data; sdk-libs; cortex-bundled; `packages/` |
| Frontend; browser verification | `frontend.md` | `aimeat/public/`, `aimeat/src/static/` |
| Guard tier; claims from a full sweep; which of three a green test was | `testing.md` | `aimeat/test/`, the test-env and gate scripts, `.github/workflows/` |
| Pre-commit hook and `pnpm gate`; `pnpm debt`; ratchet seeding; protocol versions | `gates-ratchets.md` | `.githooks/`, `aimeat/scripts/`, `security/`, workflows, `CLAUDE.md`, `.claude/rules/` |
| Licensing | `licensing.md` | `aimeat/public/lib/`, `package.json`, the licence and notices scripts |
| Locales | `locales.md` | `aimeat/locales/`, `aimeat/src/i18n.ts` |
| File headers; the 800-line limit | `code-files.md` | any `.ts`, `.js`, `.mjs` or `.css` under `aimeat/` |
| Changing a skill: measure it with its eval suite (`pnpm eval:skill`) | `skills.md` | `.claude/skills/`, `.claude/evals/` |
| Where a new feature is recorded: fourteen places, one list | `feature-documentation.md` | `aimeat/src/`, `aimeat/public/` |

A new rule goes into this file only when it holds in every session, whatever the session touches. Everything else goes into the rule file for its paths. `pnpm check:instructions` refuses a `paths` pattern that matches no tracked file, and a root file grown past its ceiling.

## Accepting a result

Name the pass-criterion before accepting a checkpoint, then verify against that criterion rather than overall impression. Alignment is proven with an asymmetric anchor element, size with a known reference dimension, behaviour with the real interaction. If you cannot state a criterion, the requirement is unclear: resolve it or ask before iterating, because iterating on a guessed target produces confident wrong fixes. **A source named in the request (a URL, file or spec) is the requirement: open it before implementing.** A verdict reached on weak evidence stays suspect until re-verified.

**Quote Jouni's words, never paraphrase; ask when they, or two rules, read two ways or leave no room for the goal.** A UI step is one of two kinds, never mixed: a **move** (code, names and CSS change place) passes only with no visible difference from the old code on the same data; a **unification** (one look for one kind of thing) takes the look Jouni chose in aimeat-design-lab, and nothing else changes. The builder never grades a difference. Visual work stays off `main` until he saw it. → `docs/pitfalls.md` §94

## Identity: GHII / GAII / GEAI

Three distinct principal types. Full reference: `docs/coding-guidelines/identity-model.md`.

| Identity | Format | What it is |
|----------|--------|------------|
| **GHII** | `alice@node-id` | Human user. Owns everything: morsel balance, profile, trust. |
| **GAII** | `claude#alice@node-id` | AI agent. Scoped permissions, own trust score. |
| **GEAI** | `eco:drum-news#alice@node-id` | Ecosystem app. Onboarded hello→approve→token with TOFU key pinning plus a scope and data-area allowlist; writes into its own `eco:` namespace; consented like an agent. → `docs/building-an-aimeat-compatible-ecosystem-app.md` |

A bare owner name (`alice`) is the account layer: `req.auth!.sub` for owner JWTs, `req.auth!.owner` for all principals. Internal hosted apps are identity-bearing too, via scoped app grants that resolve `role:'app'` to the owner but fence to approved scopes.

Morsels: one balance, on `GHIIRecord.morselBalance`. **A morsel is a pacer, not a currency and not a credit.** It paces what agents may push into the store, so that what lands is refined and useful rather than dumped, and a large balance is a signal that this person has contributed something worth having. It accrues on its own, including while the owner is idle, and using it is not compulsory. Money is a separate matter with its own rails (Stripe, x402, ACP, UCP); morsels sit beside them and buy nothing. Agent and ecosystem balances are always 0, and `debit`/`credit` resolve any principal to the owner GHII, because the pace belongs to the human in whose name the agent acts.

Agents are never created implicitly. Registration creates the owner and GHII only; agents connect later via device authorization (RFC 8628), where the owner approves each one and picks scopes.

## Commands

From the project root; the root `package.json` proxies to `aimeat/`.

```bash
pnpm test:e2e:postgres-kysely    # E2E, production backend
pnpm test:e2e:sqlite             # E2E, fast local backend
pnpm check:importmap             # spa.html importmap vs absolute imports
pnpm check:locales --list        # how much of en.json each language carries
pnpm debt                        # every ratcheted backlog, and the last date it fell
pnpm locale:extract es --prefix profile.agents.   # the next slice to translate
pnpm locale:merge es locales/.todo-es.json        # …and back in, validated
pnpm start -- --db postgres-kysely --db-url postgresql://localhost:5432/aimeat
pnpm start -- --db sqlite --db-path ./data/aimeat.db
```

A single suite during iteration (relative paths, so `cd` first):

```bash
cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-onboarding
```

Memory-backend test commands are deprecated. There is no Prisma and no MongoDB in this codebase; do not re-add either.

## MCP file transfer

File-accepting MCP tools (`aimeat_app_publish`, `aimeat_storage_upload`, `aimeat_extension_install`, `aimeat_cortex_install`) support presigned upload: omit the content param, get back an `upload_url`, then PUT the file.

```bash
curl -s -X PUT "<upload_url>" -H "Content-Type: <ct>" --data-binary @file
```

**Use presigned for anything over ~1 KB.** Never `Read` or `cat` a base64 file into context to inline it: a 60 KB single-line base64 bills roughly 2.5 tokens per character. `aimeat_app_draft_save` is inline-only, so publish large apps live via `aimeat_app_publish` instead of feeding a draft. → `docs/coding-guidelines/mcp-uploads.md`

## Where things are

`docs/pitfalls.md` is the catalogue of traps we have actually hit, organised by kind of problem. Read it when something breaks in a way that feels like it should work, and add an entry when a bug turns out to be a repeatable trap.

| Guide | Purpose |
|-------|---------|
| [Shell and Git](docs/coding-guidelines/shell-and-git.md) | Two shells, one quoting trap; committing a multi-line message safely |
| [Testing Requirements](docs/coding-guidelines/testing-requirements.md) | E2E rules, multi-backend testing, writing tests |
| [Security DNA](docs/coding-guidelines/security-development-dna.md) | Trust model, ten invariants, per-change checklist |
| [Security](docs/coding-guidelines/security.md) | Auth, validation, XSS, rate limiting, GDPR |
| [Identity Model](docs/coding-guidelines/identity-model.md) | GHII/GAII reference, aggregation, morsel pacing |
| [Storage Sync](docs/coding-guidelines/storage-sync.md) | Adding fields and tables across both providers |
| [Architecture](docs/coding-guidelines/architecture.md) | System design, storage layer, SSR-removal history |
| [Code Style](docs/coding-guidelines/code-style.md) | TS/JS conventions, route patterns, i18n |
| [Prompt Writing](docs/coding-guidelines/prompt-writing.md) | Positive framing; applies to every prompt string |
| [File Headers](docs/coding-guidelines/file-headers.md) | Header format, version history |
| [Dependency Management](docs/coding-guidelines/dependency-management.md) | Licenses (GPL/AGPL need approval), audits, justification |
| [Memory Contracts](docs/coding-guidelines/memory-contracts.md) | Self-describing memory records; prefer extending memory over new tables |
| [Environment Configs](docs/coding-guidelines/environment-configs.md) | Node type configs (full, personal, relay, mirror) |
| [Init Wizard](docs/coding-guidelines/init-wizard.md) | `aimeat init` maintenance checklist |
| [MCP Uploads](docs/coding-guidelines/mcp-uploads.md) | Presigned upload URLs, token TTL, size caps |
| [Frontend Guide](docs/frontend-development-guide.md) | Preact + HTM SPA, cache-busting, SSE, admin conventions |
| [Skills Registry](docs/skills-registry.md) | SKILL.md packs, scopes, semver pins, app-bound skills |
| [App Developer AI Guide](docs/app-developer-ai-guide.md) | Apps using the user's OpenRouter key via `AIMEAT.ai.complete()` |
| [Building an Agent](docs/building-an-aimeat-compatible-agent.md) | Offer descriptor, pricing, workflow signals |
| [Building an Ecosystem App](docs/building-an-aimeat-compatible-ecosystem-app.md) | GEAI, hello→approve→token flow |
| [Connecting an Outside Account](docs/connecting-an-outside-account.md) | Gmail and Outlook read/send pairs, the Google alias, bring-your-own app, the AI-disclosure header |
| [Organisation Node Sign-In](docs/organisation-node-sign-in.md) | Entra tenant allowlist + registration mode: one node for your company and the partners you approve |
| [Getting Started](docs/coding-guidelines/getting-started.md) | Install, setup, dev workflow |
| [Known Gaps](docs/known_gaps.md) | Deferred technical gaps (developer-approved entries only) |

Copy-pasteable agent connect instructions live in `public/views/profile/agents/connect-prompts.js` (`buildAgentPrompt()`, `PLATFORMS`). Machine-readable discovery is `src/routes/bootstrap.ts` at `GET /`; managed system prompts are in the DB, served by `src/routes/prompts.ts` at `/v1/prompts/:name`.

Project skills, loaded when the task calls for them: `aimeat-writing`, `aimeat-design-language` (the faces, colours and shapes, and the token map that says how far a change reaches; the same skill is published on the node as `node:aimeat-design-language` so agents find it with `aimeat_skill_list`), `aimeat-app-building`, `aimeat-library-authoring`, `aimeat-frontend-verify`, `aimeat-organism-records`, `aimeat-imagery`, `aimeat-video`, `aimeat-pages-links` (how to link straight to a document or record in Pages, and when to hand out the public viewer link instead; read it before giving anyone a link to a workspace document).
