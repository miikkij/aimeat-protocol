# AIMEAT Code Quality Audit Report

**Date:** 2026-03-12
**Scope:** Full codebase — backend (src/), frontend (public/), configuration, tests, dependencies
**Codebase size:** ~77,000 LOC backend (192 TypeScript files), ~15,000 LOC frontend (29 admin tabs + static HTML)

---

## Executive Summary

The AIMEAT codebase is architecturally sound and production-quality. TypeScript strict mode is enforced, the storage layer is well-abstracted, auth middleware is comprehensive, and test coverage is solid (517 unit tests, 19 E2E suites). The main areas for improvement are: XSS vulnerabilities in the frontend error display, inconsistent error handling patterns across admin tabs, oversized files that need decomposition, and missing test coverage reporting.

**Overall Score: 8.5 / 10**

---

## Findings by Category

### 1. Security — XSS Vulnerabilities

#### 1a. innerHTML with unsanitized error message (CRITICAL)

**File:** `public/spa.html:319-324`

```javascript
boot().catch(err => {
  console.error('Boot failed:', err);
  document.getElementById('app').innerHTML =
    '<div style="text-align:center;padding:3rem;color:#ccc;font-family:system-ui">' +
    '<h2>AIMEAT failed to start</h2>' +
    '<p>' + (err.message || 'Unknown error') + '</p>' +
```

**Problem:** `err.message` is injected directly into `innerHTML`. If the error message contains HTML or script tags, they execute. An attacker-controlled error (e.g., from a malicious API response) could achieve XSS.

**Fix:** Replace `innerHTML` with `textContent`, or escape the error message before insertion.

#### 1b. Undocumented dangerouslySetInnerHTML in DataTable (MEDIUM)

**File:** `public/views/admin/shared.js:101-104`

```javascript
${row.map(cell => {
  if (cell && typeof cell === 'object' && cell._html) {
    return html`<td class=${cell.mono ? 'mono' : ''} title=${cell.title || ''}
      dangerouslySetInnerHTML=${{ __html: cell.text }}></td>`;
```

**Problem:** The `DataTable` component renders raw HTML when a cell has `_html: true`. There is no sanitization and no documentation of the safety contract. Any caller passing user-generated data in `cell.text` introduces XSS.

**Fix:** Add JSDoc documenting that `cell.text` MUST be pre-sanitized. Consider adding `escHtml()` as a safety net, or renaming the property to `trustedHtml` to make the danger explicit.

---

### 2. Error Handling — Silent Catches

#### 2a. Frontend silent catch blocks

**Files and lines:**

| File | Line(s) | Pattern |
|------|---------|---------|
| `public/views/admin/agents-tab.js` | 24 | `} catch {}` |
| `public/views/admin/boards-tab.js` | 25 | `} catch {}` |
| `public/views/admin/chat-instances-tab.js` | 24, 95 | `} catch { setState([]); }` |
| `public/views/admin/csm-tab.js` | 48 | `} catch { setFileTemplates([]); }` |
| `public/js/api.js` | 30 | `catch(_) { /* proceed */ }` (JWT parse) |
| `public/js/api.js` | 49 | Refresh failure proceeds silently |
| `public/spa.html` | 238 | `.catch(() => {})` (wallet fetch) |

**Impact:** Failures are invisible to operators. A broken API endpoint silently returns empty data, making debugging extremely difficult.

#### 2b. Backend fire-and-forget catches

**Pattern:** `executeHooks(...).catch(() => { })` — hooks fail silently with no logging.

| File | Line(s) |
|------|---------|
| `src/routes/agents.ts` | 320, 421, 538, 874 |
| `src/routes/owners.ts` | 59, 646 |
| `src/routes/work.ts` | 558, 580 |
| `src/routes/apps.ts` | 222 |
| `src/routes/mcp.ts` | 140, 145, 662 |
| `src/routes/auth.ts` | 595 |

**Impact:** Hook failures (webhooks, notifications, cleanup) are invisible. In production, this makes it impossible to diagnose why a webhook wasn't delivered or why a cleanup task didn't run.

---

### 3. Error Handling — Alert-Based UI Errors

**15 admin tab files** use `alert()` for error display instead of state-based UI feedback:

| File | Line(s) |
|------|---------|
| `boards-tab.js` | 37, 41 |
| `chat-instances-tab.js` | 44, 107, 121 |
| `cors-tab.js` | 114, 122, 130, 138 |
| `csm-tab.js` | 37 |
| `genesis-tab.js` | 18 |
| `ghii-tab.js` | 14, 20 |
| `hooks-tab.js` | 16 |
| `maintenance-tab.js` | 19 |
| `msm-tab.js` | 120 |
| `owners-tab.js` | 16 |
| `portal-tab.js` | 36, 49, 53, 59, 65, 73, 74, 81, 83 |
| `push-tab.js` | 36, 69 |
| `realtime-tab.js` | 19 |
| `scheduler-tab.js` | 26, 35, 45 |
| `services-tab.js` | 473, 481, 489, 502, 848, 860, 870 |

**Total: ~40+ alert() calls across 15 files.**

**Impact:** `alert()` blocks the UI thread, provides no styling control, cannot be dismissed programmatically, and provides a poor operator experience. Some tabs (federation-tab) already use a better pattern (`flash()` / `flashErr()`) — this should be standardized.

---

### 4. Network Resilience — Missing Fetch Timeout

**File:** `public/js/api.js:39`

```javascript
const resp = await fetch(path, { ...opts, headers });
```

**Problem:** No `AbortController` with timeout. If the server hangs or the network stalls, the fetch waits indefinitely, freezing the UI.

**Fix:** Add `AbortController` with a 30-second timeout.

---

### 5. Logging — console.warn Instead of Logger

**File:** `src/auth/middleware.ts:226`

```typescript
console.warn(`[scope-denied] ${req.auth.sub} needs "${required}", has [${agentScopes.join(', ')}] on ${req.method} ${req.path}`);
```

**Problem:** Uses `console.warn` instead of the project's logger service. Bypasses log level filtering, structured logging, and log aggregation.

---

### 6. Code Organization — Oversized Files

| File | Lines | Domain |
|------|-------|--------|
| `src/storage/providers/sqlite/index.ts` | 4,535 | All SQLite repository implementations |
| `src/routes/federation.ts` | 2,317 | Federation peering, sync, genesis |
| `src/routes/admin.ts` | 1,587 | Admin API endpoints |
| `src/server.ts` | 1,353 | Server setup, middleware, route mounting |

**Impact:** Large files are harder to navigate, review, and maintain. Related changes require scrolling through thousands of lines. Merge conflicts are more likely.

**Recommendation:** Split by domain. For example, `sqlite/index.ts` could become `sqlite/agents.ts`, `sqlite/memory.ts`, `sqlite/work.ts`, etc., with a barrel `index.ts` re-exporting the composite.

---

### 7. Frontend — Inline Styles

**Primary offender:** `public/views/admin/email-tab.js` — 60+ inline `style=` attributes.

**Other files with inline styles:**
- `config-tab.js:94-107` (error banners)
- `csm-tab.js:144-149` (pre/detail formatting)
- `overview-tab.js:20` (border colors)

**Impact:** Inline styles bypass the CSS system (`adm-*` classes), cannot be themed, and make visual consistency difficult to maintain.

---

### 8. Frontend — Form Input Validation Gaps

#### 8a. No upper bound on mint amount

**File:** `public/views/admin/economy-tab.js:19`

```javascript
const amount = parseInt(mintAmount);
if (!mintGaii || !amount || amount < 1) { ... }
```

Only checks `< 1`. No upper bound — operator could mint billions of morsels accidentally.

#### 8b. No URL format validation for federation peers

**File:** `public/views/admin/federation-tab.js:83-87`

```javascript
if (!addNodeId || !addUrl) { flashErr(t('dashboard.fedAddPeerMissing')); return; }
```

Checks existence only, not URL format or nodeId format.

#### 8c. No client-side YAML validation

**File:** `public/views/admin/csm-tab.js:62-70`

YAML is sent directly to the server without any client-side syntax check. Server validates, but user gets no immediate feedback.

---

### 9. CSS — Badge Variant Duplication

**File:** `public/css/views/admin.css:127-148`

22 badge variant rules reduce to only 5 distinct color schemes:

| Color | Classes using it |
|-------|-----------------|
| Green (`#22c55e`) | healthy, public, delivered, settled, owner |
| Yellow (`#eab308`) | watch, pending |
| Red (`#ef4444`) | danger, critical, cancelled, expired, disputed, error |
| Blue (`#3b82f6`) | info, accepted, in_progress, operator, syncing |
| Purple (`#a855f7`) | private, agent |
| Gray (`#94a3b8`) | idle, general |

