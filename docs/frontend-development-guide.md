# Frontend Development Guide

Architecture and conventions for contributing to the AIMEAT SPA, the node's own screens under
`aimeat/public/`. Paths below are relative to `aimeat/` unless they start with `.claude/` or `docs/`.

Three shorter sources sit beside this guide and win where they disagree with it:

- `.claude/rules/frontend.md`: the rules that apply to every change under `public/`.
- Skill `aimeat-design-language` (`.claude/skills/aimeat-design-language/SKILL.md`): faces,
  colours, shapes, the token map and where each CSS rule lives.
- Skill `aimeat-frontend-verify` (`.claude/skills/aimeat-frontend-verify/SKILL.md`): the styling
  rules that recur, and how a finished change is verified in a real browser.

## Architecture Overview

The SPA uses **Preact + HTM** with no build step. Every file under `public/` runs in the browser as
a native ES module.

| Layer | Technology |
|-------|-----------|
| Framework | Preact, vendored as `public/lib/preact.mjs` and `public/lib/preact-hooks.mjs` |
| Template DSL | HTM (tagged template literals in place of JSX), vendored as `public/lib/htm.mjs` |
| Module system | Native ESM through the importmap in `public/spa.html` |
| Routing | Client-side History API; the `ROUTES` map in `spa.html` lazy-loads each view |
| State | Preact hooks (`useState`, `useEffect`, `useCallback`, `useRef`) |
| Styling | Tokens in `css/theme.css`, shapes in `css/poster.css`, one sheet per component in `css/components/`, view sheets in `css/views/` |
| Auth | `/js/services/auth.js` (`getSession`, `onAuthChange`) is the one session source; the `aimeat/no-direct-auth` lint rule refuses direct reads of `window.AIMEAT.auth` |
| i18n | `locales/*.json`, dot-notation keys, read through `t()` in `/js/i18n.js` |

The vendored versions, their sources and licences are listed in `public/lib/VENDORED.md`. Read the
version there, or in each file's own banner, rather than from this guide.

### Why No Build Step?

- An edit shows after a browser reload. Files under `public/` are served `no-cache` with an ETag,
  so F5 fetches the new copy.
- A contributor needs no toolchain to change a view.
- The source in the debugger is the running code.

Two parts of the frontend are built and are the exceptions: the served SDK libraries
(`src/static/sdk-libs/`, `pnpm build:sdk`) and the app catalog (`pnpm build:app-catalog`). See
`docs/pitfalls.md`, "An edit seems to have no effect".

### Type Checking (no build, still type-safe)

The browser loads the raw `.js`, and the frontend is still type-checked. `pnpm typecheck:frontend`
runs `tsc --noEmit -p tsconfig.frontend.json` with `checkJs` over `public/`, which validates the
JSDoc you write. It emits nothing.

- **`tsconfig.frontend.json`**: the `checkJs` config. Its `paths` map `preact`, `preact/hooks` and
  `htm` to the stubs in `public/types/vendored-libs.d.ts`, and `/*` to `public/*`, so `tsc`
  resolves the same absolute specifiers the importmap does. It excludes `public/lib/`,
  `public/cortex-bundled/` and `public/sw.js`.
- **`public/types/aimeat-globals.d.ts`**: ambient declarations for browser and SDK globals loaded
  outside ES modules (`window.AIMEAT`, `Chart`, `mermaid`, the build-time `__APP_VERSION__`) and
  the `code`, `status` and `response` fields `api.js` attaches to thrown errors.
- **`public/types/vendored-libs.d.ts`**: loose stubs, so the minified vendored libraries are not
  deep-checked.
- Add a JSDoc cast for DOM access TS cannot infer:
  `const v = /** @type {HTMLInputElement} */ (el).value;`

**`pnpm check:importmap`** is a separate guard, because `tsc` cannot catch this case. Every absolute
first-party import (`/js/…`, `/components/…`, `/views/…`) must have an identity entry in the
`spa.html` importmap. Without one, the module loads without the `?v=BUILD_ID` stamp and can stay
stale after a deploy. The same check refuses a view stylesheet that has no `<link>` in `spa.html`.

`pnpm lint` and `pnpm typecheck:frontend` run in the pre-commit hook. `check:importmap` runs in
`pnpm gate` (with the other read-only checks) and in CI.

---

## File Structure

The tree shows the folders and a few files in each. `ls` the folder for the full list.

```
public/
├── spa.html                  # SPA shell: importmap, stylesheet links, ROUTES, Header, ErrorBoundary
├── css/
│   ├── theme.css             # Design tokens only (pnpm check:theme-tokens refuses any other rule)
│   ├── poster.css            # The shared shapes (.poster-*, .showroom-*)
│   ├── components/           # One sheet per component: button.css, card.css, dialog.css, ...
│   └── views/                # Per-view sheets: landing.css, help.css, profile.css, *-poster.css, ...
├── components/               # Shared Preact components, one module per component
│   ├── Action.js             # Action, Loud, Icon, Actions: every way on a page offers
│   ├── Modal.js              # Modal, ConfirmDialog, useConfirm
│   ├── Note.js
│   ├── SettingsPage.js       # The frame of a Settings & Controls page
│   ├── Toast.js              # useToast
│   ├── index.js              # Barrel export of the older components
│   └── ...
├── cortex-bundled/           # Self-contained UI cortex extensions (aui-* prefix)
├── js/                       # Shared modules
│   ├── api.js                # Authenticated fetch wrapper
│   ├── i18n.js               # t(), the locale loader
│   ├── format.js             # Dates, times, numbers, money, morsels
│   ├── dialog.js             # The closing rules of the one dialog
│   ├── theme.js              # Light and dark theme
│   ├── utils.js              # escHtml, escAttr, sanitizeHtml, copyToClipboard, ...
│   └── services/             # API service layer, one file per domain (admin.js, agents.js, ...)
├── lib/                      # Self-hosted third-party libraries and AIMEAT browser libraries
│   ├── VENDORED.md           # What is vendored, which version, from where, under which licence
│   ├── preact.mjs, preact-hooks.mjs, htm.mjs
│   ├── live-updates.js       # Server-sent events for real-time UI refresh
│   └── ...
├── types/                    # .d.ts files for the frontend type check
└── views/                    # View modules, lazy-loaded by ROUTES in spa.html
    ├── _template.js          # Scaffold for a new view
    ├── admin.js              # Admin dashboard shell
    ├── admin/                # Admin tabs and their parts
    ├── profile.js            # Profile shell (tab registry, session, live-update dispatcher)
    ├── profile/              # Profile tabs: one <name>-tab.js each, and a folder for its parts
    ├── home/                 # The signed-in home (/v1/home)
    ├── appcat/               # The app catalogue on the component library (/v1/appcat)
    ├── design-lab/           # Demos of every catalogue component
    ├── landing.js            # The signed-out front page (/v1/portal)
    ├── help.js, members.js, glossary.js, changelog.js, ...
    └── ...
locales/                      # aimeat/locales, beside public/, served at /locales/*.json
├── en.json                   # The source of truth for which keys exist
├── fi.json
└── es.json
```

