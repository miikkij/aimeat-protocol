# Single Balance Migration (GHII-Only) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate morsel economy from dual balance (agent + GHII) to single balance (GHII only), with optional per-agent daily spend limits.

**Architecture:** All balance operations (`debitBalance`, `creditBalance`, `creditBalanceCapped`) internally resolve GAII → owner → GHII record. The storage layer handles resolution so routes don't need to change their calling patterns. Agent `morselBalance` field is kept in schema for backward compat but no longer written to.

**Tech Stack:** TypeScript, Express 5, better-sqlite3, Prisma (MongoDB), existing storage abstraction layer.

**Spec:** `docs/superpowers/specs/2026-03-17-single-balance-migration-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/storage/interface.ts` | Add `dailySpendLimit` to AgentRecord |
| Modify | `src/storage/providers/sqlite/schema.ts` | Add `dailySpendLimit` column to agents table |
| Modify | `src/storage/providers/sqlite/repos/agent.ts` | Balance methods resolve to GHII |
| Modify | `src/storage/providers/sqlite/repos/ghii.ts` | Add atomic balance SQL methods |
| Modify | `src/storage/providers/sqlite/index.ts` | Wire new balance methods |
| Modify | `src/storage/providers/mongodb/index.ts` | Balance methods resolve to GHII |
| Modify | `prisma/schema.prisma` | Add `dailySpendLimit` to Agent model |
| Modify | `src/routes/wallet.ts` | Simplify to GHII-only balance |
| Modify | `src/routes/boards.ts` | Remove dual debit logic |
| Modify | `src/routes/agents.ts` | Welcome bonus → GHII, remove agent morselBalance init |
| Modify | `src/routes/app-store.ts` | Use atomic balance ops instead of manual updates |
| Modify | `src/routes/extensions.ts` | getBalance → owner GHII |
| Modify | `src/routes/mcp.ts` | Balance queries → owner GHII |
| Modify | `src/routes/admin-economy.ts` | Mint → GHII |
| Modify | `src/routes/owners.ts` | Profile balance → GHII only |
| Modify | `src/services/morsel.ts` | No interface change, storage resolves |
| Modify | `src/services/quota.ts` | Balance checks → GHII |
| Modify | `test/unit/morsel.test.ts` | Update to GHII-based balance |
| Modify | `CLAUDE.md` | Update Morsel Economy section |

---

## Task 1: Storage Layer — GHII Balance Resolution (SQLite)

The core change. Balance methods resolve GAII → owner → GHII and operate on GHII record.

**Files:**
- Modify: `src/storage/providers/sqlite/repos/ghii.ts`
- Modify: `src/storage/providers/sqlite/repos/agent.ts:94-135`
- Modify: `src/storage/providers/sqlite/schema.ts:29`
- Modify: `src/storage/interface.ts:25`

- [ ] **Step 1: Add dailySpendLimit to AgentRecord interface**

In `src/storage/interface.ts`, add to AgentRecord (after line 25):
```typescript
dailySpendLimit: number | null;  // null = no limit
```

- [ ] **Step 2: Add dailySpendLimit column to SQLite agents schema**

In `src/storage/providers/sqlite/schema.ts`, add to agents table (after morselBalance line 29):
```sql
dailySpendLimit REAL DEFAULT NULL,
```

Also add migration in `ensureMigrations()` for existing DBs:
```typescript
addColumnIfMissing(db, 'agents', 'dailySpendLimit', 'REAL DEFAULT NULL');
```

- [ ] **Step 3: Add atomic balance methods to SQLite GHII repo**

In `src/storage/providers/sqlite/repos/ghii.ts`, add new functions:

