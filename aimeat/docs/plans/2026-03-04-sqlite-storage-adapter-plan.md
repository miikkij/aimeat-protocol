# SQLite Storage Adapter — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add SQLite storage adapter to AIMEAT via a Domain Repository Pattern refactor of the storage layer, enabling personal nodes to run without MongoDB.

**Architecture:** The monolithic `Storage` interface (192 methods, 1,728 lines) is split into 20 domain repository interfaces. A factory function selects the provider (memory/sqlite/mongodb). The composed `Storage` type remains as the public contract — zero route file changes.

**Tech Stack:** TypeScript 5.9.3, better-sqlite3, ESM (NodeNext), Express 5.2.1

**Design Doc:** `docs/plans/2026-03-04-sqlite-storage-adapter-design.md`

---

## Task 1: Install Dependencies

**Files:**
- Modify: `aimeat/package.json`

**Step 1: Install better-sqlite3 and types**

Run:
```bash
cd aimeat && pnpm add better-sqlite3 && pnpm add -D @types/better-sqlite3
```

Expected: `better-sqlite3` added to dependencies, `@types/better-sqlite3` to devDependencies.

**Step 2: Verify installation**

Run: `cd aimeat && pnpm ls better-sqlite3`
Expected: Shows version info

**Step 3: Commit**

```bash
git add aimeat/package.json aimeat/pnpm-lock.yaml
git commit -m "chore: add better-sqlite3 dependency for SQLite storage adapter"
```

---

## Task 2: Create Repository Interfaces

Extract method signatures from the `Storage` interface into 20 domain-specific repository interfaces. Each file exports a single interface. Record types stay in `interface.ts`.

**Files:**
- Create: `aimeat/src/storage/repositories/owner.repository.ts`
- Create: `aimeat/src/storage/repositories/agent.repository.ts`
- Create: `aimeat/src/storage/repositories/memory.repository.ts`
- Create: `aimeat/src/storage/repositories/action.repository.ts`
- Create: `aimeat/src/storage/repositories/work.repository.ts`
- Create: `aimeat/src/storage/repositories/wallet.repository.ts`
- Create: `aimeat/src/storage/repositories/board.repository.ts`
- Create: `aimeat/src/storage/repositories/otk.repository.ts`
- Create: `aimeat/src/storage/repositories/dispute.repository.ts`
- Create: `aimeat/src/storage/repositories/micro-memory.repository.ts`
- Create: `aimeat/src/storage/repositories/file.repository.ts`
- Create: `aimeat/src/storage/repositories/identity.repository.ts`
- Create: `aimeat/src/storage/repositories/schema.repository.ts`
- Create: `aimeat/src/storage/repositories/consent.repository.ts`
- Create: `aimeat/src/storage/repositories/catalogue.repository.ts`
- Create: `aimeat/src/storage/repositories/moderation.repository.ts`
- Create: `aimeat/src/storage/repositories/organism.repository.ts`
- Create: `aimeat/src/storage/repositories/marketplace.repository.ts`
- Create: `aimeat/src/storage/repositories/federation.repository.ts`
- Create: `aimeat/src/storage/repositories/node.repository.ts`
- Create: `aimeat/src/storage/repositories/index.ts`

**Step 1: Create repository interface files**

Each file follows this exact pattern:

```typescript
// src/storage/repositories/owner.repository.ts
import type { OwnerRecord } from '../interface.js';

export interface OwnerRepository {
  createOwner(owner: OwnerRecord): Promise<OwnerRecord>;
  getOwner(name: string): Promise<OwnerRecord | null>;
  listOwners(): Promise<OwnerRecord[]>;
  updateOwner(name: string, updates: Partial<OwnerRecord>): Promise<OwnerRecord | null>;
  deleteOwner(name: string): Promise<boolean>;
}
```

Method-to-repository mapping (extract from `interface.ts` lines 637-949):