---

## View Module Contract

Every view module in `public/views/` must:

1. **Export a default Preact component** as the view root.
2. **Accept the `navigate` prop** for SPA link navigation. The shell also passes `locale`.
3. **Have its stylesheet linked in `spa.html`.** `useViewCSS()` is a no-op kept for old call
   sites: view stylesheets are `<link>` tags in `spa.html`, stamped with the build id by the server.
4. **Write all user-visible text through `t()`.**

A public content page gets its `<title>`, description and canonical link from its entry in
`PUBLIC_PAGES` (`src/data/public-pages.ts`), which the server writes into the shell's head. A route
the registry does not name is served as the bare shell titled "AIMEAT"; such a view may set
`document.title` itself.

### Minimal View Template

`public/views/_template.js` is the scaffold to copy. The smallest working view:

```javascript
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';

const html = htm.bind(h);

export default function MyView({ navigate }) {
  return html`
    <div class="mv-root">
      <h1>${t('myview.title')}</h1>
      <p>${t('myview.description')}</p>
    </div>
  `;
}
```

### Props

| Prop | Type | Description |
|------|------|-------------|
| `navigate` | `(path: string) => void` | Navigate to a SPA route without a full page reload |
| `locale` | `string` | The active locale tag |

### Navigation

Use the `navigate` prop for internal links:

```javascript
html`<a href="/v1/profile" onClick=${e => { e.preventDefault(); navigate('/v1/profile'); }}>Profile</a>`
```

A plain `<a href="/v1/...">` also works: the shell intercepts clicks on `/v1/*` paths.

---

## Component Library

**The component catalogue says what exists.** `GET /v1/ui/components`, and the MCP tools
`aimeat_ui_component_list` and `aimeat_ui_component_get`, give each component's data shape, when to
use it, its variants, an example and the pages that draw it. To see them drawn, open
aimeat-design-lab in the admin dashboard (group Design). Read the catalogue before you build a
page, and reuse the component that exists.

A page passes data and named options to a component and writes no class of its own. Each component
is one module in `public/components/` (the markup) and one sheet in `public/css/components/` (the
look). A new component also gets an entry in `src/services/ui-library/`; `pnpm build:ui-library`
fills in the rest from the files, and `pnpm check:ui-library` refuses a sheet with no entry. The
design-language skill has the rules.

Import each component from its own file, as every view does:

```javascript
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Modal } from '/components/Modal.js';
```

`/components/index.js` is a barrel for the older components (`Alert`, `Card`, `CopyButton`,
`FormField`, `Modal`, `Spinner`, `useToast`, `EmptyState`, `DataTable` and others).

### Action and Loud

```javascript
html`<${Action} small onClick=${open}>${t('x.open')}<//>`
html`<${Action} small soft tone="danger" onClick=${remove}>${t('x.remove')}<//>`
html`<${Loud} control disabled=${busy} onClick=${save}>${t('x.save')}<//>`
html`<${Action} small copy=${ref} copiedLabel=${t('x.copied')}>${t('x.copyRef')}<//>`
```

`Action` is an underlined word, `Loud` is the one loud action of a place, `Icon` is a button that is
a mark. The file header of `Action.js` lists every option.

### Note

```javascript
html`<${Note} kind="quiet">${t('x.none')}<//>`
html`<${Note} kind="loading" />`
html`<${Note} kind="message" error>${error}<//>`
```

### Card

```javascript
html`<${Card} name=${app.name} text=${app.description} meta=${when} onOpen=${open} />`
```

`tone` picks the look (`framed`, `section`, `panel`, `figure`); the file header of `Card.js` lists
the parts of a tile. A `Card` with no `tone` and no `name` draws the classic card.

### CopyButton

```javascript
html`<${CopyButton} text=${gaii} label=${t('x.copyGaii')} copiedLabel=${t('x.copied')} />`
```

### Modal

The site has one dialog. `Modal` renders a native `<dialog class="dlg">` opened with `showModal()`:
a header with the title and the X, a body that is the only part to scroll, and a footer for the
actions. On a phone (560px and narrower) it is a sheet at the bottom edge. The look is
`css/components/dialog.css` and the closing rules are `/js/dialog.js`; the app catalog uses the same
two files through `src/static/app-catalog/js/dialogs.js`. Escape and a click on the page behind
close the dialog only while nothing has been typed; the X always closes it.

```javascript
html`<${Modal} open=${showEdit} onClose=${() => setShowEdit(false)} title=${t('x.editTitle')} size="md"
  footer=${html`<${Action} onClick=${close}>${t('common.cancel')}<//>
                <${Loud} control onClick=${save}>${t('common.save')}<//>`}>
  ...fields...
</${Modal}>`
```

Props: `size` (`sm` 440, `md` 560, `lg` 840, `xl` 1080), `footer`, `footerStart` (an action at the
other end of the footer), `showClose` (default on), `guard` (default on; turn it off for a dialog
with nothing to lose, such as a viewer). A toast raised while a dialog is open goes above it through
`raiseAboveDialogs` in `/js/dialog.js`. `pnpm check:dialogs` refuses a hand-rolled overlay, backdrop
or `role="dialog"` box anywhere in the SPA or the catalog.

