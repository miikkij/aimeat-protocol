# AIMEAT Frontend Architecture Overhaul — Analysis & Proposals

**Date:** 2026-03-05  
**Status:** Draft  
**Author:** Development team  

---

## Table of Contents

1. [Current State Assessment](#1-current-state-assessment)
2. [Problem Inventory](#2-problem-inventory)
3. [Proposed Architecture: Lite SPA with Vanilla Router](#3-proposed-architecture-lite-spa-with-vanilla-router)
4. [Implementation Plan](#4-implementation-plan)
5. [Phase 1 — Foundation (Shared CSS + i18n)](#5-phase-1--foundation)
6. [Phase 2 — SPA Shell + Client Router](#6-phase-2--spa-shell--client-router)
7. [Phase 3 — Page Modules](#7-phase-3--page-modules)
8. [Phase 4 — Dev Portal Migration](#8-phase-4--dev-portal-migration)
9. [Phase 5 — Testing & Polish](#9-phase-5--testing--polish)
10. [Framework Options Analysis](#10-framework-options-analysis)
11. [Migration Strategy](#11-migration-strategy)
12. [Risk Assessment](#12-risk-assessment)

---

## 1. Current State Assessment

### Architecture Overview

The AIMEAT frontend is a **traditional multi-page application (MPA)** with no build pipeline, no framework, and no component system. Each HTML page is fully self-contained: inline CSS, inline translations, inline JavaScript.

### Quantitative Summary

| Metric | Value |
|--------|-------|
| Total HTML files | 9 static + 1 SSR (dev portal) |
| Total frontend lines | ~28,000 |
| Largest file | profile.html (~9,000 lines) |
| Shared components | 1 (aimeat-header.js, 550 lines) |
| Duplicated i18n lines | ~2,500 |
| Duplicated CSS lines | ~1,200 |
| Build pipeline | None |
| Frontend tests | None (E2E only) |
| Frontend framework | None (vanilla JS) |

### File Inventory

| File | ~Lines | Purpose |
|------|--------|---------|
| profile.html | 9,000 | 11-tab user dashboard |
| guides.html | 7,000 | Guide catalog + app templates |
| human.html | 2,500 | Main landing portal |
| human-classic.html | 2,000 | Legacy dashboard variant |
| aimeat-os.html | 1,500 | Architecture guide |
| marketplace.html | 1,200 | Service marketplace |
| wizard.html | 800 | First-run setup |
| hobbies.html | 670 | Interest directory |
| openclaw.html | 500 | OpenClaw docs |
| aimeat-header.js | 550 | Shared header component |
| portal.ts (SSR) | 1,400 | Dev portal (server-rendered) |

### What Works Well

- **Zero external dependencies** — no npm packages for the frontend, no supply chain risk
- **Self-contained pages** — each page works independently, no coupling
- **Battle-tested auth library** — `aimeat-auth.js` handles login, JWT refresh, session persistence
- **AIMEAT envelope pattern** — consistent API responses with `{ ok, data, hints }`
- **Session survives hard refresh** — localStorage-backed JWT with auto-refresh
- **E2E test suite** — 35+ backend integration tests

---

## 2. Problem Inventory

### P1: Catastrophic Duplication (Impact: HIGH)

Every HTML file independently defines:

- **`:root` CSS variables** — 15+ variables repeated in 9 files, with inconsistent values (e.g., `--accent` is `#ff69b4` in guides but `#ff6b9d` in profile)
- **TRANSLATIONS objects** — Full en/fi translation sets embedded inline. Fixing one typo in `modal.title` requires editing 9 files
- **Auth loading patterns** — 3 different patterns across files (explicit script tag, dynamic loading, header delegation)
- **Locale detection** — Same ~30 lines of URL → localStorage → cookie → navigator fallback logic in every file

**Cost:** A single branding change, translation fix, or auth refactor requires touching 9-10 files manually.

### P2: No Navigation Persistence (Impact: HIGH)

Every page navigation triggers:
1. Full HTML download + parse
2. CSS re-parse (all inline)
3. aimeat-auth.js re-download + re-execute
4. aimeat-header.js re-download + re-execute
5. Session restoration from localStorage (async JWT refresh)
6. Re-fetch all API data from scratch
7. Translation objects re-parsed

**Result:** Slow navigations, flash of unstyled content, visible "loading..." spinners, and momentary logged-out state visible to the user before session restores.

### P3: Hard Refresh Fragility (Impact: HIGH)

Ctrl+F5 triggers a cache-busting reload. Because there's no service worker caching strategy and no offline fallback for the main pages, users see:
- Brief "loading..." state while auth restores
- 404 console errors for optional endpoints (e.g., `/v1/personal/status` when no personal node exists) — these are correct behavior but look broken
- GHII not visible until session restoration completes (async race condition)

### P4: Monolithic Files (Impact: MEDIUM)

`profile.html` at 9,000 lines contains 11 tabs worth of functionality in a single file:
- Wallet management
- Agent list
- Memory browser
- Storage file manager
- App uploader
- Consent management
- Audit log
- Personal node status
- GDPR export

Any change to one tab risks breaking others. No encapsulation, no module boundaries.

### P5: No Build Pipeline (Impact: MEDIUM)

- No minification — 28,000 lines served raw
- No code splitting — user downloads profile.html's 9,000 lines even to see one tab
- No asset fingerprinting — cache invalidation is unreliable
- No tree-shaking — unused code shipped
- No source maps for debugging

### P6: No Frontend Type Safety (Impact: LOW-MEDIUM)

All frontend code is vanilla JavaScript with no type checking. Backend is strict TypeScript, but the frontend that calls the same APIs has no type safety. API response shapes are assumed, not validated.

### P7: i18n Not Scalable (Impact: MEDIUM)

- Adding a new language requires editing all 9 HTML files
- Translation keys are not validated — a typo in a key silently falls through to English
- No tooling for translators — no extract/import workflow
- Header has its own mini-translation system separate from pages

---

## 3. Proposed Architecture: Lite SPA with Vanilla Router

### Design Principles

1. **No heavy framework** — Stay framework-free or use a micro-framework. AIMEAT's strength is simplicity.
2. **One shell, many views** — Single HTML shell with client-side routing. Header, auth, and translations load once.
3. **Progressive enhancement** — Each "page" becomes a JS module loaded on demand.
4. **API-first** — Frontend is a thin client calling `/v1/*` endpoints. No SSR needed.
5. **Backward compatible** — Existing URLs (`/v1/profile`, `/v1/portal`, etc.) continue to work via server-side fallback.

### Architecture Diagram

```
┌─────────────────────────────────────────────────┐
│  index.html (SPA Shell)                         │
│  ┌───────────────────────────────────────────┐  │
│  │  <div id="aimeat-header">                 │  │  ← Persistent header (auth, lang, morsels)
│  │    Brand | Nav Links | Lang | Auth        │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │  <div id="app">                           │  │  ← View container (swapped by router)
│  │    [Current page view loaded here]        │  │
│  └───────────────────────────────────────────┘  │
│                                                  │
│  Loaded once:                                    │
│  • theme.css (shared variables + base styles)   │
│  • i18n.js (translation loader)                 │
│  • router.js (client-side navigation)           │
│  • auth.js (session management)                 │
│  • header.js (persistent header component)      │
└─────────────────────────────────────────────────┘
         │
         │ Dynamic import on route change
         ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ views/       │ │ views/       │ │ views/       │
│ portal.js    │ │ profile.js   │ │ guides.js    │
│ (~300 lines) │ │ (~2000 lines)│ │ (~1500 lines)│
└──────────────┘ └──────────────┘ └──────────────┘
      │                │                │
      └────────────────┴────────────────┘
                       │
              Shared modules:
              • api.js (fetch wrapper)
              • utils.js (escHtml, timeAgo, etc.)
              • components/ (reusable UI pieces)
```

### File Structure

```
public/
├── index.html              # SPA shell (~50 lines)
├── css/
│   └── theme.css           # Shared CSS variables + base styles
├── js/
│   ├── router.js           # Client-side hash/history router
│   ├── i18n.js             # Translation loader (fetches JSON)
│   ├── auth.js             # Auth library (replaces inline aimeat-auth.js)
│   ├── header.js           # Header component (replaces aimeat-header.js)
│   ├── api.js              # API wrapper with session-aware fetch
│   └── utils.js            # Shared utilities (escHtml, timeAgo, formatBytes)
├── views/
│   ├── portal.js           # Landing page view
│   ├── portal-classic.js   # Classic view
│   ├── portal-dev.js       # Developer view (replaces portal.ts SSR)
│   ├── profile.js          # Profile dashboard
│   ├── guides.js           # Guide catalog
│   ├── hobbies.js          # Hobby directory
│   ├── marketplace.js      # Marketplace
│   ├── wizard.js           # Setup wizard
│   ├── openclaw.js         # OpenClaw docs
│   └── aimeat-os.js        # AIMEAT-OS guide
├── locales/
│   ├── en.json             # English translations (single source of truth)
│   └── fi.json             # Finnish translations
└── legacy/
    └── (old HTML files kept temporarily for fallback)
```

### Key Benefits

| Problem | Solution | Impact |
|---------|----------|--------|
| P1: Duplication | Single `theme.css` + single `locales/*.json` | 3,700 lines eliminated |
| P2: Navigation | Client-side router, views swap in `#app` | Instant navigation, no flash |
| P3: Hard refresh | Session restores once in shell; views re-render | No visible auth flicker |
| P4: Monolithic | Each view is a separate module | Encapsulated, independently testable |
| P5: No build | Optional Vite for dev; works without it too | Quick dev feedback loop |
| P6: No types | JSDoc type annotations + tsconfig for checking | Type-safe without compilation |
| P7: i18n | Single JSON per language, loaded once | One edit = all pages updated |

---

## 4. Implementation Plan

### Phase Overview

| Phase | Scope | Effort | Risk |
|-------|-------|--------|------|
| **Phase 1** | Extract shared CSS + unified i18n | 1 day | Low |
| **Phase 2** | SPA shell + router + persistent header | 1-2 days | Medium |
| **Phase 3** | Migrate pages to view modules | 2-3 days | Medium |
| **Phase 4** | Migrate dev portal from SSR → view module | 1 day | Low |
| **Phase 5** | Testing, polish, remove legacy files | 1 day | Low |

**Total estimated effort: 6-8 days**

---

## 5. Phase 1 — Foundation

### 5.1 Extract Shared CSS (`public/css/theme.css`)

Create a single CSS file with:
- `:root` variables (unified — resolve the `#ff69b4` vs `#ff6b9d` inconsistency)
- Base reset (`*{margin:0;padding:0;box-sizing:border-box}`)
- Typography (body font, link colors, heading sizes)
- Background system (hearts, aurora, sparkle — shared across all pages)
- Common components (`.panel`, `.card`, `.btn`, `.stat`, `.mode-notice`, `.mode-badge`)
- Responsive breakpoints

**Expected size:** ~200-300 lines (vs. ~1,200 duplicated today)

### 5.2 Unified i18n (`public/locales/en.json`, `public/locales/fi.json`)

Merge all page-level `TRANSLATIONS` objects into two master JSON files:
- Profile keys under `profile.*`
- Portal keys under `portal.*`, `hero.*`, `cards.*`, `groups.*`
- Guide keys under `guides.*`
- Common keys at top level: `nav.*`, `modal.*`, `classic.*`, `morsels.*`

Create a loader module:

```javascript
// public/js/i18n.js
const I18N = {
  locale: 'en',
  T: {},
  
  async load(locale) {
    this.locale = locale || detectLocale();
    const base = await fetch('/locales/en.json').then(r => r.json());
    this.T = base;
    if (this.locale !== 'en') {
      const overlay = await fetch(`/locales/${this.locale}.json`).then(r => r.json());
      Object.assign(this.T, overlay);
    }
    persist(this.locale);
  },
  
  t(key) {
    return this.T[key] || key;
  },
  
  switch(locale) {
    this.load(locale);
    document.documentElement.lang = locale;
    // Notify listeners (header, current view)
    dispatchEvent(new CustomEvent('lang-change', { detail: { locale } }));
  }
};
```

**Serving:** Add a route to serve `public/locales/*.json` files, or rely on the existing `express.static`.

### 5.3 Shared Utilities (`public/js/utils.js`)

Extract helper functions duplicated across pages:
- `escHtml(str)` — HTML entity escaping
- `escAttr(str)` — Attribute escaping  
- `timeAgo(iso)` — Relative time display
- `formatBytes(b)` — File size formatting
- `copyToClipboard(text)` — Clipboard with fallback
- `detectLocale()` — URL → localStorage → cookie → navigator chain

---

## 6. Phase 2 — SPA Shell + Client Router

### 6.1 SPA Shell (`public/index.html`)

Minimal HTML that loads once and never reloads:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AIMEAT</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/theme.css">
</head>
<body>
  <div id="aimeat-header"></div>
  <div id="app"></div>
  <div id="bg-layers"></div>
  
  <script type="module">
    import { Router } from '/js/router.js';
    import { I18N } from '/js/i18n.js';
    import { Header } from '/js/header.js';
    
    await I18N.load();
    Header.init({ container: '#aimeat-header' });
    Router.start();
  </script>
</body>
</html>
```

### 6.2 Client-Side Router (`public/js/router.js`)

Lightweight history-based router (~80 lines):

```javascript
// public/js/router.js
const routes = {
  '/v1/portal':      () => import('/views/portal.js'),
  '/v1/portal?view=classic': () => import('/views/portal-classic.js'),
  '/v1/portal?view=dev':     () => import('/views/portal-dev.js'),
  '/v1/profile':     () => import('/views/profile.js'),
  '/v1/guides':      () => import('/views/guides.js'),
  '/v1/hobbies':     () => import('/views/hobbies.js'),
  '/v1/marketplace': () => import('/views/marketplace.js'),
  '/v1/aimeat-os':   () => import('/views/aimeat-os.js'),
  '/v1/openclaw':    () => import('/views/openclaw.js'),
};

export const Router = {
  async navigate(path) {
    const loader = matchRoute(path);
    if (!loader) { navigate('/v1/portal'); return; }
    
    const module = await loader();
    const app = document.getElementById('app');
    
    // Unmount previous view
    if (this.currentView?.unmount) this.currentView.unmount();
    
    // Mount new view
    app.innerHTML = '';
    this.currentView = module.default;
    await this.currentView.mount(app);
    
    // Update browser URL
    history.pushState(null, '', path);
    
    // Update active nav link in header
    Header.setActiveRoute(path);
  },
  
  start() {
    // Handle back/forward
    window.addEventListener('popstate', () => this.navigate(location.pathname + location.search));
    
    // Intercept link clicks
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="/v1/"]');
      if (a && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        this.navigate(a.href);
      }
    });
    
    // Initial route
    this.navigate(location.pathname + location.search);
  }
};
```

### 6.3 Session-Aware API Wrapper (`public/js/api.js`)

Replace per-page fetch patterns with a single module:

```javascript
// public/js/api.js
import { Auth } from '/js/auth.js';

export async function api(path, opts = {}) {
  const session = Auth.getSession();
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  
  if (session?.jwt) {
    headers['Authorization'] = 'Bearer ' + session.jwt;
  }
  
  const resp = await fetch(path, { ...opts, headers });
  const data = await resp.json();
  return data; // AIMEAT envelope: { ok, data, error, hints }
}
```

### 6.4 Persistent Header

The header component initializes once in the shell and persists across route changes:
- Auth state displayed immediately (no flicker)
- Morsels balance cached in memory (refreshed periodically)
- Language switcher triggers `lang-change` event → current view re-renders
- Active nav link updates on route change

### 6.5 Server-Side Fallback

Add a catch-all route in `server.ts` for SPA support:

```typescript
// Serve SPA shell for all /v1/* portal routes
app.get(['/v1/portal', '/v1/profile', '/v1/guides', '/v1/hobbies', 
         '/v1/marketplace', '/v1/aimeat-os', '/v1/openclaw'], (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});
```

This ensures:
- Direct URL access works (bookmark, shared link)
- Hard refresh (Ctrl+F5) reloads the shell → router picks up the path → correct view loads
- Search engines and social previews see valid HTML

---

## 7. Phase 3 — Page Modules

### View Module Contract

Each view module exports a default object with `mount` and `unmount`:

```javascript
// views/profile.js
import { api } from '/js/api.js';
import { I18N } from '/js/i18n.js';
import { Auth } from '/js/auth.js';

export default {
  async mount(container) {
    const session = Auth.getSession();
    if (!session) {
      container.innerHTML = this.renderLoginPrompt();
      return;
    }
    
    container.innerHTML = this.renderSkeleton();
    
    // Parallel data fetch
    const [wallet, agents, memory] = await Promise.all([
      api('/v1/wallet'),
      api('/v1/agents'),
      api('/v1/memory?prefix=profile'),
    ]);
    
    this.renderProfile(container, { wallet, agents, memory });
  },
  
  unmount() {
    // Clean up event listeners, intervals, etc.
  },
  
  // Listen for language changes
  onLangChange() {
    // Re-render with new translations (no data re-fetch needed)
  }
};
```

### Migration Order (by complexity)

| Order | Page | Lines Now | Estimated After | Difficulty |
|-------|------|-----------|-----------------|------------|
| 1 | openclaw.html | 500 | ~200 | Easy |
| 2 | hobbies.html | 670 | ~300 | Easy |
| 3 | aimeat-os.html | 1,500 | ~600 | Easy |
| 4 | wizard.html | 800 | ~400 | Easy |
| 5 | marketplace.html | 1,200 | ~500 | Medium |
| 6 | human-classic.html | 2,000 | ~800 | Medium |
| 7 | human.html | 2,500 | ~1,000 | Medium |
| 8 | guides.html | 7,000 | ~3,000 | Hard |
| 9 | profile.html | 9,000 | ~4,000 | Hard |

### Code Reduction Estimate

| Category | Lines Now | Lines After | Saved |
|----------|-----------|-------------|-------|
| i18n (inline TRANSLATIONS) | 2,500 | 0 (in JSON) | 2,500 |
| CSS (inline styles) | 1,200 | ~150 (view-specific) | 1,050 |
| Auth loading/patterns | 500 | 0 (in shell) | 500 |
| Locale detection | 300 | 0 (in i18n.js) | 300 |
| Header markup | 200 | 0 (in header.js) | 200 |
| Background system | 400 | 0 (in shell) | 400 |
| Utility functions | 300 | 0 (in utils.js) | 300 |
| **Total** | **~28,000** | **~14,000** | **~14,000 (50%)** |

---

## 8. Phase 4 — Dev Portal Migration

The dev portal is currently server-side rendered in `portal.ts` (~1,400 lines of SSR HTML/CSS/JS embedded in TypeScript template literals). This is the hardest page to maintain because:

1. Template literals with escaped quotes (`\\'`) are error-prone
2. TypeScript-embedded HTML has no syntax highlighting or linting
3. Changes require server restart
4. Inline JS has no type checking

### Proposal

Extract the dev portal into `views/portal-dev.js`:
- Move all client-side JS to the view module
- Move the platform registry (`PLATFORMS` array) to a JSON file or API endpoint
- Move prompt generation to an API-only endpoint (already exists: `/v1/prompts/*`)
- The `nodeStats` data can be fetched from `/v1/stats` endpoint

The `portal.ts` SSR function (`portalHtml()`) can be removed entirely. The only server-side logic needed is the `buildDevPortalTranslations()` function — but with unified i18n, this moves to `locales/*.json`.

---

## 9. Phase 5 — Testing & Polish

### Frontend Unit Tests

Add Vitest tests for shared modules:
- `i18n.js` — translation loading, fallback, locale detection
- `router.js` — route matching, navigation, back/forward
- `api.js` — session-aware fetch, error handling
- `utils.js` — escaping, formatting

### Playwright Browser Tests

Add E2E tests for key user journeys:
- Login → see morsels in header → navigate to profile → session persists
- Hard refresh (Ctrl+F5) → session restores → morsels visible
- Language switch → all text updates without page reload
- Navigate portal → profile → guides → back → forward

### Removal

After all views are migrated and tested:
- Delete all legacy HTML files from `public/`
- Remove HTML redirect middleware from `server.ts`
- Remove `portalHtml()` SSR function from `portal.ts`
- Remove `aimeat-header.js` (replaced by `js/header.js`)

---

## 10. Framework Options Analysis

### Option A: Vanilla JS with Custom Router (RECOMMENDED)

**What:** Keep vanilla JavaScript. Build a minimal custom router (~80 lines), i18n module (~50 lines), and view system (~40 lines). Use ES modules for code organization.

| Pros | Cons |
|------|------|
| Zero dependencies | More boilerplate for reactivity |
| No build step required | Manual DOM updates |
| Full control | No community ecosystem |
| Consistent with current codebase | No hot module reload |
| Works without Node.js tooling | |

**Best for:** AIMEAT's philosophy of zero-dependency, protocol-first design. If it works in a `<script>` tag, it ships.

### Option B: Preact + HTM (no build step)

**What:** Use Preact (3KB) with HTM (tagged template literals — JSX without a build step).

```javascript
import { h, render } from 'https://esm.sh/preact';
import { useState } from 'https://esm.sh/preact/hooks';
import htm from 'https://esm.sh/htm';
const html = htm.bind(h);

function Profile({ session }) {
  const [wallet, setWallet] = useState(null);
  // ...
  return html`<div class="profile">...</div>`;
}
```

| Pros | Cons |
|------|------|
| Component model (~3KB) | External dependency |
| No build step with HTM | CDN dependency (or self-host) |
| Fast VDOM diffing | Learning curve for team |
| Hooks for state/effects | Debugging stack traces |

**Best for:** Teams that want a component model without a build pipeline.

### Option C: Lit (Web Components)

**What:** Use Lit (5KB) for standards-based web components.

| Pros | Cons |
|------|------|
| Web standards | Larger than Preact |
| Shadow DOM encapsulation | Shadow DOM CSS isolation challenges |
| Works with any framework | More verbose than vanilla |

**Best for:** Long-term interoperability, but overkill for AIMEAT's current scope.

### Option D: Vite + React/Vue/Svelte

**What:** Full framework with build pipeline.

| Pros | Cons |
|------|------|
| Best developer experience | Build step mandatory |
| Hot module reload | 30-100KB framework overhead |
| Rich ecosystem | Breaks "zero dependencies" philosophy |
| TypeScript support | Requires Node.js tooling |

**Best for:** Larger teams, but introduces complexity AIMEAT doesn't need.

### Recommendation

**Option A (Vanilla + Custom Router)** for the initial migration. The codebase is already vanilla JS — adding a framework would require rewriting all 28,000 lines. The custom router and i18n module total ~200 lines and solve the core problems.

If the frontend grows significantly (10+ views, complex state), re-evaluate Option B (Preact + HTM) as a drop-in enhancement.

---

## 11. Migration Strategy

### Guiding Principle: Incremental, Not Big-Bang

Each phase produces a working system. No phase requires the next phase to be complete. At any point, existing HTML files continue to work alongside new view modules.

### Step-by-Step

```
Week 1:
  Day 1: Phase 1 — Extract theme.css + merge i18n JSONs
  Day 2: Phase 1 — Create utils.js, update existing HTML to use shared files
  
Week 2:
  Day 3: Phase 2 — Build SPA shell, router, header integration
  Day 4: Phase 2 — Server-side fallback routes, session persistence
  Day 5: Phase 3 — Migrate easy pages (openclaw, hobbies, aimeat-os, wizard)
  
Week 3:
  Day 6: Phase 3 — Migrate medium pages (marketplace, classic, human)
  Day 7: Phase 3 — Migrate hard pages (guides)
  Day 8: Phase 3 — Migrate hard pages (profile)
  
Week 4:
  Day 9:  Phase 4 — Migrate dev portal from SSR
  Day 10: Phase 5 — Testing, cleanup, remove legacy files
```

### Rollback Strategy

- Keep legacy HTML files in `public/legacy/` during migration
- Add a `?legacy=true` query param to force old pages
- Server-side feature flag: `AIMEAT_SPA_ENABLED=true/false`
- If SPA has issues, revert to serving legacy files immediately

---

## 12. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Router breaks deep links | Medium | High | Server-side fallback serves shell for all /v1/* paths |
| Session flicker on navigation | Low | Medium | Session loaded once in shell, never re-fetched |
| SEO regression | Low | Low | AIMEAT is a protocol tool, not a content site. Add `<meta>` tags if needed |
| Performance regression | Low | Medium | Lazy-load views; measure before/after |
| Browser compatibility | Low | Low | ES modules supported in all modern browsers. No IE11 concern |
| Increased complexity | Medium | Medium | Router + i18n total ~200 lines. Simpler than current 28,000-line duplication |
| Translation key mismatch | Medium | Low | Add CI check that validates all keys in fi.json exist in en.json |

### What This Does NOT Solve

- **Backend complexity** — The backend architecture (Express routes, storage layer) is separate and well-structured
- **Mobile app** — This is a web frontend improvement; Tauri desktop app is separate
- **Offline mode** — Would need service worker work (not in scope here)
- **Real-time updates** — WebSocket integration is separate from navigation architecture

---

## Summary

The AIMEAT frontend's core problem is **duplication, not design**. The API-first architecture is sound. The fix is structural:

1. **Extract shared artifacts** (CSS, i18n, utils) → eliminates ~5,000 duplicate lines
2. **Add a thin SPA shell** → eliminates page-reload flicker and auth re-initialization
3. **Convert pages to view modules** → encapsulated, testable, independently maintainable
4. **Remove SSR dev portal** → everything is client-side, consistent architecture

The result is a **50% code reduction** (28,000 → ~14,000 lines) with faster navigation, stable sessions, consistent headers, and a single place to edit translations, themes, and auth behavior.
