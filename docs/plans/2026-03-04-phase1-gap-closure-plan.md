# Phase 1 Gap Closure — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close 4 remaining Phase 1 gaps (web wizard, data wallet UI, memory flag integration, match view) to bring Phase 1 from ~76% to ~95%+.

**Architecture:** Backend changes are minimal (new setup route, flagCount in memory). Most work is client-side static HTML additions to existing files. Follows the no-SSR architecture rule.

**Tech Stack:** TypeScript/Express backend, static HTML/CSS/JS frontend, existing AIMEAT APIs.

**Design doc:** `docs/plans/2026-03-04-phase1-gap-closure-design.md`

---

### Task 1: Memory flag integration — storage + interface

**Files:**
- Modify: `aimeat/src/storage/interface.ts:31-41` (MemoryRecord interface)
- Modify: `aimeat/src/storage/interface.ts:607` (listMemory signature)
- Modify: `aimeat/src/storage/interface.ts:689` (searchMemory signature)
- Modify: `aimeat/src/storage/memory.ts:148` (listMemory implementation)
- Modify: `aimeat/src/storage/memory.ts:592` (searchMemory implementation)

**What to do:**

1. In `interface.ts`, add `flagCount` to `MemoryRecord`:
```typescript
export interface MemoryRecord {
  key: string;
  ownerGaii: string;
  value: unknown;
  visibility: 'private' | 'owner' | 'public';
  tags: string[];
  ttlHours: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  flagCount?: number;  // ADD THIS
}
```

2. Update `listMemory` and `searchMemory` signatures in the `Storage` interface to accept `maxFlags`:
```typescript
listMemory(ownerGaii: string, opts?: { prefix?: string; visibility?: string; tags?: string[]; maxFlags?: number }): Promise<MemoryRecord[]>;
searchMemory(ownerGaii: string, query: string, opts?: { visibility?: string; maxFlags?: number }): Promise<MemoryRecord[]>;
```

3. Add new method to `Storage` interface:
```typescript
incrementMemoryFlagCount(ownerGaii: string, key: string): Promise<void>;
```

4. In `memory.ts`, update `listMemory` to filter by `maxFlags`:
   - After existing filters, if `opts?.maxFlags !== undefined`, filter out records where `(r.flagCount ?? 0) > opts.maxFlags`

5. In `memory.ts`, update `searchMemory` similarly.

6. In `memory.ts`, add `incrementMemoryFlagCount` implementation:
```typescript
async incrementMemoryFlagCount(ownerGaii: string, key: string): Promise<void> {
  const record = await this.getMemory(ownerGaii, key);
  if (record) {
    record.flagCount = (record.flagCount ?? 0) + 1;
    await this.setMemory(record);
  }
}
```

7. Run `cd aimeat && npx tsc --noEmit` — fix any type errors in MongoDB storage if it exists.

8. Commit: `feat: add flagCount to MemoryRecord + maxFlags filter in storage`

---

### Task 2: Memory flag integration — routes + flags hook

**Files:**
- Modify: `aimeat/src/routes/memory.ts:144-184` (GET /v1/memory — add max_flags param)
- Modify: `aimeat/src/routes/memory.ts:186-212` (GET /v1/memory/search — add max_flags param)
- Modify: `aimeat/src/routes/flags.ts:55-76` (POST /v1/flags — increment memory flagCount)

**What to do:**

1. In `memory.ts` GET `/v1/memory` handler (~line 144):
   - Parse `const maxFlagsParam = req.query.max_flags as string | undefined;`
   - Convert: `const maxFlags = maxFlagsParam !== undefined ? parseInt(maxFlagsParam, 10) : undefined;`
   - Pass to storage: `storage.listMemory(gaii, { prefix, visibility, tags, maxFlags })`
   - Add `flagCount` to response items: `flagCount: r.flagCount ?? 0`

2. In `memory.ts` GET `/v1/memory/search` handler (~line 186):
   - Parse `max_flags` same way
   - Pass to storage: `storage.searchMemory(gaii, q, { visibility, maxFlags })`
   - Add `flagCount` to response results: `flagCount: r.flagCount ?? 0`

