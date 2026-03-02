# Cookie Consent System — Design Document

**Date:** 2026-03-02
**Status:** Approved

## Problem

AIMEAT portal pages (HTML responses from `/v1/portal/*`, admin dashboard, etc.) need a cookie consent mechanism so that service builders (node operators) can add analytics, marketing, or other tracking cookies while remaining GDPR/ePrivacy compliant.

AIMEAT itself does not use HTTP cookies — all authentication is JWT Bearer token based. This system is for service builders who deploy aimeat nodes and want to add third-party cookies/trackers to their portal pages.

## Solution

Integrate **vanilla-cookieconsent v3** (MIT, ~12KB gzip, zero deps, 5.3k stars) as a configurable, opt-in cookie consent banner system.

## Architecture

```
AimeatConfig
  cookieConsentEnabled: boolean
  cookieConsentCategories: string[]
  cookieConsentPolicyUrl: string | null
        │
   ┌────┴────┐
   │         │
   ▼         ▼
Middleware   JS Snippet Endpoint
(auto)       (manual)
   │         │
   ▼         ▼
Injects      GET /v1/portal/cookie-consent.js
before       Returns configured init script
</body>
in all HTML
responses
```

## Components

### 1. Config (`src/config.ts`)

New fields on `AimeatConfig`:

```typescript
// Cookie Consent (optional, for service builders)
cookieConsentEnabled: boolean;         // AIMEAT_COOKIE_CONSENT_ENABLED, default false
cookieConsentCategories: string[];     // AIMEAT_COOKIE_CONSENT_CATEGORIES, default ['necessary']
cookieConsentPolicyUrl: string | null; // AIMEAT_COOKIE_CONSENT_POLICY_URL, default null
```

### 2. Middleware (`src/middleware/cookie-consent.ts`)

Express middleware that:
- Returns passthrough when `cookieConsentEnabled` is false
- Intercepts HTML responses (Content-Type: text/html)
- Injects `<link>` + `<script>` tags before `</body>`
- Configures vanilla-cookieconsent with categories from config

### 3. Static Assets

vanilla-cookieconsent dist files (`cookieconsent.css`, `cookieconsent.umd.js`) served from `src/static/` directory.

### 4. JS Snippet Endpoint

`GET /v1/portal/cookie-consent.js` — route in portal router:
- Returns `Content-Type: application/javascript`
- Dynamic configuration (categories, language, policy URL) embedded
- Service builders add `<script src="/v1/portal/cookie-consent.js"></script>` to custom pages

### 5. i18n

Translations in `locales/en.json` and `locales/fi.json`:
- Banner title, description
- Category names and descriptions
- Button labels (Accept all, Reject all, Settings)

## Integration Points

- **server.ts**: Middleware registered after static files, before routes
- **config.ts**: New config fields + env parsing
- **.env.example**: New variables documented
- **package.json**: `vanilla-cookieconsent` dependency added

## Cookie Storage

vanilla-cookieconsent stores user preferences in its own cookie (`cc_cookie`), which is classified as a "necessary" cookie and does not require consent itself.

## Testing

- E2E: Verify banner appears in HTML responses when enabled
- E2E: Verify banner does NOT appear when disabled
- E2E: Verify JS snippet endpoint returns valid JavaScript
- Type-check: `npx tsc --noEmit` passes
