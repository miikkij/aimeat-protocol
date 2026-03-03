# Phase 0 Gap Closure + Usage Statistics — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close all Phase 0 gaps (consent integration, audit logging, DMZ architecture, semantic E2E tests, openapi.yaml updates) and add lightweight usage statistics with dashboard charts.

**Architecture:** In-memory counters via Express middleware + stats service, consent integration into memory reads, admin dashboard stats panel with daily/weekly/monthly charts using embedded Chart.js (CDN). All counters reset on restart — no persistence overhead.

**Tech Stack:** Express middleware, existing consent service, Chart.js (CDN in admin dashboard), vitest for unit tests

---

## Task 1: Usage Statistics — Counter Service

**Files:**
- Create: `aimeat/src/services/stats.ts`
- Create: `aimeat/test/unit/stats.test.ts`

**Step 1: Write failing test**

```typescript
// test/unit/stats.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { StatsCollector } from '../../src/services/stats.js';

describe('StatsCollector', () => {
  let stats: StatsCollector;

  beforeEach(() => {
    stats = new StatsCollector();
  });

  it('starts with zero counters', () => {
    const snap = stats.snapshot();
    expect(snap.requests_total).toBe(0);
    expect(snap.memory_writes).toBe(0);
  });

  it('increments named counters', () => {
    stats.increment('requests_total');
    stats.increment('requests_total');
    stats.increment('memory_writes');
    const snap = stats.snapshot();
    expect(snap.requests_total).toBe(2);
    expect(snap.memory_writes).toBe(1);
  });

  it('increments method counters', () => {
    stats.incrementMethod('GET');
    stats.incrementMethod('POST');
    stats.incrementMethod('GET');
    const snap = stats.snapshot();
    expect(snap.requests_by_method.GET).toBe(2);
    expect(snap.requests_by_method.POST).toBe(1);
  });

  it('increments status counters', () => {
    stats.incrementStatus(200);
    stats.incrementStatus(404);
    stats.incrementStatus(500);
    const snap = stats.snapshot();
    expect(snap.requests_by_status['2xx']).toBe(1);
    expect(snap.requests_by_status['4xx']).toBe(1);
    expect(snap.requests_by_status['5xx']).toBe(1);
  });

  it('records daily history', () => {
    stats.increment('requests_total');
    stats.increment('memory_writes');
    const snap = stats.snapshot();
    const today = new Date().toISOString().split('T')[0];
    expect(snap.daily_history).toBeDefined();
    expect(snap.daily_history[today]).toBeDefined();
    expect(snap.daily_history[today].requests_total).toBe(1);
  });

  it('reports uptime and started_at', () => {
    const snap = stats.snapshot();
    expect(snap.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(snap.started_at).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd aimeat && npx vitest run test/unit/stats.test.ts`
Expected: FAIL — module not found

**Step 3: Implement StatsCollector**

