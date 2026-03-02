# Cookie Consent System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add configurable cookie consent banner to AIMEAT portal HTML pages using vanilla-cookieconsent v3.

**Architecture:** Express middleware intercepts HTML responses and injects consent banner assets. A standalone JS snippet endpoint provides manual integration. All configuration via env vars, disabled by default.

**Tech Stack:** vanilla-cookieconsent v3, Express 5, TypeScript, vitest

---

### Task 1: Install vanilla-cookieconsent dependency

**Files:**
- Modify: `aimeat/package.json`

**Step 1: Install the package**

Run (from `aimeat/` directory):
```bash
pnpm add vanilla-cookieconsent
```

**Step 2: Verify installation**

Run:
```bash
ls node_modules/vanilla-cookieconsent/dist/
```
Expected: `cookieconsent.css`, `cookieconsent.umd.js`, `cookieconsent.esm.js` (and possibly more)

**Step 3: Copy static assets to src/static/**

Copy the CSS and UMD JS files that the browser needs:
```bash
cp node_modules/vanilla-cookieconsent/dist/cookieconsent.css src/static/cookieconsent.css
cp node_modules/vanilla-cookieconsent/dist/cookieconsent.umd.js src/static/cookieconsent.umd.js
```

**Step 4: Commit**

```bash
git add aimeat/package.json aimeat/pnpm-lock.yaml aimeat/src/static/cookieconsent.css aimeat/src/static/cookieconsent.umd.js
git commit -m "deps: add vanilla-cookieconsent v3 for portal cookie consent"
```

---

### Task 2: Add config fields

**Files:**
- Modify: `aimeat/src/config.ts` (interface + loadConfig)

**Step 1: Write the failing type-check**

Add three new fields to `AimeatConfig` interface in `src/config.ts`, after the Cross-Federation section (around line 148):

```typescript
  // Cookie Consent (optional, for service builders)
  cookieConsentEnabled: boolean;
  cookieConsentCategories: string[];
  cookieConsentPolicyUrl: string | null;
```

Run:
```bash
cd aimeat && npx tsc --noEmit
```
Expected: FAIL — `loadConfig()` doesn't return the new fields.

**Step 2: Add the config parsing to loadConfig()**

In the return object of `loadConfig()`, before `rateLimits:` (around line 257), add:

```typescript
    cookieConsentEnabled: process.env.AIMEAT_COOKIE_CONSENT_ENABLED === 'true',
    cookieConsentCategories: (process.env.AIMEAT_COOKIE_CONSENT_CATEGORIES ?? 'necessary').split(',').map(s => s.trim()).filter(Boolean),
    cookieConsentPolicyUrl: process.env.AIMEAT_COOKIE_CONSENT_POLICY_URL ?? null,
```

**Step 3: Run type-check to verify**

Run:
```bash
cd aimeat && npx tsc --noEmit
```
Expected: PASS

**Step 4: Commit**

```bash
git add aimeat/src/config.ts
git commit -m "config: add cookie consent env vars (disabled by default)"
```

---

### Task 3: Update .env.example

**Files:**
- Modify: `aimeat/.env.example`

**Step 1: Add cookie consent section**

After the Cross-Federation section (line 147), add:

```env
# ── Cookie Consent (for service builders) ────────────────────
# Opt-in cookie consent banner for portal HTML pages.
# Uses vanilla-cookieconsent v3. Disabled by default.
# AIMEAT_COOKIE_CONSENT_ENABLED=false
# AIMEAT_COOKIE_CONSENT_CATEGORIES="necessary,analytics,marketing"
# AIMEAT_COOKIE_CONSENT_POLICY_URL="https://example.com/privacy"
```

**Step 2: Commit**

```bash
git add aimeat/.env.example
git commit -m "docs: add cookie consent env vars to .env.example"
```

---

### Task 4: Add i18n translations

**Files:**
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

**Step 1: Add English translations**

Add a `"cookieConsent"` section to `locales/en.json`:

```json
"cookieConsent": {
  "title": "Cookie Settings",
  "description": "This site uses cookies to improve your experience. You can choose which categories to allow.",
  "acceptAll": "Accept all",
  "rejectAll": "Reject all",
  "settings": "Settings",
  "save": "Save settings",
  "categories": {
    "necessary": {
      "title": "Necessary",
      "description": "Essential cookies required for the site to function. Cannot be disabled."
    },
    "analytics": {
      "title": "Analytics",
      "description": "Cookies that help us understand how you use the site so we can improve it."
    },
    "marketing": {
      "title": "Marketing",
      "description": "Cookies used to deliver relevant ads and track campaign effectiveness."
    }
  },
  "policyLink": "Privacy Policy"
}
```

**Step 2: Add Finnish translations**

Add a `"cookieConsent"` section to `locales/fi.json`:

```json
"cookieConsent": {
  "title": "Evästeasetukset",
  "description": "Tämä sivusto käyttää evästeitä käyttökokemuksen parantamiseksi. Voit valita, mitkä kategoriat sallit.",
  "acceptAll": "Hyväksy kaikki",
  "rejectAll": "Hylkää kaikki",
  "settings": "Asetukset",
  "save": "Tallenna asetukset",
  "categories": {
    "necessary": {
      "title": "Välttämättömät",
      "description": "Sivuston toiminnan kannalta välttämättömät evästeet. Näitä ei voi poistaa käytöstä."
    },
    "analytics": {
      "title": "Analytiikka",
      "description": "Evästeet, jotka auttavat meitä ymmärtämään, miten käytät sivustoa."
    },
    "marketing": {
      "title": "Markkinointi",
      "description": "Evästeet, joita käytetään olennaisten mainosten näyttämiseen."
    }
  },
  "policyLink": "Tietosuojaseloste"
}
```

**Step 3: Commit**

```bash
git add aimeat/locales/en.json aimeat/locales/fi.json
git commit -m "i18n: add cookie consent translations (en, fi)"
```

---

### Task 5: Create cookie consent middleware

**Files:**
- Create: `aimeat/src/middleware/cookie-consent.ts`

**Step 1: Write the unit test**

Create `aimeat/src/middleware/__tests__/cookie-consent.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { cookieConsentMiddleware } from '../cookie-consent.js';
import type { AimeatConfig } from '../../config.js';

function mockConfig(overrides: Partial<AimeatConfig> = {}): AimeatConfig {
  return {
    cookieConsentEnabled: false,
    cookieConsentCategories: ['necessary'],
    cookieConsentPolicyUrl: null,
    // Minimal stubs for other fields — only what's needed
    nodeId: 'test-node',
    ...overrides,
  } as AimeatConfig;
}

function mockRes(): Response {
  const res = {
    getHeader: vi.fn().mockReturnValue('text/html; charset=utf-8'),
    send: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe('cookieConsentMiddleware', () => {
  it('passes through when disabled', () => {
    const mw = cookieConsentMiddleware(mockConfig({ cookieConsentEnabled: false }));
    const next = vi.fn();
    mw({} as Request, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('injects consent snippet into HTML responses when enabled', () => {
    const mw = cookieConsentMiddleware(mockConfig({
      cookieConsentEnabled: true,
      cookieConsentCategories: ['necessary', 'analytics'],
    }));
    const res = mockRes();
    const next = vi.fn();

    mw({} as Request, res, next);
    expect(next).toHaveBeenCalled();

    // Simulate sending HTML
    const html = '<html><body><h1>Test</h1></body></html>';
    (res.send as any)(html);

    const sentHtml = (res.send as any).mock.results[0]?.value;
    // The original send was replaced, check the call args
    // We need to verify the patched send was called with injected content
  });

  it('does not inject into non-HTML responses', () => {
    const mw = cookieConsentMiddleware(mockConfig({ cookieConsentEnabled: true }));
    const res = mockRes();
    (res.getHeader as any).mockReturnValue('application/json');
    const next = vi.fn();

    mw({} as Request, res, next);

    const json = '{"ok":true}';
    (res.send as any)(json);
  });
});
```

**Step 2: Run test to verify it fails**

Run:
```bash
cd aimeat && npx vitest run src/middleware/__tests__/cookie-consent.test.ts
```
Expected: FAIL — module `../cookie-consent.js` not found

**Step 3: Write the middleware implementation**

Create `aimeat/src/middleware/cookie-consent.ts`:

```typescript
import type { RequestHandler } from 'express';
import type { AimeatConfig } from '../config.js';

/**
 * Generates the HTML snippet injected before </body> in HTML responses.
 * Loads vanilla-cookieconsent CSS + JS and initializes with config.
 */
