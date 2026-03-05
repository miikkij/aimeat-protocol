# AIMEAT Frontend Analysis & Improvement Proposals

**Date:** 2026-03-05  
**Status:** Draft  
**Scope:** Code quality, architecture, extensibility, security, accessibility  
**Context:** Post-SPA migration analysis (following the original `frontend-architecture-overhaul.md`)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State — Post-Migration Assessment](#2-current-state--post-migration-assessment)
3. [Code Quality Audit](#3-code-quality-audit)
4. [Architecture & Structural Patterns](#4-architecture--structural-patterns)
5. [Extensibility & Developer Experience](#5-extensibility--developer-experience)
6. [Portal Development Documentation](#6-portal-development-documentation)
7. [Security Audit](#7-security-audit)
8. [Accessibility Audit](#8-accessibility-audit)
9. [Performance Analysis](#9-performance-analysis)
10. [Modern Frontend Patterns (2025–2026 Context)](#10-modern-frontend-patterns-20252026-context)
11. [Improvement Proposals](#11-improvement-proposals)
12. [Priority Matrix](#12-priority-matrix)
13. [Appendix — File Inventory](#13-appendix--file-inventory)

---

## 1. Executive Summary

The SPA migration proposed in the original `frontend-architecture-overhaul.md` has been **partially completed**. The frontend now runs as a Preact+HTM single-page application served from `spa.html`, with 9 view modules loaded on demand via client-side routing. Shared CSS, i18n, and utility modules have been extracted. The architecture is substantially improved from the original 28,000-line MPA.

### What Was Achieved

- **SPA shell** (`spa.html`, 273 lines) — Preact v10.25.4 + HTM via importmap, client-side routing, error boundary
- **9 view modules** in `public/views/` — lazy-loaded on route change
- **Shared theme** (`css/theme.css`, 543 lines) — unified CSS custom properties, design tokens, animation library
- **Shared i18n** (`js/i18n.js`, 65 lines) — centralized locale detection and translation loading
- **API wrapper** (`js/api.js`, 38 lines) — session-aware fetch with auth header injection
- **Utility library** (`js/utils.js`, 93 lines) — HTML escaping, formatting, clipboard helpers
- **Realtime library** (`lib/realtime.js`, 472 lines) — WebSocket + WebRTC + Yjs CRDT support
- **Server-side SPA fallback** — all `/v1/*` portal routes serve `spa.html`

### What Remains

- **Legacy HTML files still present** — 9 HTML files (13,923 lines) remain in `public/` alongside view modules
- **Massive inline CSS** — each view embeds 200–320 lines of CSS in JavaScript strings
- **One view still embeds translations** — `portal-classic.js` has a full `TRANSLATIONS` object (en/fi)
- **No CSP headers** — no Content-Security-Policy, no Strict-Transport-Security
- **No frontend tests** — zero unit tests for views, shared modules, or routing
- **No accessibility** — no ARIA attributes, no focus management, no keyboard navigation
- **CDN dependency** — Preact/HTM loaded from `esm.sh` (single point of failure)

### Quantitative Summary

| Metric | Original (Pre-SPA) | Current (Post-SPA) | Change |
|--------|--------------------|--------------------|--------|
| SPA shell lines | 0 | 273 | New |
| View module lines | 0 | 7,537 | New |
| Legacy HTML lines | ~28,000 | 13,923 | -50% |
| Shared CSS | 0 | 543 | New |
| Shared JS modules | 0 | 196 | New |
| Realtime lib | 0 | 472 | New |
| **Active frontend total** | ~28,000 | ~22,944 | -18% |
| CDN dependencies | 0 | 2 (Preact, HTM) | +2 |
| Frontend tests | 0 | 0 | — |
| CSP headers | None | None | — |

---

## 2. Current State — Post-Migration Assessment

### 2.1 File Structure

```
public/
├── spa.html                  # SPA shell (273 lines) — the single entry point
├── css/
│   └── theme.css             # Shared design system (543 lines)
├── js/
│   ├── api.js                # Session-aware fetch wrapper (38 lines)
│   ├── i18n.js               # Translation loader + locale detection (65 lines)
│   └── utils.js              # escHtml, timeAgo, formatBytes (93 lines)
├── lib/
│   └── realtime.js           # WebSocket/WebRTC/Yjs client (472 lines)
├── views/                    # Preact view modules (lazy-loaded)
│   ├── portal.js             # Landing page + Genesis game (1,568 lines)
│   ├── portal-dev.js         # Developer portal + prompts (748 lines)
│   ├── portal-classic.js     # Card-based portal (1,157 lines)
│   ├── profile.js            # 12-tab user dashboard (1,629 lines)
│   ├── hobbies.js            # Hobby directory (707 lines)
│   ├── marketplace.js        # Buy/sell listings (604 lines)
│   ├── aimeat-os.js          # Architecture docs (518 lines)
│   ├── guides.js             # Guide catalog (371 lines)
│   └── openclaw.js           # MCP integration guide (235 lines)
├── locales/                  # Empty ⚠️ — translations not yet extracted
├── img/platforms/            # Platform logos
├── *.html                    # 9 legacy HTML files (13,923 lines total)
└── wizard.html               # First-run setup (1,208 lines)
```

### 2.2 Technology Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| UI Framework | Preact 10.25.4 | 3KB VDOM library, React-compatible API |
| Templating | HTM 3.1.1 | Tagged template literals (`html\`...\``) — JSX without build step |
| Module System | ES Modules + importmap | CDN-hosted via `esm.sh` |
| Routing | Custom (in `spa.html`) | `history.pushState()` + link interception |
| State | Preact hooks | `useState`, `useEffect`, `useRef` per component |
| Styling | CSS custom properties + inline | `theme.css` shared + 200-320 lines per view inline |
| i18n | Custom loader | Flat JSON with dot-notation keys |
| Auth | `aimeat-auth.js` | Dynamically served from `/v1/libs/aimeat-auth.js` |
| Realtime | Custom WebSocket client | Supports WebRTC P2P and Yjs document sync |
| Build Pipeline | None | No bundler, no minification, no source maps |
| PWA | Service Worker + manifest | Caches shell, offline fallback page |

### 2.3 Routing Architecture

All portal routes serve the same `spa.html`:

```
/v1/portal       → spa.html → views/portal.js
/v1/profile      → spa.html → views/profile.js
/v1/guides       → spa.html → views/guides.js
/v1/hobbies      → spa.html → views/hobbies.js
/v1/marketplace  → spa.html → views/marketplace.js
/v1/aimeat-os    → spa.html → views/aimeat-os.js
/v1/openclaw     → spa.html → views/openclaw.js
/v1/classic      → spa.html → views/portal-classic.js
```

Direct access to legacy HTML files (e.g., `/human.html`) returns 301 redirect to canonical `/v1/*` URL. This is a clean pattern.

---

## 3. Code Quality Audit

### 3.1 Strengths

**Consistent view contract.** All view modules export a default Preact component that receives `navigate` and `locale` props. The SPA shell handles mounting/unmounting via `matchRoute()`. This is a clear, repeatable pattern:

```javascript
// Every view follows this shape
export default function ViewName({ navigate, locale }) {
  const [state, setState] = useState(initialState);
  useEffect(() => { /* fetch data, setup */ }, []);
  return html`<div class="view-container">...</div>`;
}
```

**HTML escaping discipline.** `escHtml()` and `escAttr()` from `utils.js` are used consistently across views for user-generated content. This is a critical security practice done well.

**Error boundary.** The SPA shell wraps views in an `ErrorBoundary` component that catches render errors and shows a retry button. Good resilience pattern.

**Parallel data fetching.** Profile.js uses `Promise.allSettled()` for loading multiple API endpoints simultaneously. This prevents one slow/failed endpoint from blocking the entire view.

**Auth integration.** Session state is read from `aimeat-auth.js` once in the shell, passed to views as context. Views don't re-fetch auth — they receive it.

### 3.2 Issues

#### ISSUE-1: Inline CSS in Every View (HIGH)

Every view module embeds 200–320 lines of CSS as a JavaScript string constant (`PORTAL_CSS`, `HOBBIES_CSS`, `DEV_CSS`, etc.), injected into the DOM at mount time via `<style>` tags or `useEffect` + `style.textContent`.

| View | Inline CSS Lines | % of File |
|------|-----------------|-----------|
| portal-classic.js | ~320 | 28% |
| portal-dev.js | ~300 | 40% |
| hobbies.js | ~280 | 40% |
| portal.js | ~250 | 16% |
| marketplace.js | ~215 | 36% |
| **Total embedded** | **~1,365** | — |

**Impact:** CSS duplication across views (shared selectors like `.card`, `.btn`, `.panel`, `.badge` redefined). Style injection causes FOUC on slow connections. Harder to maintain — CSS editing requires JavaScript file edits. No CSS linting or validation on embedded styles.

**Recommendation:** Extract per-view CSS into separate `.css` files in `public/css/views/`. Use `<link>` tags loaded by the router, or adopt CSS `@scope` (shipped in all browsers since late 2024) for view-level encapsulation.

#### ISSUE-2: Legacy HTML Files Still Present (MEDIUM)

9 legacy HTML files totaling 13,923 lines remain in `public/`. They are no longer served directly (301 redirects to `/v1/*`), but they are:

- Dead code occupying repository space
- Confusing for new contributors who don't know which system is active
- A maintenance risk if someone accidentally edits them instead of the view modules

**Recommendation:** Move to `public/_legacy/` or remove entirely. If keeping for rollback, add a `README.md` explaining they're unused.

#### ISSUE-3: One View Still Has Embedded Translations (MEDIUM)

`portal-classic.js` contains a full `TRANSLATIONS` object with English and Finnish keys (~200 lines). All other views use the global `i18n.js` module.

**Recommendation:** Extract to the centralized i18n system. The `public/locales/` directory exists but is empty — populate it with merged translation JSONs from all views.

#### ISSUE-4: Empty Locales Directory (MEDIUM)

`public/locales/` is empty. The `i18n.js` module has code to fetch `/locales/{lang}.json`, but there are no JSON files there. Translation data appears to be served from the backend `locales/` directory at `/locales/*.json` via Express static middleware. The frontend locales directory is misleading.

**Recommendation:** Either populate `public/locales/` with frontend-specific translations, or remove the empty directory and update the path in `i18n.js` to point to the correct backend-served location.

#### ISSUE-5: Inconsistent Error Handling (MEDIUM)

Error handling quality varies significantly across views:

| Pattern | Views Using It | Quality |
|---------|---------------|---------|
| Visual error alerts | hobbies.js, marketplace.js | ✅ Good |
| Silent `.catch(() => {})` | portal.js, portal-dev.js | ⚠️ Poor |
| `Promise.allSettled()` with fallback | profile.js | ✅ Good |
| Try-catch with state reset | portal-classic.js | ✅ Adequate |

**Recommendation:** Create a shared `useApiCall()` hook or wrapper that standardizes error handling — show a toast/banner on failure, log to console, optionally retry.

#### ISSUE-6: Large Monolithic Views (LOW-MEDIUM)

`profile.js` (1,629 lines) contains 12 tabs of functionality in one file. `portal.js` (1,568 lines) includes the Genesis game engine, mega-prompt templates, and the Oneliners board.

**Recommendation:** Split large views into sub-components. Profile could become:

```
views/
  profile/
    index.js           # Tab container + routing
    wallet-tab.js      # Wallet management
    agents-tab.js      # Agent CRUD
    memory-tab.js      # Memory browser
    ...
```

#### ISSUE-7: CDN-loaded Three.js in Portal (LOW)

`portal.js` dynamically loads Three.js from CDN for the Genesis arcade game. This is a 600KB+ library loaded at runtime. If the CDN is down, the game (a non-essential decorative feature) fails and may affect the portal loading experience.

**Recommendation:** Lazy-load Three.js only when the user activates the game, not on portal mount. Add error handling for CDN failure.

### 3.3 Code Metrics Summary

| Metric | Rating | Notes |
|--------|--------|-------|
| **Naming** | ✅ Good | Consistent camelCase, descriptive function names |
| **Module boundaries** | ⚠️ Moderate | Views are isolated, but internal structure is flat |
| **Duplication** | ⚠️ Moderate | CSS heavily duplicated across views; JS logic is well-shared |
| **Error handling** | ⚠️ Mixed | Ranges from excellent to silent swallowing |
| **Type safety** | ❌ None | No JSDoc, no TypeScript, no runtime validation |
| **Testability** | ❌ None | No test infrastructure, no mock boundaries |
| **Documentation** | ⚠️ Sparse | Few inline comments; no JSDoc on public functions |

---

## 4. Architecture & Structural Patterns

### 4.1 What Works Well

**Preact + HTM — Zero Build Pipeline.** The choice of Preact with HTM tagged templates is architecturally sound. It gives React-like component model, hooks, and VDOM diffing without requiring a build step. The importmap-based CDN loading means:

- Contributors can edit any `.js` file and see changes immediately on refresh
- No `npm install` or `node_modules` contamination in the frontend
- No complex webpack/vite/rollup configuration to maintain

This aligns with AIMEAT's "protocol-first, minimal dependencies" philosophy.

**View Module Pattern.** The `matchRoute()` → dynamic `import()` pattern is clean separation of concerns. Each view is an independent Preact component with a standard interface. New views can be added by:

1. Creating a `.js` file in `views/`
2. Adding a route entry in `spa.html`'s `matchRoute()`
3. Adding the server-side fallback route in `portal.ts`

**API-First Architecture.** Views only interact with the backend through `/v1/*` REST endpoints. No server-side rendering (except legacy HTML files). This means any frontend — React, Vue, mobile app, CLI — can consume the same APIs.

**Client Library SDK.** The 7 dynamically-generated libraries at `/v1/libs/` (auth, data, storage, social, wallet, work, tunnel) provide a complete SDK for third-party portal builders. Each is self-contained, zero-dependency, and well-structured.

### 4.2 Structural Concerns

**Flat File Structure.** All 9 views sit in a single `views/` directory with no sub-grouping. As the frontend grows, this will become harder to navigate. The original proposal suggested view-specific subdirectories for large views (e.g., `views/profile/`).

**Missing Component Library.** There are no shared UI components between views. Each view duplicates patterns like:
- Card layouts with expand/collapse
- Loading skeletons
- Error alert banners  
- Form inputs with validation
- Modal dialogs
- Toast notifications
- Copy-to-clipboard buttons

A `public/components/` directory with reusable Preact components would reduce duplication significantly.

**No State Management.** Each view manages its own state independently via `useState`. There's no shared state layer for data that persists across views (e.g., wallet balance, agent list, user preferences). The header reads auth state from `aimeat-auth.js`, but views have no way to share data with each other without re-fetching.

**Router Is Embedded in Shell.** The routing logic is hardcoded in `spa.html`. Adding a new route requires editing the HTML shell file. A standalone `router.js` module would be more maintainable and testable.

### 4.3 Extensibility Assessment

**How easy is it to add a new view?**

| Step | Effort | Friction |
|------|--------|----------|
| 1. Create `views/newview.js` | 5 min | Low — copy an existing view as template |
| 2. Add route in `spa.html` `matchRoute()` | 1 min | Low — add one `case` |
| 3. Add server fallback in `portal.ts` | 2 min | Low — add path to the array |
| 4. Add nav link in header | 2 min | Medium — header logic is in `spa.html` |
| 5. Add translation keys | 5 min | Medium — must know the i18n key convention |
| 6. Add view-specific CSS | 10 min | **High** — must embed CSS as JS string |
| **Total** | ~25 min | Moderate |

The main friction point is CSS — developers must write CSS inside JavaScript template literals with no syntax highlighting, no linting, and no autocomplete. This is the single biggest developer experience issue.

---

## 5. Extensibility & Developer Experience

### 5.1 Developer Onboarding

A new developer joining the project would need to understand:

1. **Preact + HTM** — Using `html\`...\`` template syntax instead of JSX
2. **Importmap CDN** — No `npm install` for frontend, but CDN dependency
3. **View contract** — Export a default function component receiving `{navigate, locale}`
4. **CSS injection** — How to add styles (embed in JS or extend `theme.css`)
5. **i18n** — How `t('key')` works and where translations live
6. **Auth** — How `AIMEAT.auth.getSession()` provides session context

**Missing:** There is no `CONTRIBUTING.md` or `docs/frontend-guide.md` that explains these patterns. A developer would have to read `spa.html` and several view files to understand the conventions.

### 5.2 View Development Template

There's no scaffolding or template for creating a new view. A `views/_template.js` file would accelerate development:

```javascript
// views/_template.js — Copy this file to create a new view
import { html } from 'htm/preact';
import { useState, useEffect } from 'preact/hooks';
import { apiGet } from '/js/api.js';
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';

export default function NewView({ navigate, locale }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet('/v1/your-endpoint')
      .then(r => { if (r.ok) setData(r.data); else setError(r.error); })
      .catch(() => setError('Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return html`<div class="loading">Loading...</div>`;
  if (error) return html`<div class="alert alert-error">${escHtml(error)}</div>`;
  
  return html`
    <style>${VIEW_CSS}</style>
    <div class="view-container">
      <h1>${t('view.title')}</h1>
      <!-- View content here -->
    </div>
  `;
}

const VIEW_CSS = `
  .view-container { max-width: 900px; margin: 0 auto; padding: 2rem; }
`;
```

### 5.3 Third-Party Portal Development

AIMEAT has a documented path for operators to build custom portals:

#### Template System (`/v1/site/template`)
Operators can upload custom HTML with template tags (`{{config:nodeId}}`, `{{memory:key}}`, `{{storage:id}}`). Templates are resolved server-side at serve-time.

#### Client SDK Libraries
7 self-contained JavaScript libraries served from `/v1/libs/`:

| Library | Purpose | Size |
|---------|---------|------|
| `aimeat-auth.js` | Registration, Ed25519 signing, JWT lifecycle, login UI | ~25KB |
| `aimeat-data.js` | Memory & micro-memory read/write + search | ~8KB |
| `aimeat-storage.js` | File upload/download + chunked upload | ~8KB |
| `aimeat-social.js` | Boards, posts, reactions, subscriptions | ~6KB |
| `aimeat-wallet.js` | Balance, transactions, morsel requests | ~6KB |
| `aimeat-work.js` | Action catalogue, work requests, inbox, rating | ~8KB |
| `aimeat-tunnel.js` | WebSocket tunnel, auto-reconnect, mailbox sync | ~10KB |

#### Documentation Status
- ✅ `GET /v1/libs` returns JSON metadata for each library (URL, description, size, include snippet)
- ✅ `docs/node-portal/` — 5 docs covering architecture, API design, implementation roadmap
- ✅ `docs/aimeat-portal-redesign-instructions.md` — Prompt Builder wizard design
- ⚠️ No standalone "Getting Started" guide for building a custom portal from scratch
- ⚠️ No example project showing a minimal custom portal
- ❌ No API reference docs for the SDK libraries (function signatures, parameters, return types)

---

## 6. Portal Development Documentation

### 6.1 What Exists

| Document | Location | Coverage |
|----------|----------|----------|
| Node Portal Architecture | `docs/node-portal/00-overview.md` | High-level template system |
| Architecture Details | `docs/node-portal/01-architecture.md` | Template resolution mechanics |
| API Design | `docs/node-portal/02-api-design.md` | REST endpoints for templates |
| Implementation Roadmap | `docs/node-portal/03-implementation-roadmap.md` | Phased rollout plan |
| Sysadmin Prompt Template | `docs/node-portal/sysadmin-prompt-template.md` | AI-assisted setup prompts |
| Portal Redesign | `docs/aimeat-portal-redesign-instructions.md` | UI redesign plans |
| SDK Library Listing | `GET /v1/libs` | Machine-readable library metadata |

### 6.2 What's Missing

**For AI-agent portal builders:**
- "Build Your First AIMEAT Portal in 10 Minutes" quick-start guide
- Complete SDK API reference with function signatures, parameters, and return types
- Example HTML file showing minimal portal with auth + data display
- Explanation of the `AIMEAT` global namespace and session lifecycle

**For SPA view developers (internal):**
- Contribution guide explaining the Preact + HTM + view module pattern
- CSS conventions (why inline, how to extend `theme.css`)
- i18n key naming conventions
- Error handling standards

### 6.3 Recommendations

Create a `docs/portal-developer-guide.md` containing:

1. **Quick Start** — Minimal HTML page using `aimeat-auth.js` + `aimeat-data.js`
2. **SDK Reference** — Each library's public API with types
3. **Authentication Flow** — Ed25519 challenge/response, session lifecycle, auto-refresh
4. **Styling Guide** — CSS custom properties available from AIMEAT nodes
5. **Deployment** — How to upload a custom portal via `/v1/site/template`
6. **Example Portals** — 3-4 minimal examples (dashboard, notes app, community board)

---

## 7. Security Audit

### 7.1 Critical Issues

#### SEC-1: No Content-Security-Policy Header (CRITICAL)

The server sets no CSP headers. This means:
- Any script from any origin can execute in the context of the AIMEAT page
- Inline `eval()` and `new Function()` are unrestricted
- If any XSS vulnerability exists, it's fully exploitable with no browser-level defense

**Current state in `server.ts`:**
```typescript
// CORS headers present:
res.setHeader('Access-Control-Allow-Origin', '*');
// But NO CSP, no HSTS, no X-Content-Type-Options
```

**Recommended CSP (compatible with current architecture):**
```
Content-Security-Policy: 
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://esm.sh;
  style-src 'self' 'unsafe-inline';
  connect-src 'self' wss: ws:;
  img-src 'self' data: blob:;
  font-src 'self';
  frame-src 'none';
  object-src 'none';
  base-uri 'self';
```

Note: `'unsafe-inline'` is required because all views inject CSS via `<style>` tags and HTM uses inline script modules. A future goal should be eliminating `'unsafe-inline'` by moving to external CSS files and using nonce-based CSP for scripts.

#### SEC-2: Wildcard CORS (`Access-Control-Allow-Origin: *`) (HIGH)

The server allows any origin to make API requests. While AIMEAT is designed as an open protocol, state-changing endpoints (POST, PUT, DELETE) with `*` CORS mean:
- Any website can make authenticated requests if the user has an active session
- Combined with JWT in localStorage, this creates a session-riding risk

**Recommendation:** For state-changing methods, restrict CORS to the node's own origin or configured allowed origins. Read-only GET endpoints can remain open.

#### SEC-3: JWT Storage in localStorage (HIGH)

`aimeat-auth.js` stores the full JWT (and private key) in `localStorage`. This is the widely-recognized weaker option for JWT storage:

- **XSS Impact:** Any successful XSS attack can read `localStorage` and steal both the JWT and the Ed25519 private key
- **No automatic expiry:** localStorage persists indefinitely (vs. session storage which clears on tab close)
- **Cross-tab exposure:** All tabs on the same origin share `localStorage`

**Current storage pattern:**
```javascript
localStorage.setItem('aimeat_session', JSON.stringify({
  owner, gaii, ghii, jwt, privateKey, publicKey
}));
```

**Industry best practice (2025–2026):**
- Store **access tokens in memory** (JavaScript variable, React context, or Preact signal)
- Store **refresh tokens in `HttpOnly`, `Secure`, `SameSite=Strict` cookies**
- On page load, use the refresh cookie to obtain a new access token from the server
- Private keys should use the Web Crypto API's `CryptoKey` objects which are non-extractable

**Pragmatic recommendation for AIMEAT:** Since AIMEAT uses Ed25519 challenge/response (not traditional refresh tokens), consider:
1. Keep the public key in `localStorage` (not sensitive)
2. Store the private key in `IndexedDB` with `CryptoKey` non-extractable flag
3. Keep the JWT in a module-scoped variable (memory only)
4. On page reload, automatically re-authenticate using the stored private key (sign a fresh challenge)

#### SEC-4: Potential XSS via `dangerouslySetInnerHTML` (MEDIUM)

`profile.js` uses `dangerouslySetInnerHTML` to render platform content. If `PLATFORMS` data originates from user input or an API response, this is an XSS vector.

Additionally, `portal-dev.js` uses `dangerouslySetInnerHTML` for i18n strings — while translation keys are typically safe, if a translation value is compromised (e.g., via a supply-chain attack on locale files), this becomes exploitable.

**Recommendation:** Audit all `dangerouslySetInnerHTML` usage. Replace with Preact's normal HTML escaping where possible. If raw HTML is needed (e.g., for rich text), sanitize with DOMPurify or a similar library before injection.

#### SEC-5: CDN Supply-Chain Risk (MEDIUM)

Preact and HTM are loaded from `esm.sh` (a third-party CDN). If `esm.sh` is compromised, malicious code runs in every AIMEAT node's portal with full access to user sessions and private keys.

**Recommendations:**
1. **Subresource Integrity (SRI):** Add `integrity` attributes to pinned versions. Note: importmaps don't support SRI natively yet (as of 2026), but script tags with SRI can be used as a fallback for critical libraries.
2. **Self-host:** Bundle Preact and HTM locally in `public/lib/`. They total ~10KB combined — trivial to self-host. This also eliminates the CDN as a single point of failure for offline/air-gapped nodes.
3. **Vendor lockfile:** If continuing with CDN, pin exact versions and document the expected hashes.

### 7.2 Moderate Issues

#### SEC-6: No Rate Limiting on Client-Side Auth (LOW-MEDIUM)

While the server has rate limiting middleware, the client-side `aimeat-auth.js` will retry authentication indefinitely on network errors. A compromised or buggy client could flood the auth endpoints.

#### SEC-7: No Input Sanitization on Rich Text Fields (LOW-MEDIUM)

Board posts (`aimeat-social.js`), memory values, and marketplace descriptions accept arbitrary text. While `escHtml()` is used on display, any path where raw HTML is rendered (e.g., markdown previews) must sanitize input.

#### SEC-8: `Access-Control-Allow-Origin: *` Exposes Wallet Operations (MEDIUM)

Morsel (cryptocurrency-like) transfers via wallet endpoints are state-changing operations accessible from any origin. A malicious page could craft requests to transfer a user's morsels if the JWT is accessible.

### 7.3 Security Recommendations Priority

| # | Issue | Severity | Effort | Recommendation |
|---|-------|----------|--------|----------------|
| 1 | No CSP headers | Critical | 1 hour | Add CSP middleware in `server.ts` |
| 2 | Wildcard CORS | High | 2 hours | Restrict state-changing endpoints to known origins |
| 3 | JWT/key in localStorage | High | 1 day | Move JWT to memory, private key to IndexedDB CryptoKey |
| 4 | `dangerouslySetInnerHTML` | Medium | 2 hours | Audit and replace with safe rendering |
| 5 | CDN supply chain | Medium | 1 hour | Self-host Preact + HTM (10KB total) |
| 6 | Auth retry flooding | Low | 30 min | Add exponential backoff in client auth lib |

---

## 8. Accessibility Audit

### 8.1 Current State: No Accessibility

The AIMEAT frontend has **zero accessibility implementation**. This is a significant gap, especially given the European Accessibility Act (EAA) which requires WCAG 2.1 AA compliance for commercial digital services since June 2025.

### 8.2 Missing Accessibility Features

#### Navigation & Focus Management
- **No skip-to-content link** — keyboard users must Tab through the entire header on every page
- **No focus management on route change** — when navigating between views, focus stays on the clicked link instead of moving to the new content area. Screen reader users hear nothing when a view changes
- **No ARIA live region** — dynamic content updates (API data load, form submit) are invisible to screen readers
- **Tab order is undefined** — interactive elements don't have explicit `tabindex` management

#### Semantic HTML
- **Non-semantic containers** — views use `<div>` for everything. No `<main>`, `<nav>`, `<section>`, `<article>`, `<aside>` landmarks
- **No headings hierarchy** — heading levels are not structured (`<h1>` → `<h2>` → `<h3>`), making screen reader navigation inefficient
- **Buttons vs links** — some clickable `<div>` elements should be `<button>` or `<a>`

#### Forms
- **No form labels** — input fields in profile, marketplace, and hobbies views lack `<label>` elements or `aria-label` attributes
- **No error announcements** — form validation errors are shown visually but not announced to screen readers (no `role="alert"` or `aria-live`)
- **No focus-on-error** — when form submission fails, focus doesn't move to the first error field

#### Visual
- **Color-only indicators** — error states use red color alone, without icons or text labels. Fails WCAG 1.4.1 (Use of Color)
- **Low contrast concerns** — dark theme with light gray text on dark background may not meet 4.5:1 contrast ratio for some text sizes
- **Animations not reducible** — CSS animations (heartPulse, twinkle, aurora) cannot be disabled. Users with `prefers-reduced-motion` are not accommodated

### 8.3 WCAG 2.2 AA Compliance Checklist

| Criterion | Status | Notes |
|-----------|--------|-------|
| 1.1.1 Non-text Content | ❌ | Platform logos lack alt text |
| 1.3.1 Info and Relationships | ❌ | No semantic HTML landmarks |
| 1.4.1 Use of Color | ❌ | Error/success states rely on color alone |
| 1.4.3 Contrast (Minimum) | ⚠️ | Not audited — dark theme may fail |
| 2.1.1 Keyboard | ❌ | No keyboard navigation support |
| 2.4.1 Bypass Blocks | ❌ | No skip navigation link |
| 2.4.3 Focus Order | ❌ | No focus management |
| 2.4.7 Focus Visible | ⚠️ | Browser default may suffice, but custom styles override |
| 3.3.1 Error Identification | ❌ | Errors not programmatically associated with inputs |
| 3.3.2 Labels or Instructions | ❌ | Form inputs lack labels |
| 4.1.2 Name, Role, Value | ❌ | Custom interactive elements lack ARIA |

### 8.4 Recommendations

1. **Immediate (1 day):** Add `<main>`, `<nav>`, `<section>` landmarks. Add skip-to-content link. Add `prefers-reduced-motion` media query.
2. **Short-term (2-3 days):** Add focus management on route change. Add `aria-live` region for dynamic content. Add form labels.
3. **Medium-term (1 week):** Full WCAG 2.2 AA audit with automated tools (axe-core, Lighthouse). Fix all findings.

---

## 9. Performance Analysis

### 9.1 Current Load Performance

**Initial page load:**
1. Download `spa.html` (273 lines) — fast
2. Parse importmap and fetch Preact + HTM from `esm.sh` CDN — **network-dependent** (first visit ~200ms, cached ~0ms)
3. Load `theme.css` (543 lines) — fast
4. Load `aimeat-auth.js` from `/v1/libs/` (dynamically generated ~25KB) — moderate
5. Load `i18n.js` + `utils.js` (158 lines total) — fast
6. Match route and dynamically `import()` view module (235–1,629 lines) — moderate
7. View mounts and fetches API data — **network-dependent**

**Navigation between views:**
- Client-side only — no network requests for HTML/CSS/JS (already cached)
- Only API data fetches for the new view
- Smooth, instant-feeling transitions

### 9.2 Performance Issues

| Issue | Impact | Fix |
|-------|--------|-----|
| **No minification** — all JS/CSS served raw | 15-30% larger than needed | Add optional build step or use server-side compression |
| **No gzip/brotli** — Express static serves uncompressed | 60-80% savings available | Add `compression` middleware or reverse proxy |
| **CDN waterfall** — Preact from CDN must load before any view can render | 100-300ms on cold cache | Self-host Preact+HTM |
| **CSS injected at mount** — 200-320 lines parsed on every route change | Minor (sub-ms), but causes FOUC | External CSS files cached by browser |
| **Three.js loaded at portal mount** — 600KB+ for a decorative game | Significant on slow connections | Lazy-load on game activation only |
| **No code splitting** — entire view loaded even if user only sees one tab | Matters for profile.js (1,629 lines, 12 tabs) | Split into tab-level chunks |

### 9.3 Recommendations

1. **Enable gzip/brotli compression** — Add `compression` middleware in Express. Single line of code, 60%+ savings.
2. **Self-host Preact+HTM** — Copy to `public/lib/`. Eliminates CDN latency and dependency.
3. **Lazy-load Three.js** — Only import when user clicks "Play Genesis" button.
4. **Add static asset fingerprinting** — Append content hash to CSS/JS filenames for reliable cache busting.

---

## 10. Modern Frontend Patterns (2025–2026 Context)

### 10.1 Relevant Industry Trends

**ESM + Import Maps Are Production-Ready.** All major browsers (Chrome, Firefox, Safari, Edge) support `<script type="importmap">` and dynamic `import()`. AIMEAT's choice to use this instead of a bundler is aligned with the 2025-2026 trend of reducing build tooling complexity. The importmap spec is now W3C standard.

**CSS-in-JS Is Declining.** The React ecosystem has largely moved away from runtime CSS-in-JS (styled-components, emotion) toward zero-runtime solutions: CSS Modules, Tailwind CSS, or vanilla CSS with `@scope`/`@layer`. AIMEAT's embedded CSS strings represent a runtime injection pattern that is now considered outdated.

**CSS `@scope` (2024+).** All browsers now support `@scope` which allows view-local CSS without Shadow DOM or CSS-in-JS:

```css
@scope (.hobbies-view) {
  .card { /* only applies inside .hobbies-view */ }
  .btn { /* scoped to this view */ }
}
```

This directly addresses AIMEAT's inline CSS problem. Each view can have a `.css` file with `@scope` rules, loaded as an external stylesheet.

**Constructable Stylesheets.** The `CSSStyleSheet()` constructor + `document.adoptedStyleSheets` is the modern way to programmatically add styles without creating `<style>` elements. Supported in all browsers since 2023. More performant and cleaner than AIMEAT's current `style.textContent` injection.

**Signals for State.** Preact 10.x supports `@preact/signals` (1.2KB) for reactive state management. This is lighter than hooks for cross-component communication and would solve the "no shared state layer" problem without adding a heavy state management library.

**View Transitions API.** Chrome and Safari support the View Transitions API for smooth animations between SPA route changes. This is the modern replacement for manual opacity/transform transitions.

### 10.2 Alignment Assessment

| Modern Pattern | AIMEAT Status | Recommendation |
|----------------|---------------|----------------|
| ESM + importmap | ✅ Using | Keep — well-aligned |
| Zero-runtime CSS | ❌ Using JS string injection | Migrate to external CSS with `@scope` |
| TypeScript or JSDoc | ❌ No type safety | Add JSDoc type annotations at minimum |
| Component composition | ⚠️ Flat monolithic views | Split large views into sub-components |
| Reactive state (Signals) | ❌ Not using | Consider for cross-view state sharing |
| Service Worker | ✅ Using | Expand caching strategy for view modules |
| CSP + security headers | ❌ Missing | Implement immediately |
| Accessibility | ❌ Missing | Implement core patterns |
| View Transitions API | ❌ Not using | Nice-to-have enhancement |

---

## 11. Improvement Proposals

### Proposal 1: Extract Inline CSS to External Files with `@scope`

**Problem:** ~1,365 lines of CSS embedded in JavaScript across 5 view modules.

**Solution:** Create per-view CSS files using CSS `@scope`:

```
public/css/
├── theme.css              # Existing — global design system
├── views/
│   ├── portal.css         # Scoped: @scope (.portal-view) { ... }
│   ├── portal-dev.css
│   ├── portal-classic.css
│   ├── hobbies.css
│   └── marketplace.css
```

Views would add a `<link>` tag or use `adoptedStyleSheets`:

```javascript
// Option A: Link tag (simpler)
useEffect(() => {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/views/hobbies.css';
  document.head.appendChild(link);
  return () => link.remove();
}, []);

// Option B: Constructable Stylesheets (more performant)
const sheet = new CSSStyleSheet();
sheet.replaceSync(await fetch('/css/views/hobbies.css').then(r => r.text()));
document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
```

**Impact:** ~1,365 lines of JS → CSS. Enables CSS linting, syntax highlighting, and browser DevTools CSS editing. Reduces view module sizes by 30-40%.

### Proposal 2: Shared Component Library

**Problem:** Repeated UI patterns across views with no shared components.

**Solution:** Create `public/components/` with reusable Preact components:

```
public/components/
├── alert.js          # Error/success/info banners with ARIA role="alert"
├── card.js           # Expandable card with consistent styling
├── loading.js        # Skeleton/spinner states
├── modal.js          # Accessible modal dialog (focus trap, Escape key)
├── copy-button.js    # Copy-to-clipboard with confirmation
├── toast.js          # Non-blocking notification system
├── form-field.js     # Input with label + error + aria attributes
└── data-table.js     # Sortable/filterable table
```

Each component would follow the pattern:

```javascript
// components/alert.js
import { html } from 'htm/preact';

export function Alert({ type = 'info', message, onDismiss }) {
  return html`
    <div class="alert alert-${type}" role="alert" aria-live="polite">
      <span>${message}</span>
      ${onDismiss && html`<button onclick=${onDismiss} aria-label="Dismiss">×</button>`}
    </div>
  `;
}
```

**Impact:** Reduces duplication. Enforces accessibility patterns. Makes views shorter and more focused on business logic.

### Proposal 3: Self-Host CDN Dependencies

**Problem:** Preact and HTM loaded from `esm.sh` — single point of failure, supply-chain risk.

**Solution:**

```bash
# Download pinned versions
curl -o public/lib/preact.mjs "https://esm.sh/preact@10.25.4"
curl -o public/lib/preact-hooks.mjs "https://esm.sh/preact@10.25.4/hooks"
curl -o public/lib/htm.mjs "https://esm.sh/htm@3.1.1"
```

Update `spa.html` importmap:
```json
{
  "imports": {
    "preact": "/lib/preact.mjs",
    "preact/": "/lib/preact/",
    "htm": "/lib/htm.mjs"
  }
}
```

**Impact:** Eliminates CDN dependency. Works offline/air-gapped. Removes supply-chain attack vector. Total added size: ~10KB.

### Proposal 4: Security Headers Middleware

**Problem:** No CSP, HSTS, or other security headers.

**Solution:** Add security middleware in `server.ts`:

```typescript
app.use((req, res, next) => {
  // Content Security Policy
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",  // Required for HTM templates
    "style-src 'self' 'unsafe-inline'",   // Required for inline CSS injection
    "connect-src 'self' wss: ws:",        // WebSocket for realtime
    "img-src 'self' data: blob:",         // Data URIs for inline images
    "font-src 'self'",
    "frame-src 'none'",                   // No iframes
    "object-src 'none'",                  // No plugins
    "base-uri 'self'",                    // Prevent base tag injection
  ].join('; '));

  // Other security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // HSTS (only for production with HTTPS)
  if (req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }
  
  next();
});
```

**Impact:** Immediate defense-in-depth. Mitigates XSS exploitation even if a vulnerability exists. Prevents clickjacking via `X-Frame-Options`.

### Proposal 5: Frontend Contribution Guide

**Problem:** No documentation for frontend development patterns and conventions.

**Solution:** Create `docs/frontend-development-guide.md`:

1. **Architecture Overview** — SPA shell, view modules, shared libraries
2. **Creating a New View** — Step-by-step with template
3. **CSS Conventions** — `theme.css` variables, view-scoped styles
4. **i18n Guide** — Translation key naming, adding languages
5. **Auth Integration** — Using `aimeat-auth.js` session in views
6. **API Patterns** — Using `api.js`, error handling, loading states
7. **Component Standards** — Accessibility requirements, naming, testing
8. **Security Checklist** — Escaping user content, avoiding `dangerouslySetInnerHTML`

### Proposal 6: Remove or Archive Legacy HTML Files

**Problem:** 13,923 lines of dead code in `public/`.

**Solution:**
- Move all legacy `.html` files to `public/_legacy/` or delete them
- Add `_legacy/README.md` explaining why they're preserved (if kept)
- Update `.gitignore` to exclude them (if deleted)

### Proposal 7: Populate i18n JSON Files

**Problem:** `public/locales/` is empty. `portal-classic.js` has embedded translations.

**Solution:**
- Extract all translation keys from view modules into `locales/en.json` and `locales/fi.json`
- Move `portal-classic.js` inline translations to the shared files
- Verify the i18n loading path works end-to-end

### Proposal 8: Add Core Accessibility

**Problem:** Zero accessibility implementation.

**Solution (minimum viable):**
1. Add `<main id="main-content">` wrapper around `#app` in shell
2. Add skip-to-content link in header
3. Add `prefers-reduced-motion` media query to `theme.css`
4. Add `role="alert"` to error messages in views
5. Add focus management on route change (focus `#main-content` after navigation)
6. Add `<label>` elements to all form inputs
7. Use semantic HTML landmarks in view templates

### Proposal 9: Optional Build Pipeline

**Problem:** No minification, no source maps, no cache busting.

**Solution:** Add an **optional** Vite config (not mandatory for development):

```bash
# Development: no build needed — edit files, refresh browser
# Production: optional build for minification + fingerprinting
npx vite build --config vite.frontend.config.js
```

This preserves the zero-build dev experience while enabling production optimizations. Output goes to `dist/public/` and is served from there in production.

---

## 12. Priority Matrix

### Must-Do (Security & Compliance)

| # | Proposal | Effort | Impact |
|---|----------|--------|--------|
| 4 | Security headers (CSP, HSTS, X-Frame-Options) | 1 hour | Blocks entire class of attacks |
| 3 | Self-host Preact+HTM | 30 min | Eliminates supply-chain risk + offline support |
| SEC-3 | Move JWT from localStorage to memory | 1 day | Prevents session theft via XSS |
| SEC-2 | Restrict CORS for state-changing endpoints | 2 hours | Prevents cross-origin session-riding |

### Should-Do (Code Quality & DX)

| # | Proposal | Effort | Impact |
|---|----------|--------|--------|
| 1 | Extract inline CSS to external files | 1-2 days | Reduces view sizes 30-40%, enables CSS tooling |
| 5 | Frontend contribution guide | 3 hours | Accelerates onboarding |
| 6 | Remove/archive legacy HTML | 30 min | Reduces confusion |
| 7 | Populate i18n JSON files | 2 hours | Centralizes translations |
| 2 | Shared component library | 2-3 days | Reduces duplication, enforces standards |

### Nice-to-Have (Polish & Future)

| # | Proposal | Effort | Impact |
|---|----------|--------|--------|
| 8 | Core accessibility | 2-3 days | WCAG compliance, wider user reach |
| 9 | Optional build pipeline | 1 day | Minification, fingerprinting, source maps |
| — | Preact Signals for shared state | 1 day | Cross-view state sharing |
| — | View Transitions API | 2 hours | Smoother route animations |
| — | Frontend unit tests (Vitest) | 2-3 days | Regression prevention |

---

## 13. Appendix — File Inventory

### View Modules (Active — SPA)

| File | Lines | Inline CSS Lines | Purpose |
|------|-------|-----------------|---------|
| portal.js | 1,568 | ~250 | Landing page + Genesis game + mega-prompts |
| profile.js | 1,629 | minimal | 12-tab user dashboard |
| portal-classic.js | 1,157 | ~320 | Card-based portal with embedded i18n |
| portal-dev.js | 748 | ~300 | Developer portal + prompt wizard |
| hobbies.js | 707 | ~280 | Hobby directory + matching |
| marketplace.js | 604 | ~215 | Buy/sell listings + morsel economy |
| aimeat-os.js | 518 | minimal | Architecture documentation |
| guides.js | 371 | minimal | Guide catalog |
| openclaw.js | 235 | minimal | MCP integration reference |
| **Total** | **7,537** | **~1,365** | |

### Shared Modules

| File | Lines | Purpose |
|------|-------|---------|
| spa.html | 273 | SPA shell + router + error boundary |
| css/theme.css | 543 | Design system + variables + animations |
| js/utils.js | 93 | HTML escaping, formatting, clipboard |
| js/i18n.js | 65 | Translation loader + locale detection |
| js/api.js | 38 | Session-aware fetch wrapper |
| lib/realtime.js | 472 | WebSocket + WebRTC + Yjs client |
| **Total** | **1,484** | |

### Legacy Files (Inactive — 301 Redirects)

| File | Lines | Status |
|------|-------|--------|
| human.html | 2,583 | Superseded by views/portal.js |
| profile.html | 2,971 | Superseded by views/profile.js |
| human-classic.html | 1,889 | Superseded by views/portal-classic.js |
| hobbies.html | 1,630 | Superseded by views/hobbies.js |
| wizard.html | 1,208 | Active? (may still be used for first-run) |
| marketplace.html | 1,116 | Superseded by views/marketplace.js |
| guides.html | 996 | Superseded by views/guides.js |
| aimeat-os.html | 842 | Superseded by views/aimeat-os.js |
| openclaw.html | 415 | Superseded by views/openclaw.js |
| **Total** | **13,650** | |

### Server-Generated Libraries (at `/v1/libs/`)

| Library | Size Estimate | Purpose |
|---------|--------------|---------|
| aimeat-auth.js | ~25KB | Registration, Ed25519, JWT, login UI |
| aimeat-data.js | ~8KB | Memory & micro-memory CRUD |
| aimeat-storage.js | ~8KB | File upload/download |
| aimeat-social.js | ~6KB | Boards, posts, reactions |
| aimeat-wallet.js | ~6KB | Morsel balance, transactions |
| aimeat-work.js | ~8KB | Action catalogue, work queue |
| aimeat-tunnel.js | ~10KB | WebSocket tunnel, mailbox sync |

### Grand Total

| Category | Lines |
|----------|-------|
| Active SPA frontend | 9,021 |
| Inactive legacy HTML | 13,650 |
| Realtime library | 472 |
| **Total in repository** | **23,143** |
| **Effective (active only)** | **9,493** |
