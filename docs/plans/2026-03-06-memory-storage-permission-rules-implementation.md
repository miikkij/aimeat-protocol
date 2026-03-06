# Memory & Storage Permission Rules — Implementation Plan

**Date:** 2026-03-06  
**Status:** Ready for Implementation  
**Category:** Access Control / Permissions  
**Prereq:** [Research Document](2026-03-06-memory-storage-permission-rules-design.md)  
**RFC Reference:** Phase 0.3 Consent Layer + Extension  

---

## Overview

Extend the existing consent system to support granular permission rules for Memory and Storage.
The consent infrastructure is already functional (CRUD, audit, expiry, glob patterns) — this plan
adds new **recipient types** (`ghii:`, `domain:`, `node:`), a **permission listing API**,
and **storage consent integration**.

The design principle is: **don't build a new permission system — extend the one that already works.**

---

## Architecture Decision

All permission rules are expressed as **consent records** via the existing `POST /v1/consent` API.
New recipient patterns use a prefix-based format to distinguish them from plain GAIIs:

| Prefix | Matches | Example |
|--------|---------|---------|
| *(none)* | Exact GAII | `doctor#clinic@health-node` |
| `*` | Any accessor (wildcard) | `*` |
| `organism.` | All members of an organism | `organism.hobby-club` |
| `ghii:` | All agents of a GHII user | `ghii:alice@aimeat-finland-001` |
| `domain:` | All agents on matching nodes | `domain:*.health-network.fi` |
| `node:` | All agents on a specific node | `node:aimeat-clinic-001` |

No new database tables. No new record types. Only the **recipient matching logic** expands.

---

## Phase A — Consent Recipient Expansion

**Goal:** Allow consent grants to target GHII users, node domains, and specific nodes.

### Step A1 — Extract recipient matching into a shared function

**File:** `src/services/consent.ts`

Currently `checkConsentForRead()` delegates matching to `storage.findMatchingConsents()`,
which lives separately in each storage provider (SQLite: `providers/sqlite/index.ts` line 1714,
MongoDB: `providers/mongodb/index.ts` line 1477). Both implementations contain identical
matching logic:

```typescript
// Current matching (same in both providers):
if (consent.recipient !== '*' && consent.recipient !== accessorGaii) continue;
```

**Action:** Create a pure function `matchesRecipient()` in `src/services/consent.ts`
that both providers call, centralizing all matching logic in one place.

```typescript
// src/services/consent.ts — new export
export function matchesRecipient(
  recipient: string,
  accessorGaii: string,
  accessorOwner: string,
  accessorNode: string,
): boolean {
  // Wildcard
  if (recipient === '*') return true;

  // Exact GAII
  if (recipient === accessorGaii) return true;

  // Organism membership (placeholder — needs async storage lookup)
  // Handled separately in storage layer

  // GHII user — all agents under this human identity
  if (recipient.startsWith('ghii:')) {
    const ghii = recipient.slice(5);            // "alice@node-1"
    const atIdx = ghii.lastIndexOf('@');
    if (atIdx === -1) return false;
    const username = ghii.slice(0, atIdx);
    const node = ghii.slice(atIdx + 1);
    return accessorOwner === username && accessorNode === node;
  }

  // Domain glob — match accessor's home node ID
  if (recipient.startsWith('domain:')) {
    const pattern = recipient.slice(7);          // "*.health-network.fi"
    return globMatch(pattern, accessorNode);
  }

  // Specific node
  if (recipient.startsWith('node:')) {
    const nodeId = recipient.slice(5);
    return accessorNode === nodeId;
  }

  return false;
}
```

**Dependencies:**
- Need `globMatch()` utility — reuse `consentMatchPattern()` already in both providers, or use the `minimatch` / `picomatch` package if already available.
- Need to parse accessor's `owner` and `node` from the GAII format `agent#owner@node`.

### Step A2 — Add GAII parsing utility

**File:** `src/utils/gaii.ts` (likely exists already — check and extend)

```typescript
export function parseGaii(gaii: string): { agent: string; owner: string; node: string } {
  // Format: "agentName#ownerName@nodeId"
  const hashIdx = gaii.indexOf('#');
  const atIdx = gaii.lastIndexOf('@');
  return {
    agent: hashIdx >= 0 ? gaii.slice(0, hashIdx) : '',
    owner: hashIdx >= 0 ? gaii.slice(hashIdx + 1, atIdx) : gaii.slice(0, atIdx),
    node: atIdx >= 0 ? gaii.slice(atIdx + 1) : '',
  };
}
```

### Step A3 — Update `findMatchingConsents()` in both storage providers

**Files:**
- `src/storage/providers/sqlite/index.ts` (line 1714)
- `src/storage/providers/mongodb/index.ts` (line 1477)

