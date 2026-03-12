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

## Chunk 3: Low Priority Fixes and Cleanup

### Task 14: Remove Unused @prisma/client Dependency

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

### Task 15: Fix require() in Build Script

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

## Chunk 4: Safety Net Tests (BEFORE Refactoring)

> **Principle:** Write tests first that prove current behavior works. Run them after each refactoring task. If they fail, the refactoring broke something — fix before continuing.

### Task 16: Configure Test Coverage Reporting

**Moved here from Chunk 2 — coverage data informs which tests to write.**

**Files:**
- Modify: `vitest.config.ts`
- Modify: `package.json` (add coverage script)

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

- [ ] **Step 4: Run coverage and review baseline**

Run: `cd aimeat && pnpm test:coverage`

Note the baseline numbers — especially for modules we're about to refactor:
- `src/storage/providers/sqlite/index.ts`
- `src/routes/federation.ts`
- `src/routes/admin.ts`
- `src/server.ts`
- `src/auth/middleware.ts`
- `src/services/morsel.ts`
- `src/services/hooks.ts`

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

### Task 17: Write Storage CRUD Safety Net Tests

**Purpose:** These tests prove every SQLite storage method works correctly BEFORE we split the file. After the split (Task 22), we run these same tests — if they pass, the split was clean.

**Files:**
- Create: `test/unit/storage-safety-net.test.ts`

- [ ] **Step 1: Write owner + agent CRUD tests**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';

const uid = () => Math.random().toString(36).slice(2, 10);
const ts = () => new Date().toISOString();

describe('Storage Safety Net — Owner & Agent', () => {
  let storage: SqliteStorage;
  beforeEach(() => { storage = new SqliteStorage(':memory:'); });

  it('create + get + list + delete owner', async () => {
    const name = `owner-${uid()}`;
    const created = await storage.createOwner({ name, publicKey: 'dGVzdA==', roles: ['owner'], createdAt: ts() });
    expect(created.name).toBe(name);

    const found = await storage.getOwner(name);
    expect(found).not.toBeNull();
    expect(found!.name).toBe(name);

    const list = await storage.listOwners();
    expect(list.some(o => o.name === name)).toBe(true);

    await storage.deleteOwner(name);
    expect(await storage.getOwner(name)).toBeNull();
  });

  it('create + get + list + delete agent', async () => {
    const ownerName = `owner-${uid()}`;
    await storage.createOwner({ name: ownerName, publicKey: 'dGVzdA==', roles: ['owner'], createdAt: ts() });

    const gaii = `agent-${uid()}#${ownerName}@node`;
    const created = await storage.createAgent({
      name: `agent-${uid()}`, owner: ownerName, gaii, capabilities: [],
      publicKey: 'dGVzdA==', trustScore: 50, morselBalance: 100,
      createdAt: ts(), lastSeen: ts(),
    });
    expect(created.gaii).toBe(gaii);

    const found = await storage.getAgent(gaii);
    expect(found).not.toBeNull();

    const byOwner = await storage.getAgentsByOwner(ownerName);
    expect(byOwner.length).toBeGreaterThanOrEqual(1);

    await storage.deleteAgent(gaii);
    expect(await storage.getAgent(gaii)).toBeNull();
  });
});
```

- [ ] **Step 2: Write memory CRUD tests**

```typescript
describe('Storage Safety Net — Memory', () => {
  let storage: SqliteStorage;
  beforeEach(() => { storage = new SqliteStorage(':memory:'); });

  it('set + get + list + search + delete memory', async () => {
    const agentGaii = 'agent#alice@node';
    await storage.setMemory({
      key: 'profile.bio', ownerGaii: agentGaii, value: { text: 'hello' },
      visibility: 'public', tags: ['profile'], ttlHours: null,
      version: 1, createdAt: ts(), updatedAt: ts(),
    });

    const found = await storage.getMemory('profile.bio', agentGaii);
    expect(found).not.toBeNull();
    expect(found!.value).toEqual({ text: 'hello' });

    const list = await storage.listMemory(agentGaii);
    expect(list.length).toBe(1);

    const deleted = await storage.deleteMemory('profile.bio', agentGaii);
    expect(deleted).toBe(true);
    expect(await storage.getMemory('profile.bio', agentGaii)).toBeNull();
  });
});
```

- [ ] **Step 3: Write work queue + wallet tests**

```typescript
describe('Storage Safety Net — Work & Wallet', () => {
  let storage: SqliteStorage;
  beforeEach(() => { storage = new SqliteStorage(':memory:'); });

  it('create + get + update work', async () => {
    const work = await storage.createWork({
      trackingCode: `tc-${uid()}`, requesterGaii: 'req#a@n', providerGaii: 'prov#b@n',
      actionId: 'act-1', status: 'pending', cost: 10, payload: {},
      createdAt: ts(), updatedAt: ts(),
    });
    expect(work.status).toBe('pending');

    const found = await storage.getWork(work.trackingCode);
    expect(found).not.toBeNull();

    await storage.updateWork(work.trackingCode, { status: 'in_progress' });
    const updated = await storage.getWork(work.trackingCode);
    expect(updated!.status).toBe('in_progress');
  });
});
```

- [ ] **Step 4: Write board, consent, dispute, organism tests**

Cover the remaining major domains: boards (create board + post), consent (create + check), disputes (create + get), organisms (create + list + delete).

- [ ] **Step 5: Run tests to establish baseline**

Run: `cd aimeat && pnpm test`
Expected: ALL pass. Record the count — this is our safety baseline.

- [ ] **Step 6: Commit**

```bash
git add test/unit/storage-safety-net.test.ts
git commit -m "test(storage): add CRUD safety net tests for all major storage domains"
```

---

### Task 18: Write Auth Middleware Safety Net Tests

**Files:**
- Create: `test/unit/auth-middleware.test.ts`

- [ ] **Step 1: Write scope resolution tests**

```typescript
import { describe, it, expect } from 'vitest';
// Test cases:
// - Agent with exact scope passes
// - Agent with domain wildcard (e.g., memory:*) passes
// - Agent without required scope is denied
// - Multiple required scopes all checked
```

- [ ] **Step 2: Write role hierarchy tests**

```typescript
// Test cases:
// - Operator can access owner-level endpoints
// - Owner cannot access operator-level endpoints
// - Agent cannot access owner-level endpoints
// - First owner gets operator role
```

- [ ] **Step 3: Write token revocation tests**

```typescript
// Test cases:
// - Revoked token is rejected
// - Valid token passes after revocation cache miss
```

- [ ] **Step 4: Run tests**

Run: `cd aimeat && pnpm test`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add test/unit/auth-middleware.test.ts
git commit -m "test(auth): add safety net tests for scope, roles, and token revocation"
```

