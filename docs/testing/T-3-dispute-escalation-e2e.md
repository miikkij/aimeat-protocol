# T-3: Dispute Escalation Flow E2E Tests

**Gap:** Auto-escalation (7d) and auto-resolve (30d) untested in E2E. Only dispute open/counter are tested (in current E2E they're not tested either — disputes are completely uncovered).

**Priority:** Low

**File:** `test/e2e-disputes.ts`

## Scope

Test the complete dispute lifecycle: open → counter → resolution paths (redeliver, accept-fault, partial offer, withdraw, escalate, operator ruling). Timing-dependent auto-escalation tested with mocked time or short intervals.

## Prerequisites

- Server running on `:3117`
- Two agents: requester + provider
- Completed work item in `delivered` status (so dispute can be opened)

## Setup Sequence

1. Register owner + 2 agents (requester, provider)
2. Provider publishes an action
3. Requester submits work → provider accepts → provider delivers
4. Now the work is in `delivered` status — disputes can be opened

## Test Phases

### Phase 1 — Dispute Opening & Viewing

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 1 | Open dispute (requester) | POST | `/v1/work/:tc/dispute` | 201, `status: 'open'`, escrow held |
| 2 | View dispute thread | GET | `/v1/work/:tc/dispute` | Returns dispute with audit log entries |
| 3 | Open duplicate dispute | POST | `/v1/work/:tc/dispute` | 409, already exists |
| 4 | Open dispute as non-requester | POST | `/v1/work/:tc/dispute` | 403 |

### Phase 2 — Counter-Dispute

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 5 | Provider counters | POST | `/v1/work/:tc/counter-dispute` | 200, `status: 'contested'` |
| 6 | Requester cannot counter own dispute | POST | `/v1/work/:tc/counter-dispute` | 403 |
| 7 | Audit log shows both entries | GET | `/v1/work/:tc/dispute` | 2+ audit entries, hash chain intact |

### Phase 3 — Resolution: Redelivery

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 8 | Provider offers redelivery | POST | `/v1/work/:tc/redeliver` | 200, new output provided |
| 9 | Requester accepts redelivery | POST | `/v1/work/:tc/accept-redelivery` | 200, dispute resolved, escrow settled |

### Phase 4 — Resolution: Accept Fault (new work item)

Setup: Create another delivered work item, open a dispute.

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 10 | Provider accepts fault | POST | `/v1/work/:tc/accept-fault` | 200, escrow returned to requester |
| 11 | Verify requester wallet refund | GET | `/v1/wallet` | Balance increased |

### Phase 5 — Resolution: Partial Refund

Setup: New delivered work item + dispute.

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 12 | Provider offers partial refund | POST | `/v1/work/:tc/offer-partial` | 200, `{ refund_percent }` |
| 13 | Requester accepts partial | POST | `/v1/work/:tc/accept-partial` | 200, dispute resolved |
| 14 | Requester rejects partial | POST | `/v1/work/:tc/reject-partial` | 200, dispute remains open |

### Phase 6 — Withdraw

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 15 | Requester withdraws dispute | POST | `/v1/work/:tc/withdraw-dispute` | 200, dispute resolved/withdrawn |

### Phase 7 — Escalation & Operator Ruling

Setup: New work item + dispute + counter.

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 16 | Requester escalates to operator | POST | `/v1/work/:tc/escalate` | 200, `status: 'escalated'` |
| 17 | Admin views audit log | GET | `/v1/admin/disputes/:id/audit-log` | Full tamper-evident chain |
| 18 | Operator rules in favor of requester | POST | `/v1/admin/disputes/:id/rule` | 200, escrow returned + penalty applied |
| 19 | Operator rules in favor of provider | POST | `/v1/admin/disputes/:id/rule` | 200, escrow released to provider |

### Phase 8 — Tier 0.5 (OTK-based)

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 20 | Accept redelivery via OTK | GET | `/v1/work/:tc/accept-redelivery?otk=...` | 200 |
| 21 | Escalate via OTK | GET | `/v1/work/:tc/escalate?otk=...` | 200 |

### Phase 9 — Audit Log Integrity

| # | Test | Assert |
|---|------|--------|
| 22 | Audit log hash chain is valid | Each entry's `hash` = SHA-256(previousHash + action + actor + timestamp) |
| 23 | Entries ordered chronologically | `timestamp` strictly increasing |

## Auto-Escalation / Auto-Resolve Note

Auto-escalation (7d) and auto-resolve (30d) are background timer jobs. Testing strategies:

1. **Unit test approach** (preferred): Extract the timer logic into a testable function, call it directly with mocked timestamps.
2. **E2E with short intervals**: Set dispute auto-escalation to 2 seconds via test config, wait, verify status change.
3. **Manual verification**: Confirm the timer is scheduled at server startup.

## Cleanup

Cascade-delete test owners (removes all agents, work items, disputes).
