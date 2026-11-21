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

> Related: `CLAUDE.md` (the rules every session holds; `.claude/rules/` has the rules by path), `docs/known_gaps.md` (deferred gaps, developer-approved only), `docs/coding-guidelines/` (the full guides). The gatekeeper agent reads a diff against the five shapes (`.claude/agents/gatekeeper.md`).

## The five shapes

1. **Silent success.** Something answers ok, 200, delivered or true, or logs green, on a path where the work did not happen: a branch that returns normally after skipping, `continue` inside a loop that decides, a catch that returns a plausible value, a parameter accepted and never read, a counter or a filter nobody can see working. *Ask what the caller sees when the work did NOT happen.* §1, 4, 5, 64, 75, 84, 98, 107, 122
2. **A test or a measurement that cannot fail.** A test nobody saw red, a fixture smaller than the limit it tests, a comparison two empty results satisfy, a concurrency test run on sqlite only, a flag tested switched on only, a sweep total read as a regression. *Ask which line of the change turns the test red when it is reverted.* §17, 18, 21, 26, 37, 45, 50, 54, 123, 126
3. **One rule, N doors, and one forgets.** A rule changed in one place while other doors reach the same capability: the REST route, the node MCP tool, the connector MCP tool, the CLI dispatch, an operator door, a second writer of the same record, a second backend. *Grep the capability's name and ask whether every door goes through the changed code.* §3, 7, 44, 58, 81, 124, 128
4. **A name is not a principal.** A comparison or a storage key built from `req.auth.owner`, `sub`, a bare account name, a delivery target or a display identity where the holder or the addressed principal is meant. *Ask what the value holds for an agent, an app grant, a federated session and a namesake.* §6, 43
5. **Parallel sessions and the machine.** A hardcoded port, a probe that binds narrower than the server, a file or a log used as state, a path from the other shell's world, a recursive delete near a link. *Ask what happens when a second session runs the same thing on this machine at the same moment.* §13, 14, 20, 23, 39, 77b

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
| 12 | Fixed it and prod still shows the bug; works in a shell, fails under systemd | · |
| 13 | node_modules emptied under the main checkout; Cannot find module after a rebase | 5 |
| 14 | Login 500s on the dev node, native DLL EPERM on install | 5 |
| 17 | A green suite over a bug that is still there | 2 |
| 18 | Sweep totals swing by hundreds; fails in the sweep, passes alone | 2 |
| 20 | A hook fails on a file you never touched; two writers' edits interleaved in one file | 5 |
| 21 | A revoked token keeps authenticating | 2 |
| 23 | A scratch server writes test data into the developer's dev database | 5 |
| 26 | Signature changed, tests pass comparing two empty results | 2 |
| 27 | Parse error on an innocent SQL line; lint errors on untouched view lines | · |
| 37 | A compare-and-swap test green on sqlite even with the guard deleted | 2 |
| 39 | A correct-looking path gives an empty listing or a 'missing' verdict | 5 |
| 43 | Calls attributed to the wrong agent, always the same one | 4 |
| 44 | limit=1 and no limit return the same; a tool parameter the route never reads | 3 |
| 45 | A fresh token answers 401 right after another node boots | 2 |
| 50 | A gate fails naming something that exists only in a comment | 2 |
| 54 | An audit calls a stored flag unenforced; it was enforced all along | 2 |
| 58 | A nightly workflow runs 0 of 6 steps with everything reporting healthy | 3 |
| 64 | A subscription written through its own door vanishes at the next sync | 1 |
| 70 | A test written from the source expects 403 and gets 404 | · |
| 75 | An operator page shows a plausible 0 that never moves | 1 |
| 77b | pnpm sandbox dies 409 NAME_TAKEN on a fresh worktree | 5 |
| 81 | A Finnish page prints 9/12/2026, 3:11 PM; date copies disagree | 3 |
| 84 | Settings back to defaults after a storage hiccup or a badly timed save | 1 |
| 98 | Anthropic answers stop near 4096 tokens, and `data.warnings` names the cap | 1 |
| 107 | An app's record read beside it comes back empty, though the app has one | 1 |
| 109 | A tooltip opened from a label reads in the label's capitals and colour | · |
| 122 | An origin fix is green, and the same code still runs on that origin by another path | 1 |
| 123 | A sandboxed frame loads none of its own files, and every test sees 200 | 2 |
| 124 | Signed in, and a page, picture, link or stream answers 401 on a signed-in-only node | 3 |
| 126 | A security fix is green everywhere, and something the product is for stopped working | 2 |
| 128 | A search engine reports a page as a duplicate of the same page on another node or account | 3 |
| 130 | A pure `git mv` refactor typechecks, and one route answers 404 or an empty list | · |

---

## 1. Build, bundling & generated files
*Symptoms: "works locally but errors in the built file", a `ReferenceError` for a function that exists, edits that don't take effect.*

