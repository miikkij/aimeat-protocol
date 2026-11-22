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

- **The spec.** `openapi.yaml` is the canonical API contract. `docs/AIMEAT-Core-2026-11.md` is the Core (normative since node 4.0.0), `docs/AIMEAT-Platform-reference.md` the platform on top; `docs/AIMEAT-RFC-v4.0-*.md` are superseded history. v4.0 reframed the economy as meters, not currencies, and deprecated micro-memory, OTK/Tier 0.5 and the Ed25519 owner-key login (the first two were deleted on 2026-08-23). **Boards were deprecated and reinstated on 2026-08-30**, so they are current: they have a Boards page, a front-page block and `AIMEAT.social`.
- **The node** in `aimeat/`: Node 24, TypeScript, Express 5, port 40050, pnpm. Frontend is a Preact + HTM SPA with no build step. There is no Prisma and no MongoDB (both removed on 2026-07-16); do not re-add either.
- **`python/aimeat-crewai/`**, a pip-installable CrewAI integration. Part of this repo, with its own version line. When agent-facing capabilities change (offers, workflow signals, onboarding, MCP surface), keep it in sync. The node schema wins on any mismatch.

**Prompt-driven workflow** is the road in for everyone MCP cannot reach, and it ranks under the MCP path above rather than beside it. Some tools connect over MCP (Claude, Claude Code, Codex, Cursor, VS Code); others cannot (a consumer Gemini app outside the United States, Copilot without Copilot Studio, ChatGPT without a paid Developer mode), and for those the app composes a ready-made prompt, the user runs it in their own chat and brings the result back, with earlier results feeding later prompts. It is free, AI-agnostic, and the user sees everything before it is submitted. When adding to such a flow, the work is in the prompt text, not in UI buttons or backend logic.

## This repository is public

**Nothing in it names an organisation node or the company behind one**: not its address or node id, its members, its apps, organisms, customers or projects, a data map copied from it, or the state of its compliance register. A fix found on such a node is written in general words in code, tests and commit messages ("an organisation node", "an app that keeps colleagues' ratings"); the real case goes to a Platform Development Notes document, which the comment may point to. Fixtures use invented names (alice, bob, carol). The `commit-msg` and `pre-push` hooks refuse a term from that node's own lists (`node aimeat/scripts/check-private-terms.mjs`; the list sits in git's common directory, never in the tree, and a session without it is refused until it is built), and `pre-push` refuses any commit of a rewritten history (`aimeat/security/rewritten-history.txt`). A history rewrite is announced on Lifecycle Central before its push, and its root joins that file in the same change.

## Two ways of working, and where each one's knowledge lives

**Platform work** is this repo: the node core and the libs it serves. **Application work** builds *on* the platform: apps live in `aimeat-apps/` and are published to the node. An app may add its own libs, extensions or cortex packs; it does not edit core.

Know which one you are doing, because the knowledge sits in different places and mixing them wastes a session:

- **Platform work** reads `docs/pitfalls.md` (traps by symptom), `docs/known_gaps.md` (deferred, developer-approved only) and `docs/coding-guidelines/` (its `README.md` lists every guide), plus the **Platform Development Notes** workspace in the dev organism (`fbb51de5-…` / `ws-mslunjvcgxj`) for how a capability was actually built. Design specs and plans live in the **Development** workspace (`ws-mq664uyfz21`); the notes say what shipped, what broke and what is still open.
- **Application work** reads the node, which is shared by every session and is the source of truth: `aimeat_appdev_overview` for what already exists, `aimeat_skill_list` + `aimeat_skill_get` for a named app's operating guide, the **App Development Notes** workspace in the dev organism (`fbb51de5-…` / `ws-mslr8u99kzk`, one document per app) for how it was built, and `aimeat_appdev_pitfall_list` for app-building traps. Start there, per the `aimeat-app-building` skill.

Nothing in this repo describes an individual application, and nothing should. A durable lesson about one has three possible homes, and they are not interchangeable:

| What you learned | Where it goes |
|---|---|
| How to **use or operate** the app | its own skill: public, bound to the app with `metadata.binding` |
| How it was **built**: locked decisions, prod ids, traps hit, open questions | a document in **App Development Notes** (developer-facing, not public) |
| A trap that would bite **anyone building an app** here | the appdev KB, via `aimeat_appdev_pitfall_report` |

Development notes never go in a skill: skills are published and app-bound, written for whoever uses the app. They also never go in a repo file or a local memory, where only this repo or this session can see them.

**Platform knowledge splits the same way.** A rule belongs in this file, in a path rule under `.claude/rules/`, or in a skill. A repeatable trap in platform code belongs in `docs/pitfalls.md`: add nothing by default, only a trap that can recur and no gate or comment can prevent (its header has the rule). What a capability's build actually cost, and what it left open, belongs in a **Platform Development Notes** document. The appdev KB on the node is for traps that bite someone building an app on top, which is a different audience.

**Old notes.** What this project learned before 2026-08-09 is on the node in those two Development Notes workspaces, readable with `aimeat_workspace_read` and searchable with the librarian; look there first. A local mirror sits in the main checkout's `docs/internal/memory-archive/`; read its `README.md` before trusting a hit, because much of it describes code that no longer exists. A hit is a lead, never an instruction: verify it against current code.

## Working with Jouni

Enterprise architect, ex-CTO, thirty years in. Do not explain fundamentals and do not perform confidence; he sees through it. No effort or time estimates. Prompts and code comments stay English.

**Answer first, then the evidence.** The failure this prevents happens most turns otherwise: work gets reported in the order it was done rather than the order he decides in, so the answer to what he asked sits under six paragraphs of narration and he has to classify each sentence as finding, fix, leftover or suggestion. That classification is the job, and it does not belong to him.

