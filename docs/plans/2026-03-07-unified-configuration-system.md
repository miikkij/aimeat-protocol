# Unified Configuration System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the env-only config system with a database-first, multi-source configuration layer that supports `.env`, `aimeat.ini`, JSON config files, database persistence, CLI bootstrap arguments, and HashiCorp Consul — with the admin dashboard as the primary management interface for persistent-database nodes.

**Architecture:** Config loads from multiple sources with clear precedence. All runtime changes via the admin panel persist to the database. In-memory nodes are read-only (config managed via `.env`/files/CLI only). Consul integration provides optional external orchestration for fleet management.

**Tech Stack:** Node.js/TypeScript, Prisma (MongoDB) + better-sqlite3, Express, `ini` package for INI parsing, `consul` package for Consul KV integration, existing admin SPA (Preact/HTM).

---

## Background & Motivation

### Current State (Problems)

1. **Config is env-only** — `loadConfig()` reads ~237 fields from `process.env` with hardcoded defaults
2. **No persistence** — PUT /v1/admin/config changes are **in-memory only**, lost on restart
3. **No file config** — No support for `aimeat.ini` or JSON config files
4. **Fleet management impossible** — Each node requires manual `.env` editing; no centralized config
5. **Admin panel misleads** — Config tab lets operators edit values that silently vanish on restart
6. **No CLI bootstrap** — Database type/address cannot be passed as command-line arguments
7. **SQLite has no system_settings table** — MongoDB has `SystemSetting` model in Prisma, SQLite does not

### Target State

1. **Database is source of truth** — All config persists in `SystemSetting` / `system_settings` table (MongoDB + SQLite)
2. **In-memory nodes are read-only** — Admin panel shows config but disables editing; guides operators to `.env`/`aimeat init`
3. **Multi-source loading** with clear precedence (see below)
4. **Admin panel is primary UI** — For persistent-database nodes, changes persist immediately with validation
5. **Consul integration** — Optional external config source for fleet orchestration
6. **File configs supported** — `aimeat.ini` and `aimeat.json` as static config sources
7. **CLI bootstrap** — `aimeat start --db mongodb --db-url ...` and `--consul` flags for containerized deployments
8. **One-time init** — Run `aimeat init` once, then manage everything through the dashboard or Consul

### Config Precedence (highest wins)

```
Bootstrap layer (resolved FIRST, before anything else):
  CLI args --db/--db-url/--consul  ← needed to connect to DB/Consul

Then full config stack:
  1. Database (SystemSetting)     ← Admin panel writes here (persistent DB only)
  2. Consul KV (/aimeat/config/)  ← Fleet orchestration writes here
  3. aimeat.ini / aimeat.json     ← Static file config
  4. .env / environment variables  ← Container/systemd config
  5. Hardcoded defaults            ← Fallback
```

**Important constraints:**
- **Immutable fields** (`node.id`, `port`, `storage.type`, `database_url`, `sqlite_path`, `admin_password`) can only be set via CLI/env/file/Consul before startup. The DB layer never stores these.
- **In-memory storage** = read-only config. No DB persistence possible. Admin PUT returns 403.

### In-Memory Storage Guard

When `storage.type === 'memory'`:
- `GET /v1/admin/config` returns `editable: false` on every field
- `PUT /v1/admin/config` returns **403** with message: `"Config editing requires a persistent database (MongoDB or SQLite). Use .env or aimeat.ini created with 'aimeat init'."`
- `DELETE /v1/admin/config/:path` also returns 403
- Config tab UI shows an **info banner** explaining this and hides the save button

**Rationale:** In-memory has no persistence — letting operators "edit" config that vanishes on restart is misleading. We refuse the edit and guide them to the right tool.

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

### Serialization Strategy

**All sources normalize to raw strings.** Type-aware parsing is driven by `ConfigFieldDef.type`:

| Source | Produces | Example |
|--------|----------|---------|
| `.env` | Raw string | `AIMEAT_WELCOME_BONUS=100` → `"100"` |
| `aimeat.ini` | Raw string | `welcome_bonus = 100` → `"100"` |
| `aimeat.json` | Raw string (via `String(val)`) | `"welcome_bonus": 100` → `"100"` |
| Consul KV | Raw string | KV value bytes → `"100"` |
| Database | Raw string | `system_settings.value` → `"100"` |

Consumer parsing via `ConfigFieldDef.type`:
- `'number'` → `parseInt(raw, 10)`
- `'float'` → `parseFloat(raw)`
- `'boolean'` → `raw === 'true'`
- `'string'` → `raw` as-is

**Why not JSON.stringify/parse?** INI files are human-edited — nobody writes `"hello"` with quotes in an INI. Env vars are always bare strings. Raw strings with type-aware parsing is consistent across all sources.

---

## Phase 1: Foundation

### Task 1: Create system_settings Table in SQLite Schema

**Files:**
- Modify: `aimeat/src/storage/providers/sqlite/schema.ts`

**Step 1: Add system_settings table**

Add to `initializeSchema()`:

```sql
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Step 2: Commit**

```bash
git add src/storage/providers/sqlite/schema.ts
git commit -m "feat: add system_settings table to SQLite schema"
```

---

### Task 2: Verify SystemSetting Prisma Model

**Files:**
- Check: `aimeat/prisma/schema.prisma`

**Step 1: Verify the existing SystemSetting model exists and has the right shape**

The Prisma schema should already have:

```prisma
model SystemSetting {
    id    String @id @default(auto()) @map("_id") @db.ObjectId
    key   String @unique
    value String
}
```

If missing `createdAt`/`updatedAt` fields, add them:

```prisma
model SystemSetting {
    id        String   @id @default(auto()) @map("_id") @db.ObjectId
    key       String   @unique
    value     String
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt
}
```

**Step 2: Run prisma generate if schema changed**

```bash
cd aimeat && npx prisma generate
```

**Step 3: Commit (only if changes were needed)**

```bash
git add prisma/schema.prisma
git commit -m "feat: ensure SystemSetting Prisma model has timestamp fields"
```

---

### Task 3: Extract Shared Config Schema Module

**Files:**
- Create: `aimeat/src/services/config-schema.ts`
- Modify: `aimeat/src/routes/admin.ts` (refactor pathMap to import from shared module)

**Step 1: Create config-schema.ts**

This is the single source of truth for config field definitions. It replaces:
- The 37-entry `pathMap` hardcoded in admin.ts PUT handler
- The `IMMUTABLE_FIELDS` set from config-loader
- The `DOT_PATH_TO_ENV` / `ENV_TO_DOT_PATH` mappings

```typescript
export interface ConfigFieldDef {
    /** AimeatConfig property name (e.g., 'welcomeBonus') */
    key: string;
    /** Dot-path notation (e.g., 'morsel_policy.welcome_bonus') */
    dotPath: string;
    /** AIMEAT_* env var name */
    envVar: string;
    /** Value type for parsing raw strings */
    type: 'number' | 'boolean' | 'string' | 'float';
    /** Validation function */
    validate: (v: unknown) => boolean;
    /** true = cannot be changed after startup (node.id, port, etc.) */
    immutable: boolean;
    /** Human-readable description */
    description: string;
    /** Valid range hint for numbers (e.g., '0-10000') */
    range?: string;
}