**Change:** Replace inline recipient check with call to `matchesRecipient()`:

```typescript
// Before:
if (consent.recipient !== '*' && consent.recipient !== accessorGaii) continue;

// After:
import { matchesRecipient } from '../../../services/consent.js';
import { parseGaii } from '../../../utils/gaii.js';

// At call site:
const accessor = parseGaii(accessorGaii);
// ...
if (!matchesRecipient(consent.recipient, accessorGaii, accessor.owner, accessor.node)) continue;
```

The function signature of `findMatchingConsents()` in `ConsentRepository` stays unchanged
(`ownerGaii: string, memoryKey: string, accessorGaii: string`) — the GAII parsing happens inside.

### Step A4 — Add recipient validation on `POST /v1/consent`

**File:** `src/routes/consent.ts` (line 24)

Currently the `recipient` field is accepted as-is (only checked for non-empty). Add format validation:

```typescript
// After the existing required-field check:
const validRecipientPatterns = [
  /^\*$/,                           // Wildcard
  /^organism\.\S+$/,                // Organism
  /^ghii:\S+@\S+$/,                // GHII user
  /^domain:\S+$/,                   // Domain glob
  /^node:\S+$/,                     // Specific node
  /^[^*][^:]*#[^@]+@.+$/,          // Specific GAII (agent#owner@node)
  /^[^#@*:]+@[^@]+$/,              // Short GAII (owner@node)
];

const isValidRecipient = validRecipientPatterns.some(p => p.test(recipient));
if (!isValidRecipient) {
  res.status(400).json(error(config.nodeId, 'INVALID_RECIPIENT',
    'recipient must be "*", a GAII, or prefixed with "organism.", "ghii:", "domain:", or "node:"'));
  return;
}
```

### Step A5 — Update OpenAPI spec

**File:** `openapi.yaml`

Update the `ConsentGrant` schema to document new recipient patterns:

```yaml
recipient:
  type: string
  description: |
    Who receives access. Supported patterns:
    - `*` — any accessor (wildcard)
    - `agent#owner@node` — specific agent GAII
    - `organism.{id}` — all members of an organism
    - `ghii:username@node` — all agents of a GHII user
    - `domain:*.example.com` — all agents on matching node domains
    - `node:node-id` — all agents on a specific node
  examples:
    - "*"
    - "doctor#clinic@health-node"
    - "organism.hobby-club"
    - "ghii:alice@aimeat-finland-001"
    - "domain:*.health-network.fi"
    - "node:aimeat-clinic-001"
```

### Step A6 — E2E tests for new recipient types

**File:** `test/e2e-full.ts`

Add a new test section (after existing consent tests in Phase 4):

```
Test: consent with ghii: recipient — grant + verify access
Test: consent with domain: recipient — grant + verify access
Test: consent with node: recipient — grant + verify access
Test: consent with invalid recipient format — expect 400
Test: consent with ghii: recipient, wrong user — expect deny
Test: consent with domain: recipient, non-matching node — expect deny
```

### Phase A — Files Changed Summary

| File | Change |
|------|--------|
| `src/services/consent.ts` | Add `matchesRecipient()` export |
| `src/utils/gaii.ts` | Add/extend `parseGaii()` utility |
| `src/storage/providers/sqlite/index.ts` | Use `matchesRecipient()` in `findMatchingConsents()` |
| `src/storage/providers/mongodb/index.ts` | Use `matchesRecipient()` in `findMatchingConsents()` |
| `src/routes/consent.ts` | Add recipient format validation |
| `openapi.yaml` | Update ConsentGrant.recipient docs |
| `test/e2e-full.ts` | Add 6 new consent recipient tests |

### Phase A — Verification

```bash
cd aimeat
npx tsc --noEmit                    # Type-check
npx tsx test/e2e-full.ts            # E2E (server on :40251)
```

---

## Phase B — Permission Listing API

**Goal:** Provide visibility into what permission rules affect a given data key, and allow
simulating access checks.

### Step B1 — Create permissions router

**File:** `src/routes/permissions.ts` (new)

```typescript
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireScope } from '../auth/middleware.js';