```typescript
// src/services/stats.ts

export interface StatsSnapshot {
  uptime_seconds: number;
  started_at: string;
  requests_total: number;
  requests_by_method: Record<string, number>;
  requests_by_status: Record<string, number>;
  memory_writes: number;
  memory_reads: number;
  consent_grants: number;
  consent_revocations: number;
  schema_validations: number;
  schema_validation_failures: number;
  daily_history: Record<string, Record<string, number>>;
}

const TRACKED_COUNTERS = [
  'requests_total', 'memory_writes', 'memory_reads',
  'consent_grants', 'consent_revocations',
  'schema_validations', 'schema_validation_failures',
] as const;

type CounterName = (typeof TRACKED_COUNTERS)[number];

export class StatsCollector {
  private counters = new Map<string, number>();
  private methods = new Map<string, number>();
  private statuses = new Map<string, number>();
  private dailyHistory = new Map<string, Map<string, number>>();
  private startedAt = new Date().toISOString();

  increment(name: CounterName): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + 1);
    // Also record in daily bucket
    const day = new Date().toISOString().split('T')[0];
    if (!this.dailyHistory.has(day)) this.dailyHistory.set(day, new Map());
    const dayMap = this.dailyHistory.get(day)!;
    dayMap.set(name, (dayMap.get(name) ?? 0) + 1);
  }

  incrementMethod(method: string): void {
    this.methods.set(method, (this.methods.get(method) ?? 0) + 1);
  }

  incrementStatus(code: number): void {
    const bucket = code < 400 ? '2xx' : code < 500 ? '4xx' : '5xx';
    this.statuses.set(bucket, (this.statuses.get(bucket) ?? 0) + 1);
  }

  snapshot(): StatsSnapshot {
    const daily: Record<string, Record<string, number>> = {};
    // Keep last 90 days max
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    for (const [day, counters] of this.dailyHistory) {
      if (day < cutoffStr) { this.dailyHistory.delete(day); continue; }
      daily[day] = Object.fromEntries(counters);
    }

    return {
      uptime_seconds: Math.floor((Date.now() - new Date(this.startedAt).getTime()) / 1000),
      started_at: this.startedAt,
      requests_total: this.counters.get('requests_total') ?? 0,
      requests_by_method: Object.fromEntries(this.methods),
      requests_by_status: Object.fromEntries(this.statuses),
      memory_writes: this.counters.get('memory_writes') ?? 0,
      memory_reads: this.counters.get('memory_reads') ?? 0,
      consent_grants: this.counters.get('consent_grants') ?? 0,
      consent_revocations: this.counters.get('consent_revocations') ?? 0,
      schema_validations: this.counters.get('schema_validations') ?? 0,
      schema_validation_failures: this.counters.get('schema_validation_failures') ?? 0,
      daily_history: daily,
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd aimeat && npx vitest run test/unit/stats.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add aimeat/src/services/stats.ts aimeat/test/unit/stats.test.ts
git commit -m "feat(stats): add lightweight StatsCollector service with daily history"
```

---

## Task 2: Usage Statistics — Middleware + Route + Config

**Files:**
- Create: `aimeat/src/middleware/stats.ts`
- Create: `aimeat/src/routes/stats.ts`
- Modify: `aimeat/src/config.ts` — add statsEnabled, statsAccess
- Modify: `aimeat/src/server.ts` — create StatsCollector, mount middleware + route
- Modify: `aimeat/.env.example` — document new env vars

**Step 1: Create stats middleware**

```typescript
// src/middleware/stats.ts
import type { Request, Response, NextFunction } from 'express';
import type { StatsCollector } from '../services/stats.js';

export function statsMiddleware(stats: StatsCollector) {
  return (req: Request, res: Response, next: NextFunction) => {
    stats.increment('requests_total');
    stats.incrementMethod(req.method);

    // Hook into response finish to capture status code
    res.on('finish', () => {
      stats.incrementStatus(res.statusCode);
    });

    next();
  };
}
```

**Step 2: Create stats route**

```typescript
// src/routes/stats.ts
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { StatsCollector } from '../services/stats.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';

export function statsRouter(config: AimeatConfig, storage: Storage, stats: StatsCollector): Router {
  const router = Router();

  router.get('/v1/stats', async (req, res) => {
    if (!config.statsEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Statistics are disabled'));
      return;
    }

    // Access control
    if (config.statsAccess === 'operator') {
      if (!req.auth?.roles?.includes('operator')) {
        res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Operator role required'));
        return;
      }
    } else if (config.statsAccess === 'authenticated') {
      if (!req.auth) {
        res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Authentication required'));
        return;
      }
    }
    // 'public' = no auth needed

    const snap = stats.snapshot();

    // Add live counts from storage
    const owners = await storage.listOwners();
    const agents = await storage.listAgents();

    res.json(success(config.nodeId, {
      ...snap,
      active_owners: owners.length,
      active_agents: agents.length,
    }));
  });

  return router;
}
```

**Step 3: Add config fields to `src/config.ts`**

Add after the site config section (~line 184):

```typescript
// Statistics
statsEnabled: boolean;
statsAccess: 'public' | 'authenticated' | 'operator';
```

In `loadConfig()`, add:

```typescript
statsEnabled: process.env.AIMEAT_STATS_ENABLED !== 'false',
statsAccess: (process.env.AIMEAT_STATS_ACCESS as 'public' | 'authenticated' | 'operator') ?? 'public',
```

**Step 4: Wire up in server.ts**

Add imports:
```typescript
import { StatsCollector } from './services/stats.js';
import { statsMiddleware } from './middleware/stats.js';
import { statsRouter } from './routes/stats.js';
```

Create instance after config load (before middleware chain):
```typescript
const stats = new StatsCollector();
```

Add middleware BEFORE rate limiting (after CORS, before optionalAuth):
```typescript
app.use(statsMiddleware(stats));
```

Mount route (after bootstrap router, early in chain):
```typescript
app.use(statsRouter(config, storage, stats));
```

Export `stats` so routes can call `stats.increment()` — pass as parameter to route factories that need it (memory, consent, schema routes).

**Step 5: Update .env.example**

```env
# ── Statistics ──
AIMEAT_STATS_ENABLED=true
AIMEAT_STATS_ACCESS=public          # public | authenticated | operator
```

**Step 6: Commit**

```bash
git add aimeat/src/middleware/stats.ts aimeat/src/routes/stats.ts aimeat/src/config.ts aimeat/src/server.ts aimeat/.env.example
git commit -m "feat(stats): add stats middleware, route, and config"
```

---

## Task 3: Usage Statistics — Instrument Routes

**Files:**
- Modify: `aimeat/src/routes/memory.ts` — add stats.increment calls
- Modify: `aimeat/src/routes/consent.ts` — add stats.increment calls
- Modify: `aimeat/src/routes/schemas.ts` — add stats.increment calls
- Modify: `aimeat/src/services/schema-validator.ts` — add stats.increment calls

**Step 1: Update route factory signatures**

Each route factory that needs stats must accept it as parameter:

```typescript
// memory.ts
export function memoryRouter(config: AimeatConfig, storage: Storage, stats?: StatsCollector): Router

// consent.ts
export function consentRouter(config: AimeatConfig, storage: Storage, stats?: StatsCollector): Router

// schemas.ts
export function schemaRouter(config: AimeatConfig, storage: Storage, stats?: StatsCollector): Router
```

**Step 2: Add increment calls**

In `memory.ts`:
- After successful `POST /v1/memory` (write): `stats?.increment('memory_writes')`
- After successful `PUT /v1/memory/:key` (update): `stats?.increment('memory_writes')`
- After successful `GET /v1/memory/:key` (read): `stats?.increment('memory_reads')`
- After successful `GET /v1/memory/:gaii/:key` (public read): `stats?.increment('memory_reads')`

In `consent.ts`:
- After successful `POST /v1/consent`: `stats?.increment('consent_grants')`
- After successful `DELETE /v1/consent/:id`: `stats?.increment('consent_revocations')`

In `schema-validator.ts` `validateMemoryWrite()`:
- After validation (pass or fail): `stats?.increment('schema_validations')`
- On failure: `stats?.increment('schema_validation_failures')`

Note: `validateMemoryWrite` needs the stats instance passed through. Simplest approach: add optional stats parameter to the function, or make StatsCollector a singleton exported from stats.ts.

**Recommended approach:** Export a singleton from stats.ts:

```typescript
// Add to src/services/stats.ts
let _instance: StatsCollector | null = null;
export function getStats(): StatsCollector | null { return _instance; }
export function initStats(): StatsCollector { _instance = new StatsCollector(); return _instance; }
```

Then in schema-validator.ts, import `getStats` and call `getStats()?.increment(...)` — no signature changes needed.

**Step 3: Update server.ts** to pass stats to route factories

```typescript
const stats = initStats();
// ...
app.use(memoryRouter(config, storage, stats));
app.use(consentRouter(config, storage, stats));
// schemaRouter uses getStats() internally via schema-validator
```

