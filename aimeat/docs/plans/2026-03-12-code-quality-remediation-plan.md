# Code Quality Remediation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediate all findings from the 2026-03-12 code quality audit — XSS fixes, error handling standardization, frontend robustness, CSS cleanup, magic number extraction, test coverage configuration, and dependency hygiene.

**Architecture:** Changes are grouped into independent tasks by concern. Frontend error handling is standardized through a new shared `showError()` component. Backend fire-and-forget hooks are wrapped in a logged helper. No architectural changes — all fixes stay within existing patterns.

**Tech Stack:** Preact + HTM (frontend), Express 5 + TypeScript (backend), vitest (tests), existing i18n and logger infrastructure.

**Reference:** See `docs/plans/2026-03-12-code-quality-audit-report.md` for full findings with line numbers.

---

## Chunk 1: Critical and High Priority Fixes

### Task 1: Fix XSS in spa.html Boot Error Display

**Files:**
- Modify: `public/spa.html:319-324`

- [ ] **Step 1: Replace innerHTML with safe DOM manipulation**

In `public/spa.html`, find the boot error handler (around line 319):

```javascript
boot().catch(err => {
  console.error('Boot failed:', err);
  document.getElementById('app').innerHTML =
    '<div style="text-align:center;padding:3rem;color:#ccc;font-family:system-ui">' +
    '<h2>AIMEAT failed to start</h2>' +
    '<p>' + (err.message || 'Unknown error') + '</p>' +
    '</div>';
});
```

Replace with:

```javascript
boot().catch(err => {
  console.error('Boot failed:', err);
  const app = document.getElementById('app');
  const wrap = document.createElement('div');
  wrap.style.cssText = 'text-align:center;padding:3rem;color:#ccc;font-family:system-ui';
  const h = document.createElement('h2');
  h.textContent = 'AIMEAT failed to start';
  const p = document.createElement('p');
  p.textContent = err.message || 'Unknown error';
  wrap.appendChild(h);
  wrap.appendChild(p);
  app.textContent = '';
  app.appendChild(wrap);
});
```

- [ ] **Step 2: Verify in browser**

Open the app with a broken config or kill the API server. Confirm the error message renders as text, not HTML.

- [ ] **Step 3: Commit**

```bash
git add public/spa.html
git commit -m "fix(security): prevent XSS in boot error display by using textContent"
```

---

### Task 2: Document dangerouslySetInnerHTML Contract in DataTable

**Files:**
- Modify: `public/views/admin/shared.js:96-110`

- [ ] **Step 1: Add safety comment and rename property**

In `public/views/admin/shared.js`, find the DataTable cell rendering (around line 101):

```javascript
${row.map(cell => {
  if (cell && typeof cell === 'object' && cell._html) {
    return html`<td class=${cell.mono ? 'mono' : ''} title=${cell.title || ''}
      dangerouslySetInnerHTML=${{ __html: cell.text }}></td>`;
```

Add a JSDoc comment above the DataTable function (around line 96):

```javascript
/**
 * DataTable — renders rows with optional raw HTML cells.
 *
 * SECURITY: When a cell object has `_html: true`, `cell.text` is rendered
 * as raw HTML via dangerouslySetInnerHTML. Callers MUST ensure `cell.text`
 * is sanitized (use escHtml() for any user-generated content).
 * Only use `_html` for trusted, server-generated markup like badges.
 */
```

- [ ] **Step 2: Audit all DataTable callers for _html usage**

Search for `_html` across all admin tab files. Verify each usage passes only trusted content (i18n strings, badges, formatted numbers) — not raw user input.

Run: `grep -rn "_html" public/views/admin/`

- [ ] **Step 3: Commit**

```bash
git add public/views/admin/shared.js
git commit -m "docs(security): document XSS contract for DataTable _html cells"
```

---

### Task 3: Add Fetch Timeout to API Client

**Files:**
- Modify: `public/js/api.js:37-39`

- [ ] **Step 1: Add AbortController timeout**

In `public/js/api.js`, find the fetch call inside the retry loop (around line 37):

```javascript
for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  try {
    const resp = await fetch(path, { ...opts, headers });
```

Replace with:

```javascript
for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);
  try {
    const resp = await fetch(path, { ...opts, headers, signal: controller.signal });
```

Then find the catch block for this try (where retries are handled) and add abort-specific handling before the existing network error logic:

```javascript
  } catch (err) {
    if (err.name === 'AbortError') {
      if (attempt === MAX_RETRIES) throw new Error('Request timed out after 30s');
      continue;
    }
```

And add `clearTimeout(timeoutId)` in a finally block:

```javascript
  } finally {
    clearTimeout(timeoutId);
  }
```

- [ ] **Step 2: Test by throttling network in DevTools**

Open DevTools > Network > Throttle to "Offline" after a request starts. Confirm the request aborts after 30 seconds instead of hanging.

- [ ] **Step 3: Commit**

```bash
git add public/js/api.js
git commit -m "fix(frontend): add 30s fetch timeout to prevent indefinite hangs"
```

---

### Task 4: Create Shared Error Notification Component

**Files:**
- Modify: `public/views/admin/shared.js` (add ErrorToast component)
- Modify: `public/css/views/admin.css` (add toast styles)

- [ ] **Step 1: Add toast CSS classes**

In `public/css/views/admin.css`, add after the existing `.adm-badge` rules (around line 148):

```css
/* Error / success toast */
.adm-toast {
  padding: 10px 16px;
  border-radius: 8px;
  font-size: .85rem;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  animation: adm-toast-in .2s ease;
}
.adm-toast-error   { background: #dc262622; color: #ef4444; border: 1px solid #dc262655; }
.adm-toast-success { background: #16a34a22; color: #22c55e; border: 1px solid #16a34a55; }
.adm-toast-dismiss {
  margin-left: auto;
  cursor: pointer;
  opacity: .6;
  background: none;
  border: none;
  color: inherit;
  font-size: 1rem;
}
.adm-toast-dismiss:hover { opacity: 1; }
@keyframes adm-toast-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
```

- [ ] **Step 2: Add ErrorToast and useToast hook to shared.js**

In `public/views/admin/shared.js`, add after the existing exports:

```javascript
/**
 * useToast — state hook for dismissible error/success messages.
 * Returns [message, showError, showSuccess, clear].
 * Usage:
 *   const [toast, showErr, showOk, clearToast] = useToast();
 *   // in catch: showErr(e.message);
 *   // in render: ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
 */
export function useToast() {
  const [msg, setMsg] = useState(null);
  const showError   = (text) => setMsg({ type: 'error',   text });
  const showSuccess = (text) => setMsg({ type: 'success', text });
  const clear       = ()     => setMsg(null);
  return [msg, showError, showSuccess, clear];
}

export function Toast({ type, text, onDismiss }) {
  return html`<div class="adm-toast adm-toast-${type}">
    <span>${text}</span>
    <button class="adm-toast-dismiss" onClick=${onDismiss}>\u00d7</button>
  </div>`;
}
```

- [ ] **Step 3: Commit**

```bash
git add public/views/admin/shared.js public/css/views/admin.css
git commit -m "feat(admin): add Toast component and useToast hook for standardized error display"
```

---

### Task 5: Migrate Admin Tabs from alert() to Toast — Batch 1 (Small Tabs)

**Files (each has 1-2 alert calls):**
- Modify: `public/views/admin/genesis-tab.js` (line 18)
- Modify: `public/views/admin/hooks-tab.js` (line 16)
- Modify: `public/views/admin/maintenance-tab.js` (line 19)
- Modify: `public/views/admin/owners-tab.js` (line 16)
- Modify: `public/views/admin/realtime-tab.js` (line 19)
- Modify: `public/views/admin/ghii-tab.js` (lines 14, 20)

For each file, the migration pattern is:

- [ ] **Step 1: Import useToast and Toast**

Add to the imports at the top of each file:

```javascript
import { useToast, Toast } from './shared.js';
```

- [ ] **Step 2: Add useToast hook**

Inside the component function, add near the top with other state hooks:

```javascript
const [toast, showErr, showOk, clearToast] = useToast();
```

- [ ] **Step 3: Replace alert() calls**

Replace each `alert(t('dashboard.errorLabel') + ': ' + e.message)` with:

```javascript
showErr(e.message);
```

Replace success alerts like `alert(t('dashboard.someConfirm'))` with:

```javascript
showOk(t('dashboard.someConfirm'));
```

- [ ] **Step 4: Add Toast to render output**

At the top of the component's return template, add:

```javascript
${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
```

- [ ] **Step 5: Commit**

```bash
git add public/views/admin/genesis-tab.js public/views/admin/hooks-tab.js public/views/admin/maintenance-tab.js public/views/admin/owners-tab.js public/views/admin/realtime-tab.js public/views/admin/ghii-tab.js
git commit -m "refactor(admin): replace alert() with Toast in 6 small admin tabs"
```

---

### Task 6: Migrate Admin Tabs from alert() to Toast — Batch 2 (Medium Tabs)

**Files (3-5 alert calls each):**
- Modify: `public/views/admin/boards-tab.js` (lines 37, 41)
- Modify: `public/views/admin/chat-instances-tab.js` (lines 44, 107, 121)
- Modify: `public/views/admin/cors-tab.js` (lines 114, 122, 130, 138)
- Modify: `public/views/admin/csm-tab.js` (line 37)
- Modify: `public/views/admin/msm-tab.js` (line 120)
- Modify: `public/views/admin/push-tab.js` (lines 36, 69)
- Modify: `public/views/admin/scheduler-tab.js` (lines 26, 35, 45)

Follow the same migration pattern as Task 5 for each file.

- [ ] **Step 1: Import useToast and Toast in each file**
- [ ] **Step 2: Add useToast hook in each component**
- [ ] **Step 3: Replace all alert() calls with showErr/showOk**
- [ ] **Step 4: Add Toast to each component's render output**
- [ ] **Step 5: Commit**

```bash
git add public/views/admin/boards-tab.js public/views/admin/chat-instances-tab.js public/views/admin/cors-tab.js public/views/admin/csm-tab.js public/views/admin/msm-tab.js public/views/admin/push-tab.js public/views/admin/scheduler-tab.js
git commit -m "refactor(admin): replace alert() with Toast in 7 medium admin tabs"
```

---

### Task 7: Migrate Admin Tabs from alert() to Toast — Batch 3 (Large Tabs)

**Files (many alert calls):**
- Modify: `public/views/admin/portal-tab.js` (lines 36, 49, 53, 59, 65, 73, 74, 81, 83)
- Modify: `public/views/admin/services-tab.js` (lines 473, 481, 489, 502, 848, 860, 870)

These tabs have 7-9 alert calls each. Follow the same pattern but take care to test each action path.

- [ ] **Step 1: Import useToast and Toast**
- [ ] **Step 2: Add useToast hook**
- [ ] **Step 3: Replace all alert() calls with showErr/showOk**
- [ ] **Step 4: Add Toast to render output**
- [ ] **Step 5: Manual test — trigger each error path in the browser**
- [ ] **Step 6: Commit**

```bash
git add public/views/admin/portal-tab.js public/views/admin/services-tab.js
git commit -m "refactor(admin): replace alert() with Toast in portal and services tabs"
```

---

### Task 8: Add Logging to Frontend Silent Catches

**Files:**
- Modify: `public/views/admin/agents-tab.js:24`
- Modify: `public/views/admin/boards-tab.js:25`
- Modify: `public/views/admin/chat-instances-tab.js:24, 95`
- Modify: `public/views/admin/csm-tab.js:48`
- Modify: `public/js/api.js:30, 49`
- Modify: `public/spa.html:238`

- [ ] **Step 1: Add console.warn to empty catch blocks in admin tabs**

For each silent `} catch {}` block, add logging:

```javascript
} catch (e) { console.warn('Failed to load data:', e.message); }
```

For catches that reset state, keep the reset but add logging:

```javascript
} catch (e) { console.warn('Failed to load:', e.message); setPosts([]); }
```

- [ ] **Step 2: Add logging to api.js silent catches**

In `public/js/api.js:30`, replace:
```javascript
catch(_) { /* proceed */ }
```
with:
```javascript
catch(e) { console.warn('JWT parse failed, proceeding:', e.message); }
```