### Toast (useToast hook)

```javascript
const { showToast, ToastContainer } = useToast();
showToast(t('x.saved'), 'success');

// In render:
html`<${ToastContainer} />`
```

A profile tab gets `showToast` as a prop from the profile shell instead.

### useViewCSS

`useViewCSS(path)` does nothing. It stays so old call sites keep working. Link a view's stylesheet
in `spa.html`; `pnpm check:importmap` refuses a `useViewCSS('/css/…')` path that has no `<link>`
there.

---

## CSS Conventions

### Where a rule lives

| File | Holds |
|------|-------|
| `css/theme.css` | Custom properties only: type, colour and shape tokens, for light and dark. `pnpm check:theme-tokens` refuses any other rule there |
| `css/poster.css` | The shared shapes (`.poster-section`, `.poster-action`, `.poster-slab`, `.poster-box`, ...) |
| `css/components/<name>.css` | One component's look, composing the shapes and reading the tokens |
| `css/views/<view>.css` | A view's own layout: its grid, placement and dimensions |

A view sheet composes a shape by class and never re-declares the shape's font, rule, fill, padding or
shadow. Change a token or a shape at its home. The design-language skill maps which surfaces follow
each token.

### Rules

These are the rules from `.claude/rules/frontend.md` and the `aimeat-frontend-verify` skill:

1. **No inline `style=""`** for layout, colours, spacing or typography. Put the CSS in a `.css` file.
2. **No CSS constants in JS.**
3. **Colours, spacing and type from `theme.css` tokens.** Never a hex value in JS or a view sheet,
   and no `rgba(255,255,255,…)`.
4. **Prefix view CSS classes** to avoid collisions (table below).
5. **All user-visible text through `t()`.**
6. **No emoji in the interface:** not in a heading, a button, a menu item, a dialog title, a label
   or a locale string. Icons are inline SVG. The only symbols in text are `✓ ✗ → ↩`.
7. **A setting a person cannot read from its label explains itself** with `help="<term>"` and
   `explain.<term>.*` keys. The rule file has the details.
8. **Campsite rule:** fix inline styles, `class="btn btn-*"` and `rgba(255,255,255…)` in a file you
   touch.

### View-Scoped CSS

Each view sheet in `css/views/` prefixes its classes with a short abbreviation:

| View | Prefix | Sheets |
|------|--------|--------|
| landing (front page) | `ld-` | `landing.css`, `landing-showroom.css`, `landing-v2.css` |
| profile shell | `.pf`, `pf-` | `profile.css` |
| Settings & Controls pages | `og-`, with the page name on the root (`.og-skills`) | `css/components/tab-page.css`, `settings-page.css`, and a `*-poster.css` per page |
| admin | `adm-` | `css/components/operator-frame.css`, `operator-menu.css` |
| portal-classic | `cl-` | `portal-classic.css` |
| portal-dev | `dv-` | `portal-dev.css` |
| aimeat-os | `os-` | `aimeat-os.css` |
| portfolio | `portfolio-` | `portfolio.css` |
| help | `hlp-` | `help.css` |
| members | `mbr-` | `members.css` |
| changelog | `chg-` | `changelog.css` |
| glossary | `gl-` | `glossary.css` |
| start | `st-` | `start.css` |

### theme.css Design Tokens

The faces, colours and shape tokens, with their values in both themes, are in the design-language
skill. The names a sheet reads most:

```css
/* Colours: always a token, never a literal */
color: var(--text);              /* ink: words, frames, rules */
color: var(--text-dim);          /* the quieter line, placeholders */
color: var(--text-muted);        /* tertiary text, timestamps */
color: var(--accent);            /* coral */
background: var(--bg);           /* paper: the page */
background: var(--bg-card);      /* a box on the page */
border: 1px solid var(--border); /* hairline rows */

/* Semantic colours */
color: var(--success);
color: var(--warn);
color: var(--danger);

/* Type */
font-family: var(--font-headline);  /* headlines */
font-family: var(--font-body);      /* everything read as a sentence; --font is an alias */
font-family: var(--font-mono);      /* identifiers, keys, commands */
```

The shape tokens (`--shape-corner`, `--shape-frame`, `--shape-shadow-*` and the rest) set corners,
frames and shadows. A component sheet reads them rather than writing a value. `--radius`,
`--radius-sm` and `--radius-xs` serve the classic shell only; the poster and showroom faces have no
radius.

#### Dark theme (`[data-theme="dark"]`)

The app supports light and dark themes. `theme.css` defines the light values in `:root` and
overrides the colour and depth tokens in `[data-theme="dark"]`. `/js/theme.js` sets the
`data-theme` attribute on `<html>`, keeps the choice in `localStorage['aimeat-theme']`, and
otherwise follows the operating system's `prefers-color-scheme`. **This is why hard-coded colours
are banned:** a literal such as `#FFFFFF` or `#1A1A2E` stays put when the theme changes, so it looks
broken in dark mode. Only tokens change with the theme.

Canonical surface and text tokens (all in `:root`, all with a dark value): `--bg`, `--bg-surface`,
`--bg-card`, `--card-bg-alt`, `--text`, `--text-dim`, `--text-muted`, `--border`,
`--border-subtle`. A small alias layer maps common short names to these (`--card` to `--bg-card`,
`--surface` and `--bg-dim` to `--bg-surface`, `--muted` to `--text-dim`, `--error` to `--danger`,
`--warning` to `--warn`), so those follow dark mode too. Prefer the canonical names in new code.

#### `--border` collides with daisyUI

`theme.css` defines `--border` as a **colour** (`#E5E7EB`). daisyUI 5 defines the same name as a
border **width**, and uses it inside `calc()` on nearly every component
(`padding-inline: calc(var(--size)/2 - var(--border))` on `.badge`, plus toggle geometry and input
paddings). The two meanings are incompatible, and each one is needed where it lives.

Both failure directions have happened:

| Direction | What happens |
|---|---|
| A colour leaks into a daisyUI context | The `calc()` becomes invalid at computed-value time. Paddings collapse to 0 and toggles render as slivers. Bridge v1.0.0 to v1.2.0 did this by mapping the colour at `:root`, and it broke every page that loaded the bridge |
| A shared component lands in a daisyUI app | `border: 1px solid var(--border)` resolves to `1px solid 1px`, the browser drops the declaration, and the component loses its edge with no error |

