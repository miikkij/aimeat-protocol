# Node Extension System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a V8 isolate sandbox system that lets operators install JavaScript extensions on AIMEAT nodes, enabling marketplace, membership, and other domain-specific behaviors without hardcoded server routes.

**Architecture:** Extensions are JavaScript modules + YAML manifests installed by operators. Each action runs in an `isolated-vm` V8 isolate with a controlled `ctx` API proxy (memory, wallet, consent, trust). Extensions register dynamic routes under `/v1/ext/{name}/`. Generic wallet escrow is added as a core capability any extension can use.

**Tech Stack:** `isolated-vm` (V8 isolates), existing `yaml` parser, existing `ajv` for schema validation, Express 5 dynamic routing, `vitest` for unit tests.

**Design doc:** `docs/plans/2026-03-04-csm-driven-services-and-node-extensions-design.md`

---

## Task 1: Add `isolated-vm` Dependency

**Files:**
- Modify: `aimeat/package.json`

**Step 1: Install isolated-vm**

```bash
cd aimeat && pnpm add isolated-vm
```

**Step 2: Verify it installed and compiles**

```bash
cd aimeat && node -e "const ivm = require('isolated-vm'); console.log('isolated-vm OK, version:', ivm.version)"
```

Expected: prints version without errors (native addon compiles successfully).

**Step 3: Type-check**

```bash
cd aimeat && npx tsc --noEmit
```

Expected: PASS (no type errors from new dep).

**Step 4: Commit**

```bash
cd aimeat && git add package.json pnpm-lock.yaml && git commit -m "deps: add isolated-vm for V8 extension sandbox"
```

---

## Task 2: Add Extension + Escrow Storage Types

**Files:**
- Modify: `aimeat/src/storage/interface.ts` (after line ~589, before `Storage` interface)

**Step 1: Write failing test**

Create `aimeat/test/unit/extension-storage.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStorage } from '../../src/storage/memory.js';
import type { ExtensionRecord, EscrowHoldRecord } from '../../src/storage/interface.js';

describe('ExtensionRecord storage', () => {
  let storage: InMemoryStorage;

  beforeEach(() => {
    storage = new InMemoryStorage();
  });

  it('creates and retrieves an extension', async () => {
    const ext: ExtensionRecord = {
      name: 'test-ext',
      version: '1.0.0',
      description: 'Test extension',
      author: 'test',
      status: 'inactive',
      requiredApis: ['memory'],
      actions: [{
        id: 'greet',
        method: 'POST',
        path: '/v1/ext/test-ext/greet',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        outputSchema: { type: 'object', properties: { message: { type: 'string' } } },
        scriptContent: 'export default async (ctx, input) => ({ message: `Hello ${input.name}` })',
      }],
      config: {},
      limits: { memoryMb: 64, timeoutMs: 5000, maxApiCalls: 50 },
      federation: { advertise: false, capabilities: [] },
      installedBy: 'admin',
      installedAt: new Date().toISOString(),
    };
    const created = await storage.createExtension(ext);
    expect(created.name).toBe('test-ext');

    const fetched = await storage.getExtension('test-ext');
    expect(fetched).not.toBeNull();
    expect(fetched!.version).toBe('1.0.0');
  });

  it('lists extensions with status filter', async () => {
    const base = {
      version: '1.0.0', description: '', author: 'test', requiredApis: [],
      actions: [], config: {}, limits: { memoryMb: 64, timeoutMs: 5000, maxApiCalls: 50 },
      federation: { advertise: false, capabilities: [] },
      installedBy: 'admin', installedAt: new Date().toISOString(),
    };
    await storage.createExtension({ ...base, name: 'ext-a', status: 'active' } as ExtensionRecord);
    await storage.createExtension({ ...base, name: 'ext-b', status: 'inactive' } as ExtensionRecord);

    const active = await storage.listExtensions({ status: 'active' });
    expect(active).toHaveLength(1);
    expect(active[0].name).toBe('ext-a');

    const all = await storage.listExtensions();
    expect(all).toHaveLength(2);
  });

  it('updates extension status', async () => {
    const base = {
      name: 'ext-update', version: '1.0.0', description: '', author: 'test',
      status: 'inactive' as const, requiredApis: [], actions: [], config: {},
      limits: { memoryMb: 64, timeoutMs: 5000, maxApiCalls: 50 },
      federation: { advertise: false, capabilities: [] },
      installedBy: 'admin', installedAt: new Date().toISOString(),
    };
    await storage.createExtension(base);
    const updated = await storage.updateExtension('ext-update', {
      status: 'active',
      activatedAt: new Date().toISOString(),
    });
    expect(updated!.status).toBe('active');
    expect(updated!.activatedAt).toBeDefined();
  });

  it('deletes an extension', async () => {
    const base = {
      name: 'ext-del', version: '1.0.0', description: '', author: 'test',
      status: 'inactive' as const, requiredApis: [], actions: [], config: {},
      limits: { memoryMb: 64, timeoutMs: 5000, maxApiCalls: 50 },
      federation: { advertise: false, capabilities: [] },
      installedBy: 'admin', installedAt: new Date().toISOString(),
    };
    await storage.createExtension(base);
    const deleted = await storage.deleteExtension('ext-del');
    expect(deleted).toBe(true);
    const fetched = await storage.getExtension('ext-del');
    expect(fetched).toBeNull();
  });
});

describe('EscrowHoldRecord storage', () => {
  let storage: InMemoryStorage;

  beforeEach(() => {
    storage = new InMemoryStorage();
  });

  it('creates and retrieves an escrow hold', async () => {
    const hold: EscrowHoldRecord = {
      holdId: 'hold-001',
      fromGaii: 'agent@node',
      amount: 100,
      reason: 'marketplace_purchase',
      status: 'held',
      extensionName: 'marketplace-behaviors',
      createdAt: new Date().toISOString(),
    };
    const created = await storage.createEscrowHold(hold);
    expect(created.holdId).toBe('hold-001');

    const fetched = await storage.getEscrowHold('hold-001');
    expect(fetched).not.toBeNull();
    expect(fetched!.amount).toBe(100);
  });

  it('lists escrow holds by gaii', async () => {
    const base = {
      fromGaii: 'agent@node', amount: 50, reason: 'test',
      status: 'held' as const, extensionName: 'test', createdAt: new Date().toISOString(),
    };
    await storage.createEscrowHold({ ...base, holdId: 'h1' } as EscrowHoldRecord);
    await storage.createEscrowHold({ ...base, holdId: 'h2', fromGaii: 'other@node' } as EscrowHoldRecord);

    const holds = await storage.listEscrowHolds('agent@node');
    expect(holds).toHaveLength(1);
    expect(holds[0].holdId).toBe('h1');
  });

  it('releases an escrow hold', async () => {
    const hold: EscrowHoldRecord = {
      holdId: 'hold-rel', fromGaii: 'agent@node', amount: 100,
      reason: 'test', status: 'held', extensionName: 'test',
      createdAt: new Date().toISOString(),
    };
    await storage.createEscrowHold(hold);
    const released = await storage.releaseEscrowHold('hold-rel', 'seller@node');
    expect(released!.status).toBe('released');
    expect(released!.releasedTo).toBe('seller@node');
  });

  it('refunds an escrow hold', async () => {
    const hold: EscrowHoldRecord = {
      holdId: 'hold-ref', fromGaii: 'agent@node', amount: 100,
      reason: 'test', status: 'held', extensionName: 'test',
      createdAt: new Date().toISOString(),
    };
    await storage.createEscrowHold(hold);
    const refunded = await storage.refundEscrowHold('hold-ref');
    expect(refunded!.status).toBe('refunded');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd aimeat && npx vitest run test/unit/extension-storage.test.ts
```

