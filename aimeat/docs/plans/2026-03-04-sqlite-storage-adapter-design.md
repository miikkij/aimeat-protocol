# SQLite Storage Adapter — Design Document

**Date:** 2026-03-04
**Status:** Approved
**REQ:** REQ-003

---

## 1. Goal

Implement a SQLite-based storage adapter for AIMEAT using `better-sqlite3`, while refactoring the storage layer from a monolithic God Interface into a clean Domain Repository Pattern with a provider factory. This enables personal node operators to run AIMEAT without MongoDB, and makes the storage layer maintainable and extensible for future providers.

## 2. Architecture

The current `Storage` interface (950 lines, ~185 methods, 30+ entity types) is split into ~20 domain-specific repository interfaces. A factory function (`createStorage`) selects the provider based on `AIMEAT_STORAGE` env var. The composed `Storage` type remains as a backward-compatible facade — all route files continue working with zero changes.

**Tech Stack:**
- `better-sqlite3` — synchronous, fast, zero-config (~2MB dependency)
- `@types/better-sqlite3` — TypeScript definitions
- Existing: TypeScript 5.9.3, ESM, Node 24.x

## 3. Repository Interfaces

Split the monolith `Storage` into domain-specific repositories, each in its own file under `src/storage/repositories/`:

| Repository | Methods | Entities |
|---|---|---|
| `OwnerRepository` | 5 | owners |
| `AgentRepository` | 6 | agents |
| `MemoryRepository` | 7 | memory + search + flagCount |
| `ActionRepository` | 7 | actions |
| `WorkRepository` | 5 | work |
| `WalletRepository` | 4 | transactions |
| `BoardRepository` | 13 | boards + posts + subscriptions + reactions |
| `OtkRepository` | 5 | one-time keys |
| `DisputeRepository` | 7 | disputes + audit |
| `MicroMemoryRepository` | 6 | micro-memory |
| `FileRepository` | 8 | storage files + chunked uploads |
| `IdentityRepository` | 17 | GHII + chat instances + email verification |
| `SchemaRepository` | 5 | schema locking |
| `ConsentRepository` | 7 | consents + audit |
| `CatalogueRepository` | 10 | CSM + MSM |
| `ModerationRepository` | 19 | flags + appeals + matches |
| `OrganismRepository` | 14 | organisms + memberships + join requests + reputation |
| `MarketplaceRepository` | 9 | listings + purchases |
| `FederationRepository` | 17 | peering + genesis peers + personal nodes + mailbox |
| `NodeRepository` | 14 | maintenance + node key + push subs + trusted issuers + realtime rooms + site changelog + extensions + escrow |

**Total: 20 repositories, ~185 methods**

Each repository interface is a standalone TypeScript file exporting a single interface. Record types stay in `interface.ts` (unchanged).

The composed `Storage` type:

```typescript
// src/storage/interface.ts (bottom of file)
export interface Storage extends
  OwnerRepository, AgentRepository, MemoryRepository,
  ActionRepository, WorkRepository, WalletRepository,
  BoardRepository, OtkRepository, DisputeRepository,
  MicroMemoryRepository, FileRepository, IdentityRepository,
  SchemaRepository, ConsentRepository, CatalogueRepository,
  ModerationRepository, OrganismRepository, MarketplaceRepository,
  FederationRepository, NodeRepository {}
```

## 4. File Structure

```
src/storage/
  interface.ts                   # Record types (unchanged) + composed Storage type
  repositories/                  # Repository interfaces
    owner.repository.ts
    agent.repository.ts
    memory.repository.ts
    action.repository.ts
    work.repository.ts
    wallet.repository.ts
    board.repository.ts
    otk.repository.ts
    dispute.repository.ts
    micro-memory.repository.ts
    file.repository.ts
    identity.repository.ts
    schema.repository.ts
    consent.repository.ts
    catalogue.repository.ts
    moderation.repository.ts
    organism.repository.ts
    marketplace.repository.ts
    federation.repository.ts
    node.repository.ts
    index.ts                     # Re-exports all repository interfaces
  providers/
    memory/
      index.ts                   # InMemoryStorage class (migrated from memory.ts)
    sqlite/
      index.ts                   # SqliteStorage class
      schema.ts                  # CREATE TABLE statements + indexes
    mongodb/
      index.ts                   # MongoStorage class (migrated from mongodb.ts)
  storage-factory.ts             # createStorage() factory function
```

Old files `memory.ts` and `mongodb.ts` are moved into their respective `providers/` subdirectories.

## 5. Storage Factory

```typescript
// src/storage/storage-factory.ts
export type StorageProvider = 'memory' | 'sqlite' | 'mongodb';

export interface StorageOptions {
  provider: StorageProvider;
  sqlitePath?: string;   // for sqlite
  dbUrl?: string;        // for mongodb
}

export async function createStorage(opts: StorageOptions): Promise<Storage> {
  switch (opts.provider) {
    case 'sqlite': {
      const { SqliteStorage } = await import('./providers/sqlite/index.js');
      return new SqliteStorage(opts.sqlitePath ?? './data/aimeat.db');
    }
    case 'mongodb': {
      const { MongoStorage } = await import('./providers/mongodb/index.js');
      const mongo = new MongoStorage(opts.dbUrl!);
      await mongo.ready;
      return mongo;
    }
    default: {
      const { InMemoryStorage } = await import('./providers/memory/index.js');
      return new InMemoryStorage();
    }
  }
}
```

