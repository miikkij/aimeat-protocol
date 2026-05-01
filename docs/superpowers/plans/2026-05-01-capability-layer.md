# Capability Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a unified capability abstraction layer on top of existing AIMEAT systems (extensions, actions, cortex) with discovery, invoke proxy, SDK library, MCP tools, and admin/profile UI.

**Architecture:** Four phases, each producing working testable software. Phase 1 is the foundation (types, storage, REST API, aggregator). Phase 2 adds SDK + MCP. Phase 3 adds security + billing. Phase 4 adds UI. Phases 2 and 3 are independent; Phase 4 depends on all.

**Tech Stack:** TypeScript (Express 5, better-sqlite3, Prisma/MongoDB), Preact + HTM (no build step), MCP JSON-RPC

**Spec:** `docs/superpowers/specs/2026-05-01-capability-layer-design.md`

**Codebase conventions:**
- All source under `aimeat/` prefix
- Repository interfaces in `src/storage/repositories/*.repository.ts`
- Types in `src/storage/interface.ts`
- SQLite: methods inline in `src/storage/providers/sqlite/index.ts` (5200+ line monolith), schema in `schema.ts`
- Routes mounted in `src/server-bootstrap/routes-loader.ts`
- MCP tools: `register*Tools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged)`
- Background jobs seeded in `src/services/job-seeding.ts`
- i18n: `locales/en.json` + `locales/fi.json`, nested objects with camelCase keys
- E2E tests: standalone scripts in `test/e2e-*.ts` with inline boilerplate
- Unit tests: Vitest in `test/unit/*.test.ts`

---

# Phase 1: Foundation

**Delivers:** Types, storage (SQLite + MongoDB), REST API (CRUD + discovery + invoke), aggregator background job, E2E tests, unit tests.

---

### Task 1.1: Types and Repository Interface

**Files:**
- Create: `aimeat/src/storage/repositories/capability.repository.ts`
- Modify: `aimeat/src/storage/interface.ts`
- Modify: `aimeat/src/storage/repositories/index.ts`

- [ ] **Step 1: Define CapabilityRecord and CapabilityLogEntry in interface.ts**

Add at the end of the types section in `aimeat/src/storage/interface.ts`:

```typescript
// ── Capability Layer ──

export interface CapabilitySource {
  type: 'extension' | 'action' | 'cortex' | 'app' | 'manual';
  ref: string;
  version: string;
}

export interface CapabilityExport {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  example: { input: Record<string, unknown>; output: Record<string, unknown> } | null;
}

export interface CapabilityDependency {
  type: 'sdk' | 'capability';
  id: string;
  required: boolean;
  minVersion: string | null;
}

export interface CapabilityTrust {
  operatorReviewed: boolean;
  reviewedAt: string | null;
  vouchCount: number;
  publisherTrustScore: number;
  codeAudited: boolean;
  auditNotes: string | null;
}

export interface CapabilityStats {
  totalInvocations: number;
  successCount: number;
  errorCount: number;
  lastInvokedAt: string | null;
  avgResponseMs: number;
  lastError: string | null;
}

export interface CapabilityOverride {
  summary?: string;
  visibility?: 'private' | 'owner' | 'public';
  disabled?: boolean;
  notes?: string;
}

export interface CapabilityRecord {
  id: string;
  name: string;
  summary: string;
  ownerGhii: string;
  visibility: 'private' | 'owner' | 'public';
  scope: 'local';
  status: 'draft' | 'pending_review' | 'active' | 'deprecated' | 'rejected' | 'disabled';
  rejectionReason: string | null;
  deprecationMessage: string | null;
  replacedBy: string | null;
  source: CapabilitySource;
  authRequired: 'none' | 'anonymous' | 'registered';
  callable: boolean;
  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
  exports: CapabilityExport[] | null;
  usage: string;
  whenToUse: string;
  whenNotToUse: string;
  examples: Array<{ description: string; input: Record<string, unknown>; output: Record<string, unknown> }>;
  dependencies: CapabilityDependency[];
  schemaHash: string;
  webhookUrl: string | null;
  cost: { morsels: number; perUnit?: string } | null;
  trustRequired: number | null;
  trust: CapabilityTrust;
  redactedFields: string[];
  operatorOverride: CapabilityOverride | null;
  stats: CapabilityStats;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityLogEntry {
  id: string;
  capabilityId: string;
  callerGhii: string;
  input: Record<string, unknown>;
  status: 'success' | 'error';
  durationMs: number;
  error: string | null;
  timestamp: string;
}
```

- [ ] **Step 2: Create the repository interface**

Create `aimeat/src/storage/repositories/capability.repository.ts`:

```typescript
import type { CapabilityRecord, CapabilityLogEntry, CapabilityOverride, CapabilityTrust } from '../interface.js';

export interface CapabilityRepository {
  createCapability(record: CapabilityRecord): Promise<CapabilityRecord>;
  getCapability(id: string): Promise<CapabilityRecord | null>;
  updateCapability(id: string, updates: Partial<CapabilityRecord>): Promise<CapabilityRecord | null>;
  deleteCapability(id: string): Promise<boolean>;

  listCapabilities(filters: {
    ownerGhii?: string;
    visibility?: string;
    status?: string;
    sourceType?: string;
    callable?: boolean;
    authRequired?: string;
    tags?: string[];
    search?: string;
    page?: number;
    perPage?: number;
  }): Promise<{ capabilities: CapabilityRecord[]; total: number }>;

  listCapabilitiesByOwner(ownerGhii: string): Promise<CapabilityRecord[]>;
  getCapabilityBySourceRef(sourceRef: string): Promise<CapabilityRecord | null>;
  listCapabilitiesBySourceType(sourceType: string): Promise<CapabilityRecord[]>;

  incrementCapabilityStats(id: string, delta: {
    success: number; error: number; totalMs: number; lastError?: string;
  }): Promise<void>;

  addCapabilityLog(entry: CapabilityLogEntry): Promise<void>;
  listCapabilityLogs(capabilityId: string, filters: {
    status?: 'success' | 'error';
    page?: number;
    perPage?: number;
  }): Promise<{ logs: CapabilityLogEntry[]; total: number }>;
  deleteCapabilityLogsBefore(before: string): Promise<number>;

  setCapabilityOverride(id: string, override: CapabilityOverride | null): Promise<void>;
  setCapabilityTrust(id: string, trust: Partial<CapabilityTrust>): Promise<void>;
  incrementVouchCount(id: string): Promise<void>;
  decrementVouchCount(id: string): Promise<void>;
}
```

- [ ] **Step 3: Add to barrel export and Storage intersection type**

In `aimeat/src/storage/repositories/index.ts`, add:
```typescript
export type { CapabilityRepository } from './capability.repository.js';
```

In `aimeat/src/storage/interface.ts`, add `CapabilityRepository` to the `Storage` intersection type:
```typescript
export interface Storage extends
  OwnerRepository, AgentRepository, /* ... existing ... */
  PackageRepository, TemplateListingRepository, PackageInstanceRepository,
  CapabilityRepository { }
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: FAIL (SqliteStorage and MongoStorage don't implement the new methods yet). This is expected.

- [ ] **Step 5: Commit**

```
git add aimeat/src/storage/repositories/capability.repository.ts aimeat/src/storage/interface.ts aimeat/src/storage/repositories/index.ts
git commit -m "feat(capability): add types and repository interface"
```

---

### Task 1.2: SQLite Schema and Implementation

**Files:**
- Modify: `aimeat/src/storage/providers/sqlite/schema.ts`
- Modify: `aimeat/src/storage/providers/sqlite/index.ts`
- Test: `aimeat/test/unit/capability-storage.test.ts`

- [ ] **Step 1: Write unit tests**

Create `aimeat/test/unit/capability-storage.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { CapabilityRecord } from '../../src/storage/interface.js';

