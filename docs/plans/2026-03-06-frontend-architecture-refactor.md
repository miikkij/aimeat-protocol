# Frontend Architecture Refactor Plan

## Current State — Assessment

### What We Have

The AIMEAT frontend is a **Preact + htm SPA** loaded from `aimeat/public/spa.html`. Views are ES modules dynamically imported. Shared components exist but are mostly unused. Data fetching is inconsistent across views.

### File Map

```
public/
├── spa.html                      # Entry point, router, ErrorBoundary
├── lib/                          # Vendored libraries
│   ├── preact.mjs                # Preact 10.x
│   ├── preact-hooks.mjs          # Preact hooks
│   ├── htm.mjs                   # HTM tagged templates
│   ├── three.min.js              # Three.js (3D)
│   └── realtime.js               # Realtime helpers
├── js/                           # Shared utilities
│   ├── api.js                    # Fetch wrapper with retry + auth (57 LOC)
│   ├── hooks.js                  # useApiCall() hook (62 LOC)
│   ├── i18n.js                   # Translation loader + t() (120 LOC)
│   └── utils.js                  # escHtml, timeAgo, formatBytes, copyToClipboard (150 LOC)
├── components/                   # Shared components (EXIST BUT MOSTLY UNUSED)
│   ├── index.js                  # Barrel export
│   ├── Toast.js                  # useToast() hook — NOT USED by views
│   ├── Modal.js                  # Modal dialog — NOT USED by profile
│   ├── Card.js                   # Card container — NOT USED
│   ├── Alert.js                  # Alert box — rarely used
│   ├── Spinner.js                # Loading spinner — rarely used
│   ├── CopyButton.js             # Copy button — rarely used
│   ├── FormField.js              # Form field — NEVER used
│   └── useViewCSS.js             # No-op CSS hook (12 LOC)
├── views/                        # Page components
│   ├── _template.js              # View scaffolding template (85 LOC)
│   ├── profile.js                # ⚠️ 3,000+ LOC MONOLITH — 16 tabs, 60+ useState
│   ├── portal.js                 # Landing page (1,200 LOC)
│   ├── hobbies.js                # Hobby directory (700 LOC)
│   ├── marketplace.js            # Marketplace (550 LOC)
│   ├── portfolio.js              # Public portfolio (650 LOC)
│   ├── aimeat-os.js              # AIMEAT OS docs (600 LOC)
│   ├── guides.js                 # Guides (400 LOC)
│   ├── portal-dev.js             # Dev portal (500 LOC)
│   ├── portal-classic.js         # Classic view (350 LOC)
│   └── openclaw.js               # OpenClaw (220 LOC)
├── css/
│   ├── theme.css                 # Global theme, variables, base components (700 LOC)
│   └── views/                    # Per-view CSS (minified)
│       ├── profile.css           # 2,100 LOC minified ⚠️
│       ├── portal.css            # 900 LOC minified
│       ├── hobbies.css           # 500 LOC
│       ├── marketplace.css       # 400 LOC
│       └── ...others
└── cortex-bundled/               # Extension YAML manifests + JS libs
    ├── aimeat-charts.yaml/js
    └── aimeat-canvas.yaml/js
```

### Identified Problems

| # | Problem | Severity | Where |
|---|---------|----------|-------|
| 1 | **profile.js is 3,000+ LOC monolith** — 16 tabs, 60+ useState, 100+ functions | 🔴 Critical | `views/profile.js` |
| 2 | **3 different fetch patterns** — raw `fetch()`, `session.fetch()`, `api()` wrapper — each view invents its own | 🔴 Critical | Every view |
| 3 | **Shared components exist but aren't used** — Toast.js, Modal.js, Card.js etc. are unused; views reinvent inline | 🔴 Critical | Every view |
| 4 | **No service layer** — API calls mixed with UI logic everywhere | 🟡 Design | Every view |
| 5 | **Toast CSS was broken** — conflicting styles in theme.css vs profile.css, no animation in base | 🟡 Design | CSS files |
| 6 | **No global state** — no Context, no store; auth via `window.AIMEAT` global | 🟡 Design | All views |
| 7 | **CSS monoliths** — profile.css is 2,100 lines minified, unreadable | 🟡 Design | `css/views/` |
| 8 | **No documentation** — no README explaining structure, patterns, or how to add features | 🟠 DX | — |
| 9 | **i18n lacks interpolation** — can't do `t('hello', { name })` | 🟠 DX | `js/i18n.js` |
| 10 | **No deep linking** — tab state in profile not reflected in URL | 🟠 DX | `spa.html` |

