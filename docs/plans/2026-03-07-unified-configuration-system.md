# Unified Configuration System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the env-only config system with a database-first, multi-source configuration layer that supports `.env`, `aimeat.ini`, JSON config files, database persistence, and HashiCorp Consul — with the admin dashboard as the primary management interface.

**Architecture:** Config loads from multiple sources with clear precedence: Database (highest) > Consul > aimeat.ini/JSON > .env > defaults. All runtime changes via the admin panel persist to the database. Consul integration provides external orchestration for fleet management. The existing `SystemSetting` Prisma model is extended to store all config key-value pairs.

**Tech Stack:** Node.js/TypeScript, Prisma (MongoDB), Express, `ini` package for INI parsing, `consul` package for Consul KV integration, existing admin SPA (Preact/htm).

---

## Background & Motivation

### Current State (Problems)

1. **Config is env-only** — `loadConfig()` reads ~237 fields from `process.env` with hardcoded defaults
2. **No persistence** — PUT /v1/admin/config changes are **in-memory only**, lost on restart
3. **No file config** — No support for `aimeat.ini` or JSON config files
4. **Fleet management impossible** — Each node requires manual `.env` editing; no centralized config
5. **Admin panel misleads** — Config tab lets operators edit values that silently vanish on restart

### Target State

1. **Database is source of truth** — All config persists in `SystemSetting` table
2. **Multi-source loading** with clear precedence (see below)
3. **Admin panel is primary UI** — Changes persist immediately, with guidance and validation
4. **Consul integration** — Optional external config source for fleet orchestration
5. **File configs supported** — `aimeat.ini` and `aimeat.json` as static config sources
6. **One-time init** — Run `aimeat init` once, then manage everything through the dashboard or Consul

### Config Precedence (highest wins)

```
1. Database (SystemSetting)     ← Admin panel writes here
2. Consul KV (/aimeat/config/)  ← Fleet orchestration writes here
3. aimeat.ini / aimeat.json     ← Static file config
4. .env / environment variables  ← Container/systemd config
5. Hardcoded defaults            ← Fallback
```

**Important:** Some values are **immutable at runtime** (node.id, port, storage.type) — these can only be set via env/file/Consul before startup. The DB layer only stores mutable config.

### Consul Overview

