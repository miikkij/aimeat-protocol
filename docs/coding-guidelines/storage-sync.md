# Storage Backend Synchronization Guide

## Overview

AIMEAT has **two** storage provider dirs that MUST stay in sync (post Phase 5 — the Postgres+Kysely cutover):

| Backend | Priority | Implementation | Files |
|---------|----------|---------------|-------|
| **PostgreSQL + Kysely** | **PRIMARY (prod)** — must always pass | `pg` + Kysely (async, raw SQL) | `src/storage/providers/postgres-kysely/` + SQL migrations in `providers/postgres-kysely/migrations/*.sql` (run on boot) + `providers/postgres-kysely/db-types.ts` (Kysely `DB` interface) |
| **SQLite** | first-class — must always pass | `better-sqlite3` (sync API) | `src/storage/providers/sqlite/` |

> The Prisma-era backends (MongoDB + the legacy Prisma `postgres` provider) were **removed on 2026-07-16** — no Prisma remains in the codebase. Every schema change lands in **both** remaining backends in the same commit.

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

### Step 4: Update the PRIMARY backend — PostgreSQL + Kysely

Files: `src/storage/providers/postgres-kysely/`.
1. **Migration** — add a new numbered SQL file `migrations/NNNN_<desc>.sql` with the `ALTER TABLE ... ADD COLUMN` (idempotent; applied on boot, tracked in `_kysely_migrations`). For a brand-new column on an existing table:
   ```sql
   ALTER TABLE "Memory" ADD COLUMN IF NOT EXISTS "myNewField" text;
   ```
2. **`db-types.ts`** — add the column to the table's Kysely interface (`myNewField: string | null`).
3. **Methods** — update the method group under `providers/postgres-kysely/methods/*.ts` that touches the table: `insertInto(...).values(...)`, `selectAll()`/select column, `updateTable(...).set(...)`, and the `row → record` mapper. jsonb columns wrap via the `jsonb()` helper; remember **PG jsonb does not preserve key order** (don't rely on `JSON.stringify` order for dedup).

### Step 5: Type-Check and Test

```bash
cd aimeat

# Verify compilation
npx tsc --noEmit

# Both backends must be green:
pnpm test:e2e:postgres-kysely   # recreate the postgres-kysely test DB first for a full run
pnpm test:e2e:sqlite
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

### Step 5: PostgreSQL + Kysely — Add Table + Implementation (PRIMARY)

1. **Migration** — new `providers/postgres-kysely/migrations/NNNN_<desc>.sql` with `CREATE TABLE IF NOT EXISTS "MyNew" (...)` (+ any indexes; applied on boot). **Also add the SQL migrations copy step to the build** — `providers/postgres-kysely/migrations` must be copied into `dist/` or `pnpm start` can't find them.
2. **`db-types.ts`** — add the `MyNew` table interface + register it on the `DB` interface.
3. **Methods** — add the CRUD method group under `providers/postgres-kysely/methods/*.ts`, bound to `PostgresKyselyStorage` via the prototype merge in `providers/postgres-kysely/index.ts`.

### Step 6: Type-Check and Test both backends (PostgreSQL+Kysely + SQLite)

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

## PostgreSQL (Kysely) Migration Pattern

The Kysely backend evolves via numbered SQL files in `providers/postgres-kysely/migrations/*.sql`, applied on boot and tracked in `_kysely_migrations`:

- Migrations are **append-only** — never edit an already-shipped migration file; add a new numbered one.
- Make DDL idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) so a partially-applied environment recovers cleanly.
- Keep `db-types.ts` in lockstep with the migration in the same commit.
- Remember **PG jsonb does not preserve key order** — don't rely on `JSON.stringify` equality for dedup.

---

## Type Mapping

| TypeScript | SQLite | PostgreSQL (Kysely) |
|------------|--------|---------------------|
| `string` | `TEXT` | `text` |
| `number` (int) | `INTEGER` | `integer` / `bigint` |
| `number` (float) | `REAL` | `double precision` |
| `boolean` | `INTEGER` (0/1) | `boolean` |
| `string[]` | `TEXT` (JSON) | `jsonb` |
| `Date` / `string` | `TEXT` (ISO) | `timestamptz` / `text` (ISO) |
| `object` | `TEXT` (JSON) | `jsonb` |

**SQLite JSON pattern:**
```typescript
// Store: JSON.stringify(array)
// Read:  JSON.parse(row.field) as string[]
```

---

## Validation Strategy

Until a formal migration framework is adopted, validation comes from E2E tests:

- `pnpm test:e2e:sqlite` — validates SQLite, disk or `:memory:` (with migrations); fast-iteration default
- `pnpm test:e2e:postgres-kysely` — validates PostgreSQL via Kysely (**primary / prod backend**)
- `pnpm test:e2e:all-backends` — both of the above in one go

> `pnpm test:e2e:memory` (pure in-memory) is **deprecated** — not a supported backend.

**Both backends (PostgreSQL+Kysely and SQLite) must pass.** If either fails after a schema change, the change is incomplete.

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
