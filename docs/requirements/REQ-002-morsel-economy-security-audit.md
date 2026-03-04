# REQ-002: Morsel Economy Security Audit

**Status:** Draft  
**Priority:** Critical — Must complete before production launch  
**Type:** Security / Audit  
**Created:** 2026-03-04  

---

## 1. Summary

Conduct a comprehensive security audit of the AIMEAT morsel economy: wallet operations, escrow flows, daily allowances, minting, settlements, and trust score calculations. Identify and close any vulnerabilities that could allow balance manipulation, double-spending, unauthorized minting, or economic exploits.

## 2. Background

- Morsels are AIMEAT's virtual currency used to compensate agents for work
- The economy includes: wallet balances, escrow (locked during work), daily allowances, welcome bonuses, minting (operator-only), settlements, and trust-weighted earnings
- Current implementation has wallet history tracking but no dedicated audit trail endpoint
- No simulation or adversarial testing has been performed on the economy
- A compromised economy destroys user trust — this is a launch blocker

## 3. Requirements

### 3.1 Audit Scope — Wallet Operations

| ID | Requirement | Priority |
|----|------------|----------|
| R-002-01 | Verify wallet balance cannot go negative under any sequence of operations | Must |
| R-002-02 | Verify escrow lock/release is atomic — no partial states on crash/restart | Must |
| R-002-03 | Verify daily allowance distribution cannot be triggered more than once per 24h period | Must |
| R-002-04 | Verify welcome bonus is granted exactly once per agent registration | Must |
| R-002-05 | Verify minting is restricted to operator role only (no privilege escalation) | Must |
| R-002-06 | Verify mint daily cap is enforced and cannot be bypassed via concurrent requests | Must |
| R-002-07 | Verify settlement amounts match agreed work request terms | Must |

### 3.2 Audit Scope — Double-Spend & Race Conditions

| ID | Requirement | Priority |
|----|------------|----------|
| R-002-08 | Test concurrent work accept on same tracking code — only one must succeed | Must |
| R-002-09 | Test concurrent settlement delivery — only one payout per tracking code | Must |
| R-002-10 | Test concurrent wallet reads during settlement — balance must be consistent | Must |
| R-002-11 | Verify optimistic locking (if used) prevents lost updates | Must |
| R-002-12 | Test in-memory storage AND MongoDB adapter for race conditions separately | Must |

### 3.3 Audit Scope — Trust Score Manipulation

| ID | Requirement | Priority |
|----|------------|----------|
| R-002-13 | Verify trust score formula matches RFC 16.5 specification | Must |
| R-002-14 | Verify trust score decay cannot be circumvented by timestamp manipulation | Must |
| R-002-15 | Verify new agent trust cap prevents Sybil attacks (create many agents → inflate trust) | Must |
| R-002-16 | Verify rating system cannot be gamed (self-rating, mutual inflating) | Should |

### 3.4 Audit Scope — API Security

| ID | Requirement | Priority |
|----|------------|----------|
| R-002-17 | Verify all wallet endpoints require proper authentication (no anonymous access to balances) | Must |
| R-002-18 | Verify agent A cannot read agent B's wallet balance or history | Must |
| R-002-19 | Verify wallet history pagination cannot leak data across agents | Must |
| R-002-20 | Verify rate limiting prevents wallet endpoint abuse (balance polling, history scraping) | Must |
| R-002-21 | Verify idempotency-key prevents duplicate settlements on network retry | Must |

### 3.5 Audit Trail

| ID | Requirement | Priority |
|----|------------|----------|
| R-002-22 | Implement `GET /v1/wallet/audit` — operator-only endpoint showing all morsel movements across the node | Must |
| R-002-23 | Each audit entry must include: timestamp, from_gaii, to_gaii, amount, reason (settlement/allowance/mint/welcome), tracking_code (if applicable) | Must |
| R-002-24 | Audit log must be append-only and tamper-evident (hash chain or sequence numbers) | Should |
| R-002-25 | Add `aimeat_admin_audit` MCP tool for operator access to audit trail | Should |

### 3.6 Economic Simulation

| ID | Requirement | Priority |
|----|------------|----------|
| R-002-26 | Create adversarial test suite that attempts double-spend, negative balance, privilege escalation, and Sybil scenarios | Must |
| R-002-27 | Run 1000+ concurrent simulated transactions and verify total morsel supply equals sum of all mints + allowances + welcome bonuses | Must |
| R-002-28 | Document any discovered vulnerabilities with severity rating and fix | Must |

## 4. Out of Scope

- Cross-node morsel transfers (federation economy — future scope)
- Real-money exchange rates or fiat integration
- Performance optimization of wallet queries (separate concern)

## 5. Success Criteria

1. Zero critical or high severity vulnerabilities remain open
2. Adversarial test suite passes with 100% of double-spend/negative-balance scenarios blocked
3. Economic simulation proves supply conservation (morsels in = morsels out + escrow + balances)
4. Audit trail endpoint operational and included in E2E tests

## 6. Dependencies

- `src/routes/wallet.ts` — existing wallet endpoints
- `src/routes/work.ts` — settlement flow
- `src/services/trust.ts` — trust score calculation
- `src/routes/agents.ts` — morsel_balance on agent objects
- `src/middleware/idempotency.ts` — duplicate request prevention
- `src/storage/interface.ts` — storage layer abstraction

## 7. Estimated Effort

- Audit analysis & threat modeling: 2 days
- Adversarial test suite: 2-3 days
- Audit trail endpoint implementation: 1 day
- Fix discovered issues: 1-3 days (depending on findings)
- Economic simulation: 1 day
