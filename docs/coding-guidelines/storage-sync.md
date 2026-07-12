# Storage Backend Synchronization Guide

## Overview

AIMEAT has **three** storage implementations that MUST stay in sync:

| Backend | Implementation | Files |
|---------|---------------|-------|
| **SQLite** | `better-sqlite3` (sync API) | `src/storage/providers/sqlite/` |
| **MongoDB** | Prisma ORM (async API) | `src/storage/providers/mongodb/` + `prisma/schema.prisma` |
| **PostgreSQL** | Prisma ORM (async API) | `src/storage/providers/postgres/` + `prisma/schema.postgres.prisma` (separate generated client `src/generated/prisma-postgres/`) |

The in-memory mode is SQLite with `:memory:` path — same code, no persistence. (The old pure in-memory provider is deprecated.)

Both implement the `Storage` interface defined in `src/storage/interface.ts` (24 repository interfaces, 60+ record types, 650+ methods).

---

## Adding a New Field to an Existing Record

**This is the most common change.** Follow this checklist exactly:

### Step 1: Update the Interface

File: `src/storage/interface.ts`

```typescript
export interface MemoryRecord {
  // ... existing fields ...
  myNewField?: string;  // Add as optional with clear comment
}
```

### Step 2: Update SQLite Schema

File: `src/storage/providers/sqlite/schema.ts`

1. Add the column to the `CREATE TABLE` statement:
   ```sql
   CREATE TABLE IF NOT EXISTS memory (
     -- ... existing columns ...
     myNewField TEXT,
   );
   ```

2. Add a migration for existing databases (at the end of the schema file):
   ```typescript
   safeAddColumn('memory', 'myNewField', 'TEXT');
   ```

### Step 3: Update SQLite Implementation

File: `src/storage/providers/sqlite/index.ts`

Update ALL SQL queries that touch the table:
- `INSERT` — include the new column
- `SELECT` — include in result mapping
- `UPDATE` — include if mutable
- Deserialization — map from DB row to TypeScript record

### Step 4: Update BOTH Prisma Schemas

Files: `prisma/schema.prisma` (MongoDB) **and** `prisma/schema.postgres.prisma` (PostgreSQL). Both Prisma backends must carry the field or PostgreSQL drifts.

```prisma
model Memory {
  // ... existing fields ...
  myNewField  String?
}
```

Then regenerate BOTH Prisma clients:
```bash
cd aimeat
pnpm db:generate            # MongoDB client
pnpm db:generate:postgres   # PostgreSQL client (src/generated/prisma-postgres/)
```

### Step 5: Update the MongoDB and PostgreSQL Implementations

Files: `src/storage/providers/mongodb/index.ts` **and** `src/storage/providers/postgres/index.ts`

Update all Prisma queries that touch the model in **both** providers:
- `create()` — include new field
- `findUnique()` / `findMany()` — include in select if needed
- `update()` — include if mutable
- Record mapping — convert Prisma model to TypeScript record

### Step 6: Type-Check and Test

```bash
cd aimeat

# Verify compilation
npx tsc --noEmit

# Test the persistent backends (in-memory backend is deprecated — do not use)
pnpm test:e2e:sqlite
pnpm test:e2e:mongodb
pnpm test:e2e:postgresql   # or: pnpm test:e2e:all-backends
```

---

## Adding a New Record Type / Table

### Step 1: Define the Record and Repository

File: `src/storage/interface.ts`

```typescript
// Define the record
export interface MyNewRecord {
  id: string;
  name: string;
  createdAt: string;
  // ...
}

// Define the repository interface
export interface MyNewRepository {
  createMyNew(record: MyNewRecord): Promise<void>;
  getMyNew(id: string): Promise<MyNewRecord | undefined>;
  listMyNew(filter?: { owner?: string }): Promise<MyNewRecord[]>;
  updateMyNew(id: string, updates: Partial<MyNewRecord>): Promise<void>;
  deleteMyNew(id: string): Promise<boolean>;
}

// Add to the Storage composite interface
export interface Storage extends
  // ... existing repos ...
  MyNewRepository { }
```

### Step 2: Create Repository File

File: `src/storage/repositories/my-new.repository.ts`

```typescript
export type { MyNewRepository } from '../interface.js';
```

### Step 3: Add to Repository Index

File: `src/storage/repositories/index.ts`

```typescript
export type { MyNewRepository } from './my-new.repository.js';
```

### Step 4: SQLite — Add Table + Implementation

Schema file: `src/storage/providers/sqlite/schema.ts`
```sql
CREATE TABLE IF NOT EXISTS my_new (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
```

Implementation: Add all CRUD methods to `src/storage/providers/sqlite/index.ts`