/** All known config fields — built from existing loadConfig() + admin pathMap */
export const CONFIG_FIELDS: ConfigFieldDef[] = [
    // -- Node (immutable) --
    { key: 'nodeId', dotPath: 'node.id', envVar: 'AIMEAT_NODE_ID', type: 'string', validate: v => typeof v === 'string' && (v as string).length > 0, immutable: true, description: 'Unique node identifier' },
    { key: 'port', dotPath: 'node.port', envVar: 'AIMEAT_PORT', type: 'number', validate: v => typeof v === 'number' && v >= 1 && v <= 65535, immutable: true, description: 'HTTP port' },
    { key: 'nodeType', dotPath: 'node.type', envVar: 'AIMEAT_NODE_TYPE', type: 'string', validate: v => ['full', 'personal', 'relay'].includes(v as string), immutable: true, description: 'Node type' },
    { key: 'storageProvider', dotPath: 'storage.type', envVar: 'AIMEAT_STORAGE_PROVIDER', type: 'string', validate: v => ['mongodb', 'sqlite', 'memory'].includes(v as string), immutable: true, description: 'Storage backend' },
    { key: 'dbUrl', dotPath: 'database_url', envVar: 'DATABASE_URL', type: 'string', validate: () => true, immutable: true, description: 'Database connection URL' },
    { key: 'sqlitePath', dotPath: 'sqlite_path', envVar: 'AIMEAT_SQLITE_PATH', type: 'string', validate: () => true, immutable: true, description: 'SQLite database file path' },
    { key: 'adminPassword', dotPath: 'admin_password', envVar: 'AIMEAT_ADMIN_PASSWORD', type: 'string', validate: () => true, immutable: true, description: 'Admin password' },

    // -- Morsel Policy (mutable) --
    { key: 'welcomeBonus', dotPath: 'morsel_policy.welcome_bonus', envVar: 'AIMEAT_WELCOME_BONUS', type: 'number', validate: v => typeof v === 'number' && v >= 0 && v <= 10000, immutable: false, description: 'Welcome bonus morsels', range: '0-10000' },
    { key: 'dailyAllowance', dotPath: 'morsel_policy.daily_allowance', envVar: 'AIMEAT_DAILY_ALLOWANCE', type: 'number', validate: v => typeof v === 'number' && v >= 0 && v <= 10000, immutable: false, description: 'Daily morsel allowance', range: '0-10000' },
    { key: 'dailyAllowanceCap', dotPath: 'morsel_policy.daily_allowance_cap', envVar: 'AIMEAT_DAILY_ALLOWANCE_CAP', type: 'number', validate: v => typeof v === 'number' && v >= 0, immutable: false, description: 'Daily allowance cap', range: '0-100000' },
    { key: 'burnRate', dotPath: 'morsel_policy.burn_rate', envVar: 'AIMEAT_BURN_RATE', type: 'float', validate: v => typeof v === 'number' && v >= 0 && v <= 1, immutable: false, description: 'Morsel burn rate', range: '0-1' },
    // ... (remaining 33+ mutable fields extracted from admin.ts pathMap)

    // -- Auth (mutable) --
    { key: 'jwtTtlSeconds', dotPath: 'auth.jwt_ttl_seconds', envVar: 'AIMEAT_JWT_TTL_SECONDS', type: 'number', validate: v => typeof v === 'number' && v >= 60, immutable: false, description: 'JWT token TTL in seconds', range: '60-86400' },

    // -- Features (mutable) --
    { key: 'keyedBrowseEnabled', dotPath: 'features.keyed_browse_enabled', envVar: 'AIMEAT_KEYED_BROWSE_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Enable keyed browsing' },
    { key: 'extendedFeaturesEnabled', dotPath: 'features.extended_features_enabled', envVar: 'AIMEAT_EXTENDED_FEATURES_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'Enable extended features' },

    // ... (complete list built from all ~237 fields in loadConfig() + 37 pathMap entries)
];

// ── Lookup Maps (derived from CONFIG_FIELDS) ──

/** dotPath → ConfigFieldDef (mutable fields only) */
export const MUTABLE_CONFIG_MAP: Record<string, ConfigFieldDef> = {};

/** dotPath → ConfigFieldDef (all fields) */
export const ALL_CONFIG_MAP: Record<string, ConfigFieldDef> = {};

/** env var name → dotPath */
export const ENV_TO_DOT_PATH: Record<string, string> = {};

/** dotPath → env var name */
export const DOT_PATH_TO_ENV: Record<string, string> = {};

for (const field of CONFIG_FIELDS) {
    ALL_CONFIG_MAP[field.dotPath] = field;
    if (!field.immutable) MUTABLE_CONFIG_MAP[field.dotPath] = field;
    ENV_TO_DOT_PATH[field.envVar] = field.dotPath;
    DOT_PATH_TO_ENV[field.dotPath] = field.envVar;
}

export function isImmutable(dotPath: string): boolean {
    return ALL_CONFIG_MAP[dotPath]?.immutable ?? true; // unknown fields treated as immutable
}

/** Parse a raw string value using the field's type definition */
export function parseConfigValue(field: ConfigFieldDef, raw: string): unknown {
    switch (field.type) {
        case 'number': return parseInt(raw, 10);
        case 'float': return parseFloat(raw);
        case 'boolean': return raw === 'true';
        case 'string': return raw;
        default: return raw;
    }
}

/** Serialize a typed value to raw string for storage */
export function serializeConfigValue(value: unknown): string {
    return String(value);
}
```

**Step 2: Refactor admin.ts to import from config-schema**

Replace the hardcoded `pathMap` in the PUT handler with:

```typescript
import { MUTABLE_CONFIG_MAP, parseConfigValue, serializeConfigValue } from '../services/config-schema.js';
```

The PUT handler's validation loop changes from:
```typescript
const mapping = pathMap[change.path];
```
To:
```typescript
const field = MUTABLE_CONFIG_MAP[change.path];
if (!field) { errors.push({ path: change.path, error: 'Unknown config path' }); continue; }
if (!field.validate(change.value)) { errors.push({ path: change.path, error: 'Validation failed' }); continue; }
(config as any)[field.key] = change.value;
```

**Step 3: Commit**

```bash
git add src/services/config-schema.ts src/routes/admin.ts
git commit -m "refactor: extract mutable config map to shared config-schema module"
```

---

### Task 4: Add Config Methods to Storage Interface

**Files:**
- Modify: `aimeat/src/storage/interface.ts`
- Modify: `aimeat/src/storage/providers/mongodb/index.ts`
- Modify: `aimeat/src/storage/providers/sqlite/index.ts`
- Modify: `aimeat/src/storage/memory.ts`

**Step 1: Add config methods to Storage interface**

Add to `Storage` interface in `interface.ts`:

```typescript
// ── Config Persistence ──
/** Returns true if this storage supports config persistence (false for in-memory) */
supportsConfigPersistence(): boolean;
getConfigValue(key: string): Promise<string | null>;
setConfigValue(key: string, value: string): Promise<void>;
deleteConfigValue(key: string): Promise<void>;
getAllConfigValues(): Promise<Record<string, string>>;
```

**Step 2: Implement in MongoDB provider**

In `mongodb/index.ts`, use the existing `SystemSetting` model:

```typescript
supportsConfigPersistence(): boolean { return true; }

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

**Step 3: Implement in SQLite provider**

In `sqlite/index.ts`, use the new `system_settings` table:

```typescript
supportsConfigPersistence(): boolean { return true; }

async getConfigValue(key: string): Promise<string | null> {
    const row = this.db.prepare('SELECT value FROM system_settings WHERE key = ?').get(`config:${key}`) as { value: string } | undefined;
    return row?.value ?? null;
}

async setConfigValue(key: string, value: string): Promise<void> {
    this.db.prepare(`
        INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(`config:${key}`, value);
}

async deleteConfigValue(key: string): Promise<void> {
    this.db.prepare('DELETE FROM system_settings WHERE key = ?').run(`config:${key}`);
}

async getAllConfigValues(): Promise<Record<string, string>> {
    const rows = this.db.prepare("SELECT key, value FROM system_settings WHERE key LIKE 'config:%'").all() as { key: string; value: string }[];
    const result: Record<string, string> = {};
    for (const r of rows) result[r.key.replace('config:', '')] = r.value;
    return result;
}
```

**Step 4: Implement in-memory provider (read-only guard)**

In `memory.ts`:

```typescript
supportsConfigPersistence(): boolean { return false; }

async getConfigValue(_key: string): Promise<string | null> { return null; }

async setConfigValue(_key: string, _value: string): Promise<void> {
    throw new Error('Config persistence not available with in-memory storage. Use .env or aimeat.ini.');
}

async deleteConfigValue(_key: string): Promise<void> {
    throw new Error('Config persistence not available with in-memory storage.');
}

async getAllConfigValues(): Promise<Record<string, string>> { return {}; }
```

**Step 5: Commit**

```bash
git add src/storage/interface.ts src/storage/providers/mongodb/index.ts src/storage/providers/sqlite/index.ts src/storage/memory.ts
git commit -m "feat: add config persistence methods to Storage interface (all providers)"
```

---

### Task 5: Add In-Memory Guard to Admin Config Endpoints

**Files:**
- Modify: `aimeat/src/routes/admin.ts`

**Step 1: Guard the PUT endpoint**

At the top of the PUT /v1/admin/config handler:

```typescript
if (!storage.supportsConfigPersistence()) {
    res.status(403).json(error(config.nodeId, 'READONLY_CONFIG',
        'Config editing requires a persistent database (MongoDB or SQLite). Use .env or aimeat.ini created with "aimeat init".'
    ));
    return;
}
```

**Step 2: Guard the DELETE endpoint**

Same guard for DELETE /v1/admin/config/:path.

**Step 3: Add `editable` flag to GET response**

In GET /v1/admin/config handler, include:

```typescript
const editable = storage.supportsConfigPersistence();
// In each config entry:
{
    value: currentValue,
    type: field.type,
    editable: editable && !field.immutable,
    // ...
}
// Also include top-level flag:
res.json(success(config.nodeId, {
    editable,
    storageType: config.storageProvider,
    note: editable ? undefined : 'In-memory storage detected. Config is read-only. Use .env or aimeat.ini to configure this node.',
    schema: { ... }
}));
```

**Step 4: Commit**

```bash
git add src/routes/admin.ts
git commit -m "feat: add in-memory storage guard for config editing"
```

---

### Task 6: Create Config Provenance Registry

**Files:**
- Create: `aimeat/src/services/config-provenance.ts`

**Step 1: Create provenance tracker**

```typescript
export type ConfigSource = 'default' | 'env' | 'file' | 'consul' | 'database';

