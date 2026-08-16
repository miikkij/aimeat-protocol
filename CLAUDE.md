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

- **The spec.** `openapi.yaml` is the canonical API contract. `docs/AIMEAT-RFC-v4.0-Core-full.md` (generic federatable Core) + `docs/AIMEAT-RFC-v4.0-Platform-full.md` (the aimeat.io platform on top of it). v4.0 reframes the economy as meters rather than currencies and deprecates micro-memory, OTK/Tier 0.5, legacy Ed25519 challenge-response and boards. It is a conceptual reframe, not an API break.
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

**Platform knowledge splits the same way.** A rule belongs in this file or a skill. A repeatable trap in platform code belongs in `docs/pitfalls.md`. What a capability's build actually cost, and what it left open, belongs in a **Platform Development Notes** document. The appdev KB on the node is for traps that bite someone building an app on top, which is a different audience.

## Working with Jouni

Enterprise architect, ex-CTO, thirty years in. Do not explain fundamentals and do not perform confidence; he sees through it. No effort or time estimates. Prompts and code comments stay English.

**Answer first, then the evidence.** The failure this prevents happens most turns otherwise: work gets reported in the order it was done rather than the order he decides in, so the answer to what he asked sits under six paragraphs of narration and he has to classify each sentence as finding, fix, leftover or suggestion. That classification is the job, and it does not belong to him.

