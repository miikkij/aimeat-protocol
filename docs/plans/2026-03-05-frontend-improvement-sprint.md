# Frontend Improvement Sprint Plan

**Date:** 2026-03-05  
**Status:** Active  
**Scope:** Inline CSS extraction, shared components, deduplication, E2E tests, security hardening, developer docs

---

## Background

The SPA migration is complete (9 Preact views, importmap-based ESM). Recent work added CSP headers, self-hosted Preact/HTM, and removed 8 legacy HTML files. This sprint addresses the remaining technical debt identified in the frontend analysis.

## Current State

| Metric | Value |
|--------|-------|
| Total view code | 8,262 lines across 9 views |
| Inline CSS | ~1,716 lines (CSS constants + style blocks + style="" attrs) |
| Duplicated patterns | 5 (alert, spinner, card, form, copyToClipboard) |
| Shared components | 0 (no `public/components/` exists) |
| Frontend E2E tests | 0 (only SDK lib tests exist) |
| i18n compliance | 8/9 views use shared i18n; portal-classic.js embeds 218 lines of translations |

---

## Phase 1: Shared Component Library (`public/components/`)

**Goal:** Create reusable Preact components to eliminate duplication across views.

### 1.1 Alert Component — `components/Alert.js`

Replace 3 independent implementations (hobbies.js L114-116, marketplace.js L609-612, profile.js L177-180).

```javascript
// Usage: <${Alert} type="error" message="Something failed" onDismiss=${() => setError(null)} />
// Types: success, error, info, warn
```

CSS goes into `theme.css` as `.alert`, `.alert-success`, `.alert-error`, `.alert-info`, `.alert-warn`.

### 1.2 Toast Component — `components/Toast.js`

Extract from profile.js L371-398. Fixed-position auto-dismiss notification.

```javascript
// Usage: const { showToast, ToastContainer } = useToast();
//        showToast('Saved!', 'success');
//        <${ToastContainer} />
```

### 1.3 Spinner Component — `components/Spinner.js`

Extract from profile.js L337-339. Remove duplicate `.pf .spinner` CSS (profile.js L126-128), use theme.css `.spinner` (L575-583).

```javascript
// Usage: <${Spinner} text=${t('loading')} />
```

### 1.4 Modal Component — `components/Modal.js`

Extract from profile.js L174-176, L1544-1558. Overlay + content + close button.

```javascript
// Usage: <${Modal} open=${showEdit} onClose=${() => setShowEdit(false)} title="Edit">
//          ...content...
//        </${Modal}>
```

### 1.5 CopyButton Component — `components/CopyButton.js`

Wraps `copyToClipboard()` from utils.js with visual feedback.

```javascript
// Usage: <${CopyButton} text=${gaii} label="Copy GAII" />
```

### 1.6 FormField Component — `components/FormField.js`

Replace 3 parallel form systems (hobbies.js L94+, marketplace.js L625-640, profile.js L140-142).

```javascript
// Usage: <${FormField} label="Name" hint="Your display name">
//          <input class="input-field" value=${name} onInput=${e => setName(e.target.value)} />
//        </${FormField}>
```

### 1.7 Card Component — `components/Card.js`

Replace 4 card systems (hobbies.js L78-82, marketplace.js, openclaw.js L30-35, profile.js L35-39).

```javascript
// Usage: <${Card} title="Agent" subtitle="gaii:abc" onClick=${expand} hoverable>
//          ...content...
//        </${Card}>
```

### Files created:
- `public/components/Alert.js`
- `public/components/Toast.js`
- `public/components/Spinner.js`
- `public/components/Modal.js`
- `public/components/CopyButton.js`
- `public/components/FormField.js`
- `public/components/Card.js`
- `public/components/index.js` (barrel export)

---

## Phase 2: Inline CSS Extraction

**Goal:** Move all CSS from JS files into external CSS files using `@scope` for view-local styles.

### 2.1 Add shared component CSS to `theme.css`

Add base styles for `.alert`, `.toast`, `.modal-overlay`, `.modal`, `.form-group`, `.form-label` to the existing theme.css design system.

### 2.2 Create per-view CSS files with `@scope`

| View | CSS source | New file |
|------|-----------|----------|
| portal.js | `PORTAL_CSS` constant (407 lines) | `public/css/views/portal.css` |
| profile.js | `PROFILE_CSS` constant (195 lines) | `public/css/views/profile.css` |
| portal-classic.js | `CLASSIC_CSS` constant (485 lines) | `public/css/views/portal-classic.css` |
| portal-dev.js | `DEV_CSS` constant (140 lines) | `public/css/views/portal-dev.css` |
| hobbies.js | `HOBBIES_CSS` (74 lines) + inline | `public/css/views/hobbies.css` |
| marketplace.js | `<style>` block (123 lines) + inline | `public/css/views/marketplace.css` |
| openclaw.js | `<style>` block (34 lines) | `public/css/views/openclaw.css` |
| aimeat-os.js | `<style>` block (32 lines) | `public/css/views/aimeat-os.css` |
| guides.js | `<style>` block (8 lines) | `public/css/views/guides.css` |

### 2.3 CSS loading strategy

Each view loads its CSS on mount using a `useEffect` that creates a `<link>` tag:

```javascript
useEffect(() => {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/views/portal.css';
  document.head.appendChild(link);
  return () => link.remove();
}, []);
```

### 2.4 Reduce `style=""` attributes