Expected: FAIL — `ExtensionRecord` and `EscrowHoldRecord` types don't exist yet.

**Step 3: Add types to interface.ts**

Add before the `Storage` interface (around line 589) in `aimeat/src/storage/interface.ts`:

```typescript
// ── Node Extensions (V8 Isolates) ──────────────────────────────────

export interface ExtensionRecord {
  name: string;                        // Unique name: "marketplace-behaviors"
  version: string;
  description: string;
  author: string;
  status: 'inactive' | 'active';
  requiredApis: string[];              // ['wallet', 'memory', 'consent', 'trust']
  actions: Array<{
    id: string;
    method: string;
    path: string;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    scriptContent: string;
  }>;
  config: Record<string, unknown>;
  limits: {
    memoryMb: number;
    timeoutMs: number;
    maxApiCalls: number;
  };
  federation: {
    advertise: boolean;
    capabilities: string[];
  };
  installedBy: string;
  installedAt: string;
  activatedAt?: string;
}

// ── Generic Escrow ─────────────────────────────────────────────────

export interface EscrowHoldRecord {
  holdId: string;
  fromGaii: string;
  amount: number;
  reason: string;
  status: 'held' | 'released' | 'disputed' | 'refunded';
  extensionName: string;
  createdAt: string;
  releasedAt?: string;
  releasedTo?: string;
}
```

Add methods to the `Storage` interface:

```typescript
  // Node Extensions
  createExtension(record: ExtensionRecord): Promise<ExtensionRecord>;
  getExtension(name: string): Promise<ExtensionRecord | null>;
  listExtensions(opts?: { status?: string }): Promise<ExtensionRecord[]>;
  updateExtension(name: string, updates: Partial<ExtensionRecord>): Promise<ExtensionRecord | null>;
  deleteExtension(name: string): Promise<boolean>;

  // Generic Escrow
  createEscrowHold(record: EscrowHoldRecord): Promise<EscrowHoldRecord>;
  getEscrowHold(holdId: string): Promise<EscrowHoldRecord | null>;
  listEscrowHolds(fromGaii: string, opts?: { status?: string }): Promise<EscrowHoldRecord[]>;
  releaseEscrowHold(holdId: string, toGaii: string): Promise<EscrowHoldRecord | null>;
  refundEscrowHold(holdId: string): Promise<EscrowHoldRecord | null>;
```