```typescript
/**
 * Resolve a GAII/GHII identity to the owner's GHII identifier.
 * - GAII format (agent#owner@node): extract owner, return owner@node
 * - GHII format (owner@node): return as-is
 * - Bare owner name: construct owner@node
 */
export function resolveOwnerGhii(db: Database.Database, identity: string, nodeId: string): string | null {
  // Already GHII format (owner@node, no #)
  if (!identity.includes('#') && identity.includes('@')) return identity;
  // GAII format: agent#owner@node
  const hashIdx = identity.indexOf('#');
  const atIdx = identity.lastIndexOf('@');
  if (hashIdx >= 0 && atIdx > hashIdx) {
    const owner = identity.slice(hashIdx + 1, atIdx);
    const node = identity.slice(atIdx + 1);
    return `${owner}@${node}`;
  }
  // Bare owner name
  return `${identity}@${nodeId}`;
}

export function debitGhiiBalance(db: Database.Database, ghii: string, amount: number): boolean {
  const result = db.prepare(
    `UPDATE ghiis SET morselBalance = morselBalance - ? WHERE ghii = ? AND morselBalance >= ?`
  ).run(amount, ghii, amount);
  return result.changes > 0;
}

export function creditGhiiBalance(db: Database.Database, ghii: string, amount: number): boolean {
  const result = db.prepare(
    `UPDATE ghiis SET morselBalance = COALESCE(morselBalance, 0) + ? WHERE ghii = ?`
  ).run(amount, ghii);
  return result.changes > 0;
}

export function creditGhiiBalanceCapped(db: Database.Database, ghii: string, amount: number, cap: number): number {
  const tx = db.transaction(() => {
    const row = db.prepare(`SELECT morselBalance FROM ghiis WHERE ghii = ?`).get(ghii) as { morselBalance: number } | undefined;
    if (!row) return 0;
    const current = row.morselBalance ?? 0;
    if (current >= cap) return 0;
    const credit = Math.min(amount, cap - current);
    db.prepare(`UPDATE ghiis SET morselBalance = morselBalance + ? WHERE ghii = ?`).run(credit, ghii);
    return credit;
  });
  return tx();
}
```

- [ ] **Step 4: Update SQLite agent.ts balance methods to resolve to GHII**

Replace `debitBalance`, `creditBalance`, `creditBalanceCapped`, `transferBalance` in `src/storage/providers/sqlite/repos/agent.ts` (lines 94-135) to resolve identity to GHII and delegate to GHII functions.

```typescript
import { resolveOwnerGhii, debitGhiiBalance, creditGhiiBalance, creditGhiiBalanceCapped } from './ghii.js';

export function debitBalance(db: Database.Database, gaii: string, amount: number, nodeId: string): boolean {
  const ghii = resolveOwnerGhii(db, gaii, nodeId);
  if (!ghii) return false;
  return debitGhiiBalance(db, ghii, amount);
}

export function creditBalance(db: Database.Database, gaii: string, amount: number, nodeId: string): boolean {
  const ghii = resolveOwnerGhii(db, gaii, nodeId);
  if (!ghii) return false;
  return creditGhiiBalance(db, ghii, amount);
}

export function creditBalanceCapped(db: Database.Database, gaii: string, amount: number, cap: number, nodeId: string): number {
  const ghii = resolveOwnerGhii(db, gaii, nodeId);
  if (!ghii) return 0;
  return creditGhiiBalanceCapped(db, ghii, amount, cap);
}

export function transferBalance(db: Database.Database, fromGaii: string, toGaii: string, amount: number, nodeId: string): boolean {
  const fromGhii = resolveOwnerGhii(db, fromGaii, nodeId);
  const toGhii = resolveOwnerGhii(db, toGaii, nodeId);
  if (!fromGhii || !toGhii) return false;
  if (fromGhii === toGhii) return true; // Same owner — no-op
  const tx = db.transaction(() => {
    if (!debitGhiiBalance(db, fromGhii, amount)) return false;
    creditGhiiBalance(db, toGhii, amount);
    return true;
  });
  return tx();
}
```

- [ ] **Step 5: Update SQLite index.ts to pass nodeId to balance methods**