/**
 * Tracks where each config value originated.
 * Built during startup, updated on admin writes.
 */
export class ConfigProvenance {
    private sources = new Map<string, ConfigSource>();

    /** Mark all fields as default initially */
    initDefaults(dotPaths: string[]): void {
        for (const p of dotPaths) this.sources.set(p, 'default');
    }

    /** Mark fields that came from env */
    markEnv(dotPaths: string[]): void {
        for (const p of dotPaths) this.sources.set(p, 'env');
    }

    /** Mark fields that came from file config */
    markFile(dotPaths: string[]): void {
        for (const p of dotPaths) this.sources.set(p, 'file');
    }

    /** Mark fields that came from Consul */
    markConsul(dotPaths: string[]): void {
        for (const p of dotPaths) this.sources.set(p, 'consul');
    }

    /** Mark fields that came from database */
    markDatabase(dotPaths: string[]): void {
        for (const p of dotPaths) this.sources.set(p, 'database');
    }

    /** Get the source for a specific field */
    getSource(dotPath: string): ConfigSource {
        return this.sources.get(dotPath) ?? 'default';
    }

    /** Get all sources as a plain record */
    getAll(): Record<string, ConfigSource> {
        return Object.fromEntries(this.sources);
    }

    /** Recalculate source for a field after DB override is deleted */
    revertSource(dotPath: string, envVarExists: boolean, fileValueExists: boolean, consulValueExists: boolean): void {
        if (consulValueExists) this.sources.set(dotPath, 'consul');
        else if (fileValueExists) this.sources.set(dotPath, 'file');
        else if (envVarExists) this.sources.set(dotPath, 'env');
        else this.sources.set(dotPath, 'default');
    }
}
```

**Step 2: Commit**

```bash
git add src/services/config-provenance.ts
git commit -m "feat: add config provenance registry for tracking value origins"
```

---

## Phase 2: Database Config Persistence

### Task 7: Create Config Loader Service

**Files:**
- Create: `aimeat/src/services/config-loader.ts`

**Step 1: Create the unified config loader**

```typescript
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseIni } from 'ini';
import { ENV_TO_DOT_PATH, isImmutable } from './config-schema.js';

/** Load env vars as raw string values keyed by dot-path */
export function loadEnvSource(): Record<string, string> {
    const values: Record<string, string> = {};
    for (const [envVar, dotPath] of Object.entries(ENV_TO_DOT_PATH)) {
        const val = process.env[envVar];
        if (val !== undefined) values[dotPath] = val;
    }
    return values;
}

/** Load aimeat.ini or aimeat.json as raw string values keyed by dot-path */
export function loadFileSource(): { name: string; values: Record<string, string> } | null {
    const cwd = process.cwd();

    // Check aimeat.ini first
    const iniPath = resolve(cwd, 'aimeat.ini');
    if (existsSync(iniPath)) {
        try {
            const raw = readFileSync(iniPath, 'utf8');
            const parsed = parseIni(raw);
            return { name: `file:${iniPath}`, values: flattenToStrings(parsed) };
        } catch { /* ignore parse errors */ }
    }

    // Then aimeat.json
    const jsonPath = resolve(cwd, 'aimeat.json');
    if (existsSync(jsonPath)) {
        try {
            const raw = readFileSync(jsonPath, 'utf8');
            const parsed = JSON.parse(raw);
            return { name: `file:${jsonPath}`, values: flattenToStrings(parsed) };
        } catch { /* ignore parse errors */ }
    }

    return null;
}

/**
 * Flatten a nested object into dot-path keys with raw string values.
 * Used for both INI and JSON sources — consistent serialization.
 */
function flattenToStrings(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, val] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
            Object.assign(result, flattenToStrings(val as Record<string, unknown>, path));
        } else {
            result[path] = String(val);
        }
    }
    return result;
}

/** Filter out immutable fields from a config values map */
export function filterMutableOnly(values: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
        if (!isImmutable(k)) result[k] = v;
    }
    return result;
}
```

**Step 2: Commit**

```bash
git add src/services/config-loader.ts
git commit -m "feat: add unified config loader with multi-source support"
```

---

### Task 8: Persist Admin Config Changes to Database

**Files:**
- Modify: `aimeat/src/routes/admin.ts` (PUT /v1/admin/config handler)

**Step 1: Update the PUT handler to persist changes**

After the in-memory guard (Task 5) passes and validation succeeds:

```typescript
// After: (config as any)[field.key] = change.value;
// Persist to database as raw string:
try {
    await storage.setConfigValue(change.path, serializeConfigValue(change.value));
    provenance.markDatabase([change.path]); // update provenance
} catch (e) {
    console.warn(`[config] Failed to persist ${change.path} to DB:`, e);
}
```

**Step 2: Update the response note**

Change from:
```
'Runtime config updated. Changes lost on restart unless persisted to environment or config file.'
```
To:
```
'Config updated and persisted to database. Changes survive restart.'
```

**Step 3: Add DELETE /v1/admin/config/:path endpoint**

Allow operators to remove a DB override (revert to file/env/default):

```typescript
router.delete('/v1/admin/config/:path', requireAuth(), requireRole('operator'), async (req, res) => {
    if (!storage.supportsConfigPersistence()) {
        res.status(403).json(error(config.nodeId, 'READONLY_CONFIG', 'Config persistence not available with in-memory storage.'));
        return;
    }

    const path = req.params.path as string;
    await storage.deleteConfigValue(path);

    // Recalculate provenance for this field
    const envVarName = DOT_PATH_TO_ENV[path];
    const envExists = envVarName ? process.env[envVarName] !== undefined : false;
    // file/consul detection delegated to provenance registry
    provenance.revertSource(path, envExists, false, false); // simplified — expand with file/consul checks

    res.json(success(config.nodeId, {
        deleted: path,
        newSource: provenance.getSource(path),
        note: 'DB override removed. Value reverts to file/env/default on next restart.',
    }));
});
```

**Step 4: Commit**

```bash
git add src/routes/admin.ts
git commit -m "feat: persist admin config changes to database with provenance"
```

---

### Task 9: Load DB Config on Startup

**Files:**
- Modify: `aimeat/src/config.ts`
- Modify: `aimeat/src/server.ts`

**Step 1: Add `applyConfigOverrides()` function to config.ts**

```typescript
import type { Storage } from './storage/interface.js';
import { MUTABLE_CONFIG_MAP, parseConfigValue, isImmutable } from './services/config-schema.js';
import type { ConfigProvenance } from './services/config-provenance.js';

/**
 * Apply config overrides from database (called after storage is initialized).
 * Only applies to mutable fields — immutable fields are ignored.
 * Updates provenance registry.
 */
export async function applyConfigOverrides(
    config: AimeatConfig,
    storage: Storage,
    provenance: ConfigProvenance,
): Promise<{ applied: string[]; skipped: string[] }> {
    if (!storage.supportsConfigPersistence()) {
        return { applied: [], skipped: [] };
    }

    const dbValues = await storage.getAllConfigValues();
    const applied: string[] = [];
    const skipped: string[] = [];

    for (const [dotPath, rawValue] of Object.entries(dbValues)) {
        if (isImmutable(dotPath)) {
            skipped.push(dotPath);
            continue;
        }
        const field = MUTABLE_CONFIG_MAP[dotPath];
        if (!field) { skipped.push(dotPath); continue; }

        try {
            const value = parseConfigValue(field, rawValue);
            if (!field.validate(value)) { skipped.push(dotPath); continue; }
            (config as any)[field.key] = value;
            applied.push(dotPath);
        } catch {
            skipped.push(dotPath);
        }
    }

    if (applied.length > 0) provenance.markDatabase(applied);
    return { applied, skipped };
}
```

**Step 2: Wire into server.ts startup sequence**

In `server.ts`, after storage is initialized but before routes are mounted:

```typescript
import { ConfigProvenance } from './services/config-provenance.js';
import { applyConfigOverrides } from './config.js';

