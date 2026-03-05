# REQ-003: SQLite Storage Adapter

**Status:** Draft  
**Priority:** Critical — Removes MongoDB dependency for basic users  
**Type:** Feature / Infrastructure  
**Created:** 2026-03-04  

---

## 1. Summary

Implement a SQLite-based storage adapter for AIMEAT so that personal node operators and developers can run a fully functional node without installing MongoDB or any external database server. SQLite stores data in a single file on the local filesystem, making it ideal for personal nodes, development, and single-user deployments.

## 2. Background

- Current storage options: in-memory (development only, data lost on restart) and MongoDB via Prisma
- MongoDB requires installing and running a database server — a significant barrier for non-technical users
- The `Storage` interface in `src/storage/interface.ts` is already abstracted, making new adapters pluggable
- Prisma supports SQLite natively, but AIMEAT's Prisma schema may need adjustments (MongoDB-specific features like ObjectId, embedded documents)
- SQLite is zero-config, serverless, and included in most platforms — perfect for "download and run" experience

## 3. Requirements

### 3.1 Storage Adapter Implementation

| ID | Requirement | Priority |
|----|------------|----------|
| R-003-01 | Implement `src/storage/sqlite.ts` that satisfies the full `Storage` interface | Must |
| R-003-02 | Use `better-sqlite3` (synchronous, fast, zero-dependency) or Prisma SQLite provider | Must |
| R-003-03 | Store database file at configurable path (env: `AIMEAT_SQLITE_PATH`, default: `./data/aimeat.db`) | Must |
| R-003-04 | Auto-create database file and tables on first run (no manual migration step) | Must |
| R-003-05 | Support all CRUD operations in the Storage interface (owners, agents, memory, boards, work, wallet, consent, actions, catalogue, federation, OTK, storage files, micro-memory, realtime rooms, apps, schema locks, hooks, organisms) | Must |
| R-003-06 | JSON fields stored as TEXT with JSON serialization (SQLite has no native JSON column type in all drivers) | Must |
| R-003-07 | Binary/file storage (chunked uploads) stored as BLOB or referenced files on disk | Must |

### 3.2 Configuration & Selection

| ID | Requirement | Priority |
|----|------------|----------|
| R-003-08 | Add `AIMEAT_STORAGE` env var with values: `memory` (default), `sqlite`, `mongodb` | Must |
| R-003-09 | Update `src/config.ts` to load storage selection | Must |
| R-003-10 | Update `src/index.ts` (or storage factory) to instantiate correct adapter based on config | Must |
| R-003-11 | Update `aimeat init` wizard to offer storage selection (memory / sqlite / mongodb) | Must |
| R-003-12 | Update `.env.example` with `AIMEAT_STORAGE` and `AIMEAT_SQLITE_PATH` | Must |

### 3.3 Schema Design

| ID | Requirement | Priority |
|----|------------|----------|
| R-003-13 | Design relational schema mapping for all Storage interface entities | Must |
| R-003-14 | Use INTEGER PRIMARY KEY for auto-increment where applicable | Must |
| R-003-15 | Use TEXT for GAII, tracking codes, and other string identifiers | Must |
| R-003-16 | Use INTEGER (Unix ms) for all timestamps (consistent with in-memory adapter) | Must |
| R-003-17 | Create appropriate indexes for query patterns: memory by gaii+key, boards by id, work by tracking code, wallet by gaii | Must |
| R-003-18 | Support TTL-based expiry via scheduled cleanup (same pattern as memory TTL background job) | Must |

### 3.4 Data Integrity

| ID | Requirement | Priority |
|----|------------|----------|
| R-003-19 | Use WAL (Write-Ahead Logging) mode for concurrent read performance | Must |
| R-003-20 | Use transactions for multi-step operations (escrow lock + balance deduct, settlement) | Must |
| R-003-21 | Ensure cascade delete works (owner delete removes all agents, memory, boards, work) | Must |
| R-003-22 | Handle SQLite's single-writer limitation gracefully (queue writes or use busy_timeout) | Must |

### 3.5 Migration & Portability

| ID | Requirement | Priority |
|----|------------|----------|
| R-003-23 | Implement `GET /v1/admin/backup` that exports SQLite database file directly | Should |
| R-003-24 | Implement data export format that can be imported into MongoDB adapter (and vice versa) | Should |
| R-003-25 | Document upgrade path: SQLite → MongoDB when node outgrows single-file storage | Should |

### 3.6 Testing

| ID | Requirement | Priority |
|----|------------|----------|
| R-003-26 | All existing E2E tests (396+) must pass with SQLite adapter | Must |
| R-003-27 | All unit tests must pass with SQLite adapter | Must |
| R-003-28 | Add CI matrix that runs tests against both in-memory and SQLite adapters | Should |
| R-003-29 | Performance benchmark: SQLite must handle 100 concurrent memory writes without data loss | Should |

## 4. Architecture Decision: Prisma vs Direct SQLite

### Option A: Prisma SQLite Provider
- **Pro:** Reuse existing Prisma schema (with modifications), familiar API, migration tooling
- **Con:** Prisma schema designed for MongoDB (ObjectId, embedded docs) needs refactoring; Prisma adds ~15MB to node_modules; some MongoDB-specific features (e.g., `@db.ObjectId`) have no SQLite equivalent
- **Verdict:** Viable if schema can be adapted without breaking MongoDB adapter

### Option B: Direct `better-sqlite3`
- **Pro:** Zero overhead, synchronous API (perfect for single-node), ~2MB dependency, full control
- **Con:** Must write all SQL queries manually, no auto-migration
- **Verdict:** Recommended for maximum simplicity and minimal dependencies

### Recommendation
**Option B (better-sqlite3)** — aligns with AIMEAT's philosophy of minimal dependencies for personal nodes. The in-memory adapter already uses raw Map operations; SQLite adapter follows the same pattern with SQL instead.

## 5. Out of Scope

- PostgreSQL adapter (future consideration)
- S3 / Azure Blob Storage for file storage (separate REQ)
- Distributed SQLite (e.g., LiteFS, Turso) — future consideration for federation
- Schema auto-migration between versions (manual migration scripts are acceptable for v1)

## 6. Success Criteria

1. `AIMEAT_STORAGE=sqlite pnpm dev` starts a fully functional node with zero external dependencies
2. All 396+ E2E tests pass with SQLite adapter
3. Database file is portable (copy to another machine, start node, works)
4. `aimeat init` offers SQLite as default for personal use case

## 7. Dependencies

- `src/storage/interface.ts` — Storage abstraction (no changes expected)
- `src/storage/memory.ts` — Reference implementation for behavior
- `better-sqlite3` package — new dependency (~2MB)
- `@types/better-sqlite3` — TypeScript definitions

## 8. Estimated Effort

- Schema design: 1 day
- Adapter implementation: 3-4 days
- Testing & bug fixing: 2 days
- Config/wizard updates: 0.5 day
- Documentation: 0.5 day
