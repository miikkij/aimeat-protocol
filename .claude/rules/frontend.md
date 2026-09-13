---
paths:
  - "**/aimeat/public/**"
  - "**/aimeat/src/static/**"
---

<!-- Moved verbatim from CLAUDE.md on 2026-09-13. It loads when Claude reads a file matching `paths`, not at session start. -->

## Frontend

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

## Gates for this area

- **Finished frontend changes are verified by driving a real browser** through the Playwright MCP server. The `.spec.ts` Playwright suite is unreliable: do not write or run it. → skill `aimeat-frontend-verify`