export function permissionsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // GET /v1/permissions/summary — overview of all rules for authenticated agent's data
  router.get('/v1/permissions/summary',
    requireAuth(), requireScope('consent:manage'),
    async (req, res) => { ... });

  // GET /v1/permissions/check — simulate an access check
  router.get('/v1/permissions/check',
    requireAuth(), requireScope('consent:manage'),
    async (req, res) => { ... });

  // GET /v1/permissions/memory/:key — list all rules affecting a specific key
  router.get('/v1/permissions/memory/:key',
    requireAuth(), requireScope('consent:manage'),
    async (req, res) => { ... });

  return router;
}
```

**Route ordering note:** Static routes (`/summary`, `/check`) MUST be registered before
parameterized routes (`/memory/:key`). All three are within the same router, so
registration order in the file handles this.

### Step B2 — Implement `GET /v1/permissions/summary`

Lists aggregate stats about the authenticated agent's permission rules:

```typescript
router.get('/v1/permissions/summary',
  requireAuth(), requireScope('consent:manage'),
  async (req, res) => {
    const ownerGaii = req.auth!.sub;
    const consents = await storage.listConsents(ownerGaii, { status: 'active' });

    const byType = { wildcard: 0, gaii: 0, ghii: 0, organism: 0, domain: 0, node: 0 };
    for (const c of consents) {
      if (c.recipient === '*') byType.wildcard++;
      else if (c.recipient.startsWith('ghii:')) byType.ghii++;
      else if (c.recipient.startsWith('organism.')) byType.organism++;
      else if (c.recipient.startsWith('domain:')) byType.domain++;
      else if (c.recipient.startsWith('node:')) byType.node++;
      else byType.gaii++;
    }

    const memoryKeys = await storage.listMemory(ownerGaii);
    const storageFiles = await storage.listFiles?.(ownerGaii) ?? [];

    res.json(success(config.nodeId, {
      total_memory_keys: memoryKeys.length,
      total_storage_files: storageFiles.length,
      active_consents: consents.length,
      rules_by_recipient_type: byType,
      data_patterns: [...new Set(consents.map(c => c.dataPattern))],
    }));
  });
```

### Step B3 — Implement `GET /v1/permissions/check`

Simulates whether a specific accessor would be allowed to read a specific key:

```typescript
router.get('/v1/permissions/check',
  requireAuth(), requireScope('consent:manage'),
  async (req, res) => {
    const key = req.query.key as string;
    const accessor = req.query.accessor as string;

    if (!key || !accessor) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        'key and accessor query parameters are required'));
      return;
    }

    const ownerGaii = req.auth!.sub;
    const memory = await storage.getMemory(ownerGaii, key);
    const visibility = memory?.visibility ?? 'private';

    const result = await checkConsentForRead(storage, key, ownerGaii, accessor, visibility);

    res.json(success(config.nodeId, {
      key,
      accessor,
      visibility,
      allowed: result.allowed,
      reason: result.reason,
      consent_id: result.consentId ?? null,
    }));
  });
```

### Step B4 — Implement `GET /v1/permissions/memory/:key`

Lists all consent records whose `dataPattern` glob matches the given key:

```typescript
router.get('/v1/permissions/memory/:key',
  requireAuth(), requireScope('consent:manage'),
  async (req, res) => {
    const key = req.params.key as string;
    const ownerGaii = req.auth!.sub;

    const memory = await storage.getMemory(ownerGaii, key);
    const consents = await storage.listConsents(ownerGaii, { status: 'active' });

    // Filter consents whose dataPattern matches the requested key
    const matching = consents.filter(c => consentMatchPattern(c.dataPattern, key));

    res.json(success(config.nodeId, {
      key,
      visibility: memory?.visibility ?? 'private',
      effective_rules: matching.map(c => ({
        consent_id: c.id,
        recipient: c.recipient,
        data_pattern: c.dataPattern,
        purpose: c.purpose,
        scope: c.scope,
        expires: c.expires,
        status: c.status,
        granted_at: c.grantedAt,
      })),
    }));
  });
```

### Step B5 — Register permissions router in server.ts

**File:** `src/server.ts`

Add after the consent router registration:

```typescript
app.use(consentRouter(config, storage, stats, notifyDirectoryChange));  // existing
app.use(permissionsRouter(config, storage));                            // NEW
```

### Step B6 — Update OpenAPI spec

**File:** `openapi.yaml`

Add 3 new endpoint definitions:
- `GET /v1/permissions/summary`
- `GET /v1/permissions/check`
- `GET /v1/permissions/memory/{key}`

### Step B7 — E2E tests

**File:** `test/e2e-full.ts`

```
Test: GET /v1/permissions/summary — returns correct counts
Test: GET /v1/permissions/check — allowed case (consent exists)
Test: GET /v1/permissions/check — denied case (no consent)
Test: GET /v1/permissions/memory/:key — returns matching consents
Test: GET /v1/permissions/memory/:key — no rules returns empty array
```

### Phase B — Files Changed Summary

| File | Change |
|------|--------|
| `src/routes/permissions.ts` | **New file** — 3 endpoints |
| `src/server.ts` | Register `permissionsRouter` |
| `openapi.yaml` | 3 new endpoint definitions |
| `test/e2e-full.ts` | 5 new permission listing tests |

---

## Phase C — Storage Consent Integration

**Goal:** Apply consent checking to storage file downloads, matching the behavior
that already exists for memory reads.

### Step C1 — Add consent check to public file download

**File:** `src/routes/storage-files.ts`

The `GET /v1/pub/:gaii/:key` route currently only serves files with `visibility='public'`.
Extend it to check consent for non-public files when the request carries authentication:

```typescript
// After checking if file exists and visibility is public...
if (file.visibility !== 'public') {
  // Only attempt consent check if caller is authenticated
  if (!req.auth?.sub) {
    res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'File not found'));
    return;
  }

  if (!config.consentEnabled) {
    res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'File not found'));
    return;
  }

  const result = await checkConsentForRead(
    storage, key, gaii, req.auth.sub, file.visibility
  );

  if (!result.allowed) {
    res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'File not found'));
    return;
  }

  // Audit the access
  await auditDataAccess(storage, result.consentId ?? null,
    gaii, req.auth.sub, `storage:${key}`, 'read', true);
}
```

### Step C2 — Add `optionalAuth()` to public file route

**File:** `src/routes/storage-files.ts`

The public route currently has no auth middleware. Add `optionalAuth()` so that
authentication is parsed when present but not required:

```typescript
// Before:
router.get('/v1/pub/:gaii/:key', async (req, res) => { ... });

