---
name: aimeat-design-language
description: "The look of the node's OWN screens under aimeat/public/ and aimeat/src/static/: the two faces (showroom outside, poster inside), the three type tokens every font on the site descends from, the four shapes, the colours, the wordmark, and the one place a value is changed (theme.css tokens), with the token map and the shape tables in references/. Use only when changing or judging one of those screens, or a font or colour token they read. Not for an app published on the node, whatever its name: an app forks a Design Book genre and has a look of its own."
metadata:
  version: 1.14.0
  updated: 2026-11-15
  owner: Jouni Miikki
---

# The AIMEAT design language

One product, two faces. The **showroom** is what a visitor sees before signing in: the front page,
how it works, for your business, help, members, the change log. The **poster** is what a person sees
once inside: the home, every profile tab, the chat, the sign-in dialog, the app catalog. They share
the type, the colours, the shapes and the rules; they differ in how loud they are. A third register,
the **classic shell** (rounded controls, cards), remains under the admin dashboard and the oldest
views and is not extended; it reads the same type tokens. Its rules (buttons, cards, badges, the
segmented control, the toast, the top bar) live in `aimeat/public/css/components/`, one sheet each.
That folder also holds the library parts Settings & Controls is drawn from (the page kit, the
listing, the facts, the fields, the timeline, and every part only one page draws), one sheet
each, each with its entry in the component catalogue (`src/services/ui-library/entries-*.ts`) and
a demo in the design lab; they read the shape values like `poster.css` does. Since 2026-09-27 a
Settings & Controls page writes no class at all: it calls the components (`components/Action.js`,
`Mark.js`, `Note.js`, `List.js`, `Facts.js`, `Field.js`, `SettingsPage.js` and the rest) with data,
and a component draws only its own class names and the `poster.css` shapes below. The admin pages
(since 2026-09-27) and appcat, the app catalogue rebuilt on the components at `/v1/appcat`, are
drawn the same way; where the old app catalogue drew a thing in its own way, that look is a named
option of the component reading the tokens, so a theme reaches it too.

Type and colour tokens live in `aimeat/public/css/theme.css`, and nothing else does:
`pnpm check:theme-tokens` refuses a rule there that is not a custom property. Font sizes and
weights are tokens too (`--text-2xs` … `--text-xl`, `--weight-regular` … `--weight-heavy`), so a
theme can change the type scale in one place. `--text-2xs` is 11px, the smallest text a page shows
(the Status and the time read it; Jouni, 2026-10-25): a size below it is a finding. The shared shapes live in
`aimeat/public/css/poster.css`. A view composes a shape by class and owns its layout. Change the
token or shape at its home; `references/token-map.md` and `references/shapes.md` show which surfaces follow. Existing copies are
recorded migration debt, not examples for a new view.

## The faces

Three lines in `theme.css` are the whole typography; every other font token on the sheet is an
alias of one of them, so a face changes once and reaches every page, outside and in:

| Token | Value | Where |
|---|---|---|
| `--font-headline` | **Fjalla One**, uppercase, one weight | every headline, big numeral, sticker, slab and tab (the wordmark is its own token, below) |
| `--font-body` | **Archivo** | everything read as a sentence on every face: body 400, emphasis 600, actions and row names 700 (the vendored Archivo carries 400 to 700, so an 800 would be synthesised); also form controls and the classic shell |
| `--font-mono` | **JetBrains Mono** | identifiers, keys, crumbs, addresses, commands, small labels that name a machine thing |

