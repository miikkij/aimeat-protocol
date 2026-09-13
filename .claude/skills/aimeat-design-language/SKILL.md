---
name: aimeat-design-language
description: "The AIMEAT design language in words and in numbers: the two faces (showroom outside, poster inside), the three type tokens every font on the site descends from, the four shapes, the colours, the wordmark, and the one place a value is changed (theme.css tokens) with the map of every surface a token reaches. Use before designing or styling anything that carries the AIMEAT name, before changing a font or a colour, and to judge whether a screen looks like this product."
metadata:
  version: 1.6.0
  updated: 2026-09-13
  owner: Jouni Miikki
---

# The AIMEAT design language

One product, two faces. The **showroom** is what a visitor sees before signing in: the front page,
how it works, for your business, help, members, the change log. The **poster** is what a person sees
once inside: the home, every profile tab, the chat, the sign-in dialog, the app catalog. They share
the type, the colours, the shapes and the rules; they differ in how loud they are. A third register,
the **classic shell** (rounded controls, cards), remains under the admin dashboard and the oldest
views and is not extended; it reads the same type tokens.

Type and colour tokens live in `aimeat/public/css/theme.css`; the shared shapes live in
`aimeat/public/css/poster.css`. A view composes a shape by class and owns its layout. Change the
token or shape at its home; the maps below show which surfaces follow. Existing copies are
recorded migration debt, not examples for a new view.

## The faces

Three lines in `theme.css` are the whole typography; every other font token on the sheet is an
alias of one of them, so a face changes once and reaches every page, outside and in:

| Token | Value | Where |
|---|---|---|
| `--font-headline` | **Fjalla One**, uppercase, one weight | every headline, big numeral, sticker, slab and tab (the wordmark is its own token, below) |
| `--font-body` | **Archivo** | everything read as a sentence on every face: body 400, emphasis 600, actions and row names 700 to 800; also form controls and the classic shell |
| `--font-mono` | **JetBrains Mono** | identifiers, keys, crumbs, addresses, commands, small labels that name a machine thing |

The aliases a view sheet reads, and what they resolve to: `--font-showroom` and `--font-poster` are
`--font-headline`; `--font-showroom-body`, `--font-poster-section` and `--font` are `--font-body`.
A sheet picks the alias that names its face (showroom outside, poster inside), and never writes a
family name. A face has to be served to be used: every family is self-hosted under
`aimeat/public/lib/fonts/` (woff2, latin and latin-ext, SIL OFL) and declared in
`aimeat/public/lib/aimeat-fonts.css`, which `aimeat-theme.css` imports and the standalone pages
link. Nothing on the node links a font CDN, and the CSP refuses one; a new face is vendored
there, with its row in `lib/fonts/LICENSE.md`, before a token names it.

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

Ink and paper swap in the dark theme; the sun does not, which is why `--on-sun` exists. Frames and
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

## Changing a value, and how far it reaches

