# styling smoke test set

Minimal single-page component proving a mid-tier model produces WORKING Tailwind v4 + daisyUI v5 code.
Model builds one-shot, fetches `GET /v1/library-packs/styling` ai_doc, loads ONLY from the node
(daisyUI CSS + aimeat-daisyui-bridge CSS + tailwindcss@4 browser JIT).

Task: a page styled ENTIRELY with Tailwind v4 utilities + daisyUI v5 component classes (no hand CSS):
a navbar, a card (title/body/actions), several daisyUI button variants, a badge, and a small form
(input + select + button). Follows the AIMEAT light/dark theme. NO login. Zero console errors.

Pass = daisyUI component classes apply (padding/radius/colors) + Tailwind utilities compile + the page
renders as a styled showcase + 0 console errors, verified in a real browser.