// After:
router.get('/v1/pub/:gaii/:key', optionalAuth(), async (req, res) => { ... });
```

### Step C3 — E2E tests

**File:** `test/e2e-full.ts`

```
Test: storage public file — accessible without auth (existing behavior)
Test: storage private file via /v1/pub — returns 404 without auth
Test: storage private file via /v1/pub — accessible with consent grant
Test: storage consent access creates audit entry
```

### Phase C — Files Changed Summary

| File | Change |
|------|--------|
| `src/routes/storage-files.ts` | Add `optionalAuth()` + consent check to public route |
| `test/e2e-full.ts` | 4 new storage consent tests |

---

## Phase D — IP-Based Restrictions (Optional / Deferred)

**Goal:** Allow consent rules that restrict by source IP address or CIDR range.

This phase is **optional** and carries additional security complexity (proxy trust,
IP spoofing, NAT). Recommend deferring until Phases A–C are complete and there is
concrete demand.

### Step D1 — Add `ip:` recipient pattern

**File:** `src/services/consent.ts` — extend `matchesRecipient()`

Add a new parameter `accessorIp: string` and handle:

```typescript
if (recipient.startsWith('ip:')) {
  const cidr = recipient.slice(3);   // e.g. "192.168.1.0/24"
  return isIpInCidr(accessorIp, cidr);
}
```

### Step D2 — Extract client IP reliably

**File:** `src/middleware/ip-extract.ts` (new)

Must handle `X-Forwarded-For` with trusted proxy configuration to prevent spoofing.
Express 5 `req.ip` can be used when `trust proxy` is configured correctly.

### Step D3 — Pass IP to consent matching chain

**Files:** Storage providers + `checkConsentForRead()`

The `findMatchingConsents()` interface would need to accept `accessorIp` as
an additional parameter, or the service layer handles IP matching separately
after the storage layer returns potential matches.

**Recommendation:** Handle IP matching in the service layer (`matchesRecipient()`),
not in the storage query, to keep the storage interface stable.

### Phase D — Files Changed Summary

| File | Change |
|------|--------|
| `src/services/consent.ts` | Add `ip:` to `matchesRecipient()`, accept `accessorIp` |
| `src/middleware/ip-extract.ts` | **New file** — trusted proxy IP extraction |
| `src/routes/consent.ts` | Add `ip:` to recipient validation regex |
| `openapi.yaml` | Document `ip:` recipient pattern |
| `test/e2e-full.ts` | IP-based consent tests |

---

## Implementation Order & Dependencies

```
Phase A ──────────────────────────────┐
  A1: matchesRecipient() function     │
  A2: parseGaii() utility             │
  A3: Update storage providers        │
  A4: Recipient validation            │
  A5: OpenAPI update                  │
  A6: E2E tests                       │
──────────────────────────────────────┘
          │
    ┌─────┼──────────────┐
    ▼     ▼              ▼
Phase B ─────┐  Phase C ────┐  Phase E (partial) ──┐
  Permissions │  Storage     │  E5: init wizard     │
  listing API │  consent     │  E6: aimeat config   │
  (3 endpts)  │  integration │  E7: table UX        │
──────────────┘  ────────────┘  ────────────────────┘
    │                            │
    ▼                            ▼
Phase E (rest) ───────────────────────┐
  E1: Grant consent form (profile)    │  Depends on A (new
  E2: Permission summary dashboard    │  recipient types)
  E3: Per-key sharing rules           │  E2/E3 depend on B
  E4: Admin dashboard stats panel     │  (permissions API)