In `src/storage/providers/sqlite/index.ts`, update the balance method wrappers to pass `this.nodeId`:

```typescript
async debitBalance(gaii: string, amount: number): Promise<boolean> {
  return agentRepo.debitBalance(this.db, gaii, amount, this.nodeId);
}
// Same for creditBalance, creditBalanceCapped, transferBalance
```

- [ ] **Step 6: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: Clean (no errors)

- [ ] **Step 7: Commit**

```bash
git add src/storage/
git commit -m "feat(economy): storage layer resolves balance ops to GHII

Balance methods (debit/credit/capped/transfer) now resolve any
GAII/GHII identity to the owner's GHII record. Agent morselBalance
field is no longer used for new operations."
```

---

## Task 2: Storage Layer — GHII Balance Resolution (MongoDB)

Same changes for MongoDB/Prisma backend.

**Files:**
- Modify: `src/storage/providers/mongodb/index.ts:297-343`
- Modify: `prisma/schema.prisma:32,297`

- [ ] **Step 1: Add dailySpendLimit to Prisma Agent model**

In `prisma/schema.prisma`, add to Agent model (after morselBalance line 32):
```prisma
dailySpendLimit Int?
```

- [ ] **Step 2: Update MongoDB balance methods to resolve to GHII**

In `src/storage/providers/mongodb/index.ts`, add a helper and update methods:

```typescript
private async resolveOwnerGhii(identity: string): Promise<string | null> {
  if (!identity.includes('#') && identity.includes('@')) return identity;
  const hashIdx = identity.indexOf('#');
  const atIdx = identity.lastIndexOf('@');
  if (hashIdx >= 0 && atIdx > hashIdx) {
    const owner = identity.slice(hashIdx + 1, atIdx);
    const node = identity.slice(atIdx + 1);
    return `${owner}@${node}`;
  }
  return `${identity}@${this.nodeId}`;
}

async debitBalance(gaii: string, amount: number): Promise<boolean> {
  this.ensureReady();
  const ghii = await this.resolveOwnerGhii(gaii);
  if (!ghii) return false;
  try {
    await this.prisma.ghii.update({
      where: { ghii, morselBalance: { gte: amount } },
      data: { morselBalance: { decrement: amount } },
    });
    return true;
  } catch { return false; }
}
// Same pattern for creditBalance, creditBalanceCapped, transferBalance
```