**Step 4: Implement in memory.ts**

Add to `InMemoryStorage` class in `aimeat/src/storage/memory.ts`:

Private fields:
```typescript
  private extensions = new Map<string, ExtensionRecord>();
  private escrowHolds = new Map<string, EscrowHoldRecord>();
```

Methods:
```typescript
  // ── Extensions ──

  async createExtension(record: ExtensionRecord): Promise<ExtensionRecord> {
    if (this.extensions.has(record.name)) throw new Error('Extension already exists');
    this.extensions.set(record.name, record);
    return record;
  }

  async getExtension(name: string): Promise<ExtensionRecord | null> {
    return this.extensions.get(name) ?? null;
  }

  async listExtensions(opts?: { status?: string }): Promise<ExtensionRecord[]> {
    let results = [...this.extensions.values()];
    if (opts?.status) results = results.filter(e => e.status === opts.status);
    return results;
  }

  async updateExtension(name: string, updates: Partial<ExtensionRecord>): Promise<ExtensionRecord | null> {
    const existing = this.extensions.get(name);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.extensions.set(name, updated);
    return updated;
  }

  async deleteExtension(name: string): Promise<boolean> {
    return this.extensions.delete(name);
  }

  // ── Escrow ──

  async createEscrowHold(record: EscrowHoldRecord): Promise<EscrowHoldRecord> {
    this.escrowHolds.set(record.holdId, record);
    return record;
  }

  async getEscrowHold(holdId: string): Promise<EscrowHoldRecord | null> {
    return this.escrowHolds.get(holdId) ?? null;
  }

  async listEscrowHolds(fromGaii: string, opts?: { status?: string }): Promise<EscrowHoldRecord[]> {
    let results = [...this.escrowHolds.values()].filter(h => h.fromGaii === fromGaii);
    if (opts?.status) results = results.filter(h => h.status === opts.status);
    return results;
  }

  async releaseEscrowHold(holdId: string, toGaii: string): Promise<EscrowHoldRecord | null> {
    const hold = this.escrowHolds.get(holdId);
    if (!hold || hold.status !== 'held') return null;
    const updated = { ...hold, status: 'released' as const, releasedTo: toGaii, releasedAt: new Date().toISOString() };
    this.escrowHolds.set(holdId, updated);
    return updated;
  }

  async refundEscrowHold(holdId: string): Promise<EscrowHoldRecord | null> {
    const hold = this.escrowHolds.get(holdId);
    if (!hold || hold.status !== 'held') return null;
    const updated = { ...hold, status: 'refunded' as const, releasedAt: new Date().toISOString() };
    this.escrowHolds.set(holdId, updated);
    return updated;
  }
```

**Step 5: Run tests**

```bash
cd aimeat && npx vitest run test/unit/extension-storage.test.ts
```

Expected: ALL PASS.

**Step 6: Type-check**

```bash
cd aimeat && npx tsc --noEmit
```

Expected: PASS. Note: `mongodb.ts` will need stub methods added too if it implements the Storage interface.

**Step 7: Add stubs to mongodb.ts**

Add no-op implementations to `aimeat/src/storage/mongodb.ts` for all new methods (throw `Error('Not implemented')` — MongoDB support is secondary).

**Step 8: Type-check again**

```bash
cd aimeat && npx tsc --noEmit
```

Expected: PASS.

**Step 9: Commit**

```bash
cd aimeat && git add src/storage/interface.ts src/storage/memory.ts src/storage/mongodb.ts test/unit/extension-storage.test.ts
git commit -m "feat: add ExtensionRecord + EscrowHoldRecord storage types with tests"
```

---

## Task 3: Add Extension Config Fields

**Files:**
- Modify: `aimeat/src/config.ts`
- Modify: `aimeat/.env.example`

**Step 1: Add config fields to AimeatConfig interface**

In `aimeat/src/config.ts`, add after the last config field (around line 198):

```typescript
  // Node Extensions (V8 Isolates)
  extensionsEnabled: boolean;
  extensionMaxMemoryMb: number;
  extensionTimeoutMs: number;
  extensionMaxApiCalls: number;
  extensionMaxCodeSizeKb: number;
  extensionMaxInstalled: number;
```

**Step 2: Add loadConfig() entries**

In the `loadConfig()` function, add:

```typescript
    // Node Extensions
    extensionsEnabled: process.env.AIMEAT_EXTENSIONS_ENABLED === 'true',
    extensionMaxMemoryMb: parseInt(process.env.AIMEAT_EXT_MAX_MEMORY_MB ?? '64', 10),
    extensionTimeoutMs: parseInt(process.env.AIMEAT_EXT_TIMEOUT_MS ?? '5000', 10),
    extensionMaxApiCalls: parseInt(process.env.AIMEAT_EXT_MAX_API_CALLS ?? '50', 10),
    extensionMaxCodeSizeKb: parseInt(process.env.AIMEAT_EXT_MAX_CODE_SIZE_KB ?? '256', 10),
    extensionMaxInstalled: parseInt(process.env.AIMEAT_EXT_MAX_INSTALLED ?? '20', 10),
```

**Step 3: Update .env.example**

Add to `aimeat/.env.example`:

```env
# ── Node Extensions (V8 Isolates) ──────────────────────────────────
# AIMEAT_EXTENSIONS_ENABLED=false      # Enable extension system
# AIMEAT_EXT_MAX_MEMORY_MB=64          # V8 isolate memory limit per action
# AIMEAT_EXT_TIMEOUT_MS=5000           # V8 isolate CPU timeout per action
# AIMEAT_EXT_MAX_API_CALLS=50          # Max AIMEAT API calls per action invocation
# AIMEAT_EXT_MAX_CODE_SIZE_KB=256      # Max JS source size per action
# AIMEAT_EXT_MAX_INSTALLED=20          # Max extensions installed on this node
```

**Step 4: Type-check**

```bash
cd aimeat && npx tsc --noEmit
```

Expected: PASS.

**Step 5: Commit**

```bash
cd aimeat && git add src/config.ts .env.example
git commit -m "feat: add extension system config fields"
```

---

## Task 4: Build V8 Isolate Sandbox Runtime

**Files:**
- Create: `aimeat/src/services/extension-runtime.ts`
- Create: `aimeat/test/unit/extension-runtime.test.ts`

**Step 1: Write failing tests**

Create `aimeat/test/unit/extension-runtime.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { executeExtensionAction } from '../../src/services/extension-runtime.js';

describe('V8 Extension Runtime', () => {
  const baseLimits = { memoryMb: 16, timeoutMs: 2000, maxApiCalls: 10 };

  it('executes a simple action and returns result', async () => {
    const script = `export default async function(ctx, input) {
      return { greeting: 'Hello ' + input.name };
    }`;
    const mockCtx = { memory: {}, wallet: {}, consent: {}, trust: {}, caller: { gaii: 'test', owner: 'test', roles: [] }, config: {}, log: { info() {}, warn() {}, error() {} } };
    const result = await executeExtensionAction(script, mockCtx, { name: 'World' }, baseLimits);
    expect(result).toEqual({ greeting: 'Hello World' });
  });

  it('enforces timeout on infinite loops', async () => {
    const script = `export default async function(ctx, input) {
      while(true) {}
    }`;
    const mockCtx = { memory: {}, wallet: {}, consent: {}, trust: {}, caller: { gaii: 'test', owner: 'test', roles: [] }, config: {}, log: { info() {}, warn() {}, error() {} } };
    await expect(executeExtensionAction(script, mockCtx, {}, { ...baseLimits, timeoutMs: 100 }))
      .rejects.toThrow();
  });

  it('prevents access to Node.js globals', async () => {
    const script = `export default async function(ctx, input) {
      return { hasProcess: typeof process !== 'undefined', hasRequire: typeof require !== 'undefined' };
    }`;
    const mockCtx = { memory: {}, wallet: {}, consent: {}, trust: {}, caller: { gaii: 'test', owner: 'test', roles: [] }, config: {}, log: { info() {}, warn() {}, error() {} } };
    const result = await executeExtensionAction(script, mockCtx, {}, baseLimits);
    expect(result.hasProcess).toBe(false);
    expect(result.hasRequire).toBe(false);
  });

  it('allows ctx API calls from within isolate', async () => {
    const script = `export default async function(ctx, input) {
      await ctx.memory.set('test-key', { value: 42 });
      const data = await ctx.memory.get('test-key');
      return { stored: data };
    }`;
    const store = new Map<string, unknown>();
    const mockCtx = {
      memory: {
        get: async (key: string) => store.get(key) ?? null,
        set: async (key: string, value: unknown) => { store.set(key, value); },
        search: async () => [],
        delete: async () => true,
      },
      wallet: {}, consent: {}, trust: {},
      caller: { gaii: 'test', owner: 'test', roles: [] },
      config: {},
      log: { info() {}, warn() {}, error() {} },
    };
    const result = await executeExtensionAction(script, mockCtx, {}, baseLimits);
    expect(result.stored).toEqual({ value: 42 });
  });

  it('enforces API call limit', async () => {
    const script = `export default async function(ctx, input) {
      for (let i = 0; i < 20; i++) {
        await ctx.memory.get('key-' + i);
      }
      return { done: true };
    }`;
    const mockCtx = {
      memory: {
        get: async () => null,
        set: async () => {},
        search: async () => [],
        delete: async () => true,
      },
      wallet: {}, consent: {}, trust: {},
      caller: { gaii: 'test', owner: 'test', roles: [] },
      config: {},
      log: { info() {}, warn() {}, error() {} },
    };
    await expect(executeExtensionAction(script, mockCtx, {}, { ...baseLimits, maxApiCalls: 5 }))
      .rejects.toThrow(/API call limit/i);
  });
});
```

