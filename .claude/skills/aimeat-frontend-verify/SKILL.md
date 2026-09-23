---
name: aimeat-frontend-verify
description: AIMEAT frontend rules: the styling conventions to write to, and how a finished change is verified by driving a real browser through the Playwright MCP server (three viewports, repaint count, idle network log). Use before writing or editing anything under public/views, public/components, public/js, public/css, locales or an HTML page, and again when that change is done or an AIMEAT app has been published.
---

# Verifying a finished frontend change

**Do not write or run the `.spec.ts` Playwright suite** (`pnpm test:playwright:*`). It is unreliable. Drive a real browser through the **Playwright MCP server** (`.mcp.json`) instead.

**Trigger:** a completed change to `public/views/`, `public/components/`, `public/js/`, `public/css/`, `locales/`, or a `*.html` page, or a published single-file AIMEAT app (`aimeat_app_publish`). Mid-development is not the trigger; done is.

Against your own sandbox node (`pnpm sandbox`, port 40600 upward, owners and passwords in `aimeat/.sandbox.json`; restart it to pick up a backend change), not the shared dev server on 40050, which belongs to the developer and may be restarted by another session: navigate to the page, reach the authenticated state, perform the real interactions, and confirm the expected result actually happens. Elements appear, data persists, edits and deletes take effect.

If you could not drive the browser (MCP unavailable, server down, no credentials), say so. Do not report it as working.

## A change to the look is one of two kinds, and says which

Jouni: "ulkoasun pitää pysyä samannäköisenä, mutta meidän on alettava käyttämään samannäköisiä
komponentteja joka puolella." Every step of UI work is one of two kinds, never both in one step:

- **A move.** Code, class names and CSS change place (into a component, into a shared sheet);
  nothing is decided about the look. Criterion: **no visible difference from the old code**.
- **A unification.** Two or more looks of one kind of thing become one component. Criterion: every
  page that uses it shows **the look Jouni chose in aimeat-design-lab** from the existing variants
  shown side by side, and **every other pixel on those pages is unchanged**. Nothing is designed
  from nothing: the look is one that exists today, or one he composed from them.

How both are proven:

1. Run the code from before the change beside the new code, on the same data (a second sandbox from
   the old commit). Prefer data as full as production's: long lists, long chats, tables in answers.
   The sandbox's two apps hide what dense rows do.
2. Compare each page side by side at 1280x900, 390x844 and 1280x460, light and dark. A move must
   read 0.00 % changed pixels. A unification masks the unified component's area, reads 0.00 %
   everywhere else, and its crop is compared with the picture of his decision.
