# 06 — Business Logic Vulnerabilities

## Intended Permission Model (Clarified)

The following permission model was confirmed during the audit and should be the target state:

```
                    Memory/   Wallet    Trust     Consent
                    Profile   (morsels) (score)
                    ──────────────────────────────────────
User (own data)     R/W       Read-only Read-only R/W (own grants)

Node Operator       R/W       Read-only NO write  Read (audit)
                    (any      (support/ (system-
                     user)     audit)    only)

MSM Service         R/W       Debit     NO write  Check
(user-activated)    (scoped   caller               (verify before
                     to MSM   only                  data access)
                     namespace)

Federation Node     R/W       Settle    Relay     Cross-node
                    (cross-   (signed)  (signed)  grants
                     node)

System Only         n/a       Mint,     Compute   n/a
                              escrow,   (from work
                              settle    history,
                                        ratings,
                                        flags)
```

**Key principles:**
- **Trust is a system-computed value.** No API should directly write trust scores. Trust changes are triggered by work completions, ratings, flags, and account age.
- **Wallet is system-mediated.** Balance changes only through: service consumption (consumer pays), work settlement (provider earns), daily allowance (system grants). No direct `wallet.transfer(from, to)` for arbitrary callers.
- **Operator cannot touch wallet or trust.** Prevents economic attacks from a compromised operator account.
- **Visibility is the first access check** (`public` → anyone, `owner` → same GHII owner's agents, `private` → owning agent only), then consent as second layer for all cross-agent access.
- **MSM installation is configurable** via `AIMEAT_MSM_INSTALL_ROLE` (default: `operator`).
- **Federation settlements require Ed25519 signatures** from the originating node.

---

## 6.1 Morsel Economy Attacks

### Double-Spending (CRITICAL)

**Files:** `src/services/morsel.ts:27-51`

The check-then-act pattern in `holdEscrow()` has no atomicity guarantees. Two concurrent requests can both pass the balance check and deduct the same funds. See section 03 for details.

### Morsel Minting from Thin Air (HIGH)

**Files:** `src/services/morsel.ts:61-94`

`settlePayment()` does not validate:
- That a work request actually exists
- That the requester initiated the request
- That the provider performed real work
- That any delivery verification occurred

An agent can create a self-directed work request, immediately settle it, and mint morsels.

### Daily Allowance Abuse (MEDIUM)

**Files:** `src/routes/wallet.ts:115-148`

POST `/v1/wallet/request` grants up to `dailyAllowance` morsels. No per-agent rate limiting beyond the daily cap. No verification of cooldown period between requests.

**Recommendation:** Implement per-agent cooldown, atomic balance operations, and work validation requirements.

---

## 6.2 Trust Score Write Access Too Broad

### Self-Rating (CRITICAL)

**Files:** `src/services/trust.ts:35-50`

Trust scores are calculated from work history without validating that requester and provider are different agents. Self-rating inflates trust to 100% in minutes.

### Direct Trust Writes Should Not Exist (HIGH)

The old extension API bridge exposes `trust.adjust(gaii, delta, reason)` which allows direct trust score modification. Per the clarified permission model, trust should be **system-computed only** — never directly writable by any API caller, extension, operator, or user.

**Recommendation:**
- Remove `trust.adjust` from the extension API bridge entirely
- Remove any direct trust score write API
- Trust score should only change via system computation triggered by:
  - Work completion + rating by counterparty
  - Flag resolution
  - Account age milestones
- Validate `requesterGaii !== providerGaii` in work creation
- Require minimum unique counterparties for meaningful trust

---

## 6.3 Consent System — CORRECTED: Consent IS Enforced

**Severity: LOW (already implemented, verify coverage)**

**CORRECTION:** The initial audit incorrectly stated consent was not enforced. It IS enforced on memory reads via `checkConsentForRead()` in `src/services/consent.ts`, called from `src/routes/memory.ts:422`.

The consent check flow:
1. Public data → always allow (visibility first gate)
2. Accessor is data owner → always allow
3. Visibility `owner` → allow if same owner (same GHII)
4. Visibility `private` → allow only for the owning agent
5. Otherwise → find matching consent → allow if active consent exists
6. Access attempts are audited via `auditDataAccess()`

**Remaining gap:** Verify consent enforcement is also applied to:
- Storage files (`storage-files.ts`) — does it check consent?
- Board posts — private/shared boards check access?
- Catalogue/directory — consent for profile data exposure?
- Organism membership data
- Match data

**Recommendation:** Audit all cross-agent data access endpoints to ensure they follow the same visibility → consent check flow as memory.

---

## 6.4 Wallet Permission Model Misalignment (NEW)

**Severity: HIGH**

The old extension API bridge provides unrestricted wallet operations:
- `wallet.transfer(from, to, amount)` — can debit ANY agent
- `wallet.hold(from, amount, reason)` — can hold from ANY agent
- `wallet.getBalance(gaii)` — can read ANY agent's balance

Per the clarified model:
- Extensions/MSMs should only be able to debit the **calling user** (consumer pays)
- Operators should have **read-only** wallet access
- Only the system (escrow settlement, daily allowance) should credit/debit without user action

**Recommendation:**
- Replace `wallet.transfer(from, to)` with `wallet.consume(amount, reason)` that only debits `ctx.caller.gaii`
- Remove `wallet.hold(from, ...)` or restrict `from` to caller
- Keep `wallet.getBalance` for caller's own balance only
- Add `AIMEAT_MSM_INSTALL_ROLE` config (default: `operator`)

---

## 6.5 Flag System Abuse — Coordinated Suppression

**Severity: MEDIUM**
**Files:** `src/routes/flags.ts:55-58`

The flag system prevents duplicate flags from the same user but has no protection against coordinated attacks:

- Default `autoHideThreshold = 5` — only 5 accounts needed to auto-hide content
- No rate limit on flag creation across different targets
- No penalty for false flagging
- Auto-hide happens without operator review

**Recommendation:**
- Increase default `autoHideThreshold` (e.g., 10-20)
- Weight flags by account age and trust score
- Require operator confirmation for auto-hide
- Implement flag abuse detection (same IP, timing patterns)
- Add penalty for false flagging after appeal success

---

## 6.6 Directory and Catalogue — Data Scraping

**Severity: MEDIUM**
**Files:** `openapi.yaml`, `src/routes/catalogue.ts`

Public endpoints expose:
- `/v1/catalogue` — All published actions and services
- `/v1/catalogue/directory` — People directory with location, interests, geo-radius search

**No protection against:**
- Pagination abuse (unlimited page sizes)
- Automated scraping
- Geo-radius sweeping (systematic location tracking)
- Interest-based profiling

**Recommendation:**
- Enforce maximum page size (e.g., 50 results)
- Rate limit directory searches per IP
- Limit geo-radius precision for unauthenticated users
- Consider requiring authentication for directory access

---

## 6.7 Dispute System — Audit Hash Integrity

**Severity: LOW**
**Files:** `src/routes/disputes.ts:15-45`

Disputes use a SHA256 hash chain for audit integrity. However:
- Hash chain is not verified on read
- Operator can insert entries without extending the chain
- No external timestamp authority

**Recommendation:** Validate hash chain integrity on every read. Consider external timestamping for dispute evidence.

---

## 6.8 Matching Engine — Stale Data Race

**Severity: MEDIUM**
**Files:** `src/services/directory.ts:125-135`, `src/services/matching.ts:172-180`

The directory service has a 2-second debounce on index rebuilds. A match could be created during rebuild after the user has revoked consent.

**Recommendation:** Check consent validity at match creation time, not just at index time. Invalidate matches when consent is revoked.

---

## 6.9 Organism Privilege Escalation

**Severity: MEDIUM**
**Files:** `src/routes/flags.ts:164-207`

Organism admins can moderate flags for content that may not belong to their organism.

**Recommendation:** Validate that flagged content's namespace/context matches the organism before allowing admin moderation.

---

## 6.10 Board Post Content Injection

**Severity: LOW**
**Files:** `src/routes/boards.ts`

Board posts accept arbitrary content. While client-side rendering uses `escHtml()`, stored content could contain malicious URLs or social engineering text.

**Recommendation:** Implement content moderation hooks for board posts.