**Step 2: Run to verify failure**

```bash
cd aimeat && npx vitest run test/unit/extension-runtime.test.ts
```

Expected: FAIL — `executeExtensionAction` doesn't exist.

**Step 3: Implement extension-runtime.ts**

Create `aimeat/src/services/extension-runtime.ts`:

```typescript
import ivm from 'isolated-vm';
import { logger } from '../utils/logger.js';

export interface ExtensionCtx {
  memory: {
    get(key: string): Promise<unknown | null>;
    set(key: string, value: unknown): Promise<void>;
    search(prefix: string, opts?: Record<string, unknown>): Promise<Array<{ key: string; value: unknown }>>;
    delete(key: string): Promise<boolean>;
  };
  wallet: {
    hold?(from: string, amount: number, reason: string): Promise<{ holdId: string }>;
    release?(holdId: string, to: string): Promise<void>;
    transfer?(from: string, to: string, amount: number, reason: string): Promise<void>;
    getBalance?(gaii: string): Promise<number>;
  };
  consent: {
    check?(gaii: string, scope: string): Promise<boolean>;
    require?(gaii: string, scope: string): Promise<void>;
  };
  trust: {
    adjust?(gaii: string, delta: number, reason: string): Promise<void>;
  };
  caller: { gaii: string; owner: string; roles: string[] };
  config: Record<string, unknown>;
  log: {
    info(msg: string, data?: Record<string, unknown>): void;
    warn(msg: string, data?: Record<string, unknown>): void;
    error(msg: string, data?: Record<string, unknown>): void;
  };
}

export interface ExtensionLimits {
  memoryMb: number;
  timeoutMs: number;
  maxApiCalls: number;
}

/**
 * Execute an extension action script in a V8 isolate.
 *
 * The script must export a default async function(ctx, input) that returns a result.
 * The ctx object provides controlled access to AIMEAT APIs via callback proxies.
 */
export async function executeExtensionAction(
  scriptContent: string,
  ctx: ExtensionCtx,
  input: Record<string, unknown>,
  limits: ExtensionLimits,
): Promise<Record<string, unknown>> {
  const isolate = new ivm.Isolate({ memoryLimit: limits.memoryMb });

  try {
    const context = await isolate.createContext();
    const jail = context.global;

    // Track API call count
    let apiCallCount = 0;
    const checkApiLimit = () => {
      apiCallCount++;
      if (apiCallCount > limits.maxApiCalls) {
        throw new Error(`API call limit exceeded (max: ${limits.maxApiCalls})`);
      }
    };

    // Inject ctx as callbacks that the isolate can call
    // We use Reference objects to pass async functions into the isolate
    await jail.set('__input', new ivm.ExternalCopy(input).copyInto());
    await jail.set('__caller', new ivm.ExternalCopy(ctx.caller).copyInto());
    await jail.set('__config', new ivm.ExternalCopy(ctx.config).copyInto());

    // Memory API callbacks
    await jail.set('__memory_get', new ivm.Reference(async (key: string) => {
      checkApiLimit();
      const result = await ctx.memory.get(key);
      return new ivm.ExternalCopy(result === undefined ? null : result).copyInto();
    }));
    await jail.set('__memory_set', new ivm.Reference(async (key: string, valueJson: string) => {
      checkApiLimit();
      await ctx.memory.set(key, JSON.parse(valueJson));
    }));
    await jail.set('__memory_search', new ivm.Reference(async (prefix: string) => {
      checkApiLimit();
      const results = await ctx.memory.search(prefix);
      return new ivm.ExternalCopy(results).copyInto();
    }));
    await jail.set('__memory_delete', new ivm.Reference(async (key: string) => {
      checkApiLimit();
      return await ctx.memory.delete(key);
    }));

    // Wallet API callbacks
    if (ctx.wallet.hold) {
      await jail.set('__wallet_hold', new ivm.Reference(async (from: string, amount: number, reason: string) => {
        checkApiLimit();
        const result = await ctx.wallet.hold!(from, amount, reason);
        return new ivm.ExternalCopy(result).copyInto();
      }));
    }
    if (ctx.wallet.release) {
      await jail.set('__wallet_release', new ivm.Reference(async (holdId: string, to: string) => {
        checkApiLimit();
        await ctx.wallet.release!(holdId, to);
      }));
    }
    if (ctx.wallet.transfer) {
      await jail.set('__wallet_transfer', new ivm.Reference(async (from: string, to: string, amount: number, reason: string) => {
        checkApiLimit();
        await ctx.wallet.transfer!(from, to, amount, reason);
      }));
    }
    if (ctx.wallet.getBalance) {
      await jail.set('__wallet_getBalance', new ivm.Reference(async (gaii: string) => {
        checkApiLimit();
        return await ctx.wallet.getBalance!(gaii);
      }));
    }

    // Consent API callbacks
    if (ctx.consent.check) {
      await jail.set('__consent_check', new ivm.Reference(async (gaii: string, scope: string) => {
        checkApiLimit();
        return await ctx.consent.check!(gaii, scope);
      }));
    }
    if (ctx.consent.require) {
      await jail.set('__consent_require', new ivm.Reference(async (gaii: string, scope: string) => {
        checkApiLimit();
        await ctx.consent.require!(gaii, scope);
      }));
    }

    // Trust API callback
    if (ctx.trust.adjust) {
      await jail.set('__trust_adjust', new ivm.Reference(async (gaii: string, delta: number, reason: string) => {
        checkApiLimit();
        await ctx.trust.adjust!(gaii, delta, reason);
      }));
    }

    // Log callbacks
    await jail.set('__log_info', new ivm.Reference((msg: string, data?: string) => {
      ctx.log.info(msg, data ? JSON.parse(data) : undefined);
    }));
    await jail.set('__log_warn', new ivm.Reference((msg: string, data?: string) => {
      ctx.log.warn(msg, data ? JSON.parse(data) : undefined);
    }));
    await jail.set('__log_error', new ivm.Reference((msg: string, data?: string) => {
      ctx.log.error(msg, data ? JSON.parse(data) : undefined);
    }));

    // Build the wrapper script that creates ctx and calls the user function
    const wrapperScript = `
      const ctx = {
        memory: {
          async get(key) { return __memory_get.applySyncPromise(undefined, [key]); },
          async set(key, value) { return __memory_set.applySyncPromise(undefined, [key, JSON.stringify(value)]); },
          async search(prefix) { return __memory_search.applySyncPromise(undefined, [prefix]); },
          async delete(key) { return __memory_delete.applySyncPromise(undefined, [key]); },
        },
        wallet: {
          ${ctx.wallet.hold ? 'async hold(from, amount, reason) { return __wallet_hold.applySyncPromise(undefined, [from, amount, reason]); },' : ''}
          ${ctx.wallet.release ? 'async release(holdId, to) { return __wallet_release.applySyncPromise(undefined, [holdId, to]); },' : ''}
          ${ctx.wallet.transfer ? 'async transfer(from, to, amount, reason) { return __wallet_transfer.applySyncPromise(undefined, [from, to, amount, reason]); },' : ''}
          ${ctx.wallet.getBalance ? 'async getBalance(gaii) { return __wallet_getBalance.applySyncPromise(undefined, [gaii]); },' : ''}
        },
        consent: {
          ${ctx.consent.check ? 'async check(gaii, scope) { return __consent_check.applySyncPromise(undefined, [gaii, scope]); },' : ''}
          ${ctx.consent.require ? 'async require(gaii, scope) { return __consent_require.applySyncPromise(undefined, [gaii, scope]); },' : ''}
        },
        trust: {
          ${ctx.trust.adjust ? 'async adjust(gaii, delta, reason) { return __trust_adjust.applySyncPromise(undefined, [gaii, delta, reason]); },' : ''}
        },
        caller: __caller,
        config: __config,
        log: {
          info(msg, data) { __log_info.applySync(undefined, [msg, data ? JSON.stringify(data) : undefined]); },
          warn(msg, data) { __log_warn.applySync(undefined, [msg, data ? JSON.stringify(data) : undefined]); },
          error(msg, data) { __log_error.applySync(undefined, [msg, data ? JSON.stringify(data) : undefined]); },
        },
      };

      // User script is inlined here (no import/require)
      const __userFn = (function() {
        ${scriptContent.replace(/export\s+default\s+/g, 'return ')}
      })();

      (async () => {
        const result = await __userFn(ctx, __input);
        return JSON.stringify(result ?? {});
      })();
    `;

    const compiled = await isolate.compileScript(wrapperScript);
    const resultJson = await compiled.run(context, { timeout: limits.timeoutMs }) as string;

    return JSON.parse(resultJson);
  } finally {
    isolate.dispose();
  }
}
```