function buildConsentSnippet(config: AimeatConfig): string {
  const categories: Record<string, object> = {};
  for (const cat of config.cookieConsentCategories) {
    if (cat === 'necessary') {
      categories[cat] = { enabled: true, readOnly: true };
    } else {
      categories[cat] = {};
    }
  }

  const policyLink = config.cookieConsentPolicyUrl
    ? `\n    footer: '<a href="${config.cookieConsentPolicyUrl}" target="_blank">Privacy Policy</a>',`
    : '';

  return `
<link rel="stylesheet" href="/cookieconsent.css">
<script src="/cookieconsent.umd.js"></script>
<script>
CookieConsent.run({
  categories: ${JSON.stringify(categories)},
  guiOptions: {
    consentModal: { layout: 'box', position: 'bottom right' },
    preferencesModal: { layout: 'box' }
  },
  language: {
    default: 'en',
    autoDetect: 'document',
    translations: {
      en: {
        consentModal: {
          title: 'Cookie Settings',
          description: 'This site uses cookies to improve your experience. You can choose which categories to allow.',${policyLink}
          acceptAllBtn: 'Accept all',
          acceptNecessaryBtn: 'Reject all',
          showPreferencesBtn: 'Settings'
        },
        preferencesModal: {
          title: 'Cookie Preferences',
          acceptAllBtn: 'Accept all',
          acceptNecessaryBtn: 'Reject all',
          savePreferencesBtn: 'Save settings',
          sections: [
            { title: 'Cookie usage', description: 'We use cookies to ensure basic site functionality and to improve your experience.' },
            ${config.cookieConsentCategories.map(cat => `{ title: '${cat.charAt(0).toUpperCase() + cat.slice(1)}', linkedCategory: '${cat}' }`).join(',\n            ')}
          ]
        }
      }
    }
  }
});
</script>`;
}

