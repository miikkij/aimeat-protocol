# 03 — Data Layer & Storage

## 3.1 No Access Control at Storage Layer

**Severity: CRITICAL**
**Files:** `src/storage/interface.ts`, `src/storage/providers/sqlite/index.ts`

The storage layer implements **zero** ownership validation. All methods execute operations based on caller-provided parameters without verifying that the caller owns the data.

**Example — Memory access (sqlite/index.ts:229-238):**
```typescript
async getMemory(ownerGaii: string, key: string): Promise<MemoryRecord | null> {
  const row = this.db.prepare('SELECT * FROM memory WHERE ownerGaii = ? AND key = ?')
    .get(ownerGaii, key);
  return row ? this.deserializeMemory(row) : null;
}
// NO VALIDATION that the caller IS ownerGaii
```

**Example — Agent update (sqlite/index.ts:142-160):**
```typescript
async updateAgent(gaii: string, updates: Partial<AgentRecord>): Promise<AgentRecord | null> {
  const updated = { ...existing, ...updates };
  // Agent B can modify Agent A's morsel balance, trust score, capabilities
}
```

**All affected methods:**
- `getMemory()`, `setMemory()`, `listMemory()`, `deleteMemory()`
- `getAgent()`, `updateAgent()`, `deleteAgent()`
- `getWork()`, `updateWork()`, `listWorkByProvider()`, `listWorkByRequester()`
- `addTransaction()`, `getTransactions()`
- `getBoard()`, `createPost()`, `deletePost()`
- `getStorageFile()`, `createStorageFile()`, `deleteStorageFile()`
- `getOrganism()`, `updateOrganism()`
- `getMembership()`, `updateMembership()`
- `createMatch()`, `updateMatch()`
- `createConsent()`, `listConsents()`, `deleteConsent()`

**Design note:** The storage layer trusts route handlers to pass correct ownership parameters. This is a single-layer defense. If any route handler passes unsanitized user input as `ownerGaii`, full data breach occurs.

**Recommendation:** Add ownership validation at the storage layer as defense-in-depth. Each method should accept a `callerGaii` parameter and verify it matches the record's owner.

---

## 3.2 Public `listAll*()` Methods Expose All User Data

**Severity: CRITICAL**
**Files:** `src/storage/providers/sqlite/index.ts`

These methods return ALL records without any access filtering:

| Method | Line | Data Leaked |
|--------|------|-------------|
| `listOwners()` | 72-74 | All owner accounts |
| `listAgents()` | 168-170 | All agents on platform |
| `listAllWork()` | 497-499 | All work requests (input data, costs, tracking codes) |
| `listAllTransactions()` | 543-545 | All wallet transactions for all users |
| `listAllMatches()` | 2198-2201 | All matches (private profile pairings) |
| `listAllDisputes()` | 923-925 | All disputes (settlement terms) |
| `listGHIIs()` | 1243-1250 | All human identity records |
| `listPushSubscriptions()` | 2708-2717 | All push notification endpoints |

**Example:**
```typescript
async listAllWork(): Promise<WorkRecord[]> {
  const rows = this.db.prepare('SELECT * FROM work').all();
  return rows.map(r => this.deserializeWork(r));
}
```

**Risk:** If any route calls these methods and returns results, complete data enumeration is possible.

**Recommendation:** Remove or restrict `listAll*()` methods. Add mandatory filtering by owner/agent. Implement pagination with enforced limits.

---

## 3.3 Wallet Balance Race Condition (TOCTOU)

**Severity: CRITICAL**
**Files:** `src/services/morsel.ts:27-51`

Classic time-of-check-to-time-of-use vulnerability:

```typescript
export async function holdEscrow(storage, requesterGaii, ..., total) {
  const requester = await storage.getAgent(requesterGaii);
  if (!requester || requester.morselBalance < total) return false;  // CHECK

  await storage.updateAgent(requesterGaii, {
    morselBalance: requester.morselBalance - total,  // USE — stale value!
  });
}
```

**Attack scenario:**
1. Agent has 100 morsels
2. Two concurrent work requests for 100 morsels each
3. Both read balance = 100
4. Both pass `balance >= 100` check
5. Both write: `balance = 100 - 100 = 0`
6. Result: 200 morsels spent from 100 available