| Repository | Methods |
|---|---|
| `OwnerRepository` | createOwner, getOwner, listOwners, updateOwner, deleteOwner |
| `AgentRepository` | createAgent, getAgent, getAgentsByOwner, updateAgent, deleteAgent, listAgents |
| `MemoryRepository` | setMemory, getMemory, listMemory, deleteMemory, deleteAllMemory, incrementMemoryFlagCount, searchMemory |
| `ActionRepository` | createAction, getAction, listActions, deleteAction, deleteActionsByProvider, listActionsByProvider, updateAction |
| `WorkRepository` | createWork, getWork, updateWork, listWorkByProvider, listWorkByRequester, listAllWork |
| `WalletRepository` | addTransaction, getTransactions, listAllTransactions, deleteTransactions |
| `BoardRepository` | createBoard, getBoard, listBoards, deleteBoard, createPost, getPost, listPosts, deletePost, addReaction, createBoardSubscription, getBoardSubscription, listBoardSubscriptions, listSubscriptionsByAgent, deleteBoardSubscription |
| `OtkRepository` | createOtk, getOtk, consumeOtk, listOtksBySession, expireSessionOtks |
| `DisputeRepository` | createDispute, getDispute, getDisputeByTrackingCode, updateDispute, addDisputeAuditEntry, getDisputeAuditLog, listDisputesByProvider, listAllDisputes |
| `MicroMemoryRepository` | setMicroMemory, getMicroMemory, listMicroMemorySets, deleteMicroMemory, deleteMicroMemoryEntry, findMicroMemoryByAccessCode |
| `FileRepository` | createStorageFile, getStorageFile, listStorageFiles, deleteStorageFile, createChunkedUpload, getChunkedUpload, addChunk, deleteChunkedUpload |
| `IdentityRepository` | createGHII, getGHII, getGHIIByOwner, updateGHII, getGHIIByEmailHash, listGHIIs, deleteGHII, createChatInstance, getChatInstance, listChatInstances, updateChatInstance, deleteChatInstance, createEmailVerification, getEmailVerification, getActiveEmailVerification, updateEmailVerification, deleteExpiredEmailVerifications, getEmailVerificationsByOwner? |
| `SchemaRepository` | setSchema, getSchema, deleteSchema, listSchemas, findApplicableSchema |
| `ConsentRepository` | createConsent, getConsent, listConsents, updateConsent, deleteConsent, findMatchingConsents, addConsentAuditEntry, listConsentAudit |
| `CatalogueRepository` | createCsm, getCsm, listCsms, updateCsm, deleteCsm, createMsm, getMsm, listMsms, updateMsm, deleteMsm |
| `ModerationRepository` | createFlag, getFlag, getFlagsByTarget, getFlagByUser, getFlagSummary, updateFlag, listFlags, createAppeal, getAppeal, getAppealByFlagId, listAppeals, updateAppeal, createMatch, getMatch, getMatchByPair, listMatchesByProfile, updateMatch, deleteExpiredMatches, listAllMatches |
| `OrganismRepository` | createOrganism, getOrganism, listOrganisms, updateOrganism, deleteOrganism, createMembership, getMembership, listMembers, listMembershipsByGhii, updateMembership, deleteMembership, createJoinRequest, getJoinRequest, listJoinRequests, updateJoinRequest, setOrganismReputation, getOrganismReputation |
| `MarketplaceRepository` | createListing, getListing, listListings, updateListing, deleteListing, createPurchase, getPurchase, listPurchasesByBuyer, listPurchasesBySeller, updatePurchase |
| `FederationRepository` | createPeeringRequest, getPeeringRequest, listPeeringRequests, updatePeeringRequest, createPersonalNode, getPersonalNode, getPersonalNodeByOwner, listPersonalNodes, updatePersonalNode, deletePersonalNode, createMailboxItem, getMailboxItem, listMailboxItems, deleteMailboxItem, deleteMailboxItemsByNode, getMailboxStats, cleanExpiredMailboxItems, createGenesisPeer, getGenesisPeer, getGenesisPeerByNodeId, listGenesisPeers, updateGenesisPeer, deleteGenesisPeer |
| `NodeRepository` | setNodeKey, getNodeKey, getMaintenanceMode, setMaintenanceMode, createPushSubscription, getPushSubscription, deletePushSubscription, listPushSubscriptions, createTrustedIssuer, getTrustedIssuer, getTrustedIssuerByUrl, listTrustedIssuers, deleteTrustedIssuer, createRealtimeRoom, getRealtimeRoom, listRealtimeRooms, updateRealtimeRoom, deleteRealtimeRoom, addSiteChangeLog, listSiteChangeLog, createExtension, getExtension, listExtensions, updateExtension, deleteExtension, createEscrowHold, getEscrowHold, listEscrowHolds, releaseEscrowHold, refundEscrowHold |

**Step 2: Create `repositories/index.ts`** — re-exports all interfaces:

```typescript
export type { OwnerRepository } from './owner.repository.js';
export type { AgentRepository } from './agent.repository.js';
// ... all 20
```

**Step 3: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS (new files are standalone, nothing imports them yet)

**Step 4: Commit**