> **Note:** The `isolated-vm` API for async callbacks (`applySyncPromise`) may need adjustment based on the exact version installed. The core concept is: user code in the isolate calls Reference callbacks that execute in the host Node.js process. This keeps all AIMEAT API access controlled and auditable.

**Step 4: Run tests**

```bash
cd aimeat && npx vitest run test/unit/extension-runtime.test.ts
```

Expected: ALL PASS (may need minor `isolated-vm` API adjustments — follow compiler errors).

**Step 5: Type-check**

```bash
cd aimeat && npx tsc --noEmit
```

Expected: PASS.

**Step 6: Commit**

```bash
cd aimeat && git add src/services/extension-runtime.ts test/unit/extension-runtime.test.ts
git commit -m "feat: V8 isolate sandbox runtime for extension actions"
```

---

## Task 5: Build Extension Management Routes

**Files:**
- Create: `aimeat/src/routes/extensions.ts`
- Modify: `aimeat/src/server.ts`

**Step 1: Create extensions router**

Create `aimeat/src/routes/extensions.ts` with these endpoints:

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/extensions` | Public | List installed extensions |
| POST | `/v1/extensions` | Operator | Install extension (YAML manifest + JS) |
| GET | `/v1/extensions/:name` | Public | Get extension detail |
| DELETE | `/v1/extensions/:name` | Operator | Uninstall extension |
| POST | `/v1/extensions/:name/activate` | Operator | Activate (registers action routes) |
| POST | `/v1/extensions/:name/deactivate` | Operator | Deactivate (removes action routes) |
| ALL | `/v1/ext/:extName/:actionId` | Per-action auth | Dynamic action execution |

The router function signature follows the existing pattern:
```typescript
export function extensionsRouter(
  config: AimeatConfig,
  storage: Storage,
): Router
```

Key implementation details:
- `POST /v1/extensions` accepts `application/json` with `{ manifest: ExtensionManifest, scripts: Record<string, string> }`
- Validate manifest against a Zod schema or manual validation
- Enforce `config.extensionMaxInstalled` limit
- Enforce `config.extensionMaxCodeSizeKb` per script
- `/v1/ext/:extName/:actionId` uses `executeExtensionAction()` from Task 4
- Build the `ctx` object from real storage/wallet/consent/trust services
- Active extension routes are tracked in a `Map<string, Router>` for dynamic mount/unmount

**Step 2: Mount in server.ts**

Add the import and mount after the existing extension hooks block, before the error handler:

```typescript
import { extensionsRouter } from './routes/extensions.js';

