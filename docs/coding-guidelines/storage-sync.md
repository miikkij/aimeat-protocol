# Storage Backend Synchronization Guide

## Overview

AIMEAT has two storage implementations that MUST stay in sync:

| Backend | Implementation | Files |
|---------|---------------|-------|
| **SQLite** | `better-sqlite3` (sync API) | `src/storage/providers/sqlite/` |
| **MongoDB** | Prisma ORM (async API) | `src/storage/providers/mongodb/` + `prisma/schema.prisma` |

The in-memory mode is SQLite with `:memory:` path — same code, no persistence.

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

### Step 4: Update Prisma Schema

File: `prisma/schema.prisma`

```prisma
model Memory {
  // ... existing fields ...
  myNewField  String?
}
```

Then regenerate the Prisma client:
```bash
cd aimeat
pnpm db:generate
```

### Step 5: Update MongoDB Implementation

File: `src/storage/providers/mongodb/index.ts`

Update all Prisma queries that touch the model:
- `create()` — include new field
- `findUnique()` / `findMany()` — include in select if needed
- `update()` — include if mutable
- Record mapping — convert Prisma model to TypeScript record

### Step 6: Type-Check and Test

```bash
cd aimeat

# Verify compilation
npx tsc --noEmit

# Test all backends
pnpm test:e2e:memory
pnpm test:e2e:sqlite
pnpm test:e2e:mongodb
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

### Step 5: Prisma — Add Model + Implementation

Schema file: `prisma/schema.prisma`
```prisma
model MyNew {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  name      String
  createdAt DateTime @default(now())
}
```

Regenerate: `pnpm db:generate`

Implementation: Add all CRUD methods to `src/storage/providers/mongodb/index.ts`

### Step 6: Type-Check and Test All Backends

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

## Type Mapping

| TypeScript | SQLite | Prisma/MongoDB |
|------------|--------|----------------|
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

- `pnpm test:e2e:memory` — validates SQLite in-memory
- `pnpm test:e2e:sqlite` — validates SQLite on disk (with migrations)
- `pnpm test:e2e:mongodb` — validates MongoDB via Prisma

**All three must pass.** If any backend fails after a schema change, the change is incomplete.

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