function makeCap(overrides: Partial<CapabilityRecord> = {}): CapabilityRecord {
  const id = 'cap-' + Math.random().toString(36).slice(2, 8);
  return {
    id,
    name: 'Test Cap',
    summary: 'A test capability',
    ownerGhii: 'testuser@test-node',
    visibility: 'public',
    scope: 'local',
    status: 'active',
    rejectionReason: null,
    deprecationMessage: null,
    replacedBy: null,
    source: { type: 'manual', ref: 'manual', version: '1.0.0' },
    authRequired: 'registered',
    callable: true,
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { r: { type: 'string' } } },
    exports: null,
    usage: 'AIMEAT.capabilities.invoke("' + id + '", { q: "hi" })',
    whenToUse: 'When testing',
    whenNotToUse: 'In production',
    examples: [{ description: 'Basic', input: { q: 'hi' }, output: { r: 'hello' } }],
    dependencies: [],
    schemaHash: 'abc123',
    webhookUrl: null,
    cost: null,
    trustRequired: null,
    trust: { operatorReviewed: false, reviewedAt: null, vouchCount: 0, publisherTrustScore: 0, codeAudited: false, auditNotes: null },
    redactedFields: [],
    operatorOverride: null,
    stats: { totalInvocations: 0, successCount: 0, errorCount: 0, lastInvokedAt: null, avgResponseMs: 0, lastError: null },
    tags: ['test'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('CapabilityRepository (SQLite)', () => {
  let s: SqliteStorage;
  beforeEach(() => { s = new SqliteStorage(':memory:'); });

  it('create and retrieve', async () => {
    const cap = makeCap();
    const created = await s.createCapability(cap);
    expect(created.id).toBe(cap.id);
    const got = await s.getCapability(cap.id);
    expect(got).not.toBeNull();
    expect(got!.name).toBe('Test Cap');
    expect(got!.source.type).toBe('manual');
    expect(got!.inputSchema).toEqual(cap.inputSchema);
  });

  it('get returns null for non-existent', async () => {
    expect(await s.getCapability('nope')).toBeNull();
  });

  it('list with filters', async () => {
    await s.createCapability(makeCap({ visibility: 'public', status: 'active', callable: true, tags: ['weather'] }));
    await s.createCapability(makeCap({ visibility: 'private', status: 'draft', callable: false, tags: ['internal'] }));

    const { capabilities: all } = await s.listCapabilities({});
    expect(all).toHaveLength(2);

    const { capabilities: pub } = await s.listCapabilities({ visibility: 'public' });
    expect(pub).toHaveLength(1);

    const { capabilities: callableOnly } = await s.listCapabilities({ callable: true });
    expect(callableOnly).toHaveLength(1);

    const { capabilities: tagged } = await s.listCapabilities({ tags: ['weather'] });
    expect(tagged).toHaveLength(1);
  });

  it('list by owner', async () => {
    await s.createCapability(makeCap({ ownerGhii: 'alice@node' }));
    await s.createCapability(makeCap({ ownerGhii: 'bob@node' }));
    const aliceCaps = await s.listCapabilitiesByOwner('alice@node');
    expect(aliceCaps).toHaveLength(1);
  });

  it('search by name', async () => {
    await s.createCapability(makeCap({ name: 'Weather Finland' }));
    await s.createCapability(makeCap({ name: 'Recipe Manager' }));
    const { capabilities } = await s.listCapabilities({ search: 'weather' });
    expect(capabilities).toHaveLength(1);
    expect(capabilities[0].name).toBe('Weather Finland');
  });

  it('update', async () => {
    const cap = makeCap();
    await s.createCapability(cap);
    const updated = await s.updateCapability(cap.id, { summary: 'Updated summary' });
    expect(updated).not.toBeNull();
    expect(updated!.summary).toBe('Updated summary');
    const got = await s.getCapability(cap.id);
    expect(got!.summary).toBe('Updated summary');
  });

  it('update non-existent returns null', async () => {
    expect(await s.updateCapability('nope', { summary: 'x' })).toBeNull();
  });

  it('delete', async () => {
    const cap = makeCap();
    await s.createCapability(cap);
    expect(await s.deleteCapability(cap.id)).toBe(true);
    expect(await s.getCapability(cap.id)).toBeNull();
  });

  it('delete non-existent returns false', async () => {
    expect(await s.deleteCapability('nope')).toBe(false);
  });

  it('getBySourceRef', async () => {
    await s.createCapability(makeCap({ source: { type: 'extension', ref: 'ext:weather:get', version: '1.0' } }));
    const found = await s.getCapabilityBySourceRef('ext:weather:get');
    expect(found).not.toBeNull();
    expect(found!.source.ref).toBe('ext:weather:get');
  });

  it('incrementStats', async () => {
    const cap = makeCap();
    await s.createCapability(cap);
    await s.incrementCapabilityStats(cap.id, { success: 3, error: 1, totalMs: 600, lastError: 'timeout' });
    const got = await s.getCapability(cap.id);
    expect(got!.stats.successCount).toBe(3);
    expect(got!.stats.errorCount).toBe(1);
    expect(got!.stats.totalInvocations).toBe(4);
    expect(got!.stats.lastError).toBe('timeout');
  });

  it('addLog and listLogs', async () => {
    const cap = makeCap();
    await s.createCapability(cap);
    await s.addCapabilityLog({
      id: 'log-1', capabilityId: cap.id, callerGhii: 'alice@node',
      input: { q: 'test' }, status: 'success', durationMs: 50, error: null,
      timestamp: new Date().toISOString(),
    });
    await s.addCapabilityLog({
      id: 'log-2', capabilityId: cap.id, callerGhii: 'alice@node',
      input: { q: 'fail' }, status: 'error', durationMs: 100, error: 'boom',
      timestamp: new Date().toISOString(),
    });
    const { logs, total } = await s.listCapabilityLogs(cap.id, {});
    expect(total).toBe(2);
    expect(logs).toHaveLength(2);

    const { logs: errors } = await s.listCapabilityLogs(cap.id, { status: 'error' });
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toBe('boom');
  });

  it('deleteLogsBefore', async () => {
    const cap = makeCap();
    await s.createCapability(cap);
    const old = '2020-01-01T00:00:00Z';
    const recent = new Date().toISOString();
    await s.addCapabilityLog({ id: 'old', capabilityId: cap.id, callerGhii: 'a@n', input: {}, status: 'success', durationMs: 1, error: null, timestamp: old });
    await s.addCapabilityLog({ id: 'new', capabilityId: cap.id, callerGhii: 'a@n', input: {}, status: 'success', durationMs: 1, error: null, timestamp: recent });
    const deleted = await s.deleteCapabilityLogsBefore('2025-01-01T00:00:00Z');
    expect(deleted).toBe(1);
    const { total } = await s.listCapabilityLogs(cap.id, {});
    expect(total).toBe(1);
  });

  it('setOverride', async () => {
    const cap = makeCap();
    await s.createCapability(cap);
    await s.setCapabilityOverride(cap.id, { disabled: true, notes: 'Testing' });
    const got = await s.getCapability(cap.id);
    expect(got!.operatorOverride).toEqual({ disabled: true, notes: 'Testing' });
  });

  it('setTrust and vouchCount', async () => {
    const cap = makeCap();
    await s.createCapability(cap);
    await s.setCapabilityTrust(cap.id, { operatorReviewed: true, reviewedAt: new Date().toISOString() });
    await s.incrementVouchCount(cap.id);
    await s.incrementVouchCount(cap.id);
    const got = await s.getCapability(cap.id);
    expect(got!.trust.operatorReviewed).toBe(true);
    expect(got!.trust.vouchCount).toBe(2);
    await s.decrementVouchCount(cap.id);
    const got2 = await s.getCapability(cap.id);
    expect(got2!.trust.vouchCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/capability-storage.test.ts`
Expected: FAIL (SqliteStorage has no capability methods)

- [ ] **Step 3: Add SQLite schema**

In `aimeat/src/storage/providers/sqlite/schema.ts`, add before the closing `);` of the `db.exec()` template:

```sql
-- Capabilities
CREATE TABLE IF NOT EXISTS capabilities (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  summary           TEXT NOT NULL DEFAULT '',
  ownerGhii         TEXT NOT NULL,
  visibility        TEXT NOT NULL DEFAULT 'private',
  scope             TEXT NOT NULL DEFAULT 'local',
  status            TEXT NOT NULL DEFAULT 'draft',
  rejectionReason   TEXT,
  deprecationMessage TEXT,
  replacedBy        TEXT,
  sourceType        TEXT NOT NULL,
  sourceRef         TEXT NOT NULL,
  sourceVersion     TEXT NOT NULL DEFAULT '',
  authRequired      TEXT NOT NULL DEFAULT 'registered',
  callable          INTEGER NOT NULL DEFAULT 0,
  inputSchema       TEXT DEFAULT '{}',
  outputSchema      TEXT DEFAULT '{}',
  exports           TEXT,
  usage             TEXT NOT NULL DEFAULT '',
  whenToUse         TEXT NOT NULL DEFAULT '',
  whenNotToUse      TEXT NOT NULL DEFAULT '',
  examples          TEXT NOT NULL DEFAULT '[]',
  dependencies      TEXT NOT NULL DEFAULT '[]',
  schemaHash        TEXT NOT NULL DEFAULT '',
  webhookUrl        TEXT,
  cost              TEXT,
  trustRequired     REAL,
  trust             TEXT NOT NULL DEFAULT '{"operatorReviewed":false,"reviewedAt":null,"vouchCount":0,"publisherTrustScore":0,"codeAudited":false,"auditNotes":null}',
  redactedFields    TEXT NOT NULL DEFAULT '[]',
  operatorOverride  TEXT,
  stats             TEXT NOT NULL DEFAULT '{"totalInvocations":0,"successCount":0,"errorCount":0,"lastInvokedAt":null,"avgResponseMs":0,"lastError":null}',
  tags              TEXT NOT NULL DEFAULT '[]',
  createdAt         TEXT NOT NULL,
  updatedAt         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_capabilities_owner ON capabilities(ownerGhii);
CREATE INDEX IF NOT EXISTS idx_capabilities_source ON capabilities(sourceType, sourceRef);
CREATE INDEX IF NOT EXISTS idx_capabilities_status ON capabilities(status);
CREATE INDEX IF NOT EXISTS idx_capabilities_visibility ON capabilities(visibility);

CREATE TABLE IF NOT EXISTS capability_logs (
  id            TEXT PRIMARY KEY,
  capabilityId  TEXT NOT NULL,
  callerGhii    TEXT NOT NULL,
  input         TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL,
  durationMs    INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  timestamp     TEXT NOT NULL,
  FOREIGN KEY (capabilityId) REFERENCES capabilities(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_capability_logs_cap ON capability_logs(capabilityId, timestamp);
CREATE INDEX IF NOT EXISTS idx_capability_logs_status ON capability_logs(capabilityId, status);

CREATE TABLE IF NOT EXISTS capability_vouches (
  capabilityId  TEXT NOT NULL,
  userGhii      TEXT NOT NULL,
  comment       TEXT,
  createdAt     TEXT NOT NULL,
  PRIMARY KEY (capabilityId, userGhii),
  FOREIGN KEY (capabilityId) REFERENCES capabilities(id) ON DELETE CASCADE
);
```

- [ ] **Step 4: Implement capability methods in SqliteStorage**

Add the following methods to the `SqliteStorage` class in `aimeat/src/storage/providers/sqlite/index.ts`. Add a `deserializeCapability` private method and all `CapabilityRepository` methods following the same inline pattern as existing methods (e.g., `createOwner`, `getAction`).

The implementation follows the spec exactly. Key details:
- `deserializeCapability(row)` uses `JSON.parse()` for all TEXT-stored JSON fields
- `callable` stored as INTEGER (0/1), convert to boolean
- `source` stored as separate columns `sourceType`, `sourceRef`, `sourceVersion`, reassembled in deserialize
- `listCapabilities` fetches all matching rows, filters `search` in JS (case-insensitive on name, summary, tags), paginates with `.slice()`
- `incrementCapabilityStats` does read-modify-write: reads existing stats, merges delta, writes back
- `incrementVouchCount`/`decrementVouchCount` updates the `trust` JSON field

This step is large (~300 lines). The full implementation code should follow the existing patterns visible in the SqliteStorage class. Each method maps 1:1 to the repository interface.

- [ ] **Step 5: Run unit tests**

Run: `npx vitest run test/unit/capability-storage.test.ts`
Expected: All 14 tests PASS

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: FAIL (MongoStorage doesn't implement yet - add stub methods that throw 'Not implemented')

- [ ] **Step 7: Commit**

```
git add aimeat/src/storage/providers/sqlite/schema.ts aimeat/src/storage/providers/sqlite/index.ts aimeat/test/unit/capability-storage.test.ts
git commit -m "feat(capability): SQLite storage implementation with unit tests"
```

---

### Task 1.3: MongoDB Implementation

**Files:**
- Modify: `aimeat/src/storage/providers/mongodb/index.ts` (or equivalent Prisma-based file)
- Modify: Prisma schema if used

- [ ] **Step 1: Implement all CapabilityRepository methods for MongoDB**

Follow the same interface, using Prisma operations. Collection: `capabilities`. Log collection: `capabilityLogs`. Vouch collection: `capabilityVouches`.

- `listCapabilities` uses `$regex` for search on name and summary
- `incrementCapabilityStats` uses `$inc` for atomic increment
- All JSON fields are stored as native MongoDB objects (no JSON.parse needed)

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (both backends now implement the interface)

- [ ] **Step 3: Commit**

```
git commit -m "feat(capability): MongoDB storage implementation"
```

---

### Task 1.4: REST API - Discovery and CRUD

**Files:**
- Create: `aimeat/src/routes/capabilities.ts`
- Modify: `aimeat/src/server-bootstrap/routes-loader.ts`

- [ ] **Step 1: Create the capabilities router**

Create `aimeat/src/routes/capabilities.ts`:

```typescript
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { resolveIdentity } from '../utils/gaii.js';

export function capabilitiesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const resolve = (req: any) => resolveIdentity(req.auth!, config.nodeId);

  // ── Discovery (Tier 0 for public, Tier 1 for private) ──

  router.get('/v1/capabilities', async (req, res) => {
    const filters: any = {};
    if (req.query.search) filters.search = req.query.search as string;
    if (req.query.tags) filters.tags = (req.query.tags as string).split(',');
    if (req.query.callable !== undefined) filters.callable = req.query.callable === 'true';
    if (req.query.authRequired) filters.authRequired = req.query.authRequired as string;
    if (req.query.source_type) filters.sourceType = req.query.source_type as string;
    if (req.query.status) filters.status = req.query.status as string;
    filters.page = parseInt(req.query.page as string) || 1;
    filters.perPage = parseInt(req.query.per_page as string) || 20;

    // If not authenticated, only show public active capabilities
    if (!req.auth) {
      filters.visibility = 'public';
      filters.status = 'active';
    }

    const result = await storage.listCapabilities(filters);
    res.json(success(config.nodeId, result));
  });

  router.get('/v1/capabilities/:id', async (req, res) => {
    const cap = await storage.getCapability(req.params.id as string);
    if (!cap) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));

    // Check visibility
    if (cap.visibility === 'private' && (!req.auth || resolve(req) !== cap.ownerGhii)) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));
    }

    res.json(success(config.nodeId, cap));
  });

  // ── CRUD (Owner, manages own capabilities) ──

  router.post('/v1/capabilities', requireAuth(), requireRole('owner'), async (req, res) => {
    const gaii = resolve(req);
    const body = req.body;
    const now = new Date().toISOString();

    const record = {
      ...body,
      ownerGhii: gaii,
      scope: 'local' as const,
      status: body.status || 'draft',
      rejectionReason: null,
      deprecationMessage: null,
      replacedBy: null,
      trust: { operatorReviewed: false, reviewedAt: null, vouchCount: 0, publisherTrustScore: 0, codeAudited: false, auditNotes: null },
      operatorOverride: null,
      stats: { totalInvocations: 0, successCount: 0, errorCount: 0, lastInvokedAt: null, avgResponseMs: 0, lastError: null },
      createdAt: now,
      updatedAt: now,
    };

    // Compute schemaHash
    const { createHash } = await import('node:crypto');
    record.schemaHash = createHash('sha256')
      .update(JSON.stringify(record.inputSchema) + JSON.stringify(record.outputSchema))
      .digest('hex').slice(0, 16);

    try {
      const created = await storage.createCapability(record);
      res.status(201).json(success(config.nodeId, created));
    } catch (err: any) {
      if (err.message?.includes('UNIQUE')) {
        return res.status(409).json(error(config.nodeId, 'CAPABILITY_EXISTS', `Capability '${body.id}' already exists`));
      }
      throw err;
    }
  });

  router.put('/v1/capabilities/:id', requireAuth(), requireRole('owner'), async (req, res) => {
    const cap = await storage.getCapability(req.params.id as string);
    if (!cap) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));
    if (cap.ownerGhii !== resolve(req)) return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Not the owner'));

    const updates = { ...req.body, updatedAt: new Date().toISOString() };
    const updated = await storage.updateCapability(req.params.id as string, updates);
    res.json(success(config.nodeId, updated));
  });

  router.delete('/v1/capabilities/:id', requireAuth(), requireRole('owner'), async (req, res) => {
    const cap = await storage.getCapability(req.params.id as string);
    if (!cap) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));
    if (cap.ownerGhii !== resolve(req)) return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Not the owner'));
    if (cap.source.type !== 'manual') return res.status(400).json(error(config.nodeId, 'CANNOT_DELETE', 'Only manual capabilities can be deleted'));

    await storage.deleteCapability(req.params.id as string);
    res.json(success(config.nodeId, { deleted: true }));
  });

  return router;
}
```

- [ ] **Step 2: Mount the router**

In `aimeat/src/server-bootstrap/routes-loader.ts`, add:

```typescript
import { capabilitiesRouter } from '../routes/capabilities.js';
```

And in the `mountRoutes` function, add after the existing router registrations:

```typescript
app.use(capabilitiesRouter(config, storage));
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```
git commit -m "feat(capability): REST API for discovery and CRUD"
```