### What Works Well (Keep)

- **Preact + htm** — lightweight, no build step, fast
- **SPA router** — simple URL-based routing
- **`api.js` wrapper** — retry logic, auth injection, clean pattern
- **`useApiCall()` hook** — well-designed, just underused
- **i18n system** — solid foundation with locale switching
- **CSS variables** — good theming support
- **`_template.js`** — good starting scaffold for new views
- **AIMEAT response envelope** — `{ ok, data, error, hints }` is clear

---

## Target Architecture

### Principles

1. **Services hold data logic** — API calls, data transforms, caching in `/js/services/`
2. **Components are reusable UI** — Toast, Modal, List, Form, Card in `/components/`
3. **Views compose services + components** — thin orchestration layer in `/views/`
4. **One pattern for fetching** — `api()` + `useApiCall()` everywhere, kill `session.fetch()` direct calls
5. **Feature-split large views** — profile.js → 16 tab files in `views/profile/`

### Target File Structure

```
public/
├── spa.html                      # Entry point (NO changes needed)
├── lib/                          # Vendored (NO changes)
├── js/
│   ├── api.js                    # Fetch wrapper (KEEP, minor upgrades)
│   ├── hooks.js                  # useApiCall + new hooks (EXTEND)
│   ├── i18n.js                   # Translations (ADD interpolation)
│   ├── utils.js                  # Helpers (KEEP)
│   └── services/                 # 🆕 DATA LAYER
│       ├── auth.js               # Session helpers, getSession(), onAuthChange()
│       ├── cortex.js             # Cortex extension CRUD
│       ├── agents.js             # Agent CRUD
│       ├── wallet.js             # Wallet operations
│       ├── memory.js             # Memory CRUD + search
│       ├── boards.js             # Board operations
│       ├── files.js              # File upload/download
│       ├── apps.js               # App management
│       ├── work.js               # Work inbox/history
│       ├── federation.js         # Node peering
│       └── admin.js              # Node stats, security, access
├── components/                   # SHARED UI (ENFORCE usage)
│   ├── index.js                  # Barrel export
│   ├── Toast.js                  # ✅ KEEP — make all views USE it
│   ├── Modal.js                  # ✅ KEEP — make all views USE it
│   ├── Card.js                   # ✅ KEEP
│   ├── Alert.js                  # ✅ KEEP
│   ├── Spinner.js                # ✅ KEEP
│   ├── CopyButton.js             # ✅ KEEP
│   ├── FormField.js              # ✅ KEEP
│   ├── DataList.js               # 🆕 Generic list with loading/empty/error states
│   ├── TabPanel.js               # 🆕 Tab switching component
│   ├── ConfirmDialog.js          # 🆕 Confirmation modal
│   └── StatusBadge.js            # 🆕 Active/Inactive/Pending badges
├── views/
│   ├── _template.js              # KEEP
│   ├── profile.js                # 🔄 REFACTOR → thin shell loading tab modules
│   ├── profile/                  # 🆕 SPLIT profile tabs
│   │   ├── agents-tab.js         # Agents management
│   │   ├── wallet-tab.js         # Wallet + transactions
│   │   ├── memory-tab.js         # Memory CRUD + search
│   │   ├── work-tab.js           # Work inbox + history
│   │   ├── services-tab.js       # Service publishing
│   │   ├── boards-tab.js         # Board management
│   │   ├── apps-tab.js           # App upload + management
│   │   ├── files-tab.js          # File management
│   │   ├── extensions-tab.js     # Cortex extensions
│   │   ├── federation-tab.js     # Node peering
│   │   ├── nodes-tab.js          # Node management
│   │   ├── access-tab.js         # Access control / permissions
│   │   ├── data-wallet-tab.js    # Consents, GDPR, audit
│   │   ├── stats-tab.js          # Node statistics
│   │   ├── security-tab.js       # Security settings (CORS, TOTP)
│   │   ├── portfolio-tab.js      # Portfolio / about
│   │   └── chat-sessions-tab.js  # Chat session management
│   ├── portal.js                 # KEEP (manageable size)
│   ├── hobbies.js                # KEEP (well-structured sub-views)
│   ├── marketplace.js            # KEEP (manageable)
│   └── ...others                 # KEEP
└── css/
    ├── theme.css                 # Global (FIXED toast, keep rest)
    └── views/
        ├── profile.css           # KEEP but unminify for maintainability
        └── ...others
```

