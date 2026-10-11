# Storage Backend Synchronization Guide

## Overview

AIMEAT has **two** storage providers, and they MUST stay in sync:

| Backend | Role | Implementation | Files |
|---------|------|----------------|-------|
| **PostgreSQL + Kysely** | production; must always pass | `pg` + Kysely (async) | `src/storage/providers/postgres-kysely/`: numbered SQL migrations in `migrations/*.sql` (applied on boot by `migrate.ts`), the Kysely `DB` interface in `db-types.ts`, method groups in `methods/*.ts` |
| **SQLite** | first-class; must always pass | `better-sqlite3` (sync API) | `src/storage/providers/sqlite/`: schema files `schema*.ts`, method groups in `methods/*.ts`, row-level helpers in `repos/*.ts` |

The Prisma-era backends (MongoDB and the Prisma `postgres` provider) were removed on 2026-07-16. Every schema change lands in **both** remaining providers in the same commit.

`AIMEAT_STORAGE=memory` opens SQLite on `:memory:` (`src/storage/storage-factory.ts`): the same code, no persistence.

### Where the storage contract lives

| What | File |
|------|------|
| Record and value types (`MemoryRecord`, `AgentRecord`, …) | `src/storage/types/<domain>.ts`, re-exported by `src/storage/interface.ts` |
| One repository interface per domain | `src/storage/repositories/<domain>.repository.ts` |
| The `Storage` composite that extends every repository interface | `src/storage/interface.ts` |
| SQLite fresh-install DDL (`CREATE TABLE/INDEX IF NOT EXISTS`) | `providers/sqlite/schema-tables-1.ts` … `schema-tables-4.ts` |
| SQLite added columns for existing databases (`safeAddColumn`) | `providers/sqlite/schema.ts` (`initializeSchema`), plus the per-table blocks moved out of it: `schema-columns-agents.ts`, `schema-columns-extensions.ts`, `schema-columns-scheduler.ts` |
| SQLite table rebuilds that `ALTER TABLE` cannot express | `providers/sqlite/schema-rebuilds.ts` |
| Method bodies | `providers/<provider>/methods/<group>.ts`, merged onto the provider class with `Object.assign(prototype, …)` in `providers/<provider>/index.ts` |
| The owner deletion cascade | `providers/sqlite/methods/owner-cascade.ts`; `providers/postgres-kysely/methods/owner-cascade.ts` and `identity-erasure.ts` |

To find which file holds a record type, grep: `grep -rn "export interface AgentRecord" aimeat/src/storage/types`.

Three checks hold the two providers together. All three run in `pnpm check:fast`, so in `pnpm gate` and CI:

- `pnpm check:storage-file-parity`: a method lives in the methods file **of the same name** in both providers, and each provider defines the same methods. A method one provider needs alone is declared in its internals interface (`SqliteInternals` in `providers/sqlite/methods/internal.ts`).
- `pnpm check:storage-parity`: every table with an owner column on its list (`OWNER_COLUMNS` in `scripts/check-storage-parity.ts`) is cleared by both deletion cascades, or has a written reason in `aimeat/security/storage-parity-exemptions.json`.
- `pnpm check:migration-hashes`: a Postgres migration file on `main` never changes, and a new one is listed in `aimeat/security/migration-hashes.json` in the same commit.

`pnpm typecheck` does not catch a method that one provider lacks: each provider class declares `interface … extends Storage` and merges its methods at runtime, so the compiler assumes every method is there. A missing method throws when it is called. `check:storage-file-parity` is the check that finds it.

`test/unit/storage-conformance.test.ts` is the behavioural half: it runs the same scenarios (delete cascade, listing order, one-time spends) against both providers and requires the same result. Without `DATABASE_URL` it checks SQLite only.

---

## Adding a New Field to an Existing Record