3. In `flags.ts` POST `/v1/flags` handler, after line 64 (`createdAt: now`), add memory flag count increment:
```typescript
// If flagging a memory entry, increment the memory's flag counter
if (targetType === 'memory' && targetId.includes('::')) {
  // targetId format: "ownerGaii::key"
  const [ownerGaii, ...keyParts] = targetId.split('::');
  const key = keyParts.join('::');
  await storage.incrementMemoryFlagCount(ownerGaii, key);
} else if (targetType === 'memory') {
  // targetId might just be the key — try with flaggedBy's owner context
  // Skip increment if we can't determine the owner
}
```

4. Run: `cd aimeat && npx tsc --noEmit`

5. Commit: `feat: add max_flags filter to memory endpoints + flag count hook`

---

### Task 3: Match view in hobbies.html

**Files:**
- Modify: `aimeat/public/hobbies.html` (add #matches view, nav link, translations)

**What to do:**

1. Add `#matches` to the hash routing logic (around line 1501-1515):
```javascript
else if (hash === 'matches') showView('matches');
```

2. Add a nav link for "Matches" that's visible when authenticated:
```html
<a href="#matches" class="nav-link matches-link" style="display:none">🤝 Matches</a>
```
Show/hide the `.matches-link` based on auth state.

3. Add translations to both en/fi objects:
```javascript
// English
"matches.title": "Your Matches",
"matches.subtitle": "People who share your interests",
"matches.login_required": "Log in to see your matches",
"matches.no_matches": "No matches found yet. Try adding more interests to your profile!",
"matches.shared": "shared interests",
"matches.loading": "Finding your matches...",

// Finnish
"matches.title": "Osumat",
"matches.subtitle": "Ihmiset joilla on samoja kiinnostuksen kohteita",
"matches.login_required": "Kirjaudu sisään nähdäksesi osumasi",
"matches.no_matches": "Ei osumia vielä. Kokeile lisätä kiinnostuksia profiiliisi!",
"matches.shared": "yhteistä kiinnostusta",
"matches.loading": "Etsitään osumia...",
```

4. Add `showMatches()` function:
   - Check auth; if not logged in, show login prompt
   - Fetch user's interests: `GET /v1/memory/profile.{owner}.interests` (with auth header)
   - For each interest, fetch `GET /v1/catalogue/directory?interest={interest}`
   - Merge all results into a Map (keyed by GHII), counting shared interests
   - Exclude self
   - Sort by shared interest count (descending)
   - Render profile cards with shared interest count badge

5. Add the `view-matches` HTML container (hidden by default, shown by `showView('matches')`).

6. Run: `cd aimeat && npx tsc --noEmit` (just to verify nothing else broke)

7. Commit: `feat: add matches view to hobby directory`

---

### Task 4: Data Wallet tab in profile.html

**Files:**
- Modify: `aimeat/public/profile.html` (add Data Wallet tab + panel)

**What to do:**

1. Add translations to both en/fi objects:
```javascript
// English
"profile.tabs.dataWallet": "Data Wallet",
"wallet.consents.title": "Active Consents",
"wallet.consents.empty": "No active consents",
"wallet.consents.pattern": "Data Pattern",
"wallet.consents.recipient": "Recipient",
"wallet.consents.purpose": "Purpose",
"wallet.consents.scope": "Scope",
"wallet.consents.granted": "Granted",
"wallet.consents.expires": "Expires",
"wallet.consents.revoke": "Revoke",
"wallet.consents.never": "Never",
"wallet.audit.title": "Audit Report",
"wallet.audit.empty": "No data access events found",
"wallet.audit.who": "Accessed By",
"wallet.audit.what": "Data Key",
"wallet.audit.when": "When",
"wallet.audit.purpose": "Purpose",
"wallet.audit.days": "days",
"wallet.export.title": "GDPR Export",
"wallet.export.description": "Download all your data as a JSON file",
"wallet.export.button": "Download All My Data",
"wallet.export.downloading": "Preparing export...",

// Finnish equivalents
"profile.tabs.dataWallet": "Tietolompakko",
"wallet.consents.title": "Aktiiviset suostumukset",
"wallet.consents.empty": "Ei aktiivisia suostumuksia",
"wallet.consents.pattern": "Datakuvio",
"wallet.consents.recipient": "Vastaanottaja",
"wallet.consents.purpose": "Tarkoitus",
"wallet.consents.scope": "Laajuus",
"wallet.consents.granted": "Myönnetty",
"wallet.consents.expires": "Vanhenee",
"wallet.consents.revoke": "Peru",
"wallet.consents.never": "Ei koskaan",
"wallet.audit.title": "Auditointiraportti",
"wallet.audit.empty": "Ei datankäyttötapahtumia",
"wallet.audit.who": "Käyttäjä",
"wallet.audit.what": "Data-avain",
"wallet.audit.when": "Milloin",
"wallet.audit.purpose": "Tarkoitus",
"wallet.audit.days": "päivää",
"wallet.export.title": "GDPR-vienti",
"wallet.export.description": "Lataa kaikki tietosi JSON-tiedostona",
"wallet.export.button": "Lataa kaikki tietoni",
"wallet.export.downloading": "Valmistellaan vientiä...",
```

2. Add tab button in the tab bar (after existing tabs):
```html
<button class="tab-btn" data-tab="dataWallet" data-t="profile.tabs.dataWallet">Data Wallet</button>
```

3. Add tab panel:
```html
<div id="tab-dataWallet" class="tab-panel" style="display:none">
  <!-- Consents section -->
  <h3 data-t="wallet.consents.title">Active Consents</h3>
  <div id="consents-list"></div>

  <!-- Audit section -->
  <h3 data-t="wallet.audit.title">Audit Report</h3>
  <div id="audit-controls"><!-- 7/30/90 day buttons --></div>
  <div id="audit-list"></div>

  <!-- GDPR Export section -->
  <h3 data-t="wallet.export.title">GDPR Export</h3>
  <p data-t="wallet.export.description">...</p>
  <button id="gdpr-export-btn" data-t="wallet.export.button">Download All My Data</button>
</div>
```

4. Add `loadDataWallet()` function:
   - Called when Data Wallet tab is selected
   - Fetches `GET /v1/consent` with auth header
   - Renders consent cards/rows with revoke buttons
   - Revoke button calls `DELETE /v1/consent/:id`, then reloads list

5. Add `loadAudit(days)` function:
   - Fetches `GET /v1/consent/audit?days={days}` with auth header
   - Renders audit timeline/table
   - Default: 30 days, buttons for 7/30/90

6. Add `exportGdpr()` function:
   - Fetches `GET /v1/owners/{owner}/export` with auth header
   - Creates `Blob` from response JSON
   - Triggers download as `aimeat-export-{date}.json`

7. Wire tab selection to call `loadDataWallet()`.

8. Commit: `feat: add Data Wallet tab to profile (consents, audit, GDPR export)`

---

### Task 5: Web wizard — setup API endpoint

**Files:**
- Create: `aimeat/src/routes/setup.ts`
- Modify: `aimeat/src/server.ts` (mount route + first-run middleware)

**What to do:**

1. Create `aimeat/src/routes/setup.ts`:

```typescript
import { Router } from 'express';
import { writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AimeatConfig } from '../config.js';
import { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { generateKeyPair } from '../auth/keypair.js';

export function setupRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // GET /v1/setup/status — check if node needs setup
  router.get('/v1/setup/status', async (_req, res) => {
    const owners = await storage.listOwners();
    res.json(success(config.nodeId, {
      needsSetup: owners.length === 0,
      nodeId: config.nodeId,
    }));
  });

  // POST /v1/setup/init — first-run initialization
  router.post('/v1/setup/init', async (req, res) => {
    // Guard: only works when no owners exist
    const owners = await storage.listOwners();
    if (owners.length > 0) {
      res.status(403).json(error(config.nodeId, 'ALREADY_CONFIGURED', 'Node already has an owner'));
      return;
    }

    const { locale, nodeId, nodeType, owner, genesisUrl, port } = req.body ?? {};

    // Validate required fields
    if (!owner?.username || !owner?.password) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'owner.username and owner.password are required'));
      return;
    }

    // Validate username format
    if (!/^[a-z0-9_-]{3,30}$/.test(owner.username)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Username must be 3-30 chars, lowercase alphanumeric'));
      return;
    }

    // Create keypair for owner
    const keyPair = await generateKeyPair();

    // Create owner (first owner automatically gets operator role)
    const ownerRecord = await storage.createOwner({
      name: owner.username,
      displayName: owner.displayName || owner.username,
      publicKey: keyPair.publicKey,
      roles: ['owner', 'operator'], // first owner = operator
      createdAt: new Date().toISOString(),
    });

    // Create GHII profile
    const ghiiId = `ghii-${owner.username}`;
    await storage.createGhii({
      id: ghiiId,
      ownerName: owner.username,
      displayName: owner.displayName || owner.username,
      verificationLevel: 0,
      email: owner.email || undefined,
      createdAt: new Date().toISOString(),
    });

    // Hash password and store
    // (reuse bcrypt logic from ghii.ts registration)
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash(owner.password, 12);
    await storage.setOwnerPassword(owner.username, passwordHash);

    // Write .env file with config
    const envLines = [
      `# Generated by AIMEAT Setup Wizard`,
      `AIMEAT_NODE_ID=${nodeId || config.nodeId}`,
      `AIMEAT_PORT=${port || config.port}`,
      `AIMEAT_BASE_URL=http://localhost:${port || config.port}`,
      nodeType === 'personal' ? 'AIMEAT_EXTENDED_FEATURES=false' : '',
      genesisUrl ? `AIMEAT_GENESIS_URL=${genesisUrl}` : '',
      locale ? `AIMEAT_DEFAULT_LOCALE=${locale}` : '',
      `AIMEAT_ADMIN_PASSWORD=${owner.password}`,
    ].filter(Boolean).join('\n');

    // Write to .env (append or create)
    const envPath = join(dirname(fileURLToPath(import.meta.url)), '../../.env');
    try {
      if (existsSync(envPath)) {
        // Append to existing
        writeFileSync(envPath, '\n' + envLines + '\n', { flag: 'a' });
      } else {
        writeFileSync(envPath, envLines + '\n');
      }
    } catch {
      // Non-fatal: env write may fail in some environments
    }

    // Generate JWT for auto-login
    const { signJwt } = await import('../auth/jwt.js');
    const agentGaii = `${owner.username}-agent-001`;
    // Create default agent for owner
    await storage.createAgent({
      gaii: agentGaii,
      ownerName: owner.username,
      displayName: `${owner.displayName || owner.username}'s Agent`,
      capabilities: ['memory', 'actions', 'work'],
      status: 'active',
      createdAt: new Date().toISOString(),
    });

    const token = await signJwt({
      sub: agentGaii,
      owner: owner.username,
      roles: ['owner', 'operator'],
    }, config);

    res.status(201).json(success(config.nodeId, {
      owner: ownerRecord.name,
      agent: agentGaii,
      token,
      message: 'Node initialized successfully',
    }));
  });

  return router;
}
```

2. In `server.ts`, add import and mount:
```typescript
import { setupRouter } from './routes/setup.js';
// ... mount before other routes
app.use(setupRouter(config, storage));
```

3. Add first-run redirect middleware in `server.ts` (before static file serving):
```typescript
// First-run detection: redirect to wizard if no owners exist
let hasOwners: boolean | null = null;
app.use(async (req, res, next) => {
  // Skip for API routes, wizard, and static assets
  if (req.path.startsWith('/v1/') || req.path === '/wizard.html' || req.path.includes('.')) {
    next();
    return;
  }
  // Cache the check
  if (hasOwners === null) {
    const owners = await storage.listOwners();
    hasOwners = owners.length > 0;
  }
  if (!hasOwners) {
    res.redirect(302, '/wizard.html');
    return;
  }
  next();
});
```

4. Check if `setOwnerPassword`, `createGhii`, `createAgent` methods exist in storage interface — adapt if method signatures differ.

5. Run: `cd aimeat && npx tsc --noEmit`

6. Commit: `feat: add /v1/setup/init endpoint + first-run redirect middleware`

---

### Task 6: Web wizard — static HTML

**Files:**
- Create: `aimeat/public/wizard.html`

**What to do:**

1. Create a self-contained 5-step wizard HTML file following the AIMEAT dark theme.

2. **Step 1 — Welcome + Language:**
   - Language selector (en/fi)
   - Brief AIMEAT description
   - "Get Started" button

3. **Step 2 — Node Configuration:**
   - Node name input (default: `aimeat-local-001`)
   - Node type radio: Personal / Full
   - Port input (default: 40050)

4. **Step 3 — Create Identity:**
   - Username input (validation: 3-30 chars, lowercase)
   - Display name input
   - Email input (optional)
   - Password input + confirm
   - Client-side validation before proceeding

5. **Step 4 — Network:**
   - Anchor operator selector (radio buttons):
     - "Standalone (no federation)" — no genesis URL
     - "Custom anchor" — text input for URL
   - Genesis URL input (shown when "Custom" selected)

6. **Step 5 — Summary + Launch:**
   - Review all settings in a summary card
   - "Initialize Node" button → POST `/v1/setup/init`
   - On success: store JWT token in localStorage, redirect to portal
   - On error: show error message, allow going back

7. **UI features:**
   - Step indicator at top (1/5, 2/5, etc.)
   - Back/Next navigation buttons
   - Animated step transitions
   - Full i18n (en/fi) with client-side switching
   - AIMEAT dark theme CSS
   - Responsive (works on mobile)
   - First check `GET /v1/setup/status` — if `needsSetup: false`, redirect to `/`

8. Commit: `feat: add web setup wizard (5-step node initialization)`

---

### Task 7: Verification + CLAUDE.md update

**Files:**
- Modify: `CLAUDE.md`

**What to do:**

1. Run: `cd aimeat && npx tsc --noEmit` — must pass with zero errors
2. Run: `cd aimeat && npx vitest run` — all tests must pass
3. Verify the 6 new/modified files are correct:
   - `aimeat/src/storage/interface.ts` — flagCount in MemoryRecord
   - `aimeat/src/storage/memory.ts` — maxFlags filter + incrementMemoryFlagCount
   - `aimeat/src/routes/memory.ts` — max_flags query param
   - `aimeat/src/routes/flags.ts` — increment hook
   - `aimeat/src/routes/setup.ts` — setup endpoint
   - `aimeat/src/server.ts` — first-run middleware + setup mount
   - `aimeat/public/wizard.html` — setup wizard
   - `aimeat/public/hobbies.html` — matches view
   - `aimeat/public/profile.html` — data wallet tab
4. Commit: `docs: update CLAUDE.md for Phase 1 gap closure completion`

---

## Execution Order

| Task | Description | Dependencies | Can parallel? |
|------|-------------|-------------|---------------|
| 1 | Memory flag storage/interface | None | Yes (with 3) |
| 2 | Memory flag routes + hook | Task 1 | No |
| 3 | Match view in hobbies.html | None | Yes (with 1) |
| 4 | Data Wallet tab in profile.html | None | Yes (with 1,3) |
| 5 | Setup API endpoint | None | Yes (with 1,3,4) |
| 6 | Wizard HTML | Task 5 | No |
| 7 | Verification | All | No |

**Recommended parallel groups:**
- Group 1: Tasks 1, 3, 4 (parallel — different files)
- Group 2: Task 2 (depends on 1)
- Group 3: Task 5 (can start anytime)
- Group 4: Task 6 (depends on 5)
- Group 5: Task 7 (depends on all)