---

## Implementation Phases

### Phase 1 — Services Layer + Documentation (Foundation)

**Goal:** Create the services layer so data fetching has one clear pattern. Document the architecture.

#### 1.1 Create `js/services/auth.js`

Extract auth helpers from profile.js into a service:

```javascript
// js/services/auth.js
import { api } from '/js/api.js';

/** Get current auth session, or null. */
export function getSession() {
  const a = window.AIMEAT?.auth;
  if (!a || typeof a.getSession !== 'function') return null;
  const s = a.getSession();
  return (s && s.jwt) ? s : null;
}

/** Authenticated API call — uses api.js wrapper (handles retry + auth).
 *  ALL views should use this instead of session.fetch(). */
export function authApi(path, opts) {
  return api(path, opts);
}

/** Listen for auth state changes. Returns unsubscribe function. */
export function onAuthChange(callback) {
  window.addEventListener('aimeat-auth-change', callback);
  return () => window.removeEventListener('aimeat-auth-change', callback);
}

/** Get owner name from session. */
export function getOwner() {
  return getSession()?.owner || null;
}
```

#### 1.2 Create `js/services/cortex.js`

Extract ALL Cortex API calls from profile.js:

```javascript
// js/services/cortex.js
import { api, apiGet, apiPost, apiDelete } from '/js/api.js';

/** List installed extensions. Returns { extensions, total }. */
export async function listExtensions() {
  const data = await apiGet('/v1/cortex');
  return data.ok ? data.data : { extensions: [], total: 0 };
}

/** Get extension detail + prompt content + ontology. */
export async function getExtensionDetail(name) {
  const [ext, prompt, ontology] = await Promise.all([
    apiGet(`/v1/cortex/${encodeURIComponent(name)}`),
    apiGet(`/v1/cortex/${encodeURIComponent(name)}/prompts`).catch(() => ({ ok: false })),
    apiGet(`/v1/cortex/${encodeURIComponent(name)}/ontology`).catch(() => ({ ok: false })),
  ]);
  if (!ext.ok) return null;
  const detail = ext.data?.extension || ext.data;
  if (prompt.ok) detail._prompts = prompt.data;
  if (ontology.ok) detail._ontologies = ontology.data?.ontologies || [];
  return detail;
}

/** Activate an extension. */
export async function activateExtension(name) {
  return apiPost(`/v1/cortex/${encodeURIComponent(name)}/activate`);
}

/** Deactivate an extension. */
export async function deactivateExtension(name) {
  return apiPost(`/v1/cortex/${encodeURIComponent(name)}/deactivate`);
}

/** Uninstall an extension. */
export async function uninstallExtension(name) {
  return apiDelete(`/v1/cortex/${encodeURIComponent(name)}`);
}

/** Toggle visibility (private ↔ public). */
export async function toggleVisibility(name, currentVisibility) {
  const action = currentVisibility === 'public' ? 'make-private' : 'make-public';
  return apiPost(`/v1/cortex/${encodeURIComponent(name)}/${action}`);
}

/** Install from manifest YAML + optional libs. */
export async function installExtension(yaml, libs) {
  return api('/v1/cortex', {
    method: 'POST',
    body: JSON.stringify({ manifest_yaml: yaml, libs }),
  });
}

/** Install a bundled extension by ID. */
export async function installBundledExtension(bundledId) {
  const url = window.location.origin;
  const [yamlResp, jsResp] = await Promise.all([
    fetch(`${url}/cortex-bundled/${bundledId}.yaml`),
    fetch(`${url}/cortex-bundled/${bundledId}.js`),
  ]);
  if (!yamlResp.ok) return { ok: false, error: { message: 'Failed to load manifest' } };
  const yaml = await yamlResp.text();
  const libs = {};
  if (jsResp.ok) libs[`${bundledId}.js`] = await jsResp.text();
  return installExtension(yaml, libs);
}
```

#### 1.3 Create services for remaining domains

Same pattern for `agents.js`, `wallet.js`, `memory.js`, `boards.js`, `files.js`, `apps.js`, `work.js`, `federation.js`, `admin.js`.