---

### Task 1.5: Invoke Proxy

**Files:**
- Create: `aimeat/src/services/capability-invoke.ts`
- Modify: `aimeat/src/routes/capabilities.ts` (add invoke endpoint)

- [ ] **Step 1: Create the invoke service**

Create `aimeat/src/services/capability-invoke.ts`:

```typescript
import type { AimeatConfig } from '../config.js';
import type { Storage, CapabilityRecord } from '../storage/interface.js';

export interface InvokeResult {
  capability: string;
  result: unknown;
  duration_ms: number;
  source: { type: string; ref: string };
  mode: 'normal' | 'raw';
}

export async function invokeCapability(
  config: AimeatConfig,
  storage: Storage,
  capability: CapabilityRecord,
  input: Record<string, unknown>,
  callerGhii: string,
  jwt: string,
  mode: 'normal' | 'raw' = 'normal',
): Promise<InvokeResult> {
  const start = Date.now();

  if (!capability.callable) {
    throw Object.assign(new Error('NOT_CALLABLE'), {
      statusCode: 400,
      message: capability.source.type === 'action'
        ? `This capability is not directly callable. Use the work queue: POST /v1/work/request with { action_id: '${capability.source.ref}' }`
        : capability.source.type === 'cortex'
          ? `This capability is browser-only. Use it in an AIMEAT app: ${capability.usage}`
          : `This capability is not callable. ${capability.usage}`,
    });
  }

  if (capability.operatorOverride?.disabled) {
    throw Object.assign(new Error('CAPABILITY_DISABLED'), { statusCode: 403, message: 'This capability has been disabled by the operator' });
  }

  if (capability.status === 'disabled') {
    throw Object.assign(new Error('CAPABILITY_GONE'), { statusCode: 410, message: 'This capability is no longer available' });
  }

  if (capability.status === 'deprecated') {
    // Still works but log warning
  }

  let result: unknown;

  switch (capability.source.type) {
    case 'extension': {
      // Parse source ref: "ext:{extName}:{actionId}"
      const parts = capability.source.ref.split(':');
      const extName = parts[1];
      const actionId = parts[2];

      // Call the extension action internally
      const response = await fetch(`http://localhost:${config.port}/v1/ext/${extName}/${actionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` },
        body: JSON.stringify(input),
      });
      const body = await response.json();

      if (!body.ok) {
        throw Object.assign(new Error(body.error?.message || 'Extension invoke failed'), {
          statusCode: response.status,
        });
      }

      result = mode === 'raw' ? body : body.data;
      break;
    }

    case 'manual': {
      if (!capability.webhookUrl) {
        throw Object.assign(new Error('NO_WEBHOOK'), { statusCode: 500, message: 'Webhook URL not configured' });
      }

      const response = await fetch(capability.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, caller: callerGhii, capability: capability.id }),
      });

      if (!response.ok) {
        throw Object.assign(new Error('Webhook returned ' + response.status), { statusCode: 502 });
      }

      const body = await response.json();
      result = mode === 'raw' ? body : body.result;
      break;
    }

    default:
      throw Object.assign(new Error('UNSUPPORTED_SOURCE'), { statusCode: 400, message: `Cannot invoke source type: ${capability.source.type}` });
  }

  const duration_ms = Date.now() - start;

  return {
    capability: capability.id,
    result,
    duration_ms,
    source: { type: capability.source.type, ref: capability.source.ref },
    mode,
  };
}
```

- [ ] **Step 2: Add invoke endpoint to capabilities router**

In `aimeat/src/routes/capabilities.ts`, add before `return router`:

```typescript
  // ── Invoke (Tier 1) ──

  router.post('/v1/capabilities/:id/invoke', requireAuth(), async (req, res) => {
    const cap = await storage.getCapability(req.params.id as string);
    if (!cap) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));

    const callerGhii = resolve(req);
    const jwt = (req.headers.authorization || '').replace('Bearer ', '');
    const mode = (req.query.mode as string) === 'raw' ? 'raw' as const : 'normal' as const;
    const input = req.body.input || {};

    try {
      const { invokeCapability } = await import('../services/capability-invoke.js');
      const result = await invokeCapability(config, storage, cap, input, callerGhii, jwt, mode);

      // Record stats (async, don't wait)
      storage.incrementCapabilityStats(cap.id, {
        success: 1, error: 0, totalMs: result.duration_ms,
      }).catch(() => {});

      // Record log
      const { randomUUID } = await import('node:crypto');
      storage.addCapabilityLog({
        id: randomUUID(), capabilityId: cap.id, callerGhii,
        input, status: 'success', durationMs: result.duration_ms,
        error: null, timestamp: new Date().toISOString(),
      }).catch(() => {});

      res.json(success(config.nodeId, result));
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      const code = err.message || 'INVOKE_FAILED';

      // Record error stats
      storage.incrementCapabilityStats(cap.id, {
        success: 0, error: 1, totalMs: Date.now(), lastError: err.message,
      }).catch(() => {});

      const { randomUUID } = await import('node:crypto');
      storage.addCapabilityLog({
        id: randomUUID(), capabilityId: cap.id, callerGhii,
        input, status: 'error', durationMs: 0,
        error: err.message, timestamp: new Date().toISOString(),
      }).catch(() => {});

      res.status(statusCode).json(error(config.nodeId, code, err.message));
    }
  });