- [ ] **Step 3: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/storage/providers/mongodb/ prisma/
git commit -m "feat(economy): MongoDB balance ops resolve to GHII"
```

---

## Task 3: Routes — Simplify Wallet

Remove dual-path aggregation. Single GHII query.

**Files:**
- Modify: `src/routes/wallet.ts`

- [ ] **Step 1: Simplify GET /v1/wallet**

Replace lines 14-56 with single-path logic:

```typescript
router.get('/v1/wallet', requireAuth(), requireScope('wallet:read'), async (req, res) => {
  const ownerName = req.auth!.owner as string;
  const ghiiRecord = await storage.getGHIIByOwner(ownerName);
  if (!ghiiRecord) {
    res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Owner profile not found'));
    return;
  }

  const balance = ghiiRecord.morselBalance ?? 0;
  const ghii = ghiiRecord.ghii;
  const inEscrow = await calculateEscrow(storage, ghii);
  const transactions = await storage.getTransactions(ghii, 100_000);

  let earned = 0, spent = 0, receivedAllowance = 0, welcomeBonus = 0;
  for (const tx of transactions) {
    if (tx.type === 'earned') earned += tx.amount;
    if (tx.type === 'spent') spent += Math.abs(tx.amount);
    if (tx.type === 'allowance') receivedAllowance += tx.amount;
    if (tx.type === 'welcome_bonus') welcomeBonus += tx.amount;
  }

  res.json(success(config.nodeId, {
    '@context': { schema: 'https://schema.org/', aimeat: 'https://aimeat.io/ns/' },
    '@type': 'aimeat:Wallet',
    gaii: ghii,
    balance,
    in_escrow: inEscrow,
    available: balance - inEscrow,
    daily_allowance: { amount: config.dailyAllowance, accumulation_cap: config.dailyAllowanceCap },
    lifetime: { earned, spent, received_allowance: receivedAllowance, welcome_bonus: welcomeBonus },
  }, [
    { description: 'View transaction history', method: 'GET', url: '/v1/wallet/transactions' },
    { description: 'Request more morsels', method: 'POST', url: '/v1/wallet/request' },
  ]));
});
```

- [ ] **Step 2: Simplify GET /v1/wallet/transactions**

Replace dual-path with single GHII query:

```typescript
const ownerName = req.auth!.owner as string;
const ghiiRecord = await storage.getGHIIByOwner(ownerName);
const ghii = ghiiRecord?.ghii ?? `${ownerName}@${config.nodeId}`;
transactions = await storage.getTransactions(ghii, 100_000);
```

- [ ] **Step 3: Simplify POST /v1/wallet/request**

Remove dual-path. Always credit GHII via `creditBalanceCapped`:

```typescript
const ownerName = req.auth!.owner as string;
const ghii = `${ownerName}@${config.nodeId}`;
const credited = await storage.creditBalanceCapped(ghii, grantAmount, config.dailyAllowanceCap);
```

- [ ] **Step 4: Simplify GET /v1/wallet/history (deprecated)**

Same pattern — single GHII query.

- [ ] **Step 5: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/routes/wallet.ts
git commit -m "feat(economy): simplify wallet to GHII-only balance"
```

---

## Task 4: Routes — Simplify Boards Debit

Remove dual debit logic added in earlier fix.

**Files:**
- Modify: `src/routes/boards.ts:174-200`

- [ ] **Step 1: Replace dual debit with single debitBalance call**

The storage layer now resolves to GHII internally, so:

```typescript
if (board.visibility === 'public') {
  const cost = config.boardPostBaseCost + Math.ceil((body.length / 1000) * config.boardPostCostPerKb);
  const debited = await storage.debitBalance(gaii, cost);
  if (!debited) {
    res.status(402).json(error(config.nodeId, 'INSUFFICIENT_MORSELS',
      `Posting costs ${cost} morsels`));
    return;
  }
  await storage.addTransaction({
    id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    gaii,
    type: 'spent',
    amount: -cost,
    timestamp: new Date().toISOString(),
  });
}
```

- [ ] **Step 2: Run type-check and commit**

```bash
git add src/routes/boards.ts
git commit -m "feat(economy): boards debit uses unified balance resolution"
```

---

## Task 5: Routes — Agent Creation (Welcome Bonus → GHII)

New agents don't get their own balance. Welcome bonus already on GHII from registration.

**Files:**
- Modify: `src/routes/agents.ts`

- [ ] **Step 1: Remove morselBalance from agent creation**

In all `storage.createAgent()` calls, set `morselBalance: 0` (keep field for schema compat). Remove welcome bonus transaction creation from agent registration — the welcome bonus is already granted to GHII during owner registration in `ghii.ts`.

Key locations:
- Line 321: `morselBalance: config.welcomeBonus` → `morselBalance: 0`
- Lines 328-334: Remove welcome bonus transaction (already on GHII)

- [ ] **Step 2: Verify welcome bonus is granted during GHII registration**

Check `src/routes/ghii.ts` registration handler — ensure it credits `config.welcomeBonus` to GHII. If not, add it there.

- [ ] **Step 3: Run type-check and commit**

```bash
git add src/routes/agents.ts src/routes/ghii.ts
git commit -m "feat(economy): welcome bonus on GHII, agents start with 0"
```

---

## Task 6: Routes — App Store, Extensions, MCP, Admin

Update remaining routes that read agent balance.

