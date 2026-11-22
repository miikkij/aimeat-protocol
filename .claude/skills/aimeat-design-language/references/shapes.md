# The shape tables: values, classes and shared variants

Read this when you compose a shape in markup, change a shape value, or add a variant. The rules
that govern these tables (a view composes, never re-declares; at most two size modifiers; a
one-page cut stays until Jouni folds it in by name) are in `SKILL.md`, sections "The four shapes" and
"Changing a value, and how far it reaches". The executable values are the declarations in
`aimeat/public/css/theme.css` (`--shape-*`) and `aimeat/public/css/poster.css`; where this file
and the CSS differ, the CSS wins and this file is corrected.

## The shape values: what a theme changes once

| Token | Built-in value | What it shapes |
|---|---|---|
| `--shape-corner` | `0` | a box, a panel, a frame, a record, a sticker |
| `--shape-corner-control` | `0` | a field, an icon button, a choice, a menu row, a chat row |
| `--shape-corner-pill` | `0` | the loud action, a tab, a count, the morsel badge (not the action link: a line under words has no corner to round) |
| `--shape-corner-dialog` | `0` | a dialog, the bell's menu |
| `--shape-corner-soft` / `--shape-corner-card` | `8px` / `10px` | the app catalogue's own softer drawing (appcat): a statement box, a state line, a picture and the empty box of a search preview / the search result card |
| `--shape-frame` / `--shape-frame-heavy` | `2px` / `3px` | a box's or a control's frame / the heavy frame, the rule under an action, the page's rules |
| `--shape-frame-colour` / `--shape-rule-colour` / `--shape-field-colour` | `var(--text)` each | a box's frame / a rule and a control's frame / a field's frame |
| `--shape-ring` | `3px` | a spinner's ring |
| `--shape-chosen-ground` | `var(--sun)` | the ground of a chosen row or item: a pressed menu row, a ticked choice, an opened row, a chosen value |
| `--shape-shadow` | `none` | a box at rest |
| `--shape-shadow-raised` | `8px 8px 0 var(--sun)` | a record, an open step, an open menu |
| `--shape-shadow-dialog` | `12px 12px 0 var(--sun)` | a dialog |
| `--shape-shadow-action` / `-pressed` | `4px 4px 0` / `2px 2px 0 var(--sun)` | the loud action, and under the pointer |
| `--shape-shadow-chosen` | `4px 4px 0 var(--text)` | a chosen choice |
| `--shape-case-heading`, `--font-poster-weight`, `--font-poster-tracking`, `--font-poster-leading` | `uppercase`, `400`, `.01em`, `1` | every headline |
| `--shape-case-action`, `--shape-tracking-action` | `uppercase`, `.04em` | the loud action, an action link, a tab |
| `--shape-case-label`, `--shape-tracking-label` | `uppercase`, `.1em` | the small coral label |

## Shape to class: one CSS home