Convert remaining inline `style=""` attributes (218 across views) to CSS classes in the view CSS files. Priority targets:
- profile.js: 78 inline styles
- hobbies.js: 59 inline styles
- portal-dev.js: 39 inline styles
- marketplace.js: 34 inline styles

---

## Phase 3: Deduplication Cleanup

### 3.1 Remove duplicate `copyToClipboard`

Files with local copies to remove:
- portal.js L45-57 (copyToClipboard + fallbackCopy)
- portal-classic.js L255-268
- portal-dev.js L34-49

Replace with: `import { copyToClipboard } from '/js/utils.js';`

### 3.2 Remove duplicate spinner CSS

- Remove `.pf .spinner` from profile.js PROFILE_CSS (L126-128) — use theme.css `.spinner` instead
- Update profile.js `Spinner()` component to use the global class

---

## Phase 4: i18n Extraction (portal-classic.js)

### 4.1 Move embedded translations

portal-classic.js lines 16-233 contain a 218-line `TRANSLATIONS` object with `en` and `fi` blocks (~115 keys each).

**Action:**
1. Merge keys into `locales/en.json` and `locales/fi.json` under a `"classic"` section
2. Replace inline `t()` function with import from `/js/i18n.js`
3. Remove the `TRANSLATIONS` constant

---

## Phase 5: E2E Tests for Frontend Views

**Goal:** Playwright tests that verify actual view behavior, not just HTTP responses.

### 5.1 Test infrastructure

Create `test/playwright/views.spec.ts` with tests for SPA routing and view rendering.

### 5.2 Test cases

| Test | What it verifies |
|------|-----------------|
| SPA routing | Navigate to each `/v1/*` route, verify correct view loads |
| Portal landing | Title renders, navigation links present, Genesis game trigger visible |
| Profile (unauthenticated) | Shows login prompt, no tabs |
| Profile (authenticated) | Shows avatar, tabs, stat cards; tab switching works |
| Hobbies | Category list loads, search works, create form appears for authenticated users |
| Marketplace | Listing loads, search filters, create form for authenticated users |
| Dev Portal | SDK docs render, library links present, code samples visible |
| Guides | AI platform guides render, accordion expand/collapse |
| OpenClaw | Agent creation form, agent list loads |
| AIMEAT OS | Runtime info renders, copy buttons work |
| Portal Classic | Legacy portal renders, language switching works |
| Header nav | Login/logout state, morsels badge, active link highlighting |
| CSP headers | Verify CSP header present and correct on all responses |

### 5.3 Test approach

Tests will use Playwright's page object model:
- Start server on test port (40251)
- Real browser navigation (no mocked DOM)
- Test authenticated and unauthenticated states
- Verify interactive elements (tab switching, accordion, search, navigation)

---

## Phase 6: Security Hardening

### 6.1 Client-side auth retry limiting

In `public/js/api.js`, add max-retry logic to prevent infinite auth retry loops on network errors. Cap at 3 retries with exponential backoff.

### 6.2 Input sanitization for rich text

Add `sanitizeHtml()` to `utils.js` using a whitelist approach (strip all tags except safe ones like `<b>`, `<i>`, `<a>`, `<code>`). Apply in board posts and memory value displays.

### 6.3 Three.js self-host fallback

Download `three.min.js` r128 to `public/lib/three.min.js`. Update portal.js to try local first, CDN as fallback.

---

## Phase 7: Developer Documentation

### 7.1 Portal Developer Guide — `docs/portal-developer-guide.md`

For external developers building custom portals:
1. Quick start (minimal HTML + aimeat-auth.js + aimeat-data.js)
2. SDK API reference (all 6 libraries)
3. Auth flow (Ed25519 challenge/response, JWT lifecycle)
4. Styling guide (CSS custom properties from AIMEAT nodes)
5. Deployment via `/v1/site/template`
6. Example portals (dashboard, notes, community board)

### 7.2 Frontend Development Guide — `docs/frontend-development-guide.md`

For contributors to the AIMEAT SPA:
1. Architecture (Preact + HTM + importmap, no build step)
2. View module contract (exports, props, lifecycle)
3. Component library usage (imports from `components/`)
4. CSS conventions (`@scope`, theme.css variables, no inline styles)
5. i18n key naming conventions
6. Error handling standards
7. Testing guide (Playwright, what to test)

---

## Execution Order

| # | Phase | Items | Risk |
|---|-------|-------|------|
| 1 | Shared components | 8 files | Low — additive, no breaking changes |
| 2 | CSS extraction | 9 CSS files + theme.css updates | Medium — visual regression possible |
| 3 | Deduplication | 3 file edits | Low — mechanical replacement |
| 4 | i18n extraction | 3 file edits | Low — translation keys preserved |
| 5 | E2E tests | 1 test file | Low — additive |
| 6 | Security | 3 small changes | Low — backward compatible |
| 7 | Developer docs | 2 markdown files | None |

---

## Success Criteria

- [ ] `public/components/` exists with 7 shared components + barrel export
- [ ] All 9 views load CSS from external `@scope` files
- [ ] Zero inline CSS constants in JS files (PORTAL_CSS, PROFILE_CSS, etc. removed)
- [ ] Zero duplicate `copyToClipboard` in view files
- [ ] portal-classic.js uses shared i18n system
- [ ] `npx tsc --noEmit` passes
- [ ] Playwright view tests pass for all 9 views
- [ ] CSP headers verified in E2E tests
- [ ] Portal developer guide published
- [ ] Frontend development guide published