- A status question ("is it done", "what needs doing") is answered in the **first sentence**, in one of three shapes: **done, nothing needs you** · **done, except X, which needs your decision** · **not done, it is at X**. Everything after that is evidence for the first sentence.
- **Do not hedge finished work.** Done is done. A related thing you noticed is not an exception to "done"; it is a separate note, and it earns a mention only if it needs a decision. "All done except…" about something that needs nothing turns a non-task into a debt he now has to carry.
- **Label the register when a report mixes them.** Found, fixed, left, and suggested are four different things, and a reader should never have to work out which one a sentence is.
- One term, one meaning, per conversation. Two senses of the same word (the node's Platform feedback versus a memory typed `feedback`) makes him check whether you are even discussing the same thing.

**Writing is judged, in chat and in every file.** → skill `aimeat-writing`. The short version, which applies to everything without waiting for the skill:

- **Answer in Finnish when he writes Finnish, and compose it in Finnish.** A translated sentence reads as translated and costs a correction round every time. Write it right the first time; that is cheaper than the iteration it saves.
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

Tooling that has bitten before: the dev server does not watch backend `src/` (restart for a new route) · Playwright MCP needs `--isolated` and cannot use `file://` · `rm -rf` follows a junction · `cd x && python` can fail silently, so check the exit status · backticks vanish inside `python -c`, use Write instead · a curl argument mangles UTF-8 on Windows, use `--data-binary @file` · Python text mode rewrites a whole file to CRLF, which used to land a one-line edit as a whole-file diff — `.gitattributes` normalises on `git add` now, so it cannot reach the repo, but `write_bytes(read_bytes()...)` is still the way to script an edit.

Git: parallel sessions work in a worktree · never `git add -A` (it sweeps another session's files) · the pre-commit hook reads the worktree, not the index, so an uncommitted fix greens it falsely · no scratch files in the repo root · no `Co-Authored-By` trailer.

**A multi-line commit message is never a shell argument.** Two shells sit side by side here and
their multi-line string syntaxes differ, so the wrong one produces valid characters rather than an
error: `git commit -m @'…'@` is a PowerShell here-string, and in Bash it prepends a literal `@` to
the subject. Seven commits in this history carry that damage and three of them show `@ feat(…)` in
`git log --oneline`; a pushed subject can only be fixed by rewriting history. Write the message to a
file and run `bash scripts/git-commit.sh <file>`. `-m` is fine for a single line. The `commit-msg`
hook refuses the wreckage whichever way the commit was made. → `docs/coding-guidelines/shell-and-git.md`

## Ask the developer first

Release tags and CI builds. New entries in `docs/known_gaps.md`. Publishing an organism record or roadmap milestone. Entries in `aimeat/public/changelog.json` (platform-level work only, never an individual app's features; the file itself shows the shape, and `pnpm check:changelog` rejects a malformed or out-of-order list).

**Searching the old notes.** Until 2026-08-09 this project kept everything it learned in local Claude Code memory. That store is empty now and its contents moved to the node, which is where to look first: **Platform Development Notes** (`ws-mslunjvcgxj`, 166 documents) and **App Development Notes** (`ws-mslr8u99kzk`, 44). Both are readable with `aimeat_workspace_read` and searchable with the librarian, and every session sees the same copy.

A local mirror sits in `docs/internal/memory-archive/` (gitignored) for a fast grep when you already know the term: `platform-notes/` (166), `app-memories/` (44), `folded/` (50, now rules in this file or a skill), `deleted/` (9, dead), `originals/` (270, the pre-condensation snapshot with the fullest text). It is a copy, so the node wins on any difference.

```bash
grep -ril "<term>" docs/internal/memory-archive/platform-notes    # which notes mention it
grep -i -C3 "<term>" docs/internal/memory-archive/platform-notes/<file>.md
```

**Read `memory-archive/README.md` before trusting a hit.** These are point-in-time observations, some months old, and a large part of the archive describes things that no longer exist: 43 notes discuss MongoDB and 19 discuss Prisma, both **removed entirely on 2026-07-16**, and notes about the Generator, Foundry, SSR and four-backend migrations are history in the same way. A hit is a lead that someone met this symptom before, not a fact and never an instruction. Verify against current code, and if what you find is still true and still matters, it belongs in this file, a skill, or the node, not back in memory.

**Test accounts, logins and the browser-verification recipe: `docs/internal/TESTING.md`** (gitignored, so the credentials are not in this file). Four accounts: the prod owner, a second prod identity for anything cross-owner, a third-party prod member for a paying service's member path, and the local dev owner.

## Gates

- **The guard tier blocks a merge; the full sweep does not.** `pnpm test:e2e:guards:sqlite` and `pnpm test:e2e:guards:postgres-kysely` run the fourteen suites CI refuses to merge without: 407 assertions, under a minute per backend, every one of them a refusal or an isolation boundary. Run it before pushing anything under `src/routes/`, `src/auth/`, `src/services/` or `src/storage/`. Both E2E steps were `continue-on-error: true` until 2026-08-15, so no red suite had ever stopped anything; the full sweep stays advisory because it takes two hours and §18 makes it occasionally wrong. Fixing a suite so it can join the tier is the intended direction. → `docs/coding-guidelines/testing-requirements.md` Rule 1b
- **E2E on both backends.** `postgres-kysely` is the production backend and `sqlite` is the fast local one; both must pass. Run the suites your change can plausibly affect — targeted runs are what you owe, and they are enough for Jouni to do acceptance testing. **The full sweep (`pnpm test:e2e:postgres-kysely` + `pnpm test:e2e:sqlite`) is NEVER started on your own initiative:** it takes about two hours, and it runs only after Jouni has looked at the work and approved it, or when he asks for it. If he says to go with lighter testing only, that is the instruction. A failure in an area you touched means not done. A failure elsewhere: confirm it pre-exists on `main`, mention it, leave it. New features ship with E2E tests (happy path plus a failure mode). Never report done without having run them. → `docs/coding-guidelines/testing-requirements.md`
- **Finished frontend changes are verified by driving a real browser** through the Playwright MCP server. The `.spec.ts` Playwright suite is unreliable: do not write or run it. → skill `aimeat-frontend-verify`
- **`openapi.yaml` changes in the same commit as the route**, then `pnpm generate:types`.
- **`locales/en.json` is the source of truth for what keys exist**; the other languages (`fi`, `es`) follow through `pnpm locale:extract <tag> --prefix … ` → translate → `pnpm locale:merge <tag> <file>`, gated by `pnpm check:locales`. A key left out of a language falls back to English on its own, which is how a language gets filled in over several passes; a `[TODO:xx]` placeholder and a calque both fail the gate or the reader. A NEW language is that same loop plus two lines: the tag in `LOCALES` (`src/i18n.ts`) and an empty `locales/<tag>.json`. → skill `aimeat-writing`
- **Six rules the August 2026 audit had to be written to discover.** Full text and the evidence for each: `docs/coding-guidelines/security-development-dna.md` invariants 11 to 16.
  - **The owner name is not a principal.** `req.auth!.owner` carries the human's name on app grants, ecosystem apps, agent JWTs and PATs alike, so `owner !== name` refuses a different PERSON and admits everything acting in this person's name. Naming the principal is the check. A change to the account itself goes behind `requireOwnerPrincipal()`, and `requireRole('owner')` is not that test.
  - **A role is granted, never inherited at mint time.** One mint copied the owner's roles onto the agent's token, and two calls then turned a scope-limited agent into an unscoped operator credential. When you add a mint, diff its role list against the other mints.
  - **A gate reads the normalized value, never the raw request.** A webhook allowlist read `body.source.type` while the builder defaulted a missing type to the same value, so omitting the field skipped the gate and built the record it would have refused. Same shape as an origin marker taken from a request header.
  - **Refuse before you write.** Three defects, one shape: bytes written before the name was claimed, a paywall standing down before comparing the coordinate, a response sent before the work it announced. Read the ORDER, not just the presence of the check.
  - **A permission word is enforced on every door or it does not exist.** `organism:write` deletes the tool from an agent's MCP surface and is bypassed on the HTTP route, so an owner was told they controlled something they did not.
  - **Deprecated is not removed.** Deprecating names the flag, the default and the removal version. Three Tier 0.5 write paths were marked deprecated in the RFC, behind no flag, live on every node.
- **Never claim you broke nothing from a full-sweep total.** The E2E runner clears the database between suites and not before the first, and kills the server on a fixed one-second wait, so a slipped restart hands the next suite the previous one's data and produces hundreds of unrelated `403`s. One suite failed 78 times in a sweep and passes 95 of 95 alone. A regression claim needs one suite at a time, freshly deleted database, run on a worktree of the commit you started from as well. Your own gitignored `aimeat/.env` is loaded by the test server, so that worktree does not have it and the comparison flatters the new tree. → `docs/pitfalls.md` §18
- **When a test goes green after your change, say which of three it was**: it asserted the hole you closed, the source was broken, or its setup no longer matched production. Write it in the diff with the finding id. A suite in this repo asserted `agent of owner should inherit owner role` in one line. → `docs/pitfalls.md` §19
- **Security**, on any change to `src/routes/`, `src/auth/`, `src/services/`, `src/storage/`, federation, extensions or an AI path: authorize against `resolveIdentity(req.auth!, …)` and never a client-supplied id; keep server-trusted config and secrets out of principal-writable namespaces; route non-constant outbound HTTP through `safeFetch`; gate every mutation with `requireScope`/`requireRole`; verify federation Ed25519 signatures unconditionally. Anything whose safe value differs between localhost and the public internet goes in `.env.example` with a safe public default and a documented local override. Identity-touching features ship with cross-owner and cross-scope "→403" tests. → `docs/coding-guidelines/security-development-dna.md`
- **Pre-commit hook** (`.githooks/pre-commit`) runs eighteen checks: lint, typecheck, typecheck:frontend, typecheck:sdk, check:importmap, check:profile-tabs, check:no-max-tokens, check:openapi, check:app-catalog, check:changelog, check:sdk, check:mcp-tools, check:mcp-schemas, check:viewport, check:silent-catch, check:ai-disclosure, check:sse-parity, check:copied-logic. `check:mcp-tools` proves the two MCP surfaces expose the same tool NAMES and `check:mcp-schemas` proves they take the same PARAMETERS; the second was written in May 2026, left unwired, and a crew found the defect it had been printing all along. It reads the worktree rather than the index, so an uncommitted fix can green it falsely. CI runs the same set plus the vitest suite. A second hook, `.githooks/commit-msg`, checks the message itself.
- **File headers** (`@file`, `@description`, `@version-history`) on the `.ts`/`.js`/`.css` files you touch. Any existing source file shows the format.
- **No file over 800 lines** (`aimeat/max-file-lines`, an error, so it blocks the commit). When one grows past it, split by **pure extraction**: move a coherent group out to a sibling and change nothing else, so the diff is a move and the tests still prove it. Do not shave comments or version history to squeeze under the limit; that is how a file loses the part explaining why it is the way it is.
- **Shared code has one home per kind.** Served browser libs, cortex libs, extensions and library packs each have their own authoring rules and their own build. → skill `aimeat-library-authoring`
- **Subagents run on Opus.** `model: "opus"` or omit it.
- **Never `MEAT` as a standalone prefix.** `AimeatConfig`, `AIMEAT_*`, `aimeat-local-001-dev`.

## Accepting a result

Name the pass-criterion before accepting a checkpoint, then verify against that criterion rather than overall impression. Alignment is proven with an asymmetric anchor element, size with a known reference dimension, behaviour with the real interaction. If you cannot state a criterion, the requirement is unclear: resolve it or ask before iterating, because iterating on a guessed target produces confident wrong fixes. **A source named in the request (a URL, file or spec) is the requirement: open it before implementing.** A verdict reached on weak evidence stays suspect until re-verified.

## Identity: GHII / GAII / GEAI

Three distinct principal types. Full reference: `docs/coding-guidelines/identity-model.md`.

| Identity | Format | What it is |
|----------|--------|------------|
| **GHII** | `alice@node-id` | Human user. Owns everything: morsel balance, profile, trust. |
| **GAII** | `claude#alice@node-id` | AI agent. Scoped permissions, own trust score. |
| **GEAI** | `eco:drum-news#alice@node-id` | Ecosystem app. Onboarded hello→approve→token with TOFU key pinning plus a scope and data-area allowlist; writes into its own `eco:` namespace; consented like an agent. → `docs/building-an-aimeat-compatible-ecosystem-app.md` |

A bare owner name (`alice`) is the account layer: `req.auth!.sub` for owner JWTs, `req.auth!.owner` for all principals. Internal hosted apps are identity-bearing too, via scoped app grants that resolve `role:'app'` to the owner but fence to approved scopes.

**Every route that stores or retrieves by identity uses `resolveIdentity(req.auth!, config.nodeId)`** from `src/utils/gaii.ts`, never raw `req.auth!.sub`. Owner sessions turn the bare name into a GHII; agent and ecosystem sessions return `sub` as-is. Skip it and owner data lands under bare `alice`, invisible to list, search and update. Compare ownership against the resolved identity.

Morsels: one balance, on `GHIIRecord.morselBalance`. The human pays; agent and ecosystem balances are always 0, and `debit`/`credit`/`transferBalance` resolve any principal to the owner GHII.

Agents are never created implicitly. Registration creates the owner and GHII only; agents connect later via device authorization (RFC 8628), where the owner approves each one and picks scopes.

Key files: `src/utils/gaii.ts`, `src/routes/ghii.ts`, `src/routes/agents.ts`, `src/auth/middleware.ts`, `src/routes/libs.ts`.

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

## Backend

**Protocol only, no server-side rendering.** Routes in `src/routes/` are generic reusable API endpoints. Never `res.send('<html>...')` or build HTML in a handler. The test for a new route is "would a second, different service use this?"; if not, it does not belong, and no per-service backend files. UIs are client-side SPAs or static files. The admin dashboard is the single legacy exception. If data is already available through an existing API, do not wrap it.

**One capability, one implementation, whatever the interface.** An MCP tool declares its own name, description and parameters, because the protocol requires that. It does not do the work itself: it calls the same route or the same service function REST calls, so the scope check, the validation and the provenance happen where they were written once. A tool that reaches `storage.*` directly is a second implementation, and needs a written reason. This rule exists because the same defect has already been fixed three separate times inside one MCP tool (`aimeat_memory_write`: schema locks, write target, provenance), each time in one place while the other surface kept the old behaviour, and the August 2026 audit then found two more of the same kind.

- **Response envelope:** `success()` / `error()` from `src/middleware/envelope.ts`.
  ```typescript
  res.json(success(config.nodeId, { data: 'here' }, [{ description: 'Next', method: 'GET', url: '/v1/endpoint' }]));
  res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Resource not found'));
  ```
- **Auth middleware:** `requireAuth()`, `requireRole('owner'|'agent')`, `requireScope('memory:write')` from `src/auth/middleware.js`. Owner endpoints bypass scopes.
- **Routers** follow `export function myRouter(config, storage): Router`, mounted in `mountRoutes()` (`src/server-bootstrap/routes-loader.ts`).
- **Storage** goes through the `Storage` interface (`src/storage/interface.ts`). Two providers: `postgres-kysely` (pg + Kysely, SQL migrations under `providers/postgres-kysely/migrations/*.sql` run on boot) and `sqlite` (better-sqlite3, also the in-memory default via `:memory:`). **New data types and fields go into both.** → `docs/coding-guidelines/storage-sync.md`
- **ESM imports keep the `.js` extension:** `import { foo } from '../services/foo.js'`.
- **Express 5:** `req.params` returns `string | string[]`, cast with `as string`.

## Frontend

Full architecture, component library, cache-busting and SSE: `docs/frontend-development-guide.md`. Two mechanisms bite often:

- **A new shared JS module** on an absolute path (`/js/services/foo.js`) needs an identity entry in the importmap in `public/spa.html`. `portal.ts` stamps `?v=BUILD_ID` automatically. Relative imports, bare specifiers and CSS need no entry.
- **Every profile or admin tab showing server data** re-fetches on the `aimeat-live-update` window event (static-data, pure-nav and push-pref tabs excepted):
  ```javascript
  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);
  ```

Styling, in short: no inline `style=""` and no CSS constants in JS; colours and spacing from `theme.css` variables; no `rgba(255,255,255,…)`; button classes are `.btn-primary`, `.btn-outline`, `.btn-ghost`, `.btn-danger` and friends, with no `.btn` base class; all user-visible text through `t()`. Full conventions and the browser verification protocol: skill `aimeat-frontend-verify`.

## Commands

From the project root; the root `package.json` proxies to `aimeat/`.

```bash
pnpm test:e2e:postgres-kysely    # E2E, production backend
pnpm test:e2e:sqlite             # E2E, fast local backend
pnpm check:importmap             # spa.html importmap vs absolute imports
pnpm check:locales --list        # how much of en.json each language carries
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
| [Identity Model](docs/coding-guidelines/identity-model.md) | GHII/GAII reference, aggregation, morsel economy |
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
| [Getting Started](docs/coding-guidelines/getting-started.md) | Install, setup, dev workflow |
| [Known Gaps](docs/known_gaps.md) | Deferred technical gaps (developer-approved entries only) |

Copy-pasteable agent connect instructions live in `public/views/profile/agents-tab.js` (`buildAgentPrompt()` and `PLATFORMS`). Machine-readable discovery is `src/routes/bootstrap.ts` at `GET /`; managed system prompts are in the DB, served by `src/routes/prompts.ts` at `/v1/prompts/:name`.

Project skills, loaded when the task calls for them: `aimeat-writing`, `aimeat-app-building`, `aimeat-library-authoring`, `aimeat-frontend-verify`, `aimeat-organism-records`, `aimeat-imagery`.
