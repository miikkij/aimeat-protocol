# AEB-3 base-lib sweep — core SDK + UI cortex on Haiku 4.5 (2026-07-17, browser-verified 2026-07-18)

Extending the smoke-proof measurement to the **base libraries** every app leans on. Two combined
Haiku 4.5 builds — one exercising the core SDK, one the UI cortex wrappers — plus the realtime re-run
against the fixed auth lib. **Browser-verified on a stable isolated-worktree bench** (port 40077,
sqlite, watch-immune — see the process note; the first attempt on a shared-tree dev server flapped and
is why an earlier draft of this file said "blocked").

## Run 3 — realtime / the mountLoginButton fix — VERIFIED ✅

The auth fix (commit fde341ba: `AIMEAT.auth.mountLoginButton` tolerates options-first + element-first
calls) is confirmed at runtime. The realtime smoke calls `mountLoginButton({ onLogin })` (options-
first). Before: `Uncaught SyntaxError: '[object Object]' is not a valid selector` → sign-in dead.
After: **0 console errors, a default `#aimeat-auth-bar` container is created, and the login button is
mounted into it.** The exact crash that blocked realtime is gone.

## Run 1 — core SDK — browser-verified, driven directly with a live session

Signed in through the real app-origin grant flow (happyadmin), then exercised each lib directly
(bypassing the app's own buggy status badge — see finding A):

| Lib | Result |
|---|---|
| **aimeat-auth** | ✅ `login()` restores the app-origin session → `happyadmin` |
| **aimeat-data** (private) | ✅ `set(k,v,{visibility:'private'})` + `get` round-trip |
| **aimeat-data** (public) | ✅ `set({visibility:'public'})` + `getPublic(gaii,k)` round-trip |
| **aimeat-ai** | ✅ `isAvailable()` returns `false` (fresh owner has no OpenRouter key — correct) |
| **aimeat-storage** | ✅ `upload(blob,{filename,visibility})` persists → `{key, owner_gaii, size, mime_type, visibility}` |
| **aimeat-organism** | lib CORRECTLY rejects `create()` with `Requires … scopes: [organism:write]` — see finding B |
| agent-face | needs `{app}` context — `publish()` from a bare call can't derive the app filename (finding C) |

**Verdict:** auth/data/ai/storage **pass** on Haiku — proof rows added (`modelTier: needs-doc`, these
are AIMEAT-authored). organism's lib is correct (it enforced the scope); the end-to-end didn't
complete because the *app* under-declared its scopes → no `pass` row for organism from this run.

### Findings (all app-level or doc-level, not lib failures)
- **A — app badge doesn't reflect `login()` restore.** After the grant, `AIMEAT.auth.login()` returns
  `happyadmin`, but the app kept showing "✗ Signed out" and gated its buttons on that stale flag →
  the app looked broken though the session was live. Classic "handle login() on load AND the async
  login event, wire it to your UI" gap (the app claimed to, but didn't). Also: **don't reload the app
  tab after approving the grant** — the app-origin session arrives via postMessage to the *original*
  tab; a reload drops it.
- **B — app under-declared scopes.** The coresdk app requested `memory` + `storage` but NOT
  `organism:write`, so `organism.create()` 403s. The lib is right; the app must declare every scope
  it uses.
- **C — agent-face needs `{app}`.** `publish()` must be told the app filename (`{ app: "…" }`) or find
  it via a `<meta>` tag; it can't derive it from an arbitrary call site.
- **D — storage returns a key-record, not a URL.** `upload()` resolves to `{key, owner_gaii, size,
  mime_type, visibility}` — retrieve by key / `/v1/pub/<gaii>/<key>`, not a `.url` field. Worth making
  loud in the aiDoc (a builder that expects `.url` mishandles the result).

## Run 2 — UI cortex — the needs-doc failure mode, confirmed strongly

All six cortex libs **loaded** (globals `AIMEAT.ui.nav/layout/forms/viewers/dialogs` + `AIMEAT.i18n`
all present — the libs serve + parse fine). But the app used **none of them**:
- Per its own build log, it hand-rolled a native `<table>`, native form elements, CSS-overlay modals
  and `window.confirm()` instead of `AIMEAT.ui.viewers.DataTable()` / `.forms.*` / `.dialogs.Modal()`.
- Even **i18n**, which it claimed to "fully integrate", is broken: the page renders **raw keys**
  ("app_title", "sign_in") and `AIMEAT.i18n.t('app.title')` returns the literal key — `init()` wasn't
  wired / the key namespace mismatches (the silent-raw-key-on-miss trap). Screenshot:
  `scratchpad/smoke-uicortex-rawkeys.jpeg`.

**Verdict:** the UI cortex packs stay `needs-doc` **unproven** — a mid-tier model loaded every wrapper
and then failed to use a single one (hand-rolled the components, mis-wired i18n). This is the cleanest
demonstration yet of the `needs-doc` risk. **Fix: lead each cortex aiDoc with a minimal, copy-pasteable
call** (`AIMEAT.ui.viewers.DataTable(el, rows, cols)`, `AIMEAT.i18n.init({en,fi}); t('key')`) so the
path of least resistance IS the wrapper, not `<table>`. (Per-pack aiDoc change — propose before editing.)

## Process note — the bench must be watch-immune (solved)

The first verification attempt ran a second `pnpm dev` sharing the repo working tree with other active
sessions → their source edits triggered tsx-watch restarts that wiped tokens/apps mid-verify (and two
servers on the shared dev Postgres churned at boot). **Fix that worked:** a dedicated **git worktree**
on its own branch + port (`AIMEAT_PORT=40077` in the shell env so `kill-port` leaves 40050 alone) with
`AIMEAT_STORAGE=sqlite` (isolated DB), per `concurrent-session-worktree-rule`. That bench was stable
end-to-end and left the other session's port-40050 server untouched. Future AEB verification should
always use a worktree bench, never the contested main tree.

## Ledger updates applied
- `aimeat-auth`, `aimeat-data`, `aimeat-ai`, `aimeat-storage` → `needs-doc` + a Haiku `pass` proof.
- `aimeat-organism` → `needs-doc` (lib verified scope-correct; no pass row — e2e blocked by app scope).
- UI cortex packs remain `needs-doc` unproven (loaded but unused). i18n specifically mis-wired here.