```

- [ ] **Step 3: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`

- [ ] **Step 4: Commit**

```
git commit -m "feat(capability): invoke proxy for extensions and webhooks"
```

---

### Task 1.6: Aggregator Background Job

**Files:**
- Create: `aimeat/src/services/capability-aggregator.ts`
- Modify: `aimeat/src/services/job-seeding.ts`
- Modify: `aimeat/src/server-bootstrap/routes-loader.ts` (register handler)

- [ ] **Step 1: Create the aggregator service**

Create `aimeat/src/services/capability-aggregator.ts`:

```typescript
import type { AimeatConfig } from '../config.js';
import type { Storage, CapabilityRecord } from '../storage/interface.js';
import { createHash } from 'node:crypto';

export async function runCapabilityAggregation(config: AimeatConfig, storage: Storage): Promise<{ created: number; updated: number; disabled: number }> {
  let created = 0, updated = 0, disabled = 0;
  const seenRefs = new Set<string>();

  // 1. Scan active extensions -> one capability per action
  try {
    const extensions = await storage.listExtensions();
    for (const ext of extensions) {
      if (ext.status !== 'active' || !ext.actions) continue;
      for (const action of ext.actions) {
        const ref = `ext:${ext.name}:${action.id}`;
        seenRefs.add(ref);
        const existing = await storage.getCapabilityBySourceRef(ref);

        const schemaHash = createHash('sha256')
          .update(JSON.stringify(action.inputSchema || {}) + JSON.stringify(action.outputSchema || {}))
          .digest('hex').slice(0, 16);

        if (!existing) {
          await storage.createCapability({
            id: ref,
            name: `${ext.name}: ${action.id}`,
            summary: action.description || ext.description || '',
            ownerGhii: ext.installedBy || `operator@${config.nodeId}`,
            visibility: 'public',
            scope: 'local',
            status: 'active',
            rejectionReason: null,
            deprecationMessage: null,
            replacedBy: null,
            source: { type: 'extension', ref, version: ext.version },
            authRequired: 'registered',
            callable: true,
            inputSchema: action.inputSchema || null,
            outputSchema: action.outputSchema || null,
            exports: null,
            usage: `await AIMEAT.capabilities.invoke('${ref}', input)`,
            whenToUse: '',
            whenNotToUse: '',
            examples: [],
            dependencies: [],
            schemaHash,
            webhookUrl: null,
            cost: null,
            trustRequired: null,
            trust: { operatorReviewed: false, reviewedAt: null, vouchCount: 0, publisherTrustScore: 0, codeAudited: false, auditNotes: null },
            redactedFields: [],
            operatorOverride: null,
            stats: { totalInvocations: 0, successCount: 0, errorCount: 0, lastInvokedAt: null, avgResponseMs: 0, lastError: null },
            tags: ext.tags || [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          created++;
        } else if (existing.source.version !== ext.version || existing.schemaHash !== schemaHash) {
          await storage.updateCapability(existing.id, {
            source: { type: 'extension', ref, version: ext.version },
            inputSchema: action.inputSchema || null,
            outputSchema: action.outputSchema || null,
            schemaHash,
            updatedAt: new Date().toISOString(),
          });
          updated++;
        }
      }
    }
  } catch { /* extensions might not be enabled */ }

  // 2. Scan published actions -> discovery only (callable: false)
  try {
    const { actions } = await storage.listActions();
    for (const action of actions) {
      const ref = `action:${action.providerGaii}:${action.id}`;
      seenRefs.add(ref);
      const existing = await storage.getCapabilityBySourceRef(ref);

      if (!existing) {
        const schemaHash = createHash('sha256')
          .update(JSON.stringify(action.inputSchema || {}) + JSON.stringify(action.outputSchema || {}))
          .digest('hex').slice(0, 16);

        await storage.createCapability({
          id: ref,
          name: action.displayName || action.id,
          summary: action.description || '',
          ownerGhii: action.providerGaii,
          visibility: 'public',
          scope: 'local',
          status: 'active',
          rejectionReason: null,
          deprecationMessage: null,
          replacedBy: null,
          source: { type: 'action', ref, version: action.updatedAt },
          authRequired: 'registered',
          callable: false,
          inputSchema: action.inputSchema || null,
          outputSchema: action.outputSchema || null,
          exports: null,
          usage: `Use the work queue: POST /v1/work/request with { action_id: '${action.id}', provider_gaii: '${action.providerGaii}', input: {...} }`,
          whenToUse: '',
          whenNotToUse: '',
          examples: [],
          dependencies: [],
          schemaHash,
          webhookUrl: null,
          cost: action.pricing ? { morsels: action.pricing.baseMorsels || 0 } : null,
          trustRequired: null,
          trust: { operatorReviewed: false, reviewedAt: null, vouchCount: 0, publisherTrustScore: 0, codeAudited: false, auditNotes: null },
          redactedFields: [],
          operatorOverride: null,
          stats: { totalInvocations: 0, successCount: 0, errorCount: 0, lastInvokedAt: null, avgResponseMs: 0, lastError: null },
          tags: action.tags || [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        created++;
      }
    }
  } catch { /* actions might fail */ }

  // 3. Scan active cortex modules -> callable in browser, exports from manifest
  try {
    const { extensions: cortexList } = await storage.listCortexExtensions({ status: 'active' });
    for (const cortex of cortexList) {
      const ref = `cortex:${cortex.name}`;
      seenRefs.add(ref);
      const existing = await storage.getCapabilityBySourceRef(ref);

      if (!existing) {
        await storage.createCapability({
          id: ref,
          name: cortex.name,
          summary: cortex.description || '',
          ownerGhii: cortex.installedBy || `operator@${config.nodeId}`,
          visibility: cortex.visibility === 'public' ? 'public' : 'private',
          scope: 'local',
          status: 'active',
          rejectionReason: null,
          deprecationMessage: null,
          replacedBy: null,
          source: { type: 'cortex', ref, version: cortex.version },
          authRequired: 'registered',
          callable: true,
          inputSchema: null,
          outputSchema: null,
          exports: null,
          usage: `await loadScript('/v1/cortex/${cortex.name}/libs/${cortex.name}.js')`,
          whenToUse: '',
          whenNotToUse: '',
          examples: [],
          dependencies: [{ type: 'sdk', id: 'aimeat-data', required: true, minVersion: null }],
          schemaHash: '',
          webhookUrl: null,
          cost: null,
          trustRequired: null,
          trust: { operatorReviewed: false, reviewedAt: null, vouchCount: 0, publisherTrustScore: 0, codeAudited: false, auditNotes: null },
          redactedFields: [],
          operatorOverride: null,
          stats: { totalInvocations: 0, successCount: 0, errorCount: 0, lastInvokedAt: null, avgResponseMs: 0, lastError: null },
          tags: cortex.tags || [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        created++;
      }
    }
  } catch { /* cortex might not be enabled */ }

  // 4. Disable capabilities whose sources are gone
  for (const sourceType of ['extension', 'action', 'cortex']) {
    const existing = await storage.listCapabilitiesBySourceType(sourceType);
    for (const cap of existing) {
      if (!seenRefs.has(cap.source.ref) && cap.status === 'active') {
        await storage.updateCapability(cap.id, { status: 'disabled', updatedAt: new Date().toISOString() });
        disabled++;
      }
    }
  }

  return { created, updated, disabled };
}
```