**Step 4: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add aimeat/src/routes/memory.ts aimeat/src/routes/consent.ts aimeat/src/routes/schemas.ts aimeat/src/services/schema-validator.ts aimeat/src/services/stats.ts aimeat/src/server.ts
git commit -m "feat(stats): instrument memory, consent, and schema routes with counters"
```

---

## Task 4: Usage Statistics — Admin Dashboard Panel

**Files:**
- Modify: `aimeat/src/routes/admin-dashboard.ts` — add stats nav item + page + Chart.js charts
- Modify: `aimeat/locales/en.json` — add stats translations
- Modify: `aimeat/locales/fi.json` — add stats translations

**Step 1: Add translations**

In `locales/en.json`, add under `"dashboard"`:
```json
"stats": "Statistics",
"statsNotAvailable": "Statistics are disabled",
"requestsTotal": "Total Requests",
"memoryWrites": "Memory Writes",
"memoryReads": "Memory Reads",
"consentGrants": "Consent Grants",
"schemaValidations": "Schema Validations",
"dailyActivity": "Daily Activity",
"weeklyTrend": "Weekly Trend (last 4 weeks)",
"monthlyTrend": "Monthly Trend",
"statsExplain": "Lightweight usage counters. Resets on server restart."
```

In `locales/fi.json`, add equivalent Finnish translations.

**Step 2: Add nav item**

In admin-dashboard.ts sidebar HTML, add under the Node group (after hooks, before Identity):

```html
<button class="nav-item" data-page="stats" onclick="nav('stats')"><span class="icon">&#x1F4C8;</span><span class="label">${t('dashboard.stats')}</span></button>
```

**Step 3: Add stats page renderer in the dashboard JS**

The admin dashboard uses a `renderPage(page)` function pattern. Add a `renderStats(data)` function that:

1. Shows top-level counter cards (requests, writes, reads, consents, validations)
2. Loads Chart.js from CDN: `https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js`
3. Renders a **daily activity bar chart** (last 30 days)
4. Renders a **weekly comparison line chart** (last 4 weeks overlaid)
5. Renders a **monthly summary bar chart** (last 3 months)

The daily_history data from the stats endpoint provides the data source. Group by week/month client-side.

**Chart.js loading:** Add a lazy-load helper that injects the script tag once:

```javascript
function loadChartJs() {
  return new Promise((resolve) => {
    if (window.Chart) return resolve();
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
    s.onload = resolve;
    document.head.appendChild(s);
  });
}
```

**Step 4: Add the stats page HTML/JS template**

Stats card grid (4 cards): total requests, memory ops, consent ops, schema validations.

Below cards: 3 chart canvases in a `grid-2` layout:
- Daily activity (last 30 days) — stacked bar chart with requests/writes/reads
- Weekly comparison — line chart overlaying 4 weeks
- Monthly totals — bar chart for last 3 months

**Step 5: Fetch data**

In the dashboard's `loadAll()` / per-page fetch, add:
```javascript
if (currentPage === 'stats') {
  const r = await api('/v1/stats');
  if (r.ok) renderStats(r.data);
}
```

**Step 6: Commit**

```bash
git add aimeat/src/routes/admin-dashboard.ts aimeat/locales/en.json aimeat/locales/fi.json
git commit -m "feat(stats): add statistics panel with Chart.js charts to admin dashboard"
```

---

## Task 5: Consent Check in Public Memory Reads

**Files:**
- Modify: `aimeat/src/routes/memory.ts:327-347` — add consent check + audit
- Create: `aimeat/test/unit/consent.test.ts` — unit tests for consent logic

**Step 1: Write unit tests for consent matching**

```typescript
// test/unit/consent.test.ts
import { describe, it, expect } from 'vitest';
import { consentMatchPattern } from '../../src/storage/memory.js';

