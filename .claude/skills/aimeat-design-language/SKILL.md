---
name: aimeat-design-language
description: "The AIMEAT design language in words and in numbers: the two faces (showroom outside, poster inside), the four shapes, the colours, the wordmark, and the one place a value is changed (theme.css tokens) with the map of every surface a token reaches. Use before designing or styling anything that carries the AIMEAT name, before changing a font or a colour, and to judge whether a screen looks like this product."
metadata:
  version: 1.1.0
  updated: 2026-08-29
  owner: Jouni Miikki
---

# The AIMEAT design language

One product, two faces. The **showroom** is what a visitor sees before signing in: the front page,
how it works, for your business, help, members, the change log. The **poster** is what a person sees
once inside: the home, every profile tab, the chat, the sign-in dialog, the app catalog. They share
the colours, the body face, the shapes and the rules; they differ in the headline face and in how
loud they are. A third register, the **classic shell** (DM Sans, rounded controls), remains under
the admin dashboard and the oldest views and is not extended.

Every value in this document is a token in `aimeat/public/css/theme.css`. A view sheet reads the
token; it never writes a face or a colour out in full. When a value changes, it changes in that one
file, and the map at the end says which surfaces follow.

## The faces

| Token | Value | Where |
|---|---|---|
| `--font-showroom` | **Fjalla One**, uppercase, one weight | showroom headlines, tabs, slabs, stickers |
| `--font-poster` | **Archivo Black**, one weight (400 is its only cut) | poster page titles, big numerals, the wordmark |
| `--font-poster-section` | **Archivo** regular, uppercase | the section headline under a poster page title |
| `--font-showroom-body` | **Archivo** | everything read as a sentence on both faces: body 400, emphasis 600, actions and row names 700 to 800 |
| `--font-mono` | **JetBrains Mono** | identifiers, keys, crumbs, small labels that name a machine thing |
| `--font` | DM Sans | the classic shell only |

Fjalla One and Archivo Black are condensed or heavy, so a headline set in either is short: one
sentence, the second half in coral when it carries the point. Never synthesise a bold on a
single-weight face.

Sizes that recur (rem, at 16px): showroom front hero `clamp(2.4rem, 6.6vw, 6rem)` with a coral
offset text-shadow of `.075em`; showroom index hero `clamp(2rem, 3.6vw, 2.9rem)`; showroom section
headline `clamp(1.5rem, 2.6vw, 2rem)`; poster page title `2.8rem`, line-height `.9`, letter-spacing
`-.035em`; poster section headline `1.9rem`; the small coral label `.72rem`, 700, tracking `.1em`,
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

1. **A section under a rule.** Poster: a 3px ink rule on top, no fill, no frame; a row inside it
   sits over a 1px `--border` line (2px ink when the row is the thing). Showroom: a 3px ink frame
   with a solid offset shadow, `6px 6px 0`, the shadow colour turning down the row: coral, ink, sun.
   Nothing is tilted. Nothing has a radius.
2. **A box for a thing that must read as one object.** 2px ink frame on `--bg-dim` for a sample,
   a schema, a command; 3px ink frame with a `12px 12px 0 --sun` shadow for a dialog; `8px 8px 0
   --sun` for an opened record. The aside that says the thing out loud is a **3px dashed coral
   box** on `--card-bg`.
3. **One loud action, and underlined words for the rest.** Poster: an ink slab, paper text,
   `4px 4px 0 --sun`, `.8rem` uppercase 600; hover moves it into its shadow. Showroom: a slab in
   the display face, `3px` ink frame, `6px 6px 0` ink shadow; the hot one is coral with white
   words, the sun one is sun with ink words. One hot slab per page. Every other way on is a word
   with an underline: 2px ink under a poster action, 3px coral under a showroom door; hover turns
   it coral.
4. **A chip is square and mono.** 2px frame in the current colour, JetBrains Mono `.68rem` to
   `.72rem`, weight 500, no radius. The selected chip, tab or row sits on the sun with ink words
   and a 2px ink rule under it.

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

`AIME` in ink, the heart and `AT` in coral, set in `--font-poster` with `-.01em` tracking; the
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

Change the token in `aimeat/public/css/theme.css` and add the face to the Google Fonts line in
`aimeat/public/spa.html` if it is a new face. Then the surfaces below follow on their own. Static
pages that carry their own font link (`public/front-demo*.html`, `public/wiifm*.html`,
`src/static/app-catalog.html`) are the exception: they are edited by hand, and the list here is
the checklist.

| Token | Read by |
|---|---|
| `--font-showroom` | `landing-showroom.css`, `landing.css`, `help.css`, `members.css`, `changelog.css`, `build-story.css` |
| `--font-poster` | `home.css`, `chat.css`, `profile.css`, `profile-poster.css`, `surface.css`, `app-catalog-poster.css`, the sign-in dialog (`sdk-libs/auth/modal-styles.js`), the top bar in `theme.css` |
| `--font-showroom-body` | all of the above plus the top bar |
| `--sun`, `--on-sun`, `--accent`, `--text`, `--bg` | every sheet; the auth pill and dialog read them with a fallback so an app origin without the tokens still gets the design |

Code that runs **outside** the node cannot read a token: the portfolio prompt a person carries to
their own AI, the auth library's fallbacks, an app built elsewhere. Those carry the literal values
from the table above and are the second half of the checklist when a value changes.

A finished surface is verified in a real browser at 1280×900, 390×844 and 1280×460 (skill
`aimeat-frontend-verify`), and the words on it follow `aimeat-writing`.