- [ ] **Step 2: Register the background job**

In `aimeat/src/services/job-seeding.ts`, add to the jobs array:

```typescript
{ id: 'core:capability-aggregation', name: 'Capability Aggregation', coreHandler: 'capability-aggregation', cron: '*/5 * * * *' },
```

In `aimeat/src/server-bootstrap/routes-loader.ts`, register the handler before `scheduler.start()`:

```typescript
import { runCapabilityAggregation } from '../services/capability-aggregator.js';
scheduler.registerCoreHandler('capability-aggregation', async () => {
  await runCapabilityAggregation(config, storage);
});
```

Also run aggregation once at startup (after scheduler.start()):

```typescript
runCapabilityAggregation(config, storage).catch(() => {});
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: May need to adjust method signatures to match actual Storage interface for listExtensions, listActions, listCortexExtensions.

- [ ] **Step 4: Commit**

```
git commit -m "feat(capability): aggregator background job scans extensions, actions, cortex"
```

---

### Task 1.7: E2E Tests

**Files:**
- Create: `aimeat/test/e2e-capabilities.ts`

- [ ] **Step 1: Write E2E test suite**

Create `aimeat/test/e2e-capabilities.ts` following the standard boilerplate pattern (test/assert/json/signMsg functions, owner+agent setup, phased tests):

Phase 0: Setup (register owner, auth, register agent, auth agent)
Phase 1: Manual Capability CRUD (POST, GET, PUT, list, search, filter, DELETE, verify 404)
Phase 2: Visibility and Auth (public vs private, anonymous access)
Phase 3: Invoke (create manual webhook capability with echo endpoint, invoke, verify result)
Phase 4: Non-callable returns clear usage message
Phase 5: Stats (invoke multiple times, verify stats increment)
Phase 6: Logs (verify logs appear via admin endpoint - added in Phase 3)
Phase 7: Cleanup (delete owner cascade)

Note: Phase 3 (invoke test) requires a test echo endpoint. Create a simple Express handler inline in the test that echoes back the input.

- [ ] **Step 2: Run tests**

Run: `pnpm test:e2e`
Expected: Capability tests pass on memory backend

- [ ] **Step 3: Run on SQLite and MongoDB**

Run: `pnpm test:e2e:sqlite` and `pnpm test:e2e:mongodb`

- [ ] **Step 4: Commit**

```
git commit -m "test(capability): E2E test suite for CRUD, invoke, stats"
```

---

### Task 1.8: Admin Endpoints

**Files:**
- Create: `aimeat/src/routes/admin-capabilities.ts`
- Modify: `aimeat/src/server-bootstrap/routes-loader.ts`

- [ ] **Step 1: Create admin capabilities router**

```typescript
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';