describe('consentMatchPattern', () => {
  it('matches exact keys', () => {
    expect(consentMatchPattern('profile.alice.interests', 'profile.alice.interests')).toBe(true);
    expect(consentMatchPattern('profile.alice.interests', 'profile.bob.interests')).toBe(false);
  });

  it('matches single-segment wildcard *', () => {
    expect(consentMatchPattern('profile.*.interests', 'profile.alice.interests')).toBe(true);
    expect(consentMatchPattern('profile.*.interests', 'profile.bob.interests')).toBe(true);
    expect(consentMatchPattern('profile.*', 'profile.alice')).toBe(true);
    expect(consentMatchPattern('profile.*', 'profile.alice.interests')).toBe(false);
  });

  it('matches multi-segment wildcard **', () => {
    expect(consentMatchPattern('iot.**', 'iot.temp.bedroom')).toBe(true);
    expect(consentMatchPattern('iot.**', 'iot.humidity')).toBe(true);
    expect(consentMatchPattern('iot.**', 'other.data')).toBe(false);
  });

  it('handles edge cases', () => {
    expect(consentMatchPattern('*', 'anything')).toBe(true);
    expect(consentMatchPattern('a.b.c', 'a.b.c')).toBe(true);
    expect(consentMatchPattern('a.b.c', 'a.b.d')).toBe(false);
  });
});
```

**Step 2: Run test to verify it passes** (consentMatchPattern already exists)

Run: `cd aimeat && npx vitest run test/unit/consent.test.ts`
Expected: PASS (function already implemented in memory.ts)

**Step 3: Write unit tests for checkConsentForRead**

Add to same test file:

```typescript
// These test the consent service logic
// Use a mock storage or the in-memory storage for integration-style unit tests
import { checkConsentForRead } from '../../src/services/consent.js';
import { InMemoryStorage } from '../../src/storage/memory.js';

describe('checkConsentForRead', () => {
  it('allows public data without consent', async () => {
    const storage = new InMemoryStorage();
    const result = await checkConsentForRead(storage, 'key', 'owner', 'reader', 'public');
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('public_data');
  });

  it('allows owner to read own data', async () => {
    const storage = new InMemoryStorage();
    const result = await checkConsentForRead(storage, 'key', 'alice#app@node', 'alice#app@node', 'private');
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('owner_access');
  });

  it('denies private data without consent', async () => {
    const storage = new InMemoryStorage();
    const result = await checkConsentForRead(storage, 'key', 'alice#app@node', 'bob#app@node', 'private');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('no_matching_consent');
  });

  it('allows with matching consent', async () => {
    const storage = new InMemoryStorage();
    await storage.createConsent({
      id: 'c1', ownerGaii: 'alice#app@node', dataPattern: 'profile.*',
      recipient: '*', purpose: 'test', scope: 'federation',
      expires: null, status: 'active', grantedAt: new Date().toISOString(), revokedAt: null,
    });
    const result = await checkConsentForRead(storage, 'profile.bio', 'alice#app@node', 'bob#app@node', 'owner');
    expect(result.allowed).toBe(true);
    expect(result.consentId).toBe('c1');
  });
});
```

**Step 4: Run tests**

Run: `cd aimeat && npx vitest run test/unit/consent.test.ts`
Expected: PASS

**Step 5: Update public memory read endpoint**

In `src/routes/memory.ts`, modify `GET /v1/memory/:gaii/:key` (lines 327-347):

```typescript
router.get('/v1/memory/:gaii/:key', async (req, res) => {
  const gaii = decodeURIComponent(req.params.gaii as string);
  const key = decodeURIComponent(req.params.key as string);

  const record = await storage.getMemory(gaii, key);
  if (!record) {
    res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Memory not found: ${key}`));
    return;
  }

  stats?.increment('memory_reads');

  // Public data — always accessible
  if (record.visibility === 'public') {
    if (config.consentEnabled) {
      await auditDataAccess(storage, null, record.ownerGaii, req.auth?.sub ?? 'anonymous', key, 'read', true);
    }
    res.json(success(config.nodeId, {
      key: record.key, value: record.value, visibility: record.visibility,
      tags: record.tags, version: record.version, owner_gaii: record.ownerGaii,
      created_at: record.createdAt, updated_at: record.updatedAt,
    }));
    return;
  }

  // Non-public data — check consent
  if (!config.consentEnabled) {
    // Consent disabled — fall back to visibility-only check (deny non-public)
    res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Public memory not found: ${key}`));
    return;
  }

  const accessorGaii = req.auth?.sub ?? 'anonymous';
  const consentCheck = await checkConsentForRead(storage, key, record.ownerGaii, accessorGaii, record.visibility);
  await auditDataAccess(storage, consentCheck.consentId ?? null, record.ownerGaii, accessorGaii, key, 'read', consentCheck.allowed);

  if (!consentCheck.allowed) {
    res.status(403).json(error(config.nodeId, 'CONSENT_REQUIRED', 'No active consent for this data'));
    return;
  }

  res.json(success(config.nodeId, {
    key: record.key, value: record.value, visibility: record.visibility,
    tags: record.tags, version: record.version, owner_gaii: record.ownerGaii,
    created_at: record.createdAt, updated_at: record.updatedAt,
  }));
});
```

Add imports at top of memory.ts:
```typescript
import { checkConsentForRead, auditDataAccess } from '../services/consent.js';
```

**Step 6: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add aimeat/src/routes/memory.ts aimeat/test/unit/consent.test.ts
git commit -m "feat(consent): integrate consent check and audit logging into public memory reads"
```

