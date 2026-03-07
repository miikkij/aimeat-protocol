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

---

## Admin Dashboard SPA

The admin dashboard (`/v1/admin`) is a self-contained SPA within the main AIMEAT frontend. It uses the same Preact + HTM stack but has its own component library, layout system, and CSS.

### Architecture

```
public/views/
├── admin.js                    # Main dashboard shell (sidebar, routing, data loading)
└── admin/                      # Tab components
    ├── shared.js               # Shared admin components (Badge, StatsGrid, ExpandableHelp, etc.)
    ├── overview-tab.js          # Node health, stats, economy, warnings
    ├── economy-tab.js           # Morsel economy details
    ├── config-tab.js            # Live configuration editor
    ├── cors-tab.js              # CORS policy management
    ├── maintenance-tab.js       # Maintenance mode toggle
    ├── hooks-tab.js             # Extension hooks management
    ├── portal-tab.js            # Portal template editor, memory keys, KV pairs
    ├── stats-tab.js             # Usage statistics with charts
    ├── owners-tab.js            # Owner management
    ├── agents-tab.js            # Agent management
    ├── ghii-tab.js              # GHII identity & verification
    ├── actions-tab.js           # Published actions
    ├── boards-tab.js            # Discussion boards
    ├── chat-instances-tab.js    # Chat sessions
    ├── realtime-tab.js          # WebSocket rooms
    ├── work-tab.js              # Work requests & deliveries
    ├── email-tab.js             # Email/SMTP configuration
    ├── push-tab.js              # Push notifications
    ├── directory-tab.js         # Directory index management
    ├── matching-tab.js          # Matching engine
    ├── marketplace-tab.js       # Marketplace management
    ├── csm-tab.js               # CSM template management
    ├── msm-tab.js               # MSM integration management
    ├── federation-tab.js        # Federation cluster management
    └── genesis-tab.js           # Genesis peer management

public/css/views/admin.css       # All admin dashboard styles (adm-* prefix)
public/js/services/admin.js      # Admin API service layer
```

### Tab Component Contract

Every tab module in `public/views/admin/` must:

1. **Export a default Preact component** as the tab content
2. **Accept `{ data, reload }` props** (some tabs also receive `session`, `navigate`, `locale`, `switchPage`)
3. **Use `t('dashboard.keyName')` for all user-visible text** (i18n)
4. **Use shared components** from `./shared.js` (Badge, StatsGrid, EconRow, ExpandableHelp, Empty, etc.)

```javascript
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { StatsGrid, Empty, ExpandableHelp } from './shared.js';

export default function MyTab({ data, reload }) {
  const myData = data.mySection;
  if (!myData) return html`<${Empty} text=${t('dashboard.myEmptyMsg')} />`;

  return html`
    <p style="color:var(--text-dim);font-size:.85rem;margin-bottom:12px">${t('dashboard.myExplain')}</p>
    <${ExpandableHelp} title=${t('dashboard.myHelpTitle')}>
      <p>${t('dashboard.myHelpDetail')}</p>
    </${ExpandableHelp}>
    <!-- Tab content here -->
  `;
}
```

### Shared Admin Components (`shared.js`)

| Component | Props | Description |
|-----------|-------|-------------|
| `Badge` | `{ type }` | Colored badge (healthy/watch/critical/info/public/private/etc.) |
| `StatCard` | `{ label, value, sub, color }` | Single stat card with large number |
| `StatsGrid` | `{ items }` | 4-column grid of StatCards |
| `EconRow` | `{ label, value }` | Key-value row (like economy stats) |
| `HealthRow` | `{ label, obj }` | Health metric row with badge + value |
| `ExpandableHelp` | `{ title, children }` | Collapsible help section with styled details/summary |
| `Empty` | `{ text }` | Empty state placeholder |
| `ErrorBox` | `{ message }` | Red error box |
| `Spinner` | `{ text }` | Loading spinner |
| `DataTable` | `{ headers, rows, scroll }` | Generic data table |
| `num(n)` | — | Format number with locale |
| `dt(s)` | — | Format date string |
| `fmtUp(s)` | — | Format uptime seconds |
| `fmtBytes(b)` | — | Format bytes |

### Adding a New Admin Tab

1. Create `public/views/admin/my-tab.js` following the tab component contract above
2. Import it in `public/views/admin.js` and add to the `tabs` array:
   ```javascript
   import MyTab from './admin/my-tab.js';
   // In tabs array:
   { id: 'my-tab', icon: '\u{1F4CB}', key: 'dashboard.myTab', component: MyTab, count: 'myCount' }
   ```
3. Add API functions to `public/js/services/admin.js` if needed
4. Add translation keys under `dashboard.*` in both `locales/en.json` and `locales/fi.json`
5. Add CSS classes to `public/css/views/admin.css` using `adm-*` prefix

### Admin CSS Classes

All admin styles use the `adm-` prefix. Key classes:

| Class | Usage |
|-------|-------|
| `adm-card` | Card container with glass background |
| `adm-grid adm-grid-4` | 4-column responsive grid |
| `adm-grid adm-grid-2` | 2-column responsive grid |
| `adm-card-grid` | Auto-fill card grid (340px min) |
| `adm-btn` | Primary button (blue) |
| `adm-btn-sm` | Small outlined button |
| `adm-btn-action` | Action button (outlined, accent color) |
| `adm-badge adm-badge-{type}` | Status badge |
| `adm-erow` | Economy/key-value row |
| `adm-hrow` | Health metric row |
| `adm-help` | Expandable help section |
| `adm-help-summary` | Help section header |
| `adm-help-body` | Help section content |
| `adm-nav-item` | Sidebar navigation item |
| `adm-sub-panel` | Nested sub-panel |

### Admin API Service (`admin.js`)

All admin API calls go through `public/js/services/admin.js`. This module imports `apiGet`, `apiPost`, `apiPut`, `apiDelete` from `/js/api.js` and exports named functions for each admin endpoint.

```javascript
// Pattern for adding new admin API functions:
export const getMyData  = ()     => apiGet('/v1/admin/my-endpoint');
export const updateMyData = (id, data) => apiPut(`/v1/admin/my-endpoint/${encodeURIComponent(id)}`, data);
```

### Admin i18n Keys

Admin translation keys live under `dashboard.*` in the locale files. Conventions:

| Pattern | Example | Usage |
|---------|---------|-------|
| `dashboard.{tabName}` | `dashboard.overview` | Tab label in sidebar |
| `dashboard.{feature}Explain` | `dashboard.emailExplain` | Tab explanation paragraph |
| `dashboard.{feature}HelpTitle` | `dashboard.emailSmtpHelp` | ExpandableHelp title |
| `dashboard.{feature}HelpDetail` | `dashboard.emailSmtpHelpDetail` | ExpandableHelp body text |
| `dashboard.{feature}Empty` / `dashboard.no{Feature}` | `dashboard.marketplaceEmpty` | Empty state message |
| `dashboard.cfg_{path}` | `dashboard.cfg_economy_welcome_bonus` | Config setting label |
| `dashboard.cfgGroup_{group}` | `dashboard.cfgGroup_economy` | Config group header |

### XSS Prevention in Admin

- Use `escHtml()` **only** for user-provided data (owner names, agent IDs, descriptions)
- Do **NOT** use `escHtml()` on `t()` translations — Preact's virtual DOM handles escaping automatically
- Double-escaping issue: `escHtml()` in htm templates causes `<=` to render as `&lt;=` because Preact already escapes text nodes