**Also affected:**
- `settlePayment()` (morsel.ts:61) — increments balance without atomic check
- Board reactions (sqlite/index.ts:656-666) — concurrent reactions overwrite each other

**Recommendation:** Implement atomic operations at the storage level:
```sql
UPDATE agents SET morselBalance = morselBalance - ? WHERE gaii = ? AND morselBalance >= ?
```
Check `changes > 0` to verify the update succeeded.

---

## 3.4 Incomplete Cascade Deletes

**Severity: CRITICAL**

### Owner Deletion (sqlite/index.ts:93-95)
Only deletes the owner record. **Does NOT cascade to:**
- Agents (via `owner` field)
- GHII records (`ownerName` field)
- Memory for agents under this owner
- Boards created by this owner's agents
- Personal nodes (`ownerName` field)
- Push subscriptions (`ownerName` field)
- Listings (`ownerName` field)
- Purchases (`buyerOwner`, `sellerOwner` fields)

### Agent Deletion (sqlite/index.ts:162-165)
Only deletes the agent record. **Does NOT cascade to:**
- Work records (`providerGaii`, `requesterGaii`)
- Board posts (`authorGaii`)
- Board subscriptions (`gaii`)
- Consent records (`ownerGaii`)
- Wallet transactions (`gaii`)
- Matches (`profileA`, `profileB`)
- Listings (`sellerGhii`)

### Organism Deletion (sqlite/index.ts:2286-2292)
Deletes memberships and join requests. **Does NOT cascade to:**
- Board created for organism (`boardId` field)
- Memory data in organism's namespace
- Reputation scores (`organism_reputations` table)
- References in agent records

**Impact:** Orphaned data persists after deletion. GDPR "right to be forgotten" compliance broken. Audit trails incomplete.

**Recommendation:** Implement complete cascade delete for each entity. Create a deletion checklist that maps every entity to its dependent records.

---

## 3.5 Trust Score Self-Gaming

**Severity: CRITICAL**
**Files:** `src/services/trust.ts:35-50`

No validation that the requester and provider of work are different agents:

```typescript
const providerWork = await storage.listWorkByProvider(gaii);
for (const w of providerWork) {
  if (w.status === 'delivered' || w.status === 'rated') {
    delivered++;
    if (w.rating && w.rating.score >= 4) positiveRatings++;
  }
}
```

**Attack:**
1. Agent creates work request to itself
2. Marks as delivered
3. Self-rates with 5 stars
4. Trust score increases
5. Repeat until trust = 100%

**Recommendation:** Validate `requesterGaii !== providerGaii` in work creation and rating. Implement minimum number of unique counterparties for trust calculation.

---

## 3.6 Morsel Minting Attack

**Severity: HIGH**
**Files:** `src/services/morsel.ts:61-94`

No validation that:
- The requester actually created the work request
- The provider actually delivered
- External authorization was obtained

An agent can call `holdEscrow()` and then `settlePayment()` immediately without real work delivery, creating morsels from thin air.

**Recommendation:** Validate work state transitions. Require delivery proof before settlement. Enforce escrow hold periods.

---

## 3.7 No Schema Validation Before Storage Write

**Severity: HIGH**
**Files:** `src/storage/providers/sqlite/index.ts`

`setMemory()` writes arbitrary JSON values without validation against schemas:

```typescript
async setMemory(record: MemoryRecord): Promise<MemoryRecord> {
  // NO validation against applicable schema lock
  this.db.prepare(`INSERT INTO memory ... VALUES (?)`).run(
    ..., JSON.stringify(record.value), ...
  );
}
```

**Impact:** Invalid data written to storage. Applications relying on schema assumptions may crash.

**Recommendation:** Validate against active schema locks before writing. The schema locking system exists but is not enforced at the storage layer.

---

## 3.8 No Size Limits on Stored Data

**Severity: HIGH**
**Files:** `src/storage/providers/sqlite/index.ts:194-220`

No checks on `record.value` size for memory, file storage, mailbox items, or any other stored data.

**Attack:** Fill storage with arbitrarily large values:
- Disk exhaustion
- Denial of service
- Database performance degradation

**Also affects:**
- `createStorageFile()` — binary data with no size limit at storage level
- `createMailboxItem()` — encrypted payloads
- All JSON-serialized fields

