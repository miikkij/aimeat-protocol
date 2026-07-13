# Pitfalls — "when something breaks badly, look here first"

A running catalogue of traps we've actually hit, so we don't hit them twice. **Organised by the KIND of problem** (what it relates to), not by product area — when something goes wrong, jump to the category that matches the *symptom* and scan.

**How to use:** Ctrl-F the symptom, or scan the category that fits. **How to grow it:** when a bug turns out to be a repeatable trap (not a one-off), add a one-line entry under the right category — symptom first, then cause → fix. Keep entries short and scannable; link the commit/file. This is a living doc; it's fine for a category to be thin.

> Related: `CLAUDE.md` (mandatory rules + architecture), `docs/known_gaps.md` (deferred gaps — developer-approved only, Rule 9), `docs/coding-guidelines/` (the full guides).

## Categories

1. [Build, bundling & generated files](#1-build-bundling--generated-files)
2. [Routing (Express + SPA)](#2-routing-express--spa)
3. [Frontend ↔ backend contract drift](#3-frontend--backend-contract-drift)
4. [Frontend rendering, cache & modules](#4-frontend-rendering-cache--modules)
5. [i18n & locales](#5-i18n--locales)
6. [Identity, auth & scopes](#6-identity-auth--scopes)
7. [Storage & multi-backend](#7-storage--multi-backend)
8. [Extensions / Cortex / Memory namespaces](#8-extensions--cortex--memory-namespaces)
9. [AI / LLM calls](#9-ai--llm-calls)
10. [Crypto & signatures](#10-crypto--signatures)
11. [Organisms & workspaces (LOOM / MACHINE ROOM)](#11-organisms--workspaces-loom--machine-room)
12. [Deploy, release & node-hosted apps](#12-deploy-release--node-hosted-apps)
13. [Concurrency & shared checkout](#13-concurrency--shared-checkout)
14. [Environment & tooling (Windows)](#14-environment--tooling-windows)

---

## 1. Build, bundling & generated files
*Symptoms: "works locally but errors in the built file", a `ReferenceError` for a function that exists, edits that don't take effect.*

- **`ReferenceError: X is not defined` for a function that clearly exists (app-catalog).** The app-catalog is a **modular esbuild build** (`aimeat/src/static/app-catalog/js/*.js` → generated `app-catalog.html`). A function CALLED but not imported from its owning module is **not a build error** — esbuild treats the unknown name as a free global, so it only throws at runtime, on the click. *(Bit us: `apps-io.js` called `getCortexOwnerToken` without importing from `cortex.js`; `+ → Add app` threw. Fixed `bb3946d0`.)* → After editing any module, run a **missing-import audit** (static: "name called here, exported by another module, but not imported/injected/local" — first strip string literals + comments so `window._launcher.X(...)` onclick strings and comment mentions aren't false positives; exclude `.X(` method access) **and** click every interactive path in the browser.
- **`app-catalog.html` is GENERATED — never edit it directly.** Edit the sources under `aimeat/src/static/app-catalog/`, then `pnpm build:app-catalog`. A freshness gate (`check:app-catalog`) in the pre-commit hook + CI fails if the built file is stale.
- **New shared `/js` module → add it to the importmap** in `public/spa.html` (identity entry `"/js/services/foo.js": "/js/services/foo.js"`), or `check:importmap` fails and it 404s at runtime. Relative imports, bare specifiers, and CSS need no entry. `portal.ts` stamps `?v=BUILD_ID`.
- **Public JS edits seem to have no effect.** `pnpm dev` is NOT a watcher for everything — `BUILD_ID` cache-busting means a public JS change needs a `pnpm dev` restart; `src/static/*` + `public/*` are served fresh on F5, but backend `src/` edits need a restart.
- **TWO separate app-building prompt systems — never confuse them.** (1) The SPA **service generator** (`public/js/services/generator-prompts-*.js`, ~215 KB) produces full ext+cortex+app SERVICE stacks through the portal's generator pipeline. (2) The **app-catalog "Create new app"** prompt builds single-file HTML apps; its canonical text is NODE-SERVED at `GET /v1/prompts/build-app` (source `src/services/build-app-prompt.ts` — the single source of truth; `src/static/app-catalog/js/cortex.js` keeps only an offline fallback that may lag). Agent-facing discovery: `/llms.txt` + the bootstrap `app_building` block point to the build prompt + `/v1/app-templates`. When improving app-building guidance, edit the NODE service, not the catalog fallback.

## 2. Routing (Express + SPA)
*Symptoms: 404 on a route that exists, a param that's an array, F5 → 404 on a SPA view.*

- **Express 5 params are `string | string[]`** — `req.params.foo as string`.
- **Route ordering matters** — register static routes (`/v1/memory/search`) BEFORE parameterized ones (`/v1/memory/:key`), and literal sub-paths (`/workspace/graph`) before the bare parent.
- **New SPA view F5 → 404:** register it in BOTH `portal.ts` `spaRoutes` AND `spa.html` `ROUTES`, or a hard refresh 404s (client route exists but the server doesn't know to serve the SPA shell).

## 3. Frontend ↔ backend contract drift
*Symptoms: a form that always 400s, a client reading the wrong response shape, an undocumented route.*

- **A backend `required` field silently 400s the forms that don't send it.** *(Bit us: `POST /v1/apps` requires `description` for a new app since apps.ts v1.7.0; the Profile SPA `AppUploadForm` never sent one → every upload 400'd. Fixed `a0b03c96`.)* → When a route gains a required field, **grep for EVERY client form/service that POSTs there** — there are often several (e.g. the app-catalog publish modal `src/static/app-catalog/js/server-io.js` AND the Profile form `public/views/profile/apps-tab.js` + `public/js/services/apps.js`).
- **Response envelope:** every response is `success()` / `error()` from `src/middleware/envelope.ts`; clients read `resp.data`. Don't hand-roll response shapes.
- **OpenAPI drift:** add/modify/remove a route in `openapi.yaml` in the SAME commit (Rule 3), then `pnpm generate:types`. Hook/CI don't gate openapi sync, so it's easy to forget — grep the spec for the route after adding it.

## 4. Frontend rendering, cache & modules
*Symptoms: stale data after an update, an edit that "didn't take" until reload, an empty panel read as broken.*

- **Tabs showing server data must re-fetch on the `aimeat-live-update` window event** (except static-data, pure-nav, push-pref tabs). Missing this = the tab shows stale data after an SSE update. Subscribe/unsubscribe in a `useEffect`.
- **A tab-module edit looks stale** because of the SPA module registry / bfcache — F5 for a fresh load; navigate via `about:blank` to defeat bfcache when verifying.
- **Empty panels read as "broken" to users** — prefer always-populated counters/empty-states over a blank region.
- **`buildComponentPrompt()` is async** — every call site must `await` it.
- **Platform UI API shapes:** `Tabs` uses `onChange` (not `onSelect`); `DataTable` has no `onRowClick`; `Input`/`Select` return `{el, getValue()}`.

## 5. i18n & locales
*Symptoms: a raw key rendered instead of text, a key present in one language only.*

- **`en.json` + `fi.json` are updated together** (Rule 4) — never add a key to one only. If unsure of the Finnish, use the English with a `[TODO:fi]` prefix.
- **`t()` silently returns the raw key on a miss** — if you see `profile.apps.foo` on screen, the key is missing or the path is wrong. Locales mix **flat dotted keys and nested objects**; check the PARSED path, not a grep (a flat `"a.b.c"` and a nested `a:{b:{c}}` look the same to grep but resolve differently). The generator emits flat keys (`"tab.search": "Haku"`), so `t()` must check the flat key before the nested path.

## 6. Identity, auth & scopes
*Symptoms: owner data "disappears" from lists, a cross-owner leak, an anon request treated as authed.*

- **Always `resolveIdentity(req.auth!, config.nodeId)` — never raw `req.auth!.sub`** — for any route storing/retrieving by identity. Owner sessions: the bare name must become the GHII (`alice` → `alice@node-id`), or owner data is written under the bare `alice` and goes invisible to list/search/update. Compare ownership against `resolve(req)`, never `req.auth!.sub`.
- **GHII (`owner@node`) vs GAII (`agent#owner@node`) — never confuse them.** The human owns everything (morsels, profile); the agent has scoped permissions. Morsels live only on `GHIIRecord.morselBalance`.
- **Anonymous requests can carry a truthy shared identity** — an `if (!req.auth)` guard can pass for anon because a shared anon identity is injected. Gate on the real principal / membership, not just presence of `req.auth`.
- **New identity-touching feature → ship cross-owner and cross-scope "→403" E2E tests** (Rule 1 + Rule 10).
- **On an app origin `AIMEAT.auth.login()` is SILENT-only** — it restores an existing session (via the H-2 SSO bridge) and returns `null` otherwise; it never opens UI. The ONLY interactive sign-in path is the login bar's own click handler (`mountLoginButton`). A hand-rolled "Sign in" button that calls `login()` does nothing when silent SSO fails — a custom button must delegate its click to the bar's button. *(Bit us in PULSE v2.0.1, found by the user on first prod use.)*
- **`*.apps.localhost` is CROSS-SITE with `localhost`** (eTLD+1 `apps.localhost` ≠ `localhost`), so the silent-SSO iframe carries no apex cookie locally and app-origin auto-login fails — while working fine in prod (`*.apps.aimeat.io` is same-site with `aimeat.io`). Local app-origin verification: sign in with `AIMEAT.auth.loginWithPassword(...)` evaluated on the app origin, and don't reload (app-origin `login()` ignores the persisted session — bridge-only by design).
- **App-grant tokens are role `app`, strictly** — they never pass `requireRole('agent')` gates (organism create/join, workspace structure ops), regardless of scopes. Published apps needing server-side rules use an extension (`ext:` namespace + action checks), not organism primitives.

## 7. Storage & multi-backend
*Symptoms: a field that works on SQLite but not Mongo, an upgrade crash-loop, a stale badge on a record.*

- **New data type/field → update ALL backends** (SQLite better-sqlite3 + MongoDB Prisma) via the `Storage` interface. See `docs/coding-guidelines/storage-sync.md`.
- **SQLite migrations: add indexes on ALTER-added columns AFTER `safeAddColumn`**, or the upgrade crash-loops.
- **Prisma is pinned** (`prisma` + `@prisma/client` must match; do not bump to 7.x on a whim — verify the current pin in `aimeat/package.json`).
- **Record owner-forks → stale badge:** the same key can fork into duplicate-owner copies (a GHII `.latest` vs a legacy agent GAII `.latest`); read paths must keep the freshest, or a stale lower-version copy surfaces.

## 8. Extensions / Cortex / Memory namespaces
*Symptoms: an ext call 404s, `resp.json is not a function`, a cortex install rejected, translations not found.*

- **Three namespaces, never confuse them:** Owner (`owner@node`, user-written, auth-read) · Extension (`ext:{name}`, only the ext writes, anyone reads). The extension is sovereign; cortex trusts the ext API; the app trusts cortex — no layer bypasses the one below.
- **callExt path is `/v1/ext/name/action`** — NOT `/v1/extensions/name/actions/action`.
- **`session.fetch` returns PARSED JSON** — use `resp.data`; do NOT call `resp.json()`.
- **Cortex register API is `{ libs: { "file.js": code } }`** — not `{ lib: {...} }`.
- **Cortex re-activate = deactivate first, then activate.**
- **Extension manifests are strict:** identity fields live under `metadata:` (`name/version/description/author` all required) and EVERY action needs `id` + `method` + `path` + `script` — a missing `method`/`path` fails the whole install. Cortex manifests are k8s-style: `apiVersion: cortex.aimeat.org/v1`, `kind: Extension`, `metadata.name` + `metadata.namespace`, libs as `spec.components` `type: lib` entries (with `exports` + `api_surface`, or agents can't discover the lib). Copy the examples from `docs/guides/building-extension-cortex-app-stack.md` (fixed 2026-07-13) — older guide copies drift.
- **Translations + settings are USER data** — cortex reads them via `AIMEAT.data.get('service.i18n.fi')`, NEVER via `getPublic('ext:...')`.

## 9. AI / LLM calls
*Symptoms: truncated completions, a non-English prompt in code, a long call timing out.*

- **Never set `max_tokens`** on an LLM call — remove it on sight.
- **Prompts in code are always English** — the AI converses in the user's language, but the prompt strings are English.
- **Long AI calls use `api(path, { timeoutMs: 1_800_000, retries: 0 })`, not `apiPost`** — `apiPost`'s default timeout/retries will abort or double-fire a long completion.

## 10. Crypto & signatures
*Symptoms: a sync sign/verify throws about `ed.etc`, a signature mismatch.*

- **Ed25519 sync hash (@noble/ed25519 v3.1+):** for SYNC ops set `ed.hashes.sha512 = (m) => …` via `node:crypto`. `ed.etc.sha512Sync`/`concatBytes` were removed and `ed.etc` is frozen. Production uses async (`signAsync`/`verifyAsync`) and needs no hook — only test harnesses set the sync hook.

## 11. Organisms & workspaces (LOOM / MACHINE ROOM)
*Symptoms: a publish refused, a `409 WRITE_CONFLICT`, a red "ei saatavilla" ref chip, permanent orthography mistakes.*

- **Append-only namespaces refuse a publish over an existing id** (`room.target_event`, `room.release`) — use a fresh id every time. `room.target` / `room.card` are updatable but **require `expected_version`** (read `_version` first); a `409 WRITE_CONFLICT` means STOP, re-read, don't clobber.
- **State transitions belong to the operator** (dir-target-writes) — agents record CLAIMED / PROGRESS / REQ_DONE events (state field lags; even an actively-built target stays at its pre-work state); the human flips the lifecycle (notably → WOVEN). Only transition state on the operator's explicit in-session command.
- **A referenced doc renders as a red "ei saatavilla" chip** unless it resolves from one of three places: MACHINE ROOM `room.design`, a librarian full-text search, or the dev organism's Development workspace. Mirror any externally-authored doc (e.g. a DESIGN STUDIO session doc) into `room.design` with the SAME id before/when publishing the target.
- **Write proper Finnish (ä/ö), UTF-8** — append-only namespaces make orthography mistakes permanent.

## 12. Deploy, release & node-hosted apps
*Symptoms: "I fixed it but prod still shows the bug", an app's source not in the repo, an accidental release.*

- **The MACHINE ROOM apps (LOOM / M-ROOM / DROP / PRESS / AGENCY …) are node-hosted, NOT in the repo.** To change one: `aimeat_app_get` to fetch its source, edit locally, republish via `aimeat_app_publish` **upload mode** (omit content → get `upload_url` → PUT the raw HTML). Keep the old download for rollback; syntax-check the inline JS before republishing.
- **Static node assets (`app-catalog.html`, the `public/` SPA, locales) reach prod only via a NODE redeploy** — there is NO per-file MCP shortcut for them (unlike the node-hosted apps above). A committed fix to these is live on `main` but not on prod until the node is redeployed.
- **Release discipline:** never push release tags / trigger CI builds / cut releases on your own initiative — commit to `main` freely, but stage releases and let the developer ship. Node = manual `gh release`; the Python package = tag-triggered PyPI. Don't bump `openapi` version for a release.
- **Never assume "not deployed"** — verify prod deploy state (`curl https://aimeat.io/v1/build`, grep a live asset) before claiming something is or isn't shipped.

## 13. Concurrency & shared checkout
*Symptoms: another session's files show up in your `git status`, a commit that absorbs unrelated work.*

- **Two Claude sessions can share one working tree.** Before committing, check `git status`/`git log`. Stage ONLY your files explicitly — **never `git add -A`**. For a file BOTH sessions touch (common collision points: `openapi.yaml`, `test/run-e2e-ci.ts`), stage just your hunk with `git apply --cached` (forward-apply your extracted hunk against a clean base, or stage-all then reverse-apply theirs) — do not absorb their in-flight lines.
- **The pre-commit hook runs over the whole working tree** (not just staged files), so your commit passes only if the other session's in-flight code also compiles. If the hook fails on code you didn't write, the other session is mid-edit.

## 14. Environment & tooling (Windows)
*Symptoms: login 500s, a Mongo/Prisma EPERM, a hung command.*

- **ABSOLUTE ban on `wsl` / `docker` commands** — ask the user to run infra ops; never touch them yourself.
- **Stop `pnpm dev` before a MongoDB E2E run or `prisma generate`** — a running dev server holds the native DLLs and you get an EPERM on Windows.
- **Login 500s on the dev node** usually mean the WSL docker (Mongo) died — ask the user to restart it, then restart `pnpm dev`.
- **`pnpm dev` is not a full watcher** — backend `src/` edits need a restart; `src/static/*` + `public/*` are served fresh on F5.
