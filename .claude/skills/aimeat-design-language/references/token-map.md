# The token map: every surface a type or colour token reaches

Read this when you change a token in `aimeat/public/css/theme.css`, to see which surfaces follow on
their own and which need a hand. The rules for changing a value are in `SKILL.md`, "Changing a
value, and how far it reaches". The list below names sheets as they are in the tree on the review
date in `SKILL.md`; when a sheet is not here, `grep -l "var(--font-poster" aimeat/public/css` and the
same for `--font-showroom` give the current list.

| Token | Read by |
|---|---|
| `--font-headline` | through `--font-showroom`: the showroom view sheets in `css/views/` (`landing-showroom.css`, `landing.css`, `landing-v2.css`, `everything.css`, `help.css`, `members.css`, `changelog.css`, `build-story.css`, `portal-dev.css`), `static-page.css`, the components `signed-out-door.css` and `contact-card.css`, and the showroom shapes in `poster.css`; through `--font-poster`: `poster.css` (every poster shape, including the rules for the home, the chat and the layout engine's band that once had sheets of their own), `css/views/profile-poster.css`, the component sheets in `css/components/` that set a headline (`dialog.css`, `masthead.css`, `step-card.css`, `tab-page.css`, `conversation-frame.css` and the rest), and the sign-in dialog (`sdk-libs/auth/modal-styles.js`) |
| `--font-body` | all of the above through `--font-showroom-body` and `--font-poster-section` (the top bar in `css/components/top-bar.css` among them), and every classic-shell sheet (admin, the older tabs, form controls) through `--font` |
| `--font-mono` | every sheet that shows an address, a command, an id or a key; no sheet spells a monospace family |
| `--font-headline` again, through the palette bridge | `lib/aimeat-theme.css` gives every `h1`-`h6` the palette's display face, and the default palette's display face is `var(--font-headline, 'Archivo Black', …)`: on the node the classic shell's headings follow the token; a published app without `theme.css` keeps the vendored Archivo Black; a chosen palette (paper, circuit, …) keeps its own face on purpose |
| `--font-wordmark` | the wordmark: the top bar (`css/components/top-bar.css`) and the sign-in dialog (`sdk-libs/auth/modal-styles.js`); a headline change never reaches it |
| `--sun`, `--on-sun`, `--accent`, `--text`, `--bg` | every sheet; the auth pill and dialog read them with a fallback so an app origin without the tokens still gets the design |

The standalone pages (`public/connect*.html`, `public/front-*.html`, `public/wiifm*.html`,
`public/aimeat-developers.html`, the app catalog's template) link the same sheet and name their
faces in their own inline CSS, so a change of face reaches them only by hand.

Code that runs **outside** the node cannot read a token: the portfolio prompt a person copies into
their own AI, the auth library's fallbacks, an app built elsewhere. Those use the literal values
from the colour table in `SKILL.md` and are the second half of the checklist when a value changes.
