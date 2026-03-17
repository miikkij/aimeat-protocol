# Single Balance Migration — GHII-Only Morsel Economy

**Date:** 2026-03-17
**Status:** Approved
**Decision:** Migrate from dual balance (agent + GHII) to single balance (GHII only)

---

## Problem

The current system has morsel balances on both `AgentRecord.morselBalance` and `GHIIRecord.morselBalance`. This causes:

1. **Identity bugs** — debit/credit operations must resolve the correct balance holder (agent vs GHII) depending on session type, leading to "you have 0 morsels" errors when the owner actually has funds
2. **Aggregation complexity** — wallet display requires N+1 queries (GHII + each agent)
3. **Inconsistent atomicity** — agent balance has atomic `debitBalance()`/`creditBalance()`, GHII uses manual field updates via `updateGHII()` with race conditions
4. **Confusing UX** — owner sees aggregated balance but individual agent operations fail because "their" agent has 0

## Solution

**One balance per owner, stored on GHII.** Agents are tools, not economic actors. The human pays.

### Key changes

1. **All balance operations target GHII** — `debitBalance()`, `creditBalance()`, `creditBalanceCapped()` resolve agent GAII → owner → GHII record
2. **`AgentRecord.morselBalance` becomes read-only legacy** — field remains in schema for backward compat, not written to
3. **New `AgentRecord.dailySpendLimit`** — optional per-agent spending cap, checked against GHII balance on debit
4. **Transactions keyed to GHII** — all `addTransaction()` calls use GHII identity
5. **Wallet simplifies to single query** — no aggregation

### What does NOT change

- Frontend wallet service (`wallet.js`) — API contract stays the same
- Transaction history structure
- Escrow mechanics (hold/settle/return) — just operate on GHII balance
- Daily allowance — credited to GHII

---

## Scope

### Storage Layer

| Component | Change |
|-----------|--------|
| `storage/interface.ts` | Balance methods stay on Storage interface, internally resolve to GHII |
| `debitBalance(gaii, amount)` | Resolve gaii → owner → GHII, debit from GHII |
| `creditBalance(gaii, amount)` | Same resolution |
| `creditBalanceCapped(gaii, amount, cap)` | Same resolution |
| `transferBalance(from, to, amount)` | Resolve both → GHII (may be same owner) |
| SQLite `repos/agent.ts` | Move balance SQL to `repos/ghii.ts` |
| MongoDB `index.ts` | Move Prisma balance ops from Agent to GHII |
| Prisma schema | Keep `Agent.morselBalance` (legacy), add `GHII.morselBalance` as required |
| SQLite schema | Same approach |
| New: `AgentRecord.dailySpendLimit` | Optional field, default null (no limit) |

### Routes

| File | Change |
|------|--------|
| `wallet.ts` | Remove dual-path logic, single GHII query for balance + transactions |
| `boards.ts` | Remove dual debit; `debitBalance()` handles resolution |
| `agents.ts` | Remove `morselBalance` from agent creation; welcome bonus → GHII |
| `app-store.ts` | Use atomic `debitBalance()`/`creditBalance()` instead of manual field updates |
| `work.ts` | No change — `debitBalance()` already used, just resolves differently |
| `extensions.ts` | `getBalance()` → resolve agent → owner → GHII balance |
| `mcp.ts` | Balance queries → resolve to GHII |
| `admin-economy.ts` | Mint operation → credit GHII |
| `owners.ts` | Profile balance → GHII only |

### Services

| File | Change |
|------|--------|
| `morsel.ts` | `holdEscrow()`, `settlePayment()`, `returnEscrow()` — no change in interface, storage resolves internally |
| `quota.ts` | `checkMemoryQuota()`, `checkStorageQuota()` — resolve to GHII balance |

### Tests

| File | Change |
|------|--------|
| `test/unit/morsel.test.ts` | Update to create GHII records, debit/credit against GHII |
| E2E tests | Should pass — API contract unchanged |

---

## Resolution Logic

The storage layer's balance methods gain an internal resolution step:

```
debitBalance(gaii, amount):
  1. Parse gaii → extract owner name
  2. Lookup GHII record by owner
  3. Atomic debit from GHII.morselBalance
  4. (Optional) Check agent.dailySpendLimit if agent session
```

For GAII format `agent#owner@node`: extract `owner`, find GHII `owner@node`.
For GHII format `owner@node`: use directly.
For bare owner name `alice`: construct GHII `alice@node`.

---

## Agent Daily Spend Limit

New optional field: `AgentRecord.dailySpendLimit: number | null`

- `null` = no limit (default)
- When set, `debitBalance()` tracks daily spending per agent (via transactions) and rejects if limit exceeded
- Owner can set per agent via `PATCH /v1/agents/:gaii`
- Does NOT affect owner sessions — only agent sessions

---

## Migration Strategy

1. **Storage layer first** — change `debitBalance()`/`creditBalance()` to resolve to GHII internally
2. **Welcome bonus** — new agents don't get balance; owner gets welcome bonus on first GHII creation
3. **Existing data** — aggregate all agent balances + GHII balance into GHII on first access (lazy migration)
4. **Routes second** — simplify wallet, boards, agents, etc.
5. **Tests last** — update unit tests to new model

No data migration script needed — lazy migration on first wallet access per owner.

---

## Out of Scope

- Removing `AgentRecord.morselBalance` field from schema (keep for backward compat)
- Per-agent transaction history view (all transactions go to GHII)
- Multi-owner transfer (transferBalance between different owners' GHIIs)