**The rule: a component that may render inside a vendored-styling app declares its own `--border`
in a rule scoped to the component's own class.** Never rely on the ambient value, and never map it
at `:root`.

Two existing fixes are the pattern to copy:

- `public/lib/aimeat-daisyui-bridge.css` scopes the colour to `[class^='aui-'], [class*=' aui-']`,
  and restores the width through `--border-w` for daisyUI components nested inside an `aui-*`
  container.
- `src/static/sdk-libs/ai/disclose.js` (`APP_TOKENS`) scopes the same mapping to the AI-disclosure
  label. It reads daisyUI's own palette tokens where they exist (`--color-base-300`) and falls back
  to the AIMEAT literals where they do not, so the label follows an app's palette and its light and
  dark mode with no work from the app.

The general form, for a component `.foo`:

```css
.foo {
  --border: var(--color-base-300, #E5E7EB);   /* daisyUI palette first, theme.css literal as fallback */
  --text:   var(--color-base-content, #1A1A2E);
}
```

The same reasoning applies to any other token name shared with a vendored framework. `--border` is
the one that has cost time twice.

### The classic shell

The older views and some admin parts still use the classic shell: rounded controls and cards. It is
kept and not extended; new work uses the components. Its rules are in `css/components/`, one sheet
each.

The classic buttons are in `css/components/button.css`:

| Class | When to use |
|-------|-------------|
| `.btn-primary` | Primary action |
| `.btn-outline` | Secondary action |
| `.btn-ghost` | Tertiary, Cancel |
| `.btn-danger` | Soft destructive |
| `.btn-success` | Positive action (activate, confirm) |
| `.btn-info` | Informational action |
| `.btn-danger-solid` | Hard destructive (delete, remove) |
| `.btn-sm` | Smaller size; combine with one of the above |

There is no `.btn` base class, so `class="btn btn-primary"` is wrong.

### Banned patterns (grep-checkable)

These patterns must not appear in any `public/` JS or CSS file:

| Pattern | Why | Fix |
|---------|-----|-----|
| `class="btn btn-` | The `btn` base class does not exist | `class="btn-primary"`, or the `Action` and `Loud` components |
| `style="` in `.js` files | Inline styles are banned | Move the rule to a CSS file |
| `rgba(255,255,255` or a hex colour in a view sheet | It does not change with the theme | A token: `var(--bg-surface)`, `var(--card-bg-alt)`, `var(--border)` |
| A hard-coded colour in JS | It ignores the theme | A class that reads a token |
| `toLocaleDateString`, `toLocaleTimeString`, `toLocaleString` | Follows the browser or the page's language instead of the reader's own setting | Import from `/js/format.js` (next section); the `aimeat/no-raw-locale-format` lint rule refuses these calls |

`pnpm check:poster-shapes` refuses a new per-file copy of a shared shape, and `pnpm debt` shows the
copies that remain.

---

## Dates, times and numbers

**A format is never derived from a language.** The language switch at the top of the page decides
which words a person reads. It does not decide whether a date is 9/12/2026 or 12.9.2026, and it
does not decide which clock they are looking at. Those are two more settings of their own, and a
person mixes all three freely: Finnish words with an American date format is a real preference,
and so is English words with a Helsinki clock.

The `aimeat/no-raw-locale-format` lint rule refuses the raw `toLocale*` calls, so this is checked
rather than remembered.

```javascript
import { num, date, time, dateTime, calendar, relative, ago, duration, money, morsels } from '/js/format.js';

num(1234)                                  // 1 234: the reader's own grouping
date(iso)                                  // their date format
time(iso, { hour: '2-digit', minute: '2-digit' })   // their clock
dateTime(iso)                              // both
relative(iso)                              // "3 päivää sitten", "eilen": a POINT in the past
ago(iso, { horizonDays: 7 })               // the same, a date past the horizon (default 30 days)
duration(ms)                               // "1pv 23t 26min": a LENGTH of time
duration(ms, { style: 'long', max: 2 })    // "1 päivä ja 23 tuntia"
money(12.5, 'EUR')                         // 12,50 €
morsels(625)                               // 625 morsels, never a currency symbol
```

