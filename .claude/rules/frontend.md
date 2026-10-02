---
paths:
  - "**/aimeat/public/**"
  - "**/aimeat/src/static/**"
---

<!-- Moved verbatim from CLAUDE.md on 2026-09-13. It loads when Claude reads a file matching `paths`, not at session start. -->

## Frontend

A shape of the design language is a class in `poster.css`; a view sheet composes it and never writes the rule, the slab, the sun or the box itself.

Full architecture, component library, cache-busting and SSE: `docs/frontend-development-guide.md`. Two mechanisms bite often:

- **A new shared JS module** on an absolute path (`/js/services/foo.js`) needs an identity entry in the importmap in `public/spa.html`. `portal.ts` stamps `?v=BUILD_ID` automatically. Relative imports, bare specifiers and CSS need no entry.
- **Every profile or admin tab showing server data** re-fetches on the `aimeat-live-update` window event (static-data, pure-nav and push-pref tabs excepted):
  ```javascript
  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);
  ```

Styling, in short: no inline `style=""` and no CSS constants in JS; colours and spacing from `theme.css` variables; no `rgba(255,255,255,…)`; button classes are `.btn-primary`, `.btn-outline`, `.btn-ghost`, `.btn-danger` and friends, with no `.btn` base class; all user-visible text through `t()`. **No emoji in the interface**: not in a heading, a button, a menu item, a dialog title, a label or a locale string; icons are inline SVG and the only symbols in text are `✓ ✗ → ↩` (the one that stays is the icon a person chose for their own app). Fonts, colours and shapes come from skill `aimeat-design-language`; full conventions and the browser verification protocol: skill `aimeat-frontend-verify`.

**A setting a person cannot read from its label explains itself.** A number with a range or a unit, a word from the system's vocabulary (scope, routing, embeddings, federation, threshold), or a choice whose options change behaviour in ways the label does not say: give the control `help="<term>"` (the field family, Check, SettingLine; `HelpLabel` for a Facts row's name, a heading or a column head) and write `explain.<term>.*` in en, fi and es in the same change: what it does, the range and default, what a lower and a higher value give, examples, when to change it. The facts come from the code that enforces the setting, never from the page text, because reading the code is what finds a page that promises something the server does not do. A grey hint the explanation now carries leaves the page; a live figure or a disclosure stays. The same words reach an AI through `aimeat_handbook_get { tier: "settings/<term>" }`, so the explanation is written once. Ruled by Jouni on 2026-10-02 (decision "A setting a person cannot read from its label gets a question mark"); the components are in the catalogue as `help-tip`, `tooltip` and `explain-dialog`.

## Gates for this area

- **Finished frontend changes are verified by driving a real browser** through the Playwright MCP server. The `.spec.ts` Playwright suite is unreliable: do not write or run it. → skill `aimeat-frontend-verify`