Each service:
- Imports from `/js/api.js`
- Exports async functions that return clean data
- Handles error normalization
- Zero UI logic

#### 1.4 Create `docs/frontend-development-guide.md`

Document:
- Architecture overview (spa.html → views → services → api.js)
- How to create a new view (follow `_template.js`)
- How to create a service
- How to use shared components
- Data fetching pattern (always use `api.js` or `useApiCall`)
- Toast/notification pattern (always use `useToast()` from components)
- CSS conventions (scope with `.viewname` prefix, use CSS vars)
- i18n conventions (key naming, where to add translations)

### Phase 2 — Split Profile Monolith

**Goal:** Break profile.js from 3,000+ LOC into ~200 LOC shell + 16 tab modules.

#### 2.1 Profile shell (new profile.js)

```javascript
// views/profile.js — thin shell
import { html } from 'htm/preact';
import { useState, useEffect, useCallback, lazy, Suspense } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { getSession, onAuthChange } from '/js/services/auth.js';
import { useToast } from '/components/index.js';

// Lazy-load tab modules
const TABS = {
  portfolio:  () => import('./profile/portfolio-tab.js'),
  agents:     () => import('./profile/agents-tab.js'),
  chat:       () => import('./profile/chat-sessions-tab.js'),
  wallet:     () => import('./profile/wallet-tab.js'),
  memory:     () => import('./profile/memory-tab.js'),
  work:       () => import('./profile/work-tab.js'),
  services:   () => import('./profile/services-tab.js'),
  boards:     () => import('./profile/boards-tab.js'),
  apps:       () => import('./profile/apps-tab.js'),
  extensions: () => import('./profile/extensions-tab.js'),
  federation: () => import('./profile/federation-tab.js'),
  nodes:      () => import('./profile/nodes-tab.js'),
  access:     () => import('./profile/access-tab.js'),
  datawallet: () => import('./profile/data-wallet-tab.js'),
  stats:      () => import('./profile/stats-tab.js'),
  security:   () => import('./profile/security-tab.js'),
};

export default function ProfileView({ navigate, locale }) {
  const [session, setSession] = useState(getSession());
  const [activeTab, setActiveTab] = useState('portfolio');
  const [TabComponent, setTabComponent] = useState(null);
  const { showToast, ToastContainer } = useToast();

  // Auth listener
  useEffect(() => onAuthChange(() => setSession(getSession())), []);

  // Lazy-load active tab
  useEffect(() => {
    const loader = TABS[activeTab];
    if (!loader) return;
    loader().then(mod => setTabComponent(() => mod.default));
  }, [activeTab]);

  if (!session) return html`<div>...</div>`; // Sign-in prompt

  return html`
    <div class="pf">
      <!-- Header, stats bar -->
      <!-- Tab buttons -->
      <!-- Active tab content -->
      ${TabComponent && html`<${TabComponent}
        session=${session} showToast=${showToast} locale=${locale} navigate=${navigate}
      />`}
      <${ToastContainer} />
    </div>
  `;
}
```

#### 2.2 Tab module pattern

Each tab module is a self-contained component:

```javascript
// views/profile/extensions-tab.js
import { html } from 'htm/preact';
import { useState, useEffect } from 'preact/hooks';
import { t } from '/js/i18n.js';
import * as cortex from '/js/services/cortex.js';
import { Modal, Spinner, CopyButton } from '/components/index.js';

export default function ExtensionsTab({ session, showToast }) {
  const [extensions, setExtensions] = useState(null);
  const [detailName, setDetailName] = useState(null);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    cortex.listExtensions().then(d => setExtensions(d.extensions));
  }, []);

  async function handleActivate(name) {
    const r = await cortex.activateExtension(name);
    if (r.ok !== false) { showToast(t('profile.extensions.activated')); reload(); }
    else showToast(t('profile.error'), true);
  }

  // ... clean, focused logic

  return html`<div>...</div>`;
}
```

#### 2.3 Migration strategy

1. Create `views/profile/` directory
2. Extract one tab at a time, starting with the simplest (stats, nodes)
3. Each extracted tab imports from services, uses shared components
4. Profile.js shrinks incrementally — each extraction removes ~150-300 LOC
5. Final profile.js is just the shell (~200 LOC)

### Phase 3 — Enforce Shared Components