**This is the most common change.** Commit `c8fccc245` (`StorageFileRecord.aiProvenanceId`, migration 0096) is a small, complete example: run `git show --stat c8fccc245` to see every file it touched.

### Step 1: Update the record type

File: the `src/storage/types/<domain>.ts` that declares the record (for example `AgentRecord` in `types/identity.ts`).

```typescript
export interface AgentRecord {
  // ... existing fields ...
  /** What the field means and who sets it. */
  stoppedAt?: string | null;
}
```

If the repository gains or changes a method, update `src/storage/repositories/<domain>.repository.ts` too.

### Step 2: Update the SQLite schema

Add a `safeAddColumn` call in `initializeSchema` (`providers/sqlite/schema.ts`), or in the `schema-columns-*.ts` block that already holds that table's columns:

```typescript
// One line on why the column exists. Mirrors Postgres 0096.
safeAddColumn('storage_files', 'aiProvenanceId', 'TEXT');
```

`safeAddColumn` runs on every start, after the `CREATE TABLE` blocks, so it reaches a fresh database and an old one alike. An index on the new column goes after the `safeAddColumn` call, never in the `schema-tables-*.ts` block: on an upgraded database the column does not exist yet when that block runs. Adding the column to the table's `CREATE TABLE` in `schema-tables-*.ts` as well is allowed and some tables do it; it is not required.

### Step 3: Update the SQLite methods

File: `providers/sqlite/methods/<group>.ts`, the group that reads and writes the table.

Update every statement that touches the table:
- `INSERT`: the column list and the value
- `UPDATE`: if the field is mutable
- the row mapper: from the DB row to the record (JSON columns go through `JSON.parse`)

### Step 4: Update PostgreSQL + Kysely (production)

Files under `providers/postgres-kysely/`:

1. **Migration.** Add the next numbered file `migrations/NNNN_<desc>.sql`. Start it with a comment that says why the column exists and that it mirrors the SQLite change. Keep the DDL idempotent:
   ```sql
   ALTER TABLE "StorageFile" ADD COLUMN IF NOT EXISTS "aiProvenanceId" TEXT;
   ```
2. **Hash lock.** Run `pnpm check:migration-hashes --add` (from `aimeat/`) to add the new file's line to `aimeat/security/migration-hashes.json`. Commit both together.
3. **`db-types.ts`.** Add the column to the table's Kysely interface (`aiProvenanceId: string | null`).
4. **Methods.** Update the methods file with the same name as the SQLite one: `insertInto(...).values(...)`, the select, `updateTable(...).set(...)`, and the row mapper. jsonb columns go through the `jsonb()` helper, and **PG jsonb does not preserve key order**, so do not compare `JSON.stringify` output for dedup.

### Step 5: Check what else carries the record

- A field that reaches the API goes into `openapi.yaml` in the same commit (`.claude/rules/backend.md`).
- A field on `OwnerRecord` or `AgentRecord` stays out of `GET /v1/admin/backup` until it is named in `OWNER_FIELDS` or `AGENT_FIELDS` in `src/services/admin-backup-projection.ts`. That list is an allowlist on purpose.

### Step 6: Type-check and test

```bash
cd aimeat
pnpm typecheck

# The suite that exercises the record, on both backends (.env.test.* come from `pnpm test:env:init`):
pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=<suite>
pnpm exec node --env-file=.env.test.postgres-kysely --import tsx test/run-e2e-ci.ts --test=<suite>

# When the work is finished:
pnpm gate --postgres
```

`pnpm gate --postgres` runs the static checks above, the unit tests the change reaches (the storage conformance test among them) and, because the change is under `src/storage/`, the guard tier on both backends. The full E2E sweep is not a routine step; see [testing-requirements.md](testing-requirements.md).

---

## Adding a New Record Type / Table

Commit `da1f2215f` (content labels, migration 0090) added a table end to end; `git show --stat da1f2215f` lists the storage files it touched.

### Step 1: Define the record type