// 1. Config already loaded via loadConfig() (env + file + defaults)
// 2. Build initial provenance
const provenance = new ConfigProvenance();
provenance.initDefaults(Object.keys(ALL_CONFIG_MAP));
// ... mark env/file sources based on what loadConfig() found

// 3. Apply DB overrides (skipped for in-memory)
const { applied, skipped } = await applyConfigOverrides(config, storage, provenance);
if (applied.length > 0) {
    console.log(`[config] Applied ${applied.length} DB overrides: ${applied.join(', ')}`);
}

// 4. Pass provenance to admin router
```

**Step 3: Commit**

```bash
git add src/config.ts src/server.ts
git commit -m "feat: load config overrides from database on startup with provenance"
```

---

### Task 10: Add Config Source Provenance to Admin API

**Files:**
- Modify: `aimeat/src/routes/admin.ts` (GET /v1/admin/config handler)

**Step 1: Enhance the config schema response**

Each config entry now includes `source` and `canReset`:

```typescript
// In GET /v1/admin/config handler, for each field:
{
    value: currentValue,
    type: field.type,
    description: field.description,
    range: field.range,
    immutable: field.immutable,
    editable: storage.supportsConfigPersistence() && !field.immutable,
    source: provenance.getSource(field.dotPath),  // 'default' | 'env' | 'file' | 'consul' | 'database'
    canReset: provenance.getSource(field.dotPath) === 'database',
}
```

**Step 2: Commit**

```bash
git add src/routes/admin.ts
git commit -m "feat: add config source provenance to admin API"
```

---

### Task 11: Update env-config.ts and env-validator.ts

**Files:**
- Modify: `aimeat/src/utils/env-config.ts`
- Modify: `aimeat/src/utils/env-validator.ts`

**Step 1: Update `aimeat config` display to show source provenance**

When a provenance registry is available (requires DB connection), show the source next to each value:

```
  Welcome Bonus:     100         [database]  (default: 100)
  Daily Allowance:   75          [env]       (default: 50)
  Burn Rate:         0.10        [default]   (default: 0.10)
```

When no DB connection (config display-only mode), show file/env/default only.

**Step 2: Update `aimeat validate` to check file configs**

Add validation for:
- `aimeat.ini` parse errors
- `aimeat.json` schema violations
- Unknown config keys in file configs
- Type mismatches (e.g., string where number expected)

**Step 3: Commit**

```bash
git add src/utils/env-config.ts src/utils/env-validator.ts
git commit -m "feat: update config display and validation for multi-source system"
```

---

## Phase 3: File Config Support (aimeat.ini / aimeat.json)

### Task 12: Add INI Package Dependency

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

### Task 13: Create Example Config Files

**Files:**
- Create: `aimeat/aimeat.ini.example`
- Create: `aimeat/aimeat.json.example`

**Step 1: Create aimeat.ini.example**

```ini
; AIMEAT Node Configuration
; Copy to aimeat.ini and adjust values.
; Precedence: Database > Consul > this file > .env > defaults
; Note: In-memory nodes cannot persist config to database.
;       Use this file or .env for in-memory node configuration.

[node]
id = aimeat-local-001-dev
port = 40050
type = full

[storage]
type = mongodb
; database_url = mongodb://localhost:27017/aimeat
; sqlite_path = ./data/aimeat.db

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
    "$comment": "AIMEAT Node Configuration. Precedence: Database > Consul > this file > .env > defaults",
    "node": {
        "id": "aimeat-local-001-dev",
        "port": 40050,
        "type": "full"
    },
    "storage": {
        "type": "mongodb"
    },
    "auth": {
        "jwt_ttl_seconds": 3600
    },
    "morsel_policy": {
        "welcome_bonus": 100,
        "daily_allowance": 50,
        "daily_allowance_cap": 500,
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

### Task 14: Wire File Config into Startup

**Files:**
- Modify: `aimeat/src/config.ts`

**Step 1: Integrate file loading into loadConfig()**

Before reading env vars, check for config files:

```typescript
import { loadFileSource, loadEnvSource } from './services/config-loader.js';

export function loadConfig(cliOverrides?: Record<string, string>): AimeatConfig {
    // 1. Load file config (aimeat.ini or aimeat.json)
    const fileSource = loadFileSource();
    const fileOverrides = fileSource?.values ?? {};

    // 2. Load env values
    const envOverrides = loadEnvSource();

    // 3. For each field, check: CLI → env → file → default
    function get(envVar: string, dotPath: string, defaultVal: string): string {
        return cliOverrides?.[dotPath] ?? process.env[envVar] ?? fileOverrides[dotPath] ?? defaultVal;
    }

    const port = parseInt(get('AIMEAT_PORT', 'node.port', '40050'), 10);
    // ... rest of config loading using get()

    // 4. Log sources
    if (fileSource) {
        console.log(`[config] Loaded ${Object.keys(fileOverrides).length} values from ${fileSource.name}`);
    }
}
```

Note: The `cliOverrides` parameter is populated from CLI args in Phase 4.

**Step 2: Track which env/file values were used (for provenance)**

Return source metadata alongside the config:

```typescript
export function loadConfig(cliOverrides?: Record<string, string>): {
    config: AimeatConfig;
    envKeys: string[];     // dot-paths that came from env
    fileKeys: string[];    // dot-paths that came from file
} {
    // ...track which get() calls resolved to env vs file vs default
}
```

**Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: support aimeat.ini and aimeat.json config files with provenance tracking"
```

---

## Phase 4: CLI Bootstrap Arguments

### Task 15: Add CLI Bootstrap Args to `aimeat start`

**Files:**
- Modify: `aimeat/src/index.ts`

**Step 1: Parse bootstrap CLI arguments**

Add argument parsing for `aimeat start`:

```typescript
// Parse CLI args for bootstrap fields
function parseBootstrapArgs(args: string[]): Record<string, string> {
    const overrides: Record<string, string> = {};
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--db':
                overrides['storage.type'] = args[++i];
                break;
            case '--db-url':
                overrides['database_url'] = args[++i];
                break;
            case '--db-path':
                overrides['sqlite_path'] = args[++i];
                break;
            case '--port':
                overrides['node.port'] = args[++i];
                break;
            case '--consul':
                overrides['consul.enabled'] = 'true';
                overrides['consul.url'] = args[++i];
                break;
            case '--consul-prefix':
                overrides['consul.prefix'] = args[++i];
                break;
            case '--consul-token':
                overrides['consul.token'] = args[++i];
                break;
        }
    }
    return overrides;
}
```

**Step 2: Pass overrides to loadConfig()**

```typescript
// In the 'start' / 'serve' command handler:
const cliOverrides = parseBootstrapArgs(process.argv.slice(3));
const { config, envKeys, fileKeys } = loadConfig(cliOverrides);
```

**Step 3: Add help text**

```
aimeat start [options]