---

## Task 6: Zod Validation for Schema PUT

**Files:**
- Modify: `aimeat/src/routes/schemas.ts:12-25` — use SchemaSetSchema from models

**Step 1: Update PUT handler to use Zod**

The `SchemaSetSchema` already exists in `src/models/schemas.ts:258-262`. Replace the raw validation in schemas.ts:

```typescript
// At top of file, add import:
import { SchemaSetSchema } from '../models/schemas.js';

// In PUT handler, replace lines 20-25 with:
const parsed = SchemaSetSchema.safeParse(req.body);
if (!parsed.success) {
  res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Invalid request body', 400, {
    violations: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
  }));
  return;
}
const { schema, apply_to, schema_mode } = parsed.data;
const semantic_context = req.body?.semantic_context;
```

**Step 2: Run type check + existing tests**

Run: `cd aimeat && npx tsc --noEmit`
Run: `cd aimeat && npx vitest run test/unit/schema-validator.test.ts`
Expected: No errors, tests pass

**Step 3: Commit**

```bash
git add aimeat/src/routes/schemas.ts
git commit -m "fix(schemas): use Zod SchemaSetSchema for PUT validation"
```

---

## Task 7: DMZ Architecture Document + Zone Field

**Files:**
- Create: `aimeat/docs/aimeat-dmz-architecture.md`
- Modify: `aimeat/src/routes/memory.ts` — add zone field to responses

**Step 1: Write DMZ architecture document**

Create `docs/aimeat-dmz-architecture.md` that formalizes:

1. **Three zones:** Private Zone, DMZ, Federation
2. **Visibility-to-zone mapping:**
   - `private` → Private Zone (data never leaves node)
   - `owner` → DMZ (controlled sharing, consent-governed)
   - `public` / `federation` → Federation (visible to all federated nodes)
3. **Consent Layer integration:** How consent governs DMZ crossing
4. **Data flow diagram:** Private → (consent) → DMZ → (protocol) → Federation
5. **Security model:** What can and cannot cross each boundary

Content should synthesize `docs/nextlevel/aimeat-dmz-concept.md` and `docs/plans/phase-0.6-dmz-architecture.md` into a standalone spec.

**Step 2: Add zone field to memory responses**

In `src/routes/memory.ts`, add a helper function:

```typescript
function visibilityToZone(visibility: string): 'private' | 'dmz' | 'federation' {
  switch (visibility) {
    case 'private': return 'private';
    case 'owner': return 'dmz';
    case 'public': return 'federation';
    default: return 'private';
  }
}
```

Add `zone: visibilityToZone(record.visibility)` to all memory GET response objects.

**Step 3: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add aimeat/docs/aimeat-dmz-architecture.md aimeat/src/routes/memory.ts
git commit -m "docs(dmz): formalize DMZ architecture; add zone field to memory responses"
```

---

## Task 8: Semantic Ontology E2E Tests

**Files:**
- Modify: `aimeat/test/e2e-phase0.ts` — add Phase 0.7 semantic test section

**Step 1: Add semantic tests to e2e-phase0.ts**

Add a new section after Phase 0.5 tests:

```typescript
// ── Phase 0.7: Semantic Ontology ──

