---
name: aimeat-app-retheme
description: Migrate an already-published AIMEAT app onto the platform theme system (aimeat-theme.css v2 - data-theme light/dark x data-palette, control cluster in the login pill) without changing behaviour. The recommended way for any "re-theme / update <app>.html to the new theming" request - covers both token-based apps and self-contained apps with their own CSS variables, plus the language-control migration and live browser verification. Use whenever the owner asks to bring an old app onto the theme system.
license: MIT
metadata:
  audience: agent
---

# Re-theming a published AIMEAT app onto the theme system

The platform theme system is `/lib/aimeat-theme.css` v2: five designed palettes on two
orthogonal axes (`data-theme` light/dark, key `aimeat-theme`; `data-palette`, key
`aimeat-palette`), typography (Inter body, per-palette display faces), elevation tokens
(`--elev-card/-raise/-pop`) and the control cluster (language + mode + palette) rendered by
the login pill from aimeat-auth. A migrated app follows all of that with zero app-side
controls. Preview: `/lib/samples/themes.html`.

Work read → inventory → edit → verify → publish → report, and keep every behaviour
unchanged. If any check fails, fix the app — never the check.

## 1. Source — always the RAW stored file

```
GET https://aimeat.io/v1/apps/{owner}/{app}.html
```

Never start from the served page (`https://<app>.apps.<node-domain>/`) — the node injects
an attribution badge into served pages, and publishing a served copy bakes it in. If the
raw source already CONTAINS a baked-in `<div id="aimeat-app-badge">…</div>`, delete it
(the node re-injects a fresh tokenised one at serve time).

Fetch the manifest too (`aimeat_app_get`) to keep name/description/tags/icon.

## 2. Inventory before editing

- Stylesheets: does it load daisyUI + `/lib/aimeat-theme.css` (+ bridge), or is it a
  self-contained app with its own CSS variables?
- Every hardcoded hex (`grep -o '#[0-9a-f]\{6\}'` + context): classify each as SEMANTIC
  (error/success/warning/info/brand-coral → migrate to tokens) or APP IDENTITY (e.g.
  PRH's blue → keep, deliberately).
- Language: own switcher UI? own localStorage key? `aimeat-locales` meta?
- Head snippet: does it restore BOTH `data-theme` and `data-palette`?

## 3. Edit by recipe

**A. Token-based app** (loads daisyUI/theme already): replace semantic hexes with
`var(--color-error/-success/-warning/-info/-primary)`. A semantic colour used as SMALL
TEXT on a light wash must be
`color-mix(in oklab, var(--color-X) 55-62%, var(--color-base-content))` — raw light-mode
success/warning fail contrast as text. Chart.js / canvas colours are read at render time:
`getComputedStyle(document.documentElement).getPropertyValue('--color-...')`.

**B. Self-contained app** (its own `:root { --bg: ...; }` palette): add
`<link href="/lib/aimeat-theme.css" rel="stylesheet">` BEFORE the app's own `<style>`,
then remap the app's own variables to tokens with the old values as fallbacks:

| app var | maps to |
|---|---|
| bg / page | `var(--color-base-100, <old>)` |
| card / panel | `var(--color-base-200, <old>)` — cards sit on base-200 with `box-shadow: var(--elev-card)`, never on base-100 with only a hairline (that is the flatness bug) |
| intermediate surface | `color-mix(in oklab, var(--color-base-200) 55%, var(--color-base-100))` |
| text | `var(--color-base-content, <old>)` |
| muted | `color-mix(in oklab, var(--color-base-content) ~60%, transparent)` |
| accent + its ink | `var(--color-primary)` + `var(--color-primary-content)` AS A PAIR |
| borders | `var(--color-base-300, <old>)` |
| radius | `var(--radius-field)` / `var(--radius-box)` |
| shadow | `var(--elev-card, <old>)` |
| font | `var(--font-body, <old>)` |
| ok/warn/err as text | `color-mix(in oklab, var(--color-success/-warning/-error) 55-62%, var(--color-base-content))`; their soft washes: `color-mix(token 14-16%, var(--color-base-100))` |

DELETE the app's hand-kept `[data-theme="dark"]` variable block — tokens cover both modes
and every palette. Do not touch component rules; the variable remap is the fix.

**C. Language**: declare `<meta name="aimeat-locales" content="fi en">` (only languages
the app REALLY has; one language → no meta, no control). Remove the app's own switcher UI
and storage-key writes. Init from localStorage `aimeat-lang` (validate against the
supported list; read the app's legacy key once as fallback). React to the
`aimeat-lang-change` window event. Never build a language/theme/palette control — the
pill cluster renders them.

**D. Head restore** covers BOTH axes: `aimeat-theme` → `data-theme`; `aimeat-palette` →
`data-palette` (remove the attribute when the value is `aimeat`), plus `storage`-event
listeners for both keys.

**E. Version**: bump the display version and add a version-history entry describing the
round.

## 4. Static verify before publishing

Syntax-check every inline script (`new Function(scriptText)` per block); confirm zero
remaining hexes outside `var()` fallbacks and declared identity colours; zero writes to
the legacy language key; zero references to the removed switcher element.

## 5. Publish

`aimeat_app_publish` in presigned mode (omit content → PUT the raw HTML to `upload_url`),
with the old manifest fields; omit `cortex_agents` so an existing agent-bundle stays
in place. Publishing goes straight live; the previous version stays recoverable via
`aimeat_app_manage` with action `versions`.

## 6. Verify live (Playwright MCP browser on the app subdomain)

- zero console errors; zero network requests to non-AIMEAT origins
- the pill cluster renders (language segment if declared, sun/moon, palette dot) and the
  app's own old controls are GONE
- flip light AND dark with the real sun/moon segment, and pick ONE non-default palette
  from the real swatch picker (circuit is a good stress test) — surfaces, text and
  accents must all follow; screenshot each state
- switch language from the segment and confirm UI strings actually change
- exercise one real core flow (open a tab, run a search, open a record) so behaviour is
  proven unbroken, not assumed
- at 390px: `document.documentElement.scrollWidth === clientWidth` (zero overflow)

## 7. Report

Report what you OBSERVED, not what you expect: hex count before → after, what was
removed, what was deliberately kept (identity colours), screenshots light + dark, and
anything deferred. If you could not verify (MCP/browser unavailable), say so instead of
claiming success.

## Landmines

- Served page ≠ source (the badge bake-in).
- The ONLY storage keys are `aimeat-lang` / `aimeat-theme` / `aimeat-palette` — never
  invent an app-specific one.
- `--border` is a WIDTH in daisyUI calc() maths (a colour named `--border` once broke
  badge/input paddings platform-wide) — the colour alias exists only under `aui-*` scope.
- Fonts are self-hosted only (`/lib/fonts/`), never a font CDN.
- daisyUI `badge-xs` renders at 10px — `badge-sm` or larger for anything a user reads.
- The MACHINE ROOM family (LOOM, M-ROOM, DROP, PRESS on the TDR kit) keeps its own
  `mroom.*` keys by owner decision — do not migrate those apps with this skill.

Proven on: TILA 0.3.0 (recipe A + C), PRH Yritystutka 2.2.0→2.3.0 (A + C + de-flatten),
CADENCE 1.18.0 (B + C + D).