Dynamic imports keep each provider tree-shakeable — only the selected provider is loaded at runtime.

## 6. SQLite Provider Details

### 6.1 Library Choice

`better-sqlite3` — synchronous API, zero-config, ~2MB dependency. Methods wrap sync calls in `async` since the `Storage` interface returns Promises.

### 6.2 Database Configuration

- **Path:** `AIMEAT_SQLITE_PATH` env var, default `./data/aimeat.db`
- **Auto-create:** Parent directories and database file created on instantiation
- **WAL mode:** Enabled on database open (`PRAGMA journal_mode=WAL`)
- **Busy timeout:** `PRAGMA busy_timeout = 5000` for concurrent access

### 6.3 Schema Design

All tables auto-created on first run via `schema.ts`. No manual migration step.

**Column type mapping:**
- String fields → `TEXT`
- Number fields → `REAL` or `INTEGER`
- Boolean fields → `INTEGER` (0/1)
- JSON/object fields → `TEXT` (JSON.stringify/parse)
- Array fields → `TEXT` (JSON.stringify/parse)
- Buffer/binary → `BLOB`
- Timestamps → `TEXT` (ISO strings, matching existing record types)
- Map fields (e.g., `BoardPostRecord.reactions`) → `TEXT` (JSON.stringify/parse)

**Primary keys:**
- Entities with string IDs (owners.name, agents.gaii, etc.) → `TEXT PRIMARY KEY`
- Composite keys (memory: gaii+key, actions: providerGaii+id) → composite `PRIMARY KEY`

**Indexes:** Created for common query patterns:
- `memory`: by `ownerGaii`, by `ownerGaii + key`
- `boards`: by `visibility`, by `ownerGaii`
- `work`: by `trackingCode`, by `providerGaii`, by `requesterGaii`
- `wallet_transactions`: by `gaii`
- `ghii`: by `ownerName`, by `emailHash`
- etc.

### 6.4 Special Cases

- **`ChunkedUploadRecord.receivedChunks`** — kept in-memory `Map` (transient by nature, same as MongoDB adapter)
- **`StorageFileRecord.data`** — stored as `BLOB`
- **Cascade deletes** — handled in application code (explicit `DELETE WHERE` in `deleteOwner()`, matching the in-memory adapter pattern)
- **TTL expiry** — same background job pattern as in-memory adapter (no SQLite-specific TTL mechanism)
- **Transactions** — `better-sqlite3` transactions for multi-step operations (e.g., escrow lock + balance deduct)

## 7. Config & Integration Changes

### 7.1 Config (`src/config.ts`)

Add two new fields to `AimeatConfig`:

```typescript
storageProvider: 'memory' | 'sqlite' | 'mongodb';
sqlitePath: string;
```

Loaded from env:
```typescript
storageProvider: (process.env.AIMEAT_STORAGE ?? 'memory') as StorageProvider,
sqlitePath: process.env.AIMEAT_SQLITE_PATH ?? './data/aimeat.db',
```

**Clean break:** `AIMEAT_STORAGE` must be explicitly set. `DATABASE_URL` alone no longer auto-selects MongoDB — users must also set `AIMEAT_STORAGE=mongodb`.

### 7.2 Server & Index (`src/server.ts`, `src/index.ts`)

Replace the current if/else storage selection with:

```typescript
import { createStorage } from './storage/storage-factory.js';

const storage = await createStorage({
  provider: config.storageProvider,
  sqlitePath: config.sqlitePath,
  dbUrl: config.dbUrl ?? undefined,
});
```

### 7.3 Init Wizard

Add storage selection prompt to the init wizard:
- Options: memory (development), sqlite (personal/single-user), mongodb (production/multi-user)
- When sqlite selected, prompt for database file path

### 7.4 Env Files

- `.env.example`: Add `AIMEAT_STORAGE` and `AIMEAT_SQLITE_PATH`
- `env-config.ts`: Display storage provider in `aimeat config`
- `env-validator.ts`: Validate `AIMEAT_STORAGE` values, warn if mongodb selected without `DATABASE_URL`

## 8. Backward Compatibility

- **Routes:** Zero changes. All routes call `storage.methodName()` through the composed `Storage` interface.
- **MongoDB:** The existing `MongoStorage` class is moved to `providers/mongodb/index.ts` with no functional changes. It continues to implement the full `Storage` interface.
- **In-memory:** Same — moved to `providers/memory/index.ts`, no functional changes.
- **Tests:** All 396+ E2E tests must pass with each provider. No test file changes required since tests use the same API endpoints regardless of storage backend.

## 9. What This Design Does NOT Include

- PostgreSQL adapter (future)
- Schema auto-migration between versions (manual migration scripts acceptable for v1)
- Distributed SQLite (LiteFS, Turso) — future federation consideration
- `GET /v1/admin/backup` for SQLite (listed as "Should" in REQ — deferred)
- CI matrix running tests against multiple adapters (listed as "Should" — deferred)
- Performance benchmarks (listed as "Should" — deferred)
