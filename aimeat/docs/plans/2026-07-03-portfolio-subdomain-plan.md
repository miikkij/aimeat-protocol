# Implementation plan: `<username>.portfolio.<apex>` — portfolio origin

**Status:** PLANNED (not built) · **Author:** Claude + Jouni · **Date:** 2026-07-03

## Goal

Serve a published portfolio as a **top-level document** at
`https://<username>.portfolio.aimeat.io`, mirroring how published apps are served at
`<sub>.apps.aimeat.io` (H-2 app origin). The apex SPA viewer (`/v1/portfolio/:username`)
stays as the embedded experience (it has the live auth bridge); the subdomain becomes the
clean share link / "my homepage" URL.

## Why this is safe — same argument as H-2

- The portfolio origin is a **separate origin family**. Auth cookies are **host-only**
  (invariant: never `Domain=.aimeat.io` — see `docs/coding-guidelines/security.md` and the
  H-2 design), so a visitor's aimeat.io session simply does not exist on
  `*.portfolio.aimeat.io`. User-authored HTML can run as a top-level document without any
  session-theft risk.
- localStorage/IndexedDB are per-origin; nothing to leak.
- CSP on the response governs the document (no srcdoc CSP-inheritance issue here — this is
  the "real URL with its own CSP" path).

## Existing mechanics to reuse (don't reinvent)

| Piece | Where | Reuse |
|---|---|---|
| Subdomain resolution | `src/middleware/subdomain.ts` | Extend: `req.portfolioOrigin` + `x-portfolio-origin` header + hostname fallback. Portfolio host must be checked **before** the apex (same reason as appHost — it *is* an apex subdomain). |
| Serving pattern + CSP | `src/routes/subdomains.ts` (`appCsp`, `serveApp`) | Template for `portfolioCsp` + `servePortfolio` |
| Portfolio resolution | `src/routes/portfolio.ts` (`data/:username`) | Extract a shared `resolvePublishedPortfolio(storage, username)` → `{ html, ghii, ownerGaiis } | null` (checks GHII exists, agents exist, `portfolio.config.enabled`, storage file `portfolio/index.html`) |
| Config pair pattern | `appOriginEnabled` + `appHost` | Mirror as `portfolioOriginEnabled` + `portfolioHost` |
| Header-simulated e2e | `test/e2e-app-origin.ts` | Same technique: `x-portfolio-origin: 1` + `x-subdomain: <username>` headers, no DNS needed |

## Design decisions

1. **No mapping table.** Unlike apps (N files per owner → `subdomain_sites` table), a
   portfolio is 1:1 with the owner and the label IS the username. Resolution is pure:
   label → owner lookup → published portfolio. No admin CRUD, no auto-assignment.
2. **Uniform 404.** Unknown username, no portfolio, `enabled:false`, reserved label,
   invalid label — all return the same 404 (no user-enumeration oracle). Belt-and-braces:
   check `RESERVED_SUBDOMAINS` + `SUBDOMAIN_RE` even though `validateOwnerName` overlaps.
3. **CSP:** derive `portfolioCsp` from `appCsp`: `script-src 'self' 'unsafe-inline' …`
   (raw user HTML, same trust level as apps), `connect-src` incl. the apex origin (the
   portfolio fetches public memory URLs at the apex), `frame-ancestors 'self' <apex>`
   (lets the apex SPA embed the subdomain version later if we ever want `src=` instead of
   `srcdoc`). `img-src * data: blob:` (external images OK here, unlike the apex CSP).