export function adminCapabilitiesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const auth = [requireAuth(), requireRole('operator')];

  // List all capabilities (operator sees everything)
  router.get('/v1/admin/capabilities', ...auth, async (req, res) => {
    const filters: any = { ...req.query };
    filters.page = parseInt(req.query.page as string) || 1;
    filters.perPage = parseInt(req.query.per_page as string) || 50;
    // Operator sees all visibilities
    const result = await storage.listCapabilities(filters);
    res.json(success(config.nodeId, result));
  });

  // Override a capability
  router.put('/v1/admin/capabilities/:id/override', ...auth, async (req, res) => {
    const cap = await storage.getCapability(req.params.id as string);
    if (!cap) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));
    await storage.setCapabilityOverride(req.params.id as string, req.body);
    const updated = await storage.getCapability(req.params.id as string);
    res.json(success(config.nodeId, updated));
  });

  // View logs
  router.get('/v1/admin/capabilities/:id/logs', ...auth, async (req, res) => {
    const page = parseInt(req.query.page as string) || 1;
    const perPage = parseInt(req.query.per_page as string) || 50;
    const status = req.query.status as 'success' | 'error' | undefined;
    const result = await storage.listCapabilityLogs(req.params.id as string, { status, page, perPage });

    // Also get current stats
    const cap = await storage.getCapability(req.params.id as string);
    res.json(success(config.nodeId, { ...result, stats: cap?.stats }));
  });

  return router;
}
```

- [ ] **Step 2: Mount the admin router**

In `routes-loader.ts`:
```typescript
import { adminCapabilitiesRouter } from '../routes/admin-capabilities.js';
// ...
app.use(adminCapabilitiesRouter(config, storage));
```

- [ ] **Step 3: Commit**

```
git commit -m "feat(capability): admin endpoints for capabilities management"
```

---

# Phase 2: SDK Library + MCP Tools + Telemetry

**Delivers:** Browser SDK `aimeat-capabilities.js`, 3 MCP tools, telemetry endpoint.
**Depends on:** Phase 1

---

### Task 2.1: SDK Library (aimeat-capabilities.js)

**Files:**
- Create: `aimeat/src/routes/lib-capabilities.ts`
- Modify: `aimeat/src/routes/libs.ts` (add to library list and serve)

- [ ] **Step 1: Create the library source generator**

Create `aimeat/src/routes/lib-capabilities.ts` following the same pattern as `lib-data.ts` and `lib-storage.ts`:

The generated JS should expose `AIMEAT.capabilities` with these methods:
- `list(filters?)` - `GET /v1/capabilities` with query params
- `search(query)` - shorthand for `list({ search: query })`
- `get(id)` - `GET /v1/capabilities/:id`
- `invoke(id, input, opts?)` - `POST /v1/capabilities/:id/invoke` (for callable), or client-side cortex invoke
- `create(record)` - `POST /v1/capabilities`
- `update(id, updates)` - `PUT /v1/capabilities/:id`
- `delete(id)` - `DELETE /v1/capabilities/:id`
- `mine()` - `GET /v1/capabilities?ownerGhii=<me>`
- `test(id, input)` - `POST /v1/capabilities/:id/test`
- `vouch(id, comment?)` - `POST /v1/capabilities/:id/vouch`
- `unvouch(id)` - `DELETE /v1/capabilities/:id/vouch`

Client-side cortex invoke: if `source.type === 'cortex'`, loadScript the cortex lib and call the export function directly. Send telemetry ping afterward.

- [ ] **Step 2: Add to libs.ts**

Add the library to the list endpoint and serve route:
```typescript
{ name: 'aimeat-capabilities', url: '/v1/libs/aimeat-capabilities.js', description: 'Capability discovery, invoke, and management', requires: 'aimeat-auth' }
```

- [ ] **Step 3: Commit**

```
git commit -m "feat(capability): aimeat-capabilities.js SDK library"
```

---

### Task 2.2: MCP Tools

**Files:**
- Create: `aimeat/src/mcp/capabilities.ts`
- Modify: `aimeat/src/mcp/index.ts`

- [ ] **Step 1: Create MCP tool module**

Create `aimeat/src/mcp/capabilities.ts` with 3 tools following the existing pattern:

```typescript
import { z } from 'zod';
import type { McpServer } from '@anthropic-ai/mcp';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';