```bash
git add aimeat/src/storage/repositories/
git commit -m "refactor: extract Storage interface into 20 domain repository interfaces"
```

---

## Task 3: Refactor Storage Interface

Make `Storage` a composed type that extends all domain repositories. Keep all record types in place.

**Files:**
- Modify: `aimeat/src/storage/interface.ts`

**Step 1: Add imports and replace Storage interface**

At the bottom of `interface.ts`, replace the `export interface Storage { ... }` block (lines 637-949) with:

```typescript
import type { OwnerRepository } from './repositories/owner.repository.js';
import type { AgentRepository } from './repositories/agent.repository.js';
import type { MemoryRepository } from './repositories/memory.repository.js';
import type { ActionRepository } from './repositories/action.repository.js';
import type { WorkRepository } from './repositories/work.repository.js';
import type { WalletRepository } from './repositories/wallet.repository.js';
import type { BoardRepository } from './repositories/board.repository.js';
import type { OtkRepository } from './repositories/otk.repository.js';
import type { DisputeRepository } from './repositories/dispute.repository.js';
import type { MicroMemoryRepository } from './repositories/micro-memory.repository.js';
import type { FileRepository } from './repositories/file.repository.js';
import type { IdentityRepository } from './repositories/identity.repository.js';
import type { SchemaRepository } from './repositories/schema.repository.js';
import type { ConsentRepository } from './repositories/consent.repository.js';
import type { CatalogueRepository } from './repositories/catalogue.repository.js';
import type { ModerationRepository } from './repositories/moderation.repository.js';
import type { OrganismRepository } from './repositories/organism.repository.js';
import type { MarketplaceRepository } from './repositories/marketplace.repository.js';
import type { FederationRepository } from './repositories/federation.repository.js';
import type { NodeRepository } from './repositories/node.repository.js';

export interface Storage extends
  OwnerRepository, AgentRepository, MemoryRepository,
  ActionRepository, WorkRepository, WalletRepository,
  BoardRepository, OtkRepository, DisputeRepository,
  MicroMemoryRepository, FileRepository, IdentityRepository,
  SchemaRepository, ConsentRepository, CatalogueRepository,
  ModerationRepository, OrganismRepository, MarketplaceRepository,
  FederationRepository, NodeRepository {}
```

**Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS — the composed type must be identical to the old inline interface. If it fails, a method was misplaced or misspelled in a repository interface. Fix until it passes.

**Step 3: Commit**

```bash
git add aimeat/src/storage/interface.ts
git commit -m "refactor: compose Storage from domain repository interfaces"
```

---

## Task 4: Create Storage Factory

**Files:**
- Create: `aimeat/src/storage/storage-factory.ts`

**Step 1: Write the factory**

```typescript
// src/storage/storage-factory.ts
import type { Storage } from './interface.js';

export type StorageProvider = 'memory' | 'sqlite' | 'mongodb';

export interface StorageOptions {
  provider: StorageProvider;
  sqlitePath?: string;
  dbUrl?: string;
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

**Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: FAIL — `providers/sqlite/index.js` and `providers/memory/index.js` don't exist yet. That's expected. Will resolve in Tasks 5-8.

**Step 3: Commit**

```bash
git add aimeat/src/storage/storage-factory.ts
git commit -m "feat: add storage factory for provider selection (memory/sqlite/mongodb)"
```

---

## Task 5: Move InMemoryStorage to providers/memory/

**Files:**
- Move: `aimeat/src/storage/memory.ts` → `aimeat/src/storage/providers/memory/index.ts`
- Modify: All files that import from `./storage/memory.js` or `../storage/memory.js`

**Step 1: Create directory and move file**

```bash
mkdir -p aimeat/src/storage/providers/memory
mv aimeat/src/storage/memory.ts aimeat/src/storage/providers/memory/index.ts
```

**Step 2: Fix import path in the moved file**

The moved file imports from `./interface.js` — update to `../../interface.js`:

```typescript
// Old:
import type { ... } from './interface.js';
// New:
import type { ... } from '../../interface.js';
```

**Step 3: Fix all consumer imports**

Search for all files importing from `./storage/memory.js` or `../storage/memory.js`:

Key consumers:
- `src/server.ts` line 6: `import { InMemoryStorage } from './storage/memory.js'` → `'./storage/providers/memory/index.js'`
- `src/index.ts` line 169: `const { InMemoryStorage } = await import('./storage/memory.js')` → `'./storage/providers/memory/index.js'`

Run: `grep -rn "storage/memory" aimeat/src/ --include="*.ts"` to find all occurrences and update each one.

**Step 4: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS (or close — fix any remaining import issues)

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move InMemoryStorage to providers/memory/ directory"
```