Options:
  --db <type>          Storage type: mongodb, sqlite, memory
  --db-url <url>       Database connection URL (MongoDB)
  --db-path <path>     SQLite database file path
  --port <port>        HTTP port (default: 40050)
  --consul <url>       Enable Consul and set URL (e.g., http://consul:8500)
  --consul-prefix <p>  Consul KV prefix (default: aimeat/config)
  --consul-token <t>   Consul ACL token
```

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add --db, --db-url, --consul CLI bootstrap args to aimeat start"
```

---

### Task 16: Update .env.example and CLAUDE.md

**Files:**
- Modify: `aimeat/.env.example`
- Modify: `CLAUDE.md`

**Step 1: Add Consul and new config vars to .env.example**

```env
# ── Consul (optional fleet management) ──
# AIMEAT_CONSUL_ENABLED=false
# AIMEAT_CONSUL_URL=http://localhost:8500
# AIMEAT_CONSUL_PREFIX=aimeat/config
# AIMEAT_CONSUL_TOKEN=
# AIMEAT_CONSUL_WATCH_INTERVAL=30
# AIMEAT_CONSUL_DATACENTER=
```

**Step 2: Update CLAUDE.md key commands**

Add to key commands:
```bash
# Start with CLI bootstrap args
pnpm start -- --db mongodb --db-url mongodb://localhost:27017/aimeat
pnpm start -- --db sqlite --db-path ./data/aimeat.db
pnpm start -- --consul http://consul:8500
```

**Step 3: Commit**

```bash
git add .env.example CLAUDE.md
git commit -m "docs: update .env.example and CLAUDE.md for unified config system"
```

---

## Phase 5: Consul Integration

### Task 17: Add Consul Dependency and Config Fields

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

**Step 3: Add to loadConfig() using get() helper**

```typescript
consulEnabled: get('AIMEAT_CONSUL_ENABLED', 'consul.enabled', 'false') === 'true',
consulUrl: get('AIMEAT_CONSUL_URL', 'consul.url', 'http://localhost:8500'),
consulPrefix: get('AIMEAT_CONSUL_PREFIX', 'consul.prefix', 'aimeat/config'),
consulToken: get('AIMEAT_CONSUL_TOKEN', 'consul.token', ''),
consulWatchIntervalSeconds: parseInt(get('AIMEAT_CONSUL_WATCH_INTERVAL', 'consul.watch_interval_seconds', '30'), 10),
consulDatacenter: get('AIMEAT_CONSUL_DATACENTER', 'consul.datacenter', ''),
```

**Step 4: Add Consul fields to CONFIG_FIELDS in config-schema.ts**

```typescript
{ key: 'consulEnabled', dotPath: 'consul.enabled', envVar: 'AIMEAT_CONSUL_ENABLED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: true, description: 'Enable Consul integration' },
{ key: 'consulUrl', dotPath: 'consul.url', envVar: 'AIMEAT_CONSUL_URL', type: 'string', validate: () => true, immutable: true, description: 'Consul HTTP URL' },
// ... (consul fields are immutable — set before startup)
```

**Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/config.ts src/services/config-schema.ts
git commit -m "feat: add Consul configuration fields"
```

---

### Task 18: Create Consul Config Service

**Files:**
- Create: `aimeat/src/services/consul-config.ts`

**Step 1: Implement the Consul KV integration**

```typescript
import Consul from 'consul';
import type { AimeatConfig } from '../config.js';
import { isImmutable, MUTABLE_CONFIG_MAP, parseConfigValue } from './config-schema.js';

export interface ConsulConfigService {
    /** Load all config values from Consul KV (mutable only, raw strings) */
    loadAll(): Promise<Record<string, string>>;
    /** Start watching for changes */
    startWatching(onUpdate: (changes: Record<string, string>) => void): void;
    /** Stop watching */
    stopWatching(): void;
    /** Write a config value to Consul */
    set(key: string, value: string): Promise<void>;
    /** Check connectivity */
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

/**
 * Apply Consul values to runtime config.
 * Used both at startup and by the watch callback.
 */
export function applyConsulValues(
    config: AimeatConfig,
    values: Record<string, string>,
): { applied: string[]; skipped: string[] } {
    const applied: string[] = [];
    const skipped: string[] = [];
    for (const [dotPath, rawValue] of Object.entries(values)) {
        const field = MUTABLE_CONFIG_MAP[dotPath];
        if (!field) { skipped.push(dotPath); continue; }
        try {
            const value = parseConfigValue(field, rawValue);
            if (!field.validate(value)) { skipped.push(dotPath); continue; }
            (config as any)[field.key] = value;
            applied.push(dotPath);
        } catch { skipped.push(dotPath); }
    }
    return { applied, skipped };
}
```

**Step 2: Commit**

```bash
git add src/services/consul-config.ts
git commit -m "feat: add Consul KV config service with type-aware parsing"
```

---

### Task 19: Wire Consul into Server Startup

**Files:**
- Modify: `aimeat/src/server.ts`

**Step 1: Initialize Consul and load config after storage, before DB overrides**

```typescript
import { createConsulConfigService, applyConsulValues } from './services/consul-config.js';

// After storage init:
const consulService = createConsulConfigService(config);
if (consulService) {
    const consulValues = await consulService.loadAll();
    if (Object.keys(consulValues).length > 0) {
        const { applied } = applyConsulValues(config, consulValues);
        provenance.markConsul(applied);
        console.log(`[consul] Applied ${applied.length} config values from Consul KV`);
    }

    // Start watching for live changes (Consul priority: below DB, above file)
    consulService.startWatching((changes) => {
        console.log(`[consul] Config update detected: ${Object.keys(changes).length} keys`);
        const { applied } = applyConsulValues(config, changes);
        provenance.markConsul(applied);
        // Note: DB overrides still win — they were applied after Consul at startup
        // Live Consul changes only affect non-DB-overridden values
    });
}

// THEN apply DB overrides (highest priority for mutable fields)
const { applied } = await applyConfigOverrides(config, storage, provenance);
```

**Step 2: Commit**

```bash
git add src/server.ts
git commit -m "feat: wire Consul config into server startup with watching"
```

---

### Task 20: Admin API for Consul Status

**Files:**
- Modify: `aimeat/src/routes/admin.ts`

**Step 1: Add GET /v1/admin/consul endpoint**

```typescript
router.get('/v1/admin/consul', requireAuth(), requireRole('operator'), async (_req, res) => {
    if (!consulService) {
        res.json(success(config.nodeId, {
            enabled: false,
            note: 'Consul integration is not enabled. Set AIMEAT_CONSUL_ENABLED=true and AIMEAT_CONSUL_URL, or use --consul flag.',
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

**Step 2: Add POST /v1/admin/consul/export**

Push current mutable config to Consul KV:

```typescript
router.post('/v1/admin/consul/export', requireAuth(), requireRole('operator'), async (_req, res) => {
    if (!consulService) {
        res.status(400).json(error(config.nodeId, 'CONSUL_DISABLED', 'Consul is not enabled'));
        return;
    }

    let exported = 0;
    for (const [dotPath, field] of Object.entries(MUTABLE_CONFIG_MAP)) {
        try {
            const value = (config as any)[field.key];
            await consulService.set(dotPath, serializeConfigValue(value));
            exported++;
        } catch { /* skip individual failures */ }
    }

    res.json(success(config.nodeId, { exported, total: Object.keys(MUTABLE_CONFIG_MAP).length }));
});
```

**Step 3: Add POST /v1/admin/consul/import**

Pull config from Consul KV and apply to runtime + DB:

```typescript
router.post('/v1/admin/consul/import', requireAuth(), requireRole('operator'), async (_req, res) => {
    if (!consulService) {
        res.status(400).json(error(config.nodeId, 'CONSUL_DISABLED', 'Consul is not enabled'));
        return;
    }

    const values = await consulService.loadAll();
    const { applied } = applyConsulValues(config, values);

    // Persist to DB if available
    if (storage.supportsConfigPersistence()) {
        for (const dotPath of applied) {
            await storage.setConfigValue(dotPath, values[dotPath]);
        }
        provenance.markDatabase(applied);
    }

    res.json(success(config.nodeId, { imported: applied.length, total: Object.keys(values).length }));
});
```

**Step 4: Commit**

```bash
git add src/routes/admin.ts
git commit -m "feat: add Consul status, export, and import admin endpoints"
```

---

## Phase 6: Admin Dashboard UI Enhancements

### Task 21: Update Config Tab with Source Badges, Reset, and In-Memory Guard

**Files:**
- Modify: `aimeat/public/views/admin/config-tab.js`
- Modify: `aimeat/public/css/views/admin.css`

Follow the frontend development guide conventions:
- Use shared components from `./shared.js` (Badge, ExpandableHelp, Empty)
- Use `t('dashboard.cfg_*')` for all user-visible text
- CSS classes with `adm-` prefix
- No inline CSS constants — all styling in admin.css

**Step 1: Add in-memory info banner**

When `configSchema.editable === false`, show a prominent info banner at the top:

```javascript
// At top of config tab render:
if (!schema.editable) {
    return html`
        <p style="color:var(--text-dim);font-size:.85rem;margin-bottom:12px">${t('dashboard.cfgReadOnlyExplain')}</p>
        <div class="adm-card" style="border-color:var(--accent)">
            <p>${t('dashboard.cfgReadOnlyBanner')}</p>
            <${ExpandableHelp} title=${t('dashboard.cfgReadOnlyHelpTitle')}>
                <p>${t('dashboard.cfgReadOnlyHelpDetail')}</p>
            </${ExpandableHelp}>
        </div>
        <!-- Still show config values as read-only below -->
    `;
}
```

**Step 2: Show source provenance badges**

For each config entry, display a Badge indicating source:

```javascript
// Use the shared Badge component with source-based types:
const sourceBadgeType = { database: 'healthy', env: 'info', file: 'private', consul: 'watch', default: 'dim' };

// Per config row:
html`<${Badge} type=${sourceBadgeType[entry.source] || 'dim'}>${entry.source}</${Badge}>`
```

**Step 3: Add "Reset" button for database-overridden values**

When `entry.canReset === true`, show a small reset button:

```javascript
html`<button class="adm-btn-sm" onClick=${() => resetConfig(entry.path)}>${t('dashboard.cfgReset')}</button>`
```

The reset calls `DELETE /v1/admin/config/${entry.path}` then reloads.

**Step 4: Hide save button when not editable**

Only show save when `schema.editable === true` and there are pending changes.

**Step 5: Add CSS for source badges and read-only state**

Add to `admin.css`:

```css
.adm-config-readonly { opacity: 0.85; pointer-events: none; }
.adm-config-readonly input,
.adm-config-readonly select { background: var(--glass-bg); cursor: not-allowed; }
.adm-badge-dim { background: #475569; color: #94a3b8; }
```

**Step 6: Commit**

```bash
git add public/views/admin/config-tab.js public/css/views/admin.css
git commit -m "feat: config tab shows source badges, reset buttons, and in-memory guard"
```

---

### Task 22: Add Consul Tab to Admin Dashboard

**Files:**
- Create: `aimeat/public/views/admin/consul-tab.js`
- Modify: `aimeat/public/views/admin.js` (register tab)
- Modify: `aimeat/public/js/services/admin.js` (add API calls)

Follow the admin tab component contract from the frontend development guide.

**Step 1: Create consul-tab.js**

```javascript
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Badge, StatsGrid, ExpandableHelp, Empty, DataTable } from './shared.js';
import { getConsulStatus, exportToConsul, importFromConsul } from '/js/services/admin.js';

export default function ConsulTab({ data, reload }) {
    const consul = data.consul;
    const [loading, setLoading] = useState(false);

    if (!consul) return html`<${Empty} text=${t('dashboard.consulDisabled')} />`;

    // Show:
    // - Connection status badge (healthy/unreachable)
    // - URL and prefix
    // - Stats grid: key count, watch interval
    // - DataTable of keys
    // - Export/Import buttons

    const handleExport = async () => { setLoading(true); await exportToConsul(); await reload(); setLoading(false); };
    const handleImport = async () => { setLoading(true); await importFromConsul(); await reload(); setLoading(false); };

    return html`
        <p style="color:var(--text-dim);font-size:.85rem;margin-bottom:12px">${t('dashboard.consulExplain')}</p>
        <${ExpandableHelp} title=${t('dashboard.consulSetupGuide')}>
            <p>${t('dashboard.consulSetupDetail')}</p>
        </${ExpandableHelp}>

        ${!consul.enabled
            ? html`<div class="adm-card"><p>${t('dashboard.consulDisabled')}</p></div>`
            : html`
                <${StatsGrid} items=${[
                    { label: t('dashboard.consulStatus'), value: consul.healthy ? '✓' : '✗', color: consul.healthy ? 'var(--green)' : 'var(--red)' },
                    { label: t('dashboard.consulKeysLoaded'), value: consul.key_count },
                ]} />
                <div class="adm-card" style="margin-top:12px">
                    <div style="display:flex;gap:8px;margin-bottom:12px">
                        <button class="adm-btn" onClick=${handleExport} disabled=${loading}>${t('dashboard.consulExport')}</button>
                        <button class="adm-btn-action" onClick=${handleImport} disabled=${loading}>${t('dashboard.consulImport')}</button>
                    </div>
                    ${consul.keys?.length > 0
                        ? html`<${DataTable} headers=${['Key']} rows=${consul.keys.map(k => [escHtml(k)])} />`
                        : html`<${Empty} text=${t('dashboard.consulNoKeys')} />`
                    }
                </div>
            `
        }
    `;
}
```

**Step 2: Register in admin.js sidebar**

Add under "Infrastructure" group:

```javascript
import ConsulTab from './admin/consul-tab.js';
// In tabs array, under Infrastructure:
{ id: 'consul', icon: '\u{1F5C4}\uFE0F', key: 'dashboard.consul', component: ConsulTab },
```

**Step 3: Add data loading in admin.js**

Add to Phase 3 loading (Features):

```javascript
const consulPromise = api.getConsulStatus().catch(() => null);
// Merge result into data.consul
```

**Step 4: Add API calls to admin.js service**

```javascript
export const getConsulStatus  = ()  => apiGet('/v1/admin/consul');
export const exportToConsul   = ()  => apiPost('/v1/admin/consul/export');
export const importFromConsul = ()  => apiPost('/v1/admin/consul/import');
```

**Step 5: Commit**

```bash
git add public/views/admin/consul-tab.js public/views/admin.js public/js/services/admin.js
git commit -m "feat: add Consul tab to admin dashboard"
```

---

### Task 23: Add i18n Translations for Config & Consul

**Files:**
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

**Step 1: Add English translations**

Under `dashboard`:

```json
{
    "dashboard": {
        "consul": "Consul",
        "consulStatus": "Consul Status",
        "consulDisabled": "Consul integration is not enabled. Set AIMEAT_CONSUL_ENABLED=true or use --consul flag.",
        "consulHealthy": "Connected",
        "consulUnhealthy": "Unreachable",
        "consulExport": "Export Config to Consul",
        "consulImport": "Import from Consul",
        "consulKeysLoaded": "Keys loaded",
        "consulNoKeys": "No keys in Consul KV",
        "consulExplain": "Consul provides centralized configuration for fleet management. Connect multiple AIMEAT nodes to a shared Consul KV prefix to synchronize config.",
        "consulSetupGuide": "Setup Guide",
        "consulSetupDetail": "1. Run Consul: docker run -d -p 8500:8500 hashicorp/consul. 2. Set AIMEAT_CONSUL_ENABLED=true and AIMEAT_CONSUL_URL=http://consul:8500. 3. Use Export to push current config, or Import to pull shared config.",
        "cfgReadOnlyBanner": "This node uses in-memory storage. Config editing is disabled.",
        "cfgReadOnlyExplain": "In-memory nodes cannot persist config changes. Use .env or aimeat.ini created with 'aimeat init' to configure this node.",
        "cfgReadOnlyHelpTitle": "Why is config read-only?",
        "cfgReadOnlyHelpDetail": "Config persistence requires a database (MongoDB or SQLite). In-memory nodes lose all changes on restart. Configure this node via .env file, aimeat.ini, aimeat.json, or CLI arguments (aimeat start --db mongodb --db-url ...).",
        "cfgReset": "Reset",
        "cfgResetConfirm": "Remove database override? Value will revert to file/env/default.",
        "cfgSource": "Source",
        "cfgPersisted": "Config updated and persisted to database."
    }
}
```

**Step 2: Add Finnish translations**

```json
{
    "dashboard": {
        "consul": "Consul",
        "consulStatus": "Consul-tila",
        "consulDisabled": "Consul-integraatio ei ole käytössä. Aseta AIMEAT_CONSUL_ENABLED=true tai käytä --consul-lippua.",
        "consulHealthy": "Yhdistetty",
        "consulUnhealthy": "Ei tavoitettavissa",
        "consulExport": "Vie asetukset Consuliin",
        "consulImport": "Tuo Consulista",
        "consulKeysLoaded": "Avaimia ladattu",
        "consulNoKeys": "Ei avaimia Consul KV:ssä",
        "consulExplain": "Consul tarjoaa keskitetyn asetustenhallinnan laivastohallintaan. Yhdistä useita AIMEAT-solmuja samaan Consul KV -etuliitteeseen asetusten synkronoimiseksi.",
        "consulSetupGuide": "Asennusohje",
        "consulSetupDetail": "1. Käynnistä Consul: docker run -d -p 8500:8500 hashicorp/consul. 2. Aseta AIMEAT_CONSUL_ENABLED=true ja AIMEAT_CONSUL_URL=http://consul:8500. 3. Käytä Vientiä nykyisten asetusten työntämiseen tai Tuontia jaettujen asetusten hakemiseen.",
        "cfgReadOnlyBanner": "Tämä solmu käyttää muistinsisäistä tallennusta. Asetusten muokkaus on poistettu käytöstä.",
        "cfgReadOnlyExplain": "Muistinsisäiset solmut eivät voi tallentaa asetusmuutoksia. Käytä .env- tai aimeat.ini-tiedostoa, joka on luotu 'aimeat init' -komennolla.",
        "cfgReadOnlyHelpTitle": "Miksi asetukset ovat vain luku -tilassa?",
        "cfgReadOnlyHelpDetail": "Asetusten tallennus vaatii tietokannan (MongoDB tai SQLite). Muistinsisäiset solmut menettävät kaikki muutokset uudelleenkäynnistyksessä. Määritä tämä solmu .env-tiedoston, aimeat.ini:n, aimeat.json:n tai CLI-argumenttien kautta.",
        "cfgReset": "Palauta",
        "cfgResetConfirm": "Poista tietokantaohitus? Arvo palautuu tiedosto-/ympäristö-/oletusarvoon.",
        "cfgSource": "Lähde",
        "cfgPersisted": "Asetukset päivitetty ja tallennettu tietokantaan."
    }
}
```

**Step 3: Commit**

```bash
git add locales/en.json locales/fi.json
git commit -m "feat: add i18n translations for config provenance and Consul tab"
```

---

## Phase 7: Init Wizard and CLI Updates

### Task 24: Update Init Wizard for Multi-Source Config

**Files:**
- Modify: `aimeat/src/cli/init-wizard.ts`
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

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

**Step 3: Add i18n translations for new prompts**

Add to `init` section in both locale files:
- `init.configFormat`: "Config output format" / "Asetusten tulostusmuoto"
- `init.configFormatEnv`: ".env file (Docker/systemd)" / ".env-tiedosto (Docker/systemd)"
- `init.configFormatIni`: "aimeat.ini (human-friendly)" / "aimeat.ini (ihmisluettava)"
- `init.configFormatJson`: "aimeat.json (machine-friendly)" / "aimeat.json (koneluettava)"
- `init.configFormatAll`: "All formats" / "Kaikki muodot"

**Step 4: Commit**

```bash
git add src/cli/init-wizard.ts locales/en.json locales/fi.json
git commit -m "feat: init wizard supports .env, aimeat.ini, and aimeat.json output"
```

---

### Task 25: Add `aimeat config export` CLI Command

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

Uses `CONFIG_FIELDS` from config-schema.ts to enumerate all known fields, reads current values, and serializes to the requested format.

**Step 2: Commit**

```bash
git add src/cli/config-export.ts src/index.ts
git commit -m "feat: add aimeat config export CLI command"
```

---

### Task 26: Add `aimeat config import` CLI Command

**Files:**
- Create: `aimeat/src/cli/config-import.ts`
- Modify: `aimeat/src/index.ts`

**Step 1: Create import command**

```bash
# Import config from a file into the database:
aimeat config import --file .env
aimeat config import --file aimeat.ini
aimeat config import --file aimeat.json
aimeat config import --from consul   # Pull from Consul KV into DB
```

**Step 2: Implementation details**

The import command:
1. Requires a persistent database (MongoDB or SQLite). Fails with clear error on in-memory.
2. Parses the source file using the appropriate parser (env, INI, or JSON — detected by extension or `--format` flag).
3. Flattens to dot-path keys using `flattenToStrings()` from config-loader.
4. Validates each value against `CONFIG_FIELDS` from config-schema — rejects unknown keys and type mismatches.
5. Filters out immutable fields (with warning: "Skipping immutable field: node.id").
6. Writes mutable values to the database via `storage.setConfigValue()`.
7. Reports summary: "Imported 23 values, skipped 5 immutable, 2 unknown."

**Step 3: The `.env` → database migration workflow**

This is the primary use case for operators upgrading from env-only setups:

```bash
# 1. Start with persistent DB (already configured in .env or CLI)
aimeat start --db mongodb --db-url mongodb://localhost:27017/aimeat

# 2. Import existing .env into the database
aimeat config import --file .env

# 3. Done! Now manage config via the admin dashboard.
#    The .env file can be reduced to just bootstrap fields:
#    DATABASE_URL, AIMEAT_STORAGE_PROVIDER, AIMEAT_ADMIN_PASSWORD
```

The import is **additive** — it writes values to the DB but doesn't delete the `.env` file. Since DB has higher precedence, the imported values immediately take effect. The operator can then optionally trim their `.env` down to just the immutable bootstrap fields.

**Step 4: Interactive confirmation**

Before writing, show a summary and ask for confirmation:

```
Found 35 config values in .env
  23 mutable → will import to database
   5 immutable → will skip (node.id, port, storage.type, ...)
   7 unknown → will skip

Proceed? [Y/n]
```

**Step 5: Commit**

```bash
git add src/cli/config-import.ts src/index.ts
git commit -m "feat: add aimeat config import CLI command"
```

---

### Task 27: Update HELP_TEXT and CLI i18n

**Files:**
- Modify: `aimeat/src/index.ts`
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

**Step 1: Update the hardcoded HELP_TEXT in index.ts**

The current `HELP_TEXT` (lines 24-60) is outdated. Replace with:

```typescript
const HELP_TEXT = `
aimeat — AI Memory Exchange and Action Transfer protocol node

USAGE
  aimeat start [options]         Start the node
  aimeat serve [options]         Alias for start
  aimeat config                  Show all settings and their current values
  aimeat config export [opts]    Export config (--format env|ini|json|consul)
  aimeat config import [opts]    Import config to database (--file <path> | --from consul)
  aimeat validate                Validate configuration (env, files, database)
  aimeat check                   Alias for validate
  aimeat init                    Interactive config wizard (generates .env, .ini, or .json)
  aimeat join [URL]              Join a federation network
  aimeat maintenance on [MSG]    Enable maintenance mode (optional message)
  aimeat maintenance off         Disable maintenance mode
  aimeat maintenance             Show maintenance status
  aimeat backup  [FILE]          Export all data to JSON
  aimeat restore <FILE>          Import data from JSON backup

START OPTIONS
  --db <type>              Storage type: mongodb, sqlite, memory
  --db-url <url>           Database connection URL (MongoDB)
  --db-path <path>         SQLite database file path
  -p, --port <port>        HTTP port (default: 40050)
  --node-id <id>           Node identity string
  --admin-password <pw>    Operator admin secret
  -c, --config <path>      Config file path (JSON)
  --consul <url>           Enable Consul and set URL (e.g., http://consul:8500)
  --consul-prefix <prefix> Consul KV prefix (default: aimeat/config)
  --consul-token <token>   Consul ACL token
  -h, --help               Show this help
  -v, --version            Show version

CONFIG EXPORT OPTIONS
  --format <fmt>           Output format: env, ini, json, consul

CONFIG IMPORT OPTIONS
  --file <path>            Import from file (.env, .ini, or .json)
  --from consul            Import from Consul KV into database

QUICK START
  1. Run "aimeat init" to create a config (interactive wizard)
  2. Run "aimeat validate" to check for problems
  3. Run "aimeat start" to launch the node

MIGRATION: .env to database
  1. aimeat start --db mongodb --db-url mongodb://localhost:27017/aimeat
  2. aimeat config import --file .env
  3. Manage config via admin dashboard (changes persist to database)

MULTIPLE ENVIRONMENTS
  aimeat init creates .env (default) or named config files.
  Use config files to manage multiple environments on one machine:
    aimeat start --config production.json
    aimeat start --config staging.json
`;
```

**Step 2: Add CLI help translations to locale files**

Add a `cli` section to both locale files so that future CLI i18n is possible:

In `en.json`:
```json
{
    "cli": {
        "helpHeader": "aimeat — AI Memory Exchange and Action Transfer protocol node",
        "startDesc": "Start the node",
        "configDesc": "Show all settings and their current values",
        "configExportDesc": "Export config to file or Consul",
        "configImportDesc": "Import config from file or Consul into database",
        "validateDesc": "Validate configuration (env, files, database)",
        "initDesc": "Interactive config wizard",
        "importSuccess": "Imported {count} values to database ({skipped} skipped)",
        "importRequiresDb": "Config import requires a persistent database (MongoDB or SQLite). Current storage: {type}",
        "importNoFile": "File not found: {path}",
        "importConfirm": "Import {mutable} mutable values to database? ({immutable} immutable and {unknown} unknown will be skipped)",
        "exportSuccess": "Exported {count} config values in {format} format",
        "migrationHint": "Tip: To migrate .env to database, run: aimeat config import --file .env"
    }
}
```

In `fi.json`:
```json
{
    "cli": {
        "helpHeader": "aimeat — AI-muistin vaihto- ja toiminnansiirtoprotokolla",
        "startDesc": "Käynnistä solmu",
        "configDesc": "Näytä kaikki asetukset ja niiden nykyiset arvot",
        "configExportDesc": "Vie asetukset tiedostoon tai Consuliin",
        "configImportDesc": "Tuo asetukset tiedostosta tai Consulista tietokantaan",
        "validateDesc": "Tarkista asetukset (ympäristö, tiedostot, tietokanta)",
        "initDesc": "Interaktiivinen asetustenvelho",
        "importSuccess": "Tuotiin {count} arvoa tietokantaan ({skipped} ohitettiin)",
        "importRequiresDb": "Asetusten tuonti vaatii pysyvän tietokannan (MongoDB tai SQLite). Nykyinen tallennus: {type}",
        "importNoFile": "Tiedostoa ei löydy: {path}",
        "importConfirm": "Tuodaanko {mutable} muutettavaa arvoa tietokantaan? ({immutable} muuttumatonta ja {unknown} tuntematonta ohitetaan)",
        "exportSuccess": "Vietiin {count} asetusarvoa {format}-muodossa",
        "migrationHint": "Vinkki: Siirrä .env tietokantaan komennolla: aimeat config import --file .env"
    }
}
```

**Step 3: Commit**

```bash
git add src/index.ts locales/en.json locales/fi.json
git commit -m "feat: update CLI help text and add CLI i18n translations"
```

---

## Phase 8: Tests

### Task 28: Unit Tests for Config System

**Files:**
- Create: `aimeat/test/config-loader.test.ts`

**Step 1: Test source merging and precedence**

```typescript
// Test: DB values override env values
// Test: env values override file values
// Test: file values override defaults
// Test: immutable fields are rejected from DB/Consul
// Test: in-memory storage returns supportsConfigPersistence() === false
```

**Step 2: Test serialization consistency**

```typescript
// Test: flattenToStrings produces raw strings from INI-like objects
// Test: flattenToStrings produces raw strings from JSON-like objects
// Test: parseConfigValue('number', '100') → 100
// Test: parseConfigValue('boolean', 'true') → true
// Test: parseConfigValue('float', '0.10') → 0.10
// Test: parseConfigValue('string', 'hello') → 'hello'
// Test: serializeConfigValue(100) → '100'
```

**Step 3: Test config-schema module**

```typescript
// Test: MUTABLE_CONFIG_MAP only contains non-immutable fields
// Test: ALL_CONFIG_MAP contains all fields
// Test: ENV_TO_DOT_PATH and DOT_PATH_TO_ENV are inverse mappings
// Test: isImmutable('node.id') → true
// Test: isImmutable('morsel_policy.welcome_bonus') → false
// Test: isImmutable('unknown.field') → true (safe default)
```

**Step 4: Test provenance tracking**

```typescript
// Test: initDefaults sets all to 'default'
// Test: markEnv overwrites to 'env'
// Test: markFile overwrites to 'file'
// Test: markDatabase overwrites to 'database'
// Test: revertSource falls back correctly
```

**Step 5: Commit**

```bash
git add test/config-loader.test.ts
git commit -m "test: add unit tests for config loader, schema, and provenance"
```

---

### Task 29: E2E Tests for Config Persistence

**Files:**
- Modify: `aimeat/test/e2e-full.ts`

**Step 1: Add config persistence tests to E2E suite**

```typescript
// Phase: Config System (new section in E2E)

// Test: GET /v1/admin/config returns source provenance per field
// Test: GET /v1/admin/config returns editable flag based on storage type
// Test: PUT /v1/admin/config persists to DB → GET shows source: 'database'
// Test: PUT /v1/admin/config validates field types (reject string for number field)
// Test: PUT /v1/admin/config rejects immutable field changes
// Test: DELETE /v1/admin/config/:path removes override → source reverts
// Test: Config survives simulated restart (write → getAllConfigValues → verify)
// Test: In-memory storage → PUT returns 403 with guidance message
// Test: In-memory storage → DELETE returns 403
// Test: In-memory storage → GET returns editable: false
```

**Step 2: Commit**

```bash
git add test/e2e-full.ts
git commit -m "test: add E2E tests for config persistence, provenance, and in-memory guard"
```

---

### Task 30: Consul Mock Tests

**Files:**
- Create: `aimeat/test/consul-config.test.ts`

**Step 1: Test Consul service with mocked HTTP**

```typescript
// Test: createConsulConfigService returns null when disabled
// Test: loadAll() parses Consul KV response into dot-path map
// Test: loadAll() filters out immutable fields
// Test: startWatching fires callback on change detection
// Test: startWatching does not fire when hash unchanged
// Test: health() returns true on successful agent.self()
// Test: health() returns false on connection error
// Test: set() writes correct Consul key path (dots → slashes)
// Test: applyConsulValues uses parseConfigValue for type-safe casting
// Test: Consul unavailable → graceful fallback, no crash
```

**Step 2: Commit**

```bash
git add test/consul-config.test.ts
git commit -m "test: add Consul config service tests with mocked HTTP"
```

---

## Phase 9: Documentation

### Task 31: Write Configuration Guide

**Files:**
- Create: `aimeat/docs/configuration-guide.md`

Cover:
1. **Quick start** — `aimeat init` generates config, done
2. **Config sources** — Explanation of all sources and precedence, including the bootstrap layer
3. **In-memory vs persistent** — When config editing works and when it's read-only
4. **Admin panel** — Primary way to manage config for persistent-database nodes
5. **File config** — `aimeat.ini` and `aimeat.json` format reference
6. **Environment variables** — Full `AIMEAT_*` reference table
7. **CLI arguments** — `aimeat start --db`, `--consul`, etc.
8. **Consul integration** — Step-by-step setup guide:
   - Install Consul (Docker one-liner: `docker run -d --name consul -p 8500:8500 hashicorp/consul`)
   - Configure AIMEAT: `AIMEAT_CONSUL_ENABLED=true`, `AIMEAT_CONSUL_URL=http://consul:8500`
   - Or use CLI: `aimeat start --consul http://consul:8500`
   - Export config: admin panel "Export to Consul" button or `aimeat config export --format consul`
   - Fleet management: all nodes pointing to same Consul KV prefix share config
9. **Fleet management patterns** — Common Consul KV layouts for multi-node setups
10. **Migration guide** — Moving from .env-only to database-first
11. **CLI commands** — `aimeat config`, `aimeat config export`, `aimeat config import`

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
| **1: Foundation** | 1-6 | SQLite table, Prisma verify, shared config-schema, storage interface, in-memory guard, provenance |
| **2: DB Persistence** | 7-11 | Config loader, admin persist, startup loading, provenance API, utility updates |
| **3: File Config** | 12-14 | INI parser dep, example files, wire into startup |
| **4: CLI Bootstrap** | 15-16 | `--db`/`--consul` args, .env.example update |
| **5: Consul** | 17-20 | Consul client, service, startup wiring, admin API |
| **6: Admin UI** | 21-23 | Source badges, reset, in-memory banner, Consul tab, i18n |
| **7: CLI** | 24-27 | Init wizard update, config export, config import, **HELP_TEXT + CLI i18n** |
| **8: Tests** | 28-30 | Unit tests, E2E tests, Consul mock tests |
| **9: Docs** | 31 | Configuration guide |

**Total: 31 tasks across 9 phases.**

### Key Design Decisions

1. **In-memory = read-only config** — Admin panel shows values but refuses edits. Operators are guided to `.env`, `aimeat.ini`, or CLI args. No more misleading "edit then lose on restart" behavior.

2. **CLI bootstrap args** — `--db`, `--db-url`, `--consul` resolve the chicken-and-egg problem: you need them *before* you can connect to a DB or Consul for the rest of the config.

3. **Shared config-schema module** — Single source of truth for all config field definitions. Used by admin.ts, config.ts, consul-config.ts, and CLI tools. No more duplicated pathMaps.

4. **Raw strings everywhere** — All sources (env, INI, JSON, Consul, DB) store raw strings. Type-aware parsing driven by `ConfigFieldDef.type` ensures consistency. No JSON.stringify/parse confusion.

5. **Provenance tracking** — Each config value carries its origin (`default`, `env`, `file`, `consul`, `database`). Admin UI shows this as colored badges. DELETE reverts to the next-lower source.

6. **DB wins over file/env for mutable fields** — The admin panel is the primary config interface for persistent-database nodes. Operators should not need to SSH into servers to change settings.

7. **Immutable fields stay file/env/CLI-only** — `node.id`, `port`, `storage.type` cannot be changed at runtime. These are infrastructure decisions made at deploy time.

8. **Consul is optional middleware** — Nodes work fine without Consul. Adding it is a CLI flag or env var toggle. Simple for solo operators, powerful for fleet management.

9. **SQLite + MongoDB parity** — Both persistent storage providers get full config persistence. SQLite uses a new `system_settings` table; MongoDB uses the existing `SystemSetting` Prisma model with `config:` key prefix.

10. **Backward compatible** — Existing `.env` setups continue working unchanged. The database layer is additive, not a replacement.

11. **File configs are static** — `aimeat.ini`/`aimeat.json` are read once at startup. They don't hot-reload. For dynamic changes, use the admin panel or Consul.

12. **Tests are comprehensive** — Unit tests for the config-schema and loader, E2E tests for the full persistence lifecycle, and mocked tests for Consul integration.