──────────────────────────────────────┘
          │
          ▼
Phase D (optional) ───────────────────┐
  D1-D3: IP-based restrictions        │  Depends on A
──────────────────────────────────────┘
```

**Phase E is split:** Steps E5/E6/E7 (init wizard, CLI config, table UX) have no
API dependencies and can be done alongside Phases B/C. Steps E1–E4 (grant form,
summary dashboard, per-key rules, admin stats) depend on Phase A for recipient
types and Phase B for the permissions listing API.

---

## Phase E — UI Governance & Configuration

**Goal:** Provide user-facing and operator-facing interfaces for managing,
viewing, and configuring permission rules across all governance surfaces.

### Current State — What Exists

| Surface | What's There | Permission-Related |
|---------|-------------|-------------------|
| **Profile → Data Wallet tab** | Consent table (view + revoke), Audit log (7/30/90 days filter), GDPR export | ✅ View consents, ✅ Revoke, ❌ No grant form, ❌ No permission summary |
| **Profile → Memory tab** | Memory CRUD with visibility dropdown (`private`/`shared`/`public`) | ✅ Set visibility per key, ❌ No per-key permission rules |
| **Profile → Agents tab** | Scope modal with templates (readonly/standard/full) + per-domain checkboxes | ✅ Agent scope editing, ❌ No per-agent permission overview |
| **Admin Dashboard → Config** | `consent.enabled`, `consent.audit_retention_days`, `consent.max_per_user` (mutable) | ✅ Toggle consent layer, ❌ No node-wide permission overview |
| **Admin Dashboard → Owners/Agents** | Owner/agent list with trust scores | ❌ No consent/permission view per user |
| **`aimeat init` wizard** | Cookie consent config only — no data consent settings | ❌ Consent layer not in init |
| **`.env` / `aimeat config`** | `AIMEAT_CONSENT_ENABLED`, `_AUDIT_RETENTION_DAYS`, `_MAX_PER_USER` | ⚠️ Listed in .env.example but NOT in `aimeat config` output |

### Governance Model — Who Manages What

```
┌─────────────────────────────────────────────────────────────────┐
│  Node Operator (sysadmin)                                       │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Admin Dashboard → Config tab                              │ │
│  │  • consent.enabled (on/off)                               │ │
│  │  • consent.max_per_user (quota)                           │ │
│  │  • consent.audit_retention_days                           │ │
│  │  • NEW: default permission policy (open/restrictive)      │ │
│  │  • NEW: node-wide permission stats panel                  │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ aimeat init (first-run wizard)                            │ │
│  │  • NEW: consent layer toggle + default policy             │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ .env / aimeat config                                      │ │
│  │  • AIMEAT_CONSENT_ENABLED                                 │ │
│  │  • AIMEAT_CONSENT_MAX_PER_USER                            │ │
│  │  • AIMEAT_CONSENT_AUDIT_RETENTION_DAYS                    │ │
│  │  • NEW: AIMEAT_DEFAULT_PERMISSION_POLICY                  │ │
│  └────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  Data Owner (regular user via Profile)                          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Profile → Data Wallet tab                                 │ │
│  │  • View active consents (existing ✅)                     │ │
│  │  • Revoke consents (existing ✅)                          │ │
│  │  • Audit log (existing ✅)                                │ │
│  │  • GDPR export (existing ✅)                              │ │
│  │  • NEW: Grant consent form (create new permission rule)   │ │
│  │  • NEW: Permission summary dashboard                     │ │
│  │  • NEW: Access check simulator                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Profile → Memory tab (per-key inline)                     │ │
│  │  • Visibility dropdown (existing ✅)                      │ │
│  │  • NEW: "Sharing rules" link/icon per memory key          │ │
│  └────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  External Agents / AI Platforms (API only)                      │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ REST API                                                  │ │
│  │  • POST /v1/consent (create permission rule)              │ │
│  │  • DELETE /v1/consent/:id (revoke)                        │ │
│  │  • GET /v1/permissions/* (Phase B listing endpoints)      │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Step E1 — Grant Consent Form in Data Wallet

**File:** `public/views/profile.js` — inside `renderDataWallet()`

Add a "Grant New Permission" button and form above the consents table:

```javascript
// New consent grant form component
function ConsentGrantForm({ onGrant, onCancel }) {
  const [dataPattern, setDataPattern] = useState('');
  const [recipientType, setRecipientType] = useState('gaii');
  const [recipient, setRecipient] = useState('');
  const [purpose, setPurpose] = useState('');
  const [scope, setScope] = useState('dmz');
  const [expires, setExpires] = useState('');

  const recipientTypes = [
    { value: 'gaii',     label: 'Specific Agent (GAII)',  placeholder: 'agent#owner@node' },
    { value: 'ghii',     label: 'GHII User (all agents)', placeholder: 'username@node' },
    { value: 'organism', label: 'Organism Members',        placeholder: 'organism-id' },
    { value: 'domain',   label: 'Node Domain',             placeholder: '*.example.com' },
    { value: 'node',     label: 'Specific Node',           placeholder: 'aimeat-clinic-001' },
    { value: 'wildcard', label: 'Everyone (*)',             placeholder: '' },
  ];

  function buildRecipient() {
    if (recipientType === 'wildcard') return '*';
    if (recipientType === 'ghii')     return `ghii:${recipient}`;
    if (recipientType === 'organism') return `organism.${recipient}`;
    if (recipientType === 'domain')   return `domain:${recipient}`;
    if (recipientType === 'node')     return `node:${recipient}`;
    return recipient; // raw GAII
  }

  return html`
    <div class="create-form">
      <div class="form-row">
        <label>Data Pattern</label>
        <input class="input-field" placeholder="health.*" value=${dataPattern}
               onInput=${e => setDataPattern(e.target.value)} />
        <small class="hint">Glob pattern for memory keys (e.g. health.*, profile.interests)</small>
      </div>
      <div class="form-row">
        <label>Recipient Type</label>
        <select class="input-field" value=${recipientType}
                onChange=${e => setRecipientType(e.target.value)}>
          ${recipientTypes.map(t => html`<option value=${t.value}>${t.label}</option>`)}
        </select>
      </div>
      ${recipientType !== 'wildcard' && html`
        <div class="form-row">
          <label>Recipient</label>
          <input class="input-field"
                 placeholder=${recipientTypes.find(t => t.value === recipientType)?.placeholder}
                 value=${recipient} onInput=${e => setRecipient(e.target.value)} />
        </div>
      `}
      <div class="form-row">
        <label>Purpose</label>
        <input class="input-field" placeholder="Why is access needed?" value=${purpose}
               onInput=${e => setPurpose(e.target.value)} />
      </div>
      <div class="form-row">
        <label>Scope</label>
        <select class="input-field" value=${scope} onChange=${e => setScope(e.target.value)}>
          <option value="private">Private (home node only)</option>
          <option value="dmz">DMZ (internal federation)</option>
          <option value="federation">Federation (public replication)</option>
        </select>
      </div>
      <div class="form-row">
        <label>Expires</label>
        <input class="input-field" type="date" value=${expires}
               onInput=${e => setExpires(e.target.value)} />
        <small class="hint">Leave empty for no expiration</small>
      </div>
      <div class="form-actions">
        <button class="btn-primary" onClick=${() => {
          if (!dataPattern || !purpose) return;
          onGrant({
            data_pattern: dataPattern,
            recipient: buildRecipient(),
            purpose,
            scope,
            expires: expires ? new Date(expires).toISOString() : null,
          });
        }}>Grant Permission</button>
        <button class="btn-outline" onClick=${onCancel}>Cancel</button>
      </div>
    </div>`;
}
```

**API call:**
```javascript
async function grantConsent(body) {
  await apiFetch('/v1/consent', { method: 'POST', body: JSON.stringify(body) });
  showToast('Permission granted');
  loadConsentsData();
}
```

### Step E2 — Permission Summary Dashboard in Data Wallet

**File:** `public/views/profile.js` — add above the consents table in Data Wallet

Display an overview card calling `GET /v1/permissions/summary`:

```
┌──────────────────────────────────────────────────────┐
│ 📊 Permission Overview                               │
│                                                       │
│  Memory Keys: 42    Storage Files: 7                 │
│  Active Rules: 5                                      │
│                                                       │
│  By Type: [GAII: 2] [GHII: 1] [Organism: 1]         │
│           [Wildcard: 1] [Domain: 0] [Node: 0]        │
│                                                       │
│  Patterns: health.*, profile.interests, work.portfolio│
└──────────────────────────────────────────────────────┘
```

**Depends on:** Phase B (permissions listing API) being implemented first.

### Step E3 — Per-Key Sharing Rules Link in Memory Tab

**File:** `public/views/profile.js` — in the memory entries list

Add a small shield/share icon next to each memory key that opens a popover
showing active rules for that key:

```javascript
// In memory entry row, after the visibility badge:
html`<button class="icon-btn" title="Sharing rules"
             onClick=${() => loadKeyPermissions(entry.key)}>🛡️</button>`

// loadKeyPermissions calls: GET /v1/permissions/memory/{key}
// Shows popover with matching consent rules
```

**UI pattern:** Click shield icon → popover/modal showing:
- Current visibility (private/owner/public)
- Active consent rules matching this key
- Quick "Grant access to this key" link (opens grant form pre-filled with `data_pattern`)

### Step E4 — Admin Dashboard Permission Stats Panel

**File:** `src/routes/admin-dashboard.ts`

Add a "Permissions" section to the admin dashboard showing node-wide stats:

```
┌──────────────────────────────────────────────────────┐
│ 🛡️ Permission Rules (Node-Wide)                      │
│                                                       │
│  Total Active Consents: 127                           │
│  Total Revoked: 34     Total Expired: 12             │
│                                                       │
│  By Recipient Type:                                   │
│    Wildcard (*): 15    GAII: 52    GHII: 28           │
│    Organism: 18        Domain: 8   Node: 6           │
│                                                       │
│  Top Data Patterns:                                   │
│    health.*          — 23 rules                       │
│    profile.*         — 18 rules                       │
│    work.portfolio    — 7 rules                        │
│                                                       │
│  Recent Audit Activity (24h):                         │
│    Reads: 342   Lists: 56   Searches: 12             │
│    Denied: 8                                          │
└──────────────────────────────────────────────────────┘
```

**Data source:** New admin-only endpoint `GET /v1/admin/permissions/stats` that
aggregates across all owners (operator-only access).

### Step E5 — Init Wizard Consent Configuration

**File:** `src/cli/init-wizard.ts`

Add consent layer config to the `custom` use case in `askAllAdvancedSettings()`:

```typescript
// In askAllAdvancedSettings():
const consentEnabled = await p.confirm({
  message: t('init.consent_enabled'),
  initialValue: true,
});

const consentMaxPerUser = await p.text({
  message: t('init.consent_max_per_user'),
  initialValue: '100',
  validate: v => isNaN(Number(v)) || Number(v) < 1 ? t('init.consent_max_invalid') : undefined,
});

const consentAuditDays = await p.text({
  message: t('init.consent_audit_days'),
  initialValue: '365',
  validate: v => isNaN(Number(v)) || Number(v) < 1 ? t('init.consent_audit_invalid') : undefined,
});
```

**Translations:** Add to `locales/en.json` and `locales/fi.json`:
```json
{
  "init": {
    "consent_enabled": "Enable consent layer (data sharing permissions)?",
    "consent_max_per_user": "Maximum consent rules per user",
    "consent_max_invalid": "Must be a positive number",
    "consent_audit_days": "Audit log retention (days)",
    "consent_audit_invalid": "Must be a positive number"
  }
}
```

### Step E6 — Display consent settings in `aimeat config`

**File:** `src/utils/env-config.ts`

Currently consent layer env vars are NOT shown in `aimeat config` output.
Add a "Consent Layer" section:

```typescript
// Add to the display sections:
{
  title: 'Consent Layer',
  vars: [
    { key: 'AIMEAT_CONSENT_ENABLED', desc: 'Enable consent-based data sharing permissions' },
    { key: 'AIMEAT_CONSENT_MAX_PER_USER', desc: 'Maximum consent rules per user' },
    { key: 'AIMEAT_CONSENT_AUDIT_RETENTION_DAYS', desc: 'How long to keep audit logs (days)' },
  ],
}
```

### Step E7 — Consent table UX improvements in Data Wallet

**File:** `public/views/profile.js`

Enhance the existing consents table:

1. **Recipient type badge** — Show colored badge based on recipient prefix:
   ```
   GAII → blue badge     GHII → purple badge    Organism → green badge
   Domain → orange badge  Node → gray badge      Wildcard → red badge
   ```

2. **Expiry warning** — Highlight consents expiring within 7 days with amber background.

3. **Bulk revoke** — Checkbox column + "Revoke Selected" button for revoking multiple consents.

4. **Filter/search** — Text input to filter consents by recipient or data pattern.

### Phase E — Files Changed Summary

| File | Change | Surface |
|------|--------|---------|
| `public/views/profile.js` | Grant form, permission summary, per-key rules, table UX | Profile UI |
| `src/routes/admin-dashboard.ts` | Permission stats panel | Admin Dashboard |
| `src/cli/init-wizard.ts` | Consent layer config prompts | Init Wizard |
| `src/utils/env-config.ts` | Display consent env vars | `aimeat config` CLI |
| `locales/en.json` | Grant form labels, init prompts, badge labels | i18n |
| `locales/fi.json` | Finnish translations for all new strings | i18n |

### Phase E — Verification

- [ ] Grant consent form creates valid consent record via API
- [ ] Recipient type dropdown correctly prefixes recipient value
- [ ] Permission summary shows correct aggregate stats
- [ ] Per-key shield icon shows matching consent rules
- [ ] Admin dashboard shows node-wide permission stats
- [ ] `aimeat init` prompts for consent settings in custom mode
- [ ] `aimeat config` displays consent layer settings
- [ ] Expiry warnings appear for consents expiring within 7 days
- [ ] Recipient type badges render correctly for all 6 types

---

## Governance Summary

| What | Who | Where | How |
|------|-----|-------|-----|
| **Enable/disable consent layer** | Node operator | Admin Dashboard Config tab, `.env`, `aimeat init` | `AIMEAT_CONSENT_ENABLED=true/false` |
| **Set consent quota per user** | Node operator | Admin Dashboard Config tab, `.env`, `aimeat init` | `AIMEAT_CONSENT_MAX_PER_USER=100` |
| **Set audit retention** | Node operator | Admin Dashboard Config tab, `.env` | `AIMEAT_CONSENT_AUDIT_RETENTION_DAYS=365` |
| **View node-wide permission stats** | Node operator | Admin Dashboard → Permissions panel | Aggregated stats across all owners |
| **Grant a permission rule** | Data owner (user) | Profile → Data Wallet → Grant form | `POST /v1/consent` with recipient type selector |
| **Revoke a permission rule** | Data owner (user) | Profile → Data Wallet → Revoke button | `DELETE /v1/consent/:id` |
| **View active rules** | Data owner (user) | Profile → Data Wallet → Consents table | `GET /v1/consent` |
| **View per-key rules** | Data owner (user) | Profile → Memory tab → Shield icon | `GET /v1/permissions/memory/:key` |
| **View permission summary** | Data owner (user) | Profile → Data Wallet → Summary card | `GET /v1/permissions/summary` |
| **Check access simulation** | Data owner (user) | Profile → Data Wallet (future) | `GET /v1/permissions/check` |
| **View audit trail** | Data owner (user) | Profile → Data Wallet → Audit section | `GET /v1/consent/audit?days=N` |
| **Export all data (GDPR)** | Data owner (user) | Profile → Data Wallet → Export button | `GET /v1/owners/:name/export` |
| **Create rules programmatically** | AI agent / platform | REST API | `POST /v1/consent` with `consent:manage` scope |

---

## Verification Checklist

After each phase, run:

```bash
cd aimeat
npx tsc --noEmit                         # Type-check passes
npx tsx test/e2e-full.ts                 # All E2E tests pass (server on :40251)
```

### Phase A verification:
- [ ] `matchesRecipient()` handles all 6 recipient patterns correctly
- [ ] `parseGaii()` handles standard GAII format `agent#owner@node`
- [ ] Both storage providers (SQLite + MongoDB) use centralized matching
- [ ] `POST /v1/consent` rejects invalid recipient formats with 400
- [ ] E2E: consent with `ghii:` recipient grants access
- [ ] E2E: consent with `domain:` recipient grants access
- [ ] E2E: consent with `node:` recipient grants access
- [ ] E2E: non-matching patterns correctly deny access

### Phase B verification:
- [ ] `GET /v1/permissions/summary` returns correct aggregate stats
- [ ] `GET /v1/permissions/check` correctly simulates allow/deny
- [ ] `GET /v1/permissions/memory/:key` lists matching consent records
- [ ] All 3 endpoints require `consent:manage` scope
- [ ] Response format uses standard AIMEAT envelope (`success()`)

### Phase C verification:
- [ ] Public files still accessible without auth (no regression)
- [ ] Private files via `/v1/pub/` return 404 without auth
- [ ] Private files via `/v1/pub/` accessible with consent + auth
- [ ] Consent access creates audit trail entry
- [ ] Storage audit entries use `storage:` prefix in memoryKey field

---

## Backward Compatibility

| Concern | Impact |
|---------|--------|
| Existing consent records | Fully compatible — old `*` and GAII patterns still work identically |
| JWT tokens | No change — `matchesRecipient()` reads GAII info from tokens, not new fields |
| OpenAPI clients | Additive — new recipient patterns are optional, old patterns unchanged |
| Storage schema | No migration — recipient field is already a plain string |
| Anonymous mode | No impact — anonymous requests don't go through consent (visibility-only) |
| E2E tests | All existing tests pass unchanged |

---

## Localization

Add translations for permission-related error messages:

**File:** `locales/en.json`
```json
{
  "permissions": {
    "invalid_recipient": "Invalid recipient format. Use *, a GAII, or prefixed patterns (ghii:, domain:, node:, organism.)",
    "scope_required": "consent:manage scope is required to view permissions"
  }
}
```

**File:** `locales/fi.json`
```json
{
  "permissions": {
    "invalid_recipient": "Virheellinen vastaanottajamuoto. Käytä *, GAII:ta tai etuliitteisiä malleja (ghii:, domain:, node:, organism.)",
    "scope_required": "consent:manage-oikeus vaaditaan käyttöoikeuksien tarkasteluun"
  }
}
```