- **`ReferenceError: X is not defined` for a function that clearly exists (app-catalog).** The app-catalog is a **modular esbuild build** (`aimeat/src/static/app-catalog/js/*.js` → generated `app-catalog.html`). A function CALLED but not imported from its owning module is **not a build error** — esbuild treats the unknown name as a free global, so it only throws at runtime, on the click. → After editing any module, run a **missing-import audit** (static: "name called here, exported by another module, but not imported/injected/local" — first strip string literals + comments so `window._launcher.X(...)` onclick strings and comment mentions aren't false positives; exclude `.X(` method access) **and** click every interactive path in the browser.
- **An edit seems to have no effect.** Three different reloads: a file under `public/` is served `no-cache` with an ETag, so F5 is enough; a served SDK lib (`src/static/sdk-libs/`) and `app-catalog.html` are BUILT, so they need `pnpm build:sdk` / `pnpm build:app-catalog` first; a backend `src/` change needs a `pnpm dev` restart, because the dev server does not watch it. `pnpm dev` is not a full watcher: the rest of `src/static/*` is served fresh on F5, like `public/*`.

## 2. Routing (Express + SPA)
*Symptoms: 404 on a route that exists, F5 → 404 on a SPA view.*

- **Route ordering matters** — register static routes (`/v1/memory/search`) BEFORE parameterized ones (`/v1/memory/:key`), and literal sub-paths (`/workspace/graph`) before the bare parent.
- A new SPA view goes in both `SPA_PAGE_PATHS` and `spa.html` `ROUTES`; `test/unit/spa-routes-parity.test.ts` holds the two lists equal since 2026-11-21.

## 3. Frontend ↔ backend contract drift
*Symptoms: a form that always 400s.*

- **A backend `required` field silently 400s the forms that don't send it.** → When a route gains a required field, **grep for EVERY client form/service that POSTs there** — there are often several (e.g. the app-catalog publish modal `src/static/app-catalog/js/server-io.js` AND the Profile form `public/views/profile/apps-tab.js` + `public/js/services/apps.js`).

## 4. Frontend rendering, cache & modules
*Symptoms: stale data after an update, an edit that "didn't take" until reload, spacing that collapsed to zero.*

- **A live-update handler that skips its data reload while an input/editor is focused leaves the OPEN view stale while you type.** A common (over-broad) "don't yank scroll mid-typing" guard tests `document.activeElement` (INPUT/TEXTAREA/contentEditable) and skips the whole re-fetch when composing — so the *list* refreshes (unread badge ticks up) but the *open detail view* never shows the incoming data until you send/reopen. Reads as "SSE is broken / not wired" when the wire is fine. → **Never gate the DATA reload on focus.** Always re-fetch on the event; push any "don't move the scroll while typing" concern into the scroll effect instead (suppress the one-time auto-jump when the composer is focused — near-bottom *follow* still applies), so new items render without stealing the caret/scroll. → `inbox-tab.js` + `inbox-tab/use-thread-ux.js`
- **A tab-module edit looks stale** because of the SPA module registry / bfcache — F5 for a fresh load; navigate via `about:blank` to defeat bfcache when verifying.
- A `var(--x)` that nothing defines and that has no fallback is refused by `pnpm check:css-facts` since 2026-11-21 (`--space-N` has no definition on this theme: write `var(--space-3, 0.75rem)`).

## 5. i18n & locales
*Symptoms: a raw key rendered instead of text, a key present in one language only.*

- **`t()` silently returns the raw key on a miss** — if you see `profile.apps.foo` on screen, the key is missing or the path is wrong. Locales mix **flat dotted keys and nested objects**; check the PARSED path, not a grep (a flat `"a.b.c"` and a nested `a:{b:{c}}` look the same to grep but resolve differently). The generator emits flat keys (`"tab.search": "Haku"`), so `t()` must check the flat key before the nested path.
- A key written twice in one file, flat and nested, is refused by `pnpm check:locales` since 2026-11-21 (`duplicateKeys` in `scripts/lib/locale-files.ts`).

## 6. Identity, auth & scopes
*Symptoms: an anon request treated as authed, an app refused a scope it cannot ask for, a requested field silently dropped.*

- **Anonymous requests can carry a truthy shared identity** — an `if (!req.auth)` guard can pass for anon because a shared anon identity is injected. Gate on the real principal / membership, not just presence of `req.auth`.
- **Replacing an old path with a new one (batched endpoint, DB-service reroute) MUST reproduce the old path's FULL guard chain — middleware AND inline checks.** A refactor that optimises the *data* operation (batched reads/writes, a service layer) is exactly where authorization silently regresses: the guards read as boilerplate, so a new bulk/batched handler is written with `requireAuth() + requireScope()` and the *inline* checks (`requireExternalPrincipal()`, an `existing.archived` read-only 409, a `storage_ref` existence check, `requireScope('memory:delete')`) get dropped because they were one line among many. **Before merging a replacement, diff old-vs-new guard chains line by line** — enumerate the OLD handler's middleware list + every inline `if (…) return 403/409/422` + every per-item guard, and assert the NEW path runs each one. This is not optional polish; a dropped guard on the storage layer is the highest-blast-radius bug in the whole redesign.
- **A scope enforced on a route must also be REQUESTABLE by an app**, or no app grant can reach the route. `check:scope-parity` refuses a route word missing from `APP_GRANTABLE_SCOPES` since 2026-11-21 (`app-ungrantable:` entries in `security/scope-parity-exemptions.json` hold the ones present that day). Decide deliberately whether a new scope belongs in `DEFAULT_SCOPES` (spending money and giving away what you sell do not).

## 7. Storage & multi-backend
*Symptoms: a field that works on SQLite but not Postgres (or vice versa), an upgrade crash-loop.*

- **SQLite migrations: add indexes on ALTER-added columns AFTER `safeAddColumn`**, or the upgrade crash-loops. **A column named only in a `WHERE` clause counts**, and so does a column that a guarded table *rebuild* adds rather than an `ALTER`. `CREATE TABLE IF NOT EXISTS` is a no-op against the old table, so block 1 then indexes a column the upgraded database does not have and the node cannot boot: `no such column: <x>`. → `test/unit/sqlite-schema-migration.test.ts`. The sweep is worth repeating whenever an index is added to `schema-tables-*.ts`: for each index, is every column it names present on the OLDEST table shape still in the field?
- **PG jsonb does not preserve key order** — don't rely on `JSON.stringify` equality for dedup across backends.
- **A key-scheme migration must delete by the key it FOUND a row at, never by one recomputed from the row.** The rows a migration exists to clean up are precisely the ones written under the OLD key function, so recomputing gives an address that does not match where they live — the delete silently misses, the sources stay, and their history is counted twice everywhere the store is scanned by prefix. Carry `{ key, value }` out of the scan.
- **"Which record is in force" is the one at the live key, not the newest by `createdAt`.** A merged survivor deliberately inherits the OLDEST creation date of everything it absorbed, so sorting by date makes the stale leftover look canonical — and a repair run then folds already-counted history in a second time. Decide by address, not by timestamp, whenever a record's dates are derived rather than observed.
- **A migration over money must be idempotent BY CONSTRUCTION, and the proof is a second run that moves nothing.** Where a re-run could double a counter, keep the evidence of what was already absorbed (here: the survivor's per-caller breakdown) and skip those sources rather than trusting that the first run finished.
- **A query that picks ONE row among several must say which one, or each backend picks its own.** A `LIMIT 1` or an `executeTakeFirst()` without an `ORDER BY` returns whatever row the engine meets first. That is not defined in SQL, and in practice SQLite and Postgres meet different rows first, so the two providers answer the same call differently and only one of them is wrong. Nothing errors, and a test that creates one candidate passes on both, because with one row every order is the same order. **The rule:** every single-row pick among several candidates states its order, the same order on both providers, and its test makes at least two candidates, so that the wrong order turns it red. Where a newer row replaces an older one, retire the older row at write time too, so the answer does not depend on the read's order at all. When you review a storage method, read its `LIMIT 1` and `executeTakeFirst()` calls next to the other provider's copy of the same method.

## 12. Deploy, release & node-hosted apps
*Symptoms: "I fixed it but prod still shows the bug", a child process that fails only under systemd.*

- **Static node assets (`app-catalog.html`, the `public/` SPA, locales) reach prod only via a NODE redeploy** — there is NO per-file MCP shortcut for them, unlike a published app. A committed fix to these is live on `main` but not on prod until the node is redeployed.
- **A child process under systemd** inherits the unit's `LD_PRELOAD`, `MALLOC_CONF` and `NODE_OPTIONS`: `pnpm check:single-entry` rule `child-env` lists every server-side spawn with the environment it gives, and its message says what the unit does. When something works from your terminal and fails under the unit, diff the environment first (`systemctl show aimeat -p Environment`).

## 13. Concurrency & worktrees
*Symptoms: `node_modules` emptied under the main checkout, a "Cannot find module" after a rebase.*

Every session works in its own worktree (`CLAUDE.md`); the two bullets about sharing one checkout and about the kill-port that killed any node process were history by 2026-09-13 and are gone. What a shared tree costs when it happens anyway is §20. Since 2026-11-21 `kill-port.ts` and `kill-test-servers.ts` read the port from the env file the node starts with when the shell names none (`scripts/lib/env-file-port.ts`), and `kill-port.ts` refuses in a worktree that names no port at all.

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
- **A suite whose server dies at start with an error in a file you are editing loaded a half-written file.** The runner starts each suite's server from `src/` through tsx, so a suite that starts between two edits loads half a change; run it again before concluding anything.

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

- **`AIMEAT_DB` and `AIMEAT_DB_PATH` are CLI FLAG names, and as variables the node reads neither.** `src/index.ts` fills any key the environment lacks from `aimeat/.env`, so an env file naming only those two leaves the developer's `AIMEAT_STORAGE` and `DATABASE_URL` in force. Since 2026-11-21 the node says so at start (`src/config/unknown-env.ts`): a flag name that disagrees with the storage it opened, and any `AIMEAT_*` name the repository never mentions. A warning, so read the start log of a scratch node.
- **A scratch env file needs three lines, and all three matter:** `AIMEAT_STORAGE=sqlite`, `AIMEAT_SQLITE_PATH=<your file>`, and `DATABASE_URL=` (empty — empty counts as present, so the loader skips it rather than filling it from the developer's file). Anything less and you are on somebody else's database or not booting.

## 26. A comparison that two empty results satisfy

*Symptoms: a function gains a required parameter, and the tests still pass, because both sides of an assertion degrade the same way.*

- `tsconfig.json` leaves `test/` out; since 2026-11-21 `pnpm gate` typechecks the test tree against a per-file count that may only shrink (`pnpm check:test-types`, `security/test-types-baseline.json`). A file that already has errors can still hide a new wrong call among them.
- **When a test compares two things the same bug can empty, assert the thing is non-empty as well.** `expect(a).toEqual(b)` is satisfied by `[] === []`, and that is exactly what a shared failure produces (2026-08-26: `defaultLayout(surface)` gained a required `config`, two tests kept the old call, and an empty layout equalled an empty layout).

## 27. A backtick inside a template literal: SQL, and an htm view

*Symptoms: a `.ts` file holding DDL suddenly fails to parse, and the error points at a line of SQL that reads perfectly well. Or `pnpm lint` reports `no-useless-escape` on a `.js` view, on lines nobody touched.*

- **The SQLite schema is SQL inside `db.exec(\`…\`)`, so a backtick anywhere in it ends the template literal.** A comment written the way this project writes comments everywhere else — naming a field as `` `indexOn` `` or `` `instance` `` — closes the string, and everything after it is parsed as TypeScript. On 2026-08-26 this happened twice inside one change, in `schema-tables-4.ts` and then in `schema-tables-3.ts`, both times in a prose comment explaining a column.
- **`tsc` catches it, but the message names the symptom rather than the cause**: `TS1005: ',' expected` on the first line that stops looking like an expression, which can be dozens of lines below the backtick. Search the block for a backtick before reading the reported line.
- **The rule inside a SQL template literal: quote a field name by not quoting it.** Write `the indexOn fields`, not `` the `indexOn` fields ``. The Postgres migrations are plain `.sql` files and have no such constraint, so the same sentence is fine there — which is exactly why it is easy to write once in each and only notice in one.
- **The same rule holds inside every view's `html\`…\`` block, and there the file still parses.** An HTML comment written between two elements is inside the template literal like everything else, so a backtick in its prose ends it early and the rest of the view is parsed as ordinary JavaScript that happens to be valid. On 2026-08-31 one comment in `portal-tab.js` quoting a route as `` `/` `` did exactly this. Nothing failed: `tsc` was clean, the view rendered, and the only trace was `pnpm lint` reporting twenty `no-useless-escape` errors eighty lines below, on a `\{\{config:node_id\}\}` table that had been there for months. **ESLint exempts escapes in a TAGGED template literal, so the errors appear the moment the text stops being tagged** — the rule is reporting the terminated template, not the escapes. Read the lint output as "where did this template end", not as a complaint about the lines it names, and write the comment without backticks.

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

- **The case.** On 2026-09-03 the connector went from one socket per agent to one socket per node. A frame's `agent` field tells the node which identity on the socket made the call, and a frame without it counts as the identity that opened the socket. Two call sites stamped the field; the REST proxy and `/local/subscribe` did not, so every call through them on a fleet was made as the opener: an agent asking for its own task list was refused as another agent, and then served that agent's list. It was right for exactly one identity, the opener, which is the one an operator checks first. Fixed in f4a9348ae: `ch.forward` is set once, when the identity gets its socket, already carrying its stamp (`aimeat/src/cli/connect/mcp/local-server.ts`), and `test/e2e-connect-serve-loopback.ts` drives the proxy for an identity that did not open the socket.
- **The audit class.** A correct rule, and one place of N that did not know it. Same shape as invariant 11's owner-name confusion: the rule was written down and enforced in some doors only. The source comments that point here (the A2A task state, the protected-resource scanner, the agent v2 task model) each found one more door of this kind.
- **The rule.** When a channel, a table or a scanner starts to serve more than one principal, make the principal part of the one function every caller goes through, not a parameter each caller remembers. Then grep every caller of the old path, and test with a principal that is NOT the default one.

## 44. A parameter that is declared, forwarded, and then read by nobody

*Symptoms: a caller hits a size or rate wall and the parameter that exists to make the request smaller changes nothing; `limit=1` and no limit at all return byte-identical responses; the obvious fix looks like a fix and is a no-op. Seen 2026-09-04: `aimeat_memory_list` refused with `TUNNEL_RESPONSE_TOO_LARGE` at every value of `limit`.*

- **Declared on one surface, enforced on none.** `limit` was published on the tool, forwarded by the CLI dispatch as a query string, and `GET /v1/memory` never read `req.query.limit`. `pnpm check:field-reach` now reports a connector or CLI parameter that no handler of its route reads (`unread:` entries in `security/field-reach-exemptions.json`, a list that only shrinks).
- **A wall with no smaller thing to ask for is a blocker, not a limit.** The tunnel refuses a response over `connect_tunnel.max_response_bytes` and that cap is right — one identity's enormous answer sits on a socket sixty-one others are waiting on. What made it fatal is that the caller had no way to comply. Whenever you add a size refusal, name in the same commit what a caller does about it, and check that thing works.
- **Check whether the expensive half is even wanted.** The listing shipped every record's value; the tool reads `key`, `gaii` and `visibility` and prints eighty rows. 25 MB of article bodies crossed a shared socket so that eighty names could be printed, and every byte was discarded on arrival. `?include=meta` had existed since 2026-07-14 and the node's own MCP surface had always answered metadata-only — the connector door was the one out of three that did not.
- **The published schema is the tie-breaker.** `memoryListOutput` says the listing "carries no values (always the case)". One door disagreed with the contract, so aligning it is a fix and not a behaviour change. When two surfaces differ, read what was promised before deciding which one is right.
- **Bound what you hand back; keep telling the truth about how much there is.** `total`, `count` and the quota are computed over everything that matched and only `items` is sliced. Summing the slice would make the Memory tab's "used" figure shrink whenever anything passed a limit, and an agent deciding whether to narrow further would be reading its own limit back.
- **A tool's field the route reads under another spelling or shape is dropped the same way, and the gate cannot see it**: it counts `target_type` and `targetType` as one name, and a list sent where the route reads one comma-separated string as read. Read the route's handler for each field a tool sends.
- **Where the work for a tool exists only in an MCP handler, give it a route that runs the same service function** rather than composing it from generic routes in the client (`POST /v1/appdev/templates`, `GET /v1/organisms/:id/workspace/index`).

## 45. Three nodes in one process share one signing key

*Symptoms: a token that worked a line earlier answers 401 AUTH_REQUIRED, from a live server, with nothing expired and nothing revoked. Every test after a certain point fails the same way, and the point is where a node was booted.*

- **`initNodeKeys` keeps the keypair in module-level variables** (`src/auth/jwt.ts`), so the last in-process boot wins and every token an earlier node issued stops verifying. Since 2026-11-21 a new suite boots through `test/helpers/boot-node.ts`, which re-mints registered tokens after every later boot (`remintAfterLaterBoot`), and `test/unit/boot-node-helper.test.ts` refuses a new file with its own boot. The 32 files that had one that day are listed in `security/boot-node-baseline.json`; the five that boot several nodes (`federation-multinode`, `e2e-federation-book`, `federation-support`, `e2e-federation-visiting`, `e2e-federation-policy`) are safe only while every node boots before the first token is minted.
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
- **The second writer.** A call site that writes the task row through `storage.createAgentTask` instead of `createTask` (services/agent/task-write.ts) inherits none of its fan-out. `pnpm check:single-entry` rule `task-create` lists every such writer with the wake it sends itself, so a new one is a sentence somebody writes. When a dedup and a missing notification meet, the bug stops being intermittent and becomes permanent.


## 64. A prune that selects by key prefix eats whatever else lives under that prefix

*Symptoms: a record written through its own door is gone by the next scheduled cycle, and no log names a delete of it. A subscription survives exactly one sync, so the code that reads subscriptions later in the SAME cycle has never once found one: the feature behind it never runs and never errors.*

- **The case.** Genesis catalogue sync stores a peer's entries under `genesis:{peer}:`, then removes stale ones by listing that prefix and deleting every key the peer no longer lists. Two other things live under the same prefix and are never in the incoming set: the operator's subscription record (`genesis:{peer}:subscriptions`, written by its own PUT) and the cross-genesis memory cache. Both were deleted on every sync, and `syncSubscribedMemory`, which runs later in the same cycle, had therefore never seen a subscription. Found by `e2e-genesis-federation`, fixed 2026-09-08 in `src/services/genesis/sync.ts`.
- **Why it hides.** Every part of it succeeds. The writer writes, the reader reads, the prune prunes, nothing throws, and the record does exist for as long as a manual check right after the PUT would take. Only a test that crosses a sync boundary sees it.
- **The rule.** A prefix is an address space, not an owner. A prune selects the records it owns by something their writer put there deliberately, a tag or a discriminator field, never by "everything under this prefix that I did not just write". When a prefix is shared, say so in a comment at the prune and name the other tenants, because the next person adding one will grep for the prefix and find only the writer.

## 70. A guard behind a fence that already answered is not defence in depth, it is a sentence that lies about the door

*Symptoms: a test written from the source asserts `403` and gets `404`, so the test looks wrong. A coverage report shows an uncovered line inside a handler every suite drives, and nobody can construct the request that reaches it.*

- **What this is not.** It is not an argument against a redundant check at a real boundary. The test is whether an input exists that reaches the branch. An owner-scoped query, a schema validator and a `404` on a missing record each **answer**, and nothing gets past one of them to the guard behind it.
- **The rule.** Before writing a defensive check, name the request that reaches it. If you cannot, delete it or move the fence — the check belongs where the value first arrives, not behind the thing that already refused. When you delete one, record in the suite what used to be asserted and why it could not fire, or the next reader restores it as a missing protection.

## 75. A counter nobody writes reads exactly like a counter at rest, and a page will lead on that zero for months

*Symptoms: a number on an operator page is 0. It is plausibly 0. Nothing is red, nothing is logged, and the code that would increment it is right there and looks fine.*

- **The rule, and it is a test rule.** A counter earns an E2E assertion that it **GROWS**: read it, cause the thing, read it again, assert the second is larger. Presence proves nothing and a fixed value proves less. `test/e2e-metrics.ts` has that assertion; `test/e2e-admin-stats-page.ts` is its twin for `GET /v1/stats`. When you add a counter, add the growth assertion in the same commit, and when you mount a per-request middleware, mount it on the same line as the one already there — `requests_total` and `aimeat_http_requests_total` describing different sets of requests is its own defect.
- **And on the surface: separate an absence from a zero.** The Statistics page reads the period and the node's whole life, and says "nothing has ever written this" rather than drawing 0, because a reader cannot tell the two apart and the page is the only thing that can.

## 77b. `pnpm sandbox` picks a port another session already holds, and then seeds into that session's node

*Symptoms: a first `pnpm sandbox` on a fresh worktree dies with `register sandbox: 409 NAME_TAKEN` on a database that cannot possibly hold an owner yet. `--reset` does it again, and so does an explicitly chosen port.*

- Since 2026-11-21 `.sandbox.json` records the node's public key, and `pnpm sandbox` treats a node with another key on its port as another session's: `--status` no longer says UP for it, and `pnpm sandbox` starts yours on a free port with your own data (`scripts/lib/sandbox-identity.ts`). A state written before that day has no key until its next successful refresh.
- **The environment variable has to reach the script rather than the pnpm shim**, so `$env:AIMEAT_SANDBOX_PORT='40645'; pnpm sandbox --reset` from PowerShell, not an inline `VAR=… pnpm …` in Git Bash, which this setup drops. The same drop makes `AIMEAT_E2E_PORT=… pnpm test:env:init` silently keep the derived port, and so does a run without `--force` in a worktree that already has its env files — check the `AIMEAT_PORT` line in the `.env.test.*` it wrote and put THAT number on your claim, because it is the one your suites will use.
- **The rule.** A free-port probe binds what the server will bind. Anything narrower answers a different question than the one being asked. And when a tool picks a port for you and the data looks like somebody else's, read the pid's command line before deleting anything.

## 81. Deriving the format from the language, and the field that already meant something else

*Symptoms: a Finnish page prints 9/12/2026, 3:11 PM. Or the opposite, and worse: a person picks a date format and the language of their email quietly changes.*

- **The field that made it dangerous.** `GHIIRecord.locale` already existed and reads as the obvious home for "formatting". It is not: `routes/ghii/attach-email.ts` picks the LANGUAGE OF AN OUTGOING EMAIL from it. Hanging formatting on the same column would have meant a person choosing an American date format silently changed the language of their own mail. Three columns, not two: `locale` (words, and email), `region` (how it is written), `timezone` (which clock).
- **The rule.** Language, regional format and time zone are three independent settings; never derive one from another, and never reuse a field that already answers a different question. Absent means "follow the reader's browser", which is a real state and keeps every existing account behaving exactly as it did. And an OFFSET is not a zone: `GMT+2` is refused, because an offset cannot know about summer time.
- **The tell is gated.** A raw `Intl` or `toLocale*String()` call is the ESLint rule `aimeat/no-raw-locale-format`, and a hand decimal comma or a locale tag picked from the language is `pnpm check:single-entry` rule `locale-format`, whose baseline is empty.
- **And the delivery is its own trap, three times over.** The read that fetches the preference ran at `spa.html` boot, BEFORE `AIMEAT.auth.login()` restored the session — so `apiGet` found no session, sent no bearer, and got 401 on every page load. A 401 there is indistinguishable from a signed-out reader, so the answer was "no preference" and every date silently kept the browser's format for the life of the page. **Two rules fall out:** a boot-time read that needs a credential goes after the thing that provides it, and a failed read must not latch — `loaded = true` in the catch meant no later sign-in could ever correct it. And when a setting changes, announce it on the event the app already re-renders on (`aimeat-live-update` here); a private event nobody subscribes to leaves every open tab showing the old format until the reader navigates away and back.

## 84. A read that falls back to defaults, reused to write back, saves the fallback over the real record

*Symptoms: nothing is red. After a storage hiccup, or a save made at the wrong moment, the owner's settings are back to defaults or to how they were an hour ago, and the log holds one warning from a read.*

- **The first case.** `readInboxOrganize()` answered a storage failure with defaults, which is right for drawing the Messages list: every conversation shows, unorganised. The archive and rule writes read through the same function, so a failed read followed by a working write would have saved the defaults over the owner's archive and rules. The `node-mcp-error-flag` unit suite caught it, because the settings tool answered a broken storage with defaults and no error. Fix `194a99821`: `readInboxOrganizeStrict()` throws, every write and both settings doors use it, and only drawing the list keeps the forgiving read.
- **The same shape three more times, in the notification settings (2026-09-13).** The Notifications page loads the record from `GET /v1/notifications/senders`, which read forgivingly, and `PUT` replaces the WHOLE record, so one toggle after a failed load erased every muted sender and the quiet hours. `PUT` kept the digest bookmark from the same forgiving read, so a failed read saved `lastDigestAt: null` and the next digest re-sent what had gone out. And the digest sweep wrote back `{ ...snapshot, lastDigestAt }` using the snapshot it took before sending the email, so a save the owner made while the email went out was undone. That last one needs no storage failure at all, only timing.
- **Why nothing notices.** Every read logs a warning and returns a well-formed record. The write succeeds. The page shows the record it just saved. The loss is only visible to the person who remembers what they had set.
- **The rule.** A read that falls back to defaults is for DECIDING or DISPLAYING, never for writing back. Anything that reads in order to write takes the strict read and lets the failure throw, and it reads immediately before writing, inside a per-owner queue (`utils/serial-by-key.ts`), changing only its own fields on top of what it just read: `updateNotificationSettings(storage, ghii, cur => ({ ...cur, lastDigestAt }))`. A door that feeds an editor refuses (503) rather than serve defaults the editor would save, and the editor refuses to save without a loaded record. When a module has both reads, name them apart (`readX` / `readXStrict`) so a caller has to choose. The browser has the same shape (2026-10-16): a failed `listWorkspaces()` answered `[]` and the next create wrote the organism's registry as that one workspace, so the services in `public/js/services/` carry `…Strict` reads, every whole-record write goes through `readForWrite()` in `/js/load-state.js`, and a page refuses to save a record it did not load.
- **The tell:** a `try { read } catch { return defaults }` whose result later flows into a `setMemory`, or a write built from a record read before an `await` that sends mail, calls a provider or waits on anything slow.

## 98. An AI SDK provider package checks the answer's shape and the model id, and neither shows as an error

*Symptoms: an answer from an Anthropic provider stops mid-sentence at about 4096 tokens with finish reason `length`, and `data.warnings` (or the `[ai] the provider package changed or left out part of the call` log line) names the cap.*

- **`@ai-sdk/anthropic` caps the output of a model id it does not know** (found in 4.0.65, `getModelCapabilities`; the same in 4.0.97, where the function is `getAnthropicModelCapabilities` and an unknown id falls to `resolveRuntimeDefinition`). An id that contains `claude-` but is not in its table gets 128 000 tokens and is treated as the newest family (temperature is dropped with a warning). An id without `claude-` gets `maxOutputTokens: 4096` when the call gives none. The call answers 200. Since 2026-11-21 the gateway's `text()` reads the call's `warnings`, logs them and returns them (`TextResult.warnings`, `data.warnings` on `POST /v1/ai/complete`); `src/services/ai/gateway.ts` still passes `maxOutputTokens: req.maxTokens`, which can be undefined.
- **The rule.** For an Anthropic provider, pass `maxOutputTokens` whenever the model id may be outside the package's table (an Anthropic-compatible server, a model newer than the package).
- **The tell.** Answers from one provider type that end at a round token count.

## 107. An app's tool list and its data map are keyed by two different names

*Symptoms: a read of a record that sits beside an app (`apps.<x>.datamap`, `apps.<x>.tools`) returns nothing for an app that has one; the code path goes on without it, and nothing logs or fails.*

- **The case.** On 2026-10-02 (`973ecc8e9`) package compose learned to put an app's data map and its tool list into the package. Its first data-map read used `appDataMapKey(filename)`, the same name the tool-list read beside it used, so it asked for `apps.notes.html.datamap`. The map store writes the map under the app id without the extension (`appIdOf` in `services/data-map/data-map-access.ts`), as `apps.notes.datamap`. The read missed, and compose would have shipped every package without its map while the installer (`component-registrar` v1.6.0, 2026-09-14) waited for one. The tool list is the other way round: `services/app/tools-key.ts` puts it under the filename WITH `.html`, as `apps.notes.html.tools`, and moved the old bare-id manifests there on 2026-09-27. Caught only because the new compose case failed first.
- **Why it hides.** Both key builders take one string called `appId`, and each is correct for its own store. A missing record is a real answer in both places (`readAppDataMap` returns null for "no map"), so a wrong key looks the same as an app without a record, and nothing logs or fails. Only a test that starts from an app which HAS the record can tell the two apart.
- **The rule.** Read a record beside an app through its own store's reader, with the name that store's writer uses: `readAppDataMap(storage, owner, filename.replace(/\.html$/i, ''))` for the data map, `appToolsKey(filename)` for the tool list. Never build one of these keys from whatever name is in scope. A test for a code path that reads one of them starts from an app that has the record, and asserts the record arrived.
- **The tell.** A filename ending in `.html` passed to `appDataMapKey`, or a bare id passed to `appToolsKey`. A hand-built `` `apps.${…}.tools` `` or `.datamap` key is refused by `pnpm check:single-entry` rule `app-record-key`; the wrong name passed to the right builder is not, which is what this section is still for.

## 109. A popover rendered inline takes the text styles of the element it is rendered in

*Symptoms: a tooltip or popover opened from a label, a column head or a heading shows its text in that label's capitals, letter spacing and colour, although its own sheet sets none of them.*

- **The rule.** The SPA has no portal, so anything rendered where its component is called inherits `color`, `font-*`, `letter-spacing`, `text-transform`, `line-height` and `text-align` from its DOM parent, the top layer included. The shared dialog's root (`dialog.dlg`, `css/components/dialog.css`) sets the body's values itself since 2026-11-21, except `line-height`, which still inherits. A tooltip or `position: fixed` popover of your own resets them on its wrapper, as `help-tip.css` `.help-tip` does, and a trigger sets its own face.

## 122. An origin fix is green, and the same code still runs on that origin by another path

*Symptoms: a fix moves app code off an origin (a draft off the app's own address, an app off the main domain) and its tests pass; the code still runs on the old origin when the URL is written another way.*

- **The case.** D2 of the secaudit 2026-10 last items moved a draft's `/?preview=` from the app's own origin to `<sub>--draft.<appHost>`. `GET /v1/apps/:owner/:filename` answers on every host, and it still served the draft by its preview token on the app's own origin, and any other published app inline, so code that was not the origin's app reached that app's silent sign-in. Both were confirmed on aimeat.io. The tests covered only `/?preview=`. Fixed with `appOfRequestOrigin` (services/app/origin-target.ts): on a per-app origin that route runs only the origin's own app.
- **The rule.** For an origin rule, list every route that returns runnable HTML (`grep` for the content types and `mode=inline`), not only the one the fix was written for, and test the refusal on the origin itself with a real Host (`helpers/host-request.ts`).
- **The tell.** A route under `/v1/` that serves HTML and is not mounted per host.

## 123. A sandboxed frame loads none of its own files, and every test sees 200

*Symptoms: a document in a frame without its own origin shows its markup and nothing it loads: no picture, stylesheet, script or font. The browser console says `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`. Every E2E test of the same files answers 200.*

- **The case.** The page host (`aimeat/src/routes/page-host.ts`, `common()`) sent `Cross-Origin-Resource-Policy: same-origin` on every response, a page's own files included. A page runs under the CSP `sandbox allow-scripts allow-forms allow-modals` (`pageFrameCsp` in `aimeat/src/services/html-page.ts`), so its origin is opaque, and no response is same-origin to an opaque origin, not even one from the host that served the page. On aimeat.io every HTML page lost every file it loaded. `aimeat/test/e2e-html-pages.ts` asked for the files from Node, which applies no CORP, and saw 200; the earlier browser check of the frame loaded no page file. Fixed in 32b50a091: a page file answers CORP `cross-origin` and `Access-Control-Allow-Origin: *` (a font loads in cors mode, the opaque origin sends `Origin: null`, and the request carries no credentials).
- **The rule.** A response that a document without its own origin loads carries CORP `cross-origin` or no CORP header, and a font or a `fetch` also needs CORS that admits `Origin: null`. The node has more such frames than the page host: the `sandbox` frames without `allow-same-origin` in `aimeat/public/views/portfolio.js`, `aimeat/public/views/portfolio/builder.js`, `aimeat/public/components/PagePreview.js`, `aimeat/public/views/appcat/viewer.js` and the app catalog's `#app-iframe` (`aimeat/src/static/app-catalog/_template.html`). They load from routes that send no CORP today, or `cross-origin` (`/v1/pub` in `aimeat/src/routes/storage-files.ts`), so a header hardening that adds CORP `same-origin` to every response (helmet's default) breaks all of them at once. Check that the files load in a real browser inside the real frame, and assert the headers in the suite, because a status check cannot see the block.
- **The tell.** A test of a file that a sandboxed frame loads, which asserts the status and no header.

## 124. Signed in, and a page, picture, link or stream answers 401 on a signed-in-only node

*Symptoms: on a node set to `visibility.content_access: signed-in`, a person who IS signed in presses Open, follows a link to a `.md` page, looks at an app screenshot, waits for a live update or connects a mail account, and gets a raw `401 SIGN_IN_REQUIRED`, an empty list or nothing. Every E2E test is green.*

- **The case.** The SPA keeps the session in localStorage, so it travels only on a script's request that adds `Authorization` itself. A new tab, an `<a href>`, an `<img>`, an `EventSource` and a provider's redirect carry no credential, and neither does a plain `fetch()` that a view or an SDK lib makes for what is public on an open node. The content access gate (`aimeat/src/middleware/content-access-gate.ts`) refuses all of them before the route runs. On 2026-10-19 that broke, for signed-in people on orgnode.example: every app's Open (fixed 44a99e8e4), the app origin's libraries (b2eca5631), the store, front page, help, glossary and transparency reads, the live stream, the node's own linked documents, the mail connect callback and app screenshots (972e2fc8a), and an app's config and WebMCP tools (f1296fe43). The suites sent a Bearer token on every request, so none of them could see it.
- **The rule.** On a signed-in-only node, a request the browser makes on its own gets one of three answers, and the change names which: a navigation goes to a page that holds the session (`/v1/app-open`, the sign-in page); a subresource or a script read carries a credential the node accepts (the session through `aimeat/public/js/closed-node-fetch.js`, `aimeat/public/js/session-src.js` or `aimeat/src/static/sdk-libs/_core/public-fetch.js`, a single-use ticket, a presigned address, a grant cookie); or the route goes on `OPEN_ROUTES` because it holds no content, with its reason. A new plain `fetch('/v1/…')` or `<img src="/v1/…">` under `public/` is refused by `pnpm check:single-entry` rule `closed-node-fetch` (the existing ones are its baseline); an SDK lib under `src/static/` is not read by it.
- **The tell.** A test of a closed node that sends `Authorization` on every request. Send what a browser sends (no Authorization, a browser `Accept`), as `aimeat/test/e2e-content-access-browser.ts` does, and walk the screens with `aimeat/scripts/check-signed-in-browser.mjs` in both modes.

## 126. A security fix is green on both backends, and a designed use is gone

*Symptoms: every suite passes and every new refusal test failed first against the old code, and then a person or a review finds that something the product is built to do no longer works: a shared extension cannot use the caller's own key, the owner's chat AI or app fails on first use, an already-published app gets 403, an anonymous landing page loses a popup, old schedules stop firing.*

- **Where it lives now.** The rule is invariant 20 of `docs/coding-guidelines/security-development-dna.md` (a fix makes a use safe and never removes it), the review that finds a lost use is `.claude/skills/security-audit/AIMEAT-PURPOSE.md`, and `pnpm gate` runs the purpose tier (`pnpm test:e2e:purpose:*`) wherever it runs the guard tier. A use with no purpose suite is still found only by that review. The tell: a fix whose only new tests are refusals.

## 128. A page every node serves with the same text is a duplicate across nodes, and a canonical link to itself makes it compete

*Symptoms: Search Console reports "Duplicate, Google chose different canonical than user" for a page on a second node (`store.aimeat.io/v1/how-an-app-builds`) or for one of two pages with the same title on one node (`/v1/dataset/<a>/agentscan-corpus` and `/v1/dataset/<b>/agentscan-corpus`). Every page validates, answers 200 and names itself as canonical, and each node's sitemap lists it.*

- **The case.** The public-page registry (`aimeat/src/data/public-pages.ts`) ships with the software, so every node serves the same sixteen pages under its own address and lists them in its own sitemap. store.aimeat.io runs beside aimeat.io and repeated them word for word; Google picked aimeat.io and reported the store's copies (2026-11-09, TARGET-094). On one node, the AGENTSCAN app had published one fixed title and description from two accounts, and the dataset page sent a crawler only that title and description, no body: two different tables (5 and 24 rows) read as one page. The 301 that sends an apex page on an app host to the apex (`aimeat/src/middleware/apex-page-redirect.ts`) does not fit across nodes, because the copy is the second node's own working screen (its sign-in, its API docs, its help) and a person there must stay there.
- **The rule.** A node beside a main node sets `seo.primary_node_url`; the pages about the software then name the main node's address as canonical (`canonicalPageUrl`) and leave this node's sitemap and IndexNow notices (`indexedPages`). A registry page that shows the node's own content carries `ownContent: true` and keeps its address. A built page says what tells it from its namesakes in the HTML as sent (the dataset page: publisher in the title, rows, columns and date in a crawler body, `services/datapackage/landing-page.ts`), and a page whose content is a byte copy of another names the original (`services/datapackage/copy-origin.ts`).
- **The tell.** A new kind of built page whose title and description come from a template or an app: ask what two instances with the same name send a crawler, and whether that text differs. A registry page cannot be left unmarked since 2026-11-21: `ownContent` is required on `PUBLIC_PAGES` (`RegistryPage`).

## 130. A file moved one folder deeper still loads, and a path it builds from its own folder now points elsewhere

*Symptoms: a pure `git mv` refactor typechecks, every import resolves, the line-by-line diff shows only import paths, and one route answers 404 or an empty list for something on disk.*

- **The case.** On 2026-11-13 a refactor moved `routes/admin-extensions.ts` to `routes/admin/extensions.ts`. The file finds `docs/extensions` with `join(__dirname, '..', '..', '..', 'docs', 'extensions')`, so one folder deeper the same line named a different folder. Nine assertions of `e2e-admin-doors` failed; the fix was one more `..` on each of two lines (dev tree and built tree). No diff review could see it, because the line did not change, its meaning did.
- **The rule.** Before a move lands, grep every moved file for `__dirname|import.meta.url|fileURLToPath|createRequire` and check each hit for both the source tree (`src/…`) and the built tree (`dist/src/…`). About 51 files under `aimeat/src` built a path this way on 2026-11-15.
- **The tell.** A move commit whose only non-import changes are path strings, and a suite that reads a folder on disk going red in an area nobody edited.
