# AEB-3 base-lib sweep — core SDK + UI cortex on Haiku 4.5 (2026-07-17)

Extending the smoke-proof measurement to the **base libraries** every app leans on (not just the
visual capability packs). Two combined Haiku 4.5 builds — one exercising the core SDK, one the UI
cortex wrappers — plus the realtime re-run against the fixed auth lib.

**Honesty up front:** the build-level results below are real (the apps + build logs exist), but the
**browser verification was blocked by bench instability** — see the process finding at the end.
No `pass` proof was added to the registry for a pack that was not browser-verified.

## Run 1 — core SDK (auth · data · organism · ai · storage · agentface)

The Haiku builder fetched all six ai_docs and wired all six libs with **correct API signatures**
per its build log:
- `AIMEAT.auth.mountLoginButton(elem, { onLogin })` — **correct (element/selector-first)**; used
  the three-path flow (onLogin + login() restore + auth event). (Contrast the realtime run, where a
  different Haiku build called it options-first and crashed — signature reliability is not uniform.)
- `AIMEAT.data.set/get` (private) + `set({visibility:'public'})` / `getPublic` (public round-trip).
- `AIMEAT.organism.create` + `createWorkspace` + `list`.
- `AIMEAT.ai.isAvailable` + `complete({ prompt, app_id })`.
- `AIMEAT.storage.upload(blob,{filename})` + fetch-download.
- agent-face `publish({ title, sections })` + markdown read-back.

**Verdict:** build-level POSITIVE (correct idioms, all six wired) but **not browser-verified** — so
no proof row added. These are `needs-doc` AIMEAT-authored libs; the signal is "a mid-tier model,
having fetched the ai_docs, calls them correctly" — encouraging, pending a runtime pass.

## Run 2 — UI cortex (ui-nav · ui-layout · ui-forms · ui-viewers · ui-dialogs · i18n)

**Finding (the useful one): the model loaded the wrappers but hand-rolled the UI.** Its own build log
is explicit — "cortex libs available but not consumed" for nav/layout/forms/viewers/dialogs; it
rendered a native `<table>` with hand-written sort/filter, native form elements with manual
validation, CSS-overlay modals, and `window.confirm()` instead of `AIMEAT.ui.viewers.DataTable()`,
`AIMEAT.ui.forms.*`, `AIMEAT.ui.dialogs.Modal()`, etc. Only **aimeat-i18n** (init/t/LanguageSwitcher)
and **aimeat-auth/aimeat-data** were genuinely used.

This is a clean `needs-doc` failure mode and doesn't need a browser to see it: **a mid-tier model,
even after fetching the ai_doc, tends to revert to hand-rolling native HTML rather than commit to a
wrapper's component API.** The wrapper's acceleration is only realized if the model actually calls it.
Implication for these packs: their ai_doc should lead with a copy-pasteable *minimal call* ("render a
table: `AIMEAT.ui.viewers.DataTable(el, rows, cols)`") so the path of least resistance is the wrapper,
not `<table>`. (Guidance change — not applied here; propose before editing each cortex.)

Tier impact: the UI cortex packs stay `needs-doc` **unproven** — this run did not demonstrate them
working (they weren't used). i18n was used correctly (a weak positive for i18n specifically).

## Run 3 — realtime re-run (the mountLoginButton fix)

The auth fix (`mountLoginButton` now tolerates options-first + element-first calls, commit fde341ba)
is committed and **confirmed present in the served `/v1/libs/aimeat-auth.js`** on the bench. The
realtime smoke app re-published (HTTP 201) but the browser re-verify was lost to a bench restart
before it could sign in. So the fix is verified at the served-lib level, not yet at app runtime.

## Process finding — the bench needs to be watch-immune for AEB verification

The verification bench was a second `pnpm dev` (tsx-watch) sharing the repo working tree with other
active sessions. Every source edit by ANY session (and the two-servers-one-DB contention when it
shared the dev Postgres) triggered a tsx-watch reload / restart, which repeatedly invalidated auth
tokens and (on the isolated-sqlite fallback) wiped freshly-published apps mid-verify. **Multi-step
browser verification cannot run reliably on a watched, shared-tree dev server.**

Recommendation for future AEB runs (and the `pnpm aeb:prove` flow): run the bench as a **built,
non-watch server** (`pnpm build && pnpm start` with an isolated DB) OR in a **dedicated git worktree**
on its own port, so source edits elsewhere don't restart it. With that, this sweep re-runs cleanly and
its build-level positives convert to browser-verified proofs.

## Net
- No registry `proofs` rows added from this sweep (nothing browser-verified). Integrity over coverage.
- Concrete findings: (a) mid-tier models bypass `needs-doc` UI wrappers by hand-rolling → tighten
  those ai_docs to lead with a minimal call; (b) `mountLoginButton` signature reliability is
  non-uniform across builds (fixed regardless); (c) AEB verification needs a watch-immune bench.