At line 49, add logging for refresh failure.

- [ ] **Step 3: Add logging to spa.html wallet fetch**

In `public/spa.html:238`, replace `.catch(() => {})` with:
```javascript
.catch(e => console.warn('Wallet fetch failed:', e.message))
```

- [ ] **Step 4: Commit**

```bash
git add public/views/admin/agents-tab.js public/views/admin/boards-tab.js public/views/admin/chat-instances-tab.js public/views/admin/csm-tab.js public/js/api.js public/spa.html
git commit -m "fix(frontend): add logging to silent catch blocks for debuggability"
```

---

### Task 9: Create Backend Hook Helper with Logging

**Files:**
- Create: `src/utils/fire-hook.ts`
- Modify: `src/routes/agents.ts` (lines 320, 421, 538, 874)
- Modify: `src/routes/owners.ts` (lines 59, 646)
- Modify: `src/routes/work.ts` (lines 558, 580)
- Modify: `src/routes/apps.ts` (line 222)
- Modify: `src/routes/mcp.ts` (lines 140, 145, 662)
- Modify: `src/routes/auth.ts` (line 595)

- [ ] **Step 1: Create fire-hook.ts**

```typescript
import { AimeatConfig } from '../config.js';
import { Storage } from '../storage/interface.js';
import { executeHooks } from '../services/hooks.js';
import { logger } from './logger.js';

/**
 * Fire a hook asynchronously without blocking the caller.
 * Logs failures instead of swallowing them silently.
 */
export function fireHook(
  config: AimeatConfig,
  storage: Storage,
  event: string,
  payload: Record<string, unknown>,
): void {
  executeHooks(config, storage, event, payload).catch(err => {
    logger.warn(`Hook "${event}" failed: ${err.message}`);
  });
}
```

- [ ] **Step 2: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Replace executeHooks().catch(() => {}) in agents.ts**

In `src/routes/agents.ts`, replace each occurrence of:
```typescript
executeHooks(config, storage, 'event_name', payload).catch(() => { });
```
with:
```typescript
fireHook(config, storage, 'event_name', payload);
```

Add the import at the top:
```typescript
import { fireHook } from '../utils/fire-hook.js';
```

Repeat for lines 320, 421, 538, 874.

- [ ] **Step 4: Repeat for owners.ts, work.ts, apps.ts, mcp.ts, auth.ts**

Same pattern: import `fireHook`, replace `executeHooks(...).catch(() => { })` with `fireHook(...)`.

- [ ] **Step 5: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Run tests**

Run: `cd aimeat && pnpm test`
Expected: 517 tests passing

- [ ] **Step 7: Commit**

```bash
git add src/utils/fire-hook.ts src/routes/agents.ts src/routes/owners.ts src/routes/work.ts src/routes/apps.ts src/routes/mcp.ts src/routes/auth.ts
git commit -m "refactor(backend): replace silent hook catches with logged fireHook helper"
```

---

## Chunk 2: Medium Priority Fixes

### Task 10: Replace console.warn with Logger in Auth Middleware

**Files:**
- Modify: `src/auth/middleware.ts:226`

- [ ] **Step 1: Check if logger is already imported**

Read `src/auth/middleware.ts` top imports. If `logger` is not imported, add:

```typescript
import { logger } from '../utils/logger.js';
```

- [ ] **Step 2: Replace console.warn**

Replace line 226:
```typescript
console.warn(`[scope-denied] ${req.auth.sub} needs "${required}", has [${agentScopes.join(', ')}] on ${req.method} ${req.path}`);
```

With:
```typescript
logger.warn(`[scope-denied] ${req.auth.sub} needs "${required}", has [${agentScopes.join(', ')}] on ${req.method} ${req.path}`);
```

- [ ] **Step 3: Run type-check and tests**

Run: `cd aimeat && npx tsc --noEmit && pnpm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/auth/middleware.ts
git commit -m "fix(auth): use project logger instead of console.warn for scope denials"
```

---

### Task 11: Add Frontend Form Input Validation

**Files:**
- Modify: `public/views/admin/economy-tab.js:18-20`
- Modify: `public/views/admin/federation-tab.js:83-87`
- Modify: `public/views/admin/csm-tab.js:62-70`