- A status question ("is it done", "what needs doing") is answered in the **first sentence**, in one of three shapes: **done, nothing needs you** · **done, except X, which needs your decision** · **not done, it is at X**. Everything after that is evidence for the first sentence.
- **Do not hedge finished work.** Done is done. A related thing you noticed is not an exception to "done"; it is a separate note, and it earns a mention only if it needs a decision. "All done except…" about something that needs nothing turns a non-task into a debt he now has to carry. The rest of the same defect is not a related thing; it is the work.
- **Label the register when a report mixes them.** Found, fixed, left, and suggested are four different things, and a reader should never have to work out which one a sentence is.
- One term, one meaning, per conversation. Two senses of the same word (the node's Platform feedback versus a memory typed `feedback`) makes him check whether you are even discussing the same thing.
- **Every place you mention comes with its URL**: production, or sandbox plus the account to sign in with and what to press. "On the Packages page" without a link makes him ask (Jouni, 2026-10-04).

**Writing is judged, in chat and in every file.** → skill `aimeat-writing`. The short version, which applies to everything without waiting for the skill:

- **Answer in Finnish when he writes Finnish, and compose it in Finnish.** A translated sentence reads as translated and costs a correction round every time. Write it right the first time; that is cheaper than the iteration it saves.
- **Replies to Jouni use ASD-STE100 Simplified Technical English.** Before you write any direct response to him, ensure it is written in ASD-STE100 Simplified Technical English, do not use techno-babble of any kind, do not physicalize things, always use the simplest turn of phrase, no need for synonymous phrases for variety, and use active voice.
- **In Finnish, the same rule is selkeä kieli (SFS-ISO 24495-1, Kotus).** Not selkokieli, which is for special reader groups. Finnish has no controlled language like STE, so: main point first, one matter per sentence; verbs over nouns ("tarkistan", not "suoritan tarkistuksen"), no -minen chains; name the doer ("sinä hyväksyt"), passive only when the doer does not matter, never "toimesta"; a Finnish word over an anglicism; one word for one thing.
- **Banned outright:** "delve", "crucial", "pivotal", "tapestry", "foundational", "robust", "seamless", "landscape", "realm", "Here's the thing", "Hope this helps", "After careful consideration", "I wanted to provide a quick update", and "Most people…" openers.
- **Banned patterns**, which matter more than the word list because they survive a find-and-replace: negative parallelism ("it's not X, it's Y"), the grand pronouncement ("This isn't a budget. It's a statement of intent."), and adverb abuse ("quietly runs", "simply add", "essentially the same").
- **Speak human.** A term from the system's own vocabulary carries its meaning in the same sentence, or it does not appear. "agentAutonomy is L3 and meta.decisions is alwaysGate" says nothing; "the agent may write on its own, but decisions and gaps wait for your approval" says the same thing and can be acted on. An identifier or a config key is evidence, and the sentence still has to work without it.
- **Before writing any language but English, read the language context** (`references/language-context.md` in skill `aimeat-writing`) → `.claude/rules/locales.md`.
- No em-dashes. No decorative emoji (✓ ✗ → ↩ only).

- **Ask before:** spending money or changing AI settings, importing data automatically, touching infrastructure (wsl/docker are off limits), building something not yet agreed. Not asked: your sandbox gets the developer's OpenRouter test key and model without a question; how, in `docs/internal/TESTING.md`, Model keys (Jouni, 2026-10-25: "I gave the key exactly for this").
- **A locked plan gets finished**, not sliced, and not followed by "next we could".
- **A fix covers the whole defect, not the reported symptom.** When a delete leaves data behind, check every table and store that carries the id, and remove each one or name the duty that keeps it (law, bookkeeping). "It needs its own change" is no reason, and "left" in a report is for what Jouni decided to leave. When the rest is too risky to do unasked, ask before you report.
- **Name the exact scope of a deletion** before deleting.
- **Evidence before assertions.** Verify with real content, not fixtures. Clean up test data fully. A test must fail first. The pass-criterion discipline is its own section below.
- **Test at the size production actually has.** Ask of every change what grows with the user's data, and get the real number from prod rather than guessing. A green test proved the feature and not the failure: listing every app origin in a CSP header passed with 2 apps and took down every app subdomain at 76, because the header outgrew nginx's 4 kB buffer.
- **Never claim anything about prod without probing it.** `curl /v1/build` gives the `commit` that runs and `started_at`; `git merge-base --is-ancestor <fix> <commit>` says whether a fix is in it. Saying "you are on old code" when the developer had deployed cost trust twice.
- **Reach production through a session on its server.** Before a deploy or a change there, find that server's Remote Control session in `ListAgents` and work through it; when there is none, ask the developer to attach one or to make the change (Jouni, 2026-10-17).
- **Iterate locally, migrate once.** Build against the local dev server and a throwaway target, then take one migration to prod. Seven half-finished deploys onto a live paid extension is the failure this prevents.
- **Reuse what exists** rather than inventing a parallel list, surface or page type. A feature's data is a memory record under a key prefix plus a prompt that reads it; a new MCP tool, route or table needs a reason memory could not cover it.
- **Live data arrives as an event over the existing SSE stream, never by polling.** → `.claude/rules/frontend.md` (Jouni, 2026-10-18)
- **Do not rewrite prompts that work**: additive changes only, and only when asked.

Tooling that has bitten before: the dev server does not watch backend `src/` (restart for a new route) · Playwright MCP needs `--isolated` and cannot use `file://` · **any** recursive delete follows a junction, `git worktree remove --force` as much as `rm -rf`, so never link a worktree into the shared `node_modules` (recovery: `pnpm install --force`) → `docs/pitfalls.md` §13 · `cd x && python` can fail silently, so check the exit status · backticks vanish inside `python -c`, use Write instead · a curl argument mangles UTF-8 on Windows, use `--data-binary @file` · over ~1 KB, an MCP file tool takes the presigned upload (omit the content, PUT the file to the `upload_url`), and a base64 file is never read into context → `docs/coding-guidelines/mcp-uploads.md`.

## Git, sessions and coordination

**Finished work reaches `main` through `pnpm ready`, and nobody is asked.** Three steps, in this order, in the session that did the work (Jouni, 2026-11-15: an afternoon went to sessions looping in tests and nothing moved):
1. **While developing, run only the suites of the area the change reaches.** No `check:fast`, no `pnpm gate`, no other area's suites.
2. **When the work looks done, `pnpm check:fast` once.** About three minutes: the eight slow checks (CodeQL's field reach among them) run on GitHub in step 3. One run at a time on the machine; a second session's run waits for it. Red: read EVERY red line, fix them all in one go, run it once more. Never fix one line and rerun. **Run it after the last commit**, with `pnpm exec vitest run --changed origin/main` beside it (the unit tests the change reaches), and search the tests for every string the change rewrote; a commit after them means running them again. A red `pnpm ready` costs 35 minutes, these five (2026-11-19: four reds these would have caught).
3. **Then `pnpm ready` from `aimeat/`.** It first runs every check but the CodeQL pass on this machine (about two minutes; red, nothing is pushed). Then it pushes the commits to `ready/<session>`, runs CI (every check) and the full E2E sweep plus the package and Docker builds there on GitHub (about 35 min), and puts them on `main` only when green; red, it prints every red assertion and leaves `main` untouched. A suite red in the sweep runs once more alone: green alone, it is listed as FLAKY, does not stop the merge, and goes on Lifecycle Central as an incident.

**The origin is PUBLIC**: a `ready/` branch carries only work past step 2 and is deleted once merged; push no other branch, and look at work in progress on your own sandbox. `git add` a new file before step 2: `check:imports-tracked` reads git's index. If the session-start hook says CodeQL is missing, `pnpm codeql:install` is first.

Git: **every session works in its own worktree, and starts or moves into it through Claude Code**: `claude --worktree cc-<owner>-<tag>` from the main checkout, or, in a session already open there (VS Code), ask for the `EnterWorktree` tool with that name. The `WorktreeCreate` hook (`.claude/hooks/worktree-create.sh`) then makes `.worktrees/<name>` at `origin/main` with its own install and `pnpm test:env:init`, and the session works inside it; Claude Code refuses its edits and git commands aimed at the main checkout. Outside Claude Code, `pnpm agent:worktree <name>` runs the same recipe. Never copy `.env.test.*` in by hand: the examples ship one port and one Postgres database for everybody and the runner EMPTIES that database between suites, so two sessions testing at once wipe each other. `AIMEAT_E2E_PORT=<the port your claim names> pnpm test:env:init --force` takes the board's port (40251-40499; anything else is refused). The main checkout is for a person, never for a session, and never for two at once · never `git add -A` (it sweeps another session's files) · the pre-commit hook reads the worktree, not the index, so an uncommitted fix greens it falsely · no scratch files in the repo root · no `Co-Authored-By` trailer.

**Iterate against your own sandbox, not against a test run.** `pnpm sandbox` stands up a node of your own on its own port (40600 upward, so it collides with neither the dev server on 40050 nor the E2E runner) with its own SQLite file, and in it: three owners with passwords and fresh tokens (the first is the operator, the second is for anything cross-owner, the third is a third-party member), an agent of the first owner, two published apps, a record each, and everything a fresh node seeds itself: the Design Book, the bundled cortexes, the example packages, the built-in skills. It takes about ten seconds, and then it stays up. **A look at whether a change works is a browser reload or one curl against it**, never a restart of the shared dev server and never an E2E suite. `pnpm sandbox` again reuses the node and refreshes the tokens (they last a day), `pnpm sandbox --reset` throws the data away and seeds again, `--stop` keeps the data, `--status` says whether it is up. Every credential is printed and written to `aimeat/.sandbox.json` (gitignored, with the private keys). It is not a test: no assertion, no isolation between looks, nothing to clean up. `pnpm ready` is what says whether the work holds.

**Working beside other sessions and other projects.** Several sessions, machines, accounts and repositories develop side by side, and the coordination lives on aimeat.io, not in chat: organism **AIMEAT CODING CENTRAL** (`da438a5f-609b-41e5-ad9f-8dd2cc76cbe1`), read and written through the **Lifecycle Central** app (https://lifecycle-central.apps.aimeat.io/) and its tools. It holds the projects (this repository is project `aimeat-protocol`; another repository joins with `project_join`), the shared goals they serve and the watches (goals that never finish; the page calls them monitors, Valvonta), the wish bucket, claims, incidents, decisions and handoffs. A goal spans projects: an incident, a ruling or a wish tagged with it is seen by every project under it. The ritual is skill `aimeat-dev-session` on the node: export `AIMEAT_SESSION=cc-<owner>-<tag>` and `AIMEAT_PROJECT=aimeat-protocol` (the hooks stamp them as `Session:` and `Project:` trailers), read the board with your project (`board_read { project }`), claim an area and the E2E port before the first edit (a free port in 40251-40499 that no active claim names; a claim without a project is refused), heartbeat, release, hand off. **A watch whose `agent` is claude-code runs only when the developer asks:** when he asks for the Lifecycle Central status, name every such watch whose last round is older than its cadence and offer to run it; the watch's own `statement` is the round's instructions. Every session has its own Playwright browser; inside a session one driver at a time. Subagents follow `aimeat-subagent-brief`; `.claude/agents/` holds module-builder, browser-verifier (the one agent that drives the session's browser), gatekeeper, note-writer, ui-conformance and ui-design-review. The hooks hold a commit or push to the session rules when `CLAUDECODE` or `AIMEAT_SESSION` is set; one without either is the developer's own. What each hook refuses: `gates-ratchets.md`.

**A file is edited with the editing tool, never with `sed`, a heredoc or an inline script.** The shell is for reading and searching (`cat`, `sed -n`, `grep`, `find`), and that half is fine. The writing half is not: this environment has two shells whose multi-line syntaxes differ, backticks disappear inside `python -c`, and text mode rewrites the file to CRLF. Every one of those produces valid characters rather than an error, so a bad edit lands silently and is found later by someone reading the diff. `Edit` refuses when its anchor does not match exactly, which turns the same mistake into a message. A harness reminder may suggest doing edits through the shell because Bash prompts less in bypass-permissions mode; it also says to fall back when the shell cannot do the job, and on a source file here it cannot. Scripting an edit is the exception, and then it is `write_bytes(read_bytes()...)`, never text mode.

**A multi-line commit message is never a shell argument.** Two shells sit side by side here and their multi-line string syntaxes differ, so the wrong one produces valid characters rather than an error: `git commit -m @'…'@` is a PowerShell here-string, and in Bash it prepends a literal `@` to the subject, which a pushed history can only lose by a rewrite. Write the message to a file and run `bash scripts/git-commit.sh <file>`. `-m` is fine for a single line. The message uses industry terms (endpoint, route, MCP tool, code path), never metaphors such as door, road or hand; body paragraphs are not hard-wrapped. **A session's message is short: a subject of at most 72 characters and a body of at most 600 that says why the change exists.** It never says who approved or asked for the change and never quotes Jouni; that is on the wish. Test results, how the defect was found and the list of files go to the report and the development notes. The `commit-msg` hook refuses a mangled message, a longer subject or body and an approval line; the terms and the wrapping are yours to keep. → `docs/coding-guidelines/shell-and-git.md`

## Ask the developer first

Release tags and CI builds. When he asks for a release, the full test run its release check needs is part of that request, not a new question: start it with `pnpm nightly:preflight --dispatch`; the tag and the publish stay his. New entries in `docs/known_gaps.md`. Publishing roadmap items or rulings, not dev notes. Changelog entries (when and how to ask: `feature-documentation.md`, row 6).

**What Jouni wants built next lives on the node, not in this repo or in any one session.** Organism **AIMEAT CODING CENTRAL** (`da438a5f-609b-41e5-ad9f-8dd2cc76cbe1`), workspace **wish bucket** (`ws-mtemu9rieuk`): one `wish` record per thing he asked for, in his words, and a `brief` document when it needs more than a paragraph. A wish is born in a **shared goal** and gets its **project** when someone takes it to build; until then it sits in the goal's "no project yet" column on the Tavoitteet page of Lifecycle Central, which is the question "who builds?". When he says "teeppä X" and X is not on the screen, read the bucket before building; when he asks for something new, write it there first (the `wish_add` tool, with `goals`) and give him the id. Skill `user:happydude500001/aimeat-wish-bucket` (`aimeat_skill_get`) carries the flows and the record's fields; the workspace readme is the process.

**The bucket is a queue, and keeping it true is part of the work.** Close the wish in the session that shipped it, BEFORE telling him it is done: a wish left at `building` after its work is live makes the list lie, and the bucket can no longer say what remains. A `done` wish stays in the bucket at `done`, and Lifecycle Central lists it with that status; never delete it. Its lasting knowledge still gets a home (the app's skill, App or Platform Development Notes, `docs/pitfalls.md`, or a rule in this file), because the wish is the request and the notes are the record. Every session that opens the bucket owes it two minutes: close what plainly shipped, and park what nobody will pick up, with the reason and the date. A bucket that only grows stops being read, and then he has to ask twice for everything.

**Test accounts, logins, model keys and the browser-verification recipe: `docs/internal/TESTING.md`** (gitignored, so it and `docs/internal/memory-archive/` exist only in the main checkout on the main machine, never in a worktree. Without it, use the sandbox accounts in `aimeat/.sandbox.json` and ask the developer for anything on production). Four accounts: the prod owner, a second prod identity for anything cross-owner, a third-party prod member for a paying service's member path, and the local dev owner.

**Plans live in the main checkout's `docs/internal/`, never in a worktree's.** The folder is gitignored, so every worktree has its own copy, and that copy is deleted with the worktree; `git status` does not list ignored files, so nothing warns. Code stays in your worktree. A plan, a runbook or evidence goes to `../../docs/internal/` from `.worktrees/<name>/`. Claude Code refuses `Write` and `Edit` on the main checkout from a worktree session and has no setting to exempt a folder, so write the file in your scratchpad and `cp` it there; to change one, `cp` it out, edit it, and `cp` it back. Before you remove a worktree, run `git status --short --ignored docs/`.

## Gates

- **E2E on both backends.** `postgres-kysely` is the production backend and `sqlite` is the fast local one; both must pass. While developing, run the suites your change can plausibly affect and nothing else. **The full sweep runs through `pnpm ready` before `main`** (Git, above), on GitHub in four shards per backend, never on this machine, where the two backends in a row took about two hours. A release's run is `pnpm nightly:preflight --dispatch`. If he says to go with lighter testing only, that is the instruction. A failure in an area you touched means not done. A failure elsewhere: confirm it pre-exists on `main`, mention it, leave it. New features ship with E2E tests (happy path plus a failure mode). Never report done without having run them. → `docs/coding-guidelines/testing-requirements.md`
- **The IT adoption package (`docs/it-adoption/`) stays true to the code**, in the same commit as the change that would make a page false → `feature-documentation.md`, row 15.
- **Shared code has one home per kind.** Served browser libs, cortex libs, extensions and library packs each have their own authoring rules and their own build. → skill `aimeat-library-authoring`
- **Subagents run on Opus.** `model: "opus"` or omit it.
- **Never `MEAT` as a standalone prefix.** `AimeatConfig`, `AIMEAT_*`, `aimeat-local-001-dev`.
- **No live count in this file**: a number of things that grow (documents, boards, notes) is stale within a week. Name the place; `pnpm check:instructions` refuses the count.

## Rules that load by path

The rules that apply only to certain code live in `.claude/rules/`, and each loads when Claude reads a file its `paths` name. A session that never opens a route does not carry the route rules, and neither do its subagents. A citation such as "CLAUDE.md, Backend" in a source comment means the rule file in this table.

| Former section or Gates bullet | Rule file | Loads when a file is read under |
|---|---|---|
| Backend; openapi in the same commit; dependency-cruiser; where an agent finds its way in | `backend.md` | `aimeat/src/`, `openapi.yaml` |
| Security; the six audit rules; the owner sees their agents' data; `resolveIdentity`; the identity detail | `security.md` | `aimeat/src/` routes, auth, services, storage, mcp, middleware, utils, commerce, server-bootstrap, cli |
| A tool has three surfaces | `tool-surfaces.md` | `aimeat/src/mcp/`, `aimeat/src/cli/`, `python/aimeat-crewai/` |
| Extension, cortex and app namespaces; a memory value is a record | `namespaces-memory.md` | `aimeat/src/` services, routes, storage, mcp, data; sdk-libs; cortex-bundled; `packages/` |
| Frontend; browser verification | `frontend.md` | `aimeat/public/`, `aimeat/src/static/` |
| How a page explains itself: the page start, the page's and a setting's question mark, the tooltip, what not to build | `page-guidance.md` | `aimeat/public/views/profile/` and `admin/`, the guidance components, `aimeat/locales/` |
| Guard tier; claims from a full sweep; which of three a green test was | `testing.md` | `aimeat/test/`, the test-env and gate scripts, `.github/workflows/` |
| Pre-commit hook and `pnpm gate`; what each hook refuses; `pnpm debt`; ratchet seeding; protocol versions | `gates-ratchets.md` | `.githooks/`, `aimeat/scripts/`, `security/`, workflows, `CLAUDE.md`, `.claude/rules/` |
| Licensing | `licensing.md` | `aimeat/public/lib/`, `package.json`, the licence and notices scripts |
| Locales; the language context | `locales.md` | `aimeat/locales/`, `aimeat/src/i18n.ts` |
| File headers; the 800-line limit | `code-files.md` | any `.ts`, `.js`, `.mjs` or `.css` under `aimeat/` |
| Changing a skill: measure it with its eval suite (`pnpm eval:skill`) | `skills.md` | `.claude/skills/`, `.claude/evals/` |
| Where a new feature is recorded: fifteen places, one list; the IT adoption package | `feature-documentation.md` | `aimeat/src/`, `aimeat/public/` |

A new rule goes into this file only when it holds in every session, whatever the session touches. Everything else goes into the rule file for its paths. `pnpm check:instructions` refuses a `paths` pattern that matches no tracked file, and a root file grown past its ceiling.

## Accepting a result

Name the pass-criterion before accepting a checkpoint, then verify against that criterion rather than overall impression. Alignment is proven with an asymmetric anchor element, size with a known reference dimension, behaviour with the real interaction. If you cannot state a criterion, the requirement is unclear: resolve it or ask before iterating, because iterating on a guessed target produces confident wrong fixes. **A source named in the request (a URL, file or spec) is the requirement: open it before implementing.** A verdict reached on weak evidence stays suspect until re-verified.

**Quote Jouni's words, never paraphrase; ask when they, or two rules, read two ways or leave no room for the goal.** A UI step is one of two kinds, never mixed: a **move** (code, names and CSS change place) passes only with no visible difference from the old code on the same data; a **unification** (one look for one kind of thing) takes the look Jouni chose in aimeat-design-lab, and nothing else changes. The builder never grades a difference. Visual work stays off `main` until he saw it.

## Identity

Three principal types: a person (GHII, `alice@node-id`), who owns everything and sees and can remove every agent; an AI agent (GAII, `claude#alice@node-id`) with scoped permissions, which may approve another agent of the same owner; and an ecosystem app (GEAI, `eco:drum-news#alice@node-id`), consented like an agent. **A morsel is a pacer, not a currency and not a credit**: it paces what agents may push into the store so that what lands is refined, it buys nothing, and it belongs to the human in whose name an agent acts. The code detail is in `security.md` and `docs/coding-guidelines/identity-model.md`.

## Commands

From the project root; the root `package.json` proxies to `aimeat/`. The full sweep is `pnpm test:e2e:postgres-kysely` and `pnpm test:e2e:sqlite` (see Gates for when). `pnpm check:importmap` holds the `spa.html` importmap to the absolute imports. A single suite during iteration (relative paths, so `cd` first):

```bash
cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-onboarding
```