/**
 * Express middleware that injects cookie consent banner into HTML responses.
 * No-op when cookieConsentEnabled is false.
 */
export function cookieConsentMiddleware(config: AimeatConfig): RequestHandler {
  if (!config.cookieConsentEnabled) {
    return (_req, _res, next) => next();
  }

  const snippet = buildConsentSnippet(config);

  return (_req, res, next) => {
    const originalSend = res.send.bind(res);

    res.send = function (body?: any): any {
      if (typeof body === 'string') {
        const contentType = res.getHeader('content-type');
        if (contentType && contentType.toString().includes('text/html')) {
          body = body.replace('</body>', `${snippet}</body>`);
        }
      }
      return originalSend(body);
    };

    next();
  };
}

/**
 * Returns the JS snippet for manual integration.
 * Service builders add <script src="/v1/portal/cookie-consent.js"></script> to their pages.
 */
export function buildStandaloneSnippetJs(config: AimeatConfig): string {
  const snippet = buildConsentSnippet(config);
  // Wrap in a self-executing loader that injects CSS, JS, and config
  return `(function(){
  var d = document;
  // Inject CSS
  var link = d.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/cookieconsent.css';
  d.head.appendChild(link);
  // Inject JS
  var script = d.createElement('script');
  script.src = '/cookieconsent.umd.js';
  script.onload = function() {
    ${buildConsentInitJs(config)}
  };
  d.head.appendChild(script);
})();`;
}