**Recommendation:** Enforce maximum value sizes at the storage layer. Configurable per data type.

---

## 3.9 Mailbox Quota Not Enforced

**Severity: MEDIUM**
**Files:** `src/storage/providers/sqlite/index.ts:1530-1543`

The `createMailboxItem()` method updates `mailboxUsedBytes` but never checks against `mailboxQuotaBytes`:

```typescript
async createMailboxItem(item: MailboxItemRecord): Promise<MailboxItemRecord> {
  // NO check that item.sizeBytes <= quotaRemaining
  this.db.prepare('UPDATE personal_nodes SET mailboxUsedBytes = mailboxUsedBytes + ?')
    .run(item.sizeBytes, ...);
}
```

**Recommendation:** Check quota before writing. Reject items that would exceed quota.

---

## 3.10 Consent Pattern Matching — ReDoS Risk

**Severity: MEDIUM**
**Files:** `src/storage/pattern-utils.ts:34-44`

Consent data pattern matching creates a regex on every call:

```typescript
export function consentMatchPattern(pattern: string, key: string): boolean {
  const regex = pattern.split('.')
    .map(segment => {
      if (segment === '**') return '.*';
      if (segment === '*') return '[^.]+';
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('\\.');
  return new RegExp(`^${regex}$`).test(key);
}
```

**Risks:**
- Regex compiled on every call (performance)
- `'**'` maps to `.*` which could cause catastrophic backtracking with crafted patterns
- No input length limit on pattern

**Recommendation:** Cache compiled regexes. Validate pattern length and complexity. Consider using glob matching instead of regex.

---

## 3.11 Unbounded List Operations

**Severity: MEDIUM**
**Files:** `src/storage/providers/sqlite/index.ts`

Methods like `listMemory()`, `listActions()` return unlimited records:

```typescript
async listMemory(ownerGaii, opts?) {
  const rows = this.db.prepare('SELECT * FROM memory WHERE ownerGaii = ?')
    .all(ownerGaii);
  // Could return 100,000+ records
}
```

**Recommendation:** Enforce pagination with maximum page size (e.g., 100 records). Add cursor-based pagination support.

---

## 3.12 In-Memory Default Storage

**Severity: HIGH**
**Files:** `src/storage/storage-factory.ts:23-26`

Default storage uses in-memory SQLite:
```typescript
default: {
  return new SqliteStorage(':memory:');
}
```

All data is lost on restart. No audit trail durability. Economic records cannot be audited.

**Recommendation:** Log a startup ERROR (not just info) when using in-memory storage. Consider making persistent storage the default.

---

## 3.13 Unsafe GAII Parsing in Consent Service

**Severity: MEDIUM**
**Files:** `src/services/consent.ts:33-38`

Owner extraction from GAIIs uses unsafe string operations:

```typescript
const ownerPart = ownerGaii.includes('#')
  ? ownerGaii.split('#')[1]?.split('@')[0]
  : ownerGaii.split('@')[0];
```

If GAII format is malformed, two different owners could match on the same owner part, granting incorrect `same_owner` access.

**Recommendation:** Use the validated GAII parser from `src/utils/gaii.ts` instead of ad-hoc string splitting.

---

## 3.14 Board Visibility Not Enforced at Storage Level

**Severity: MEDIUM**
**Files:** `src/storage/providers/sqlite/index.ts:588-595`

`listBoards()` returns all boards if no visibility filter is specified:

```typescript
async listBoards(opts?) {
  let sql = 'SELECT * FROM boards WHERE 1=1';
  if (opts?.visibility) { sql += ' AND visibility = ?'; }
  // If visibility not specified, returns ALL boards including private
}
```

**Recommendation:** Default to public visibility if no filter specified. Require explicit ownership check for private boards.

---

## 3.15 Chunked Uploads Not Persisted

**Severity: MEDIUM**
**Files:** `src/storage/providers/sqlite/index.ts:1122-1149`

Chunked upload state is stored in a volatile `Map`, not in SQLite:

```typescript
async createChunkedUpload(record) {
  this.chunkedUploads.set(record.uploadId, record);  // In-memory only
}
```

Server crash during upload = all chunks lost, no resume capability.

**Recommendation:** Persist chunk metadata and data to disk/database.