3. **List every visible difference no decision covers**, with its before and after crop. The builder
   does not label a difference as acceptable ("unification", "consistent", "the part's standard
   look"); the list goes to Jouni. A difference stays only if he chose it by name.
4. Show him the result before it reaches `main`.

Ask before the first line of work when his words, or two rules, read two ways or leave no room for
the goal. The first attempt (rolled back in `cee2cbaf5`) changed the look without his decision; the
second kept every pixel and unified nothing, because its plan forbade unifying. Zero overflow, zero
console errors, a green gate and green CI are floors, not the verdict. → `docs/pitfalls.md` §94

## Measure, don't glance

Mandatory when the surface has a dialog or overlay, or reads live data. A clean console, compiling JS and one screenshot at one size are proxies, and proxies generalise badly: an overlay verified only at 390px shipped rendering below the footer on desktop, and an app reported as "0 console errors" was repainting its open dialog every second.

Run all three and report the numbers.

1. **Three viewports, every interactive surface:** 390x844, 1280x900, and **1280x460**. The short one catches centring and overlay bugs (clipped top, unscrollable, rendered below the page). At each: `scrollWidth - clientWidth === 0`, dialog top edge >= 0, close control reachable. When the overflow is not zero, do not guess the culprit; list it. The element whose right edge passes the viewport is usually not the one you expect (a flex or grid item whose automatic `min-width` is its content, so a horizontally scrolling strip inside it holds the whole page open):
   ```js
   () => { const w = document.documentElement.clientWidth; const out = [];
     document.querySelectorAll('body *').forEach(el => { const r = el.getBoundingClientRect();
       if (r.right > w + 2 && r.width > 0 && getComputedStyle(el).position !== 'fixed')
         out.push((el.id ? '#' + el.id : '') + '.' + String(el.className).slice(0, 36) + ' r=' + Math.round(r.right)); });
     return out.slice(0, 12); }
   ```
   The outermost entry is the one to fix (`min-width: 0` on the item, `align-items: stretch` on a column container); the rest are its children. → `docs/pitfalls.md` §30
2. **Live channel connected, dialog open, count repaints:** `MutationObserver` on the open panel's content node, 20 seconds while other activity happens on the account. Expected zero. Above zero means a live event is repainting what the user is reading.
3. **Network log after 60 idle seconds:** a repeating full listing is a bug even when nothing visibly breaks. It is an unintended poll.

Then verify the **feature**, not the render: perform the real interaction and confirm the result appears and persists. "It didn't crash" is not a pass.

The same gate is served to app builders in `src/services/build-app-prompt.ts` under "Before you call it done". Keep the two in step.

## An Atelier app is accepted beside the genre it forked

For an app on the Atelier track the numbers above are the floor, not the verdict. Screenshot it at **390 and 1440, in both themes**, open the genre it names in `<meta name="aimeat-register">` (`/v1/app-templates/genre-<id>`, or the shelf at `/v1/designbook?kind=genre`), and place the two pictures **side by side**. Then ask, while looking: **would this pass beside the genre?**

That question is the acceptance criterion, and it exists because the metrics answered yes on pages the developer then rejected: three Design Book showcase pages passed element counts, overflow zero and a green contrast matrix while reading as "the same dashboard in new paint" (`docs/pitfalls.md` §34). A screenshot beside the genre is what catches a costume.

Under the picture, eight measured checks, all reported as numbers:

| Check | Passes at |
|---|---|
| Page width | `scrollWidth === clientWidth` at 390 and 1440 |
| Past the edge | no element whose right edge passes `clientWidth + 2`, **including inside a box with `overflow-x: clip` or `hidden`**: the width check is blind to those |
| Text size | no visible text under 11 px |
| Tap targets | at 390, no control under 40 px in either dimension |
| Contrast | 4.5 for body text, 3.0 for ≥24 px or ≥19 px bold |
| Reduced motion | zero animations whose computed duration is over 1 ms (`docs/pitfalls.md` §47) |
| Console | zero JavaScript errors |
| The pill's switches | pressed, not looked at: the language switch moves `<html lang>` **and** every text the page itself renders, English to Finnish and back, in the middle of using the app, and what the person was doing survives it. **Fewer than two languages in `<meta name="aimeat-locales">` is a FINDING, not a reason to skip**: `en fi` is the default here, and one language passes only when Jouni asked for one in so many words. The language of the conversation is not the app's language list. On 2026-09-19 a build declared `content="fi"` on its own, this line let the check be skipped for it, and a page with a Finnish bar over English content was called done; the mode buttons take `data-theme` away from its current value and back, unless the page declares `<meta name="aimeat-light" content="fixed">`, where both are `disabled` and say why |

And one measurement only phone width reveals: a kit component that declares `container-type` cannot restyle itself from its own container query, so a fold can succeed and leave the detail pane at 40 % of its panel with no error and a correct page width. When the change touches `listDetail` or another container-query component, measure the panel's width against its container's at 390 (`docs/pitfalls.md` §46).

## Four things a metric will never tell you

Automated checks prove overflow, contrast and element counts. They say nothing about these, and all four came from the developer having to point at something visible in a screenshot I had already taken.

1. **Look at the screen a VISITOR lands on first**, not only the inner view you were working on. A missing header or sign-in pill on the first-touch screen passes every metric.
2. **Check column alignment and the style register**, not just whether an element exists. A per-row grid with an auto column drifts out of line, and an arcade sticker style dropped into a serious tool is wrong even when it renders. The house register is slate and geometric.
3. **An empty state reads as broken**, not as "nothing has happened yet". Prefer a cumulative counter that is always populated ("this node has X apps, Y organisms, Z agents") over an event feed that can be empty.
4. **The primary action belongs on the landing surface.** If an app's main use is "copy a prompt for your agent", the button that opens it goes in the hero or toolbar, with the requirements written out in plain language and the prompt visible. A prompt reachable only through a help page makes the whole product look broken while the mechanics work.

**"Mobile-optimised" means using the phone properly, not trimming chrome.** For a focused view (a chat thread, an editor, a wizard) go full screen: lift it out of the profile shell with `position:fixed; inset:0` and hide the shell chrome, handle the on-screen keyboard from the start (`interactive-widget=resizes-content`, a `visualViewport` fallback, `env(safe-area-inset-*)`), and replace a heavy desktop widget with a native-feeling control. Pattern: `docs/frontend-development-guide.md` under Mobile & Responsive UX; traps: `docs/pitfalls.md` §15.

## Styling rules that get caught here

Full guide: `docs/frontend-development-guide.md`. The ones that recur:

- No inline `style=""` for layout, colour, spacing or typography, and no CSS constants in JS. All CSS in external `.css` files.
- Colours, spacing and typography come from `theme.css` variables. Never hardcode `#E8564A` or similar in JS.
- No `rgba(255,255,255,...)` in CSS (dark-theme-only). Use `var(--card)`, `var(--border)`, `var(--bg-dim)`, `var(--surface)`.
- Button classes are `.btn-primary`, `.btn-outline`, `.btn-ghost`, `.btn-danger`, `.btn-success`, `.btn-info`, `.btn-danger-solid`. There is no `.btn` base class, so `class="btn btn-*"` is wrong.
- Prefix view CSS classes: `pf-` profile, `gn-` portal, `adm-` admin. Profile tab section headers use `.section-title` + `.section-desc`.
- Reuse `/components/` and the shared components in `views/profile/shared.js` and `views/admin/shared.js`.
- All user-visible text through `t()`.
- No emoji in the interface: not in a heading, a button, a menu item, a dialog title, a label, a
  notice, and not inside a locale string, where they hide until the screen is up. Icons are inline
  SVG; the only symbols in text are `✓ ✗ → ↩`. The one emoji that stays is data: the icon a
  person chose for their own app. Full rule and the reason: skill `aimeat-design-language`.

Campsite rule: fix inline styles, `btn btn-*` and `rgba(255,255,255)` in files you touch.