---

### Task 19: Write Hook Execution Safety Net Tests

**Files:**
- Create: `test/unit/hooks.test.ts`

- [ ] **Step 1: Write hook dispatch tests**

```typescript
// Test cases:
// - Hook fires for registered event
// - Hook does not fire for unregistered event
// - Multiple hooks for same event all fire
// - Hook payload is correctly passed
```

- [ ] **Step 2: Write error handling tests**

```typescript
// Test cases (will also validate fireHook from Task 9):
// - Failed hook does not throw
// - Hook with invalid URL is handled gracefully
```

- [ ] **Step 3: Run tests**

Run: `cd aimeat && pnpm test`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add test/unit/hooks.test.ts
git commit -m "test(hooks): add safety net tests for hook dispatch and error handling"
```

---

### Task 20: Write Wallet/Morsel Calculation Safety Net Tests

**Files:**
- Modify or create: `test/unit/morsel.test.ts` (may already exist — extend it)

- [ ] **Step 1: Test balance operations**

```typescript
// Test cases:
// - Debit reduces balance correctly
// - Credit increases balance correctly
// - Transfer preserves total supply
// - Negative balance is prevented
```

- [ ] **Step 2: Test escrow flows**

```typescript
// Test cases:
// - Escrow hold reduces available balance
// - Release escrow transfers to provider
// - Cancel escrow returns to requester
// - Double-release is rejected
```

- [ ] **Step 3: Run all tests — record new baseline**

Run: `cd aimeat && pnpm test`
Expected: All pass. This is the final safety net baseline before refactoring.

- [ ] **Step 4: Commit**

```bash
git add test/unit/morsel.test.ts
git commit -m "test(wallet): add safety net tests for balance ops and escrow flows"
```

---

## Chunk 5: Decompose Oversized Files (Tests Protect Us)

> **After each task in this chunk:** Run `cd aimeat && npx tsc --noEmit && pnpm test`. ALL safety net tests from Chunk 4 must still pass. If any fail, the split broke something — fix before continuing.

### Task 21: Split federation.ts into Domain Routers (run safety net tests after)

**Files:**
- Modify: `src/routes/federation.ts` (2,317 lines → keep as thin barrel)
- Create: `src/routes/federation-peer.ts`
- Create: `src/routes/federation-sync.ts`
- Create: `src/routes/federation-settlements.ts`
- Create: `src/routes/federation-genesis.ts`
- Create: `src/services/federation-helpers.ts`
- Modify: `src/server.ts` (update route imports)

**Current structure of federation.ts:**

| Domain | Lines | Routes |
|--------|-------|--------|
| Keyword matching helpers | 21–54 | 4 helper functions |
| Peer key cache | 55–144 | `performKeyExchange()` |
| Peer directory & discovery | 150–195 | `GET /v1/federation/directory` |
| Peer introduction | 197–385 | `POST /v1/federation/peer/introduce` |
| Key exchange | 387–465 | `POST /v1/federation/key-exchange` |
| Heartbeat | 467–550 | `POST /v1/federation/heartbeat` |
| Peering requests CRUD | 551–765 | 4 endpoints |
| Catalogue sync & replication | 766–1068 | `POST /v1/federation/replicate`, `/catalogue-sync` |
| Cross-node query routing | 1068–1394 | `POST /v1/federation/query` |
| Signed settlements | 1394–1656 | `POST /v1/federation/settlement` |
| Genesis peering | 1656–2288 | 4 genesis endpoints |
| Organism reputation | 2288–2317 | `GET /v1/federation/organisms/reputation` |

- [ ] **Step 1: Extract helpers to federation-helpers.ts**

Create `src/services/federation-helpers.ts` with:
- `matchesKeyword()`, `matchesActionKeyword()`, `matchesGenesisKeyword()`, `matchesLocation()` (lines 21–54)
- Peer key cache class and `performKeyExchange()` (lines 55–144)

- [ ] **Step 2: Create federation-peer.ts**

Extract lines 150–765 into `src/routes/federation-peer.ts`:
- `GET /v1/federation/directory`
- `POST /v1/federation/peer/introduce`
- `POST /v1/federation/key-exchange`
- `POST /v1/federation/heartbeat`
- Peering request CRUD (4 endpoints)

Export as `federationPeerRouter(config, storage)`.

- [ ] **Step 3: Create federation-sync.ts**

Extract lines 766–1394 into `src/routes/federation-sync.ts`:
- `POST /v1/federation/replicate`
- `POST /v1/federation/catalogue-sync`
- `POST /v1/federation/query`

Export as `federationSyncRouter(config, storage)`.

- [ ] **Step 4: Create federation-settlements.ts**

Extract lines 1394–1656 into `src/routes/federation-settlements.ts`:
- `POST /v1/federation/settlement`

Export as `federationSettlementsRouter(config, storage)`.

- [ ] **Step 5: Create federation-genesis.ts**

Extract lines 1656–2317 into `src/routes/federation-genesis.ts`:
- Genesis peering CRUD (4 endpoints)
- Organism reputation query

Export as `federationGenesisRouter(config, storage)`.

- [ ] **Step 6: Update federation.ts as barrel**

Replace `federation.ts` content with a barrel that imports and re-exports all sub-routers, or create a composite `federationRouter()` that mounts all sub-routers.

- [ ] **Step 7: Update server.ts imports**

If the composite approach is used, no changes needed in `server.ts`. If individual routers are exported, update `server.ts` to mount each.

- [ ] **Step 8: Run type-check and tests**

Run: `cd aimeat && npx tsc --noEmit && pnpm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/routes/federation.ts src/routes/federation-peer.ts src/routes/federation-sync.ts src/routes/federation-settlements.ts src/routes/federation-genesis.ts src/services/federation-helpers.ts src/server.ts
git commit -m "refactor: split federation.ts (2,317 LOC) into 4 domain routers + shared helpers"
```

---

### Task 22: Split admin.ts into Domain Routers (run safety net tests after)

**Files:**
- Modify: `src/routes/admin.ts` (1,587 lines → keep setup-only ~250 lines)
- Create: `src/routes/admin-config.ts`
- Create: `src/routes/admin-monitoring.ts`
- Create: `src/routes/admin-agents.ts`
- Create: `src/routes/admin-maintenance.ts`
- Create: `src/routes/admin-economy.ts`
- Modify: `src/server.ts` (add new router imports)

**Current structure of admin.ts:**

| Domain | Lines | What stays / moves |
|--------|-------|-------------------|
| Setup pages (password-protected) | 96–286 | **Stays** in admin.ts |
| Dashboard & UI | 287–481 | **Stays** in admin.ts |
| Work & federation monitoring | 484–603 | → `admin-monitoring.ts` |
| Config management + Consul | 602–831 | → `admin-config.ts` |
| Agent & CORS management | 832–887 | → `admin-agents.ts` |
| Stats, backup, restore, roles | 888–987 | → `admin-monitoring.ts` |
| Hooks management | 1012–1068 | → `admin-maintenance.ts` |
| Maintenance mode | 1069–1147 | → `admin-maintenance.ts` |
| Morsel minting | 1094–1147 | → `admin-economy.ts` |
| Federation trust & health | 1148–1284 | → `admin-monitoring.ts` |

**Note:** `admin-features.ts`, `admin-extensions.ts`, `admin-scheduler.ts`, `admin-prompts.ts` already exist as prior extractions.

- [ ] **Step 1: Create admin-config.ts**

Extract config management routes (lines 602–831):
- `GET/PUT /v1/admin/config`
- `DELETE /v1/admin/config/:path`
- `GET /v1/admin/consul`
- `POST /v1/admin/consul/export`
- `POST /v1/admin/consul/import`

Export as `adminConfigRouter(config, storage)`.

- [ ] **Step 2: Create admin-monitoring.ts**

Extract monitoring/stats routes:
- Work queue monitoring (lines 484–603)
- Stats, backup, restore, role grants (lines 888–987)
- Federation trust advisories, sync health, relay earnings (lines 1148–1284)

Export as `adminMonitoringRouter(config, storage)`.

- [ ] **Step 3: Create admin-agents.ts**

Extract agent/CORS management (lines 832–887):
- `GET /v1/admin/agents`
- `PUT /v1/admin/agents/:gaii/cors`

Export as `adminAgentsRouter(config, storage)`.

- [ ] **Step 4: Create admin-maintenance.ts**

Extract hooks + maintenance mode (lines 1012–1147):
- Hooks CRUD
- Maintenance mode toggle

Export as `adminMaintenanceRouter(config, storage)`.

- [ ] **Step 5: Create admin-economy.ts**

Extract morsel minting (lines 1094–1147):
- `POST /v1/admin/mint`

Export as `adminEconomyRouter(config, storage)`.

- [ ] **Step 6: Clean up admin.ts**

Remove extracted sections. admin.ts should now contain only:
- Setup pages (`/v1/admin/setup/*`) — password-protected
- Dashboard & UI (`/v1/admin/dashboard`, `/v1/admin/ui`)

Should be ~250 lines.

- [ ] **Step 7: Update server.ts to mount new routers**

Add imports and `app.use()` calls for each new admin sub-router.

- [ ] **Step 8: Run type-check and tests**

Run: `cd aimeat && npx tsc --noEmit && pnpm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/routes/admin.ts src/routes/admin-config.ts src/routes/admin-monitoring.ts src/routes/admin-agents.ts src/routes/admin-maintenance.ts src/routes/admin-economy.ts src/server.ts
git commit -m "refactor: split admin.ts (1,587 LOC) into 5 domain routers, keep setup-only core"
```

---

### Task 23: Split sqlite/index.ts into Domain Repository Files (run safety net tests after)

**Files:**
- Modify: `src/storage/providers/sqlite/index.ts` (4,535 lines → thin barrel ~100 lines)
- Create: `src/storage/providers/sqlite/repos/` directory
- Create: ~15 domain repository files in that directory

**Current structure (37 domains, grouped into ~15 logical files):**

| New File | Domains | Lines (approx) |
|----------|---------|----------------|
| `repos/owner.ts` | Owners | 60–217 |
| `repos/agent.ts` | Agents | 219–354 |
| `repos/memory.ts` | Memory, Micro-Memory | 356–502, 1111–1169 |
| `repos/action.ts` | Actions | 504–608 |
| `repos/work.ts` | Work, Wallet Transactions | 610–732 |
| `repos/board.ts` | Boards, Board Subscriptions | 734–916 |
| `repos/auth.ts` | OTK, Node Key, Sessions, Token Revocation, Device Auth | 918–1012, various |
| `repos/dispute.ts` | Disputes, Appeals | 1014–1109, 2650–2719 |
| `repos/storage-file.ts` | Storage (Binary Files), Chunked Uploads | 1171–1327 |
| `repos/identity.ts` | GHII, Email Verifications, Personal Nodes | 1329–1710 |
| `repos/mailbox.ts` | Mailbox, Maintenance Mode | 1712–1842 |
| `repos/consent.ts` | Consent Layer, Schema Locking | 1844–2070 |
| `repos/service-manifest.ts` | CSM, MSM | 2072–2215 |
| `repos/community.ts` | Flags, Matches, Organisms, Memberships, Join Requests | 2217–2648 |
| `repos/marketplace.ts` | Marketplace (Listings + Purchases) | 2721–2882 |
| `repos/federation.ts` | Peering Requests, Genesis Peers, Organism Reputation, Replication | 1235–1295, 2977–3068 |
| `repos/misc.ts` | Push, Trusted Issuers, Realtime, Site ChangeLog, Extensions, etc. | remaining |

- [ ] **Step 1: Create repos/ directory**

```bash
mkdir -p src/storage/providers/sqlite/repos
```

- [ ] **Step 2: Create a shared helpers file**

Create `src/storage/providers/sqlite/repos/_helpers.ts` with:
- The `db` type reference
- Common deserialize patterns
- Shared imports (Database type from better-sqlite3)

Each repo file will import the Database type and receive the `db` instance via constructor or function parameter.

- [ ] **Step 3: Extract owner.ts (smallest, test the pattern)**

Move lines 60–217 from `index.ts` to `repos/owner.ts`. Export functions that accept `db` as first parameter:

```typescript
import Database from 'better-sqlite3';

export function createOwner(db: Database.Database, ...args) { ... }
export function getOwner(db: Database.Database, ...args) { ... }
// etc.
```

- [ ] **Step 4: Run type-check to validate the pattern**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Extract remaining repo files (batch)**

Repeat Step 3 for all 15 domain files. Each file:
1. Gets the relevant code block from index.ts
2. Exports functions with `db` as first parameter
3. Imports needed types from the storage interface

- [ ] **Step 6: Update index.ts as barrel**

Replace index.ts with a thin barrel that:
1. Creates the database connection
2. Imports all repo functions
3. Binds them to the db instance
4. Exports the composite `Storage` implementation

```typescript
import Database from 'better-sqlite3';
import * as ownerRepo from './repos/owner.js';
import * as agentRepo from './repos/agent.js';
// ... etc

export function createSqliteStorage(dbPath: string): Storage {
  const db = new Database(dbPath);
  return {
    createOwner: (...args) => ownerRepo.createOwner(db, ...args),
    getOwner: (...args) => ownerRepo.getOwner(db, ...args),
    // ... all methods
  };
}
```

- [ ] **Step 7: Run type-check and tests**

Run: `cd aimeat && npx tsc --noEmit && pnpm test`
Expected: PASS — all 517 tests should pass since the interface hasn't changed.

- [ ] **Step 8: Commit**

```bash
git add src/storage/providers/sqlite/
git commit -m "refactor: split sqlite/index.ts (4,535 LOC) into 15 domain repository files"
```

---

### Task 24: Extract server.ts Bootstrap Modules (run safety net tests after)

**Files:**
- Modify: `src/server.ts` (1,353 lines → ~120 lines orchestrator)
- Create: `src/server-bootstrap/static-files.ts`
- Create: `src/server-bootstrap/config-init.ts`
- Create: `src/server-bootstrap/service-init.ts`
- Create: `src/server-bootstrap/middleware-guards.ts`
- Create: `src/server-bootstrap/routes-loader.ts`
- Create: `src/services/core-jobs.ts`
- Create: `src/services/job-seeding.ts`

**Current structure of server.ts:**

| Section | Lines | Extract to |
|---------|-------|-----------|
| Imports | 1–112 | Stay (moved to each module) |
| Type definitions | 113–127 | Stay |
| Express setup | 129–156 | Stay |
| Static file serving + CSP | 157–256 | `server-bootstrap/static-files.ts` |
| Global middleware | 259–311 | Stay (small, core) |
| Storage & config init | 313–388 | `server-bootstrap/config-init.ts` |
| Service initialization | 390–500 | `server-bootstrap/service-init.ts` |
| Middleware guards | 502–603 | `server-bootstrap/middleware-guards.ts` |
| Route mounting (40+ app.use) | 604–802 | `server-bootstrap/routes-loader.ts` |
| Error handler | 803–826 | Stay |
| Core job handlers | 831–986 | `services/core-jobs.ts` |
| Seed scheduled jobs | 987–1300 | `services/job-seeding.ts` |
| Node key helpers | 1301–1353 | Move to `auth/node-keys.ts` |

- [ ] **Step 1: Create server-bootstrap/ directory**

```bash
mkdir -p src/server-bootstrap
```

- [ ] **Step 2: Extract static-files.ts**

Move lines 157–256 to `src/server-bootstrap/static-files.ts`. Export a function:

```typescript
export function setupStaticFiles(app: Express, config: AimeatConfig): void { ... }
```

- [ ] **Step 3: Extract config-init.ts**

Move lines 313–388 to `src/server-bootstrap/config-init.ts`. Export:

```typescript
export async function initializeConfig(config: AimeatConfig): Promise<{ storage: Storage; configSources: ConfigSources }> { ... }
```

- [ ] **Step 4: Extract service-init.ts**

Move lines 390–500 to `src/server-bootstrap/service-init.ts`. Export:

```typescript
export async function initializeServices(config: AimeatConfig, storage: Storage): Promise<void> { ... }
```

- [ ] **Step 5: Extract middleware-guards.ts**

Move lines 502–603 to `src/server-bootstrap/middleware-guards.ts`. Export:

```typescript
export function setupGuards(app: Express, config: AimeatConfig, storage: Storage): void { ... }
```

- [ ] **Step 6: Extract routes-loader.ts**

Move lines 604–802 (40+ `app.use()` calls) to `src/server-bootstrap/routes-loader.ts`. Export:

```typescript
export function mountRoutes(app: Express, config: AimeatConfig, storage: Storage): void { ... }
```

This file takes all the route imports with it.

- [ ] **Step 7: Extract core-jobs.ts and job-seeding.ts**

Move lines 831–986 to `src/services/core-jobs.ts`.
Move lines 987–1300 to `src/services/job-seeding.ts`.

- [ ] **Step 8: Move node key helpers**

Move lines 1301–1353 to `src/auth/node-keys.ts` (or append to existing auth module).

- [ ] **Step 9: Update server.ts as orchestrator**

server.ts should now be ~120 lines:

```typescript
import { setupStaticFiles } from './server-bootstrap/static-files.js';
import { initializeConfig } from './server-bootstrap/config-init.js';
import { initializeServices } from './server-bootstrap/service-init.js';
import { setupGuards } from './server-bootstrap/middleware-guards.js';
import { mountRoutes } from './server-bootstrap/routes-loader.js';

export async function createServer(config: AimeatConfig): Promise<ServerResult> {
  const app = express();
  // trust proxy, compression
  setupStaticFiles(app, config);
  // global middleware (CORS, rate limit, etc.)
  const { storage, configSources } = await initializeConfig(config);
  await initializeServices(config, storage);
  setupGuards(app, config, storage);
  mountRoutes(app, config, storage);
  // error handler
  return { app, storage, configSources };
}
```

- [ ] **Step 10: Run type-check and tests**

Run: `cd aimeat && npx tsc --noEmit && pnpm test`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add src/server.ts src/server-bootstrap/ src/services/core-jobs.ts src/services/job-seeding.ts src/auth/node-keys.ts
git commit -m "refactor: split server.ts (1,353 LOC) into bootstrap modules + job services"
```

---

## Chunk 6: Inline Style Migration to CSS Classes

### Task 25: Add CSS Utility Classes to admin.css

**Files:**
- Modify: `public/css/views/admin.css`

- [ ] **Step 1: Add form control classes**

Append to `admin.css`:

```css
/* ── Form Controls ── */
.adm-input {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  color: var(--text-bright);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: .85rem;
  font-family: inherit;
}
.adm-input:focus { border-color: var(--accent); outline: none; }
.adm-input-full { width: 100%; }

