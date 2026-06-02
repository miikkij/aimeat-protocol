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

> **NOTE:** This short list covers only the headline primitives. The full audit
> in **Appendix A** found 28 additional duplications (CopyButton at 80 sites is
> the biggest, not Toast/Badge) and gives a **leverage-ordered sequence that
> supersedes this list** — use Appendix A's "Suggested order" as the real plan.
> The per-phase mechanics below still apply to every item.

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

---

## Appendix A — Full duplication audit (28 additional opportunities)

> The §2 list above is the *headline* set. A four-way audit (components/shared
> exports, CSS class families, inline-template patterns, modal deep-dive) found
> the real scope is much larger — the single biggest item is **CopyButton: 80
> hand-rolled clipboard sites across 33 files**, not the Toast/Badge work. Use
> the leverage-ordered sequence at the end of this appendix as the actual plan;
> the §3 six-phase list is a subset of it. All items below were spot-verified
> against source.

## Additional Unification Opportunities (beyond the already-covered set)

This section consolidates the four-way audit into a single deduplicated, ranked inventory of UI-unification work **not already in the brief** (i.e. excluding Spinner, Toast 2-API, Badge palettes, Card/GlassCard/.adm-card, Alert vs ErrorBox, ToggleSwitch/ExpandableHelp promotion, components/index.js missing ConfirmDialog/Markdown, useViewCSS no-op, and the CopyButton/admin-Spinner/ErrorBox hardcoded-English i18n). Where two auditors described the same pattern from the CSS side (class definitions) and the JS side (markup that emits those classes), the findings are merged into one item with both dimensions.

Verification highlights: `CopyButton.js` exists and is essentially unused while clipboard logic appears **80 times across 33 view files**; the `.pf .modal-overlay`/`.pf .modal` override at `profile.css:271-273` restyles the same markup `Modal.js` emits (hardcoded `rgba(0,0,0,.7)`, `blur(4px)`, `--bg`/`--radius` instead of `--bg-card`/`--radius-xl`); inline `class="modal-overlay"` hand-rolls confirmed in `agents-tab.js`, `memory-tab.js`, `extensions-tab.js`, `work-tab.js`; status-dot variants appear **22×/11 files**; bare `class="empty"` + divergent empty markup appears **92×/37 files**.

### High severity

**1. CopyButton ignored — clipboard + feedback hand-rolled across the codebase**
- Canonical: `components/CopyButton.js → CopyButton` (copied-state feedback, delegates to `/js/utils.js copyToClipboard`).
- Ignored by ~33 view files (80 grep hits): `profile/wallet-tab.js` (own local `copyToClipboard()` duplicating the util), `calibrator-tab.js`+`calibrator-batch.js` (each define a **local** `copyToClipboard`), `extensions-tab.js` (6 inline copy+toast), `generator-detail.js`/`foundry-detail.js` (~6 each, raw `navigator.clipboard.writeText`), plus `agents-tab`, `nodes-tab`, `chat-sessions-tab`, `knowledge-tab`, `packages-tab`, `access-tab`, `memory-tab`, `generator-tab`, `foundry-tab`, `agents/tab-integration|tab-agent-config`, the `foundry-/generator-dashboard` `DebugPanel.js`+`use-edit-mode.js` clones, admin `csm/email/portal/services/generator-debug` tabs, and top-level `portal/portal-classic/portal-dev/help/guides/portfolio/public-knowledge-viewer/marketplace`. CSS: ≥6 bespoke copy-button styles (`dv-copy-btn`, `cl-copy-prompt-btn`, `.pf .copy-prompt-btn`/`.tx-copy-btn`/`.wallet-balance-copy`/`.ext-copy-btn`/`.agent-copy-btn`).
- *Recommendation:* route every copy through `CopyButton` (i18n-fix its labels, add an `onCopied`/toast hook); delete local helpers + bespoke `.*copy-btn` CSS in favor of one `.copy-btn` + `.copied`.

**2. Inline modal overlays bypass the existing `Modal`/`ConfirmDialog`**
- Canonical: `components/Modal.js → Modal` (Escape + backdrop close, header ✕) + `ConfirmDialog`/`useConfirm` (memoised). Correct consumers: `agents-tasks-subtab.js`, `agents/rate-modal.js`, 19 admin tabs use `useConfirm`.
- Hand-rolled: `work-tab.js` (Rate ~182 + Deliver ~203), `memory-tab.js` (edit ~1084), `agents-tab.js` (scope modal ~1117), `extensions-tab.js` (two install modals ~998/1040), `admin/msm-tab.js` (typed-name delete ~131 via divergent `.adm-modal-overlay`). Three different backdrop-click checks coexist; only `Modal.js` wires Escape.
- *Recommendation:* migrate all five to `<${Modal}>`; replace `msm-tab` typed-confirm with `useConfirm` (+ optional `confirmText` guard). Needs `ConfirmDialog` exported from index.js.