- [ ] **Step 1: Add upper bound to mint amount**

In `economy-tab.js`, find the `doMint` function (around line 18):

```javascript
const amount = parseInt(mintAmount);
if (!mintGaii || !amount || amount < 1) {
```

Replace with:

```javascript
const amount = parseInt(mintAmount, 10);
if (!mintGaii || !amount || amount < 1 || amount > 1_000_000) {
  showErr(t('dashboard.econMintInvalid') || 'Amount must be 1–1,000,000');
  return;
}
```

- [ ] **Step 2: Add URL validation to federation peer add**

In `federation-tab.js`, find `doAddPeer` (around line 83):

```javascript
if (!addNodeId || !addUrl) { flashErr(t('dashboard.fedAddPeerMissing')); return; }
```

Replace with:

```javascript
if (!addNodeId || !addUrl) { flashErr(t('dashboard.fedAddPeerMissing')); return; }
try { new URL(addUrl); } catch { flashErr(t('dashboard.fedInvalidUrl') || 'Invalid URL format'); return; }
```

- [ ] **Step 3: Add client-side YAML syntax check to CSM tab**

In `csm-tab.js`, find `doCreate` (around line 62). The project may already load js-yaml. If available, add a basic parse check:

```javascript
async function doCreate() {
  if (!yaml.trim()) return;
  // Basic syntax check before sending to server
  try { jsyaml.load(yaml); } catch (e) { setErr('YAML syntax error: ' + e.message); return; }
  setLoading(true);
```

If js-yaml is not available client-side, skip this step — the server-side validation is sufficient.

- [ ] **Step 4: Commit**

```bash
git add public/views/admin/economy-tab.js public/views/admin/federation-tab.js public/views/admin/csm-tab.js
git commit -m "fix(admin): add input validation to economy, federation, and CSM tabs"
```

---

### Task 12: Extract Magic Numbers to Named Constants

**Files:**
- Modify: `src/routes/agents.ts:60`
- Modify: `src/services/trust.ts:69-76`

- [ ] **Step 1: Add named constant in agents.ts**

At the top of `src/routes/agents.ts` (after imports), add:

```typescript
/** Device authorization code expires after 10 minutes */
const DEVICE_AUTH_EXPIRY_MS = 600_000;
```

Then replace line 60:
```typescript
const expiresAt = new Date(now.getTime() + 600_000);
```
with:
```typescript
const expiresAt = new Date(now.getTime() + DEVICE_AUTH_EXPIRY_MS);
```

- [ ] **Step 2: Add named constants in trust.ts**

At the top of `src/services/trust.ts` (after imports), add:

```typescript
/** Trust score component weights (must sum to 1.0) */
const TRUST_WEIGHTS = {
  successRate: 0.30,
  positiveRatings: 0.25,
  accountAge: 0.15,
  volume: 0.15,
  disputes: 0.15,
} as const;

/** Points deducted per lost dispute (from a base of 100) */
const DISPUTE_PENALTY_PER_LOSS = 33;
```

Then replace lines 69-76:
```typescript
const disputePenalty = Math.max(0, 100 - disputesLost * DISPUTE_PENALTY_PER_LOSS);

let score = Math.floor(
  successRate * TRUST_WEIGHTS.successRate +
  positiveRatingRatio * TRUST_WEIGHTS.positiveRatings +
  ageFactor * TRUST_WEIGHTS.accountAge +
  volumeFactor * TRUST_WEIGHTS.volume +
  disputePenalty * TRUST_WEIGHTS.disputes,
```

- [ ] **Step 3: Run type-check and tests**

Run: `cd aimeat && npx tsc --noEmit && pnpm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/routes/agents.ts src/services/trust.ts
git commit -m "refactor: extract magic numbers to named constants in agents and trust scoring"
```

---

### Task 13: Consolidate CSS Badge Variants

**Files:**
- Modify: `public/css/views/admin.css:127-148`

- [ ] **Step 1: Replace 22 badge rules with 6 semantic classes + aliases**

Replace the badge variant block (lines 127-148) with:

```css
/* Badge semantic colors */
.adm-badge--success { background: #16a34a22; color: #22c55e; border: 1px solid #16a34a55; }
.adm-badge--warning { background: #ca8a0422; color: #eab308; border: 1px solid #ca8a0455; }
.adm-badge--danger  { background: #dc262622; color: #ef4444; border: 1px solid #dc262655; }
.adm-badge--info    { background: #3b82f622; color: #3b82f6; border: 1px solid #3b82f655; }
.adm-badge--accent  { background: #a855f722; color: #a855f7; border: 1px solid #a855f755; }
.adm-badge--muted   { background: #33415522; color: #94a3b8; border: 1px solid #33415555; }

/* Badge name aliases → semantic colors */
.adm-badge-healthy,
.adm-badge-public,
.adm-badge-delivered,
.adm-badge-settled,
.adm-badge-owner      { background: #16a34a22; color: #22c55e; border: 1px solid #16a34a55; }

.adm-badge-watch,
.adm-badge-pending    { background: #ca8a0422; color: #eab308; border: 1px solid #ca8a0455; }

.adm-badge-danger,
.adm-badge-critical,
.adm-badge-cancelled,
.adm-badge-expired,
.adm-badge-disputed,
.adm-badge-error      { background: #dc262622; color: #ef4444; border: 1px solid #dc262655; }

.adm-badge-info,
.adm-badge-accepted,
.adm-badge-in_progress,
.adm-badge-operator,
.adm-badge-syncing    { background: #3b82f622; color: #3b82f6; border: 1px solid #3b82f655; }

.adm-badge-private,
.adm-badge-agent      { background: #a855f722; color: #a855f7; border: 1px solid #a855f755; }

.adm-badge-idle,
.adm-badge-general    { background: #33415522; color: #94a3b8; border: 1px solid #33415555; }
```

Note: The name-based aliases are kept for backward compatibility so no JS changes are needed. The new semantic classes (`--success`, etc.) are available for new code.

- [ ] **Step 2: Visual test — open admin dashboard and check all badge colors**

Navigate through tabs that show badges (overview, agents, work, federation). Confirm colors match the previous behavior.

- [ ] **Step 3: Commit**

```bash
git add public/css/views/admin.css
git commit -m "refactor(css): consolidate 22 badge variants into 6 semantic color groups"
```

---

### Task 14: Configure Test Coverage Reporting

**Files:**
- Modify: `aimeat/vitest.config.ts`
- Modify: `aimeat/package.json` (add coverage script)

- [ ] **Step 1: Install coverage provider**

Run: `cd aimeat && pnpm add -D @vitest/coverage-v8`

- [ ] **Step 2: Add coverage config to vitest.config.ts**