**A word is not a unit, and the two follow different settings.** `relative()` and `duration()`
produce words, so they follow the page's language: a person who chose Finnish words with a British
date format gets `3 päivää sitten` beside `13/09/2026`. Everything else here (a number's
separators, a date's order, a clock) follows the regional format.

**Never write a `{n} min ago` translation key.** It cannot produce `eilen`, and one `{n}` cannot
carry a language whose noun changes with the number: Polish writes `1 dzień` but `2 dni`, Russian
`1 день`, `2 дня`, `5 дней`. CLDR holds those rules, and `relative()` and `duration()` read them.

**A moment and a calendar date are different things, and mixing them gives a wrong number rather
than a wrong format.** A message arrived at an instant, and the reader sees it on their own clock.
A heat-map square, a month rail and the day a usage row was counted into are days on a calendar:
read them in the reader's zone and they label themselves the day before for anyone west of the
node, so a heading disagrees with the rows under it. `calendar()` pins those, and `dayKey()` and
`sameDay()` answer "is this today" in the reader's zone rather than the browser's.

Three things follow:

- **`money()` refuses morsels.** A morsel is a pacer, not a currency: it paces what agents may push
  into a person's store, it accrues while they are idle, and it buys nothing. `money()` throws a
  `TypeError` when asked to format one; `morsels()` formats them.
- **Absent means follow the browser.** A person who never opened the settings sees what they always
  saw. Nobody is moved into a preference they did not express.
- **The same rule reaches apps and the server.** In an app: `AIMEAT.fmt` (cortex `aimeat-i18n`) and
  `_core/format.js` inside a served SDK library. On the server: `displayPrefsFor()` for the person
  the message is for, then `formatForPerson()` (both in `src/services/display-prefs.ts`). The
  recipient is the key, because an email written by an hourly sweep has no request, no browser and
  no cookie to ask.

---

## Mobile & Responsive UX

**"Mobile-optimised" means more than "the desktop layout with the columns stacked."** The view uses
the phone's interface the way a native app does. Open it on a phone and it should feel like a real
mobile app, not a desktop page squeezed into a narrow column. When a task says "make X
mobile-friendly", aim for that; hiding a header or widening a column is usually not enough. The
reference implementation is the profile Messages tab (`public/views/profile/inbox-tab/` and
`public/css/views/inbox-poster.css`): full-screen chat, a native composer, keyboard handling.

### The full-screen pattern (focused views: chat, editor, wizard)

A focused mobile view takes the whole screen, with a clear way back. The app shell (top bar, sidebar
toggle, breadcrumb) is chrome the user does not need during the task.

- **Lift the view out of the shell** with `position: fixed; inset: 0; z-index: 1000` under
  `@media (max-width: 760px)`, gated on an "is-active" class (for example, a thread is open). This
  covers the shell.
- **Hide shell chrome you cannot cover.** The sticky `.topnav` is in a higher stacking context than
  the profile subtree, so the overlay's `z-index` does not paint over it: a fixed overlay at
  z-index 1000 still renders under a z-index 100 bar in an ancestor context. Hide it instead:
  `@media (max-width: 760px) { body:has(.your-fullscreen-class) .topnav { display: none; } }`. Also
  lock the page behind: `body:has(.your-fullscreen-class) { overflow: hidden; }`.
- **Give a Back control** that removes the is-active class. The overlay goes and the shell returns.
  No new route is needed.
- **Leave desktop as it is.** Every rule above sits inside `@media (max-width: 760px)`, so the
  desktop layout (for example, a two-pane messenger) does not change. Check that `position` is
  `static` on desktop.

### The on-screen keyboard

A bottom-pinned input (chat composer, sticky footer) hides behind the keyboard by default, because
engines disagree on what the keyboard does to the viewport:

- **Android Chrome:** the keyboard shrinks the **visual** viewport. The **layout** viewport (and
  `100dvh`) does not shrink unless you opt in.
- **iOS Safari:** the same. The layout viewport stays full height, `position: fixed; bottom: 0`
  anchors to it, and the input ends up under the keyboard.

Fix it with two layers:

1. **Viewport meta (primary, iOS 16+ and Android):** `public/spa.html` carries
   `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content">`.
   `interactive-widget=resizes-content` makes the keyboard resize the **layout** viewport, so
   `100dvh` and `fixed inset: 0` shrink to the area above the keyboard and the composer stays
   visible. `viewport-fit=cover` exposes `env(safe-area-inset-*)`.
2. **`visualViewport` measurement (fallback, older engines):** a hook reads
   `window.visualViewport.height` on its `resize` and `scroll` events and publishes the available
   height as a CSS variable, which the container's height reads with `100dvh` as the fallback. See
   `useMobileComposerKeyboard(mode)` in `inbox-tab/use-thread-ux.js`; it measures from the top of
   the body to the bottom of the visual viewport and writes `--conversation-avail`.

Then:

- **Never `scrollIntoView({ block: 'center' })` a bottom input on focus.** It centres the input and
  leaves a dead gap below it. Keep the message list pinned to the bottom instead.
- **Never write `calc(100dvh - keyboardHeight)`.** With `resizes-content`, `dvh` already accounts for
  the keyboard, so subtracting it again counts it twice and collapses the pane. Use the measured
  height or `dvh`, not one subtracted from the other.
- **Pad for the home indicator:** `padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px))` on
  the bottom bar.
- The `VirtualKeyboard` API (`navigator.virtualKeyboard.overlaysContent` with
  `env(keyboard-inset-*)`) is Chromium-only and needs manual inset handling.
  `interactive-widget=resizes-content` covers this case with less code, so the SPA does not use it.

### Native-feeling controls

Swap heavy desktop widgets for simple ones on mobile. The rich Toast UI editor (Write and Preview
tabs, a toolbar) is hard to use behind a phone keyboard, so at 760px and narrower the composer is a
plain auto-growing `<textarea>` and Toast UI does not load. Desktop keeps the rich editor. Detect the
width with `window.matchMedia('(max-width: 760px)').matches`.

### Verify on an emulated phone

Drive the Playwright MCP browser at a phone viewport (390x844, as in the `aimeat-frontend-verify`
skill): open the flow, confirm the view fills the screen with no app chrome, press Back and confirm
the shell returns. Then reduce the viewport height (for example to 440) to emulate the keyboard,
and confirm that the input stays fully visible at the bottom with no gap below it. Keep a
screenshot as evidence.

---

## Profile Tab SPA

The profile view (`/v1/profile`) is a tabbed area inside the main SPA. `public/views/profile.js`
holds the tab registry (`TABS`: `id`, the label's locale key, the component and the lowest account
tier that sees it) and passes the same props to every tab. Each tab is a `<name>-tab.js` file in
`public/views/profile/`, with a folder of the same name for its parts when it has several.

### Profile Tab Component Contract

Every tab in `public/views/profile/` must:

1. **Export a default Preact component** as the tab content.
2. **Accept the standard tab props** (below).
3. **Draw its frame with `SettingsPage`** (`/components/SettingsPage.js`) and its content with the
   components. A Settings & Controls page writes no class of its own.
4. **Re-fetch on live updates** if it shows server data (see "SSE Live Updates" below).
5. **Write all text through `t()`.**

### Tab Props

| Prop | Type | Description |
|------|------|-------------|
| `session` | `object` | The current session (`{ owner, ghii, jwt, ... }`) |
| `showToast` | `(msg, kind?) => void` | Show a toast |
| `onStats` | `(stats) => void` | Update the stat counters in the profile header |
| `navigate` | `(path) => void` | SPA navigation |
| `locale` | `string` | The active locale tag |

### Minimal Profile Tab Template

```javascript
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { Note } from '/components/Note.js';

export default function MyTab({ session }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    try {
      const r = await apiGet('/v1/my-items');
      setData(r.data);
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => { if (session) loadData(); }, [session, loadData]);

  // Live update listener (required for tabs that show server data)
  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [loadData]);

  return html`
    <${SettingsPage}
      crumb=${[t('nav.profile'), t('profile.tabs.mytab')]}
      title=${t('profile.mytab.title')}
      desc=${t('profile.mytab.desc')}>
      ${error ? html`<${Note} kind="message" error>${error}<//>` : null}
      ${!data && !error ? html`<${Note} kind="loading" />` : null}
      <!-- the tab's content, drawn with components -->
    <//>`;
}
```

Register the tab in `TABS` in `profile.js`. The file header of `SettingsPage.js` describes its three
layouts and every prop (`sections`, `pages`, `rail`, `strip`, `actions`, ...).

---

## Service Layer (`js/services/`)

API calls from views go through service modules in `public/js/services/`, one file per domain. Each
module wraps `apiGet`, `apiPost`, `apiPut`, `apiPatch` and `apiDelete` from `/js/api.js`.

### Pattern

```javascript
import { apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';

export const listItems  = ()           => apiGet('/v1/my-items');
export const getItem    = (id)         => apiGet(`/v1/my-items/${encodeURIComponent(id)}`);
export const createItem = (data)       => apiPost('/v1/my-items', data);
export const updateItem = (id, data)   => apiPut(`/v1/my-items/${encodeURIComponent(id)}`, data);
export const deleteItem = (id)         => apiDelete(`/v1/my-items/${encodeURIComponent(id)}`);
```

### Adding a New Service Module

1. Create `public/js/services/my-service.js`.
2. Import from `/js/api.js`.
3. Export named functions (no default export).
4. Always `encodeURIComponent()` path parameters.
5. Add an identity entry to the importmap in `spa.html`; `pnpm check:importmap` refuses the import
   otherwise.

---

## i18n

### Keys

Translation keys use dot notation, `{namespace}.{section}.{key}`. The locale files hold both
nested objects and flat dotted keys; the loader in `/js/i18n.js` flattens them, so
`t('profile.agents.title')` reads either form. `t(key, vars)` replaces `{name}` placeholders from
`vars`. On a missing key, `t()` returns the English text, and the key itself when English has none;
`tOr(key, fallbackText)` returns `fallbackText` instead.

A few of the namespaces in `en.json`:

| Namespace | Used by |
|-----------|---------|
| `common` | Words shared across views (Cancel, Save, Retry, ...) |
| `nav` | Header navigation |
| `profile` | The profile view and its tabs (`profile.agents.*`, `profile.wallet.*`, ...) |
| `dashboard`, `admin` | The admin dashboard |
| `explain` | The explanations behind `help="<term>"` controls |
| `dev` | Dev portal (`portal-dev.js`) |
| `classic` | Classic portal (`portal-classic.js`) |
| `init` | CLI init wizard |

### Adding New Keys

1. **Add the key to `locales/en.json`.** It is the source of truth for which keys exist.
2. **Finnish and Spanish follow.** `pnpm locale:extract <lang> --prefix <screen>.` writes one
   screen's missing keys to `locales/.todo-<lang>.json`; translate that file, then
   `pnpm locale:merge <lang> <file>` validates it and merges it in. `pnpm check:locales` gates the
   result.
3. **A key a language does not have falls back to English**, so a language can be filled in over
   several passes. A `[TODO:xx]` placeholder fails the gate; never commit one.
4. **Before you write Finnish or Spanish, read the language context:**
   `.claude/skills/aimeat-writing/references/language-context.md` says what each thing in the
   product is and which word is already settled for it in each language. Use the established term
   in that language, or keep the English one as is; never invent a form.
5. Use `t('namespace.key')` in views (`import { t } from '/js/i18n.js'`).

A new language is the same loop plus two lines: the tag in `LOCALES` in `src/i18n.ts`, and an empty
`locales/<tag>.json`. `.claude/rules/locales.md` is the rule.

### Existing Conventions

- `portal-dev.shared.js`: `dt(key)` returns `globalT('dev.' + key)`.
- `portal-classic.js`: `ct(key)` returns `globalT('classic.' + key)`.

---

## Error Handling

### View Errors

The SPA shell wraps every view in an `ErrorBoundary` (in `spa.html`). If a view throws during
render, the shell shows a retry message instead of a blank app.

### API Errors

`api()` and its shorthands return the parsed AIMEAT envelope `{ ok, data, hints }` and **throw** when
the server answers `ok: false`. The thrown error carries `message`, `code` (for example
`NOT_FOUND`), `status` and `response`.

```javascript
try {
  const r = await apiGet('/v1/memory/key');
  setValue(r.data);
} catch (e) {
  setError(e.message);
}
```

What `api()` does around the call:

- **Reads are retried, writes are not.** A `GET`, `HEAD` or `OPTIONS` that gets a 429, a 5xx, a
  network error or a timeout is retried up to 3 times with exponential backoff. A write is never
  retried automatically, because a failure does not prove it did not happen.
- **`POST` and `PUT` carry an `Idempotency-Key` header**, one per call.
- **A 401 refreshes the session once** and repeats the call.
- **A network failure** that runs out of retries throws with `code: 'NETWORK_ERROR'`.
- **The timeout is 30 seconds**; pass `timeoutMs` for a slow call.

### XSS Prevention

Preact escapes every text node and attribute value it renders. **Do not call `escHtml()` on a value
you put in an `html` template:** the text is escaped twice, and the reader sees `&quot;` or `&amp;`.

```javascript
// Text and attributes: pass the value as it is
html`<span title=${userInput}>${userInput}</span>`

// Rich text (keeps <b>, <i>, <em>, <strong>, <code>, <a>, <br>, <p>, lists, <blockquote>)
import { sanitizeHtml } from '/js/utils.js';
html`<div dangerouslySetInnerHTML=${{ __html: sanitizeHtml(richContent) }} />`
```

`escHtml()` and `escAttr()` in `/js/utils.js` are for a string you build as HTML outside Preact, for
example for `innerHTML` or a print page. For Markdown, use the `Markdown` component.

---

## Testing

**A finished frontend change is verified by driving a real browser** through the Playwright MCP
server, as the `aimeat-frontend-verify` skill describes: three viewports (390x844, 1280x900 and
1280x460), the real interaction, the console and the network log, and a check that the result
persists. "It rendered" is not a pass.

`pnpm lint`, `pnpm typecheck:frontend` and `pnpm check:importmap` are the static checks. `pnpm gate`
runs them, with every other check the change can reach, once the work is finished.

### The Playwright spec suite

`test/playwright/` holds a `.spec.ts` suite, one file per area: `views.spec.ts` (routes, security
headers), `libs.spec.ts` (served libraries), the `profile-*.spec.ts` and `admin-*.spec.ts` files for
single tabs, and a few for one feature each. **Do not write or run it:** `.claude/rules/frontend.md`
rules it unreliable, and verification is the browser drive above.

For the record, the commands are `pnpm test:playwright` (the same as `test:playwright:sqlite`) and
`pnpm test:playwright:postgres-kysely`. Each runs `test/run-playwright-ci.ts`, which reads
`.env.test.sqlite` or `.env.test.postgres-kysely`, starts its own server on that file's
`AIMEAT_PORT`, and then runs `npx playwright test`. `pnpm test:env:init` writes those files with a
port of the worktree's own. `playwright.config.ts` still names `http://localhost:40251` as its
`baseURL`.

---

## Development Workflow

1. Start a node: `pnpm dev` from `aimeat/` serves the SPA on port 40050. A maintainer session uses
   its own sandbox instead (`pnpm sandbox`, port 40600 upward; owners and tokens in
   `aimeat/.sandbox.json`), because the dev server on 40050 is shared.
2. Open `http://localhost:40050/v1/portal` (or the sandbox's base URL).
3. Edit files under `public/` and reload the page. A change under `src/` needs a server restart.
4. Type-check: `pnpm typecheck:frontend`.
5. When the change is finished, verify it in a browser (see "Testing") and run `pnpm gate`.

### Adding a New View

1. Create `public/views/my-view.js` with the default export component (copy `_template.js`).
2. Create `public/css/views/my-view.css` with a prefix of its own, and add its `<link>` to
   `spa.html`.
3. Register the route in **both** places: `ROUTES` in `spa.html` (the client-side route) and
   `spaRoutes` in `src/routes/portal.ts` (so a reload of that address serves the shell). With only
   the first, F5 on the page answers 404.
4. Add an importmap entry in `spa.html` for every new absolute module the view imports.
5. A public content page also gets an entry in `PUBLIC_PAGES` (`src/data/public-pages.ts`) for its
   title, description and sitemap line.
6. Add the keys to `locales/en.json`; Finnish and Spanish follow as described under "i18n".
7. Run `pnpm typecheck:frontend` and `pnpm check:importmap`, then verify the page in a browser.

---

## Admin Dashboard SPA

The admin dashboard (`/v1/admin`) is the operator's area inside the main SPA. It uses the same
Preact + HTM stack and the same components.

### Architecture

| Path | What it holds |
|------|---------------|
| `public/views/admin.js` | The shell: the tab registry, the frame and menu, `loadAll()`, the live-update reload |
| `public/views/admin/` | One `<name>-tab.js` per tab, and its parts as `<name>-tab.<part>.js` (for example `cors-tab.form.js`, `hooks-tab.runs.js`) |
| `public/views/admin/shared.js` | Helpers shared by the tabs |
| `public/js/services/admin.js` | The admin API service layer |
| `css/components/operator-frame.css`, `operator-menu.css` | The frame and the side menu |

The frame and the side menu are the `OperatorFrame` and `OperatorMenu` components. The admin pages
are drawn from the component library and write no class of their own.

### The tab registry

`NAV_GROUPS` in `admin.js` is the registry. Each group has a label key and a list of items:

```javascript
{ id: 'my-tab', key: 'dashboard.myTab', component: MyTab, count: 'myCount' }
```

`id` is the value of `?tab=` in the address, `key` is the menu label's locale key, `component` is
the imported tab, and `count` (optional) names the figure from the loaded counts that the menu shows
beside the label. `TAB_ALIASES` maps an old `?tab=` value to its current tab.

### Tab Component Contract

Every tab module in `public/views/admin/` must:

1. **Export a default Preact component** as the tab content.
2. **Accept the tab props.** The shell passes every tab the same object:
   `{ data, reload, session, navigate, locale, switchPage }`. `data` is what `loadAll()` fetched;
   `reload` runs it again; `switchPage(id)` opens another tab.
3. **Write all user-visible text through `t()`**, under `dashboard.*` or `admin.*`.
4. **Draw with the components** (`Section`, `Note`, `Action`, `List`, `Box`, `Figure`, ...) and the
   helpers in `./shared.js`.

```javascript
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Note } from '/components/Note.js';
import { Empty, ExpandableHelp } from './shared.js';

export default function MyTab({ data }) {
  const myData = data.mySection;
  if (!myData) return html`<${Empty} text=${t('dashboard.myEmptyMsg')} />`;

  return html`
    <${Note}>${t('dashboard.myExplain')}<//>
    <${ExpandableHelp} title=${t('dashboard.myHelpTitle')}>
      <p>${t('dashboard.myHelpDetail')}</p>
    </${ExpandableHelp}>
    <!-- tab content -->
  `;
}
```

### Shared admin helpers (`shared.js`)

| Export | Description |
|--------|-------------|
| `Badge` | `{ type, label }`: a coloured status badge |
| `StatsGrid` | `{ items }`: a grid of figures |
| `Row`, `EconRow` | A named row with a value |
| `ExpandableHelp` | `{ title, children, open }`: a section of help that opens and closes |
| `Empty`, `ErrorBox`, `Spinner` | Empty, error and loading states |
| `DataTable` | `{ headers, rows, scroll }`: a generic table |
| `useToast`, `Toast` | The admin toast |
| `num`, `dt`, `day`, `fmtUp`, `fmtBytes`, `shortDate`, `when` | Formatters (the first five come from `/js/format.js`) |

### Adding a New Admin Tab

1. Create `public/views/admin/my-tab.js` following the contract above.
2. Import it in `public/views/admin.js` and add an item to the right group in `NAV_GROUPS`.
3. Add API functions to `public/js/services/admin.js` if needed.
4. Add the keys under `dashboard.*` in `locales/en.json`; Finnish and Spanish follow as described
   under "i18n".
5. Draw with components. A look that no component has yet is a new component (see "Component
   Library"), not a rule in a view sheet.

### Admin API Service (`admin.js`)

Admin API calls go through `public/js/services/admin.js`. It imports `apiGet`, `apiPost`, `apiPut`
and `apiDelete` from `/js/api.js` and exports a named function per admin endpoint.

```javascript
export const getMyData    = ()         => apiGet('/v1/admin/my-endpoint');
export const updateMyData = (id, data) => apiPut(`/v1/admin/my-endpoint/${encodeURIComponent(id)}`, data);
```

### Admin i18n Keys

Admin keys live under `dashboard.*`, and the newer tabs under `admin.*`. Conventions:

| Pattern | Example | Usage |
|---------|---------|-------|
| `dashboard.{tabName}` | `dashboard.overview` | Tab label in the menu |
| `dashboard.{feature}Explain` | `dashboard.emailExplain` | The tab's explanation paragraph |
| `dashboard.{feature}...Help` | `dashboard.emailSmtpHelp` | `ExpandableHelp` title |
| `dashboard.{feature}...HelpDetail` | `dashboard.emailSmtpHelpDetail` | `ExpandableHelp` body |
| `dashboard.{feature}Empty` | `dashboard.marketplaceEmpty` | Empty state |
| `dashboard.cfg_{path}` | (no such key in `en.json` today) | A config setting's label: the path with dots as underscores. Without the key, `config-tab.js` shows the path's last segment |
| `dashboard.cfgGroup_{group}` | `dashboard.cfgGroup_boards` | A config group's heading |

---

## ES Module Cache Busting (Importmap + BUILD_ID)

**Problem:** an ES module stays in the browser's module registry for the whole SPA session. Once a
module is loaded, the browser reuses it without fetching it again, even after a server restart has
deployed new code.

**Solution:** `src/routes/portal-spa.ts` sets `BUILD_ID` (a timestamp) when the process starts, and
`serveSpa()` stamps the shell's first-party assets with `?v=BUILD_ID` on every response.
`src/routes/portal.ts` imports and re-exports `serveSpa()` and calls it for each SPA route.

**How it works:**

1. `spa.html` has an importmap with identity entries such as
   `"/js/services/foo.js": "/js/services/foo.js"`.
2. `stampAssets()` in `portal-spa.ts` appends `?v=BUILD_ID` to every importmap value that starts
   with `/` and ends in `.js` or `.mjs`, and to every first-party `<link rel="stylesheet">`: the view
   sheets, `theme.css`, `poster.css`, the component sheets and `/lib`.
3. `serveSpa()` injects `window.__B = "?v=BUILD_ID"`, and the dynamic imports in `ROUTES` append it
   (`import('/views/help.js' + B)`).
4. The same injected script polls `/v1/build` every 60 seconds and when the tab becomes visible. When
   the server reports a different build, the page reloads itself, so an open tab picks up a restart
   without a manual refresh.

**Rule: when you add a shared JS module** on an absolute path (`/js/services/foo.js`,
`/components/Bar.js`, `/lib/baz.js`), add an identity entry to the importmap in `public/spa.html`.
The stamp is added by the regular expression; no code change is needed.

**What needs no importmap entry:**

- Relative imports (`./profile/some-tab.js`): they resolve against a parent module that is already
  stamped.
- Bare specifiers already in the map (`preact`, `htm`).
- CSS files: `stampAssets()` stamps every stylesheet link.

**Key files:** `public/spa.html` (the importmap, the stylesheet links and `ROUTES`),
`src/routes/portal-spa.ts` (`BUILD_ID`, `serveSpa()`, `stampAssets()`).

Files under `public/` are also served `no-cache` with an ETag, so during development a reload
fetches an edited file without a restart.

---

## SSE Live Updates (Real-Time UI Refresh)

**Problem:** when data changes on the server (another user, an API call, a scheduled job), the page
must show it without a manual reload.

**Solution:** one server-sent events connection, debounced, that tells the page which data domains
changed.

**How it works:**

1. `public/lib/live-updates.js` holds the connection.
   - `connect(getJwt)` opens it: `POST /v1/events/ticket`, then `GET /v1/events?ticket=...`.
     Calls are reference-counted.
   - One browser tab holds the connection and relays events to the other tabs over a
     `BroadcastChannel`. A hidden tab does not re-fetch, and catches up once when it is shown again.
   - `subscribe(domains, fn)` and `onUpdate(fn)` register a listener; changes are collected over a
     one-second debounce.
   - `disconnect()` lowers the count and closes the connection at zero.
2. The profile shell (`public/views/profile.js`), the home (`views/home/index.js`) and the fleet
   view (`views/fleet.js`) connect on mount and dispatch the window event `aimeat-live-update`, with
   `detail.domains` set to the domains that changed.
3. A tab listens for that event and re-fetches its data.

**Rule: every profile or admin tab that shows server data listens for live updates**
(`.claude/rules/frontend.md`):

```javascript
useEffect(() => {
  const handler = () => loadData();
  window.addEventListener('aimeat-live-update', handler);
  return () => window.removeEventListener('aimeat-live-update', handler);
}, []);
```

To re-fetch only when a domain you show has changed, use `onLiveUpdate(domains, fn)` from
`/lib/live-updates.js`. It returns the cleanup function:

```javascript
useEffect(() => onLiveUpdate(['agent-tasks'], () => loadTasks()), [loadTasks]);
```

**Exceptions:** tabs that show only static or local data, tabs that only navigate, and push
notification preference tabs.

**The admin shell works differently.** `admin.js` subscribes with `onUpdate()` and reloads its
`data` prop silently, debounced by 1.5 seconds; a tab that renders `data` is refreshed with it. The
admin shell does not dispatch `aimeat-live-update`, so on `/v1/admin` an admin tab that loads its own
data and listens for that event hears only the events that other modules dispatch.

**Key files:** `public/lib/live-updates.js` (the connection), `public/views/profile.js` (the event
dispatcher for the profile tabs), `public/views/admin.js` (the admin reload).