---

## Task 6: Move MongoStorage to providers/mongodb/

**Files:**
- Move: `aimeat/src/storage/mongodb.ts` → `aimeat/src/storage/providers/mongodb/index.ts`
- Modify: All files that import from `./storage/mongodb.js` or `../storage/mongodb.js`

**Step 1: Create directory and move file**

```bash
mkdir -p aimeat/src/storage/providers/mongodb
mv aimeat/src/storage/mongodb.ts aimeat/src/storage/providers/mongodb/index.ts
```

**Step 2: Fix import path in the moved file**

Update `import type { ... } from './interface.js'` → `'../../interface.js'`

**Step 3: Fix all consumer imports**

Key consumers:
- `src/server.ts`: `import('./storage/mongodb.js')` → `'./storage/providers/mongodb/index.js'`
- `src/index.ts` line 163: same pattern

Run: `grep -rn "storage/mongodb" aimeat/src/ --include="*.ts"` to find all occurrences.

**Step 4: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move MongoStorage to providers/mongodb/ directory"
```

---

## Task 7: Create SQLite Schema

**Files:**
- Create: `aimeat/src/storage/providers/sqlite/schema.ts`

**Step 1: Write all CREATE TABLE statements**

Create `schema.ts` that exports a function `initializeSchema(db: Database)` which runs all `CREATE TABLE IF NOT EXISTS` statements. Tables must map to all record types in `interface.ts`.

The schema covers all 30+ entity types. Key design rules:
- String IDs → `TEXT PRIMARY KEY`
- Composite keys → `PRIMARY KEY (col1, col2)`
- JSON/object/array fields → `TEXT` (JSON serialized)
- Buffer → `BLOB`
- Timestamps → `TEXT` (ISO strings)
- Boolean → `INTEGER` (0/1)
- Numbers → `INTEGER` or `REAL`

**Tables to create (with primary keys):**

```sql
-- Owners
CREATE TABLE IF NOT EXISTS owners (
  name TEXT PRIMARY KEY,
  displayName TEXT,
  publicKey TEXT NOT NULL,
  roles TEXT NOT NULL,          -- JSON array
  createdAt TEXT NOT NULL
);

-- Agents
CREATE TABLE IF NOT EXISTS agents (
  gaii TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner TEXT NOT NULL,
  displayName TEXT,
  description TEXT,
  capabilities TEXT NOT NULL,  -- JSON array
  publicKey TEXT NOT NULL,
  trustScore REAL NOT NULL DEFAULT 0,
  morselBalance REAL NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  lastSeen TEXT NOT NULL,
  semantic TEXT                 -- JSON
);

-- Memory
CREATE TABLE IF NOT EXISTS memory (
  ownerGaii TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,         -- JSON
  visibility TEXT NOT NULL DEFAULT 'private',
  tags TEXT NOT NULL,          -- JSON array
  ttlHours REAL,
  version INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  flagCount INTEGER DEFAULT 0,
  PRIMARY KEY (ownerGaii, key)
);

-- ... continue for ALL entity types
```

Also include indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner);
CREATE INDEX IF NOT EXISTS idx_memory_ownerGaii ON memory(ownerGaii);
CREATE INDEX IF NOT EXISTS idx_work_providerGaii ON work(providerGaii);
CREATE INDEX IF NOT EXISTS idx_work_requesterGaii ON work(requesterGaii);
CREATE INDEX IF NOT EXISTS idx_transactions_gaii ON wallet_transactions(gaii);
CREATE INDEX IF NOT EXISTS idx_posts_boardId ON board_posts(boardId);
CREATE INDEX IF NOT EXISTS idx_ghii_ownerName ON ghiis(ownerName);
CREATE INDEX IF NOT EXISTS idx_ghii_emailHash ON ghiis(emailHash);
-- ... indexes for all common query patterns
```

Full table list (30+ tables):
`owners`, `agents`, `memory`, `actions`, `work`, `wallet_transactions`, `boards`, `board_posts`, `board_subscriptions`, `otks`, `disputes`, `dispute_audit`, `micro_memory`, `storage_files`, `peering_requests`, `ghiis`, `chat_instances`, `email_verifications`, `personal_nodes`, `mailbox_items`, `schemas`, `consents`, `consent_audit`, `csms`, `msms`, `flags`, `matches`, `organisms`, `organism_memberships`, `join_requests`, `appeals`, `listings`, `purchases`, `push_subscriptions`, `trusted_issuers`, `genesis_peers`, `organism_reputations`, `realtime_rooms`, `site_changelog`, `extensions`, `escrow_holds`, `node_key`, `maintenance`

**Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS (schema.ts is standalone)

**Step 3: Commit**

```bash
git add aimeat/src/storage/providers/sqlite/schema.ts
git commit -m "feat: add SQLite schema definitions for all storage entities"
```

---

## Task 8: Implement SqliteStorage

This is the largest task. Implement all 192 methods of the `Storage` interface using `better-sqlite3`.

**Files:**
- Create: `aimeat/src/storage/providers/sqlite/index.ts`

**Step 1: Write the SqliteStorage class**

Structure:

```typescript
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Storage, OwnerRecord, AgentRecord, /* ... all record types */ } from '../../interface.js';
import { initializeSchema } from './schema.js';

export class SqliteStorage implements Storage {
  private db: Database.Database;
  private chunkedUploads = new Map<string, ChunkedUploadRecord>(); // transient, same as MongoDB

  constructor(dbPath: string) {
    // Auto-create parent directory
    mkdirSync(dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);

    // Enable WAL mode for concurrent read performance
    this.db.pragma('journal_mode = WAL');
    // Set busy timeout for concurrent access
    this.db.pragma('busy_timeout = 5000');
    // Enable foreign keys (for future use)
    this.db.pragma('foreign_keys = ON');

    // Create all tables and indexes
    initializeSchema(this.db);
  }

  // ... all 192 methods
}
```

**Implementation patterns for each method type:**