export function registerCapabilitiesTools(
  mcp: McpServer, storage: Storage, config: AimeatConfig,
  getAgentGaii: () => string,
  emitResourceUpdated: (uri: string) => void,
  emitResourceListChanged: () => void,
) {
  mcp.tool('aimeat_capabilities_list', 'List and search capabilities on this node', {
    search: z.string().optional(),
    tags: z.array(z.string()).optional(),
    callable: z.boolean().optional(),
    authRequired: z.string().optional(),
    source_type: z.string().optional(),
  }, async (args) => {
    const result = await storage.listCapabilities({ ...args, visibility: 'public', status: 'active' });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  mcp.tool('aimeat_capabilities_get', 'Get full detail of a capability including schemas and examples', {
    id: z.string(),
  }, async (args) => {
    const cap = await storage.getCapability(args.id);
    if (!cap) return { content: [{ type: 'text', text: 'Capability not found: ' + args.id }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(cap, null, 2) }] };
  });

  mcp.tool('aimeat_capabilities_invoke', 'Invoke a callable capability', {
    id: z.string(),
    input: z.record(z.unknown()).optional(),
    mode: z.enum(['normal', 'raw']).optional(),
  }, async (args) => {
    const cap = await storage.getCapability(args.id);
    if (!cap) return { content: [{ type: 'text', text: 'Capability not found: ' + args.id }], isError: true };

    if (cap.source.type === 'cortex') {
      return { content: [{ type: 'text', text: `This capability is browser-only. Use it in an AIMEAT app: ${cap.usage}` }], isError: true };
    }

    const { invokeCapability } = await import('../services/capability-invoke.js');
    try {
      const result = await invokeCapability(config, storage, cap, args.input || {}, getAgentGaii(), '', args.mode || 'normal');
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: 'text', text: err.message }], isError: true };
    }
  });
}
```

- [ ] **Step 2: Register in MCP index**

In `aimeat/src/mcp/index.ts`, add:
```typescript
import { registerCapabilitiesTools } from './capabilities.js';
// ... in registration block:
registerCapabilitiesTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
```

- [ ] **Step 3: Commit**

```
git commit -m "feat(capability): MCP tools for list, get, invoke"
```

---

### Task 2.3: Telemetry Endpoint

**Files:**
- Modify: `aimeat/src/routes/capabilities.ts`

- [ ] **Step 1: Add telemetry endpoint**

In capabilities router, add:

```typescript
  router.post('/v1/capabilities/:id/telemetry', requireAuth(), async (req, res) => {
    const { duration_ms, status } = req.body;
    const capId = req.params.id as string;
    if (status === 'success') {
      storage.incrementCapabilityStats(capId, { success: 1, error: 0, totalMs: duration_ms || 0 }).catch(() => {});
    } else {
      storage.incrementCapabilityStats(capId, { success: 0, error: 1, totalMs: duration_ms || 0, lastError: req.body.error }).catch(() => {});
    }
    res.status(204).end();
  });
```

- [ ] **Step 2: Commit**

```
git commit -m "feat(capability): client-side telemetry endpoint"
```

---

# Phase 3: Security + Billing + Vouching

**Delivers:** Webhook hardening, operator config, moderation flow, morsel billing, vouching, PII redaction.
**Depends on:** Phase 1. Independent of Phase 2.

---

### Task 3.1: Operator Configuration

**Files:**
- Modify: `aimeat/src/config.ts` (add capability config fields)
- Modify: `aimeat/src/routes/capabilities.ts` (enforce publishing policy)

- [ ] **Step 1: Add config fields**

In `AimeatConfig` interface and `loadConfig()`:

```typescript
capabilityPublishing: 'disabled' | 'self_only' | 'moderated' | 'open';  // default: 'disabled'
capabilityPublishers: 'all_users' | 'trusted_only' | 'allowlist';  // default: 'all_users'
capabilityMinPublisherTrust: number;  // default: 50
capabilityPublisherAllowlist: string[];  // default: []
capabilityWebhooks: 'disabled' | 'allowlist_only' | 'open';  // default: 'disabled'
capabilityWebhookDomainAllowlist: string[];  // default: []
capabilityLogRetentionDays: number;  // default: 30
```

- [ ] **Step 2: Enforce in POST /v1/capabilities**

Add checks in the create endpoint:
- If publishing is 'disabled' and user is not operator, return 403
- If publishing is 'self_only' and visibility is 'public', return 403
- If publishing is 'moderated' and visibility is 'public', set status to 'pending_review'
- If publishers is 'trusted_only', check user trust score
- If publishers is 'allowlist', check user GHII in allowlist
- If webhooks is 'disabled' and source.type is 'manual' with webhookUrl, return 403
- If webhooks is 'allowlist_only', check domain against allowlist

- [ ] **Step 3: Commit**

```
git commit -m "feat(capability): operator configuration for publishing policy"
```

---

### Task 3.2: Webhook Security

**Files:**
- Modify: `aimeat/src/services/capability-invoke.ts`

- [ ] **Step 1: Add webhook security checks**

In the manual webhook invoke path:
- Validate URL: must be HTTPS, no loopback, no private ranges, no metadata
- Sign request with node's Ed25519 key
- Set timeout (10 seconds)
- Limit response size (10 MB)
- Add X-AIMEAT-Node, X-AIMEAT-Signature, X-AIMEAT-Timestamp headers

- [ ] **Step 2: Commit**

```
git commit -m "feat(capability): webhook security hardening"
```

---

### Task 3.3: Morsel Billing

**Files:**
- Modify: `aimeat/src/services/capability-invoke.ts`

- [ ] **Step 1: Add billing logic**

Before invoking, if `capability.cost?.morsels > 0`:
1. Resolve caller's GHII
2. Check balance via `storage.getGhiiRecord()`
3. Debit via `storage.debitBalance(callerGhii, cost.morsels)`
4. On success: credit owner via `storage.creditBalance(capability.ownerGhii, cost.morsels * (1 - networkFeeRate))`
5. On failure: return 402 with message

- [ ] **Step 2: Commit**

```
git commit -m "feat(capability): morsel billing on invoke"
```

---

### Task 3.4: Vouching

**Files:**
- Modify: `aimeat/src/routes/capabilities.ts`

- [ ] **Step 1: Add vouch/unvouch endpoints**

```typescript
  router.post('/v1/capabilities/:id/vouch', requireAuth(), requireRole('owner'), async (req, res) => {
    const cap = await storage.getCapability(req.params.id as string);
    if (!cap) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));
    const callerGhii = resolve(req);
    if (cap.ownerGhii === callerGhii) return res.status(400).json(error(config.nodeId, 'CANNOT_VOUCH_OWN', 'Cannot vouch for your own capability'));
    // Check if already vouched - use storage method
    // Insert vouch, increment count
    // Return new vouch count
  });

  router.delete('/v1/capabilities/:id/vouch', requireAuth(), requireRole('owner'), async (req, res) => {
    // Remove vouch, decrement count
  });
