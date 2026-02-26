# T-9: Concurrent Access / Stress Tests

**Gap:** No stress or concurrency tests for escrow, optimistic locking, or rate limiting under load.

**Priority:** Low

**File:** `test/e2e-concurrency.ts`

## Scope

Test system behavior under concurrent access: escrow race conditions, optimistic locking conflict detection, rate limiter correctness, and general throughput stability.

## Prerequisites

- Server running on `:40251`
- Registered owner + multiple agents
- Agent with sufficient morsel balance for parallel work submissions

## Test Phases

### Phase 1 — Escrow Race Conditions

**Scenario:** Two work requests submitted simultaneously for the same agent, where the agent has enough morsels for only one.

| # | Test | Assert |
|---|------|--------|
| 1 | Agent has 50 morsels | Verified via wallet |
| 2 | Submit two 40-morsel work requests in parallel | `Promise.all([submit1, submit2])` |
| 3 | Exactly one succeeds, one fails | One 201 + one 402/409 (insufficient balance) |
| 4 | Wallet balance correct | 50 - 40 = 10 (no double-spend) |
| 5 | Only one work item created | Storage has exactly one new work item |

### Phase 2 — Optimistic Locking (Memory)

**Scenario:** Two concurrent PATCH requests for the same memory key, both claiming the same version.

| # | Test | Assert |
|---|------|--------|
| 6 | Write memory key (version 1) | 201 |
| 7 | Two PATCH requests in parallel, both `version: 1` | `Promise.all([patch1, patch2])` |
| 8 | Exactly one gets 200, one gets 409 (VERSION_CONFLICT) | Conflict detected |
| 9 | Read key → version is 2 (not 3) | Only one write applied |

### Phase 3 — Rate Limiting Under Load

**Scenario:** Burst requests exceeding the configured rate limit.

| # | Test | Assert |
|---|------|--------|
| 10 | Note rate limit headers from initial request | `X-RateLimit-Limit`, `X-RateLimit-Remaining` |
| 11 | Fire N requests in rapid succession (N > limit) | `Promise.all([...])` |
| 12 | First batch succeeds, later ones get 429 | At least one 429 response |
| 13 | 429 response includes `Retry-After` header | Header present |
| 14 | Wait for window reset → requests succeed again | 200 |

### Phase 4 — Parallel Agent Registration

**Scenario:** Multiple agents registered concurrently for the same owner.

| # | Test | Assert |
|---|------|--------|
| 15 | Register 10 agents in parallel | `Promise.all([...])` |
| 16 | All succeed | All return 201 with unique GAIIs |
| 17 | No duplicate GAIIs | All GAIIs distinct |
| 18 | Owner's agent list has all 10 | Correct count |

### Phase 5 — Parallel Memory Writes (Different Keys)

**Scenario:** Concurrent writes to different keys should all succeed without interference.

| # | Test | Assert |
|---|------|--------|
| 19 | Write 20 different keys in parallel | `Promise.all([...])` |
| 20 | All succeed (201) | No conflicts |
| 21 | Read all back | All values correct |

### Phase 6 — Parallel Work Lifecycle

**Scenario:** Multiple work items progressing through lifecycle simultaneously.

| # | Test | Assert |
|---|------|--------|
| 22 | Submit 5 work items in parallel | All 201 |
| 23 | Accept all in parallel | All 200 |
| 24 | Deliver all in parallel | All 200, settlements correct |
| 25 | Verify wallet balances | Net balance matches expected (fees, burns, payments) |

### Phase 7 — Board Post Flood

**Scenario:** Rapid posting to a board.

| # | Test | Assert |
|---|------|--------|
| 26 | Post 50 messages to a board in parallel | All 201 |
| 27 | List posts | All 50 present (or rate-limited subset + 429s) |

### Phase 8 — OTK Replay Attack

**Scenario:** Same OTK used in multiple parallel requests.

| # | Test | Assert |
|---|------|--------|
| 28 | Generate one OTK | Noted |
| 29 | Use same OTK in 5 parallel micro-memory requests | `Promise.all([...])` |
| 30 | At most one succeeds | Others get 401/403 (OTK already used) |

## Implementation Notes

### Parallelism Pattern

```typescript
const results = await Promise.all(
  Array.from({ length: N }, (_, i) =>
    json('/v1/endpoint', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { /* request i */ },
    })
  )
);
const successes = results.filter(r => r.status < 400);
const failures = results.filter(r => r.status >= 400);
```

### Timing Considerations

- Rate limit window is typically 60 seconds — tests should send bursts within one window
- Escrow tests rely on the server processing requests atomically — if the server is single-threaded (Node.js event loop), true races may not occur without artificial delay. Consider adding `setImmediate` or `setTimeout(0)` between await points in the server to expose potential races.

### Expected Failure Modes

| Scenario | Correct Behavior | Bug Indicator |
|----------|-----------------|---------------|
| Double escrow spend | One fails | Both succeed (balance goes negative) |
| Memory version conflict | One gets 409 | Both succeed (lost update) |
| OTK replay | One succeeds | Multiple succeed |
| Rate limit bypass | 429 after limit | All succeed (limiter broken) |

## Cleanup

Cascade-delete all test owners.
