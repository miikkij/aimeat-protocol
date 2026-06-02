# Handoff Brief — AIMEAT Frontend Component Unification

> **How to use this file:** Paste this whole document as the opening prompt to a
> fresh Claude Code session running in the `aimeat-protocol` repo. It is a
> self-contained mission brief. Do the work as a dedicated, phased effort — one
> component per commit, each browser-verified — so the duplication becomes one
> clean source of truth instead of spaghetti.

---

## 0. Mission

The frontend has the same UI primitives re-implemented **2–3 times** across three
places:

- `aimeat/public/components/` — the intended canonical design-system primitives
- `aimeat/public/views/profile/shared.js` — profile-local re-implementations
- `aimeat/public/views/admin/shared.js` — admin-local re-implementations

**Goal:** collapse each duplicated primitive into ONE canonical implementation in
`aimeat/public/components/` (exported from `components/index.js`), migrate every
call site, and delete the duplicates. After this, `profile/shared.js` and
`admin/shared.js` should contain **only domain-specific helpers**, not generic
primitives.

This is **structural/DRY work only** — the dark/light theming is already complete
(see §6), so every component already consumes `theme.css` tokens. **The refactor
must NOT change appearance** — it only removes duplication and unifies APIs. That
makes visual regression the main risk, so changes are small, per-component, and
each is verified by driving a real browser.

## 1. Why this is a dedicated effort (scope evidence)

Measured in the repo (2026-06-02):

- These primitives touch **~46 files / ~150 call sites**.
- **Two incompatible Toast APIs** exist (object vs 4-tuple) → unifying requires an
  **API rewrite across 17 admin tab files** (this is the hard part — do it last).
- Spinner / ErrorBox / GlassCard appear across **~29 files**.
- The frontend `.spec.ts` Playwright suite is **unreliable and must not be used**
  (per CLAUDE.md Rule 1b) — verification = driving Chrome via the Playwright MCP
  server. So you cannot lean on automated tests; keep each phase small and
  browser-verify it.

## 2. Current state — exact APIs & locations

### 2a. Spinner — 3 implementations
| Location | API | Markup |
|---|---|---|
| `components/Spinner.js` (canonical) | `Spinner({text})` | inline `<span class="spinner">` + optional `<span class="loading-text">` |
| `views/profile/shared.js` (~L15) | `Spinner({text})` | same, defaults `text` to `t('profile.loading')` |
| `views/admin/shared.js` (~L74) | `Spinner({text})` | block: `<div class="empty"><div class="spinner"></div> ${text||'Loading...'}</div>` — hardcoded English default (Rule 4/7.8 violation) |

All render the themed `.spinner` class; only the wrapper/defaults differ. Decide a
canonical API that supports both inline and block use (e.g. a `block` prop), or
keep `components/Spinner.js` and have callers wrap as needed.

### 2b. Toast — 2 incompatible APIs (THE HARD ONE)
| Location | API |
|---|---|
| `components/Toast.js` (canonical) | `useToast()` → `{ showToast(msg, isError?), ToastContainer }`; auto-dismiss 3s; renders `.toast` |
| `views/admin/shared.js` (~L142) | `useToast()` → **4-tuple** `[msg, showError, showSuccess, clear]` + separate `Toast({type,text,onDismiss})` rendering `.adm-toast` (with a manual dismiss button) |

**17 admin tab files** import the 4-tuple `useToast`/`Toast` from `./shared.js` and
use the pattern:
```js
const [toast, showErr, showOk, clearToast] = useToast();
// ... showErr(e.message) / showOk('Saved')
// render: ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
```
Migrating to the `components` API means rewriting each of those to:
```js
const { showToast, ToastContainer } = useToast();
// ... showToast(e.message, true) / showToast('Saved')
// render: <${ToastContainer} />
```
Affected admin tabs: ghii, genesis, chat-instances, realtime, memory, cortex,
boards, cors, csm, hooks, maintenance, msm, owners, portal, push, scheduler,
services. Decide whether to keep the manual-dismiss affordance (`.adm-toast` has a
× button) or accept auto-dismiss; if dismiss matters, give `ToastContainer` a
dismiss button rather than re-introducing the divergent API.

### 2c. Badge — 3 palettes (already token-harmonized — low priority)
- `theme.css` `.badge` + `.badge-success/-warn/-danger/-info`
- `views/admin/shared.js` `Badge({type})` + `admin.css .adm-badge` + many `.adm-badge-*` status aliases
- `profile.css` `.pf .badge*`, `.badge-label`, `pkg-badge-*`, `kpkg-badge-*`, `vis-*`

**As of the theming work, ALL of these now use the same semantic-tint tokens**
(`--{success,warn,danger,info,purple}-{bg,fg,border}`, muted via
`--bg-surface`/`--text-dim`). So the *visual* palette is already unified. What
remains is purely structural (one `<Badge>` component + consistent class naming).
**Lowest value — consider deferring or doing last.**

### 2d. Card — 3 surfaces
- `components/Card.js` (canonical): `Card({title, subtitle, onClick, hoverable, className, children})` → `.card`
- `views/profile/shared.js` `GlassCard({children})` → `.pf-glass-card`
- `admin.css .adm-card` (raw class, no component)

All themed. Route new usage through `components/Card.js`; assess whether
`.pf-glass-card` / `.adm-card` can become `.card` + a modifier class.

### 2e. Alert vs ErrorBox
- `components/Alert.js` (canonical): `Alert({type, message, onDismiss})`
- `views/admin/shared.js` (~L84) `ErrorBox({message})` → `.error-box`

Migrate admin `ErrorBox` callers to `<Alert type="error" message=... />`.

