# Storage Backend Synchronization Guide

## Overview

AIMEAT has **four** storage provider dirs that MUST stay in sync, listed in **priority order** (post Phase 5 — the Postgres+Kysely cutover):

| Backend | Priority | Implementation | Files |
|---------|----------|---------------|-------|
| **PostgreSQL + Kysely** | **PRIMARY (prod)** — must always pass | `pg` + Kysely (async, raw SQL) | `src/storage/providers/postgres-kysely/` + SQL migrations in `providers/postgres-kysely/migrations/*.sql` (run on boot; **no Prisma**) + `providers/postgres-kysely/db-types.ts` (Kysely `DB` interface) |
| **SQLite** | first-class — must always pass | `better-sqlite3` (sync API) | `src/storage/providers/sqlite/` |
| **MongoDB** | **DEPRECATED — removed before v2.0** | Prisma ORM (async API) | `src/storage/providers/mongodb/` + `prisma/schema.prisma` |
| **PostgreSQL (Prisma)** | **legacy — superseded by Kysely** | Prisma ORM (async API) | `src/storage/providers/postgres/` + `prisma/schema.postgres.prisma` (separate client `src/generated/prisma-postgres/`) |

> **⚠️ The primary backend is `postgres-kysely` (Kysely, not Prisma).** When you add a field/table, do **postgres-kysely + sqlite FIRST** — both must always pass. The Prisma path (mongodb + the legacy Prisma `postgres`) is winding down: keep it compiling while it exists, but it is not the source of truth and its failures are not blocking. **Do not confuse `postgres-kysely` (primary, Kysely) with `postgres` (legacy, Prisma).**

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

### Step 4: Update the PRIMARY backend — PostgreSQL + Kysely (do this, not Prisma-first)

Files: `src/storage/providers/postgres-kysely/`.
1. **Migration** — add a new numbered SQL file `migrations/NNNN_<desc>.sql` with the `ALTER TABLE ... ADD COLUMN` (idempotent; applied on boot, tracked in `_kysely_migrations`). For a brand-new column on an existing table:
   ```sql
   ALTER TABLE "Memory" ADD COLUMN IF NOT EXISTS "myNewField" text;
   ```
2. **`db-types.ts`** — add the column to the table's Kysely interface (`myNewField: string | null`).
3. **Methods** — update the method group under `providers/postgres-kysely/methods/*.ts` that touches the table: `insertInto(...).values(...)`, `selectAll()`/select column, `updateTable(...).set(...)`, and the `row → record` mapper. jsonb columns wrap via the `jsonb()` helper; remember **PG jsonb does not preserve key order** (don't rely on `JSON.stringify` order for dedup).

### Step 5 (legacy, while they still exist): Update BOTH Prisma Schemas

> MongoDB is deprecating (removed before v2.0) and the Prisma `postgres` provider is superseded by Kysely. Keep them compiling, but they are **not** the source of truth. Skip only if the model no longer exists in the Prisma schemas.

Files: `prisma/schema.prisma` (MongoDB) **and** `prisma/schema.postgres.prisma` (legacy Prisma-PG).

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
pnpm db:generate:postgres   # legacy Prisma-PG client (src/generated/prisma-postgres/)
```

### Step 6 (legacy): Update the MongoDB and Prisma-PostgreSQL Implementations

Files: `src/storage/providers/mongodb/index.ts` **and** `src/storage/providers/postgres/index.ts` (the Prisma-PG provider extends the mongodb `PrismaStorage`).

Update all Prisma queries that touch the model in **both** providers (create/find/update/record-mapping).

### Step 7: Type-Check and Test

```bash
cd aimeat

# Verify compilation
npx tsc --noEmit

# PRIMARY backends — both must be green:
pnpm test:e2e:postgres-kysely   # recreate the postgres-kysely test DB first for a full run
pnpm test:e2e:sqlite
# Legacy (only if you touched the Prisma path; failures informational; pnpm script removed):
node --env-file=.env.test.mongodb --import tsx test/run-e2e-ci.ts
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

### Step 6 (legacy, while they still exist): Prisma — Add Model + Implementation

> MongoDB is deprecating (out before v2.0); the Prisma `postgres` provider is superseded by Kysely. Do this only while those models still exist.

Schema files: `prisma/schema.prisma` (MongoDB) **and** `prisma/schema.postgres.prisma` (legacy Prisma-PG). Id/attribute mapping differs (Mongo `@map("_id") @db.ObjectId`; Prisma-PG a plain `@id` string/uuid).
```prisma
// schema.prisma (MongoDB)
model MyNew {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  name      String
  createdAt DateTime @default(now())
}
```

Regenerate both clients: `pnpm db:generate` **and** `pnpm db:generate:postgres`. Implementation: CRUD methods in `src/storage/providers/mongodb/index.ts` **and** `src/storage/providers/postgres/index.ts`.

### Step 7: Type-Check and Test the PRIMARY backends (PostgreSQL+Kysely + SQLite)

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
- `pnpm test:e2e:postgres-kysely` — validates PostgreSQL via Kysely (**primary / prod backend**)
- `pnpm test:e2e:all-backends` — both of the above in one go
- MongoDB (deprecated, Prisma; pnpm script removed): `node --env-file=.env.test.mongodb --import tsx test/run-e2e-ci.ts` — only when the shared Prisma path was touched; failures informational

> `pnpm test:e2e:memory` (pure in-memory) is **deprecated** — not a supported backend.

**Both primary backends (PostgreSQL+Kysely and SQLite) must pass.** If either fails after a schema change, the change is incomplete.

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