**3. Modal CSS — three parallel class systems for the same dialog**
- Canonical token-driven `theme.css .modal-*`. Overrides: `profile.css:271-273` `.pf .modal-overlay`/`.pf .modal` (hardcoded rgba/blur/`--bg`/`--radius`) → same `Modal.js` markup looks different under `.pf`; `admin.css:505-511` `.adm-modal-overlay` (own name).
- *Highest-leverage CSS fix:* deleting the `.pf` override unifies modal appearance with ZERO JS changes; `.adm-modal-overlay` dies once `msm-tab` migrates. (Leave cortex-bundled `.aui-*` — sovereign across the trust boundary.)

**4. Button family reinvented under 7 prefixes** — clones of `theme.css btn-*`: `.pf .btn-primary` (`profile.css:217`), `kpkg-btn*`/`pkg-card button.primary|.danger`, `adm-btn*`, `dv-copy/upload-btn`, `cl-*-btn`, `mk-btn*`, `hb-btn*`; several use hardcoded rgba that won't flip for dark. → route all to `theme.css btn-*`; retire the clones.

**5. Form field / text-input reinvented under 5 conventions** — canonical `components/FormField.js` + `theme.css .input-field`/`.form-*`. ~14 admin tabs hand-write `.adm-field`/`.adm-input` inline; CSS clones `.adm-input`/`.adm-textarea`, `.pf .input-field`, `.mk-form-*`, `.hb-form-*`. → adopt `FormField` in admin; consolidate field/label/hint CSS onto theme.css.

**6. Stat card — 6 byte-equivalent CSS variants** — canonical `theme.css .stat-card*`; clones `.adm-card`+`.adm-stat`, `.dv-stat`/`.dv-num`/`.dv-label`, `.mk-stat-*`, `.hb-stat-*`, `.pf .stat-card`+`.num/.label` AND `.pf .wl-stat`. → promote `theme.css .stat-card*` (+ admin `StatCard` component); retire the rest.

**7. Status/state badge variants** (extra dimension of the Badge concern) — `adm-badge--*`/named aliases, `mk-status-*`/`mk-vis-*`, `pkg-badge-*`, `kpkg-badge-*`, `hb-tag-shared`. → extend the harmonized Badge with state modifiers; migrate all onto it.

**8. View-prefixed content cards + segmented tabs** (extra dimensions of Card) — same bordered+accent-hover card re-rolled as `.pf .card`/`.pn-card`/`.app-card`/`.file-card`/`.ext-card`/`.pkg-card`/`.kpkg-card`/`.mk-card`/`.hb-card`/`.cl-card`/`dv-*-card`; active=accent tab as `.pf .tab`/`.sub-tab`/`.platform-tab`/`.audit-day-btn`/`.adm-subtabs`/`.adm-time-btn`/`.adm-nav-item`/`dv-cap-tab`/`.mk-nav a`/`.hb-nav-links a`. → one `.card` (hoverable) + one tab component with pill/underline/sidebar variants.

### Medium severity

**9. Empty-state** — `theme.css .empty` + admin `Empty({text})`; **profile has none**. 92 hits/37 files; divergent `mk-empty-*`, `pf-empty`, `agd-empty`, `adm-empty`, `pkg-empty`, `kpkg-empty`, `dv-unavail-notice`. → promote `EmptyState({icon?, text})` to /components; collapse clones.

**10. profile.js bespoke `showToast` prop — a THIRD toast pathway** — `profile.js:102` defines its own `showToast(msg,isError)` and passes it as a tab prop, independent of both other Toast APIs. → adopt `components/Toast.js useToast()` and pass its `showToast` down.

**11. Status dot indicator reinvented per prefix** — `.live-dot`, `.peer-dot`, `.pn-status-dot`, `.ext-status-dot`, `.dv-dot`, `.adm-badge-live`; JS 22×/11 files. → `StatusDot({status})` keyed by semantic color; fold `.live-dot` in.

**12. Formatters trapped in admin** — `admin/shared.js → num, dt, fmtUp, fmtBytes` are admin-only; ~29 profile files inline `.toLocaleString()`/`.toLocaleDateString()`. → move to a shared `/js/format.js`.

**13. DataTable has no generic home** — `admin/shared.js → DataTable` (with `_html`/`mono` cell protocol) is admin-only; profile hand-rolls `<table>` (`wallet-tab`, `data-wallet-tab`, `node-stats-tab`); CSS `.adm table`/`.adm-breakdown-table` vs `.pf .consent-table`/`.audit-table`. → promote `DataTable` to /components with a `className` prop; extract `.data-table` CSS.

**14. ToggleSwitch mis-located** — generic primitive lives in `profile/shared.js` (`.pf-toggle*`). → move to `/components/ToggleSwitch.js`, de-`pf-`-prefix, keep a re-export.