**Files:**
- Modify: `src/routes/app-store.ts`
- Modify: `src/routes/extensions.ts`
- Modify: `src/routes/mcp.ts`
- Modify: `src/routes/admin-economy.ts`
- Modify: `src/routes/owners.ts`

- [ ] **Step 1: Fix app-store.ts purchase flow**

Replace direct field updates (lines 93-110) with atomic `debitBalance`/`creditBalance` calls. Storage resolves to GHII internally.

- [ ] **Step 2: Fix extensions.ts getBalance()**

Lines 926-930 and 1147-1152: resolve agent → owner → GHII balance:
```typescript
async getBalance(): Promise<number> {
  const ownerName = agentRecord.owner;
  const ghii = await storage.getGHIIByOwner(ownerName);
  return ghii?.morselBalance ?? 0;
}
```

- [ ] **Step 3: Fix mcp.ts balance queries**

Lines 132, 307, 410-412, 543, 570: resolve to GHII balance instead of agent.morselBalance.

- [ ] **Step 4: Fix admin-economy.ts mint**

Line 62: Mint credits GHII via `creditBalance()` instead of agent.

- [ ] **Step 5: Fix owners.ts profile balance**

Return GHII balance only, don't aggregate agent balances.

- [ ] **Step 6: Run type-check and commit**

```bash
git add src/routes/app-store.ts src/routes/extensions.ts src/routes/mcp.ts src/routes/admin-economy.ts src/routes/owners.ts
git commit -m "feat(economy): all routes use GHII-resolved balance"
```

---

## Task 7: Services — Quota & Morsel

Ensure services resolve correctly. Most don't need changes since they call `storage.debitBalance()` which now resolves internally.

**Files:**
- Modify: `src/services/quota.ts`
- Review: `src/services/morsel.ts` (likely no changes needed)

- [ ] **Step 1: Check quota.ts balance checks**

If `checkMemoryQuota` or `checkStorageQuota` read `agent.morselBalance` directly, update to resolve owner → GHII.

- [ ] **Step 2: Verify morsel.ts works without changes**

`holdEscrow()`, `settlePayment()`, `returnEscrow()`, `applyDailyAllowance()` all call `storage.debitBalance()`/`storage.creditBalance()` which now resolve internally. Verify no direct `agent.morselBalance` reads.

- [ ] **Step 3: Run type-check and commit**

```bash
git add src/services/
git commit -m "feat(economy): services use GHII-resolved balance"
```

---

## Task 8: Update CLAUDE.md

Update the Morsel Economy section to reflect single balance.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update Morsel Economy section**

Replace the "Morsel Economy — Dual Balance" section with:

```markdown
### Morsel Economy — Single Balance (GHII)

All morsels belong to the owner (GHII), not individual agents. Agents are tools — the human pays.

- **Balance location:** `GHIIRecord.morselBalance` only
- **Agent spending:** Agents spend from owner's GHII balance. Optional `dailySpendLimit` per agent.
- **Balance operations:** `storage.debitBalance(gaii, amount)` internally resolves any GAII → owner → GHII
- **Transactions:** Keyed to GHII identity
- **Wallet API:** Returns single GHII balance, no aggregation
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md morsel economy to single balance"
```

---

## Task 9: Run Full E2E Tests

**Files:** None (verification only)

- [ ] **Step 1: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: Clean

- [ ] **Step 2: Run SQLite E2E tests**

Run: `cd aimeat && pnpm test:e2e:sqlite`
Expected: All previously passing tests still pass (925+)

- [ ] **Step 3: Fix any test failures**

If balance-related tests fail, update them to work with GHII-only model.

- [ ] **Step 4: Run lint**

Run: `cd aimeat && pnpm lint`
Expected: Clean

- [ ] **Step 5: Final commit if any fixes**

```bash
git add -A
git commit -m "fix(economy): test adjustments for single balance migration"
```