**Fix:** Define 6 semantic color classes (e.g., `.adm-badge--success`, `.adm-badge--warning`, `.adm-badge--danger`, `.adm-badge--info`, `.adm-badge--accent`, `.adm-badge--muted`) and map badge names via comma-separated selectors or a JS lookup.

---

### 10. Magic Numbers

#### 10a. Device authorization timeout

**File:** `src/routes/agents.ts:60`

```typescript
const expiresAt = new Date(now.getTime() + 600_000); // 10 minutes
```

Should be a named constant: `const DEVICE_AUTH_EXPIRY_MS = 600_000;`

#### 10b. Trust score weights

**File:** `src/services/trust.ts:69-76`

```typescript
const disputePenalty = Math.max(0, 100 - disputesLost * 33);
let score = Math.floor(
  successRate * 0.30 +
  positiveRatingRatio * 0.25 +
  ageFactor * 0.15 +
  volumeFactor * 0.15 +
  disputePenalty * 0.15,
```

Seven hardcoded numeric constants with no configuration. The `33` penalty multiplier is unexplained.

---

### 11. Code Duplication — Fire-and-Forget Hook Pattern

The pattern `executeHooks(config, storage, eventName, payload).catch(() => { })` appears in **6 route files, 14+ call sites**. Each site:
1. Swallows errors silently
2. Duplicates the same invocation pattern

**Fix:** Create a `fireHook(config, storage, event, payload)` wrapper that logs failures and standardizes the pattern.

---

### 12. Dependencies — Unused @prisma/client

**File:** `package.json:132-134`

```json
"optionalDependencies": {
  "@prisma/client": "^6.19.2"
}
```

Not referenced anywhere in the codebase. The project uses `better-sqlite3` and native MongoDB driver instead.

---

### 13. ESM Purity — require() in Build Script

**File:** `package.json:16`

The build script uses `node -e "const fs=require('fs');..."` — CommonJS in an ESM project. Functional but inconsistent.

---

### 14. Test Coverage — No Reporting Configured

**File:** `vitest.config.ts`

```typescript
export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts', 'test/integration/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
```

No `coverage` section. No threshold enforcement. Team has no visibility into which code paths are untested.

---

## Strengths Worth Preserving

| Area | Details |
|------|---------|
| **TypeScript strictness** | `strict: true`, only 14 `any` usages across 192 files |
| **Auth middleware** | Multi-layer: `requireAuth()` → `requireRole()` → `requireScope()`, with token revocation |
| **Storage abstraction** | Clean `Storage` interface with memory, SQLite, MongoDB providers |
| **Response envelope** | Every endpoint uses `success()` / `error()` from `middleware/envelope.ts` |
| **Security headers** | CSP with nonces, HSTS, SSRF validation, rate limiting |
| **Test suite** | 517 unit tests (1.27s), 19 E2E suites, 5 Playwright specs |
| **Configuration** | Multi-source with provenance tracking (CLI → env → file → DB → defaults) |
| **i18n** | EN + FI parity, no missing keys |
| **OpenAPI spec** | 10,665 lines, 196 paths, 235 operations — comprehensive |

---

## Summary Matrix

| # | Finding | Severity | Count | Effort |
|---|---------|----------|-------|--------|
| 1 | XSS in spa.html innerHTML | Critical | 1 | Small |
| 2 | Undocumented dangerouslySetInnerHTML | Medium | 1 | Small |
| 3 | Silent frontend catches | High | 7 | Medium |
| 4 | Silent backend catches (fire-and-forget hooks) | High | 14+ | Medium |
| 5 | alert() error handling | High | 40+ | Large |
| 6 | Missing fetch timeout | High | 1 | Small |
| 7 | console.warn instead of logger | Low | 1 | Small |
| 8 | Oversized files | Medium | 4 | Large |
| 9 | Inline styles | Low | 60+ | Large |
| 10 | Form validation gaps | Medium | 3 | Small |
| 11 | CSS badge duplication | Low | 22 rules | Small |
| 12 | Magic numbers | Low | 7+ | Small |
| 13 | Hook pattern duplication | Medium | 14+ sites | Small |
| 14 | Unused @prisma/client | Low | 1 | Trivial |
| 15 | require() in ESM build script | Low | 1 | Trivial |
| 16 | No test coverage reporting | Medium | 1 | Small |