### Step 5: Prisma — Add Model + Implementation (BOTH Prisma backends)

Schema files: `prisma/schema.prisma` (MongoDB) **and** `prisma/schema.postgres.prisma` (PostgreSQL). Note the id/attribute mapping differs per backend (Mongo `@map("_id") @db.ObjectId`; Postgres a plain `@id` string/uuid) — mirror the model in both, using each backend's conventions.
```prisma
// schema.prisma (MongoDB)
model MyNew {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  name      String
  createdAt DateTime @default(now())
}
```

Regenerate both clients: `pnpm db:generate` **and** `pnpm db:generate:postgres`

Implementation: Add all CRUD methods to `src/storage/providers/mongodb/index.ts` **and** `src/storage/providers/postgres/index.ts`

### Step 6: Type-Check and Test All Backends (SQLite + MongoDB + PostgreSQL)

---

## SQLite Migration Pattern

SQLite uses `safeAddColumn()` for schema evolution on existing databases:

```typescript
const safeAddColumn = (table: string, column: string, type: string) => {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`); } catch { /* column already exists */ }
};
```

**Rules:**
- Migrations accumulate — never remove a `safeAddColumn()` call
- Always add to the `CREATE TABLE` AND as a migration (both needed)
- `CREATE TABLE IF NOT EXISTS` handles fresh databases
- `safeAddColumn` handles existing databases
- Only supports adding columns — complex changes (rename, type change) require manual migration

**For breaking changes** (rename column, change type):
1. Add new column with `safeAddColumn`
2. Write a migration function that copies data from old to new column
3. Keep old column for backwards compatibility (or coordinate a major version bump)

---

## MongoDB Migration Pattern

MongoDB is schemaless, so Prisma doesn't enforce schema at write time. But the Prisma Client must match the data:

```bash
# After updating prisma/schema.prisma:
pnpm db:generate     # Regenerates Prisma Client types
```

**For MongoDB, "migration" means:**
- New fields: Just add to Prisma schema and regenerate. Old documents get `null` for new fields.
- Removed fields: Remove from schema, old documents keep the data (harmless).
- Type changes: Requires manual data migration script.

---

## PostgreSQL Migration Pattern

PostgreSQL uses Prisma with its own schema (`prisma/schema.postgres.prisma`) and generated client (`src/generated/prisma-postgres/`). Unlike schemaless MongoDB, Postgres enforces the schema, so a data-model change must land in the schema AND be pushed to the database:

```bash
# After updating prisma/schema.postgres.prisma:
pnpm db:generate:postgres   # regenerate the postgres client
pnpm db:push:postgres       # apply the schema to the database
```

Mirror any MongoDB model change here (same fields; use Postgres-native id/type conventions). Prefer deterministic plain `DateTime` timestamps (no `@updatedAt`) to keep backend parity, as the shared code sets timestamps explicitly.

---

## Type Mapping

| TypeScript | SQLite | Prisma (MongoDB / PostgreSQL) |
|------------|--------|-------------------------------|
| `string` | `TEXT` | `String` |
| `number` (int) | `INTEGER` | `Int` |
| `number` (float) | `REAL` | `Float` |
| `boolean` | `INTEGER` (0/1) | `Boolean` |
| `string[]` | `TEXT` (JSON) | `String[]` |
| `Date` / `string` | `TEXT` (ISO) | `DateTime` |
| `object` | `TEXT` (JSON) | `Json` |

**SQLite JSON pattern:**
```typescript
// Store: JSON.stringify(array)
// Read:  JSON.parse(row.field) as string[]
```

---

## Validation Strategy

Until a formal migration framework is adopted, validation comes from E2E tests:

- `pnpm test:e2e:sqlite` — validates SQLite, disk or `:memory:` (with migrations); fast-iteration default
- `pnpm test:e2e:mongodb` — validates MongoDB via Prisma
- `pnpm test:e2e:postgresql` — validates PostgreSQL via Prisma (or `pnpm test:e2e:all-backends` for all three)

> `pnpm test:e2e:memory` (pure in-memory) is **deprecated** — not a supported backend.

**All three persistent backends must pass.** If any backend fails after a schema change, the change is incomplete.

---

## Future Considerations

The current manual sync approach works but has scaling concerns:

| Concern | Impact | Mitigation |
|---------|--------|------------|
| Missed field in one backend | Silent data loss | E2E tests on all backends |
| Growing migration list | Slower startup | Periodic schema consolidation |
| Type mismatch between backends | Runtime errors | TypeScript strict mode + tests |
| No rollback capability | Risk during upgrades | Backup before schema changes |

**Potential future improvements:**
- Shared repository implementation with driver abstraction
- Schema validation test that compares interface vs implementations
- Automated migration generation from interface changes