.adm-textarea {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  color: var(--text-bright);
  padding: 10px;
  border-radius: 6px;
  font-family: 'SF Mono', Consolas, monospace;
  font-size: .8rem;
  resize: vertical;
  line-height: 1.5;
  tab-size: 2;
}
```

- [ ] **Step 2: Add flexbox utility classes**

```css
/* ── Flex Utilities ── */
.adm-flex       { display: flex; gap: 8px; }
.adm-flex-col   { display: flex; flex-direction: column; gap: 8px; }
.adm-flex-between { display: flex; justify-content: space-between; align-items: center; }
.adm-flex-center  { display: flex; align-items: center; gap: 8px; }
.adm-flex-wrap    { display: flex; flex-wrap: wrap; gap: 8px; }
```

- [ ] **Step 3: Add text utility classes**

```css
/* ── Text Utilities ── */
.adm-text-xs  { font-size: .7rem; }
.adm-text-sm  { font-size: .8rem; }
.adm-text-base { font-size: .85rem; }
.adm-text-dim  { color: var(--text-dim); }
.adm-text-bright { color: var(--text-bright); }
.adm-text-accent { color: var(--accent); }
.adm-text-error  { color: #ef4444; }
.adm-text-success { color: #22c55e; }
.adm-text-mono { font-family: 'SF Mono', Consolas, monospace; font-size: .8rem; }
```

- [ ] **Step 4: Add spacing utility classes**

```css
/* ── Spacing Utilities ── */
.adm-gap-xs { gap: 4px; }
.adm-gap-sm { gap: 8px; }
.adm-gap-md { gap: 12px; }
.adm-gap-lg { gap: 16px; }

.adm-mb-xs { margin-bottom: 4px; }
.adm-mb-sm { margin-bottom: 8px; }
.adm-mb-md { margin-bottom: 12px; }
.adm-mb-lg { margin-bottom: 16px; }

.adm-mt-sm { margin-top: 8px; }
.adm-mt-md { margin-top: 12px; }
.adm-mt-lg { margin-top: 16px; }
```

- [ ] **Step 5: Add modal overlay class**

```css
/* ── Modal ── */
.adm-modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.6);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
}
```

- [ ] **Step 6: Commit**

```bash
git add public/css/views/admin.css
git commit -m "feat(css): add utility classes for forms, flex, text, spacing, and modals"
```

---

### Task 26: Migrate Inline Styles — Top 5 Offender Tabs

**Files (highest inline style counts):**
- Modify: `public/views/admin/services-tab.js` (113 inline styles)
- Modify: `public/views/admin/federation-tab.js` (90 inline styles)
- Modify: `public/views/admin/email-tab.js` (57 inline styles)
- Modify: `public/views/admin/push-tab.js` (45 inline styles)
- Modify: `public/views/admin/msm-tab.js` (44 inline styles)

For each file, apply this systematic process:

- [ ] **Step 1: Replace flex layout inline styles**

Find patterns like:
```javascript
style="display:flex;gap:8px;margin-bottom:12px"
```
Replace with:
```javascript
class="adm-flex adm-mb-md"
```

Common mappings:
- `display:flex;gap:8px` → `class="adm-flex"`
- `display:flex;flex-direction:column;gap:8px` → `class="adm-flex-col"`
- `display:flex;justify-content:space-between;align-items:center` → `class="adm-flex-between"`
- `display:flex;align-items:center;gap:8px` → `class="adm-flex-center"`

- [ ] **Step 2: Replace text styling inline styles**

Find patterns like:
```javascript
style="color:var(--text-dim);font-size:.85rem"
```
Replace with:
```javascript
class="adm-text-base adm-text-dim"
```

- [ ] **Step 3: Replace spacing inline styles**

Find patterns like:
```javascript
style="margin-bottom:12px"
```
Replace with:
```javascript
class="adm-mb-md"
```

- [ ] **Step 4: Replace input/textarea inline styles**

Find patterns like:
```javascript
style="background:var(--glass-bg);border:1px solid var(--glass-border);color:var(--text-bright);padding:8px 12px;border-radius:6px"
```
Replace with:
```javascript
class="adm-input adm-input-full"
```

- [ ] **Step 5: Replace modal overlay inline styles**

Find patterns like:
```javascript
style="position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:1000"
```
Replace with:
```javascript
class="adm-modal-overlay"
```

- [ ] **Step 6: Visual test each tab**

Open each tab in the admin dashboard. Verify visual appearance matches the original.

- [ ] **Step 7: Commit**

```bash
git add public/views/admin/services-tab.js public/views/admin/federation-tab.js public/views/admin/email-tab.js public/views/admin/push-tab.js public/views/admin/msm-tab.js
git commit -m "refactor(admin): migrate inline styles to CSS utility classes in top 5 tabs"
```

---

### Task 27: Migrate Inline Styles — Remaining Tabs

**Files (lower inline style counts, 2–39 each):**
- Modify: `public/views/admin/knowledge-tab.js` (39)
- Modify: `public/views/admin/csm-tab.js` (35)
- Modify: `public/views/admin/chat-instances-tab.js` (28)
- Modify: `public/views/admin/cors-tab.js` (27)
- Modify: `public/views/admin/portal-tab.js` (23)
- Modify: `public/views/admin/prompts-tab.js` (22)
- Modify: `public/views/admin/maintenance-tab.js` (15)
- Modify: `public/views/admin/config-tab.js` (15)
- Modify: `public/views/admin/boards-tab.js` (15)
- Modify: `public/views/admin/stats-tab.js` (11)
- Modify: `public/views/admin/economy-tab.js` (11)
- Modify: `public/views/admin/consul-tab.js` (8)
- Modify: `public/views/admin/agents-tab.js` (8)
- Modify: `public/views/admin/overview-tab.js` (6)
- Modify: remaining tabs with <6 inline styles each

Follow the same replacement patterns from Task 22.

- [ ] **Step 1: Batch migrate tabs with 15+ inline styles (knowledge, csm, chat-instances, cors, portal, prompts)**

Apply flex, text, spacing, and input class replacements.

- [ ] **Step 2: Batch migrate tabs with 6–14 inline styles (maintenance, config, boards, stats, economy, consul, agents, overview)**

Apply the same replacements.

- [ ] **Step 3: Batch migrate tabs with <6 inline styles (genesis, ghii, work, matching, hooks, directory, realtime, owners, scheduler, actions)**

These have minimal inline styles — quick pass.

- [ ] **Step 4: Visual test all tabs**

Walk through every admin tab. Confirm no visual regressions.

- [ ] **Step 5: Commit**

```bash
git add public/views/admin/
git commit -m "refactor(admin): migrate remaining inline styles to CSS utility classes"
```

---

---

## Execution Order Summary

> **Key principle:** Tests BEFORE refactoring. Chunk 4 writes safety nets, Chunk 5 refactors with those tests as guards.

| Order | Task | Chunk | Purpose | Files |
|-------|------|-------|---------|-------|
| **Chunk 1: Critical & High Priority Fixes** | | | | |
| 1 | Fix XSS in spa.html | 1 | Security | 1 |
| 2 | Document dangerouslySetInnerHTML | 1 | Security | 1 |
| 3 | Add fetch timeout | 1 | Resilience | 1 |
| 4 | Create Toast component | 1 | Infrastructure | 2 |
| 5 | Migrate alert() — small tabs | 1 | UX | 6 |
| 6 | Migrate alert() — medium tabs | 1 | UX | 7 |
| 7 | Migrate alert() — large tabs | 1 | UX | 2 |
| 8 | Log frontend silent catches | 1 | Debuggability | 6 |
| 9 | Create fireHook helper | 1 | Debuggability | 8 |
| **Chunk 2: Medium Priority** | | | | |
| 10 | Replace console.warn in auth | 2 | Consistency | 1 |
| 11 | Add form validation | 2 | UX | 3 |
| 12 | Extract magic numbers | 2 | Maintainability | 2 |
| 13 | Consolidate CSS badges | 2 | CSS cleanup | 1 |
| **Chunk 3: Low Priority Cleanup** | | | | |
| 14 | Remove unused prisma dep | 3 | Hygiene | 2 |
| 15 | Fix require() in build | 3 | ESM purity | 1 |
| **Chunk 4: Safety Net Tests (BEFORE refactoring)** | | | | |
| 16 | Configure test coverage | 4 | Infrastructure | 3 |
| 17 | Storage CRUD safety net tests | 4 | **Guard for Task 23** | 1 |
| 18 | Auth middleware safety net tests | 4 | **Guard for Tasks 21-24** | 1 |
| 19 | Hook execution safety net tests | 4 | **Guard for Task 9 + 24** | 1 |
| 20 | Wallet/morsel safety net tests | 4 | **Guard for Task 23** | 1 |
| **Chunk 5: Decompose Oversized Files (tests protect us)** | | | | |
| 21 | Split federation.ts → 4 routers | 5 | Decomposition | 7 |
| 22 | Split admin.ts → 5 routers | 5 | Decomposition | 7 |
| 23 | Split sqlite/index.ts → 15 repos | 5 | Decomposition | 17 |
| 24 | Extract server.ts → bootstrap modules | 5 | Decomposition | 9 |
| **Chunk 6: Inline Style Migration** | | | | |
| 25 | Add CSS utility classes | 6 | Infrastructure | 1 |
| 26 | Migrate inline styles — top 5 tabs | 6 | CSS cleanup | 5 |
| 27 | Migrate inline styles — remaining tabs | 6 | CSS cleanup | 20+ |

**Total: 27 tasks across 6 chunks, ~100+ files touched**

**Verification rule:** After every task in Chunks 5-6, run `cd aimeat && npx tsc --noEmit && pnpm test`. If safety net tests from Chunk 4 fail, the refactoring broke something — stop and fix before continuing.
