# Pitfalls: traps in platform code we have actually hit

This file is for someone changing THIS repository: the node, its tests, its tooling. A trap that bites
someone BUILDING AN APP, an extension or a cortex on a node lives on the node instead, in the curated
registry (`aimeat/src/data/appdev-pitfalls.ts`, served at `GET /v1/appdev/pitfalls`) and the learned
knowledge base (`aimeat_appdev_pitfall_list`). The app-builder bullets that
used to sit here moved there on 2026-09-13.

**How to use it.** Find your symptom in the index below and read that section. Before a change is
called done, read the diff once against the five shapes: they are what most of this file turned out
to be about.

**Whether to add to it.** The default is no. A new section needs all three: the trap can bite again
in code or a practice that still exists; no gate, test, lint rule or comment at the spot can prevent
it (if one can, write that instead); and the section names the files it is about. A one-time
incident, a finished migration or a fix already explained in its own code goes to the Platform
Development Notes document of that work. Ruled by Jouni on 2026-10-07.

**How to add to it.** A new section goes at the END, numbered after the highest number on
`origin/main` (two sessions numbered the same section in one hour, which is why 77b
exists). In the same commit, add its row to the index: what the reader SEES, in under fifteen words,
and its shape. Symptom first in the section too, then cause, then the rule.

**When a section goes.** Delete it when the code it names is gone, or when a gate or test now
enforces it, and remove its index row and its number from the shape lists in the same commit. A
number is never reused.

> Related: `CLAUDE.md` (mandatory rules + architecture), `docs/known_gaps.md` (deferred gaps, developer-approved only), `docs/coding-guidelines/` (the full guides). The gatekeeper agent reads a diff against the five shapes (`.claude/agents/gatekeeper.md`).

## The five shapes

1. **Silent success.** Something answers ok, 200, delivered or true, or logs green, on a path where the work did not happen: a branch that returns normally after skipping, `continue` inside a loop that decides, a catch that returns a plausible value, a parameter accepted and never read, a counter or a filter nobody can see working. *Ask what the caller sees when the work did NOT happen.* §1, 4, 5, 9, 36, 61, 63, 64, 75, 76, 84, 87, 88, 98
2. **A test or a measurement that cannot fail.** A test nobody saw red, a fixture smaller than the limit it tests, a comparison two empty results satisfy, a concurrency test run on sqlite only, a flag tested switched on only, a sweep total read as a regression. *Ask which line of the change turns the test red when it is reverted.* §17, 18, 19, 21, 26, 37, 45, 50, 54, 69, 72, 79, 89, 90
3. **One rule, N doors, and one forgets.** A rule changed in one place while other doors reach the same capability: the REST route, the node MCP tool, the connector MCP tool, the CLI dispatch, an operator door, a second writer of the same record, a second backend. *Grep the capability's name and ask whether every door goes through the changed code.* §3, 7, 44, 58, 81
4. **A name is not a principal.** A comparison or a storage key built from `req.auth.owner`, `sub`, a bare account name, a delivery target or a display identity where the holder or the addressed principal is meant. *Ask what the value holds for an agent, an app grant, a federated session and a namesake.* §6, 43
5. **Parallel sessions and the machine.** A hardcoded port, a probe that binds narrower than the server, a file or a log used as state, a path from the other shell's world, a recursive delete near a link. *Ask what happens when a second session runs the same thing on this machine at the same moment.* §13, 14, 23, 39, 77b, 105

## Symptom index

| § | What you see | Shape |
|---|---|---|
| 1 | ReferenceError on a click for a function that exists; an edit that does not take | 1 |
| 2 | 404 on a route that exists, or F5 404 on a SPA view | · |
| 3 | A form that always 400s after a route gained a required field | 3 |
| 4 | Stale open view while typing; spacing silently collapsed to zero | 1 |
| 5 | A raw key on screen, or an edited string that still shows the old word | 1 |
| 6 | Anonymous treated as authed; an app 403s on a scope it cannot get | 4 |
| 7 | Works on one backend, silently wrong on the other; an upgrade crash-loop | 3 |
| 9 | A long SPA call aborting mid-flight or firing twice | 1 |
| 12 | Fixed it and prod still shows the bug; works in a shell, fails under systemd | · |
| 13 | node_modules emptied under the main checkout; a worktree dev server kills another | 5 |
| 14 | Login 500s on the dev node, native DLL EPERM on install | 5 |
| 17 | A green suite over a bug that is still there | 2 |
| 18 | Sweep totals swing by hundreds; fails in the sweep, passes alone | 2 |
| 19 | A suite goes green after a change nobody can justify | 2 |
| 20 | A hook fails on a file you never touched; two writers' edits interleaved in one file | 5 |
| 21 | A revoked token keeps authenticating | 2 |
| 23 | A scratch server writes test data into the developer's dev database | 5 |
| 26 | Signature changed, typecheck green, tests pass comparing two empty results | 2 |
| 27 | Parse error on an innocent SQL line; lint errors on untouched view lines | · |
| 36 | Headline words stack one per line; story scenes painted white | 1 |
| 37 | A compare-and-swap test green on sqlite even with the guard deleted | 2 |
| 39 | A correct-looking path gives an empty listing or a 'missing' verdict | 5 |
| 43 | Calls attributed to the wrong agent, always the same one | 4 |
| 44 | limit=1 and no limit return the same; a tool parameter the route never reads | 3 |
| 45 | A fresh token answers 401 right after another node boots | 2 |
| 50 | A gate fails naming something that exists only in a comment | 2 |
| 54 | An audit calls a stored flag unenforced; it was enforced all along | 2 |
| 58 | A nightly workflow runs 0 of 6 steps with everything reporting healthy | 3 |
| 59 | brace_expansion_1.default is not a function in a new tool | · |
| 61 | Closing the tab never aborts the model's streamed answer | 1 |
| 63 | A CI lane says Server failed to start and nothing else | 1 |
| 64 | A subscription written through its own door vanishes at the next sync | 1 |
| 69 | An inventory says a method has no callers; it has four | 2 |
| 70 | A test written from the source expects 403 and gets 404 | · |
| 72 | A unit test passes alone and times out at 5000 ms inside the gate | 2 |
| 75 | An operator page shows a plausible 0 that never moves | 1 |
| 76 | A legend names eighteen series in twelve distinguishable colours | 1 |
| 77b | pnpm sandbox dies 409 NAME_TAKEN, or --status says UP for another worktree's node | 5 |
| 79 | A disabled feature answers 404 where the spec promises 503 | 2 |
| 81 | A Finnish page prints 9/12/2026, 3:11 PM; date copies disagree | 3 |
| 84 | Settings back to defaults after a storage hiccup or a badly timed save | 1 |
| 87 | One node refuses what its code supports, and a new build changes nothing | 1 |
| 88 | A shipped fix to a bundled package, prompt or cortex never reaches a node that had it | 1 |
| 89 | A new storage method file turns check:deps red with an import cycle | 2 |
| 90 | A door nobody touched loses its field-reach twin or becomes a finding | 2 |
| 98 | Anthropic answers stop near 4096 tokens, and only a warning says why | 1 |
| 105 | A suite's own node gets EADDRINUSE on a number no file names, or a stub answers for it | 5 |
| 107 | An app's record read beside it comes back empty, though the app has one | 1 |
| 108 | Gate green, pushed, and an unrelated unit test red on the next full run | 2 |
| 109 | A dialog opened from a label reads in the label's capitals and colour | · |
| 119 | After a deploy, agents no longer see tools they used yesterday; every test is green | 2 |
| 122 | An origin fix is green, and the same code still runs on that origin by another path | 1 |

---

## 1. Build, bundling & generated files
*Symptoms: "works locally but errors in the built file", a `ReferenceError` for a function that exists, edits that don't take effect.*