**15. Section/page header pair inconsistently applied** — `.pf .section-title`/`.section-desc` (Rule 7 pattern); `.adm-page-title` (no desc), `mk-page-title`/`-subtitle`, `hb-page-title`/`-subtitle`, `cl-welcome-title`/`-subtitle`. → promote `.section-title`/`.section-desc` (+ page-title/subtitle) as shared; converge.

**16. Tag/chip list reinvented; `components/tags.css` ignored** — `.tag-pill`/`.tag-cloud`/`.tag-editor` exist but ~15 files use bare `.tag` (one sets color via **inline style**) or prefixed `pkv-tag`/`mk-tag`/`hb-tag`/`pkg-tag`/`kpkg-tag`/`cap-tag`/`file-tag*`/`scope-tag`/`pf-agd-tag-*`/`dw-type-tag`. → `TagList({tags, max?, prefix?})` (with `+N` overflow pill) on top of tags.css.

**17. Pagination duplicated; near-verbatim clone pairs** — `pf-gen-pagination`≈`fnd-pagination` (arrows), `mk-pagination`≈`hb-pagination` ("Next »"), `adm-mem-pagination`≈`agent-tasks-tab`, plus "Load more" in `public-knowledge-viewer`/`agents-activity`. → `Pagination({page,totalPages,onPage})` + `LoadMore({onMore,loading})`; shared `.pagination` CSS.

**18. Category card duplicated across two views** — `mk-category-*` and `hb-category-*` are the same grid tile. → one `.category-card`.

**19. Inline alert/banner clones with hardcoded rgba** (dark-mode regression) — `mk-alert-*`, `hb-alert-*`, `dv-mode-notice-*` clone `theme.css .alert-*` with hardcoded rgba. → use `.alert-*`; delete clones.

**20. Loading-state drift in agent subtabs** (extra Spinner dimension) — many agent subtabs use a bare text loader (`pf-agd-empty`/`agd-empty`) instead of `Spinner`; bespoke `fnd-loading`/`pf-gen-loading`/`view-loading`/`hlp-loading`; `knowledge-tab.js` passes literal `text="Loading..."`. → standardize on `Spinner` (full-tab variant); fix the literal.

### Low severity

**21. Key-value/detail row primitive** — `tab-integration.js` has ~20 `pf-agd-info-row`; admin `EconRow`+`HealthRow` are near-identical; profile lacks any. → one `KeyValueRow({label, value, badge?})`.
**22. GlassCard fold-in** — headerless `.pf-glass-card` → `Card variant="glass"`.
**23. Expand/collapse chevron toggle hand-rolled** — `expand-btn`+`pf-chevron`, `scope-advanced-toggle`, divergent `pkv-entry-arrow`. → `Collapsible({title, open, onToggle, children})`.
**24. Search bar + filter toolbar reinvented** — `cap-search-input`, `pkv-search`, `pf-agd-search-bar`, `search-bar`+`input-field`. → `SearchBar` shell.
**25. VisibilityPill pill-base** — domain-correct but overlaps badge/pill styling. → extract a shared pill base.
**26. recipientBadge vs Badge — function-vs-component split** — `recipientBadge()` uses its own `.badge-label`/`.badge-*`. → render via shared `Badge`, keep the domain classifier on top.
**27.** *(rolled into #17.)*
**28. sanitizeHref discoverability** — `Markdown.js` also exports a reusable `sanitizeHref` not re-exported. → export `Markdown` **and** `sanitizeHref` from index.js.

### Suggested order to fold into the phased plan

Sequence by leverage and dependency. **First**, the pure-CSS, zero-JS wins that immediately unify appearance: delete the `.pf .modal-overlay`/`.pf .modal` override + `.adm-modal-overlay` (#3), then consolidate the button (#4), input/form-field (#5), and stat-card (#6) families onto existing `theme.css` tokens — no behavior change, removes the largest hardcoded-rgba dark-mode debt. **Second**, the component-adoption wave that depends on the index.js export fix: export `ConfirmDialog`/`Markdown`/`sanitizeHref` (#28), migrate the five inline modals to `Modal`/`useConfirm` (#2), and run the high-volume `CopyButton` adoption (#1) — mechanical but wide, so batch per directory (profile → admin → top-level) to keep diffs reviewable. **Third**, the medium promote-to-shared primitives profile lacks and admin already has: `EmptyState` (#9), `StatusDot` (#11), `/js/format.js` (#12), `DataTable` (#13), `ToggleSwitch` relocation (#14), third-toast cleanup (#10), `TagList` (#16), `Pagination`/`LoadMore` (#17), section/page headers (#15) — group with the Card/Badge work since #7 and #8 are extra dimensions of those. **Last**, the low-severity folds (#21–#26, #18, #19) and the agent-subtab loader standardization (#20) as opportunistic campsite cleanups while touching the relevant files.