// In the server function, before error handler:
if (config.extensionsEnabled) {
  app.use(extensionsRouter(config, storage));
}
```

**Step 3: Type-check and test**

```bash
cd aimeat && npx tsc --noEmit
```

**Step 4: Commit**

```bash
cd aimeat && git add src/routes/extensions.ts src/server.ts
git commit -m "feat: extension management routes + dynamic action execution"
```

---

## Task 6: Create Organism CSM Template

**Files:**
- Create: `aimeat/docs/csm-examples/organism.csm.yaml`

**Step 1: Create the CSM template**

Write the organism CSM YAML as specified in the design doc (Section 5.1). This defines the data shape for groups/clubs/teams — the behavior (membership, join policies) will be in the extension.

**Step 2: Verify it parses**

```bash
cd aimeat && node -e "
  import { readFileSync } from 'fs';
  import { parseCsm, validateCsm } from './src/services/csm-parser.js';
  const yaml = readFileSync('../docs/csm-examples/organism.csm.yaml', 'utf-8');
  const def = parseCsm(yaml);
  const errors = validateCsm(def);
  console.log('Errors:', errors.length === 0 ? 'none' : errors);
  console.log('Service:', def.service.name, def.service.type);
"
```

Expected: No validation errors, service name "Organism".

**Step 3: Commit**

```bash
cd aimeat && git add docs/csm-examples/organism.csm.yaml
git commit -m "feat: add organism CSM template for group/community services"
```

---

## Task 7: Create Reference Extension — marketplace-behaviors

**Files:**
- Create: `aimeat/docs/extensions/marketplace-behaviors/extension.yaml`
- Create: `aimeat/docs/extensions/marketplace-behaviors/actions/purchase.js`
- Create: `aimeat/docs/extensions/marketplace-behaviors/actions/deliver.js`
- Create: `aimeat/docs/extensions/marketplace-behaviors/actions/rate.js`
- Create: `aimeat/docs/extensions/marketplace-behaviors/README.md`

**Step 1: Write manifest + action scripts**

Use the exact code from the design doc Sections 3.2 and 4.2. These are reference implementations that show how to build a marketplace on AIMEAT.

**Step 2: Write unit tests for each action**

Create `aimeat/test/unit/ext-marketplace-behaviors.test.ts` that:
- Tests `purchase.js` with mock ctx (verify escrow hold, state transition)
- Tests `deliver.js` with mock ctx (verify escrow release, state transition)
- Tests `rate.js` with mock ctx (verify trust adjustment, one-rating-per-purchase)
- Tests edge cases (listing not found, already purchased, only seller can deliver, etc.)

**Step 3: Commit**

```bash
cd aimeat && git add docs/extensions/marketplace-behaviors/
git commit -m "feat: marketplace-behaviors reference extension (escrow + ratings)"
```

---

## Task 8: Create Reference Extension — membership-behaviors

**Files:**
- Create: `aimeat/docs/extensions/membership-behaviors/extension.yaml`
- Create: `aimeat/docs/extensions/membership-behaviors/actions/join.js`
- Create: `aimeat/docs/extensions/membership-behaviors/actions/invite.js`
- Create: `aimeat/docs/extensions/membership-behaviors/actions/leave.js`
- Create: `aimeat/docs/extensions/membership-behaviors/actions/promote.js`
- Create: `aimeat/docs/extensions/membership-behaviors/actions/review-request.js`
- Create: `aimeat/docs/extensions/membership-behaviors/README.md`

**Step 1: Write manifest + action scripts**

Use the extension manifest from design doc Section 5.2. Actions implement:
- `join` — checks join policy (open/approval/invite), creates membership record in memory
- `invite` — admin creates pending membership, invitee can accept
- `leave` — removes membership from memory, cleans up
- `promote` — changes member role (member -> admin or admin -> member)
- `review-request` — admin approves/rejects join request

**Step 2: Write unit tests**

Create `aimeat/test/unit/ext-membership-behaviors.test.ts` with join policy tests, invite flow, leave + cleanup.

**Step 3: Commit**

```bash
cd aimeat && git add docs/extensions/membership-behaviors/
git commit -m "feat: membership-behaviors reference extension (join policies + RBAC)"
```

---

## Task 9: Update OpenAPI + Gap Analysis

**Files:**
- Modify: `openapi.yaml` — add extension management endpoints + `/v1/ext/` dynamic route docs
- Modify: `docs/gap-analyses/2026-03-04-phase-2-gap-analysis.md` — update status

**Step 1: Add extension endpoints to OpenAPI**

Add to `openapi.yaml`:
- `Extensions` tag
- All 6 management endpoints from Task 5
- Schema definitions for `ExtensionRecord`, `EscrowHoldRecord`
- Document `/v1/ext/{extensionName}/{actionId}` as a dynamic route pattern

**Step 2: Update gap analysis**

Update the Phase 2 gap analysis to reflect:
- Marketplace routes: marked as "migrating to CSM + Extension"
- Organism routes: marked as "migrating to CSM + Extension"
- Extension system: new section documenting the architecture

**Step 3: Commit**

```bash
cd aimeat && git add openapi.yaml docs/gap-analyses/
git commit -m "docs: add extension system to OpenAPI + update gap analysis"
```

---

## Task 10: E2E Test — Full Extension Lifecycle

**Files:**
- Create: `aimeat/test/e2e-extensions.ts`

**Step 1: Write E2E test**

Following the existing `test/e2e-hooks.ts` pattern (hand-rolled `test()`, raw `fetch()` against `http://localhost:40251`):

