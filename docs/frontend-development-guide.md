# Frontend Development Guide

Architecture and conventions for contributing to the AIMEAT SPA frontend.

## Architecture Overview

The AIMEAT SPA uses **Preact + HTM** with no build step — all code runs directly in the browser via native ESM modules.

| Layer | Technology |
|-------|-----------|
| Framework | Preact 10.25.4 (3 KB React alternative) |
| Template DSL | HTM 3.1.1 (tagged template literals → JSX) |
| Module system | Native ESM via importmap |
| Routing | Client-side History API with lazy-loaded views |
| State | Preact hooks (useState, useEffect, useCallback, useRef) |
| Styling | External CSS per view + shared theme.css |
| Auth | JWT via window.AIMEAT.auth SDK |
| i18n | JSON locale files with dot-notation keys |

### Why No Build Step?

- Instant edit→reload development cycle
- No toolchain setup for contributors
- Direct browser debugging (source = running code)
- Works offline on any HTTP server

---

## File Structure

```
public/
├── spa.html                  # SPA shell (importmap, router, Header, ErrorBoundary)
├── css/
│   ├── theme.css             # Global design tokens + shared component styles
│   └── views/                # Per-view scoped CSS
│       ├── portal.css
│       ├── profile.css
│       ├── portal-classic.css
│       ├── portal-dev.css
│       ├── hobbies.css
│       ├── marketplace.css
│       ├── openclaw.css
│       └── aimeat-os.css
├── components/               # Shared Preact components
│   ├── Alert.js
│   ├── Card.js
│   ├── CopyButton.js
│   ├── FormField.js
│   ├── Modal.js
│   ├── Spinner.js
│   ├── Toast.js
│   ├── useViewCSS.js
│   └── index.js              # Barrel export
├── js/                       # Shared modules
│   ├── api.js                # Authenticated fetch wrapper
│   ├── i18n.js               # Translation system
│   └── utils.js              # Shared utilities
├── lib/                      # Self-hosted third-party libraries
│   ├── preact.mjs
│   ├── preact-hooks.mjs
│   ├── htm.mjs
│   ├── three.min.js
│   └── realtime.js
├── views/                    # View modules (lazy-loaded)
│   ├── portal.js
│   ├── portal-classic.js
│   ├── portal-dev.js
│   ├── profile.js
│   ├── guides.js
│   ├── hobbies.js
│   ├── marketplace.js
│   ├── openclaw.js
│   └── aimeat-os.js
└── locales/
    ├── en.json
    └── fi.json
```

---

## View Module Contract

Every view module in `public/views/` must:

1. **Export a default Preact component** as the view root
2. **Accept a `navigate` prop** for SPA link navigation
3. **Load its own CSS** using the `useViewCSS` hook
4. **Set `document.title`** in a `useEffect`

### Minimal View Template

```javascript
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { useViewCSS } from '/components/useViewCSS.js';

const html = htm.bind(h);

export default function MyView({ navigate }) {
  useViewCSS('/css/views/my-view.css');

  useEffect(() => {
    document.title = t('myview.title') + ' — AIMEAT';
  }, []);

  return html`
    <div class="mv-root">
      <h1>${t('myview.title')}</h1>
      <p>${t('myview.description')}</p>
    </div>
  `;
}
```

### Props

| Prop | Type | Description |
|------|------|-------------|
| `navigate` | `(path: string) => void` | Navigate to a SPA route without full page reload |

### Navigation

Use the `navigate` prop for internal links:

```javascript
html`<a href="/v1/profile" onClick=${e => { e.preventDefault(); navigate('/v1/profile'); }}>Profile</a>`
```

Or use standard `<a href="/v1/...">` links — the SPA shell intercepts clicks on `/v1/*` paths automatically.

---

## Component Library

Import shared components from `/components/`:

```javascript
import { Alert, Card, CopyButton, FormField, Modal, Spinner, useToast } from '/components/index.js';
```

### Alert

```javascript
html`<${Alert} type="error" message="Something failed" onDismiss=${() => setError(null)} />`
// Types: success, error, info, warn
```

### Card

```javascript
html`<${Card} title="Agent" subtitle="gaii:abc" hoverable onClick=${expand}>
  ...content...
</${Card}>`
```

### CopyButton

```javascript
html`<${CopyButton} text=${gaii} label="Copy GAII" copiedLabel="Copied!" />`
```

### FormField

```javascript
html`<${FormField} label="Name" hint="Your display name">
  <input class="input-field" value=${name} onInput=${e => setName(e.target.value)} />
</${FormField}>`
```

### Modal

```javascript
html`<${Modal} open=${showEdit} onClose=${() => setShowEdit(false)} title="Edit">
  ...dialog content...
</${Modal}>`
```

### Spinner

```javascript
html`<${Spinner} text="Loading..." />`
```

### Toast (useToast hook)

```javascript
const { showToast, ToastContainer } = useToast();
showToast('Saved!', 'success');

// In render:
html`<${ToastContainer} />`
```

### useViewCSS