The aliases a view sheet reads, and what they resolve to: `--font-showroom` and `--font-poster` are
`--font-headline`; `--font-showroom-body`, `--font-poster-section` and `--font` are `--font-body`.
A sheet picks the alias that names its face (showroom outside, poster inside), and never writes a
family name. A face has to be served to be used: every family is self-hosted under
`aimeat/public/lib/fonts/` (woff2, latin and latin-ext, SIL OFL) and declared in
`aimeat/public/lib/aimeat-fonts.css`, which `aimeat-theme.css` imports and the standalone pages
link. Nothing on the node links a font CDN, and the CSP refuses one; a new face is vendored
there, with its row in `lib/fonts/LICENSE.md`, before a token names it. The list a theme may
choose from is `THEME_FACES` in `src/services/themes/tokens.ts`, and the Design Book's copy is
`SERVED_FONT_FAMILIES` in `src/services/app-ui/signature-tokens.ts`; a new face goes into both.
Since 2026-11-04 the node serves thirty-three families: the ten house and palette faces above, and
twenty-three for themes and apps that want a face of their own (Instrument Serif and Sans, Schibsted
Grotesk, Bricolage Grotesque, Syne, Unbounded, Gloock, Mona Sans, Hubot Sans, Geist Mono, Martian
Mono, Press Start 2P, Selawik, IBM Plex Sans and IBM Plex Mono, vendored for the SOC console's
accepted design on 2026-10-09, Newsreader, the text face of the kirjapaino look, vendored on
2026-10-17 with the Fraunces italic, Michroma, the display face of the tdr look, vendored on
2026-10-22 with the IBM Plex Mono 600, Pixelify Sans, Baloo 2 and Nunito for the Tiilitaivas
theme on 2026-11-04, and on the same day Source Serif 4 and Source Sans 3 for the vuosikertomus
look and Hanken Grotesk for the konserni look).

**A second theme ships with the node: Tiilitaivas** (`src/services/themes/tiilitaivas.ts`), optional
and read only like AIMEAT, which stays the default. Its rules differ from the poster's on purpose:
rounded corners, hard offset shadows in its own shadow colour, and a pixel headline face that stops
at 20 px. It sets `--font-poster`, `--font-showroom` and `--font-display` to the body face and names
`--font-headline` only on the large headings, so a new component that reads a headline alias at a
small size stays readable in it. A component that reads `--font-headline` directly at a small size
goes on the list in that file.