// Test: Register action with semantic annotation
// POST /v1/actions with semantic field → 200, semantic preserved in response
// GET /v1/actions/{id} → semantic field returned

// Test: Create board with semantic context
// POST /v1/boards with semantic → 200, semantic in response

// Test: Set schema with semantic_context
// PUT /v1/memory/:key/schema with semantic_context → 200, preserved

// Test: Invalid semantic annotation (non-object @context) → 422 or ignored gracefully
```

Implement 4 tests covering semantic annotation on different resource types.

**Step 2: Run E2E tests**

Run: `cd aimeat && npx tsx test/e2e-phase0.ts` (with server running on :40251)
Expected: All pass

**Step 3: Commit**

```bash
git add aimeat/test/e2e-phase0.ts
git commit -m "test(semantic): add Phase 0.7 semantic annotation E2E tests"
```

---

## Task 9: OpenAPI Specification Updates

**Files:**
- Modify: `aimeat/openapi.yaml` — add/update endpoint documentation for stats, semantic fields

**Step 1: Check existing openapi.yaml coverage**

From exploration: consent, TOTP, and CSM endpoints are already documented. Stats endpoint exists as stub (line 4037). Need to:

1. **Update GET /v1/stats** — add full response schema with all counter fields + daily_history
2. **Add semantic field documentation** — add `semantic` field to Action, Board, BoardPost, Schema response schemas
3. **Verify consent audit response** matches actual implementation
4. **Add zone field** to memory response schemas

**Step 2: Update openapi.yaml**

Add response schema for `/v1/stats`:
```yaml
StatsResponse:
  type: object
  properties:
    uptime_seconds: { type: integer }
    started_at: { type: string, format: date-time }
    requests_total: { type: integer }
    requests_by_method: { type: object, additionalProperties: { type: integer } }
    requests_by_status: { type: object, additionalProperties: { type: integer } }
    memory_writes: { type: integer }
    memory_reads: { type: integer }
    consent_grants: { type: integer }
    consent_revocations: { type: integer }
    schema_validations: { type: integer }
    schema_validation_failures: { type: integer }
    active_owners: { type: integer }
    active_agents: { type: integer }
    daily_history:
      type: object
      additionalProperties:
        type: object
        additionalProperties: { type: integer }
```

Add `semantic` field to relevant schemas. Add `zone` to MemoryEntry response schema.

**Step 3: Commit**

```bash
git add aimeat/openapi.yaml
git commit -m "docs(openapi): update stats response schema, add semantic + zone fields"
```

---

## Task 10: Hobby Directory — Task List Item (Phase 1.6)

**No implementation in this plan.** This is a Phase 1 vertical slice that requires:
- Phase 1.3 (GHII registration + portal) — in progress
- Phase 1.4 (directory endpoints) — directory service exists, needs route
- CSM hobby-directory.csm.yaml template — exists
- Email notifications — service exists

Create a separate plan document for Phase 1.6 when 1.3 and 1.4 are ready.

---

## Execution Order

```
Task 1 (stats service + tests) ──→ Task 2 (middleware + route + config)
                                    ──→ Task 3 (instrument routes)
                                    ──→ Task 4 (dashboard charts)

Task 5 (consent in memory reads + unit tests) — independent

Task 6 (Zod for schema PUT) — independent

Task 7 (DMZ doc + zone field) — independent

Task 8 (semantic E2E tests) — independent

Task 9 (openapi updates) — depends on Tasks 2, 5, 7

Tasks 1-4 can run parallel with Tasks 5-8.
Task 9 should be last.
```

## Verification

After all tasks complete:
1. `cd aimeat && npx tsc --noEmit` — zero errors
2. `cd aimeat && npx vitest run` — all unit tests pass
3. `cd aimeat && npx tsx test/e2e-phase0.ts` — all E2E tests pass (server on :40251)
4. Manual: open admin dashboard → navigate to Statistics → verify charts render