Change the token in `aimeat/public/css/theme.css`; a new face is first vendored into
`aimeat/public/lib/fonts/` and declared in `aimeat/public/lib/aimeat-fonts.css`. Then the surfaces
below follow on their own. The standalone pages (`public/connect*.html`, `public/front-*.html`,
`public/wiifm*.html`, `public/aimeat-developers.html`, the app catalog's template) link that
same sheet and name their faces in their own inline CSS, so a change of face reaches them only
by hand; the list here is the checklist.

| Token | Read by |
|---|---|
| `--font-headline` | through `--font-showroom`: `landing-showroom.css`, `landing.css`, `help.css`, `members.css`, `changelog.css`, `build-story.css`, `static-page.css`, `portal-dev.css`; through `--font-poster`: `home.css`, `chat.css`, `profile.css`, `profile-poster.css`, `surface.css`, `app-catalog-poster.css`, the sign-in dialog (`sdk-libs/auth/modal-styles.js`), the top bar in `theme.css` |
| `--font-body` | all of the above through `--font-showroom-body` and `--font-poster-section`, and every classic-shell sheet (admin, the older tabs, form controls) through `--font` |
| `--font-mono` | every sheet that shows an address, a command, an id or a key; no sheet spells a monospace family |
| `--font-headline` again, through the palette bridge | `lib/aimeat-theme.css` gives every `h1`-`h6` the palette's display face, and the house palette's display face is `var(--font-headline, 'Archivo Black', …)`: on the node the classic shell's headings follow the token; a published app without `theme.css` keeps the vendored Archivo Black; a chosen palette (paper, circuit, …) keeps its own face on purpose |
| `--sun`, `--on-sun`, `--accent`, `--text`, `--bg` | every sheet; the auth pill and dialog read them with a fallback so an app origin without the tokens still gets the design |

### Shape to class: one CSS home

`poster.css` is linked after `theme.css` in the SPA. Its current declarations are the executable
values of these shapes. Compose them in markup; a view sheet keeps its grid, placement and
dimensions. It does not re-declare the shape's font, rule, fill, padding or shadow.

| Shape | Class |
|---|---|
| Page title | `.poster-page-title` |
| Opened record title | `.poster-record-title` |
| Section and B1 headline | `.poster-section`, `.poster-section-title` |
| Area governed by the selected tab | `.poster-panel` |
| Hairline row; row that is the thing | `.poster-row`; `.poster-row--thing` |
| Small coral label | `.poster-label` |
| Underlined action | `.poster-action` |
| Tab and selected tab | `.poster-tab`, `.poster-tab.is-on` |
| Loud action and the home's large door | `.poster-slab`, `.poster-slab--large` |
| Box; frame; dialog; opened record | `.poster-box`; `.poster-frame`; `.poster-dialog`; `.poster-record` |
| Dashed coral aside | `.poster-aside` |
| Mono chip; crumb | `.poster-chip`; `.poster-crumb` |
| Numeral row and its number | `.poster-stat`, `.poster-stat-number` |
| Showroom ink band and sun band | `.showroom-band`, `.showroom-band--sun` |
| Showroom section and coral shadow | `.showroom-section`, `.showroom-section--coral` |
| Showroom underlined door | `.showroom-door` |
| Showroom slab and its named colours | `.showroom-slab`, `--hot`, `--sun`, `--ink` modifiers |

Only page and section headline sizes take per-view properties: `--poster-page-size` and
`--poster-section-size`, set on the view root. A deviating cut becomes a shared modifier only
when at least two pages use it or the design language can name its role. A one-page cut folds
into the canonical value. Record that normalization in the wish's notes with the page, old
value, new value and before/after screenshots. This visual change is permitted by brief 10.7.
Modifiers name a role or size, never a page. Each shape has at most two size modifiers,
`--small` and `--large`; a third size raises a shape question in the notes and does not create
another modifier. A view never re-declares a modifier's values.

| Shape | Shared variant | Values and reason |
|---|---|---|
| Loud action | `.poster-slab--large` | 1.02rem, 8px sun shadow; the named big door role (brief 10.3). Base stays .8rem, 600, 4px sun shadow. |
| Box | `.poster-box--avatar` | Square initials mark, .95rem poster face, no padding or margin, transparent ground; Contacts, Email and Notifications share this cut. Dimensions remain layout. |
| Box initials mark | `.poster-box--avatar.poster-box--small` | .85rem; Apps, Companies and MCP share the smaller initials cut. |
| Box | `.poster-box--meter` | Paper ground, no padding or margin, sun fill for SVG data geometry; the filled numerical meter role. |
| Box meter | `.poster-box--quota` | Card ground with coral consumption; `.is-full` changes the fill to danger. The quota meter is a named data role, with its ratio carried by SVG geometry. |
| Aside | `.poster-aside--small` | .9rem 1.1rem padding, .92rem / 1.55 text; the compact explanation used throughout organism settings and admin pages. |
| Aside | `.poster-aside--large` | 1.25rem 1.5rem padding, surrounding body size and leading; Members and the shared human contact card. |
| Aside | `.poster-aside--irreversible` | Solid coral border; the named irreversible-act explanation, composed with the same aside geometry. |
| Numeral | `.poster-stat-number--small` | 1.35rem, unit leading and normal tracking; the recurring row number in Access, Data Wallet, Discover, Offers, Scheduler, Wallet and admin rosters. |
| Numeral | `.poster-stat-number--large` | 3.4rem; Database and Metrics share the larger headline count. Base stays 3rem. The source phone cut is 2.2rem at 560px for base and large. |
| Numeral | `.poster-stat-number--step` | Coral for the numbered instruction step, repeated across admin Apps, CORS, Cortex, MSM, Portal and Prompts; composes with the compact numeral. |
| Numeral | `.poster-stat-number--band` | Paper words on the ink band; the number keeps its shared typography. |
| Record title | `.poster-record-title--small` | 1.8rem and the poster leading; Agents and Extensions share this cut. Base 1.9rem / 1.05 is shared by Boards, CSM and Skills. |
| Showroom band | `.showroom-band--sun` | Sun ground and ink words; the money band role. |
| Showroom section | `.showroom-section--coral` | 8px coral shadow; the named coral room cut. |
| Showroom slab | `.showroom-slab--hot`, `--sun`, `--ink` | Named hot, sun and ink action colours; each shares the showroom slab geometry. |

Run `pnpm check:poster-shapes` from `aimeat/`. It scans view and component sheets and refuses
any new per-file pattern count. `pnpm debt` shows the remaining copies. Lower the baseline after
a migration; `--record` requires an explicit decision to forgive debt. A green gate proves no
new copies, not that the remaining baseline is zero. Verify migrations at all three viewports
in both themes; permitted differences are B1 headline/panel reflow and documented single-page
normalizations under brief 10.7.

### The kit an app is built from has its own contract

An app on the Atelier track does not read `theme.css`; it reads the `--ak-*` contract in
`aimeat/public/lib/aimeat-atelier.css`, where the looks are `[data-ak-look]` blocks and the pace of
every entrance is four tokens — `--ak-motion` (how long), `--ak-ease` (the curve),
`--ak-enter-distance` (how far a row rises) and `--ak-enter-stagger` (the beat between rows) —
with the spring hand beside them in `--ak-spring-*`, read off the element the kit is moving. Each
`--ak-*` token falls back to the matching AIMEAT theme token and then to a literal, so an app
served with `theme.css` inherits the house and an app served without it still looks finished. The
same contract is documented to an AI in `aimeat/src/data/library-packs/sdk-ui.ts`, which is the
`aimeat-atelier` pack's `aiDoc` and the answer an agent gets when it asks what the kit is. So the
map above reaches the kit too: a value changes in one place, and the apps built on it follow.

`--ak-tilt` belongs to an app's own register, not to this skill's flat poster face. The difference
is scope, not disagreement: a genre that commits to a tilted photograph is that app's statement,
and the house surfaces stay flat.

A page that hardcodes its palette says so: `<meta name="aimeat-light" content="fixed">`, and the
login pill's light/dark control renders disabled there and says why rather than doing nothing.
Absent, or `content="follows"`, means the switch works, which is what a page whose every colour is
a token wants. The signal is the page's own declaration and not its register, because the register
names what a page IS while keeping a fixed palette is a fact about how it was built. And the kit's light `--ak-accent` carries a lightness cap,
because white is the action ink on paper and the house coral at `#E8564A` measured 3.58:1 under it —
inside the kit it deepens to `#cf3e35`; the house surfaces above keep the coral as it is.

Code that runs **outside** the node cannot read a token: the portfolio prompt a person carries to
their own AI, the auth library's fallbacks, an app built elsewhere. Those carry the literal values
from the table above and are the second half of the checklist when a value changes.

A finished surface is verified in a real browser at 1280×900, 390×844 and 1280×460 (skill
`aimeat-frontend-verify`), and the words on it follow `aimeat-writing`.