**A face can also be added to the running node, with no commit and no deploy** (the font manager,
since 2026-10-03): the operator adds it on Admin → Themes & Styles → Fonts, or an AI does with
`aimeat_theme_font_save` (its woff2 files, the weight and style of each, its licence, copyright
holder and source). It is stored under the node's own principal, served by
`/v1/themes/fonts.css` (which the page shell links after the base faces), and from the moment a
file arrives every style and the Design Book bench may choose it, because every reader of the two
lists above reads the merged list in `src/services/themes/font-registry.ts`. The licence rule
(Jouni, 2026-10-03): what the node ships is free licences only, and stays vendored with its row in
`LICENSE.md`; a face the operator adds is always marked as added, never as base setup, and the
operator answers for it. Ask for its licence and copyright holder before adding it. Without them it
is marked "licence unknown", which means nobody can say it was lawfully obtained, and it shows on
the Fonts tab, the Libraries page and the compliance report. Owners do not add theme faces; a font
an owner keeps in storage for an app (an `@font-face` from the app's own origin) is theirs to
answer for, and the operator sees it only as an inventory. A published app on the kit does not yet
load an added face: the kit's sheet imports `aimeat-fonts.css`, which does not import
`/v1/themes/fonts.css`.

Fjalla One is condensed and ships one cut, so a headline is short: one sentence, the second half in
coral when it carries the point. Never synthesise a bold on a single-weight face. A monospace family
is `var(--font-mono)`, never `monospace` or a hand-typed stack; the view sheets were swept of both
on 2026-08-29.

**A headline is set with the face's own spacing, and the spacing is a token too.** Every poster
headline reads `--font-poster-tracking` (`.01em`) and `--font-poster-leading` (`1`); a sheet never
writes a tracking or a line-height for a headline of its own. The values that suited Archivo Black
(`-.035em`, `.9`) made Fjalla One's letters touch and its lines collide the day the face changed
(Jouni, 2026-08-29: "as if the letters ran into each other"), which is why they live beside the face.
Under a headline, the running text stays lighter than the headline reads: rows and row names at
`--font-poster-strong-weight` (600), never 800, so a list does not out-shout its own title.

**The wordmark is a mark, not a headline.** `AIME♥AT` is set in `--font-wordmark` (Archivo Black)
whatever face the headlines wear; a headline change never reaches it.

Sizes that recur (rem, at 16px): showroom front hero `clamp(2.4rem, 6.6vw, 6rem)` with a coral
offset text-shadow of `.075em`; showroom index hero `clamp(2rem, 3.6vw, 2.9rem)`; showroom section
headline `clamp(1.5rem, 2.6vw, 2rem)`; poster page title `2.8rem` at the poster tracking and
leading tokens; poster section headline `1.9rem`; the small coral label `.72rem`, 800, tracking `.1em`,
uppercase; body `.95rem` to `1.1rem`, line-height `1.6`.

## The colours

| Token | Light | Dark | Meaning |
|---|---|---|---|
| `--text` (ink) | `#1A1A2E` | `#EDEEF2` | words, frames, rules, the loud slab inside |
| `--bg` (paper) | `#FAFAF8` | `#14151A` | the page |
| `--card-bg` | `#FFFFFF` | `#1C1E26` | a box on the page |
| `--text-dim` | `#6B7280` | `#A4A9B6` | the quieter line, placeholders |
| `--border` | `#E5E7EB` | `#33363F` | hairline rows |
| `--accent` (coral) | `#E8564A` | `#FF6F62` | the heart, AT, small labels, the hot slab outside, the open thing |
| `--sun` | `#FFB52E` | same | the selected tab, the sticker, the shadow under a loud action, the sun band |
| `--on-sun` | `#1A1A2E` | same | words on the sun stay ink in every theme |
| `--success-fg` | `#047857` | `#6EE7B7` | a rule met, a live dot |
| `--ink-ground`, `--on-ink-ground` | `--text`, `--bg` | a ground deeper than the page, `--text` | a dark block with light words and sun labels (the contents rail, the page thumbnail): it stays dark in dark mode so its sun labels read; a style may set both |

Ink and paper swap in the dark theme; the sun does not, which is why `--on-sun` exists. A block
whose ground is ink and whose labels are on the sun uses `--ink-ground`, never `--text`: in dark mode
`--text` is light, and sun on it cannot be read. Frames and
solid shadows are drawn with `--text`, so a dark page shows a light line on dark ground rather than
ink painted on it. A palette (`data-palette`) may replace the accent and the grounds; nothing else
is written for a palette.

## The four shapes

1. **A section starts with a slab (B1).** Poster: paper words on an ink headline slab, a 6px sun
   stripe below it; the selected tab's content has a 4px sun left edge. A row inside the section
   keeps its 1px `--border` line, or a 3px ink top rule when the row is the thing. Showroom: a 3px ink frame
   with a solid offset shadow, `8px 8px 0`, in the named sun or coral cut.
   Nothing is tilted. Nothing has a radius.
2. **A box for a thing that must read as one object.** 2px ink frame on `--card-bg` for a sample,
   a schema, a command; 3px ink frame with a `12px 12px 0 --sun` shadow for a dialog; `8px 8px 0
   --sun` for an opened record. The aside that says the thing out loud is a **3px dashed coral
   box** on `--card-bg`.
3. **One loud action, and underlined words for the rest.** Poster: an ink slab, paper text,
   `4px 4px 0 --sun`, `.8rem` uppercase 600; hover moves it into its shadow. The home's one large
   chat door is `.poster-slab--large`, `1.02rem`, with an `8px 8px 0 --sun` shadow. Showroom: a slab in
   the display face, `3px` ink frame, `6px 6px 0` ink shadow; the hot one is coral with white
   words, the sun one is sun with ink words. One hot slab per page. Every other way on is a word
   with an underline: 3px ink under a poster action, 3px coral under a showroom door; hover turns
   it coral.
4. **A chip is square and mono.** The shared chip has a 1px ink frame, JetBrains Mono `.68rem`,
   weight 500, no radius. The selected tab sits on the sun with ink words and the action's 3px
   underline. These are the source cuts selected for the shared classes; existing sheets with
   other chip sizes remain migration questions.

Fields on the poster face are one 3px ink underline (coral on focus), a placeholder in `--text-dim`
at 600; a many-line field is the 2px box. The small coral label above a field is the only place
the accent appears at that size. A field's hint (the line under it) shows only while the person
is in that field or has written in it; a form is read as its labels until one is being filled.

**A dialog has three ways out, and one rule.** An X in the top-right corner, always, drawn as a
26px ink-framed square with a 2.5px stroke (people look there first; Jouni went hunting for it
on 2026-08-29 and found Cancel only by reading). Escape. And a click on the dim page behind the
dialog. The last two close only while nothing has been typed: a half-filled form must never be
lost to a stray click or key. Cancel under the form stays for the people who read.
The footer's actions are the library's (Jouni's decision "Dialog actions", 2026-09-24): a way out or
a side door (Cancel, "Change password…") is `.poster-action`, the one "do it" is
`.poster-slab.poster-slab--control`, and a delete adds `.poster-slab--danger`. On a phone the dark
block takes the rest of the row.

**Bands.** An ink band (`--text` ground, `--bg` words, the headline in `--sun`, items in 2px
frames at 28 % opacity) for the argument that closes a page; a sun band (`--sun` ground, ink
words, a 3px ink rule under it) for the money.

## The wordmark and the crumb

`AIME` in ink, the heart and `AT` in coral, set in `--font-wordmark` with `-.01em` tracking; the
heart is an inline SVG, never a glyph. On a self-hosted node the crumb next to it shows that node's
domain in mono: the domain says where, the wordmark says what the software is. The name is a
prism: AI and ME, at work on something, and AI-MEAT, the substance an AI is made of here.

## What is not done

- **No emoji anywhere in the interface.** Not as an icon, not in front of a heading, a button, a
  menu item, a dialog title, a section label or a notice, and not inside a translation string,
  where they hide from a reviewer until the screen is up. They read as noise and cheapen the
  product (Jouni, 2026-08-29, after 142 of them were stripped from the app catalog's strings in
  one pass). Icons are inline SVG on a 16/20/24 grid. The four glyphs that carry meaning in text
  are `✓ ✗ → ↩`; a fifth is a decision, not a habit. The one emoji that stays is data: the icon
  a person chose for their own app.
- No tilt, no rotation, no gradient, no drop-shadow blur, no `rgba(255,255,255,…)`, no radius on a
  poster or showroom surface.
- No second loud action on a page. No colour in a single place written as a hex in a view sheet.
- No font-family written out in a stylesheet or a component; the token, with its fallback stack,
  is the only spelling.
- No element a person can neither use nor decide from: no tag wall that does nothing when pressed,
  no feature list in bullets. Each thing on a screen is something to do, or the fact a decision
  needs.
- No word from the system's vocabulary before the person is doing the thing it names. Memory,
  morsels, MCP or the catalogue are explained where they are in use, in the same sentence, never
  as a list up front.
- No empty "coming soon" place. A screen shows real content: real notices on a board, real apps in
  the catalogue.
- No quiet text below a 4.5:1 contrast with its ground, in either theme: the dim line is quieter
  than the body and still readable by tired eyes.

(The four lines above came from the repository's UX principles page, deleted on 2026-10-11. Its other
rules were superseded: copy is plain rather than crafted to astonish, and the copy-a-prompt box ranks
under the MCP connection, not above it.)

## Changing a value, and how far it reaches

Change the token in `aimeat/public/css/theme.css`; a new face is first vendored into
`aimeat/public/lib/fonts/` and declared in `aimeat/public/lib/aimeat-fonts.css`. Then the surfaces
that read the token follow on their own. Some do not: the standalone pages name their faces in their
own inline CSS, and code that runs outside the node carries literal values. **Before you change a
token, read `references/token-map.md`**: it lists every sheet a token reaches and the surfaces that
need a hand, and it is the checklist for the change.

### The shape values: what a theme changes once

The four shapes above are the built-in theme's. Their corners, frames, shadows and letter case are
tokens in `theme.css` (`--shape-*`), and every component sheet reads them instead of writing a
value, so a theme that sets them reaches every component, the ones made later included (Jouni,
2026-09-24: "katsoo että pebble syntyy myös niille uusille tehdyille komponenteille"). A theme sets
them in Themes & Styles (the Shapes tab) or with `aimeat_theme_save` `shapes`; colours stay the
style's, faces stay the style's.

The values, token by token, are in `references/shapes.md` ("The shape values").

**A component sheet reads a shape value wherever one exists**, and writes its own corner, frame
width, shadow or letter case only where none does (a circle, a 1px hairline, a 4px sun bar). A
component made in a later phase is shown in the lab in the built-in theme and in Pebble, the
example theme that sets every value (its record travels with the UI plan as `fixtures/pebble.json`
and is loaded into a sandbox, never seeded into a node); one
that does not follow Pebble without CSS of its own is a finding. `pnpm check:shape-tokens` holds
it: a ratchet of the literals still written, which only falls.

### Shape to class: one CSS home

`poster.css` is linked after `theme.css` in the SPA. Its current declarations are the executable
values of these shapes. Compose them in markup; a view sheet keeps its grid, placement and
dimensions. It does not re-declare the shape's font, rule, fill, padding or shadow.

The shape-to-class table, every tone of every class, is in `references/shapes.md` ("Shape to class").

Only page and section headline sizes take per-view properties: `--poster-page-size` and
`--poster-section-size`, set on the view root. A deviating cut becomes a shared modifier only
when at least two pages use it or the design language can name its role. A one-page cut stays
as it is unless Jouni approves folding it into the canonical value by name; a shared part is
extracted from the pages as they look now, with their values, never designed anew.
Modifiers name a role or size, never a page. Each shape has at most two size modifiers,
`--small` and `--large`; a third size raises a shape question in the notes and does not create
another modifier. A view never re-declares a modifier's values.

The shared variants, with their values and the pages that share each cut, are in `references/shapes.md` ("Shared variants").

The parts a page is composed of are components: one module in `public/components/` (the markup)
and one sheet in `public/css/components/` (the look, composing the shapes above), named by role:
`StepCard` and `step-card.css`, `Turn` and `turn.css`. The home and the chat are built from them and
have no sheet of their own since 2026-09-23; the values moved unchanged. Page compositions stay in
the page files and use only library components.

**The component catalogue says what exists.** `GET /v1/ui/components` and
`aimeat_ui_component_list` / `aimeat_ui_component_get` give each part's data shape, when to use it,
its variants (the class or prop for each), one example, the theme tokens its sheet reads and the
pages that draw it; the shapes of `poster.css` are in it too. Read it before building a page and
reuse the part that exists. A new component gets an entry in `aimeat/src/services/ui-library/`
(the purpose half, written by hand), then `pnpm build:ui-library` reads the rest from the files.
`pnpm check:ui-library` refuses a sheet with no entry, a variant class its sheet does not carry, an
"active" part no page draws and stale facts. **To see the parts**, open aimeat-design-lab in the
admin pages (group Design): every entry drawn live by its real component with its example, every
variant in light and dark and at a phone width. Its demos live in `public/views/design-lab/`, and
the check refuses an entry without one. This catalogue is the node's own interface only;
Atelier's catalogue of app parts is a different thing and shares nothing with it.

Run `pnpm check:poster-shapes` from `aimeat/`. It scans view and component sheets and refuses
any new per-file pattern count. `pnpm debt` shows the remaining copies. Lower the baseline after
a migration; `--record` requires an explicit decision to forgive debt. A green gate proves no
new copies, not that the remaining baseline is zero. Verify migrations at all three viewports
in both themes against the original page, side by side on the same data: a migration passes only
with no visible difference, and any difference goes on a list for Jouni's approval before it stays
(rolled back 2026-09-23 when "unification" was allowed to excuse differences).

### The kit an app is built from has its own contract

An app on the Atelier track does not read `theme.css`; it reads the `--ak-*` contract in
`aimeat/public/lib/aimeat-atelier.css`, where the looks are `[data-ak-look]` blocks and the pace of
every entrance is four tokens, `--ak-motion` (how long), `--ak-ease` (the curve),
`--ak-enter-distance` (how far a row rises) and `--ak-enter-stagger` (the beat between rows),
with the spring hand beside them in `--ak-spring-*`, read off the element the kit is moving. Each
`--ak-*` token falls back to the matching AIMEAT theme token and then to a literal, so an app
served with `theme.css` inherits the house and an app served without it still looks finished. The
same contract is documented to an AI in `aimeat/src/data/library-packs/sdk-ui.ts`, which is the
`aimeat-atelier` pack's `aiDoc` and the answer an agent gets when it asks what the kit is. So the
token map reaches the kit too: a value changes in one place, and the apps built on it follow.

`--ak-tilt` belongs to an app's own register, not to this skill's flat poster face. The difference
is scope, not disagreement: a genre that commits to a tilted photograph is that app's statement,
and the house surfaces stay flat.

A page that hardcodes its palette says so: `<meta name="aimeat-light" content="fixed">`, and the
login pill's light/dark control renders disabled there and says why rather than doing nothing.
Absent, or `content="follows"`, means the switch works, which is what a page whose every colour is
a token wants. The signal is the page's own declaration and not its register, because the register
names what a page IS while keeping a fixed palette is a fact about how it was built. And the kit's light `--ak-accent` carries a lightness cap,
because white is the action ink on paper and the house coral at `#E8564A` measured 3.58:1 under it:
inside the kit it deepens to `#cf3e35`; the house surfaces above keep the coral as it is.

A finished surface is verified in a real browser at 1280×900, 390×844 and 1280×460 (skill
`aimeat-frontend-verify`), and the words on it follow `aimeat-writing`.