```javascript
import { useViewCSS } from '/components/useViewCSS.js';

// Inside component:
useViewCSS('/css/views/my-view.css');
// Creates <link> on mount, removes on unmount
```

---

## CSS Conventions

### View-Scoped CSS

Each view has its own CSS file in `public/css/views/`. Classes are prefixed with a 2-3 letter abbreviation to avoid collisions:

| View | Prefix | Example |
|------|--------|---------|
| portal | `gn-` | `.gn-hero-title` |
| profile | `pf` | `.pf .tab-active` |
| portal-classic | `cl-` | `.cl-root` |
| portal-dev | `dv-` | `.dv-root` |
| hobbies | `hb-` | `.hb-root` |
| marketplace | `mk-` | `.mk-root` |
| openclaw | `oc-` | `.oc-root` |
| aimeat-os | `os-` | `.os-root` |

### theme.css Design Tokens

Use CSS custom properties from `theme.css` for consistent theming:

```css
color: var(--text);
background: var(--bg);
border: 1px solid var(--border);
```

### Rules

1. **No inline CSS constants** in JS files — all CSS goes in external files
2. **No `style=""` attributes** for layout/colors — use CSS classes
3. **Prefix all view CSS classes** to avoid collisions
4. **Use `useViewCSS()`** to load view CSS dynamically (automatic cleanup on unmount)

---

## i18n Key Naming

Translation keys follow dot-notation in nested JSON under `locales/en.json` and `locales/fi.json`:

```
{namespace}.{section}.{key}
```

### Namespaces

| Namespace | Used by |
|-----------|---------|
| `nav` | Header navigation |
| `hero` | Landing page hero section |
| `cards` | Landing page cards |
| `groups` | Expandable groups |
| `welcome` | Welcome board |
| `profile` | Profile view |
| `dev` | Dev portal |
| `classic` | Classic portal |
| `hobbies` | Hobbies view |
| `mkt` | Marketplace view |

### Adding New Keys

1. Add nested JSON to both `locales/en.json` and `locales/fi.json`
2. Use `t('namespace.key')` in views (via `import { t } from '/js/i18n.js'`)
3. For view-specific prefixes, create a wrapper: `function mt(key) { return t('myview.' + key); }`

### Existing Conventions

- portal-dev.js: Uses `dt(key)` → `globalT('dev.' + key)`
- portal-classic.js: Uses `ct(key)` → `globalT('classic.' + key)`

---

## Error Handling

### View Errors

The SPA shell wraps all view renders in an `ErrorBoundary` component. If a view throws during render, it shows a retry UI instead of crashing the whole app.

### API Errors

```javascript
const result = await apiGet('/v1/memory/key');
if (!result.ok) {
  // result.error = { code: 'NOT_FOUND', message: 'Resource not found' }
  setError(result.error.message);
  return;
}
// Use result.data
```

The `api()` wrapper automatically retries on 429 (rate limit) and 5xx errors with exponential backoff (max 3 retries). Network failures return `{ ok: false, error: { code: 'NETWORK_ERROR', message: '...' } }`.

### XSS Prevention

Always escape user-generated content:

```javascript
import { escHtml, escAttr, sanitizeHtml } from '/js/utils.js';

// In templates
html`<span>${escHtml(userInput)}</span>`

// In attributes
html`<div title="${escAttr(userInput)}">`

// For rich text (allows <b>, <i>, <a>, <code>, etc.)
html`<div dangerouslySetInnerHTML=${{ __html: sanitizeHtml(richContent) }} />`
```

---

## Testing

### Playwright Tests

Frontend E2E tests live in `test/playwright/`:

| File | Tests |
|------|-------|
| `views.spec.ts` | SPA routing (8 routes), CSP headers, view rendering |
| `libs.spec.ts` | SDK library loading, auth flow, data operations |

Run tests (requires server on port 40251):

```bash
npx playwright test
```

### What to Test

- **Route loads**: Each `/v1/*` route renders its view without errors
- **Unauthenticated state**: Login prompts appear, protected features hidden
- **Interactive elements**: Tab switching, accordion expand, search/filter
- **Security headers**: CSP, X-Content-Type-Options, X-Frame-Options present

### Writing New View Tests

```typescript
test('my view renders correctly', async ({ page }) => {
  await page.goto('/v1/myview');
  await page.waitForLoadState('networkidle');
  const content = page.locator('.mv-root');
  await expect(content).toBeVisible({ timeout: 10_000 });
});
```

---

## Development Workflow

1. Start the dev server: `cd aimeat && pnpm dev`
2. Open `http://localhost:40050/v1/portal` in your browser
3. Edit view files — reload the page to see changes (no build step)
4. Type-check: `npx tsc --noEmit`
5. Run Playwright tests: `npx playwright test`

### Adding a New View

1. Create `public/views/my-view.js` with the default export component
2. Create `public/css/views/my-view.css` with scoped styles (use unique prefix)
3. Add the route in `spa.html` (the route → module mapping)
4. Add translation keys to `locales/en.json` and `locales/fi.json`
5. Add a Playwright test in `test/playwright/views.spec.ts`
6. Run `npx tsc --noEmit` to verify