**Goal:** All views use the same Toast, Modal, Alert, Spinner. No more inline reimplementations.

#### 3.1 Migrate profile.js to `useToast()`

Replace inline toast state + rendering with the shared hook.

#### 3.2 Migrate other views

Audit each view for inline toast/modal/spinner and replace with imports from `/components/`.

#### 3.3 Add missing components

- `DataList.js` — generic list with loading, empty, error states
- `TabPanel.js` — tab switching (extract from profile)
- `ConfirmDialog.js` — "Are you sure?" modal
- `StatusBadge.js` — Active/Inactive/Pending pill badges

### Phase 4 — Polish & Developer Experience

#### 4.1 Add `t()` interpolation

```javascript
// Before: t('welcome') → "Welcome, {name}!" (broken)
// After:  t('welcome', { name: 'Bob' }) → "Welcome, Bob!"
export function t(key, params) {
  let val = translations[key] || fallback[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      val = val.replace(`{${k}}`, String(v));
    }
  }
  return val;
}
```

#### 4.2 URL deep linking for profile tabs

```javascript
// Reflect active tab in URL hash
// /v1/profile#extensions → opens Extensions tab
useEffect(() => {
  const hash = window.location.hash.slice(1);
  if (hash && TABS[hash]) setActiveTab(hash);
}, []);

useEffect(() => {
  history.replaceState(null, '', `#${activeTab}`);
}, [activeTab]);
```

#### 4.3 Unminify profile.css

Convert the minified 2,100 LOC blob to readable formatted CSS. Could also split into per-tab CSS files that lazy-load with each tab.

---

## Execution Order

| Step | What | Impact | Effort |
|------|------|--------|--------|
| **1.1** | Create `auth.js` service | Foundation for everything | Small |
| **1.2** | Create `cortex.js` service | Fixes current Cortex debugging pain | Small |
| **1.3** | Create remaining services | Completes service layer | Medium |
| **1.4** | Write frontend dev guide | Team alignment | Small |
| **2.1** | Profile shell | Enables tab splitting | Medium |
| **2.2** | Extract easiest tabs (stats, nodes, federation) | Quick wins, validate pattern | Medium |
| **2.3** | Extract complex tabs (extensions, memory, agents) | Major complexity reduction | Large |
| **2.4** | Extract remaining tabs | Complete monolith breakup | Large |
| **3.1** | Migrate profile to useToast() | Fix toast consistency | Small |
| **3.2** | Migrate other views to shared components | Reduce duplication | Medium |
| **3.3** | Add new shared components | DataList, TabPanel, etc. | Medium |
| **4.1** | i18n interpolation | Better translations | Small |
| **4.2** | URL deep linking | Better UX | Small |
| **4.3** | Unminify profile.css | Maintainability | Small |

### What NOT To Change

- **Don't switch frameworks** — Preact + htm is fine, no need for React/Vue
- **Don't add a build step** — ESM imports work, keep it build-free
- **Don't add TypeScript to frontend** — JSDoc is enough for static files
- **Don't refactor portal.js, hobbies.js, marketplace.js** — they're manageable size
- **Don't restructure spa.html** — the router works well

---

## Service Contract Pattern

Every service function follows this contract:

```javascript
// READ operations return data directly (null on error)
const extensions = await cortex.listExtensions();
// extensions = { extensions: [...], total: 5 } or { extensions: [], total: 0 }

// WRITE operations return the API response envelope
const result = await cortex.activateExtension('aimeat-charts');
// result = { ok: true, data: {...} } or { ok: false, error: { code: '...', message: '...' } }
```

Views call services, check results, show toasts:

```javascript
const result = await cortex.activateExtension(name);
if (result.ok !== false) {
  showToast(t('profile.extensions.activated'));
  reload();
} else {
  showToast(result.error?.message || t('profile.error'), true);
}
```

---

## Success Criteria

After this refactor:

1. **profile.js** is ≤200 LOC (shell only)
2. **Every tab** is a self-contained module (100-300 LOC each)
3. **Every API call** goes through `api.js` — no more `session.fetch()` or raw `fetch()`
4. **All views** use shared Toast, Modal, Spinner from `/components/`
5. **All data logic** lives in `/js/services/` — zero fetch calls in view files
6. **Frontend dev guide** exists and is accurate
7. **No more giant color box flash** — toast CSS is unified and animated
8. **New features** can be added by: create service function + create tab file + done