4. **Attribution badge:** inject the same `injectAimeatBadge` as apps get (visitor landing
   on someone's portfolio should find aimeat.io). — *confirm with developer; drop if
   portfolios should be 100 % unbranded.*
5. **Members/bridge parity is a separate phase.** A standalone portfolio has no parent
   viewer, so the `aimeat-portfolio-auth` / `-fetch` bridge doesn't exist there. Default
   behaviour is already correct and safe: gated sections stay on their placeholder.
   Phase 5 (optional) restores parity by injecting a shim — see below.

## Phases

### Phase 0 — shared resolver (refactor, no behaviour change)
- Extract `resolvePublishedPortfolio(storage, username)` from the `data/:username` handler
  in `src/routes/portfolio.ts`; both the JSON route and the new origin route call it.
- E2E: existing profile-tabs portfolio tests still pass.

### Phase 1 — config plumbing
- `portfolioOriginEnabled: boolean` (default false) + `portfolioHost: string` (e.g.
  `portfolio.aimeat.io`), env vars `AIMEAT_PORTFOLIO_ORIGIN_ENABLED` / `AIMEAT_PORTFOLIO_HOST`.
- Touch every layer per `docs/coding-guidelines/init-wizard.md` checklist: `config.ts`,
  `services/config-schema.ts`, `utils/env-config.ts`, `utils/env-validator.ts`,
  `.env.example`, init-wizard prompt + `CONFIG_DEFAULTS`, `locales/en.json` + `fi.json`.

### Phase 2 — middleware
- `src/middleware/subdomain.ts`: add `req.portfolioOrigin`; header path
  (`x-portfolio-origin` set by nginx) and hostname fallback
  (`host === portfolioHost` → bare host; `host.endsWith('.' + portfolioHost)` → label).
  Order: appHost → **portfolioHost** → apex.
- Add `portfolio` to `RESERVED_SUBDOMAINS` (apex-level `portfolio.aimeat.io` label must
  never be operator-mappable).

### Phase 3 — serve route
- In `src/routes/subdomains.ts` (or a sibling `portfolio-origin.ts`):
  `GET /` with `req.portfolioOrigin && req.subdomain` → `resolvePublishedPortfolio` →
  `text/html` + `portfolioCsp` + `Cache-Control: no-cache, must-revalidate` +
  `X-Content-Type-Options: nosniff`. Bare `portfolio.<apex>/` (no label) → 301 to the apex
  portfolio showcase (`/v1/members` or the portfolio members page).
- Optional: increment a view counter (parallel to `incrementAppDownloads`).
- OpenAPI: portfolio routes are currently undocumented — document at least this serve
  behaviour + the existing `/v1/portfolio/*` routes while in the area (Rule 3 campsite).

### Phase 4 — links & UI
- Builder (`public/views/portfolio.js`): step-5 publish target + published-bar show the
  subdomain URL when the node reports the feature (expose `portfolio_origin_host` in the
  `data/:username` response or `/v1/site/header-nav`-style public config).
- Apex viewer toolbar: "Open standalone" link → subdomain.
- Members showcase (`/v1/portfolio/members` consumers, `members.js`): link to subdomain.
- i18n en+fi for the new labels.

### Phase 5 — standalone bridge shim (optional, separate decision)
- Inject `portfolio-standalone.js` into the served HTML (same mechanism as the app-login
  shim, `injectAppScript`). Top-level `window.parent === window`, so the portfolio's own
  `parent.postMessage({type:'aimeat-portfolio-fetch', …})` lands on the same window — the
  shim answers those messages **locally**, using the H-2 silent-SSO bridge (apex app-grant
  token with `memory:read`) to call `GET <apex>/v1/memory/:gaii/:key`, and posts
  `aimeat-portfolio-auth` after the silent login resolves.
- Net effect: the exact same portfolio HTML works unchanged on both surfaces, and
  members-gated content works for logged-in aimeat.io users on the subdomain too.
- Until this ships: members sections show the placeholder on the subdomain (safe default).

### Phase 6 — tests + verification
- New e2e (`test/e2e-portfolio-origin.ts`, registered in `run-e2e-ci.ts`): publish a
  portfolio, then assert — serve via `x-portfolio-origin` + `x-subdomain` headers (200,
  CSP header present, HTML body); unknown user 404; `enabled:false` 404; reserved label
  404; `/v1` API unaffected on the portfolio origin.
- Browser verify (Rule 1b): hostname fallback with `<username>.portfolio.localtest.me`
  (or hosts-file entry) against dev, or header-simulated fetches + apex-side link checks.

### Infra (operator work, prod deploy — not code)
1. DNS: wildcard `*.portfolio.aimeat.io` → server IP.
2. TLS: wildcard cert for `*.portfolio.aimeat.io` (Let's Encrypt DNS-01, same flow as
   `*.apps.aimeat.io`).
3. nginx: mirror the apps server block —
   `server_name ~^(?<sub>[a-z0-9-]+)\.portfolio\.aimeat\.io$;` → `proxy_pass` backend with
   `proxy_set_header X-Subdomain $sub;` + `proxy_set_header X-Portfolio-Origin 1;`.
4. Set `AIMEAT_PORTFOLIO_ORIGIN_ENABLED=true` + `AIMEAT_PORTFOLIO_HOST=portfolio.aimeat.io`,
   restart.

## Edge cases & risks

- **Username not a valid DNS label:** `OWNER_RE` allows 3–64 chars; DNS labels max 63.
  64-char usernames (and any future name rule drift) simply don't get a subdomain — UI
  hides the link, apex URL remains. Never rewrite the username.
- **Unpublish:** resolver checks `enabled` live → immediate 404 (parity with apex).
- **Cookies:** never set any cookie on the portfolio origin (host-only invariant is what
  makes the whole model safe).
- **Size/caching:** portfolio HTML is capped (`portfolioMaxSizeKb`, default 512 KB);
  `no-cache, must-revalidate` matches the app pattern (republish visible immediately).
- **Public memory fetches from the subdomain:** cross-origin to the apex; anonymous
  `fetch(url)` passes CORS (`ACAO` from the node) — the builder prompt already forbids
  credentialed fetches, which also holds here.

## Open questions for the developer

1. Aimeat attribution badge on portfolios — yes/no?
2. Phase 5 (standalone members bridge) in the first release, or ship 0–4 + 6 first?
3. Should the apex viewer keep both surfaces (recommended) or redirect to the subdomain
   when the feature is enabled?