File: a new `src/storage/types/<domain>.ts`, re-exported from `src/storage/interface.ts`:

```typescript
// src/storage/types/my-new.ts
export interface MyNewRecord {
  id: string;
  ownerGhii: string;
  name: string;
  createdAt: string;
}

// src/storage/interface.ts
export * from './types/my-new.js';
```

### Step 2: Define the repository interface

File: a new `src/storage/repositories/my-new.repository.ts`:

```typescript
import type { MyNewRecord } from '../types/my-new.js';

export interface MyNewRepository {
  createMyNew(record: MyNewRecord): Promise<void>;
  getMyNew(id: string): Promise<MyNewRecord | undefined>;
  listMyNew(filter?: { ownerGhii?: string }): Promise<MyNewRecord[]>;
  deleteMyNew(id: string): Promise<boolean>;
}
```

### Step 3: Add it to the `Storage` composite

File: `src/storage/interface.ts`. Import the interface type and add it to the list `Storage` extends:

```typescript
import type { MyNewRepository } from './repositories/my-new.repository.js';

export interface Storage extends
  // ... existing repositories ...
  MyNewRepository { /* ... */ }
```

There is no repository barrel file; `interface.ts` is the one place repositories are collected.

### Step 4: SQLite: table and methods

1. Add the `CREATE TABLE IF NOT EXISTS` and its indexes to the last `schema-tables-*.ts` block (or the one that holds related tables):
   ```sql
   CREATE TABLE IF NOT EXISTS my_new (
     id        TEXT PRIMARY KEY,
     ownerGhii TEXT NOT NULL,
     name      TEXT NOT NULL,
     createdAt TEXT NOT NULL
   );
   ```
2. Add `providers/sqlite/methods/my-new.ts` exporting `export const myNewMethods = { … }` (method shorthand, `this: SqliteStorage`).
3. Import it in `providers/sqlite/index.ts` and add it to the `Object.assign(prototype, …)` list.

### Step 5: PostgreSQL + Kysely: table and methods (production)

1. **Migration.** New `migrations/NNNN_<desc>.sql` with `CREATE TABLE IF NOT EXISTS "MyNew" (...)` and its indexes, then `pnpm check:migration-hashes --add`. The build already copies the whole migrations folder into `dist/` (`scripts/copy-dist-assets.mjs`); there is nothing to add there.
2. **`db-types.ts`.** Add the `MyNew` table interface and register it on the `DB` interface.
3. **Methods.** Add `providers/postgres-kysely/methods/my-new.ts` with the same file name and the same method names as the SQLite one, import it in `providers/postgres-kysely/index.ts` and add it to the `Object.assign(prototype, …)` list.

### Step 6: The deletion cascade

If the table holds data that belongs to one person, add it to both cascades: `providers/sqlite/methods/owner-cascade.ts` and the Postgres `owner-cascade.ts` or `identity-erasure.ts`. If a row must outlive its owner, record why in `aimeat/security/storage-parity-exemptions.json`. `pnpm check:storage-parity` fails until one of the two is done, but only for the owner columns on its `OWNER_COLUMNS` list. `ownerGhii` is not on that list yet (the script says why), so for an `ownerGhii` table nothing fails and the cascade is your job. Extend `test/unit/storage-conformance.test.ts` when the table has behaviour both providers must agree on.

### Step 7: Type-check and test both backends

The same commands as Step 6 of the field procedure: `pnpm typecheck`, the suites that exercise the new table with `--test=<suite>` on both `.env.test.*` files, and `pnpm gate --postgres` when the work is finished. A new table usually comes with a new route and a new E2E suite; [testing-requirements.md](testing-requirements.md) says how to register one.

---

## SQLite Migration Pattern

