# T-8: MongoDB Storage Adapter Integration Tests

**Gap:** No integration tests for MongoStorage. Only InMemoryStorage exercised.

**Priority:** Low

**File:** `test/integration/mongodb-storage.test.ts`

## Scope

Test the `MongoStorage` adapter against a real MongoDB instance to verify data persistence, query behavior, and parity with the in-memory implementation.

## Architecture Context

- `MongoStorage` (`src/storage/mongodb.ts`) uses Prisma with `mongodb` provider
- Implements the full `Storage` interface (`src/storage/interface.ts`)
- Some features are still in-memory even in MongoStorage (board subscriptions, chunked uploads)
- TTL checks are application-level (`getMemory` checks `ttlExpiresAt`, `listPosts` filters expired)

## Prerequisites

- MongoDB running (local or Docker)
- `DATABASE_URL` environment variable set
- `prisma generate` + `prisma db push` completed
- Test runner: **vitest** (same as unit tests)

## Test Strategy

Run the same logical tests against both storage backends to verify parity:

```typescript
import { InMemoryStorage } from '../../src/storage/memory.js';
import { MongoStorage } from '../../src/storage/mongodb.js';

const backends = [
  { name: 'InMemory', factory: () => new InMemoryStorage() },
  { name: 'MongoDB', factory: () => MongoStorage.create(process.env.DATABASE_URL!) },
];

for (const { name, factory } of backends) {
  describe(`Storage: ${name}`, () => {
    let storage: Storage;
    beforeAll(async () => { storage = await factory(); });
    afterAll(async () => { /* cleanup */ });

    // All tests here run against both backends
  });
}
```

**Skip MongoDB tests when `DATABASE_URL` is not set:**

```typescript
const mongoAvailable = !!process.env.DATABASE_URL;
const describeMongo = mongoAvailable ? describe : describe.skip;
```

## Test Categories

### Category 1 — Owner CRUD

| # | Test | Assert |
|---|------|--------|
| 1 | Create owner | Returns owner with publicKey |
| 2 | Get owner by name | Matches created |
| 3 | List owners | Contains created owner |
| 4 | Delete owner (cascade) | Owner + all agents removed |
| 5 | Get deleted owner | Returns null |

### Category 2 — Agent CRUD

| # | Test | Assert |
|---|------|--------|
| 6 | Create agent | Returns agent with gaii, morselBalance |
| 7 | Get agent by gaii | Matches |
| 8 | Update agent fields | Updated values persisted |
| 9 | List agents by owner | Correct subset |
| 10 | Delete agent | Removed |

### Category 3 — Memory CRUD + TTL

| # | Test | Assert |
|---|------|--------|
| 11 | Set memory | Returns record with version 1 |
| 12 | Get memory | Value matches |
| 13 | Update memory (version increment) | Version 2 |
| 14 | List memory (prefix filter) | Correct subset |
| 15 | List memory (visibility filter) | Filters correctly |
| 16 | Delete memory | Returns true |
| 17 | Get deleted memory | Returns null |
| 18 | TTL expiration | Set with short TTL → `getMemory` returns null after expiry |

### Category 4 — Memory Quota Tracking

| # | Test | Assert |
|---|------|--------|
| 19 | `getMemoryUsageBytes` returns correct total | Matches sum of stored values |
| 20 | Usage updates on write/delete | Increments/decrements |

### Category 5 — Actions

| # | Test | Assert |
|---|------|--------|
| 21 | Create action | Persisted |
| 22 | List actions (search filter) | Text search works |
| 23 | List actions (category filter) | Category filter works |
| 24 | Update action | Fields updated |

### Category 6 — Work Lifecycle

| # | Test | Assert |
|---|------|--------|
| 25 | Create work item | Returns with trackingCode |
| 26 | Get work by tracking code | Matches |
| 27 | Update work status | Status changed |
| 28 | List work by provider | Correct subset |
| 29 | List work by requester | Correct subset |

### Category 7 — Transactions

| # | Test | Assert |
|---|------|--------|
| 30 | Record transaction | Persisted |
| 31 | List transactions for agent | Returns in order |
| 32 | List all transactions (admin) | Includes all |

### Category 8 — Boards + Posts

| # | Test | Assert |
|---|------|--------|
| 33 | Create board | Returns board record |
| 34 | List boards | Contains board |
| 35 | Create post | Returns post with ID |
| 36 | List posts (category filter) | Filtered correctly |
| 37 | List posts (TTL filter) | Expired posts excluded |
| 38 | Get single post | Matches |
| 39 | Reactions | Reaction counts updated |

### Category 9 — Storage Files

| # | Test | Assert |
|---|------|--------|
| 40 | Create file | Returns record with size |
| 41 | Get file (with data) | Binary data matches |
| 42 | List files | Contains file |
| 43 | Delete file | Removed |
| 44 | `getStorageUsageBytes` | Correct total |

### Category 10 — OTK + Node Key

| # | Test | Assert |
|---|------|--------|
| 45 | Store OTK | Persisted |
| 46 | Get OTK | Matches |
| 47 | Mark OTK used | `usedAt` set |
| 48 | Set/get node key | Keypair persisted |

### Category 11 — Disputes + Audit Log

| # | Test | Assert |
|---|------|--------|
| 49 | Create dispute | Returns dispute record |
| 50 | Get dispute by tracking code | Matches |
| 51 | Update dispute | Status changed |
| 52 | Append audit log | Entry persisted |
| 53 | Get full audit log | Returns chain |
| 54 | List all disputes (admin) | Contains dispute |

### Category 12 — Federation

| # | Test | Assert |
|---|------|--------|
| 55 | Create peering request | Persisted |
| 56 | Get peers | Returns array |

## Database Cleanup

Each test suite should use a unique prefix or clean up after itself:

```typescript
afterAll(async () => {
  // Delete all test data
  await prisma.owner.deleteMany({ where: { name: { startsWith: 'test-' } } });
  await prisma.$disconnect();
});
```

## CI Integration

```yaml
# GitHub Actions example
services:
  mongodb:
    image: mongo:7
    ports: ['27017:27017']
env:
  DATABASE_URL: mongodb://localhost:27017/aimeat-test
steps:
  - run: pnpm exec prisma generate && pnpm exec prisma db push
  - run: pnpm test -- --reporter=verbose test/integration/
```
