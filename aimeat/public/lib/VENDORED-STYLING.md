# Vendored styling/runtime assets (self-hosted, not CDN)

These third-party assets are vendored into `aimeat/public/lib/` and served at `/lib/...`
(via `express.static`, 7-day cache — see `aimeat/src/server-bootstrap/static-files.ts`).
Published apps load them from our own node instead of an external CDN
(cdn.jsdelivr.net / cdn.tailwindcss.com). All MIT-licensed (Rule 5 OK).

| File | Package | Version | Source | License |
|------|---------|---------|--------|---------|
| `tailwindcss@4.js` | `@tailwindcss/browser` | 4.3.1 | `https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4` | MIT |
| `daisyui@5.css` | `daisyui` | 5.5.23 | `https://cdn.jsdelivr.net/npm/daisyui@5` | MIT |
| `chartjs@4.js` | `chart.js` (UMD) | 4.5.1 | `https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js` | MIT |

## Usage in a published app (replaces the CDN incantation)

```html
<link href="/lib/daisyui@5.css" rel="stylesheet" type="text/css" />
<script src="/lib/tailwindcss@4.js"></script>
<!-- charts: <script src="/lib/chartjs@4.js"></script> before aimeat-charts -->
```

> Note: `@tailwindcss/browser` is an in-browser JIT compiler (Tailwind's "not for
> production" build). Self-hosting removes the external-CDN dependency; it does not
> change that compilation happens in the browser. This is the pragmatic fit for
> AI-authored single-file apps whose utility classes can't be precompiled.

## Updating

Re-download the same jsdelivr URLs, bump the version in this table, and update the
`@version` banner check. Keep the major-pinned filename (`@4`, `@5`) stable so app
templates don't need to change.