**Create methods** — INSERT with all columns:
```typescript
async createOwner(owner: OwnerRecord): Promise<OwnerRecord> {
  try {
    this.db.prepare(`
      INSERT INTO owners (name, displayName, publicKey, roles, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `).run(owner.name, owner.displayName ?? null, owner.publicKey, JSON.stringify(owner.roles), owner.createdAt);
    return owner;
  } catch (err: any) {
    if (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') throw new Error('NAME_TAKEN');
    throw err;
  }
}
```

**Get methods** — SELECT + deserialize:
```typescript
async getOwner(name: string): Promise<OwnerRecord | null> {
  const row = this.db.prepare('SELECT * FROM owners WHERE name = ?').get(name) as any;
  return row ? this.toOwnerRecord(row) : null;
}

private toOwnerRecord(row: any): OwnerRecord {
  return {
    name: row.name,
    displayName: row.displayName ?? undefined,
    publicKey: row.publicKey,
    roles: JSON.parse(row.roles),
    createdAt: row.createdAt,
  };
}
```

**List methods** — SELECT with optional filters:
```typescript
async listOwners(): Promise<OwnerRecord[]> {
  const rows = this.db.prepare('SELECT * FROM owners').all() as any[];
  return rows.map(r => this.toOwnerRecord(r));
}
```

**Update methods** — build SET clause dynamically:
```typescript
async updateOwner(name: string, updates: Partial<OwnerRecord>): Promise<OwnerRecord | null> {
  const existing = await this.getOwner(name);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  this.db.prepare(`
    UPDATE owners SET displayName = ?, publicKey = ?, roles = ?, createdAt = ?
    WHERE name = ?
  `).run(updated.displayName ?? null, updated.publicKey, JSON.stringify(updated.roles), updated.createdAt, name);
  return updated;
}
```

**Delete methods** — DELETE:
```typescript
async deleteOwner(name: string): Promise<boolean> {
  const result = this.db.prepare('DELETE FROM owners WHERE name = ?').run(name);
  return result.changes > 0;
}
```

**Key behaviors to match from InMemoryStorage:**

1. `deleteOwner()` — cascade: also delete agents, memory, boards, work, transactions, etc. (match in-memory behavior by checking what the E2E tests expect)
2. `consumeOtk()` — grace period logic with `usedAt` timestamp
3. `searchMemory()` — case-insensitive search across key, value, tags
4. `findApplicableSchema()` — check exact match first, then prefix match
5. `findMatchingConsents()` — glob pattern matching on `dataPattern`
6. `addReaction()` — JSON update of reactions field
7. `listPosts()` — cursor-based pagination
8. `setMemory()` — upsert (INSERT OR REPLACE) with version increment
9. `incrementMemoryFlagCount()` — atomic UPDATE
10. `getEmailVerificationsByOwner()` — optional method (marked with `?` in interface)
11. `StorageFileRecord.data` — Buffer stored as BLOB
12. `ChunkedUploadRecord` — kept in-memory Map (transient)
13. `MaintenanceState` — single-row table pattern

**Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS — all 192 methods implemented, all types correct.

**Step 3: Commit**

```bash
git add aimeat/src/storage/providers/sqlite/index.ts
git commit -m "feat: implement SqliteStorage with all 192 Storage interface methods"
```

---

## Task 9: Config Changes

**Files:**
- Modify: `aimeat/src/config.ts`

**Step 1: Add storage fields to AimeatConfig**

Add to the `AimeatConfig` interface (after `dbUrl` line):

```typescript
storageProvider: 'memory' | 'sqlite' | 'mongodb';
sqlitePath: string;
```

**Step 2: Add to loadConfig()**

Add in the return object (after the `dbUrl` line):

```typescript
storageProvider: (process.env.AIMEAT_STORAGE ?? 'memory') as 'memory' | 'sqlite' | 'mongodb',
sqlitePath: process.env.AIMEAT_SQLITE_PATH ?? './data/aimeat.db',
```

**Step 3: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add aimeat/src/config.ts
git commit -m "feat: add AIMEAT_STORAGE and AIMEAT_SQLITE_PATH config options"
```

---

## Task 10: Integration — server.ts and index.ts

Replace the if/else storage selection with the factory.

**Files:**
- Modify: `aimeat/src/server.ts`
- Modify: `aimeat/src/index.ts`

**Step 1: Update server.ts**

Replace lines 177-188 (the storage selection block):

```typescript
// Old:
let storage: Storage;
if (config.dbUrl) {
  const { MongoStorage } = await import('./storage/mongodb.js');
  const mongo = new MongoStorage(config.dbUrl);
  await mongo.ready;
  storage = mongo;
  logger.info('Using MongoDB storage', { url: config.dbUrl.replace(/\/\/.*@/, '//<credentials>@') });
} else {
  storage = new InMemoryStorage();
  logger.info('Using in-memory storage (data will not persist across restarts)');
}

// New:
import { createStorage } from './storage/storage-factory.js';

const storage = await createStorage({
  provider: config.storageProvider,
  sqlitePath: config.sqlitePath,
  dbUrl: config.dbUrl ?? undefined,
});

const storageLabels: Record<string, string> = {
  memory: 'in-memory (data will not persist across restarts)',
  sqlite: `SQLite (${config.sqlitePath})`,
  mongodb: `MongoDB (${config.dbUrl?.replace(/\/\/.*@/, '//<credentials>@') ?? 'no URL'})`,
};
logger.info(`Using ${storageLabels[config.storageProvider]} storage`);
```

Also remove the unused `InMemoryStorage` import from line 6 of server.ts.

**Step 2: Update index.ts maintenance subcommand**

Replace lines 161-170 (maintenance storage selection):

```typescript
// Old:
let storage;
if (config.dbUrl) {
  const { MongoStorage } = await import('./storage/mongodb.js');
  const mongo = new MongoStorage(config.dbUrl);
  await mongo.ready;
  storage = mongo;
} else {
  const { InMemoryStorage } = await import('./storage/memory.js');
  storage = new InMemoryStorage();
}

// New:
const { createStorage } = await import('./storage/storage-factory.js');
const storage = await createStorage({
  provider: config.storageProvider,
  sqlitePath: config.sqlitePath,
  dbUrl: config.dbUrl ?? undefined,
});
```

**Step 3: Update startup banner in index.ts**

Line 282 currently shows: `Storage:   ${config.dbUrl ? 'mongodb' : 'in-memory'}`

Change to: `Storage:   ${config.storageProvider}`

**Step 4: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add aimeat/src/server.ts aimeat/src/index.ts
git commit -m "feat: integrate storage factory into server and CLI startup"
```

---

## Task 11: Init Wizard Updates

**Files:**
- Modify: `aimeat/src/cli/init-wizard.ts`
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

**Step 1: Add translations**

In `en.json`, under the `"init"` section, add:

```json
"storage_label": "Storage backend",
"storage_hint": "Where to store data",
"storage_memory": "In-memory (development only, data lost on restart)",
"storage_sqlite": "SQLite (personal use, zero-config file-based storage)",
"storage_mongodb": "MongoDB (production, requires external server)",
"sqlite_path_label": "SQLite database path",
"sqlite_path_hint": "File path for the SQLite database (auto-created)"
```

Add equivalent Finnish translations to `fi.json`.

**Step 2: Add storage selection to askCoreSettings()**

After the node ID and port prompts, before the MongoDB URL prompt, add a storage backend selection:

```typescript
const storageBackend = await p.select({
  message: t('init.storage_label'),
  options: [
    { value: 'memory', label: t('init.storage_memory') },
    { value: 'sqlite', label: t('init.storage_sqlite') },
    { value: 'mongodb', label: t('init.storage_mongodb') },
  ],
  initialValue: useCase === 'dev' ? 'memory' : useCase === 'personal' ? 'sqlite' : 'mongodb',
});
if (p.isCancel(storageBackend)) process.exit(0);
env.AIMEAT_STORAGE = storageBackend as string;
```

If `sqlite` is selected, prompt for path:

```typescript
if (storageBackend === 'sqlite') {
  const sqlitePath = await p.text({
    message: t('init.sqlite_path_label'),
    placeholder: './data/aimeat.db',
    defaultValue: './data/aimeat.db',
    validate: (v) => v.trim() === '' ? t('init.required') : undefined,
  });
  if (p.isCancel(sqlitePath)) process.exit(0);
  env.AIMEAT_SQLITE_PATH = sqlitePath as string;
}
```

If `mongodb` is selected, show the existing DATABASE_URL prompt. If `memory` is selected, skip both.

**Step 3: Add AIMEAT_STORAGE and AIMEAT_SQLITE_PATH to CONFIG_DEFAULTS**

```typescript
['AIMEAT_STORAGE', 'memory'],
['AIMEAT_SQLITE_PATH', './data/aimeat.db'],
```

**Step 4: Add to env file generation**

In `generateEnvContent()`, add the storage section:

```typescript
lines.push('# ── Storage Backend ────────────────────────────────────────');
lines.push(`AIMEAT_STORAGE="${env.AIMEAT_STORAGE ?? 'memory'}"`);
if (env.AIMEAT_STORAGE === 'sqlite') {
  lines.push(`AIMEAT_SQLITE_PATH="${env.AIMEAT_SQLITE_PATH ?? './data/aimeat.db'}"`);
}
```

**Step 5: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 6: Commit**

```bash
git add aimeat/src/cli/init-wizard.ts aimeat/locales/en.json aimeat/locales/fi.json
git commit -m "feat: add storage backend selection to init wizard (memory/sqlite/mongodb)"
```

---

## Task 12: Env Config Display + Validator

**Files:**
- Modify: `aimeat/src/utils/env-config.ts`
- Modify: `aimeat/src/utils/env-validator.ts`

**Step 1: Add storage section to env-config.ts**

In the `formatConfig()` function, modify the existing "Database" section to become "Storage":

```typescript
// Replace the Database section with:
section('Storage');
entry('AIMEAT_STORAGE', config.storageProvider, 'memory', 'Storage backend (memory | sqlite | mongodb)');
if (config.storageProvider === 'sqlite') {
  entry('AIMEAT_SQLITE_PATH', config.sqlitePath, './data/aimeat.db', 'SQLite database file path');
}
if (config.storageProvider === 'mongodb') {
  entry('DATABASE_URL', config.dbUrl ? maskUrl(config.dbUrl) : '(not set)', null, 'MongoDB connection URL');
}
```

**Step 2: Add validations to env-validator.ts**

Add validation for `AIMEAT_STORAGE`:

```typescript
// Validate AIMEAT_STORAGE
const storageProvider = process.env.AIMEAT_STORAGE;
if (storageProvider && !['memory', 'sqlite', 'mongodb'].includes(storageProvider)) {
  results.push({ level: 'error', variable: 'AIMEAT_STORAGE', message: `Invalid value "${storageProvider}". Must be one of: memory, sqlite, mongodb` });
}

// Warn if mongodb selected without DATABASE_URL
if (storageProvider === 'mongodb' && !process.env.DATABASE_URL) {
  results.push({ level: 'error', variable: 'DATABASE_URL', message: 'Required when AIMEAT_STORAGE=mongodb' });
}

// Info if sqlite selected
if (storageProvider === 'sqlite') {
  const sqlitePath = process.env.AIMEAT_SQLITE_PATH ?? './data/aimeat.db';
  results.push({ level: 'info', variable: 'AIMEAT_SQLITE_PATH', message: `Database file: ${sqlitePath}` });
}
```

**Step 3: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add aimeat/src/utils/env-config.ts aimeat/src/utils/env-validator.ts
git commit -m "feat: add storage provider to config display and env validation"
```

---

## Task 13: .env.example Updates

**Files:**
- Modify: `aimeat/.env.example`

**Step 1: Update the Database section**

Replace the existing database section (lines 11-13):

```bash
# ── Storage Backend ───────────────────────────────────────────
# Choose storage: memory (default, data lost on restart), sqlite (file-based, zero-config), mongodb (production)
# AIMEAT_STORAGE="memory"

# SQLite — file path for the database (auto-created on first run)
# AIMEAT_SQLITE_PATH="./data/aimeat.db"

# MongoDB — required when AIMEAT_STORAGE=mongodb
# DATABASE_URL="mongodb://user:pass@localhost:27017/AIMEAT?replicaSet=rs0&authSource=admin"
```

**Step 2: Commit**

```bash
git add aimeat/.env.example
git commit -m "docs: add AIMEAT_STORAGE and AIMEAT_SQLITE_PATH to .env.example"
```

---

## Task 14: Type Check — Full Build Verification

**Files:** None (verification only)

**Step 1: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS with zero errors

**Step 2: Run build**

Run: `cd aimeat && pnpm build`
Expected: PASS — dist/ generated successfully

If either fails, fix the issues and re-run until both pass.

---

## Task 15: E2E Tests — In-Memory Regression

Verify the refactoring didn't break the existing in-memory adapter.

**Step 1: Start test server with in-memory storage**

```bash
cd aimeat && AIMEAT_STORAGE=memory AIMEAT_PORT=40251 AIMEAT_ANONYMOUS=true AIMEAT_DEV_MODE=true pnpm dev &
```

Wait for "AIMEAT node started" in output.

**Step 2: Run E2E tests**

Run: `cd aimeat && npx tsx test/api-full.ts`
Expected: All 396+ tests PASS

**Step 3: Stop test server**

Kill the dev server process.

If tests fail, debug and fix. The refactoring should be purely structural — no behavior changes for in-memory.

---

## Task 16: E2E Tests — SQLite

Verify the new SQLite adapter passes all tests.

**Step 1: Start test server with SQLite storage**

```bash
cd aimeat && AIMEAT_STORAGE=sqlite AIMEAT_SQLITE_PATH=./data/test-e2e.db AIMEAT_PORT=40251 AIMEAT_ANONYMOUS=true AIMEAT_DEV_MODE=true pnpm dev &
```

Wait for "AIMEAT node started" in output. Confirm log says "Using SQLite" storage.

**Step 2: Run E2E tests**

Run: `cd aimeat && npx tsx test/api-full.ts`
Expected: All 396+ tests PASS

**Step 3: Clean up**

- Kill the dev server
- Delete `./data/test-e2e.db` test database

If tests fail, debug the SQLite adapter. Common issues:
- JSON serialization/deserialization mismatches
- Missing columns in INSERT statements
- Case sensitivity in string comparisons
- Cascade delete not deleting all related records
- UPSERT behavior differences (INSERT OR REPLACE vs INSERT)
- Buffer/BLOB handling for storage files
- Optional method `getEmailVerificationsByOwner?` not implemented

---

## Task 17: Final Commit

**Step 1: Verify git status**

Run: `git status`
Expected: Clean working tree (all changes committed in previous tasks)

If there are uncommitted changes, commit them with an appropriate message.

**Step 2: Verify branch**

Run: `git log --oneline -10`
Expected: ~12-15 commits representing the full implementation.

---

## Summary of Commits

1. `chore: add better-sqlite3 dependency`
2. `refactor: extract Storage into 20 domain repository interfaces`
3. `refactor: compose Storage from domain repository interfaces`
4. `feat: add storage factory for provider selection`
5. `refactor: move InMemoryStorage to providers/memory/`
6. `refactor: move MongoStorage to providers/mongodb/`
7. `feat: add SQLite schema definitions`
8. `feat: implement SqliteStorage with all 192 methods`
9. `feat: add AIMEAT_STORAGE and AIMEAT_SQLITE_PATH config`
10. `feat: integrate storage factory into server and CLI`
11. `feat: add storage selection to init wizard`
12. `feat: add storage provider to config display and validation`
13. `docs: update .env.example with storage options`

## Risk Mitigation

- **MongoDB unaffected:** MongoStorage is moved to a new directory but code is unchanged. Same Prisma queries, same behavior.
- **In-memory regression:** Task 15 runs all existing tests against in-memory to verify the refactoring.
- **SQLite validation:** Task 16 runs the full E2E suite against SQLite.
- **Type safety:** `npx tsc --noEmit` is run after every task. The composed `Storage` type ensures all providers implement every method.
- **ChunkedUploads:** Kept in-memory (transient) in all providers — not a regression risk.
