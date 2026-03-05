# Frontend Gap Filling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fill in the 14 gaps identified in `docs/reports/2026-03-05-frontend-sprint-gap-analysis.md`, covering security hardening, performance, code quality, and developer experience items missing from the main sprint plan.

**Architecture:** All frontend changes are in `aimeat/public/` (no build step, edit files directly). Backend changes are in `aimeat/src/server.ts`. Gaps 1 (JWT migration) and 3 (Accessibility) are complex and are tracked as separate plans — see notes at end.

**Tech Stack:** Node.js/TypeScript (backend), Preact + HTM (frontend), pnpm, Express 5

---

## Scope of This Plan

Covers **Gaps 2, 4, 5, 6, 7, 10** — quick wins and medium-effort items.

| Gap | Description | Effort |
|-----|-------------|--------|
| Gap 2 | dangerouslySetInnerHTML audit | 1 hour |
| Gap 4 | Legacy HTML file removal | 15 min |
| Gap 5 | gzip/brotli compression | 15 min |
| Gap 6 | Empty `public/locales/` directory | 10 min |
| Gap 7 | useApiCall hook | 1 hour |
| Gap 10 | View template file | 15 min |

**Out of scope (need separate plans):**
- Gap 1: JWT/private key storage migration (1 day, requires aimeat-auth.js surgery)
- Gap 3: Accessibility — WCAG 2.2 AA minimum viable (1-2 days, touches all views)
- Gaps 8-14: Deferred (view splitting, router extraction, Signals, View Transitions, JSDoc, build pipeline)

---

## Task 1: gzip/brotli Compression (Gap 5)

**Files:**
- Modify: `aimeat/src/server.ts` (add import at top, add `app.use` after line 97)
- Modify: `aimeat/package.json` (add dependency)

**Step 1: Install the compression middleware**

```bash
cd aimeat
pnpm add compression
pnpm add -D @types/compression
```

Expected: packages added to `package.json` and `pnpm-lock.yaml`.

**Step 2: Add import to server.ts**

In `aimeat/src/server.ts`, add after the existing `import express from 'express';` line (line 1):

```typescript
import compression from 'compression';
```

**Step 3: Mount compression middleware**

In `aimeat/src/server.ts`, after line 97 (`const app = express();`), add:

```typescript
  // Compress all responses (gzip/brotli based on Accept-Encoding)
  app.use(compression());
```

The result should look like:

```typescript
  const app = express();

  // Compress all responses (gzip/brotli based on Accept-Encoding)
  app.use(compression());

  // Global middleware
  app.use(express.json({ limit: '15mb' }));
```

**Step 4: Type-check**

```bash
cd aimeat
npx tsc --noEmit
```

Expected: no errors.

**Step 5: Commit**

```bash
git add aimeat/src/server.ts aimeat/package.json aimeat/pnpm-lock.yaml
git commit -m "perf: add gzip compression middleware (Gap 5)"
```

---

## Task 2: Remove Legacy Dead HTML Files (Gap 4)

**Files:**
- Delete: `aimeat/public/human.html`
- Delete: `aimeat/public/profile.html`
- Keep: `aimeat/public/spa.html` (active SPA shell)
- Keep: `aimeat/public/wizard.html` (active — served at `/v1/setup/wizard`)

**Context:** Only 2 legacy HTML files remain. The other 7 mentioned in the analysis were already removed in a prior session. Verify before deleting:

- `spa.html` — the live SPA entry point, do NOT delete
- `wizard.html` — mounted via `server.ts` redirect at line 115-118 (`/wizard.html` → `/v1/setup/wizard`), keep it
- `human.html` — superseded by `views/portal.js`, safe to delete
- `profile.html` — superseded by `views/profile.js`, safe to delete

**Step 1: Verify the files are truly dead**

Check that `human.html` and `profile.html` are not referenced anywhere in server code:

```bash
cd aimeat
grep -r "human\.html\|profile\.html" src/
```

Expected: no matches (only `wizard.html` and `spa.html` are referenced in `src/server.ts`).

**Step 2: Delete the dead files**

```bash
rm aimeat/public/human.html
rm aimeat/public/profile.html
```

**Step 3: Verify server still starts**

```bash
cd aimeat
pnpm dev
```

Open `http://localhost:40050/v1/portal` — should load normally (the SPA shell, not the deleted file).
Stop the server with Ctrl+C.