function buildConsentInitJs(config: AimeatConfig): string {
  const categories: Record<string, object> = {};
  for (const cat of config.cookieConsentCategories) {
    if (cat === 'necessary') {
      categories[cat] = { enabled: true, readOnly: true };
    } else {
      categories[cat] = {};
    }
  }

  const policyLink = config.cookieConsentPolicyUrl
    ? `\n      footer: '${config.cookieConsentPolicyUrl}',`
    : '';

  return `CookieConsent.run({
    categories: ${JSON.stringify(categories)},
    guiOptions: {
      consentModal: { layout: 'box', position: 'bottom right' },
      preferencesModal: { layout: 'box' }
    },
    language: {
      default: 'en',
      autoDetect: 'document',
      translations: {
        en: {
          consentModal: {
            title: 'Cookie Settings',
            description: 'This site uses cookies to improve your experience.',${policyLink}
            acceptAllBtn: 'Accept all',
            acceptNecessaryBtn: 'Reject all',
            showPreferencesBtn: 'Settings'
          },
          preferencesModal: {
            title: 'Cookie Preferences',
            acceptAllBtn: 'Accept all',
            acceptNecessaryBtn: 'Reject all',
            savePreferencesBtn: 'Save settings'
          }
        }
      }
    }
  });`;
}
```

**Step 4: Run tests to verify they pass**

Run:
```bash
cd aimeat && npx vitest run src/middleware/__tests__/cookie-consent.test.ts
```
Expected: PASS

**Step 5: Run type-check**

Run:
```bash
cd aimeat && npx tsc --noEmit
```
Expected: PASS

**Step 6: Commit**

```bash
git add aimeat/src/middleware/cookie-consent.ts aimeat/src/middleware/__tests__/cookie-consent.test.ts
git commit -m "feat: add cookie consent middleware and standalone snippet builder"
```

---

### Task 6: Register middleware in server.ts

**Files:**
- Modify: `aimeat/src/server.ts`

**Step 1: Add import**

At the top of `src/server.ts`, add import alongside other middleware imports:

```typescript
import { cookieConsentMiddleware } from './middleware/cookie-consent.js';
```

**Step 2: Register middleware**

In `createServer()`, after the PWA static files block (after line 97, before CORS) add:

```typescript
  // Cookie consent banner injection (opt-in for service builders)
  app.use(cookieConsentMiddleware(config));
```

This placement ensures:
1. Static cookieconsent assets are served (from `src/static/`)
2. Middleware intercepts HTML responses from all routes

**Step 3: Run type-check**

Run:
```bash
cd aimeat && npx tsc --noEmit
```
Expected: PASS

**Step 4: Commit**

```bash
git add aimeat/src/server.ts
git commit -m "feat: register cookie consent middleware in server"
```

---

### Task 7: Add JS snippet endpoint to portal router

**Files:**
- Modify: `aimeat/src/routes/portal.ts`

**Step 1: Add the route**

In `portalRouter()` function in `src/routes/portal.ts`, add a new route:

```typescript
  // Cookie consent standalone JS snippet — for manual integration
  router.get('/v1/portal/cookie-consent.js', (_req, res) => {
    if (!config.cookieConsentEnabled) {
      res.status(404).type('text/plain').send('Cookie consent is not enabled on this node.');
      return;
    }
    const { buildStandaloneSnippetJs } = await import('../middleware/cookie-consent.js');
    res.type('application/javascript').send(buildStandaloneSnippetJs(config));
  });
```

Note: Since the router uses async handlers, use dynamic import or import at the top. Check existing pattern in the file — if top-level imports are used, prefer that. The route handler should be `async` if using dynamic import.

**Step 2: Run type-check**

Run:
```bash
cd aimeat && npx tsc --noEmit
```
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/src/routes/portal.ts
git commit -m "feat: add GET /v1/portal/cookie-consent.js snippet endpoint"
```

---

### Task 8: Update env-config.ts display

**Files:**
- Modify: `aimeat/src/utils/env-config.ts`

**Step 1: Add Cookie Consent section**

Find the pattern where config sections are defined and add a new section for Cookie Consent:

```typescript
{
  title: 'Cookie Consent',
  entries: [
    { envVar: 'AIMEAT_COOKIE_CONSENT_ENABLED', description: 'Enable cookie consent banner for portal pages', value: String(config.cookieConsentEnabled), defaultVal: 'false' },
    { envVar: 'AIMEAT_COOKIE_CONSENT_CATEGORIES', description: 'Consent categories (comma-separated)', value: config.cookieConsentCategories.join(','), defaultVal: 'necessary' },
    { envVar: 'AIMEAT_COOKIE_CONSENT_POLICY_URL', description: 'Privacy policy URL', value: config.cookieConsentPolicyUrl ?? '(not set)', defaultVal: '(not set)' },
  ],
},
```

**Step 2: Run type-check**

Run:
```bash
cd aimeat && npx tsc --noEmit
```
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/src/utils/env-config.ts
git commit -m "config: display cookie consent settings in aimeat config"
```

---

### Task 9: Update env-validator.ts

**Files:**
- Modify: `aimeat/src/utils/env-validator.ts`

**Step 1: Add validation rules**

Add validation for the new env vars in `validateEnv()`:

```typescript
  // ── Cookie Consent ──
  const ccEnabled = env.AIMEAT_COOKIE_CONSENT_ENABLED;
  if (ccEnabled === 'true') {
    const ccCategories = env.AIMEAT_COOKIE_CONSENT_CATEGORIES;
    if (ccCategories) {
      const cats = ccCategories.split(',').map(s => s.trim());
      if (!cats.includes('necessary')) {
        results.push({ level: 'warning', variable: 'AIMEAT_COOKIE_CONSENT_CATEGORIES', message: '"necessary" category is recommended. It will be added automatically.' });
      }
    }
    if (!env.AIMEAT_COOKIE_CONSENT_POLICY_URL) {
      results.push({ level: 'warning', variable: 'AIMEAT_COOKIE_CONSENT_POLICY_URL', message: 'Cookie consent enabled but no privacy policy URL set. Recommended for GDPR compliance.' });
    }
  }
```

**Step 2: Run type-check**

Run:
```bash
cd aimeat && npx tsc --noEmit
```
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/src/utils/env-validator.ts
git commit -m "validate: add cookie consent env var validation"
```

---

### Task 10: Write integration tests

**Files:**
- Create: `aimeat/src/middleware/__tests__/cookie-consent.test.ts` (enhance existing from Task 5)

**Step 1: Add comprehensive tests**

Ensure the test file covers:
- Middleware is no-op when `cookieConsentEnabled` is false
- Middleware injects snippet into HTML responses when enabled
- Middleware does NOT inject into JSON responses
- `buildStandaloneSnippetJs` returns valid JavaScript string
- Snippet contains configured categories
- Policy URL appears in snippet when configured

**Step 2: Run all tests**

Run:
```bash
cd aimeat && npx vitest run
```
Expected: ALL PASS

**Step 3: Run full type-check**

Run:
```bash
cd aimeat && npx tsc --noEmit
```
Expected: PASS

**Step 4: Commit**

```bash
git add aimeat/src/middleware/__tests__/cookie-consent.test.ts
git commit -m "test: comprehensive cookie consent middleware tests"
```

---

### Task 11: Final verification

**Step 1: Type-check**

Run:
```bash
cd aimeat && npx tsc --noEmit
```
Expected: PASS

**Step 2: Unit tests**

Run:
```bash
cd aimeat && npx vitest run
```
Expected: ALL PASS

**Step 3: Build**

Run:
```bash
cd aimeat && pnpm build
```
Expected: PASS

**Step 4: Manual smoke test (optional)**

Set `AIMEAT_COOKIE_CONSENT_ENABLED=true` in `.env`, start with `pnpm dev`, visit `http://localhost:40050/v1/portal` — verify the cookie consent banner appears at the bottom right.

Visit `http://localhost:40050/v1/portal/cookie-consent.js` — verify it returns JavaScript.