SQLite evolves through `safeAddColumn()`, defined inside `initializeSchema` in `providers/sqlite/schema.ts`. It runs `ALTER TABLE … ADD COLUMN` and ignores only the "duplicate column name" error. Any other error (a missing table, a locked database, a bad type) stops the start with `schema migration failed: …`, because a node that boots without a column the code expects fails later and far away.

**Rules:**
- Calls accumulate. Never remove a `safeAddColumn()` call.
- `CREATE TABLE IF NOT EXISTS` in `schema-tables-*.ts` handles fresh databases; `safeAddColumn` handles every database.
- An index on an added column is created after its `safeAddColumn` call.
- `safeAddColumn` only adds columns. A primary-key change or a relaxed `NOT NULL` needs a table rebuild in `schema-rebuilds.ts`, gated on `PRAGMA table_info` so a fresh database skips it.
- A data migration that can destroy or hide data follows the positive-evidence rule below, and its SQLite half writes its own `migration:<file>` row in `system_settings` in the same transaction (see `schema-identity-backfill.ts`).

**For a rename or a type change:**
1. Add the new column with `safeAddColumn`.
2. Copy the data from the old column to the new one, once.
3. Keep the old column (SQLite cannot drop it cheaply), or coordinate a major version.

---

## PostgreSQL (Kysely) Migration Pattern

The Kysely backend evolves through numbered SQL files in `providers/postgres-kysely/migrations/*.sql`. `migrate.ts` applies each file once on boot, in order, and records it in `_kysely_migrations`:

- Migrations are **append-only**. Never edit a shipped migration file; add a new numbered one. `pnpm check:migration-hashes` holds this: every file is listed with its sha256 in `aimeat/security/migration-hashes.json`, a new file gets its line in the same commit (`pnpm check:migration-hashes --add`), and a file or a line that is on `origin/main` does not change.
- A file that must not run any more is **superseded**, not edited: add the replacement and name the pair in `SUPERSEDED` in `migrate.ts`. On a database that has not applied the old file, the runner records it with `superseded_by` and never runs it; the replacement brings a database that did apply it to the same end state. 0085 → 0086 is the first pair.
- **A migration that can destroy or hide data acts only on positive evidence.** What it cannot decide stays as it is and goes to the operator's page (one incident, `services/security-incident.ts`), never to a script somebody has to remember to run. Nothing in it throws on data: the node always starts. The SQLite half of such a migration writes its own `migration:<file>` row in `system_settings` in the same transaction as the change.
- Make DDL idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) so a partially-applied environment recovers.
- Keep `db-types.ts` in step with the migration in the same commit.
- **PG jsonb does not preserve key order.** Do not rely on `JSON.stringify` equality for dedup.

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

## Validation

What proves a storage change, from fastest to slowest:

| Check | What it catches |
|-------|-----------------|
| `pnpm typecheck` | a wrong record type or method signature |
| `pnpm check:storage-file-parity` | a method in a different file, or in one provider only |
| `pnpm check:storage-parity` | an owner-scoped table that one cascade leaves behind |
| `pnpm check:migration-hashes` | an edited migration, or a new one without its hash line |
| `test/unit/storage-conformance.test.ts` | the two providers returning different results for the same scenario |
| `--test=<suite>` on both `.env.test.*` files | the feature's own behaviour on each backend |
| `pnpm gate --postgres` | all of the above that the change reaches, plus the guard tier on both backends |

**Both backends must pass.** If either fails after a schema change, the change is incomplete.

---

## Known limits

| Concern | Impact | What holds it today |
|---------|--------|---------------------|
| A field written by one provider and not the other | silent data loss on one backend | E2E on both backends; `storage-conformance.test.ts` for the scenarios it covers |
| Growing `safeAddColumn` list | slower SQLite start | the per-table `schema-columns-*.ts` blocks; periodic consolidation |
| No down migrations | an upgrade cannot be rolled back in place | back up before a release that changes the schema |

Two providers are implemented by hand. There is no shared repository implementation and no migration generated from the type definitions.