- **`ReferenceError: X is not defined` for a function that clearly exists (app-catalog).** The app-catalog is a **modular esbuild build** (`aimeat/src/static/app-catalog/js/*.js` → generated `app-catalog.html`). A function CALLED but not imported from its owning module is **not a build error** — esbuild treats the unknown name as a free global, so it only throws at runtime, on the click. → After editing any module, run a **missing-import audit** (static: "name called here, exported by another module, but not imported/injected/local" — first strip string literals + comments so `window._launcher.X(...)` onclick strings and comment mentions aren't false positives; exclude `.X(` method access) **and** click every interactive path in the browser.
- **An edit seems to have no effect.** Three different reloads: a file under `public/` is served `no-cache` with an ETag, so F5 is enough; a served SDK lib (`src/static/sdk-libs/`) and `app-catalog.html` are BUILT, so they need `pnpm build:sdk` / `pnpm build:app-catalog` first; a backend `src/` change needs a `pnpm dev` restart, because the dev server does not watch it. `pnpm dev` is not a full watcher: the rest of `src/static/*` is served fresh on F5, like `public/*`.

## 2. Routing (Express + SPA)
*Symptoms: 404 on a route that exists, F5 → 404 on a SPA view.*

- **Route ordering matters** — register static routes (`/v1/memory/search`) BEFORE parameterized ones (`/v1/memory/:key`), and literal sub-paths (`/workspace/graph`) before the bare parent.
- **New SPA view F5 → 404:** register it in BOTH `portal.ts` `spaRoutes` AND `spa.html` `ROUTES`, or a hard refresh 404s (client route exists but the server doesn't know to serve the SPA shell).

## 3. Frontend ↔ backend contract drift
*Symptoms: a form that always 400s.*

- **A backend `required` field silently 400s the forms that don't send it.** → When a route gains a required field, **grep for EVERY client form/service that POSTs there** — there are often several (e.g. the app-catalog publish modal `src/static/app-catalog/js/server-io.js` AND the Profile form `public/views/profile/apps-tab.js` + `public/js/services/apps.js`).

## 4. Frontend rendering, cache & modules
*Symptoms: stale data after an update, an edit that "didn't take" until reload, spacing that collapsed to zero.*

- **A live-update handler that skips its data reload while an input/editor is focused leaves the OPEN view stale while you type.** A common (over-broad) "don't yank scroll mid-typing" guard tests `document.activeElement` (INPUT/TEXTAREA/contentEditable) and skips the whole re-fetch when composing — so the *list* refreshes (unread badge ticks up) but the *open detail view* never shows the incoming data until you send/reopen. Reads as "SSE is broken / not wired" when the wire is fine. → **Never gate the DATA reload on focus.** Always re-fetch on the event; push any "don't move the scroll while typing" concern into the scroll effect instead (suppress the one-time auto-jump when the composer is focused — near-bottom *follow* still applies), so new items render without stealing the caret/scroll. → `inbox-tab.js` + `inbox-tab/use-thread-ux.js`
- **A tab-module edit looks stale** because of the SPA module registry / bfcache — F5 for a fresh load; navigate via `about:blank` to defeat bfcache when verifying.
- **`var(--space-N)` has no definition on this theme — always write the fallback.** There is no `--space-1..8` (nor `--space-xs/sm/md/lg`) in `theme.css`'s `:root`; the file's own two uses carry fallbacks (`var(--space-4, 1rem)`). An undefined custom property makes the whole declaration invalid, so `gap: var(--space-3)` computes to `normal` and `margin: var(--space-3) 0` computes to `0px` — **silently**. Nothing errors, nothing warns, and the page still renders; it just has no spacing, which reads as "the section is one wall of fields" rather than as a bug. Scale to use: `--space-1, 0.25rem` … `--space-8, 2rem`. `getComputedStyle(document.documentElement).getPropertyValue('--space-3')` returning `''` is the one-line check.

## 5. i18n & locales
*Symptoms: a raw key rendered instead of text, a key present in one language only.*

- **`t()` silently returns the raw key on a miss** — if you see `profile.apps.foo` on screen, the key is missing or the path is wrong. Locales mix **flat dotted keys and nested objects**; check the PARSED path, not a grep (a flat `"a.b.c"` and a nested `a:{b:{c}}` look the same to grep but resolve differently). The generator emits flat keys (`"tab.search": "Haku"`), so `t()` must check the flat key before the nested path.
- **One key can exist TWICE in the same file, nested and flat, and only the later one renders.** `public/js/i18n.js` flattens the file into one map, so a flat `"profile.landing.home"` near the end of `en.json` overwrites the nested `profile.landing.home` a few thousand lines above it. Before editing a key, find every occurrence with a parsed walk (`node -e` over the JSON collecting every path that ends in the key), not with a grep for the nested line, and edit the flat one; it is the one that wins.

## 6. Identity, auth & scopes
*Symptoms: an anon request treated as authed, an app refused a scope it cannot ask for, a requested field silently dropped.*

- **Anonymous requests can carry a truthy shared identity** — an `if (!req.auth)` guard can pass for anon because a shared anon identity is injected. Gate on the real principal / membership, not just presence of `req.auth`.
- **Replacing an old path with a new one (batched endpoint, DB-service reroute) MUST reproduce the old path's FULL guard chain — middleware AND inline checks.** A refactor that optimises the *data* operation (batched reads/writes, a service layer) is exactly where authorization silently regresses: the guards read as boilerplate, so a new bulk/batched handler is written with `requireAuth() + requireScope()` and the *inline* checks (`requireExternalPrincipal()`, an `existing.archived` read-only 409, a `storage_ref` existence check, `requireScope('memory:delete')`) get dropped because they were one line among many. **Before merging a replacement, diff old-vs-new guard chains line by line** — enumerate the OLD handler's middleware list + every inline `if (…) return 403/409/422` + every per-item guard, and assert the NEW path runs each one. This is not optional polish; a dropped guard on the storage layer is the highest-blast-radius bug in the whole redesign.
- **A NEW required permission cannot be applied to consent already given.** Adding a scope gate to a route that had none refuses every grant issued before the scope existed — those owners approved the app under rules that had no such question, and the first they learn of the new one is their app answering 403 mid-use. Ship the gate WITH a grandfather clause (a grant created before the permission existed passes) and let it expire by RE-CONSENT rather than by date: reapproving reissues the grant with whatever scopes it now asks for, so the exception removes itself.
- **A scope enforced on a route must also be REQUESTABLE.** `requireScope('x')` gives no owner bypass to a role-`app` principal, so if `x` is missing from `APP_GRANTABLE_SCOPES` the app can never obtain it and its owner has no way to fix that — the permission it needs cannot be asked for. Adding a scope means adding it in BOTH places, and deciding deliberately whether it belongs in `DEFAULT_SCOPES` (spending money and giving away what you sell do not). `check:scope-parity` does not read `APP_GRANTABLE_SCOPES`, so no gate says when one is missing.
- **A field a route ACCEPTS but never stores is granted by whatever the default is, and nobody is told.** `POST /v1/agents/device-authorize` took a `scopes` list, read it in the same-owner auto-approval branch and never wrote it to the record — so on the ordinary path (the owner approves in a browser) it ceased to exist when the handler returned, and an approval naming no scopes fell back to `config.defaultAgentScopes`. **When a request field decides something a person later approves, check it reaches storage — the destructuring line is not the evidence, the INSERT is.** Keep the request in its own column (`requestedScopes`) rather than the one the approval writes (`scopes`): collapsing them leaves the record unable to say that what was asked for and what was granted differ, which is exactly what the owner needs to see. → `test/e2e-device-auth-requested-scopes.ts`

## 7. Storage & multi-backend

- **A patch must distinguish omission from clearing.** `GHIIPatch` omits or preserves an `undefined` field, accepts `null` to clear an optional field, and stores a supplied value. The profile email-change route must clear `emailVerifiedAt` with `null`; PostgreSQL ignores `undefined`. SQLite previously cleared it. `storage-patch-contract.test.ts` checks both actual providers and the profile route. A full `MemoryRecord` replacement has a different contract: omitting `workspaceRef` clears the binding (2026-09-27).
*Symptoms: a field that works on SQLite but not Postgres (or vice versa), an upgrade crash-loop.*

- **SQLite migrations: add indexes on ALTER-added columns AFTER `safeAddColumn`**, or the upgrade crash-loops. **A column named only in a `WHERE` clause counts**, and so does a column that a guarded table *rebuild* adds rather than an `ALTER`. `CREATE TABLE IF NOT EXISTS` is a no-op against the old table, so block 1 then indexes a column the upgraded database does not have and the node cannot boot: `no such column: <x>`. → `test/unit/sqlite-schema-migration.test.ts`. The sweep is worth repeating whenever an index is added to `schema-tables-*.ts`: for each index, is every column it names present on the OLDEST table shape still in the field?
- **PG jsonb does not preserve key order** — don't rely on `JSON.stringify` equality for dedup across backends.
- **A key-scheme migration must delete by the key it FOUND a row at, never by one recomputed from the row.** The rows a migration exists to clean up are precisely the ones written under the OLD key function, so recomputing gives an address that does not match where they live — the delete silently misses, the sources stay, and their history is counted twice everywhere the store is scanned by prefix. Carry `{ key, value }` out of the scan.
- **"Which record is in force" is the one at the live key, not the newest by `createdAt`.** A merged survivor deliberately inherits the OLDEST creation date of everything it absorbed, so sorting by date makes the stale leftover look canonical — and a repair run then folds already-counted history in a second time. Decide by address, not by timestamp, whenever a record's dates are derived rather than observed.
- **A migration over money must be idempotent BY CONSTRUCTION, and the proof is a second run that moves nothing.** Where a re-run could double a counter, keep the evidence of what was already absorbed (here: the survivor's per-caller breakdown) and skip those sources rather than trusting that the first run finished.
- **A query that picks ONE row among several must say which one, or each backend picks its own.** A `LIMIT 1` or an `executeTakeFirst()` without an `ORDER BY` returns whatever row the engine meets first. That is not defined in SQL, and in practice SQLite and Postgres meet different rows first, so the two providers answer the same call differently and only one of them is wrong. Nothing errors, and a test that creates one candidate passes on both, because with one row every order is the same order. **The rule:** every single-row pick among several candidates states its order, the same order on both providers, and its test makes at least two candidates, so that the wrong order turns it red. Where a newer row replaces an older one, retire the older row at write time too, so the answer does not depend on the read's order at all. When you review a storage method, read its `LIMIT 1` and `executeTakeFirst()` calls next to the other provider's copy of the same method.

## 9. AI / LLM calls
*Symptoms: a long call timing out or firing twice.*

- **Long AI calls from the SPA use `api(path, { timeoutMs: 1_800_000, retries: 0 })`, not `apiPost`** — `apiPost`'s default timeout/retries will abort or double-fire a long completion. (An app has no such helper; its road is `AIMEAT.ai.job`, registry entry `long-ai-calls-timeout`.)

## 12. Deploy, release & node-hosted apps
*Symptoms: "I fixed it but prod still shows the bug", a child process that fails only under systemd.*

- **Static node assets (`app-catalog.html`, the `public/` SPA, locales) reach prod only via a NODE redeploy** — there is NO per-file MCP shortcut for them, unlike a published app. A committed fix to these is live on `main` but not on prod until the node is redeployed.
- **What the unit file sets for node, every child process gets too.** `deploy/aimeat.service` sets `LD_PRELOAD` (jemalloc), `MALLOC_CONF` and `NODE_OPTIONS` as process environment, and a program the node starts inherits all three unless the launch names its own `env`. The headless browser did: every launch died with `Target page, context or browser has been closed`, and the capture job switched itself off for the life of the process. Which of the three does it is NOT known: the same binary ran fine from a shell with `LD_PRELOAD` alone, so the shell is not a stand-in for the unit. When something works from your terminal and fails under systemd, diff the environment first (`systemctl show aimeat -p Environment`), before suspecting the install. → `browserLaunchEnv()` in `src/services/screenshot-capture.ts`

## 13. Concurrency & worktrees
*Symptoms: `node_modules` emptied under the main checkout, a worktree's dev server killing another session's.*

Every session works in its own worktree (`CLAUDE.md`); the two bullets about sharing one checkout and about the kill-port that killed any node process were history by 2026-09-13 and are gone. What a shared tree costs when it happens anyway is §20.

- **Worktree dev server: set `AIMEAT_PORT` in the SHELL env** (`AIMEAT_PORT=40733 pnpm dev`), not only in a `.env` — kill-port reads `process.env.AIMEAT_PORT` and defaults to 40050, so without the shell var a worktree's `pnpm dev` kill-ports the MAIN session's server on 40050 before your own boots.
- **A rebase onto a commit that adds a dependency leaves the worktree without it.** The worktree's `aimeat/node_modules` holds what the lockfile said at its last `pnpm install`, and a rebase changes the lockfile but installs nothing. The next commit is refused by the pre-commit typecheck with "Cannot find module" for a package that `package.json` plainly lists. → After any rebase or merge that changes `aimeat/pnpm-lock.yaml` (`git diff --stat ORIG_HEAD HEAD -- aimeat/pnpm-lock.yaml`), run `cd aimeat && pnpm install` before the next commit.
- **ANY recursive delete run from or through a worktree that links into the shared `node_modules` destroys it — not just `rm -rf`.** The rule used to name one command, and the next session reached for a different one: `git worktree remove --force` walked the link and emptied hundreds of packages in the real checkout. `rm -rf`, `git worktree remove --force`, `git clean -xdf`, a script that recurses — Windows junctions and symlinks are followed by all of them, so the class is "a recursive delete plus a link out of the tree", and the command name is not the thing to remember. `git worktree remove --force` that answers "Directory not empty", followed by `rm -rf` on what it left, is the same delete in two steps: **inspect before you delete, not after**, and cover every `node_modules` under the worktree (there is a second one at `aimeat/node_modules`). **Do not link into `aimeat/node_modules` from a worktree at all**: a worktree that needs deps runs its own `cd aimeat && pnpm install`, which is slower once and safe every time. *Symptom when it has already happened:* `ERR_MODULE_NOT_FOUND` for a package that is plainly listed in `package.json`, and `ls node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/` shows an EMPTY directory — the symlink survives, the files are gone. *Recovery, known and cheap:* `cd aimeat && pnpm install --force` relinks everything from the pnpm store (a plain `pnpm install` will NOT — it sees the directories and reports "Already up to date"). The lockfile and manifests are untouched, so nothing needs committing afterwards; verify with `ls node_modules/.pnpm/express@*/node_modules/express/` and a `pnpm typecheck`.

## 14. Environment & tooling (Windows)
*Symptoms: login 500s, a native-DLL EPERM, a hung command.*

- **Stop `pnpm dev` before `pnpm install` touching native deps** — a running dev server holds the native DLLs (better-sqlite3) and you get an EPERM on Windows.
- **Login 500s on the dev node** usually mean the WSL docker (the database container) died — ask the user to restart it, then restart `pnpm dev`.

## 17. Tests that cannot fail
*Symptoms: a green suite over a bug that is still there; a "regression test" that has never been red.*

- **Testing the trivial case of a property proves nothing.** "Idempotent" was asserted by running a migration on a node that had nothing to merge and observing that nothing happened — which is true of every function ever written. Seed the state the property is INTERESTING in: something to merge, then merge it, then merge again.
- **A fixture must be able to occur.** The repair test built its stale row with a date BEHIND the survivor's, and passed on the broken code and the fixed one alike — because a survivor always holds the OLDER date, so that arrangement cannot exist in the store it claims to model. When a fixture is hand-written, ask which real sequence of events produces it.
- **A fake peer refuses what the real one refuses, with the real one's error.** A fake that answers a call the real peer refuses keeps a suite green over a call that never worked (`test/helpers/fake-goose-acp.ts` answered `session/cancel` as a request, which goose refuses).
- **Proving two surfaces equal needs a node that answers AND a node that refuses**, and a comparison of the whole MCP result, `isError` included; against a node that only answers ok, both paths pass where they differ (`security/connector-own-handlers.json`).

## 18. Measuring whether you broke something
*Symptoms: a sweep total that swings by hundreds between runs; "it fails in the sweep and passes alone".*

- **Parse a runner's summary by field, never by column.** The summary line is `✗ name passed failed total time` with padding, and a long suite name eats the padding, so `$2` becomes `e2e-ai-provenance-agent-plane22` and every column after it shifts. Sanity-check any parsed list against the reported total.
- **`rm` on the test database fails silently as a no-op when a server still holds it.** A killed sweep leaves an orphan node process on the port; the wipe then reports `Device or resource busy` and the next run starts dirty. Kill the process first, or run with your own `AIMEAT_PORT` and `AIMEAT_SQLITE_PATH` (an already-set shell variable wins over `--env-file`, which is what makes parallel suites possible at all).
- **The base port is claimed per session; the LANE ports are not, and `--workers=4` shares them with every other worktree on the machine.** `AIMEAT_PORT` isolates a session's own server, and `lanePort()` (`test/run-e2e-ci.ts`) then allocates each parallel lane from 40500-40599 against a ONE-TIME snapshot of what was listening when the run began. The runner restarts the server between suites — 64 restarts at 4-6 s each — and in every one of those windows the lane's port is free for a second session's runner to take. Nearly all such failures are `TypeError: fetch failed` / `ECONNREFUSED` rather than assertions. So: a red guard tier while somebody else is testing says nothing until you have re-run it with `--workers=1`, and a failing set that MOVES between runs is contention — a regression does not wander. On the main development machine WSL's port relay (`wslrelay.exe`) holds 40500, so lane 1 starts at 40501 and a restart inside a lane can find it still taken (`EADDRINUSE` in the gate log, 2026-10-06); `--workers=1` passes there.
- **A suite whose server dies at start with an error in a file you are editing loaded a half-written file.** The runner starts each suite's server from `src/` through tsx, so a suite that starts between two edits loads half a change; run it again before concluding anything.

## 19. A test that fails is one of three things, and saying which is the work
*Symptoms: a suite goes green after a change nobody can justify.*

- **A stale setup can pass for years without ever reaching the wire.** `e2e-companies` sent `Host` in a fetch headers bag; undici drops `Host` as a forbidden header without a word, so the intended request had never once been made and the test's 404s proved nothing about origin isolation.
- **A seeded record must be waited for, never raced.** Several boot seeders are fired WITHOUT `await` in `server-bootstrap/service-init.ts` (built-in skills, bundled cortexes, example packages). A suite reading one immediately wins on sqlite and loses on postgres, where the migrations run first. A flake is worse than a missing test, because it teaches everyone to re-run until green, which is how a real regression gets waved through.

## 20. Two writers, one working tree
*Symptoms: a pre-commit hook failing on a file you never touched; your edits and theirs interleaved inside one file.*

Two SESSIONS in one checkout is forbidden now (`CLAUDE.md`), so the case below is history for sessions. It is not history for subagents: a session that runs several agents in its own worktree meets every one of these, and meets them the same way.

- **The pre-commit hook runs over the whole working tree** (not just staged files), so your commit passes only if everything else in that tree also compiles. That still bites inside your own worktree when subagents are editing it in parallel: a lint error in a file one of them has half-written refuses your commit. Wait for them, or commit before you start them.
- **Interleaving happens inside a file, not only between files.** `locales/en.json` held one line of mine and forty of theirs; `config.ts` held an audit default and an unrelated extraction. Classify every modified file before staging: grep each diff for markers from your own work and from theirs, and stage by explicit path. `git add -A` is already forbidden and this is why.
- **Do not commit a file you did not fully write.** Their tree was red at the time (their own `envelope.test.ts` failed against their own committed source), so committing a mixed file would have landed a known-broken state under a message describing something else.
- **Commit only your own paths**: `bash scripts/git-commit.sh <msg> --only -- <your files>`, which also stages a named new file by name before committing.

## 21. A check placed behind a global middleware's early return
*Symptoms: revocation that "works" in storage while the credential keeps opening doors.*

- **A revocation you cannot address is not a revocation.** A JWT can be revoked by exact token hash, and the owner pressing Delete never sees the string. That is why the session id inside the token has to be tracked at MINT time: `POST /v1/auth/token` wrote a session row from the start, device authorization did not, and device auth is how real agents connect. `isSessionRevoked` answers "not revoked" for a session it has never heard of, so the missing row read as permission.

## 23. A throwaway node that is not throwaway
*Symptoms: a scratch server you started with its own env file writes into the developer's dev database; test data appears beside real work; the log says PostgreSQL when the env file said sqlite.*

- **`AIMEAT_DB` and `AIMEAT_DB_PATH` are CLI FLAG names. As environment variables they do nothing at all.** The provider comes from `AIMEAT_STORAGE`, the file from `AIMEAT_SQLITE_PATH`, and the Postgres connection from `DATABASE_URL` (`src/config.ts` lines 236-243). `src/index.ts` then fills any key the environment LACKS from `aimeat/.env` — `if (!(key in process.env))` — so an env file naming only the two flag-shaped variables leaves the developer's `AIMEAT_STORAGE=postgres-kysely` and their `DATABASE_URL` in force, and the node opens `aimeat_dev` while every line you wrote says sqlite. Clearing `DATABASE_URL` alone is NOT enough: with the provider still `postgres-kysely` the node fails to boot instead, which is better than the silent version and still not a scratch node.
- **A scratch env file needs three lines, and all three matter:** `AIMEAT_STORAGE=sqlite`, `AIMEAT_SQLITE_PATH=<your file>`, and `DATABASE_URL=` (empty — empty counts as present, so the loader skips it rather than filling it from the developer's file). Anything less and you are on somebody else's database or not booting.

## 26. tsconfig excludes test/, so a signature change does not fail there

- **The architecture regression tests now have an explicit typecheck.** `pnpm typecheck:audit-tests` runs through `check:fast` and reads the files listed in `tsconfig.audit-tests.json`. Add a new contract test to that list. This covers that list, not the entire historical test suite. It caught a missing storage method and a missing task-scope type while the runtime tests were green (2026-09-27).

*Symptoms: a function gains a required parameter, the typecheck is green, and the tests still pass — because both sides of an assertion degrade the same way.*

- **`tsc --noEmit -p tsconfig.json` does not read `test/`** (`"exclude": [… "test" …]`), so a unit test calling a changed function is never typechecked. On 2026-08-26 `defaultLayout(surface)` gained a required `config` argument; two tests kept calling it with one, the missing argument made every block fail its presence check, and the function returned an empty layout. One test compared that empty result against another empty result and passed. Both assertions were vacuous and nothing anywhere went red.
- **The tell is a test that keeps passing through a change that should have touched it.** After changing a signature, grep `test/` for the name rather than trusting the typecheck; `pnpm lint:tests` reads that directory but does not typecheck it either.
- **When a test compares two things the same bug can empty, assert the thing is non-empty as well.** `expect(a).toEqual(b)` is satisfied by `[] === []`, and that is exactly what a shared failure produces.

## 27. A backtick inside a template literal: SQL, and an htm view

*Symptoms: a `.ts` file holding DDL suddenly fails to parse, and the error points at a line of SQL that reads perfectly well. Or `pnpm lint` reports `no-useless-escape` on a `.js` view, on lines nobody touched.*

- **The SQLite schema is SQL inside `db.exec(\`…\`)`, so a backtick anywhere in it ends the template literal.** A comment written the way this project writes comments everywhere else — naming a field as `` `indexOn` `` or `` `instance` `` — closes the string, and everything after it is parsed as TypeScript. On 2026-08-26 this happened twice inside one change, in `schema-tables-4.ts` and then in `schema-tables-3.ts`, both times in a prose comment explaining a column.
- **`tsc` catches it, but the message names the symptom rather than the cause**: `TS1005: ',' expected` on the first line that stops looking like an expression, which can be dozens of lines below the backtick. Search the block for a backtick before reading the reported line.
- **The rule inside a SQL template literal: quote a field name by not quoting it.** Write `the indexOn fields`, not `` the `indexOn` fields ``. The Postgres migrations are plain `.sql` files and have no such constraint, so the same sentence is fine there — which is exactly why it is easy to write once in each and only notice in one.
- **The same rule holds inside every view's `html\`…\`` block, and there the file still parses.** An HTML comment written between two elements is inside the template literal like everything else, so a backtick in its prose ends it early and the rest of the view is parsed as ordinary JavaScript that happens to be valid. On 2026-08-31 one comment in `portal-tab.js` quoting a route as `` `/` `` did exactly this. Nothing failed: `tsc` was clean, the view rendered, and the only trace was `pnpm lint` reporting twenty `no-useless-escape` errors eighty lines below, on a `\{\{config:node_id\}\}` table that had been there for months. **ESLint exempts escapes in a TAGGED template literal, so the errors appear the moment the text stops being tagged** — the rule is reporting the terminated template, not the escapes. Read the lint output as "where did this template end", not as a complaint about the lines it names, and write the comment without backticks.

## 36. A kit class name is a namespace, and a collision shows only in a browser

*Symptoms: a new Atelier part renders wrong in a way no gate catches: every word of a revealed headline lands on its own line; every scene of a scroll story is painted white; a component's own box inherits a layout it never asked for.*

- **The kit's stylesheets are one global namespace, and two modules that pick the same `.ak-*` name silently share every rule.** On 2026-09-02 `textReveal` took `.ak-reveal`, which already belonged to the disclosure component (a flex column in content.css), so each split word became a flex item stacked under the last; the director took `.ak-scene`, which already belonged to scene3d (a surface in data.css), so every story scene wore a white ground. Both passed typecheck, lint, the contrast matrix and the e2e suites, because none of them reads a class as a name.
- **The guard is one grep before naming**: `grep -rho "\.ak-[a-z0-9_-]*" aimeat/public/lib/aimeat-atelier/*.css | sort -u` lists what is taken. A module that adds a family names it after itself (`.ak-textreveal*`, `.ak-act*`, `.ak-tug*`), not after the idea, because the idea's word is the one most likely to be taken already.
- **A parallel build makes this worse, not better.** Five modules written at once by five hands each checked their own file and none saw the others'; the collisions surfaced only when the pages were driven in a real browser. The browser run is the gate for this class of defect, which is why it stays mandatory for a finished frontend change.

## 37. A concurrency fix that sqlite cannot fail

*Symptoms: a compare-and-swap is added, the E2E suite that proves it goes green on sqlite, and the same suite fails on postgres the moment the swap is removed — so the sqlite run proved nothing at all.*

- **better-sqlite3 is synchronous, so one request's read, compute and write never yield to another.** Two HTTP requests that both edit the same record serialise on their own, and a last-write-wins implementation passes a "two concurrent writers both survive" test. Measured 2026-09-02 while adding in-place workspace document edits: with the `ifVersion` line deleted from the service, sqlite stayed green on all 17 assertions and postgres-kysely failed two of them, with ten callers told `ok` and ONE of their texts in the document.
- **So the experiment is the evidence, and it has to be run on postgres-kysely.** Delete the guard, run the suite on the production backend, watch it go red, put the guard back. A concurrency test that has never been seen to fail is a test that checks nothing — the same rule as any other gate, and this one hides behind a backend difference rather than behind a wrong assertion.
- **Say which backend the property holds on, in the suite.** A note beside the test stops the next reader concluding from a green sqlite run that the race is covered.

## 39. One shell, two path worlds, and every mistake fails silently

*Symptoms: a path that is obviously correct produces an empty result rather than an error; a verifier reports "missing" or "?" about something that is present; a command a script printed for someone to paste cannot work on the machine that receives it.*

- **Git Bash runs POSIX tools beside Windows-native ones in the same prompt, and they do not share a path world.** `pwd` gives `/e/dev/...`, its own mount. `npm`, `node` and PowerShell cannot resolve it. `cygpath -m` converts to `E:/dev/...` — and that form breaks the POSIX half: **Git Bash's `tar` reads `E:` as a REMOTE HOST**, answering `Cannot connect to E: resolve failed` and printing nothing. On 2026-09-03 this bit four times inside one afternoon, in one file, each time as a wrong answer rather than a failure.
- **Every one of them was quiet.** `node -p "require('/e/dev/…')"` returned `?` through an `|| echo '?'`, so a verifier reported a version mismatch it had never measured. `tar -tzf E:/…` returned an empty listing, which reads as a broken tarball rather than as a bad argument. A script printed `npm i /e/dev/…` and the reader's install failed on their machine, not on ours.
- **A script whose output is meant to be pasted prints BOTH forms, labelled by the tool that needs each.** `scripts/pack-connector.sh` prints the Windows path for `npm i` and the POSIX path for `tar`, and says which is which — one path cannot serve both, and printing only one sends somebody down the wrong road.
- **Read a JSON field with `sed`, not with `node -p require(...)`, when the path came from this shell.** The conversion is one more place to get it wrong, and the failure mode is a value that looks like data.
- **`tar -tzf … | grep -q` under `set -o pipefail` reports the whole pipeline as failed**: grep exits at the first match, tar takes SIGPIPE writing the rest, and pipefail hands back tar's status. List once into a file, then grep the file. A verifier that says "missing" when it means "I could not tell" is worse than not having one.

## 43. A shared channel needs the sender's name on every frame, and the default is one identity's

*Symptoms: a call is attributed to the wrong principal, and the wrong one is always the SAME one; the component works perfectly for one user and is wrong for every other; a permission check refuses an agent asking for its own data and then serves it somebody else's.*

- **The audit class.** A correct rule, and one place of N that did not know it. Same shape as invariant 11's owner-name confusion: the rule was written down and enforced in some doors only.

## 44. A parameter that is declared, forwarded, and then read by nobody

*Symptoms: a caller hits a size or rate wall and the parameter that exists to make the request smaller changes nothing; `limit=1` and no limit at all return byte-identical responses; the obvious fix looks like a fix and is a no-op. Seen 2026-09-04: `aimeat_memory_list` refused with `TUNNEL_RESPONSE_TOO_LARGE` at every value of `limit`.*

- **Declared on one surface, enforced on none.** `limit` was published in the connector MCP tool's parameter list, forwarded by the CLI dispatch as a query string, and `GET /v1/memory` never read `req.query.limit` — the word appeared in that file only in the SEARCH handler below. Nothing errored: an unread query parameter is silently discarded, so the call succeeded having done less than it was asked. → CLAUDE.md, "A tool has THREE surfaces", which is the same failure one layer up.
- **A wall with no smaller thing to ask for is a blocker, not a limit.** The tunnel refuses a response over `connect_tunnel.max_response_bytes` and that cap is right — one identity's enormous answer sits on a socket sixty-one others are waiting on. What made it fatal is that the caller had no way to comply. Whenever you add a size refusal, name in the same commit what a caller does about it, and check that thing works.
- **Check whether the expensive half is even wanted.** The listing shipped every record's value; the tool reads `key`, `gaii` and `visibility` and prints eighty rows. 25 MB of article bodies crossed a shared socket so that eighty names could be printed, and every byte was discarded on arrival. `?include=meta` had existed since 2026-07-14 and the node's own MCP surface had always answered metadata-only — the connector door was the one out of three that did not.
- **The published schema is the tie-breaker.** `memoryListOutput` says the listing "carries no values (always the case)". One door disagreed with the contract, so aligning it is a fix and not a behaviour change. When two surfaces differ, read what was promised before deciding which one is right.
- **Bound what you hand back; keep telling the truth about how much there is.** `total`, `count` and the quota are computed over everything that matched and only `items` is sliced. Summing the slice would make the Memory tab's "used" figure shrink whenever anything passed a limit, and an agent deciding whether to narrow further would be reading its own limit back.
- **A tool's field the route reads under another name is dropped the same way.** Read the route's handler for each field a tool sends, not the catalog description: snake_case where the route reads camelCase (`target_type` against `targetType`), a list where the route reads one comma-separated string. `withDeclaredInputOnly` and `cli-tool-param-forwarding.test.ts` check only that a declared parameter leaves the process.
- **Where the work for a tool exists only in an MCP handler, give it a route that runs the same service function** rather than composing it from generic routes in the client (`POST /v1/appdev/templates`, `GET /v1/organisms/:id/workspace/index`).

## 45. Three nodes in one process share one signing key

*Symptoms: a token that worked a line earlier answers 401 AUTH_REQUIRED, from a live server, with nothing expired and nothing revoked. Every test after a certain point fails the same way, and the point is where a node was booted.*

- **`initNodeKeys` writes the keypair into module-level variables and overwrites them unconditionally** (`src/auth/jwt.ts`). That is right for a real node, which is one per process. A federation suite that boots two or three nodes in ONE process gets one key between them, and the last boot wins: every token an earlier node handed out was signed with a key the process no longer holds. `verifyJWT` fails, `req.auth` is never set, and `requireAuth` answers 401 — a refusal that reads like a permission problem and is a key rotation.
- **It only bites when a node boots LATE.** `federation-messages.ts` booted A and B together, minted both owners' tokens after (so both were signed with B's key and both verified), and booted node C inside test 5b. Everything from 5b on — the cross-node image pull, the block, the agent DM, the interactive question, the operator broadcast — failed on a 401 from A or B. Seven assertions that had never once run, sitting in a suite that reported them as failures for weeks.
- **Re-mint in the boot helper, not at the call site.** `bootNode` now re-mints the owner token of every node booted before it, so a suite that adds a fourth node later needs to know none of this. Five other suites boot more than one node in-process (`federation-multinode`, `e2e-federation-book`, `federation-support`, `e2e-federation-visiting`, `e2e-federation-policy`); none is bitten today only because each boots every node before minting anything.
- **The tell is the envelope.** The 401 body carries no `node` field, because the refusal is written before a node identity is resolved. A 401 with a node id in it is a permission answer; one without is this. → §18

## 50. A gate that reads source text counts the comment that explains the code

*Symptoms: a gate fails naming something that exists nowhere. `grep` finds exactly one hit and it is a sentence. The commit that broke it did not touch the thing the gate is about.*

- **The case.** `test/unit/scope-vocabulary-parity.test.ts` reported `social:*` as a permission the node enforces with no owner checkbox, and main went red for everyone. `social:*` is in `src/` once: a doc comment in `routes/boards.ts` that explains the gating with the words `requireScope('social:*')`. The scan joins every `.ts` file into one string and matches `/requireScope\(\s*'…'/`, so a comment that QUOTES a call is a call. The gate was right about its own reading and wrong about the node.
- **The wrong fix is to reword the comment.** It greens the gate and leaves the trap for the next author, who has no way to know the rule. Nineteen files under `scripts/` and `test/unit/` read raw source this way, and each is one accurate sentence away from the same failure.
- **The fix is one line at the top of the scanner:** strip comments before matching, and keep the unstripped text for the scans whose question really is "does this string appear anywhere" — those two questions are different and both are asked in that one file. Crude stripping is fine: a quote holding `//` would be mangled, and it cannot change what a call-shape scan finds.
- **The general rule.** A regex over source is a claim about CODE. Before writing one, ask what it does with the same characters inside a comment or a string literal, and if the answer is "counts them", strip first. Same family as §44: a check that compares surfaces with each other is confidently wrong when the thing it reads is not the thing it means.

## 54. "No door reads this flag" is a claim about the whole tree, and a route-layer grep cannot make it

*Symptoms: an audit reports a permission word that is stored, echoed by several listings and enforced nowhere. The remedy proposed is to start enforcing it, or to delete it. Both are wrong, because it was being enforced the whole time.*

- **The general rule.** "Nothing reads X" is a claim about every file, so it is only ever earned by searching every file. Grep the whole `src/` tree for the FIELD name, not the routes for a gate shape, and read each hit before ruling. Enforcement that survives a route-layer sweep lives in three places by preference: a `utils/` serializer, a projection or summary builder, and a storage query's own predicate. And before proposing to enforce a flag that defaults to off, count how many live records carry the default — if it is all of them, enforcement is a change of behaviour for everyone, and the burden is to show which door was under-enforced rather than which door is convenient.


## 58. A notification that was never sent, and a dedup that makes sure it never will be

*Symptoms: a nightly workflow runs 0 of 6 steps, two nights running. The tasks exist and are `active`, the agents are `online` with `delivery.channel = socket`, the daemon has been up for hours, its park returns 204, and nothing anywhere is in an error state. A DM to the same agent in the same minute wakes it in seconds.*

- **Why the control experiment is the diagnosis.** `aimeat_dm_send` to the same agent in the same minute started a worker in seconds. That separates "the channel and the park are broken" from "this particular producer never speaks", and it takes one minute. Reach for it before reading any code: a second producer that works narrows the search to the one that does not.
- **The distinction the fix turns on.** Dedup exists to stop double WORK — launching a runner twice, queueing a task twice. A wake is not work. `handleRecord` and `handleDm` in `local-channel.ts` had always had this right: they signal on every event and let the queue hold the item. `signalWake` is edge-triggered on a counter and latches, so signalling more often cannot spin (see the `wakeSeq` comment) and a late park still collects the wake. Suppressing the signal, by contrast, removes the only path back.
- **The general rule.** When a record is created in two places, the side effects have to be created in both, and the compiler will not say so: a second call site that writes the same row through `storage.*` instead of the shared service inherits none of its fan-out. `agent-task-fanout.ts` exists because this exact shape cost eight side effects on task COMPLETION in August 2026; this is the same shape on CREATION, found a month later. And when a dedup and a missing notification meet, the bug stops being intermittent and becomes permanent — which is why it cost two nights instead of two minutes. Grep the shared writer for what it does after its write, then grep every other caller of the same storage method for the same list.


## 59. A pnpm override with an open `>=` range walks out of the major

*Symptoms: a tool that depends on `minimatch@9` crashes with `brace_expansion_1.default is not a function`; a tool on `js-yaml@3` fails the same way with a different name. `pnpm why brace-expansion` shows one version, 5.0.9, under every dependent, including the ones whose `package.json` asked for `^2.0.2`.*

- **The case.** The advisory overrides in `aimeat/package.json` said `"brace-expansion@<1.1.18": ">=1.1.18"` and `"brace-expansion@>=2.0.0 <2.1.4": ">=2.1.4"`. pnpm resolves an override range to the highest version that satisfies it, and `>=2.1.4` is satisfied by 5.0.9, so every package that asked for 2.x was handed 5.x, which had dropped the CommonJS default export minimatch calls. Nothing noticed for two weeks because nothing in the tree had run minimatch@9's CommonJS path until `c8` arrived on 2026-09-08. The same shape had already bitten once, on js-yaml (commit 5c7db0767, 2026-08-23), and the fix was written once and not generalised.
- **Why it hides.** The override is written next to the advisory it closes, it reads as "at least the patched version", and `pnpm audit` is green afterwards. The break lands in whichever consumer happens to exercise the changed API first, weeks later, in a file the override never mentions.
- **The rule.** An override that closes an advisory stays inside the major the dependents asked for: `^1.1.18` and `^2.1.4`, never `>=`. If the patched version is only in a newer major, the dependents need a real upgrade, not an override. `"brace-expansion@>=4.0.0 <5.0.9": ">=5.0.9"` in the same block is harmless today only because 5.0.9 is the top of its major; it carries the same trap.


## 61. On Express 5 the request's `close` has fired before your handler listens for it

*Symptoms: a streaming route registers `req.on('close', …)` to abort work when the person leaves, and the work never aborts. The socket is gone, the SSE stream is dead, and the model keeps answering to nobody; the complete answer is written down thirty seconds after the tab closed.*

- **The case.** `routes/chat.ts` attached the listener after two awaits. On Express 5 an `IncomingMessage` emits `close` once, as soon as the request body has been read, which is before those awaits return; the listener was attached to an event that had already happened, and the real disconnect never produced a second one. So `finished` stayed false, the `AbortController` never fired, `chat-session`'s abort never ran, and `goose-acp`'s `cancel()` was unreachable from any door. Found by `e2e-chat-agent` on 2026-09-08, the first suite to run a turn against an agent; measured three ways, including a plain `node:http` control that saw its `req 'close'` 3 ms after the same destroy.
- **The rule.** The RESPONSE's `close` is the event that means the connection went. Listen on `res`, and listen before the first await if the work before it can take time. A test that proves it: destroy the socket mid-stream and assert the downstream cancel arrived, not that the stream ended.

## 63. A suite that spawns its own node throws away the reason it would not boot

*Symptoms: one CI lane fails with `Server failed to start`, and nothing anywhere says why. The same commit is green on a rerun with nothing changed. Locally the suite passes every time.*

- **The stream that matters is STDOUT.** This node logs through Winston, whose console transport writes every level there, so `logger.error(...); process.exit(1)` — how the boot refuses an unreadable node key, a database it cannot open, a pin it does not understand — never touches stderr. A harness that keeps only the stderr tail therefore reports a fatal boot as silence. `test/helpers/wait-for-server.ts` and `test/run-e2e-server.ts` (`keepTails`) keep both tails.
- **The rule.** A drain that discards is a discard. Keep the last few kB of BOTH streams, and let the timeout say what the child said: a suite that spawns its own node uses `test/helpers/wait-for-server.ts`. `test/e2e-pacing.ts` still drains both streams into an empty handler.

## 64. A prune that selects by key prefix eats whatever else lives under that prefix

*Symptoms: a record written through its own door is gone by the next scheduled cycle, and no log names a delete of it. A subscription survives exactly one sync, so the code that reads subscriptions later in the SAME cycle has never once found one: the feature behind it never runs and never errors.*

- **The case.** Genesis catalogue sync stores a peer's entries under `genesis:{peer}:`, then removes stale ones by listing that prefix and deleting every key the peer no longer lists. Two other things live under the same prefix and are never in the incoming set: the operator's subscription record (`genesis:{peer}:subscriptions`, written by its own PUT) and the cross-genesis memory cache. Both were deleted on every sync, and `syncSubscribedMemory`, which runs later in the same cycle, had therefore never seen a subscription. Found by `e2e-genesis-federation`, fixed 2026-09-08 in `src/services/genesis-sync.ts`.
- **Why it hides.** Every part of it succeeds. The writer writes, the reader reads, the prune prunes, nothing throws, and the record does exist for as long as a manual check right after the PUT would take. Only a test that crosses a sync boundary sees it.
- **The rule.** A prefix is an address space, not an owner. A prune selects the records it owns by something their writer put there deliberately, a tag or a discriminator field, never by "everything under this prefix that I did not just write". When a prefix is shared, say so in a comment at the prune and name the other tenants, because the next person adding one will grep for the prefix and find only the writer.

## 69. "Binary file X matches" is a hit you did not read, and a dead-code inventory built on grep deletes live code

*Symptoms: an inventory says a method has no caller anywhere in the tree. It has four, in one file. The search that produced the inventory exited 0 and printed the file's name with no line number, and every filter downstream dropped that line as noise.*

- **The case.** Dead-code batch 3 (`eb324be07`, 2026-09-09) listed the `Storage` methods that no caller outside `src/storage/` reaches. Seven candidates were live: `countPublishAttempts` and `reopenPublishAttempt` are called four times from `services/connections/publish-gate.ts`, `upsertMemoryWriteTally` and `upsertMemoryFamilyTally` from `services/data-map/write-tally-buffer.ts`, and the four realtime-room methods from `services/realtime-manager.ts`. Each of those files holds a NUL byte, because a composite key is built by joining on NUL and the delimiter was written into the source as the raw character rather than as an escape sequence. GNU grep calls any file containing a NUL binary: it prints `Binary file <path> matches`, exits 0, and prints no line. **Fourteen files under `src/` are in that state today**, and nothing else about them is unusual.
- **Why it reads as an answer.** The suppressed hit does not look like an error. It carries no line number and no code, so it falls out of anything written to consume `path:line:text` — a `| grep -v '^src/storage'`, a count of matching lines, an agent summarising "no callers outside the storage layer". Ripgrep suppresses the lines too, though it at least says why: `binary file matches (found "\0" byte around offset 3740)`.
- **The fix at the search.** `grep -a` and `rg -a` read the file as text and print the lines; nothing else changes. A path-only search still lists the file while a content search shows nothing from it, and that disagreement between the two modes is the tell.
- **The fix at the source.** A NUL delimiter is a reasonable choice for a composite key. Write it as the two-character escape sequence backslash-zero, not as the byte itself, and the file stays text for every tool that opens it.
- **The rule.** A deletion is a claim about every file, so it is never made from one tool's output. Search with `-a`, then confirm each candidate with a tool that resolves symbols rather than text — the compiler, the editor's references, `pnpm check:deps` — before removing anything. And a pipeline that filters or counts a search's output must fail loudly on a line it cannot parse, because a "Binary file" line silently becomes zero.

## 70. A guard behind a fence that already answered is not defence in depth, it is a sentence that lies about the door

*Symptoms: a test written from the source asserts `403` and gets `404`, so the test looks wrong. A coverage report shows an uncovered line inside a handler every suite drives, and nobody can construct the request that reaches it.*

- **What this is not.** It is not an argument against a redundant check at a real boundary. The test is whether an input exists that reaches the branch. An owner-scoped query, a schema validator and a `404` on a missing record each **answer**, and nothing gets past one of them to the guard behind it.
- **The rule.** Before writing a defensive check, name the request that reaches it. If you cannot, delete it or move the fence — the check belongs where the value first arrives, not behind the thing that already refused. When you delete one, record in the suite what used to be asserted and why it could not fire, or the next reader restores it as a missing protection.

## 72. `pnpm gate` runs the unit graph in parallel, so a test that takes a second alone crosses vitest's 5 s default

*Symptoms: a unit test passes every time you run its file and fails in the gate with "test timed out in 5000ms". The rerun is green. Nothing in the test is slow and nothing in the diff is near it.*

- **The rule.** When a fixture's size is part of what a test proves, give that case an explicit timeout at the `it()` and say in a comment why the number is what it is. Do not rerun until green: contention decides it, so a rerun buys a green that proves nothing.

## 75. A counter nobody writes reads exactly like a counter at rest, and a page will lead on that zero for months

*Symptoms: a number on an operator page is 0. It is plausibly 0. Nothing is red, nothing is logged, and the code that would increment it is right there and looks fine.*

- **The rule, and it is a test rule.** A counter earns an E2E assertion that it **GROWS**: read it, cause the thing, read it again, assert the second is larger. Presence proves nothing and a fixed value proves less. `test/e2e-metrics.ts` has that assertion; `test/e2e-admin-stats-page.ts` is its twin for `GET /v1/stats`. When you add a counter, add the growth assertion in the same commit, and when you mount a per-request middleware, mount it on the same line as the one already there — `requests_total` and `aimeat_http_requests_total` describing different sets of requests is its own defect.
- **And on the surface: separate an absence from a zero.** The Statistics page reads the period and the node's whole life, and says "nothing has ever written this" rather than drawing 0, because a reader cannot tell the two apart and the page is the only thing that can.

## 76. A categorical palette that CYCLES is worse than one that runs out, and a stacked chart is where it does the damage

*Symptoms: a chart's legend names more series than the eye can separate. Two entries look identical. Nothing errors, the chart draws, and the numbers behind it are right.*

- **The case.** `components/UsageChart.js` exports `APP_PALETTE` (twelve colours) and `colorForIndex = (i) => APP_PALETTE[i % APP_PALETTE.length]`. The admin Usage page fed it one series per model, straight off a list with no ceiling. On aimeat.io that list was eighteen models, so six of them wore a colour another model already had — inside a STACKED bar, where two same-coloured segments in one stack cannot be told apart at all. The legend confidently named eighteen models and could distinguish twelve. The same call sits on the AI-apps chart, with apps instead of models and the same absent ceiling.
- **Why the modulo looks right when you write it.** `i % len` is the standard defensive move for "don't index past the end", and in most places it is. For a colour it silently converts "I have run out of distinct values" into "here is a value" — the one outcome a categorical scale must never produce, because the whole contract of a categorical scale is that colour identifies the series. Running out loudly (throw, or fold) is recoverable; repeating quietly is not.
- **The rule.** A categorical palette is a fixed order and a hard ceiling; past it the extras FOLD into one "Other" row with a count of what it holds, or the figure changes. And check whether the thing wanted a colour scale at all: "what is the money going on" is a ranking, not a time series, and a row with a length-encoded bar has no ceiling, needs no legend, and reads the same at eight models or eighty. The Usage page's model split is rows now; the one chart that kept a colour scale has exactly two series, because two is the split that changes what the operator does.
- **Related, and the reason this was found at all:** a chart whose series count comes from data has no ceiling by construction. Treat "one series per row of whatever came back" as the bug, not the palette.

## 77b. `pnpm sandbox` picks a port another session already holds, and then seeds into that session's node

*Symptoms: a first `pnpm sandbox` on a fresh worktree dies with `register sandbox: 409 NAME_TAKEN` on a database that cannot possibly hold an owner yet. `--reset` does it again, and so does an explicitly chosen port. Or `pnpm sandbox --status` prints UP, and the node at its URL holds another session's data.*

- **`--status` says UP for a node another worktree started on the same port, and this is still unfixed.** `isUp()` in `aimeat/scripts/sandbox.ts` asks only whether something answers on the port `.sandbox.json` records, and never compares the listener's pid with `s.pid`; the reuse branch of `up()` makes the same inference and asks the other node for tokens. Diagnose with `Get-NetTCPConnection -LocalPort <port> -State Listen`, then the owning process's command line, which names the worktree and the `sandbox-<port>.db` it serves. Kill only your own orphan, never the neighbour's node.
- **The environment variable has to reach the script rather than the pnpm shim**, so `$env:AIMEAT_SANDBOX_PORT='40645'; pnpm sandbox --reset` from PowerShell, not an inline `VAR=… pnpm …` in Git Bash, which this setup drops. The same drop makes `AIMEAT_E2E_PORT=… pnpm test:env:init` silently keep the derived port — check the `AIMEAT_PORT` line in the `.env.test.*` it wrote and put THAT number on your claim, because it is the one your suites will use.
- **The rule.** A free-port probe binds what the server will bind. Anything narrower answers a different question than the one being asked. And when a tool picks a port for you and the data looks like somebody else's, read the pid's command line before deleting anything.

## 79. A feature flag that decides whether the router is MOUNTED makes every refusal inside it dead code, and the answer becomes 404

*Symptoms: a route's documented 503 has never been seen. A caller on a node with the feature off gets NOT_FOUND, and a status page that reads the route cannot tell "switched off" from "broken" or from "quiet".*

- **The case.** `routes-loader.ts` mounted the realtime router inside `if (config.realtimeEnabled)`. All ten routes in `routes/realtime.ts` open with `if (!config.realtimeEnabled) return 503 FEATURE_DISABLED`, and `openapi.yaml` documented that 503 on every one of them. None of those lines could ever run: with the flag off there is no router, so Express falls through to the 404 handler. Measured 2026-09-12 when an E2E booted a second node with `AIMEAT_REALTIME_ENABLED=false` and got 404 where the spec promised 503.
- **What it cost upstairs.** The admin dashboard stores a rejected read as `null`, so the Realtime page drew the same three zeros for a node with realtime switched off as for a node nobody happened to be connected to. Two years of a page that could not answer the first question an operator asks.
- **Why it hides.** Both halves look right on their own. The mount reads as an optimisation (why build what nobody can reach), and the in-route guard reads as defence in depth. Nothing tests the disabled path, because the suites run with the feature on — the one configuration where the two halves agree.
- **The rule.** A feature flag decides what a route DOES, not whether it exists. Mount the router either way and let its own refusal be the answer; keep conditional only what must not exist at all, which for realtime is the WebSocket upgrade handler (`mountRoutes` returns `null` instead of the manager, and `index-start.ts` registers nothing). Fixed 2026-09-12 in `src/server-bootstrap/realtime-mount.ts`. When you write a route guard on a flag, the test that proves it is a node booted with the flag off — and `AIMEAT_STORAGE=memory` plus `app.listen(0)` makes that a dozen lines inside an existing suite, with no database and no port to claim.

## 81. Deriving the format from the language, and the field that already meant something else

*Symptoms: a Finnish page prints 9/12/2026, 3:11 PM. Or the opposite, and worse: a person picks a date format and the language of their email quietly changes.*

- **The field that made it dangerous.** `GHIIRecord.locale` already existed and reads as the obvious home for "formatting". It is not: `routes/ghii/attach-email.ts` picks the LANGUAGE OF AN OUTGOING EMAIL from it. Hanging formatting on the same column would have meant a person choosing an American date format silently changed the language of their own mail. Three columns, not two: `locale` (words, and email), `region` (how it is written), `timezone` (which clock).
- **The rule.** Language, regional format and time zone are three independent settings; never derive one from another, and never reuse a field that already answers a different question. Absent means "follow the reader's browser", which is a real state and keeps every existing account behaving exactly as it did. And an OFFSET is not a zone: `GMT+2` is refused, because an offset cannot know about summer time.
- **The tell:** a `localeTag()`, a `localeFor()` or any function whose input is the UI language and whose output is a format. It is the same defect whatever it is called, and finding two copies of it means there are six. `public/views/admin/economy-tab.js` (line 78) still picks the decimal comma by language.
- **And the delivery is its own trap, three times over.** The read that fetches the preference ran at `spa.html` boot, BEFORE `AIMEAT.auth.login()` restored the session — so `apiGet` found no session, sent no bearer, and got 401 on every page load. A 401 there is indistinguishable from a signed-out reader, so the answer was "no preference" and every date silently kept the browser's format for the life of the page. **Two rules fall out:** a boot-time read that needs a credential goes after the thing that provides it, and a failed read must not latch — `loaded = true` in the catch meant no later sign-in could ever correct it. And when a setting changes, announce it on the event the app already re-renders on (`aimeat-live-update` here); a private event nobody subscribes to leaves every open tab showing the old format until the reader navigates away and back.

## 84. A read that falls back to defaults, reused to write back, saves the fallback over the real record

*Symptoms: nothing is red. After a storage hiccup, or a save made at the wrong moment, the owner's settings are back to defaults or to how they were an hour ago, and the log holds one warning from a read.*

- **The first case.** `readInboxOrganize()` answered a storage failure with defaults, which is right for drawing the Messages list: every conversation shows, unorganised. The archive and rule writes read through the same function, so a failed read followed by a working write would have saved the defaults over the owner's archive and rules. The `node-mcp-error-flag` unit suite caught it, because the settings tool answered a broken storage with defaults and no error. Fix `194a99821`: `readInboxOrganizeStrict()` throws, every write and both settings doors use it, and only drawing the list keeps the forgiving read.
- **The same shape three more times, in the notification settings (2026-09-13).** The Notifications page loads the record from `GET /v1/notifications/senders`, which read forgivingly, and `PUT` replaces the WHOLE record, so one toggle after a failed load erased every muted sender and the quiet hours. `PUT` kept the digest bookmark from the same forgiving read, so a failed read saved `lastDigestAt: null` and the next digest re-sent what had gone out. And the digest sweep wrote back `{ ...snapshot, lastDigestAt }` using the snapshot it took before sending the email, so a save the owner made while the email went out was undone. That last one needs no storage failure at all, only timing.
- **Why nothing notices.** Every read logs a warning and returns a well-formed record. The write succeeds. The page shows the record it just saved. The loss is only visible to the person who remembers what they had set.
- **The rule.** A read that falls back to defaults is for DECIDING or DISPLAYING, never for writing back. Anything that reads in order to write takes the strict read and lets the failure throw, and it reads immediately before writing, inside a per-owner queue (`utils/serial-by-key.ts`), changing only its own fields on top of what it just read: `updateNotificationSettings(storage, ghii, cur => ({ ...cur, lastDigestAt }))`. A door that feeds an editor refuses (503) rather than serve defaults the editor would save, and the editor refuses to save without a loaded record. When a module has both reads, name them apart (`readX` / `readXStrict`) so a caller has to choose.
- **The tell:** a `try { read } catch { return defaults }` whose result later flows into a `setMemory`, or a write built from a record read before an `await` that sends mail, calls a provider or waits on anything slow.

## 87. A node that changed its id stops receiving its own seeded upgrades

*Symptoms: one node refuses what the code plainly supports, and the refusal comes from the schema rather than from the feature's own checks. Deploying the newest build changes nothing, because the stale thing is a database record, not the binary.*

- **The case.** innokas.aimeat.io refused every `backing: 'rows'` manifest with `allowedValues ["memory","tasks"]`, three weeks after row spaces shipped and while running code that has them. Its stored manifest-format schema was seed v4 from 2026-08-21, locked by `system@aimeat-local-001-dev`: the node first booted on the default dev id and was renamed to `innokas-finland-001-genesis` on 2026-08-24. `seedManifestSchema` upgrades a stored record only when its `lockedBy` equals `system@{the current node id}`, so from the rename onwards every boot read the node's own earlier self as a stranger and skipped the upgrade. Twenty of that node's 34 schema records carry the old lock. Measured 2026-09-14; fixed by adopting any `system@` lock and re-stamping it.
- **Why the equality check looked right.** It is guarding something real: an operator who customized the schema must not have it overwritten at every boot. But `lockedBy` answers two questions at once, and only one of them is stable. `PUT /v1/memory/:key/schema` stamps the caller's GHII, and nothing but a seeder writes a `system@` lock, so the PREFIX is the durable test for "the node wrote this" while the full string is a name that is allowed to change.
- **The tell.** Any `existing.X !== config.nodeId` in code that runs at boot. A node id is configuration, not identity: it can be set after the first boot, changed by an operator, or inherited from a restored database. Records written under the previous value are still the node's own.
- **How to see it from outside.** `GET /v1/memory/{a concrete key}/schema` needs no auth and returns `locked_by` plus the schema, whose `$comment: aimeat-seed-vN` is the stored version. `GET /v1/schemas` lists every lock, so grouping by `locked_by` shows at a glance whether a node is seeding under a name it no longer uses.
- **The sibling.** §88's version-gated seed is the same family with a different key: a stored artifact that only refreshes on a version comparison, where the comparison never fires.

## 88. A seed that creates only what is missing never delivers a fix

*Symptoms: a fix to a bundled package, prompt or preset is in the release, the node runs the release, and the node still serves the old one. `aimeat_package_update` answers "no update" to everyone who installed it. Restarting changes nothing.*

- **The case.** An operator of another node reported on 2026-09-15 that the 3.15.0 company-brain fixes (source kinds, the data map, the workspace name) reached no node that had already seeded the package. `package-seeder.ts` skipped a group with any published version, and the package version was the seed's wall-clock stamp, so nothing about the content was ever compared. aimeat.io was in the same state. The same rule held two other stores: system prompts outside the code-owned groups (`bootstrap-auth` and `anonymous-share` went on telling agents to use micro-memory after it was deleted on 2026-08-23), and the Design Book leiskat (rewritten on 2026-09-05, bare on every node seeded before).
- **Why it looked right.** Create-if-missing protects something real: an operator's edit must survive a restart. But it cannot tell an edit from an untouched copy, so it treats every existing record as edited, and the protection costs every fix the project ships.
- **The rule.** A boot seed compares what it would write with what is stored, and needs a way to know whether anyone else wrote it. Three answers now exist, one per store: the package fingerprint (a system package has no other writer, so a changed fingerprint is always safe to publish as a new version), the prompt's newest version entry (a factory write whose text is still stored means nobody changed it), and the Design Book part's owner (only the system can propose a system part; its status stays the operator's). `skill-seeds.ts` has the fourth, a stored fingerprint of what it last wrote. A version-gated seed (cortexes, extensions, the manifest schema) is a fifth, and a forgotten bump means no node that already has it ever gets the change. A bundled cortex code change is three edits: the code, the pack's `VERSION` constant, and `spec.version` in its manifest. `test/unit/cortex-bundle-versions.test.ts` reads the pack files rather than importing them, so the local gate (which picks tests by import graph) does not run it: run it by hand and record the line it prints.
- **What is still create-if-missing, measured 2026-09-15.** Profile schemas, CSM templates, template bundles, core scheduled jobs and the anonymous identity's scopes. None of their content had changed since 2026-08-01, so nothing is stuck yet; the first change to any of them will be.
- **The tell.** `if (existing) continue` in anything under `server-bootstrap/` or named `seed*`. Ask what happens to a node that booted yesterday when this file changes today.
- **The same family in the package itself.** `pnpm build` did not empty `dist/`, and the package is published from a developer's disk, so 3.15.0 shipped 922 files whose source had been deleted, back to the MongoDB provider and the Prisma client. `scripts/clean-dist.mjs` now starts the build from nothing and `pnpm check:pack-contents` (run by `prepublishOnly`) refuses a `dist/` file with no tracked source.

## 89. A new storage method file turns `check:deps` red with an import cycle

*Symptoms: a new table's provider method file turns `check:deps` red with an import cycle the eleven method files beside it do not trigger.*

- **The import cycle.** A provider method file that writes `import type { SqliteStorage } from '../index.js'` (or `PostgresKyselyStorage`) creates `index.ts -> methods/x.ts -> index.ts`. Every older method file does exactly that, and dependency-cruiser is right to call it a cycle; those are grandfathered in its known list. A NEW one is not, and `pnpm check:deps` refuses it. **Re-seeding the known list to admit yours forgives all 271 entries at once**, which is a decision to be asked about and never maintenance (CLAUDE.md, ratchets).
- **The fix, and it is better than what it replaces.** These methods only ever touch `this.db`, so say so: `interface HasDb { db: Database.Database }` on SQLite, `interface HasDb { db: Kysely<DB> }` on Postgres, and `this: HasDb` on each method. The arrow then points one way. On Postgres this keeps the ambient transaction intact, because `db` there is a getter that returns the open transaction when one is bound.

## 90. `check:field-reach` can only judge a pairing it can read

- **Moving a shared tool implementation also moves the analyzer's boundary.** After extracting `src/tool-dispatch/`, CodeQL must classify its tool definitions AND follow HTTP helper calls into that directory. Updating only `surfaceOfFile` still loses the cortex and provenance twins. Keep `clientReach` in sync and run the real strict measurement; new exemptions would hide a refactoring regression (2026-09-27).

*Symptoms: a door that had an agent twin since the day it was built is suddenly reported as having none, although nobody touched the door. Or the gate names a tool as the twin of a route that does an unrelated job, and reports fields that tool was never meant to take.*

- **A path the query cannot see matches no route.** A connector or CLI tool is paired with a route by the REST path it CALLS. The query keeps literal text and turns a computed part into `*`, so a template literal `` `/v1/mcp-servers/${id}/call` `` matches `/v1/mcp-servers/:id/call`. But a path that is a ternary, or that a helper function builds (`path(server, '/call')`), is not a literal and not a template, and produces no fact at all. The tool then twins with nothing. On 2026-09-16 a ternary cost both MCP attach doors their twin, including the one that already had one, and a `path()` helper had hidden seven tools on two surfaces since the day they were written.
- **A validator shared by two doors makes them look like twins.** A node MCP tool is paired with a route by a function they both call. A lookup does not count (`isPlumbing` excludes `get`, `list`, `find`, `read`, `require` and the rest), but a validator does. When the operator's policy tool and the attach route both called `normalizeMcpPrice`, the gate decided the policy tool was the attach door's twin, and reported the attach fields it does not take. Routes pair through a validator in about twenty places on the node, some of them genuine (`validateMemoryWrite`), so this is not a rule to change casually.
- **A new `*Record` interface can make a route nobody touched a finding.** The gate's field vocabulary is every property of every interface in `src/` whose name ends in `Record`, less a short list of common names and anything under five letters (`recordFields` in `scripts/inventory/field-reach.ts`). So a new type such as `CatalogRecord` with a field `models` turns `models` into a record field everywhere, and `PUT /v1/calibrator/:id/batches/:batchId`, whose body has its own unrelated `models`, became a `no-twin` finding in the commit that added the model catalogue (edd39e8b3, 2026-09-28). → When the gate names a door you did not touch, check whether your change added a field name to a `*Record` type before you look at the door. Then either rename the field, or answer the finding with an exemption that says why the door has no twin; the exemption belongs to the door, not to your type.
- **A tool NAME the query cannot see pairs nothing either.** The query reads a dispatch definition's `name` as written. The AI-model definitions in `src/tool-dispatch/tool-call-defs-ai-models.ts` took theirs from a spread of the catalog entry (`{ ...def('aimeat_ai_policy_set'), handler }`), so CodeQL saw ten tools with no name and paired none of them. The same audit found two path cases beside §90's ternary and helper: `aimeat_discover` chose its path into a variable before the call, and the connection read built its path in a helper that did not make the call itself. Found 2026-10-05 (secaudit 2026-10, M3, `6cfd66ec5`) when the connector began to run these definitions. Writing the name and the paths out removed three exemptions that were no longer true, and showed two scope pairs the spread had hidden (`aimeat_ai_policy_set` and `aimeat_ai_routing_set`, now on tool-route-scopes' unreviewed list). So a blind spot here hides findings in other gates too, not only in this one.
- **The rule.** Write a tool's REST path as a literal or a template, never behind a helper or a ternary: branch on the whole call, not on the path. Write a dispatch definition's `name` as a literal beside any spread of its catalog entry. Put a check that every door needs INSIDE the service those doors already share, rather than calling it from each door; then no door can skip it, and the doors share only their real job.
- **The tell.** An exemption that says "the twin exists and the measurement cannot see it". That sentence is a claim the gate can check once CodeQL is installed, so check it: delete the exemption and run the gate. Four such exemptions on 2026-09-16 turned out to be one helper function.
- **One hypothesis that was tested and was wrong, so the next person need not.** Every route that failed to pair read the request as `(req.body ?? {}) as T`, which appears 97 times in 47 route files. Removing the `?? {}` from one route and rebuilding the facts changed nothing.

## 98. An AI SDK provider package checks the answer's shape and the model id, and neither shows as an error

*Symptoms: an answer from an Anthropic provider stops mid-sentence at about 4096 tokens with finish reason `length`, and the only trace is a warning line in the console.*

- **`@ai-sdk/anthropic` caps the output of a model id it does not know** (4.0.65, `getModelCapabilities`). An id that contains `claude-` but is not in its table gets 128 000 tokens and is treated as the newest family (temperature is dropped with a warning). An id without `claude-` gets `maxOutputTokens: 4096` when the call gives none. Both arrive only in the call's `warnings`, which the SDK prints to the console; the call itself answers 200. `src/services/ai/gateway.ts` passes `maxOutputTokens: req.maxTokens`, which can be undefined.
- **The rule.** For an Anthropic provider, pass `maxOutputTokens` whenever the model id may be outside the package's table (an Anthropic-compatible server, a model newer than the package), and read `warnings` from the result rather than the console.
- **The tell.** Answers from one provider type that end at a round token count.

## 105. A fixed port for a suite's own node, held by a database connection, on one backend only

*Symptoms: a suite that spawns a second node fails in the nightly sweep with `could not listen on port 41104: EADDRINUSE`, on the Postgres backend only, on some nights and not others, always on the same number, and passes alone.*

- **The case.** e2e-capability-webhook-update started its allowlist node on `41100 + lane port % 100`, and e2e-capabilities on `41000 + …`. Both blocks were chosen to keep the two suites apart. On the Postgres sweeps of 2026-09-30 and 2026-10-02 port 41104 was taken anyway, and no suite names it.
- **The cause.** Linux gives out the local port of every outgoing TCP connection from 32768 to 60999, a Postgres pool socket and an HTTP client alike. The Postgres sweep keeps many connections open to one address, and Linux picks local ports for connections to one address from a starting point derived from that address, so the same numbers come up night after night. A port in that range is free only until a connection takes it. The SQLite sweep opens far fewer connections, which is why it never failed.
- **The first fix was wrong.** Asking the system for a free port (bind port 0, read it, close, start the node on it) lost a race on 2026-10-08: the node boots for seconds after the probe closes, and in that window another suite's stub server got the same number from its own `listen(0)`. The node could not bind, and e2e-capabilities talked to the stub, which answers `{"ok":true}` to everything: "alt node policy: undefined", 200 where 201 and 403 were asserted.
- **The rule.** A node a suite starts for itself listens on a port below 32768, which no system hands out on its own (Linux from 32768, Windows and macOS from 49152): `suitePort(block, BASE)` in `aimeat/test/helpers/free-port.ts`, a block of a hundred per suite plus the lane's last two digits. A fixed number from 32768 up, and a port asked of the system for a process that starts later, are both unsafe.
- **The tell.** `EADDRINUSE` on a number no file names, in one backend's sweep only; or a spawned node's assertions answered by something that is not a node.

## 107. An app's tool list and its data map are keyed by two different names

*Symptoms: a read of a record that sits beside an app (`apps.<x>.datamap`, `apps.<x>.tools`) returns nothing for an app that has one; the code path goes on without it, and nothing logs or fails.*

- **The case.** On 2026-10-02 (`973ecc8e9`) package compose learned to put an app's data map and its tool list into the package. Its first data-map read used `appDataMapKey(filename)`, the same name the tool-list read beside it used, so it asked for `apps.notes.html.datamap`. The map store writes the map under the app id without the extension (`appIdOf` in `services/data-map/data-map-access.ts`), as `apps.notes.datamap`. The read missed, and compose would have shipped every package without its map while the installer (`component-registrar` v1.6.0, 2026-09-14) waited for one. The tool list is the other way round: `services/app-tools-key.ts` puts it under the filename WITH `.html`, as `apps.notes.html.tools`, and moved the old bare-id manifests there on 2026-09-27. Caught only because the new compose case failed first.
- **Why it hides.** Both key builders take one string called `appId`, and each is correct for its own store. A missing record is a real answer in both places (`readAppDataMap` returns null for "no map"), so a wrong key looks the same as an app without a record, and nothing logs or fails. Only a test that starts from an app which HAS the record can tell the two apart.
- **The rule.** Read a record beside an app through its own store's reader, with the name that store's writer uses: `readAppDataMap(storage, owner, filename.replace(/\.html$/i, ''))` for the data map, `appToolsKey(filename)` for the tool list. Never build one of these keys from whatever name is in scope. A test for a code path that reads one of them starts from an app that has the record, and asserts the record arrived.
- **The tell.** A filename ending in `.html` passed to `appDataMapKey`, a bare id passed to `appToolsKey`, or a new `` `apps.${…}.` `` key in a code path that does not import its store's reader.

## 108. A test that READS a generated file is not run when the file changes

*Symptoms: `pnpm gate` is green, main is pushed, and a unit test that has nothing to do with the change is red on the next full `vitest run`.*

- **The case.** On 2026-10-02 kit 0.64.0 added the board family to `sdk-libs/atelier/describe-data.js` (three components with variants, six new per-component tokens). `test/unit/atelier-recipe.test.ts` holds the build-app-atelier spec's customisation section to that file, and it went red: the spec named neither the new variants nor the new token count. The gate's unit step runs `vitest run --changed <merge-base>`, which picks a test by its IMPORT graph, and the recipe test reads `describe-data.js` with `readFileSync`, so it is outside the graph of the file that changed. Four commits were pushed past it; found 2026-10-03 when a whole `test/unit/atelier` run was made for the handbook.
- **The rule.** After a change to a generated registry (`describe-data.js`, the living `describe-data.js`, a library-pack list), run every unit test that names the file, not only the ones the gate picks: `grep -rl "<file name>" aimeat/test/unit` and run those. A spec text that counts or lists what a registry holds (`build-atelier-recipe.ts`) changes in the same commit as the registry.
- **The tell.** `readFileSync(new URL('../../src/…', import.meta.url))` in a test: the gate cannot see what that test depends on.

## 109. A native `<dialog>` takes the text styles of the element it is rendered in

*Symptoms: a dialog opened from a label, a column head or a heading shows its whole text in that label's capitals, letter spacing and colour, although its own sheet sets none of them.*

- **The case.** On 2026-10-03 the help question mark (`components/HelpTip.js`) was put after a Facts row's name, which is a `.poster-label`: uppercase, spaced, coral. The tooltip and the explanation dialog are children of the HelpTip span, and the explanation read as coral capitals. The dialog is the site's Modal on the browser's own `<dialog>` opened with `showModal()`. The top layer changes where a dialog is drawn, not where it sits in the DOM, so it inherits `color`, `font-*`, `letter-spacing`, `text-transform`, `line-height` and `text-align` from its DOM parent like any other element. The SPA has no portal (preact/compat is not loaded), so a dialog is always rendered at the place its component is called.
- **The rule.** A component that renders a dialog or a tooltip inline resets the inherited text styles on its own wrapper to the body's tokens (`help-tip.css` `.help-tip`: `color`, `font-family`, `font-size`, `font-weight`, `line-height`, `letter-spacing`, `text-transform`, `text-align`), and its trigger button sets its own face. Where the caller controls the markup, put the trigger outside the styled element instead: `PageHead` draws its HelpTip after the `<h1>`, not inside it.
- **The tell.** A Modal, a `<dialog>` or a `position: fixed` popover called from inside a label, a `th`, a heading or any element whose class sets `text-transform` or a colour. Open it once in the browser from that place, not from the design lab demo, where it sits in plain body text.

## 119. After a deploy, agents no longer see tools they used yesterday; every test is green

*Symptoms: an agent connected over the node's MCP says a tool does not exist (`aimeat_workspace_read`, `aimeat_workspace_publish`); a test agent with `*` sees it; the suites that broke were fixed by giving their test agents a new scope word.*

- **The case.** The secaudit 2026-10 follow-up (A4, `65d3c5b36`) made each MCP tool ask the scope words its REST route asks. The node MCP registers a tool only when the session holds every word on it (`scopeAllowsTool`), so a new word does not refuse a call, it REMOVES the tool. `organism:read` went onto the workspace read tools, and neither `config.defaultAgentScopes` nor the "standard" consent preset carries it: on aimeat.io every agent approved with them lost workspace read, overview, organism search and export at the deploy. Four E2E suites failed and were fixed by adding the word to their test agents, which is the one fix a real agent never gets. The same shape broke production in changelog 1.33.1. Fixed by `services/tool-scope-words-migration.ts`.
- **The rule.** A word added to a tool's `scope` ships in the same commit as a once-per-node migration that hands the word to the agents approved before it, on positive evidence only (the word they already held that reached the tool), and never a word that opens more than the reach they had (`services/scope-vocabulary-migration.ts` and `tool-scope-words-migration.ts` say which words never go in). Check the default scopes and the consent presets as well: an agent approved tomorrow gets the same lists.
- **The tell.** A test fixed by giving its agent a new scope word. Ask what happens to the agents in production that hold yesterday's words.

## 122. An origin fix is green, and the same code still runs on that origin by another path

*Symptoms: a fix moves app code off an origin (a draft off the app's own address, an app off the main domain) and its tests pass; the code still runs on the old origin when the URL is written another way.*

- **The case.** D2 of the secaudit 2026-10 last items moved a draft's `/?preview=` from the app's own origin to `<sub>--draft.<appHost>`. `GET /v1/apps/:owner/:filename` answers on every host, and it still served the draft by its preview token on the app's own origin, and any other published app inline, so code that was not the origin's app reached that app's silent sign-in. Both were confirmed on aimeat.io. The tests covered only `/?preview=`. Fixed with `appOfRequestOrigin` (services/app-origin-target.ts): on a per-app origin that route runs only the origin's own app.
- **The rule.** For an origin rule, list every route that returns runnable HTML (`grep` for the content types and `mode=inline`), not only the one the fix was written for, and test the refusal on the origin itself with a real Host (`helpers/host-request.ts`).
- **The tell.** A route under `/v1/` that serves HTML and is not mounted per host.