**Step 4: Commit**

```bash
git add -A aimeat/public/human.html aimeat/public/profile.html
git commit -m "chore: remove dead legacy HTML files human.html and profile.html (Gap 4)"
```

---

## Task 3: Remove Misleading Empty `public/locales/` Directory (Gap 6)

**Context:** `public/locales/` is empty. The SPA's `i18n.js` fetches from `/locales/{lang}.json`, which is served by Express from the **backend** `aimeat/locales/` directory (server.ts line 152: `app.use('/locales', express.static(localeDir...))`). The empty frontend directory is misleading — removing it clarifies the canonical source.

**Files:**
- Delete: `aimeat/public/locales/` (entire directory, it's empty)

**Step 1: Confirm it's empty**

```bash
ls -la aimeat/public/locales/
```

Expected: empty directory (no `.json` files).

**Step 2: Remove the directory**

```bash
rmdir aimeat/public/locales
```

**Step 3: Verify i18n still works**

```bash
cd aimeat
pnpm dev
```

Open `http://localhost:40050/v1/portal` — switch language (if toggle visible). Check browser Network tab: `/locales/en.json` should still return 200 (served from backend `locales/`). Stop server.

**Step 4: Commit**

```bash
git add -A aimeat/public/locales
git commit -m "chore: remove empty public/locales dir — i18n is served from backend locales/ (Gap 6)"
```

---

## Task 4: dangerouslySetInnerHTML Audit (Gap 2)

**Context:** There are 6 `dangerouslySetInnerHTML` call sites across 2 files:

| File | Lines | Source | Risk |
|------|-------|--------|------|
| `public/views/portal-dev.js` | 155, 158, 160, 196, 226 | `dt()` translation strings | Low — developer-authored locale JSON |
| `public/views/profile.js` | 659 | `PLATFORMS[activePlat]` constant | None — hardcoded developer HTML |

**Decision:**
- **portal-dev.js:** Wrap with `sanitizeHtml()` — defense-in-depth if locale files were ever tampered with. `sanitizeHtml` from `utils.js` allows all tags needed for instruction text (`code`, `a`, `ol`, `li`, `p`, `b`, `i`, `em`, `strong`, `br`).
- **profile.js:** `PLATFORMS` is a hardcoded JS constant written by developers (not user input). Add a safety comment. Do NOT sanitize — `sanitizeHtml` would strip `<h4>` tags which are used in the content and not in the allowlist.

**Files:**
- Modify: `aimeat/public/views/portal-dev.js`
- Modify: `aimeat/public/views/profile.js`

**Step 1: Add sanitizeHtml import to portal-dev.js**

Find the imports at the top of `portal-dev.js`. Add `sanitizeHtml` to the utils.js import. Look for a line like:

```javascript
import { escHtml } from '/js/utils.js';
```

If it doesn't exist yet, add a new import. Change to (or add):

```javascript
import { escHtml, sanitizeHtml } from '/js/utils.js';
```

**Step 2: Wrap the 5 dangerouslySetInnerHTML calls in portal-dev.js**

For each of the 5 occurrences, wrap the `dt(...)` call with `sanitizeHtml(...)`:

```javascript
// Before:
<li dangerouslySetInnerHTML=${{ __html: dt('panel.mcpStep1', locale) }}></li>

// After:
<li dangerouslySetInnerHTML=${{ __html: sanitizeHtml(dt('panel.mcpStep1', locale)) }}></li>
```

Apply the same pattern to all 5 lines: 155, 158, 160, 196, 226.

**Step 3: Add explanatory comment to profile.js**

In `profile.js` near line 659, add a comment above the `dangerouslySetInnerHTML` usage:

```javascript
{/* SAFE: PLATFORMS is a hardcoded developer constant, not user input. sanitizeHtml not applied
    because h4/h3 tags used in content are not in the allowlist and would be stripped. */}
<div class="platform-content" dangerouslySetInnerHTML=${{ __html: PLATFORMS[activePlat] }}></div>
```

In HTM template literals, comments are written as `${/* comment */null}` or just as a JS comment before the JSX. Find the exact JSX line and add a regular JS comment above the `return` or `html\`` block that renders this element, e.g.:

```javascript
// SAFE: PLATFORMS is a hardcoded developer constant (not user input).
// sanitizeHtml excluded because h4 tags in content are not in the allowlist.
```

Place it just before the `html\`` line or expression containing the `dangerouslySetInnerHTML`.

**Step 4: Verify the portal-dev view renders correctly**

```bash
cd aimeat
pnpm dev
```

Navigate to `http://localhost:40050/v1/portal?view=dev`. Verify the MCP setup instructions and prompt builder panels still render with correct formatting (links, code blocks). Stop server.

**Step 5: Commit**

```bash
git add aimeat/public/views/portal-dev.js aimeat/public/views/profile.js
git commit -m "security: wrap dangerouslySetInnerHTML with sanitizeHtml in portal-dev.js (Gap 2)"
```

---

## Task 5: useApiCall Hook (Gap 7)

**Context:** Error handling quality varies significantly across views. Some use `Promise.allSettled()`, others have silent `.catch(() => {})`. Adding a shared `useApiCall` hook standardizes the fetch → loading → data/error state machine.

**API shape:** `api()` from `api.js` returns a parsed AIMEAT envelope: `{ ok, data, error, hints }`. On network failure: `{ ok: false, error: { code: 'NETWORK_ERROR', message: '...' } }`.

**Files:**
- Create: `aimeat/public/js/hooks.js`

**Step 1: Create the hooks file**

Create `aimeat/public/js/hooks.js` with the following content:

```javascript
/**
 * AIMEAT Shared Hooks
 * Reusable Preact hooks for common data-fetching and UI patterns.
 */
import { useState, useEffect } from 'preact/hooks';
import { api } from '/js/api.js';

/**
 * Fetch data from an AIMEAT API endpoint with automatic loading/error state management.
 *
 * @param {string} endpoint - The /v1/* path to fetch
 * @param {object} [options]
 * @param {Array}  [options.deps=[]] - Additional useEffect dependency values
 * @param {boolean} [options.skip=false] - Skip the fetch (e.g., when auth not ready)
 * @param {'GET'|'POST'|'PUT'|'DELETE'} [options.method='GET'] - HTTP method
 * @param {object} [options.body] - Request body for POST/PUT
 * @returns {{ data: any, error: string|null, loading: boolean, reload: function }}
 *
 * @example
 * const { data, error, loading } = useApiCall('/v1/memory/profile');
 * if (loading) return html`<${Spinner} />`;
 * if (error) return html`<${Alert} type="error" message=${error} />`;
 * return html`<div>${data.value}</div>`;
 */
export function useApiCall(endpoint, options = {}) {
  const { deps = [], skip = false, method = 'GET', body } = options;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!skip);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (skip) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api(endpoint, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    }).then(r => {
      if (cancelled) return;
      if (r.ok) {
        setData(r.data ?? r);
        setError(null);
      } else {
        const msg = r.error?.message ?? r.error ?? 'Request failed';
        setError(msg);
        setData(null);
      }
    }).catch(() => {
      if (!cancelled) setError('Network error — please try again');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, method, reloadKey, ...deps]);

  return { data, error, loading, reload: () => setReloadKey(k => k + 1) };
}
```

**Step 2: Verify the file is valid JS**

```bash
cd aimeat
node --input-type=module < public/js/hooks.js
```

Expected: no output, no errors (the import will fail in Node since `preact/hooks` is CDN-only, but syntax errors will be caught).

Actually use this instead to just check syntax:

```bash
node --check aimeat/public/js/hooks.js
```

Expected: exits with code 0 (no syntax errors).

**Step 3: Commit**

```bash
git add aimeat/public/js/hooks.js
git commit -m "feat: add useApiCall shared hook to standardize fetch/loading/error pattern (Gap 7)"
```

---

## Task 6: View Template File (Gap 10)

**Context:** No `views/_template.js` exists. New developers read the frontend guide (Phase 7.2) but a working file they can copy is more immediately useful. This complements the Phase 7 docs.

**Files:**
- Create: `aimeat/public/views/_template.js`

**Step 1: Create the template file**

Create `aimeat/public/views/_template.js`:

```javascript
/**
 * AIMEAT View Template
 * ─────────────────────────────────────────────────────────────────────────────
 * Copy this file to create a new view:
 *   cp public/views/_template.js public/views/myview.js
 *
 * Then:
 *   1. Rename the export function to MyView
 *   2. Add a route case in spa.html matchRoute()
 *   3. Add the server-side fallback route in src/routes/portal.ts
 *   4. Add a nav link in spa.html header (if needed)
 *   5. Add translation keys under "myview.*" in locales/en.json and locales/fi.json
 *   6. Create public/css/views/myview.css for view-specific styles
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { html } from 'htm/preact';
import { useState, useEffect } from 'preact/hooks';
import { apiGet } from '/js/api.js';
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { useApiCall } from '/js/hooks.js';

// Uncomment to use shared components (after Phase 1 components are built):
// import { Alert, Spinner } from '/components/index.js';

/**
 * MyView — replace with your view's name and description.
 *
 * @param {object} props
 * @param {function} props.navigate - SPA navigation function, e.g. navigate('/v1/profile')
 * @param {string}   props.locale   - Active locale ('en' | 'fi')
 */
export default function MyView({ navigate, locale }) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [localState, setLocalState] = useState(null);

  // ── Data fetching ──────────────────────────────────────────────────────────
  // Option A: useApiCall hook (recommended — handles loading/error/retry)
  const { data, error, loading } = useApiCall('/v1/your-endpoint');

  // Option B: Manual fetch (use when you need finer control or multiple endpoints)
  // useEffect(() => {
  //   apiGet('/v1/your-endpoint')
  //     .then(r => { if (r.ok) setLocalState(r.data); })
  //     .catch(() => { /* handle network error */ });
  // }, []);

  // ── Load view-specific CSS ─────────────────────────────────────────────────
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/views/myview.css';
    document.head.appendChild(link);
    return () => link.remove();
  }, []);

  // ── Render states ──────────────────────────────────────────────────────────
  if (loading) return html`<div class="view-loading">${t('loading')}</div>`;
  if (error)   return html`<div class="alert alert-error">${escHtml(error)}</div>`;

  // ── Main render ────────────────────────────────────────────────────────────
  return html`
    <div class="myview-container">
      <h1>${t('myview.title')}</h1>

      ${data && html`
        <p>${escHtml(data.someField)}</p>
      `}

      <button class="btn btn-primary" onClick=${() => navigate('/v1/portal')}>
        ${t('nav.home')}
      </button>
    </div>
  `;
}
```

**Step 2: Commit**

```bash
git add aimeat/public/views/_template.js
git commit -m "docs: add view template file for new view scaffolding (Gap 10)"
```

---

## Task 7: Type-check and Verify

**Step 1: Final type-check**

```bash
cd aimeat
npx tsc --noEmit
```

Expected: 0 errors.

**Step 2: Smoke test the server**

```bash
cd aimeat
pnpm dev
```

- Navigate to `http://localhost:40050/v1/portal` — loads
- Navigate to `http://localhost:40050/v1/portal?view=dev` — MCP instructions render correctly
- Navigate to `http://localhost:40050/v1/profile` — platform tabs render (PLATFORMS HTML intact)
- Check Network tab: verify responses include `Content-Encoding: gzip` header
- Verify `GET /locales/en.json` returns 200 (served from backend, not deleted frontend dir)

Stop server.

**Step 3: Final commit summary**

All changes should already be committed per-task. Confirm:

```bash
git log --oneline -6
```

Expected:
```
xxxxxxx docs: add view template file for new view scaffolding (Gap 10)
xxxxxxx feat: add useApiCall shared hook (Gap 7)
xxxxxxx security: wrap dangerouslySetInnerHTML with sanitizeHtml in portal-dev.js (Gap 2)
xxxxxxx chore: remove empty public/locales dir (Gap 6)
xxxxxxx chore: remove dead legacy HTML files human.html and profile.html (Gap 4)
xxxxxxx perf: add gzip compression middleware (Gap 5)
```

---

## Out of Scope — Separate Plans Required

### Gap 1: JWT / Private Key Storage Migration

**Why separate:** Requires surgery on `aimeat-auth.js` (a dynamically-generated library in `src/routes/libs.ts`). Changes affect the session lifecycle across all views and external portal builders. Needs its own branch, thorough E2E testing, and a migration path.

**Plan when ready:** Create `docs/plans/2026-03-05-jwt-storage-migration.md`.

### Gap 3: Accessibility — WCAG 2.2 AA Minimum Viable

**Why separate:** Touches `spa.html` (shell), all 9 views, and `css/theme.css`. Requires systematic review of each view's semantic HTML, form labels, and focus management. Estimated 1-2 days. Better as its own sprint.

**Plan when ready:** Create `docs/plans/2026-03-05-accessibility-mvp.md`.