1. Install marketplace-behaviors extension via `POST /v1/extensions`
2. Activate it via `POST /v1/extensions/marketplace-behaviors/activate`
3. Verify it appears in `GET /v1/extensions`
4. Write a listing to memory (CSM-driven: `POST /v1/memory`)
5. Call `POST /v1/ext/marketplace-behaviors/purchase` — verify escrow hold
6. Call `POST /v1/ext/marketplace-behaviors/deliver` — verify escrow release
7. Call `POST /v1/ext/marketplace-behaviors/rate` — verify trust adjustment
8. Deactivate extension — verify action routes return 404
9. Uninstall extension — verify it's gone from list

**Step 2: Run the E2E test**

```bash
cd aimeat && npx tsx test/e2e-extensions.ts
```

Expected: ALL PASS.

**Step 3: Commit**

```bash
cd aimeat && git add test/e2e-extensions.ts
git commit -m "test: E2E test for full extension lifecycle (install -> activate -> use -> uninstall)"
```

---

## Summary: Task Dependencies

```
Task 1 (isolated-vm dep)
  └─→ Task 2 (storage types)
       └─→ Task 3 (config)
            └─→ Task 4 (V8 runtime)
                 └─→ Task 5 (routes + server.ts)
                      ├─→ Task 6 (organism CSM)
                      ├─→ Task 7 (marketplace extension)
                      ├─→ Task 8 (membership extension)
                      └─→ Task 9 (OpenAPI + docs)
                           └─→ Task 10 (E2E test)
```

Tasks 6, 7, 8 can run in parallel after Task 5.

---

## Future Tasks (separate plans)

These are NOT in scope for this plan but will follow:

- **Remove hardcoded routes:** Delete `marketplace.ts`, `organisms.ts`, dedicated storage types. Migrate existing data to memory entries.
- **Federation capability routing:** Advertise extension capabilities in heartbeats, capability discovery endpoint, cross-node extension calls.
- **Wallet escrow endpoints:** Generic `POST /v1/wallet/escrow`, `DELETE /v1/wallet/escrow/:holdId` routes.
- **Workspace RBAC migration:** Move `workspace-access.ts` logic into `membership-behaviors` extension.

---

*Plan created: 2026-03-04*
*Design doc: `docs/plans/2026-03-04-csm-driven-services-and-node-extensions-design.md`*