[HashiCorp Consul](https://www.consul.io/) is a service mesh and configuration management tool. Its **KV Store** is commonly used for centralized configuration:

- **KV Store**: Hierarchical key-value storage accessible via HTTP API
- **Watches**: Applications can watch for config changes and react in real-time
- **ACLs**: Fine-grained access control for config keys
- **Multi-datacenter**: Config replication across data centers

AIMEAT will use Consul's KV store as an **optional config source** that sits between file config and database overrides. This enables:
- Centralized config for a fleet of AIMEAT nodes
- Dynamic config updates pushed from Consul to all nodes
- Integration with existing infrastructure that uses Consul

---

## Phase 1: Database Config Persistence

### Task 1: Extend Storage Interface with Config Methods

**Files:**
- Modify: `aimeat/src/storage/interface.ts`
- Modify: `aimeat/src/storage/providers/mongodb/index.ts`
- Modify: `aimeat/src/storage/memory.ts`

**Step 1: Add config methods to Storage interface**

Add to `Storage` interface in `interface.ts`:

```typescript
// ── Config Persistence ──
getConfigValue(key: string): Promise<string | null>;
setConfigValue(key: string, value: string): Promise<void>;
deleteConfigValue(key: string): Promise<void>;
getAllConfigValues(): Promise<Record<string, string>>;
```

**Step 2: Implement in MongoDB provider**

In `mongodb/index.ts`, use the existing `SystemSetting` model:

```typescript
async getConfigValue(key: string): Promise<string | null> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: `config:${key}` } });
    return row?.value ?? null;
}

async setConfigValue(key: string, value: string): Promise<void> {
    await this.prisma.systemSetting.upsert({
        where: { key: `config:${key}` },
        update: { value },
        create: { key: `config:${key}`, value },
    });
}

async deleteConfigValue(key: string): Promise<void> {
    await this.prisma.systemSetting.deleteMany({ where: { key: `config:${key}` } });
}

async getAllConfigValues(): Promise<Record<string, string>> {
    const rows = await this.prisma.systemSetting.findMany({
        where: { key: { startsWith: 'config:' } },
    });
    const result: Record<string, string> = {};
    for (const r of rows) result[r.key.replace('config:', '')] = r.value;
    return result;
}
```

**Step 3: Implement in-memory provider**

In `memory.ts`, add a simple `Map<string, string>` for config values.

**Step 4: Commit**

```bash
git add src/storage/interface.ts src/storage/providers/mongodb/index.ts src/storage/memory.ts
git commit -m "feat: add config persistence methods to Storage interface"
```

---

### Task 2: Create Config Loader Service

**Files:**
- Create: `aimeat/src/services/config-loader.ts`
- Modify: `aimeat/src/config.ts`

**Step 1: Create the unified config loader**

`src/services/config-loader.ts`:

```typescript
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseIni } from 'ini';

/** Config source with priority (higher = wins) */
export interface ConfigSource {
    name: string;
    priority: number;
    values: Record<string, string>;
}

/** Fields that cannot be changed after startup */
const IMMUTABLE_FIELDS = new Set([
    'node.id', 'node.port', 'node.type', 'storage.type',
    'database_url', 'sqlite_path', 'admin_password',
]);

/**
 * Load config values from all sources in precedence order.
 * Returns merged key-value pairs (highest priority wins).
 */
export async function loadConfigSources(storage: Storage | null): Promise<{
    merged: Record<string, string>;
    sources: ConfigSource[];
}> {
    const sources: ConfigSource[] = [];

    // Priority 1: Hardcoded defaults (lowest)
    // (handled by loadConfig() fallback — not listed here)

    // Priority 2: .env / environment variables
    const envValues = loadEnvSource();
    if (Object.keys(envValues).length > 0) {
        sources.push({ name: 'env', priority: 10, values: envValues });
    }

    // Priority 3: aimeat.ini or aimeat.json file
    const fileValues = loadFileSource();
    if (fileValues && Object.keys(fileValues.values).length > 0) {
        sources.push(fileValues);
    }

    // Priority 4: Consul KV (if configured)
    // → Added in Phase 3

    // Priority 5: Database (highest for mutable fields)
    if (storage) {
        const dbValues = await storage.getAllConfigValues();
        if (Object.keys(dbValues).length > 0) {
            sources.push({ name: 'database', priority: 50, values: dbValues });
        }
    }

    // Merge: highest priority wins
    sources.sort((a, b) => a.priority - b.priority);
    const merged: Record<string, string> = {};
    for (const source of sources) {
        for (const [key, value] of Object.entries(source.values)) {
            merged[key] = value;
        }
    }

    return { merged, sources };
}

/** Map config dot-paths to AIMEAT_* env var names */
const DOT_PATH_TO_ENV: Record<string, string> = {
    'node.id': 'AIMEAT_NODE_ID',
    'node.port': 'AIMEAT_PORT',
    'node.type': 'AIMEAT_NODE_TYPE',
    'morsel_policy.welcome_bonus': 'AIMEAT_WELCOME_BONUS',
    'morsel_policy.daily_allowance': 'AIMEAT_DAILY_ALLOWANCE',
    'morsel_policy.daily_allowance_cap': 'AIMEAT_DAILY_ALLOWANCE_CAP',
    'morsel_policy.burn_rate': 'AIMEAT_BURN_RATE',
    'auth.jwt_ttl_seconds': 'AIMEAT_JWT_TTL_SECONDS',
    // ... (full mapping built from existing loadConfig() in config.ts)
};

const ENV_TO_DOT_PATH: Record<string, string> = {};
for (const [dot, env] of Object.entries(DOT_PATH_TO_ENV)) {
    ENV_TO_DOT_PATH[env] = dot;
}

function loadEnvSource(): Record<string, string> {
    const values: Record<string, string> = {};
    for (const [env, dot] of Object.entries(ENV_TO_DOT_PATH)) {
        const val = process.env[env];
        if (val !== undefined) values[dot] = val;
    }
    return values;
}

function loadFileSource(): ConfigSource | null {
    // Check for aimeat.ini first, then aimeat.json
    const cwd = process.cwd();

    const iniPath = resolve(cwd, 'aimeat.ini');
    if (existsSync(iniPath)) {
        try {
            const raw = readFileSync(iniPath, 'utf8');
            const parsed = parseIni(raw);
            return {
                name: `file:${iniPath}`,
                priority: 20,
                values: flattenIni(parsed),
            };
        } catch { /* ignore parse errors */ }
    }

    const jsonPath = resolve(cwd, 'aimeat.json');
    if (existsSync(jsonPath)) {
        try {
            const raw = readFileSync(jsonPath, 'utf8');
            const parsed = JSON.parse(raw);
            return {
                name: `file:${jsonPath}`,
                priority: 20,
                values: flattenJson(parsed),
            };
        } catch { /* ignore parse errors */ }
    }

    return null;
}

/** Flatten INI sections into dot-path keys */
function flattenIni(obj: Record<string, any>, prefix = ''): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, val] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
            Object.assign(result, flattenIni(val, path));
        } else {
            result[path] = String(val);
        }
    }
    return result;
}

/** Flatten JSON object into dot-path keys */
function flattenJson(obj: Record<string, any>, prefix = ''): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, val] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
            Object.assign(result, flattenJson(val, path));
        } else {
            result[path] = JSON.stringify(val);
        }
    }
    return result;
}

export function isImmutable(dotPath: string): boolean {
    return IMMUTABLE_FIELDS.has(dotPath);
}
```

**Step 2: Commit**

```bash
git add src/services/config-loader.ts
git commit -m "feat: add unified config loader with multi-source support"
```

---

### Task 3: Persist Admin Config Changes to Database

**Files:**
- Modify: `aimeat/src/routes/admin.ts` (PUT /v1/admin/config handler, ~line 524)

**Step 1: Update the PUT handler to persist changes**

In the existing PUT /v1/admin/config handler, after the in-memory mutation succeeds, also persist to DB:

```typescript
// After: (config as any)[mapping.key] = value;
// Add:
try {
    await storage.setConfigValue(change.path, JSON.stringify(value));
} catch (e) {
    console.warn(`[config] Failed to persist ${change.path} to DB:`, e);
}
```

**Step 2: Update the response note**

Change the existing note from:
```
'Runtime config updated. Changes lost on restart unless persisted to environment or config file.'
```
To:
```
'Config updated and persisted to database. Changes survive restart.'
```

**Step 3: Add a DELETE /v1/admin/config/:path endpoint**

Allow operators to remove a DB override (revert to file/env/default):

```typescript
router.delete('/v1/admin/config/:path', requireAuth(), requireRole('operator'), async (req, res) => {
    const path = req.params.path as string;
    await storage.deleteConfigValue(path);
    res.json(success(config.nodeId, { deleted: path, note: 'DB override removed. Value will revert to file/env/default on next restart.' }));
});
```

**Step 4: Commit**

```bash
git add src/routes/admin.ts
git commit -m "feat: persist admin config changes to database"
```

---

### Task 4: Load DB Config on Startup

**Files:**
- Modify: `aimeat/src/config.ts`
- Modify: `aimeat/src/server.ts`

**Step 1: Add a `applyConfigOverrides()` function to config.ts**

```typescript
/**
 * Apply config overrides from database (called after storage is initialized).
 * Only applies to mutable fields — immutable fields are ignored.
 */
export async function applyConfigOverrides(
    config: AimeatConfig,
    storage: Storage,
): Promise<{ applied: string[]; skipped: string[] }> {
    const dbValues = await storage.getAllConfigValues();
    const applied: string[] = [];
    const skipped: string[] = [];

    for (const [dotPath, rawValue] of Object.entries(dbValues)) {
        if (isImmutable(dotPath)) {
            skipped.push(dotPath);
            continue;
        }
        const mapping = MUTABLE_CONFIG_MAP[dotPath];
        if (!mapping) { skipped.push(dotPath); continue; }

        try {
            const value = JSON.parse(rawValue);
            (config as any)[mapping.key] = value;
            applied.push(dotPath);
        } catch {
            skipped.push(dotPath);
        }
    }

    return { applied, skipped };
}
```

**Step 2: Call it in server.ts after storage init**

In `server.ts`, after storage is initialized but before routes are mounted:

```typescript
// After: const storage = await initStorage(config);
const { applied, skipped } = await applyConfigOverrides(config, storage);
if (applied.length > 0) {
    console.log(`[config] Applied ${applied.length} DB overrides: ${applied.join(', ')}`);
}
```

**Step 3: Commit**

```bash
git add src/config.ts src/server.ts
git commit -m "feat: load config overrides from database on startup"
```

---

### Task 5: Add Config Source Provenance to Admin API

**Files:**
- Modify: `aimeat/src/routes/admin.ts` (GET /v1/admin/config handler)

**Step 1: Enhance the config schema response**

Add a `source` field to each config entry showing where the current value came from:

```typescript
// In GET /v1/admin/config handler, for each mutable field:
const dbValues = await storage.getAllConfigValues();

// For each schema entry, add:
source: dbValues[path] !== undefined ? 'database'
    : process.env[envVarName] !== undefined ? 'env'
    : 'default'
```

This tells the admin UI:
- `database` — Value was set via admin panel (persisted)
- `env` — Value comes from environment variable
- `file` — Value comes from aimeat.ini/json
- `default` — Using hardcoded default

**Step 2: Add a "reset to default" capability in the response**

Add `canReset: source !== 'default'` to let the UI show a reset button.

**Step 3: Commit**

```bash
git add src/routes/admin.ts
git commit -m "feat: add config source provenance to admin API"
```

---

## Phase 2: File Config Support (aimeat.ini / aimeat.json)

### Task 6: Add INI Package Dependency

**Files:**
- Modify: `aimeat/package.json`

**Step 1: Install ini parser**

```bash
cd aimeat && pnpm add ini && pnpm add -D @types/ini
```

**Step 2: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add ini parser dependency"
```

---

### Task 7: Create Example Config Files

**Files:**
- Create: `aimeat/aimeat.ini.example`
- Create: `aimeat/aimeat.json.example`

**Step 1: Create aimeat.ini.example**

```ini
; AIMEAT Node Configuration
; Copy to aimeat.ini and adjust values.
; Database overrides and admin panel changes take precedence over this file.

[node]
id = aimeat-local-001-dev
port = 40050
type = full

[storage]
type = mongodb
; database_url = mongodb://localhost:27017/aimeat

[auth]
jwt_ttl_seconds = 3600

[morsel_policy]
welcome_bonus = 100
daily_allowance = 50
daily_allowance_cap = 500
burn_rate = 0.10
max_operator_mint_per_day = 10000
board_post_base_cost = 5
board_post_cost_per_kb = 2

[features]
keyed_browse_enabled = true
extended_features_enabled = true

[work]
queue_max_pending = 10
webhook_max_retries = 5

[quota]
memory_mb = 10
storage_mb = 100
micro_memory_kb = 500

[federation]
max_relay_hops = 3

[email]
enabled = false
; smtp_host = smtp.example.com
; smtp_port = 587

[totp]
enabled = true

[matching]
enabled = false

[marketplace]
enabled = false

[push]
enabled = false

[consul]
; enabled = false
; url = http://localhost:8500
; prefix = aimeat/config
; token =
; watch_interval_seconds = 30
; datacenter =
```

**Step 2: Create aimeat.json.example**

```json
{
    "$schema": "./aimeat-config.schema.json",
    "node": {
        "id": "aimeat-local-001-dev",
        "port": 40050,
        "type": "full"
    },
    "auth": {
        "jwt_ttl_seconds": 3600
    },
    "morsel_policy": {
        "welcome_bonus": 100,
        "daily_allowance": 50,
        "burn_rate": 0.10
    },
    "features": {
        "keyed_browse_enabled": true,
        "extended_features_enabled": true
    }
}
```

**Step 3: Commit**

```bash
git add aimeat.ini.example aimeat.json.example
git commit -m "docs: add example aimeat.ini and aimeat.json config files"
```

---

### Task 8: Wire File Config into Startup

**Files:**
- Modify: `aimeat/src/config.ts`

**Step 1: Integrate file loading into loadConfig()**

Before reading env vars, check for config files:

```typescript
export function loadConfig(): AimeatConfig {
    // 1. Load file config (aimeat.ini or aimeat.json)
    const fileOverrides = loadFileConfig();

    // 2. For each field, check: env var → file → default
    function get(envVar: string, dotPath: string, defaultVal: string): string {
        return process.env[envVar] ?? fileOverrides[dotPath] ?? defaultVal;
    }

    const port = parseInt(get('AIMEAT_PORT', 'node.port', '40050'), 10);
    // ... rest of config loading using get()
}
```

**Step 2: Log which config source was used**

```typescript
if (Object.keys(fileOverrides).length > 0) {
    console.log(`[config] Loaded ${Object.keys(fileOverrides).length} values from config file`);
}
```

**Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: support aimeat.ini and aimeat.json config files"
```

---

## Phase 3: Consul Integration

### Task 9: Add Consul Dependency and Config Fields

**Files:**
- Modify: `aimeat/package.json`
- Modify: `aimeat/src/config.ts`

**Step 1: Install consul client**

```bash
cd aimeat && pnpm add consul
```

**Step 2: Add Consul config fields to AimeatConfig**

```typescript
// In AimeatConfig interface:
consulEnabled: boolean;
consulUrl: string;
consulPrefix: string;
consulToken: string;
consulWatchIntervalSeconds: number;
consulDatacenter: string;
```

**Step 3: Add env var loading in loadConfig()**

```typescript
consulEnabled: (get('AIMEAT_CONSUL_ENABLED', 'consul.enabled', 'false')) === 'true',
consulUrl: get('AIMEAT_CONSUL_URL', 'consul.url', 'http://localhost:8500'),
consulPrefix: get('AIMEAT_CONSUL_PREFIX', 'consul.prefix', 'aimeat/config'),
consulToken: get('AIMEAT_CONSUL_TOKEN', 'consul.token', ''),
consulWatchIntervalSeconds: parseInt(get('AIMEAT_CONSUL_WATCH_INTERVAL', 'consul.watch_interval_seconds', '30'), 10),
consulDatacenter: get('AIMEAT_CONSUL_DATACENTER', 'consul.datacenter', ''),
```

**Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml src/config.ts
git commit -m "feat: add Consul configuration fields"
```

---

### Task 10: Create Consul Config Service

**Files:**
- Create: `aimeat/src/services/consul-config.ts`

**Step 1: Implement the Consul KV integration**

```typescript
import Consul from 'consul';
import type { AimeatConfig } from '../config.js';
import { isImmutable } from './config-loader.js';

export interface ConsulConfigService {
    /** Load all config values from Consul KV */
    loadAll(): Promise<Record<string, string>>;
    /** Start watching for changes (calls onUpdate when config changes) */
    startWatching(onUpdate: (changes: Record<string, string>) => void): void;
    /** Stop watching */
    stopWatching(): void;
    /** Write a config value to Consul (for export/sync) */
    set(key: string, value: string): Promise<void>;
    /** Check Consul connectivity */
    health(): Promise<boolean>;
}

export function createConsulConfigService(config: AimeatConfig): ConsulConfigService | null {
    if (!config.consulEnabled) return null;

    const consul = new Consul({
        host: new URL(config.consulUrl).hostname,
        port: new URL(config.consulUrl).port || '8500',
        secure: config.consulUrl.startsWith('https'),
        defaults: {
            token: config.consulToken || undefined,
            dc: config.consulDatacenter || undefined,
        },
    });

    const prefix = config.consulPrefix.endsWith('/')
        ? config.consulPrefix
        : config.consulPrefix + '/';

    let watchTimer: ReturnType<typeof setInterval> | null = null;
    let lastHash = '';

    return {
        async loadAll(): Promise<Record<string, string>> {
            try {
                const keys = await consul.kv.get({ key: prefix, recurse: true }) as any[];
                if (!keys) return {};
                const result: Record<string, string> = {};
                for (const entry of keys) {
                    const dotPath = entry.Key.replace(prefix, '').replace(/\//g, '.');
                    if (dotPath && !isImmutable(dotPath)) {
                        result[dotPath] = Buffer.from(entry.Value, 'base64').toString('utf8');
                    }
                }
                return result;
            } catch (err) {
                console.warn('[consul] Failed to load config:', (err as Error).message);
                return {};
            }
        },

        startWatching(onUpdate) {
            watchTimer = setInterval(async () => {
                try {
                    const values = await this.loadAll();
                    const hash = JSON.stringify(values);
                    if (hash !== lastHash) {
                        lastHash = hash;
                        onUpdate(values);
                    }
                } catch { /* ignore watch errors */ }
            }, config.consulWatchIntervalSeconds * 1000);
        },

        stopWatching() {
            if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
        },

        async set(key: string, value: string): Promise<void> {
            const consulKey = prefix + key.replace(/\./g, '/');
            await consul.kv.set(consulKey, value);
        },

        async health(): Promise<boolean> {
            try {
                await consul.agent.self();
                return true;
            } catch { return false; }
        },
    };
}
```

**Step 2: Commit**

```bash
git add src/services/consul-config.ts
git commit -m "feat: add Consul KV config service"
```

---

### Task 11: Wire Consul into Server Startup

**Files:**
- Modify: `aimeat/src/server.ts`

**Step 1: Initialize Consul and load config after storage**

```typescript
import { createConsulConfigService } from './services/consul-config.js';

// After storage init, before DB config overrides:
const consulService = createConsulConfigService(config);
if (consulService) {
    const consulValues = await consulService.loadAll();
    const consulCount = Object.keys(consulValues).length;
    if (consulCount > 0) {
        console.log(`[consul] Loaded ${consulCount} config values from Consul KV`);
        // Apply consul values (priority between file and DB)
        // DB overrides still win over Consul
    }

    // Start watching for changes
    consulService.startWatching((changes) => {
        console.log(`[consul] Config update detected: ${Object.keys(changes).length} keys`);
        // Apply changes to runtime config (same as admin PUT handler)
    });
}

// Then apply DB overrides (highest priority)
const { applied } = await applyConfigOverrides(config, storage);
```

**Step 2: Commit**

```bash
git add src/server.ts
git commit -m "feat: wire Consul config into server startup with watching"
```

---

### Task 12: Admin API for Consul Status

**Files:**
- Modify: `aimeat/src/routes/admin.ts`

**Step 1: Add GET /v1/admin/consul endpoint**

```typescript
router.get('/v1/admin/consul', requireAuth(), requireRole('operator'), async (_req, res) => {
    if (!consulService) {
        res.json(success(config.nodeId, {
            enabled: false,
            note: 'Consul integration is not enabled. Set AIMEAT_CONSUL_ENABLED=true and AIMEAT_CONSUL_URL.',
        }));
        return;
    }

    const healthy = await consulService.health();
    const values = await consulService.loadAll();

    res.json(success(config.nodeId, {
        enabled: true,
        url: config.consulUrl,
        prefix: config.consulPrefix,
        healthy,
        key_count: Object.keys(values).length,
        keys: Object.keys(values),
        watch_interval_seconds: config.consulWatchIntervalSeconds,
    }));
});
```

**Step 2: Add POST /v1/admin/consul/export — push current config to Consul**

```typescript
router.post('/v1/admin/consul/export', requireAuth(), requireRole('operator'), async (_req, res) => {
    if (!consulService) {
        res.status(400).json(error(config.nodeId, 'CONSUL_DISABLED', 'Consul is not enabled'));
        return;
    }

    // Export all mutable config values to Consul KV
    const schema = getMutableConfigSchema(config); // reuse from GET /v1/admin/config
    let exported = 0;
    for (const [path, entry] of Object.entries(schema)) {
        try {
            await consulService.set(path, JSON.stringify(entry.value));
            exported++;
        } catch { /* skip individual failures */ }
    }

    res.json(success(config.nodeId, { exported, total: Object.keys(schema).length }));
});
```

**Step 3: Commit**

```bash
git add src/routes/admin.ts
git commit -m "feat: add Consul status and export admin endpoints"
```

---

## Phase 4: Admin Dashboard UI Enhancements

### Task 13: Update Config Tab with Source Badges and Reset

**Files:**
- Modify: `aimeat/public/views/admin/config-tab.js`

**Step 1: Show source provenance badges**

For each config entry, display a small badge indicating source:

```javascript
// In config-tab.js, per item:
const sourceBadge = (source) => {
    const colors = { database: '#22c55e', env: '#3b82f6', file: '#a855f7', consul: '#06b6d4', default: '#64748b' };
    return html`<span class="tag" style="background:${colors[source] || '#64748b};font-size:.65rem;padding:1px 6px">${source}</span>`;
};
```

**Step 2: Add "Reset" button for non-default values**

When `source === 'database'`, show a reset button that calls `DELETE /v1/admin/config/:path`.

**Step 3: Commit**

```bash
git add public/views/admin/config-tab.js
git commit -m "feat: show config source badges and reset buttons in admin"
```

---

### Task 14: Add Consul Tab to Admin Dashboard

**Files:**
- Create: `aimeat/public/views/admin/consul-tab.js`
- Modify: `aimeat/public/views/admin.js` (register tab)
- Modify: `aimeat/public/js/services/admin.js` (add API calls)

**Step 1: Create consul-tab.js**

Show:
- Consul connection status (healthy/unreachable)
- URL and prefix
- Number of keys loaded
- List of keys with values
- "Export to Consul" button
- "Import from Consul" button

**Step 2: Register in admin.js sidebar**

Add under "Infrastructure" group:
```javascript
{ id: 'consul', icon: '\u{1F5C4}', key: 'dashboard.consul', component: ConsulTab },
```

**Step 3: Add API calls to admin.js service**

```javascript
export const getConsulStatus = () => apiGet('/v1/admin/consul');
export const exportToConsul = () => apiPost('/v1/admin/consul/export');
```

**Step 4: Add translations**

Both `en.json` and `fi.json`:
- `dashboard.consul`: "Consul" / "Consul"
- `dashboard.consulStatus`: "Consul Status" / "Consul-tila"
- `dashboard.consulDisabled`: "Consul integration is not enabled" / "Consul-integraatio ei ole käytössä"
- `dashboard.consulHealthy`: "Connected" / "Yhdistetty"
- `dashboard.consulUnhealthy`: "Unreachable" / "Ei tavoitettavissa"
- `dashboard.consulExport`: "Export Config to Consul" / "Vie asetukset Consuliin"
- `dashboard.consulImport`: "Import from Consul" / "Tuo Consulista"
- `dashboard.consulKeysLoaded`: "Keys loaded" / "Avaimia ladattu"
- `dashboard.consulExplain`: "Consul provides centralized configuration for fleet management..." / "Consul tarjoaa keskitetyn asetustenhallinnan..."
- `dashboard.consulSetupGuide`: "Setup Guide" / "Asennusohje"

**Step 5: Commit**

```bash
git add public/views/admin/consul-tab.js public/views/admin.js public/js/services/admin.js locales/en.json locales/fi.json
git commit -m "feat: add Consul tab to admin dashboard"
```

---

## Phase 5: Init Wizard and CLI Updates

### Task 15: Update Init Wizard for Multi-Source Config

**Files:**
- Modify: `aimeat/src/cli/init-wizard.ts`

**Step 1: Add output format selection**

After the use-case selection, ask:

```
Config output format:
  1. .env file (traditional, works with Docker/systemd)
  2. aimeat.ini (INI format, human-friendly)
  3. aimeat.json (JSON format, machine-friendly)
  4. All formats (generates all three)
```

**Step 2: Generate aimeat.ini and aimeat.json writers**

Add `writeIniConfig()` and `writeJsonConfig()` functions alongside the existing `.env` writer.

**Step 3: Commit**

```bash
git add src/cli/init-wizard.ts
git commit -m "feat: init wizard supports .env, aimeat.ini, and aimeat.json output"
```

---

### Task 16: Add `aimeat config export` CLI Command

**Files:**
- Create: `aimeat/src/cli/config-export.ts`
- Modify: `aimeat/src/index.ts` (add CLI subcommand)

**Step 1: Create export command**

```bash
# Export current config to different formats:
aimeat config export --format ini > aimeat.ini
aimeat config export --format json > aimeat.json
aimeat config export --format env > .env
aimeat config export --format consul  # Push to Consul KV
```

**Step 2: Commit**

```bash
git add src/cli/config-export.ts src/index.ts
git commit -m "feat: add aimeat config export CLI command"
```

---

## Phase 6: Documentation

### Task 17: Write Configuration Guide

**Files:**
- Create: `aimeat/docs/configuration-guide.md`

Cover:
1. **Quick start** — `aimeat init` generates config, done
2. **Config sources** — Explanation of all 5 sources and precedence
3. **Admin panel** — Primary way to manage config (with screenshots/examples)
4. **File config** — aimeat.ini and aimeat.json format reference
5. **Environment variables** — Full AIMEAT_* reference table
6. **Consul integration** — Step-by-step setup guide:
   - Install Consul (Docker one-liner: `docker run -d --name consul -p 8500:8500 consul`)
   - Configure AIMEAT: `AIMEAT_CONSUL_ENABLED=true`, `AIMEAT_CONSUL_URL=http://consul:8500`
   - Export config: admin panel "Export to Consul" button or `aimeat config export --format consul`
   - Fleet management: all nodes pointing to same Consul KV prefix share config
7. **Fleet management patterns** — Common Consul KV layouts for multi-node setups
8. **Migration guide** — Moving from .env-only to database-first

**Step 1: Write the guide**

**Step 2: Commit**

```bash
git add docs/configuration-guide.md
git commit -m "docs: add comprehensive configuration guide"
```

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| **1: DB Persistence** | 1-5 | Storage interface, config loader, persist changes, startup loading, provenance |
| **2: File Config** | 6-8 | INI parser, example files, wire into startup |
| **3: Consul** | 9-12 | Consul client, service, startup integration, admin API |
| **4: Admin UI** | 13-14 | Source badges, reset buttons, Consul tab |
| **5: CLI** | 15-16 | Init wizard update, config export command |
| **6: Docs** | 17 | Configuration guide |

### Key Design Decisions

1. **DB wins over file/env for mutable fields** — The admin panel is the primary config interface. Operators should not need to SSH into servers to change settings.

2. **Immutable fields stay file/env-only** — `node.id`, `port`, `storage.type` cannot be changed at runtime. These are infrastructure decisions made at deploy time.

3. **Consul is optional middleware** — Nodes work fine without Consul. Adding it is a single env var toggle. This keeps the system simple for solo operators while enabling fleet management.

4. **Existing SystemSetting model reused** — No schema migration needed. Config keys are prefixed with `config:` to namespace them alongside the existing `maintenance` key.

5. **Backward compatible** — Existing `.env` setups continue working unchanged. The database layer is additive, not a replacement.

6. **File configs are static** — `aimeat.ini`/`aimeat.json` are read once at startup. They don't hot-reload. For dynamic changes, use the admin panel or Consul.