```

- [ ] **Step 2: Add storage methods for vouches**

Add to SQLite implementation:
- `vouchCapability(capabilityId, userGhii, comment?)`
- `unvouchCapability(capabilityId, userGhii)`
- `hasVouched(capabilityId, userGhii)`
- `listVouches(capabilityId)`

Using the `capability_vouches` table created in Task 1.2.

- [ ] **Step 3: Commit**

```
git commit -m "feat(capability): vouching mechanism"
```

---

### Task 3.5: PII Redaction

**Files:**
- Modify: `aimeat/src/routes/capabilities.ts` (in invoke endpoint)

- [ ] **Step 1: Add input redaction before logging**

In the invoke endpoint, before `addCapabilityLog`:
- If `cap.redactedFields.length > 0`, create a redacted copy of input
- For each field path in `redactedFields`, replace the value with `'[REDACTED]'`
- If `redactedFields` contains `'*'`, store only `{ _redacted: true, _hash: sha256(JSON.stringify(input)).slice(0,16) }`
- Exception: on error, log full input regardless (for debugging)

- [ ] **Step 2: Commit**

```
git commit -m "feat(capability): PII redaction in capability logs"
```

---

### Task 3.6: Test Endpoint

**Files:**
- Modify: `aimeat/src/routes/capabilities.ts`

- [ ] **Step 1: Add test endpoint**

```typescript
  router.post('/v1/capabilities/:id/test', requireAuth(), requireRole('owner'), async (req, res) => {
    const cap = await storage.getCapability(req.params.id as string);
    if (!cap) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));
    if (cap.ownerGhii !== resolve(req)) return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Not the owner'));
    if (!cap.callable || cap.source.type !== 'manual') return res.status(400).json(error(config.nodeId, 'NOT_TESTABLE', 'Only manual callable capabilities can be tested'));

    const { invokeCapability } = await import('../services/capability-invoke.js');
    try {
      const result = await invokeCapability(config, storage, cap, req.body.input || {}, resolve(req), '', 'normal');
      // Validate output against outputSchema if present
      let validated = true;
      let validationErrors: string[] = [];
      // (JSON Schema validation using ajv or similar)
      res.json(success(config.nodeId, { status: 'success', result: result.result, duration_ms: result.duration_ms, validated, validation_errors: validationErrors }));
    } catch (err: any) {
      res.json(success(config.nodeId, { status: 'error', error: err.message, duration_ms: 0 }));
    }
    // Note: test does NOT record stats or logs
  });
```

- [ ] **Step 2: Commit**

```
git commit -m "feat(capability): test endpoint for manual webhook capabilities"
```

---

# Phase 4: UI (Admin Dashboard + Profile Tab)

**Delivers:** Admin capabilities tab, profile capabilities tab, i18n.
**Depends on:** Phases 1-3.

---

### Task 4.1: i18n Strings

**Files:**
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

- [ ] **Step 1: Add capability i18n keys**

In `en.json`, add a `"capabilities"` section:
```json
"capabilities": {
  "title": "Capabilities",
  "create": "Create Capability",
  "edit": "Edit Capability",
  "delete": "Delete Capability",
  "name": "Name",
  "summary": "Summary",
  "status": "Status",
  "visibility": "Visibility",
  "source": "Source",
  "callable": "Callable",
  "tags": "Tags",
  "invocations": "Invocations",
  "errors": "Errors",
  "lastInvoked": "Last Invoked",
  "vouch": "Vouch",
  "unvouch": "Remove Vouch",
  "vouchCount": "Vouches",
  "pendingReview": "Pending Review",
  "approve": "Approve",
  "reject": "Reject",
  "disable": "Disable",
  "enable": "Enable",
  "test": "Test",
  "invoke": "Invoke",
  "logs": "Logs",
  "override": "Override",
  "operatorNotes": "Operator Notes",
  "noCapabilities": "No capabilities found",
  "browserOnly": "Browser only",
  "discoveryOnly": "Discovery only"
}
```

Add equivalent Finnish translations to `fi.json`.

- [ ] **Step 2: Commit**

```
git commit -m "feat(capability): i18n strings for capabilities"
```

---

### Task 4.2: Admin Dashboard Capabilities Tab

**Files:**
- Create: `aimeat/public/views/admin/capabilities-tab.js`
- Modify: `aimeat/public/views/admin/index.js` (add to navigation)

- [ ] **Step 1: Create the admin tab component**

Follow the existing admin tab pattern (e.g., `admin/agents-tab.js`):
- List view with DataTable: name, owner, source, status, visibility, invocations, errors
- Filters: source type, status, visibility, owner search
- Detail modal: full metadata, override panel, stats, logs
- Override actions: approve/reject (moderated), disable/enable, notes

- [ ] **Step 2: Register in admin navigation**

In `admin/index.js`, add to the DATA navigation group:
```javascript
{ id: 'capabilities', label: t('capabilities.title'), icon: '⚡' }
```

- [ ] **Step 3: Add CSS**

Add styles to `aimeat/public/css/views/admin.css` with `adm-cap-` prefix.

- [ ] **Step 4: Commit**

```
git commit -m "feat(capability): admin dashboard capabilities tab"
```

---

### Task 4.3: Profile Capabilities Tab

**Files:**
- Create: `aimeat/public/views/profile/capabilities-tab.js`
- Modify: `aimeat/public/views/profile.js` (add to tab list)

- [ ] **Step 1: Create the profile tab component**

Follow the existing profile tab pattern (e.g., `profile/agents-tab.js`):
- List of user's own capabilities
- Create new capability form (manual source)
- Edit capability metadata
- Vouch count and status display
- Simple stats (invocations, errors)

- [ ] **Step 2: Register in profile tab list**

In `profile.js`, add to the tab configuration:
```javascript
{ id: 'capabilities', label: t('capabilities.title'), tier: 'active' }
```

- [ ] **Step 3: Commit**

```
git commit -m "feat(capability): profile capabilities tab"
```

---

### Task 4.4: OpenAPI and llms.txt Update

**Files:**
- Modify: `aimeat/openapi.yaml`
- Modify: `aimeat/public/llms-template.txt`

- [ ] **Step 1: Add capability endpoints to OpenAPI spec**

Add all capability endpoints to `openapi.yaml`:
- `GET /v1/capabilities`
- `GET /v1/capabilities/:id`
- `POST /v1/capabilities`
- `PUT /v1/capabilities/:id`
- `DELETE /v1/capabilities/:id`
- `POST /v1/capabilities/:id/invoke`
- `POST /v1/capabilities/:id/test`
- `POST /v1/capabilities/:id/vouch`
- `DELETE /v1/capabilities/:id/vouch`
- `POST /v1/capabilities/:id/telemetry`
- `GET /v1/admin/capabilities`
- `PUT /v1/admin/capabilities/:id/override`
- `GET /v1/admin/capabilities/:id/logs`

- [ ] **Step 2: Add capability section to llms-template.txt**

Add capability discovery and invoke to the API reference section, with request/response examples.

- [ ] **Step 3: Commit**

```
git commit -m "docs(capability): update OpenAPI spec and llms.txt"
```

---

### Task 4.5: Final E2E Verification

**Files:**
- Run existing tests

- [ ] **Step 1: Run full E2E suite**

```
pnpm test:e2e
pnpm test:e2e:sqlite
pnpm test:e2e:mongodb
```

Expected: All tests pass including the new capability tests.

- [ ] **Step 2: Run typecheck and lint**

```
pnpm typecheck
pnpm lint
```

- [ ] **Step 3: Commit and push**

```
git push
```