### 2f. Minor cleanups
- Promote `ToggleSwitch` + `ExpandableHelp` (currently in the two `shared.js`) to `components/`.
- `components/index.js` doesn't export `ConfirmDialog` / `Markdown` (deep-import only) — add exports.
- `components/useViewCSS.js` is a no-op with no header — removal candidate.
- i18n gaps (Rule 4 / 7.8): `CopyButton` "Copy"/"✓ Copied", admin `Spinner`/`ErrorBox` "Loading…"/"Error" are hardcoded English. Add `t()` keys to BOTH `locales/en.json` + `fi.json`.

## 3. Recommended phasing (one component → one commit → one verification)

Order easiest→hardest so you build confidence and momentum:

1. **Card** (`components/Card.js` ← `GlassCard`, `.adm-card`) — low risk.
2. **Alert** ← admin `ErrorBox`.
3. **Spinner** 3 → 1.
4. **Minor** — promote ToggleSwitch/ExpandableHelp, fix `index.js` exports, i18n gaps, remove `useViewCSS.js`.
5. **Badge** structural (optional; palette already unified).
6. **Toast** API unification (HARDEST, 17 admin files) — do LAST; verify each admin tab's success/error toast behavior in the browser.

For each phase: confirm/define the canonical component in `components/` → add an
importmap entry in `spa.html` if it's a new absolute module → migrate call sites →
delete the duplicate → restart `pnpm dev` → browser-verify in light AND dark →
`pnpm lint` + `npx tsc --noEmit` → commit.

## 4. Project rules you MUST follow (from CLAUDE.md)

- **Rule 1b — browser verification:** verify by DRIVING CHROME via the Playwright
  MCP server against the running dev server. **Do NOT write/run the `.spec.ts`
  Playwright suite.** Report what you actually observed.
- **Rule 2 — file headers:** every touched `.ts/.js/.css` needs `@file`,
  `@description`, `@version-history`.
- **Rule 4 — i18n:** every new key in BOTH `locales/en.json` and `locales/fi.json`.
- **Rule 7 — frontend guide** (`docs/frontend-development-guide.md`): no inline
  `style=` colors, use `theme.css` tokens, prefix classes, all user text via
  `t()`, no `rgba(255,255,255,...)`, use existing button classes.
- **ES-module cache busting:** a new `/components/Foo.js` absolute module needs an
  identity entry in `spa.html`'s importmap; `serveSpa()` stamps it with
  `?v=BUILD_ID`. A `pnpm dev` restart mints a new BUILD_ID — **required before
  browser verification** of public/ changes.
- **Subagents:** use `model: "opus"` (Rule 6).

## 5. Environment & verification recipe

- Start: `pnpm dev` → http://localhost:40050 (MongoDB backend, anonymous + dev mode).
  Restart after any `public/` change (BUILD_ID).
- Login (operator, for profile + admin): username `happyadmin`, password `***REMOVED***`.
  In the browser console you can do
  `await window.AIMEAT.auth.loginWithPassword('happyadmin','***REMOVED***')`.
  **Do not commit these credentials.**
- Theme toggle: the ☾/☀ button in the topnav, or set `localStorage['aimeat-theme']`
  to `'light'`/`'dark'` and reload. Verify each change in BOTH themes.
- Key views to re-verify per component: `/v1/profile` (+ its tabs), `/v1/admin`
  (+ tabs — this is where Toast lives), `/v1/classic`, `/v1/hobbies`.

## 6. Context: what's already done (do not redo / do not regress)

Dark/light theming is **complete** (Track A, commits through `53671bb` on `main`):
- `theme.css` has `:root` (light) + `[data-theme="dark"]` override + a drift-alias
  layer + semantic-tint tokens (`--success/-warn/-danger/-info/-purple -bg/-fg/-border`),
  `--scrollbar-thumb`, `--overlay-scrim`, `--morsel-bg`, `--on-inverted`, gradient tokens.
- `/js/theme.js` controls the theme; `spa.html` has the no-flash boot + toggle.
- admin.css, profile.css, portal-dev/classic/marketplace/hobbies/openclaw all
  tokenized; admin StatsGrid uses a `tone` prop; badges use the shared tint tokens.

So the components you are unifying **already render correctly in both themes**.
Your refactor changes structure/APIs, not colors. If a migration changes how
something looks, that's a regression — fix it.

## 7. Gotchas

- **Parallel work:** another worker may be editing `src/routes/generator.ts`,
  `src/services/`, and `views/profile/generator-dashboard/` + `generator-detail.js`.
  **Stage only the files you changed** (explicit `git add <paths>`, never `git add -A`).
- **foundry is DISABLED** — do not touch `css/views/foundry.css` or
  `views/profile/foundry-dashboard/`.
- **Toast markup divergence:** `.toast` (components) auto-dismisses; `.adm-toast`
  has a manual × dismiss. Pick one canonical behavior deliberately.
- The two `shared.js` files are imported widely — when you delete a primitive from
  them, grep for every importer and update it, or the SPA will fail to load that view.

## 8. Acceptance criteria

- [ ] One canonical implementation of Spinner, Toast, Card, Alert (and Badge if
      done) in `components/`, all exported from `components/index.js`.
- [ ] `profile/shared.js` and `admin/shared.js` contain only domain helpers — no
      duplicated generic primitives; no dangling imports of deleted exports.
- [ ] All ~46 call sites migrated; `grep` shows no remaining imports of the removed
      duplicates.
- [ ] i18n: no hardcoded English in shared primitives; keys in both locale files.
- [ ] `pnpm lint` → 0 errors; `npx tsc --noEmit` clean.
- [ ] Each phase browser-verified in light AND dark (Playwright MCP); no visual
      regressions — especially admin toasts (success + error) across the tabs.