Replace the current content with:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts', 'test/integration/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/cli/**'],
      reporter: ['text', 'text-summary', 'lcov'],
      reportsDirectory: './coverage',
    },
  },
});
```

- [ ] **Step 3: Add coverage script to package.json**

In `package.json` scripts section, add:

```json
"test:coverage": "vitest run --coverage"
```

- [ ] **Step 4: Run coverage**

Run: `cd aimeat && pnpm test:coverage`

Review the output. Note which modules have low coverage for future test writing.

- [ ] **Step 5: Add coverage/ to .gitignore**

Append to `.gitignore`:

```
coverage/
```

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts package.json .gitignore pnpm-lock.yaml
git commit -m "feat(test): add vitest coverage reporting with v8 provider"
```

---

## Chunk 3: Low Priority Fixes and Cleanup

### Task 15: Remove Unused @prisma/client Dependency

**Files:**
- Modify: `aimeat/package.json:132-134`

- [ ] **Step 1: Remove optionalDependencies**

In `package.json`, remove the `optionalDependencies` block:

```json
"optionalDependencies": {
  "@prisma/client": "^6.19.2"
},
```

If this is the only optional dependency, remove the entire `optionalDependencies` key.

- [ ] **Step 2: Run pnpm install to update lockfile**

Run: `cd aimeat && pnpm install`

- [ ] **Step 3: Run type-check and tests**

Run: `cd aimeat && npx tsc --noEmit && pnpm test`
Expected: PASS (prisma is not imported anywhere)

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: remove unused @prisma/client optional dependency"
```

---

### Task 16: Fix require() in Build Script

**Files:**
- Modify: `aimeat/package.json:16`

- [ ] **Step 1: Replace require() with ESM-compatible approach**

In `package.json`, find the build script (line 16). It uses `node -e "const fs=require('fs');..."`.

Replace with a script that uses ESM:

```json
"build": "tsc && node --input-type=module -e \"import fs from 'fs';fs.cpSync('locales','dist/locales',{recursive:true});fs.cpSync('public','dist/public',{recursive:true});fs.cpSync('src/static','dist/static',{recursive:true});fs.cpSync('.env.example','dist/.env.example');\""
```

- [ ] **Step 2: Run build to verify**

Run: `cd aimeat && pnpm build`
Expected: Build completes successfully with all assets copied.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: use ESM import in build script instead of require()"
```

---

## Chunk 4: Deferred / Larger Refactoring (Separate Plans)

These items are documented here for tracking but each warrants its own dedicated plan due to scope:

### Deferred A: Decompose Oversized Files

**Scope:** Split 4 files (4,535 + 2,317 + 1,587 + 1,353 = 9,792 lines) into domain-specific modules.

**Recommended approach:**
- `sqlite/index.ts` → split into `sqlite/agents.ts`, `sqlite/memory.ts`, `sqlite/work.ts`, `sqlite/federation.ts`, `sqlite/boards.ts`, etc. with barrel `index.ts`
- `federation.ts` → split into `federation-peering.ts`, `federation-sync.ts`, `federation-genesis.ts`
- `admin.ts` → split into `admin-config.ts`, `admin-economy.ts`, `admin-federation.ts`, etc. (some already split)
- `server.ts` → extract middleware setup, route mounting, static file config into separate modules

**Estimated effort:** Large (1-2 days). Create a separate plan for this.

### Deferred B: Migrate Inline Styles to CSS Classes

**Scope:** 60+ inline style attributes in `email-tab.js` + scattered instances in other tabs.

**Recommended approach:**
- Audit all inline `style=` in admin tabs
- Create CSS classes in `admin.css` with `adm-*` prefix
- Replace inline styles with class names
- Preserve the existing visual appearance

**Estimated effort:** Medium (half day). Can be done incrementally, tab by tab.

### Deferred C: Add Missing Unit Tests for Critical Paths

**Scope:** After enabling coverage reporting (Task 14), identify modules below 80% coverage.

**Priority test targets (based on audit):**
- Auth flow edge cases (anonymous mode, scope resolution)
- Wallet/morsel calculations (decimal precision)
- Federation sync conflict resolution
- Hook execution and retry logic

**Estimated effort:** Large (ongoing). Create a test improvement plan after reviewing coverage report.

---

## Execution Order Summary

| Order | Task | Priority | Effort | Files Changed |
|-------|------|----------|--------|---------------|
| 1 | Fix XSS in spa.html | Critical | 5 min | 1 |
| 2 | Document dangerouslySetInnerHTML | Medium | 10 min | 1 |
| 3 | Add fetch timeout | High | 10 min | 1 |
| 4 | Create Toast component | High | 15 min | 2 |
| 5 | Migrate alert() — small tabs | High | 20 min | 6 |
| 6 | Migrate alert() — medium tabs | High | 25 min | 7 |
| 7 | Migrate alert() — large tabs | High | 20 min | 2 |
| 8 | Log frontend silent catches | High | 15 min | 6 |
| 9 | Create fireHook helper | High | 20 min | 8 |
| 10 | Replace console.warn in auth | Low | 5 min | 1 |
| 11 | Add form validation | Medium | 15 min | 3 |
| 12 | Extract magic numbers | Low | 10 min | 2 |
| 13 | Consolidate CSS badges | Low | 10 min | 1 |
| 14 | Configure test coverage | Medium | 15 min | 3 |
| 15 | Remove unused prisma dep | Low | 5 min | 2 |
| 16 | Fix require() in build script | Low | 5 min | 1 |

**Total immediate work:** 16 tasks across ~47 files
**Deferred refactoring:** 3 items requiring separate plans
