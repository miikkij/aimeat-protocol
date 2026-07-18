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
15. [Mobile, viewport & on-screen keyboard](#15-mobile-viewport--on-screen-keyboard)

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
- **Replacing an old path with a new one (batched endpoint, DB-service reroute) MUST reproduce the old path's FULL guard chain — middleware AND inline checks.** A refactor that optimises the *data* operation (batched reads/writes, a service layer) is exactly where authorization silently regresses: the guards read as boilerplate, so a new bulk/batched handler is written with `requireAuth() + requireScope()` and the *inline* checks (`requireExternalPrincipal()`, an `existing.archived` read-only 409, a `storage_ref` existence check, `requireScope('memory:delete')`) get dropped because they were one line among many. **Before merging a replacement, diff old-vs-new guard chains line by line** — enumerate the OLD handler's middleware list + every inline `if (…) return 403/409/422` + every per-item guard, and assert the NEW path runs each one. This is not optional polish; a dropped guard on the storage layer is the highest-blast-radius bug in the whole redesign. *(Bit us Phase 1/2 of the data-access redesign 2026-07-15: `/v1/memory/bulk` shipped without `requireExternalPrincipal`, without the archived-record read-only guard, and without `storage_ref` validation; the batched record delete shipped without `requireScope('memory:delete')`. All caught by an after-the-fact audit and fixed — but they should never have shipped.)*
- **Security is FREE in the layered model — do it efficiently, don't skip it.** Authorization splits into two classes and NEITHER needs an extra DB round-trip when done right: (1) **batch-invariant** (principal role/scope, membership, publish gate, per-namespace policy, external-principal) → resolve ONCE per request (in-memory role/scope checks, or one read amortised across the whole batch); (2) **per-item** (reserved-key, anonymous-namespace, same-owner, archived-record, schema-lock) → all resolvable from data the operation ALREADY loaded — the batched existing-row read feeds the reserved-key/anonymous/same-owner/archived checks, the cached schema-lock feeds validation. So the same batched read that makes the DB fast also makes per-item auth ~0 extra queries. The one exception is `storage_ref` file-existence, which needs a `getStorageFile` — gate it to run ONLY for storage_ref entries (a normal write pays nothing), and batch it if bulk storage_refs ever become common. Security and performance ALIGN here; a "we skipped the check for speed" is never justified.
- **On an app origin `AIMEAT.auth.login()` is SILENT-only** — it restores an existing session (via the H-2 SSO bridge) and returns `null` otherwise; it never opens UI. The ONLY interactive sign-in path is the login bar's own click handler (`mountLoginButton`). A hand-rolled "Sign in" button that calls `login()` does nothing when silent SSO fails — a custom button must delegate its click to the bar's button. *(Bit us in PULSE v2.0.1, found by the user on first prod use.)*
- **`*.apps.localhost` is CROSS-SITE with `localhost`** (eTLD+1 `apps.localhost` ≠ `localhost`), so the silent-SSO iframe carries no apex cookie locally and app-origin auto-login fails — while working fine in prod (`*.apps.aimeat.io` is same-site with `aimeat.io`). Local app-origin verification: sign in with `AIMEAT.auth.loginWithPassword(...)` evaluated on the app origin, and don't reload (app-origin `login()` ignores the persisted session — bridge-only by design).
- **App-grant tokens are role `app`, strictly** — they never pass `requireRole('agent')` gates (organism create/join, workspace structure ops), regardless of scopes. Published apps needing server-side rules use an extension (`ext:` namespace + action checks), not organism primitives.

## 7. Storage & multi-backend
*Symptoms: a field that works on SQLite but not Postgres (or vice versa), an upgrade crash-loop, a stale badge on a record.*

- **New data type/field → update BOTH backends** (postgres-kysely + SQLite better-sqlite3) via the `Storage` interface. See `docs/coding-guidelines/storage-sync.md`. (The Prisma backends were removed 2026-07-16 — do not re-add Prisma.)
- **SQLite migrations: add indexes on ALTER-added columns AFTER `safeAddColumn`**, or the upgrade crash-loops.
- **PG jsonb does not preserve key order** — don't rely on `JSON.stringify` equality for dedup across backends.
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
- **Parallel dev servers used to kill each other on `pnpm dev`** (fixed 2026-07-17): `scripts/kill-port.ts` step 2 killed EVERY node process whose command line matched `src/index.ts` — regardless of port — so a worktree server on 40733 died the moment another session ran `pnpm dev` on 40050 (symptom: full clean boot, then a silent `exit 1` with no error). It is now strictly port-scoped (a PID must own a socket on THIS port to be killed). If you see the silent-death symptom again, check who ran an OLD checkout's kill-port.
- **Worktree dev server: set `AIMEAT_PORT` in the SHELL env** (`AIMEAT_PORT=40733 pnpm dev`), not only in a `.env` — kill-port reads `process.env.AIMEAT_PORT` and defaults to 40050, so without the shell var a worktree's `pnpm dev` kill-ports the MAIN session's server on 40050 before your own boots.
- **Worktree installs are per-package:** a root `pnpm install` in a fresh worktree does NOT populate `aimeat/node_modules` — run `cd aimeat && pnpm install` too, or typecheck fails with "Cannot find name 'process'" / missing `node:*` modules, and `pnpm dev` dies on `.env: not found` (copy `.env` from the main checkout as well; it is gitignored).
- **The pre-commit hook runs over the whole working tree** (not just staged files), so your commit passes only if the other session's in-flight code also compiles. If the hook fails on code you didn't write, the other session is mid-edit.

## 14. Environment & tooling (Windows)
*Symptoms: login 500s, a native-DLL EPERM, a hung command.*

- **ABSOLUTE ban on `wsl` / `docker` commands** — ask the user to run infra ops; never touch them yourself.
- **Stop `pnpm dev` before `pnpm install` touching native deps** — a running dev server holds the native DLLs (better-sqlite3) and you get an EPERM on Windows.
- **Login 500s on the dev node** usually mean the WSL docker (the database container) died — ask the user to restart it, then restart `pnpm dev`.
- **`pnpm dev` is not a full watcher** — backend `src/` edits need a restart; `src/static/*` + `public/*` are served fresh on F5.

## 15. Mobile, viewport & on-screen keyboard
*Symptoms: a "mobile-optimized" view still feels cramped, a bottom input hides behind the keyboard, a big dead gap above the keyboard, an overlay that can't cover the app nav.*

Full how-to (the pattern, not just the traps): **`docs/frontend-development-guide.md` → Mobile & Responsive UX**. Reference impl: the Messages tab (`public/views/profile/inbox-tab/`, `public/css/views/inbox.css`).

- **"Mobile-optimized" ≠ stacked columns.** Trimming chrome (hide a header, widen bubbles) is usually NOT enough — the user means a **native full-screen** experience. A focused view (chat/editor/wizard) should take the whole screen (`position: fixed; inset: 0` under `@media (max-width:760px)`, gated on an is-active class) with a Back affordance to return the app. *(Bit us on Messages: incremental CSS left the app shell eating ~half the screen; only the full-screen overlay satisfied.)*
- **A `z-index` overlay does NOT cover the sticky `.topnav`.** The nav sits in a **higher stacking context** (an ancestor of the profile subtree), so a fixed overlay at `z-index:1000` still paints *under* a `z-index:100` nav. **Hide the nav instead** while full-screen: `body:has(.your-fullscreen-class) .topnav { display: none; }` (+ `body:has(...) { overflow: hidden; }` to lock background scroll). z-index wars won't win this.
- **A bottom-pinned input hides behind the on-screen keyboard.** Android Chrome / iOS Safari shrink the *visual* viewport but NOT the *layout* viewport / `100dvh`, and `position:fixed;bottom:0` anchors to the layout viewport → the input ends up under the keyboard. Fix: add **`interactive-widget=resizes-content`** (+`viewport-fit=cover`) to the `spa.html` viewport meta (iOS16+/Android — makes the keyboard resize the layout viewport so `dvh`/fixed-bottom track it), with a **`visualViewport`-measured height** var as the older-engine fallback.
- **Dead gap above the keyboard = double-counting or center-scroll.** Two causes: (1) `calc(100dvh − keyboardHeight)` — with `resizes-content`, `dvh` ALREADY excludes the keyboard, so subtracting it again collapses the pane; use the measured height OR `dvh`, not both. (2) `el.scrollIntoView({ block: 'center' })` on the composer focus — it centers the input and leaves emptiness below; keep the message list pinned to the bottom instead. *(Both bit us; fixed by measuring `body-top → visualViewport-bottom` and dropping the center-scroll.)*
- **Heavy desktop widgets are miserable on a phone.** The Toast UI rich editor (Write/Preview + WYSIWYG toolbar) behind a keyboard is unusable — open a plain auto-growing `<textarea>` on `≤760px` and don't even load Toast UI there (detect once via `matchMedia('(max-width:760px)')` at mount).
- **Verify by shrinking the viewport.** Playwright MCP can't pop a real keyboard, but resizing the viewport height (e.g. 780 → 440 after focusing the input) emulates the layout-viewport shrink; assert the composer bottom ≈ viewport bottom (0 gap) and the thread still scrolls.
- **A fixed-width widget in a flex header overflows portrait → the WHOLE page shrinks to unreadable text.** Android Chrome / mobile Safari do a shrink-to-fit when any element is wider than the layout viewport: the page zooms out so the overflow fits, so EVERY font renders tiny — the symptom reads as "my mobile CSS made the text too small" when the real cause is one un-shrinkable element forcing horizontal overflow. The classic offender is the **golden `aimeat-auth` login pill** (`.aimeat-auth-pill`, `display:inline-flex` with a fixed intrinsic width ~340px) sitting in the header row next to the brand + a lang toggle — the three together exceed a ~390px portrait width. Fixes, together: (1) on mobile fold the lang toggle + `#login` pill out of the header row into a **hamburger dropdown** (`position:absolute` panel toggled by a menu button; the row becomes just brand + button and can't overflow); (2) let the pill wrap inside the panel — `#login .aimeat-auth-pill{display:flex!important;flex-wrap:wrap!important;max-width:100%!important}` (the pill's inline styles need `!important` to override); (3) `body{overflow-x:clip}` as a belt-and-braces guard (**`clip`, not `hidden`** — `hidden` makes body a scroll container and breaks `position:sticky` headers; `clip` doesn't). Verify by measuring `document.documentElement.scrollWidth === clientWidth` at 390px AND at phone-landscape (≈844px) — 0 overflow at both. *(Bit us on the Experience Center app, portrait unreadable + width broken; fixed v0.13.0 / store 1.0.21 — node-hosted, not in the repo.)*