| Shape | Class |
|---|---|
| Page title | `.poster-page-title` |
| Opened record title | `.poster-record-title` |
| Section and B1 headline | `.poster-section`, `.poster-section-title` |
| Area governed by the selected tab | `.poster-panel` |
| Hairline row; row that is the thing | `.poster-row`; `.poster-row--thing` |
| Small coral label | `.poster-label` (also the prompt card's label; Jouni's decision "Row label"); `--block` stands it on a line of its own |
| Underlined action, and its tones | `.poster-action`; `--more` ("Show all", every small way on inside a part), `--quiet` (a side column action), `--back` (the way back), `--text` (Listen, Copy, "Not now"), `--notice` ("What does that mean?"), `--jump` (the jump to the latest message), `--danger` (coral: an act that removes or revokes); in Settings & Controls a way on in a page head or a section is `--small`, a quiet one `--lower` (no capitals), and one in a list row's action cell `--row` (Jouni's decision "Settings door"); `--control` stands the same word and line in a box as tall as the control cut (44px), the touch target on a phone for a page that asks one thing or a panel's buttons (Action `control`, 2026-10-21); on a touch screen (`pointer: coarse`) every action link and tab takes the finger in an invisible area 44px high around its words, with no change to its look (2026-10-25); `:disabled` is dimmed; `.is-on` (a pale coral ground) while what it started runs, as Listen while it reads (Jouni's decisions "Action link", "Panel action", "Step button", "Dismiss", "Small link"). Every button of a small panel, and a first step's button that is not the next move, is this link |
| Tab and selected tab, and its tones | `.poster-tab`, `.poster-tab.is-on`; `.poster-tab--fold` (a small switch in a row, "Recent / Mine", and every button that shows or hides a panel and stays pressed while it is shown), `.poster-tab--tile` (a choice among named looks, the background pattern), `--filter` (what a list shows: small typewriter words in a grey frame), `--attention` (a filter whose items need the person); `:disabled` is dimmed; a Count inside a chosen tab takes the chosen tab's own words' colour (dark on the sun in AIMEAT; light on the accent in a style such as Pebble that chooses on the accent) (Jouni's decisions "Tabs and filters", "Choice") |
| Loud action and the home's large button | `.poster-slab`, `.poster-slab--large`; the one big button of a place, and only the next move in the first steps (Jouni's decision "Loud action") |
| Icon button | `.poster-icon` (44px, the composer), `.poster-icon--small` (28px, everywhere else): a square in a 2px ink frame, the sun under the pointer; a card's menu keeps its state fill; `.is-on` (ink ground) for a button that stays pressed (Jouni's decision "Icon button") |
| Menu row | `.poster-menu-row`: one choice in an opened menu, plain words on a quiet ground, a thin line between rows; the menu around it is a column; `--danger` keeps a delete coral (Jouni's decision "Menu row") |
| Box; frame; opened record | `.poster-box` with the tones `--copy` (a text to copy, on grey: the prompt card), `--row` (one result in a list) and `--raised` (the one thing that stands out: an opened row's panel, the way to take first; heavy frame and the raised shadow) (Jouni's decisions "Object box", "Box"); `.poster-frame`; `.poster-record` (the dialog is the site's own Modal; `.poster-dialog` was deleted on 2026-09-23) |
| Dashed coral aside | `.poster-aside` with the tones `--waiting` (the next move is elsewhere) and `--suggestion` (a line to wave away) (Jouni's decision "Attention note") |
| Tag; a row of tags; crumb | `.poster-chip` with the tones `--sun` ("you", "public"), `--coral` (a guest, "anyone", a broken rule), `--ink`, `--dim` (a tag that counts nothing yet: "0 workspaces"), `--fine` (green: a role that is granted, in css/components/mark.css); `.poster-chips` for a row; `.poster-chip-x`, the ✗ that takes a tag or a member off, grey and coral under the pointer (Jouni's decisions "Tag", "Remove mark"); `.poster-crumb` |
| Word that says a state | `.poster-status` with `--fine` (green), `--attention` (sun), `--danger` (coral), `--off` (grey) (Jouni's decision "Status") |
| Small number: waiting (on coral), tally (no ground), small (on an icon) | `.poster-count`, `--waiting`, `--tally`, `--small` (Jouni's decision "Count"; the bell and the open items use it; the morsel badge stays its own) |
| When a thing happened | `.poster-time` (Jouni's decision "Timestamp"; the chat's message time and the home timeline) |
| Heading over a list; quiet over a record | `.poster-day-title`, `.poster-day-title--quiet` (Jouni's decision "Group heading"; the history, the chat's side column, the chat's work log) |
| Numeral row and its number | `.poster-stat`, `.poster-stat-number` |
| Showroom ink band and sun band | `.showroom-band`, `.showroom-band--sun` |
| Showroom section and coral shadow | `.showroom-section`, `.showroom-section--coral` |
| Showroom underlined link | `.showroom-door` |
| Showroom slab and its named colours | `.showroom-slab`, `--hot`, `--sun`, `--ink` modifiers |
| A store link while the store does not take orders yet | `.store-soon` on the link or slab (components/StoreDoor.js): the same shape, "Opens soon" for words, no pointer, and a link without its underline; `.store-soon-note`, the sentence that says so. With a discount code set (site.store_soon_code) the control is `.store-soon-ask`, pressable in its own shape, and the press shows `.store-soon-code`: the code in an ink frame with a copy button. Only while site.store_status is "soon" |

## Shared variants

| Shape | Shared variant | Values and reason |
|---|---|---|
| Loud action | `.poster-slab--large` | 1.02rem, 8px sun shadow; the named big button role (brief 10.3). Base stays .8rem, 600, 4px sun shadow. |
| Loud action | `.poster-slab--control` | A 44px control in a row of controls: inline-flex, centred, `0 16px` padding, weight 800, the parent's face; the chat's New conversation and Send (formerly chat.css), and a dialog's Save or Confirm. Dimmed to .45 when disabled. |
| Loud action | `.poster-slab--danger` | An action that cannot be undone (a dialog's Delete): `--accent` ground, white words, a `4px 4px 0 --text` shadow (Jouni's decision "Dialog actions"). |
| Section headline | `.poster-section-title--large` | 2.4rem, and 1.7rem with `.45rem .8rem .4rem` padding at 560px; the home's bands and the layout engine's band (formerly home.css and surface.css). |
| Box | `.poster-box--avatar` | Square initials mark, .95rem poster face, no padding or margin, transparent ground; Contacts, Email and Notifications share this cut. Dimensions remain layout. |
| Box initials mark | `.poster-box--avatar.poster-box--small` | .85rem; Apps, Companies and MCP share the smaller initials cut. |
| Box initials mark | `.poster-box--avatar.poster-box--agent` | A dashed frame and grey initials: an agent's mark (and a mark for something not connected yet) in Contacts, Notifications, Email and MCP. |
| Box | `.poster-box--meter` | Paper ground, no padding or margin, sun fill for SVG data geometry; the filled numerical meter role. |
| Box meter | `.poster-box--quota` | Card ground with coral consumption; `.is-full` changes the fill to danger. The quota meter is a named data role, with its ratio carried by SVG geometry. The figure written on a meter is `.poster-meter-figure` (typewriter .72rem, at the left). |
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
