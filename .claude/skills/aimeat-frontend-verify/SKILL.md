---
name: aimeat-frontend-verify
description: AIMEAT frontend rules: the styling conventions to write to, and how a finished change is verified by driving a real browser through the Playwright MCP server (three viewports, repaint count, idle network log). Use before writing or editing anything under public/views, public/components, public/js, public/css, public/locales or an HTML page, and again when that change is done or an AIMEAT app has been published.
---

# Verifying a finished frontend change

**Do not write or run the `.spec.ts` Playwright suite** (`pnpm test:playwright:*`). It is unreliable. Drive a real browser through the **Playwright MCP server** (`.mcp.json`) instead.

**Trigger:** a completed change to `public/views/`, `public/components/`, `public/js/`, `public/css/`, `public/locales/`, or a `*.html` page, or a published single-file AIMEAT app (`aimeat_app_publish`). Mid-development is not the trigger; done is.

Against the running dev server (`pnpm dev`, port 40050): navigate to the page, reach the authenticated state, perform the real interactions, and confirm the expected result actually happens. Elements appear, data persists, edits and deletes take effect.

If you could not drive the browser (MCP unavailable, server down, no credentials), say so. Do not report it as working.

## Measure, don't glance

Mandatory when the surface has a dialog or overlay, or reads live data. A clean console, compiling JS and one screenshot at one size are proxies, and proxies generalise badly: an overlay verified only at 390px shipped rendering below the footer on desktop, and an app reported as "0 console errors" was repainting its open dialog every second.

Run all three and report the numbers.

1. **Three viewports, every interactive surface:** 390x844, 1280x900, and **1280x460**. The short one catches centring and overlay bugs (clipped top, unscrollable, rendered below the page). At each: `scrollWidth - clientWidth === 0`, dialog top edge >= 0, close control reachable.
2. **Live channel connected, dialog open, count repaints:** `MutationObserver` on the open panel's content node, 20 seconds while other activity happens on the account. Expected zero. Above zero means a live event is repainting what the user is reading.
3. **Network log after 60 idle seconds:** a repeating full listing is a bug even when nothing visibly breaks. It is an unintended poll.

Then verify the **feature**, not the render: perform the real interaction and confirm the result appears and persists. "It didn't crash" is not a pass.

The same gate is served to app builders in `src/services/build-app-prompt.ts` under "Before you call it done". Keep the two in step.

## Styling rules that get caught here

Full guide: `docs/frontend-development-guide.md`. The ones that recur:

- No inline `style=""` for layout, colour, spacing or typography, and no CSS constants in JS. All CSS in external `.css` files.
- Colours, spacing and typography come from `theme.css` variables. Never hardcode `#E8564A` or similar in JS.
- No `rgba(255,255,255,...)` in CSS (dark-theme-only). Use `var(--card)`, `var(--border)`, `var(--bg-dim)`, `var(--surface)`.
- Button classes are `.btn-primary`, `.btn-outline`, `.btn-ghost`, `.btn-danger`, `.btn-success`, `.btn-info`, `.btn-danger-solid`. There is no `.btn` base class, so `class="btn btn-*"` is wrong.
- Prefix view CSS classes: `pf-` profile, `gn-` portal, `adm-` admin. Profile tab section headers use `.section-title` + `.section-desc`.
- Reuse `/components/` and the shared components in `views/profile/shared.js` and `views/admin/shared.js`.
- All user-visible text through `t()`.

Campsite rule: fix inline styles, `btn btn-*` and `rgba(255,255,255)` in files you touch.
