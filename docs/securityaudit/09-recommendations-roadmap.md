# 09 — Recommendations & Remediation Roadmap

## Priority Classification

| Priority | Criteria | Timeline |
|----------|----------|----------|
| **P0 — Immediate** | Active exploitation risk; data breach or system compromise | This week |
| **P1 — Urgent** | Significant security gap; exploitation feasible with moderate effort | Next 2 weeks |
| **P2 — Important** | Defense-in-depth; exploitable under specific conditions | Next month |
| **P3 — Hardening** | Best practices; reduces attack surface | Next quarter |

---

## Confirmed Permission Model

These recommendations implement the following confirmed model:

- **Trust** = system-computed only (from work history, ratings, flags). No direct write API.
- **Wallet** = system-mediated. Consumer pays for MSM services. No arbitrary transfers.
- **Operator** = can read wallet (for support), cannot write wallet or trust.
- **Visibility** = first access gate (`public` / `owner` / `private`), consent = second gate for all cross-agent access.
- **MSM install** = configurable per-node via `AIMEAT_MSM_INSTALL_ROLE` (default: `operator`).
- **Federation settlements** = require Ed25519 signature from originating node.
- **Consent** = already enforced on memory reads (corrected from initial audit). Verify coverage on other endpoints.

---

## P0 — Immediate (This Week)

### P0-1: Migrate Private Keys from localStorage to Non-Extractable CryptoKeys in IndexedDB
**Section:** 05.1 | **Impact:** XSS = full account takeover (current state)
**Action:**
- Replace plaintext key storage in `localStorage` (`save('session', { privateKey })`, `save('owner_key', ...)`) with Web Crypto API `CryptoKey` objects stored in `IndexedDB`
- Generate keys via `crypto.subtle.generateKey('Ed25519', false, ['sign'])` — the `extractable: false` flag prevents JavaScript from ever reading the raw key bytes
- Store the `CryptoKey` object in `IndexedDB` (it's structured-cloneable) — persists across page reloads, no re-authentication needed
- Sign operations via `crypto.subtle.sign('Ed25519', privateKey, data)` — browser does crypto internally, key material never exposed to JS
- **XSS protection:** even if attacker executes JS, they cannot call `crypto.subtle.exportKey()` on a non-extractable key — they can use it during the active session but cannot steal it for offline use
- Update `src/routes/libs.ts` client auth library to use this flow for key generation, storage, and signing

### P0-2: Remove JWT Token Extraction from URL Query Parameters
**Section:** 01.1 | **Impact:** Token leakage in logs, history, referrers
**Action:**
- Remove query parameter token extraction in `src/auth/middleware.ts`
- Keep OTK query parameter extraction only in micro-memory routes (single-use, short-lived)
- Update client libraries to use only `Authorization: Bearer` header

### P0-3: Fix Unauthenticated Federation Peer Introduction
**Section:** 07.3 | **Impact:** Malicious nodes join federation automatically
**Action:**
- Add Ed25519 signature verification requirement to `/v1/federation/peer/introduce`
- Remove auto-approve logic for "contributor" role
- Require operator approval for all peer introductions
- Add rate limiting (5/hour per IP)

### P0-4: Fix Wallet Balance Race Condition
**Section:** 03.3, 06.1 | **Impact:** Double-spending
**Action:**
- Replace read-update pattern with atomic SQL:
  ```sql
  UPDATE agents SET morselBalance = morselBalance - ?
  WHERE gaii = ? AND morselBalance >= ?
  ```
- Check `changes > 0` to verify success
- Apply same pattern to `settlePayment()`, board reactions

### P0-5: Make Trust Score System-Only
**Section:** 03.5, 06.2 | **Impact:** Trust system completely unreliable
**Action:**
- Remove `trust.adjust()` from the extension API bridge entirely
- Remove any direct trust score write API endpoint
- Trust should only change via system computation triggered by work completions, ratings, flags, account age
- Validate `requesterGaii !== providerGaii` in work creation
- Validate different owners for requester and provider
- Require minimum 3 unique counterparties for trust calculation

### P0-6: Fix Admin Password Exposure
**Section:** 01.4 | **Impact:** Admin password visible in page source and URLs
**Action:**
- Remove `{{PW}}` replacement in HTML template
- Accept admin password only via POST body or `X-Admin-Password` header
- Never via query parameter
- Implement session-based admin auth

---

## P1 — Urgent (Next 2 Weeks)

### P1-1: Add Ownership Validation to Storage Layer
**Section:** 03.1 | **Impact:** Cross-user data access
**Action:**
- Add `callerGaii` parameter to storage methods
- Validate ownership before operations
- Add route-level IDOR checks as primary defense
- Storage-level checks as defense-in-depth

### P1-2: Fix Anonymous Mode Auth Bypass
**Section:** 01.2 | **Impact:** Protected endpoints accessible without auth
**Action:**
- Add `req.auth.anonymous` flag to anonymous credentials
- `requireAuth()` should reject anonymous credentials by default
- Create `requireAuthOrAnonymous()` for explicitly anonymous-allowed endpoints

### P1-3: Persist Token Revocation
**Section:** 01.3 | **Impact:** Revoked tokens valid after restart
**Action:**
- Move revocation list to storage layer (SQLite/MongoDB)
- Add cleanup job for entries older than JWT TTL
- Verify revocation list survives restarts

### P1-4: Implement Federation SSRF Protection
**Section:** 07.4 | **Impact:** Internal network scanning, cloud metadata access
**Action:**
- Implement shared URL validation utility that blocks private IPs, localhost, metadata endpoints
- Apply to: federation URLs, work forwarding, webhook callbacks (hooks.ts)
- Use DNS resolution to check resolved IPs (prevent DNS rebinding)

### P1-5: Lock Down Extension API Bridge Permissions
**Section:** 07.1, 06.4 | **Impact:** Extensions can operate on any agent's wallet/trust
**Action:**
- Remove `trust.adjust` from extension bridge entirely (trust is system-only)
- Replace `wallet.transfer(from, to)` with `wallet.consume(amount, reason)` — debits caller only
- Restrict `wallet.hold(from, ...)` so `from` must equal `ctx.caller.gaii`
- Restrict `wallet.getBalance(gaii)` to caller's own balance
- Note: The V8 isolate sandbox itself is properly implemented and does not need changes

### P1-6: Lock Down Operator Wallet/Trust Access
**Section:** 06.4 | **Impact:** Compromised operator can manipulate economy
**Action:**
- Operator gets read-only access to wallet balances and transaction history (for support/audit)
- Operator cannot modify wallet balances or trust scores
- Add audit log for all operator data access

### P1-7: Fix Cascade Deletes
**Section:** 03.4 | **Impact:** GDPR compliance, orphaned data
**Action:**
- Implement complete cascade for owner deletion (all agents, memory, consents, boards, work, wallet, matches, personal nodes, push subscriptions, listings, purchases)
- Implement complete cascade for agent deletion (work, posts, subscriptions, consents, transactions, matches, listings)
- Implement complete cascade for organism deletion (boards, memory namespace, reputation, member references)
- Add E2E tests verifying cascade completeness

### P1-8: Fix Path Traversal in Apps Endpoint
**Section:** 02.3 | **Impact:** Arbitrary file read
**Action:**
- Validate filename parameter rejects `..`, `/`, `\`, and URL-encoded variants
- Apply validation before storage key construction
- Add test case for path traversal attempt

### P1-9: Fix Dev Mode Account Wipe
**Section:** 02.6 | **Impact:** Account deletion without confirmation
**Action:**
- Remove silent deletion behavior in dev mode
- Return 409 conflict for existing GHII registration
- Require explicit admin action for account reset

### P1-10: Stop Returning Private Keys in API Responses
**Section:** 01.9 | **Impact:** Keys logged, cached, intercepted
**Action:**
- Generate keys client-side; submit only public key to server
- Or provide one-time secure download mechanism
- Remove `private_key` from registration response bodies

### P1-11: Require Signed Federation Settlements
**Section:** 06 model | **Impact:** Unsigned cross-node transactions
**Action:**
- All cross-node wallet settlements must be signed with originating node's Ed25519 key
- Receiving node verifies signature before applying balance changes
- All cross-node trust signals must be signed similarly
- Reject unsigned federation economic operations

---

## P2 — Important (Next Month)

### P2-1: Add Rate Limiting to Critical Endpoints
**Section:** 02.12 | **Impact:** Brute force, enumeration, spam
**Action:** Add dedicated rate limits for: `/v1/auth/challenge`, `/v1/owners` POST, `/v1/ghii` POST, `/v1/flags` POST, `/v1/wallet/request`, `/v1/apps` GET with access codes, TOTP verification, admin setup endpoints, appeal creation

### P2-2: Verify Consent Enforcement Coverage
**Section:** 06.3 | **Impact:** Consent may not be checked on all data access paths
**Action:**
- Consent IS enforced on memory reads (corrected from initial audit)
- Verify consent is also enforced on: storage files, board access, catalogue/directory profile data, organism membership data, match data
- Apply visibility → consent two-layer check consistently across all cross-agent access

### P2-3: Add MSM Installation Role Config
**Section:** 06.4 | **Impact:** Control who can register service integrations
**Action:**
- Add `AIMEAT_MSM_INSTALL_ROLE` config (values: `operator` | `owner`, default: `operator`)
- Update `msm.ts` to use configurable role check instead of hardcoded `requireRole('owner')`
- Add to init wizard, `.env.example`, and environment validator

### P2-4: Fix GDPR Export Completeness
**Section:** 08.2 | **Impact:** GDPR Art. 20 non-compliance
**Action:**
- Audit all data types stored per user
- Ensure export includes: agents, memory, transactions, boards, consents, flags, matches, organisms, work, disputes, personal nodes, TOTP status
- Add E2E test verifying export completeness for each data type

### P2-5: Enforce Schema Validation Before Storage Write
**Section:** 03.7 | **Impact:** Invalid data in storage
**Action:**
- Check active schema locks before `setMemory()`
- Reject writes that don't conform to locked schemas

### P2-6: Add Storage Size Limits
**Section:** 03.8 | **Impact:** Disk exhaustion DoS
**Action:**
- Enforce maximum value sizes per data type
- Enforce mailbox quota in `createMailboxItem()`
- Add per-agent storage quota

### P2-7: Strengthen Password Requirements
**Section:** 01.8 | **Impact:** Weak passwords
**Action:**
- Increase GHII minimum password length to 8 characters
- Add complexity requirements or use a password strength library
- Check against common password lists

### P2-8: Fix TOTP Backup Code Timing Attack
**Section:** 01.10 | **Impact:** Backup code brute force
**Action:**
- Replace `indexOf()` with `timingSafeEqual()` for backup code comparison
- Increase backup code length to 12+ characters
- Add rate limiting on TOTP verification

### P2-9: Require TOTP Encryption Key
**Section:** 01.11 | **Impact:** TOTP secrets in plaintext
**Action:**
- Make `totpSecretEncryptionKey` mandatory when TOTP is enabled
- Add environment validator warning

### P2-10: Fix Idempotency Cache DoS
**Section:** 04.8 | **Impact:** Memory exhaustion
**Action:**
- Add maximum cache size (10,000 entries)
- Validate key format (UUID)
- Implement LRU eviction

### P2-11: Restrict `listAll*()` Methods
**Section:** 03.2 | **Impact:** Full data enumeration
**Action:**
- Remove or restrict all `listAll*()` storage methods
- Add mandatory filtering by owner/agent
- Implement pagination with enforced limits

---

## P3 — Hardening (Next Quarter)

### P3-1: Add HSTS Header
Add `Strict-Transport-Security: max-age=31536000; includeSubDomains` for HTTPS deployments.

### P3-2: Remove CSP unsafe-inline
Migrate inline scripts to external files. Use nonce-based CSP.

### P3-3: Configure Trust Proxy
Add `app.set('trust proxy', ...)` for deployments behind reverse proxies.

### P3-4: Implement Log Rotation
Add daily or size-based log rotation. Mask sensitive fields in logs.

### P3-5: Add Environment Validator Warnings
- Warn for `AIMEAT_STORAGE=memory` in production
- Warn for `AIMEAT_DEV_MODE=true`
- Warn for missing TOTP encryption key

### P3-6: Generic Error Messages
Sanitize all non-500 error messages to prevent information disclosure. Use error codes for client-side handling.

### P3-7: Implement Server-Side Session Tracking
Track active JWT sessions. Support bulk session revocation per user.

### P3-8: Encrypt Node Keys at Rest
Passphrase-encrypted key storage for `~/.aimeat/node-key.json`.

### P3-9: Add Dependency Scanning
Add `pnpm audit` to CI. Consider Snyk or Dependabot.

### P3-10: Create Security Documentation
Write: threat model, incident response plan, deployment security checklist, API security guidelines, federation security model.

### P3-11: Flag System Hardening
Weight flags by account age and trust score. Require operator confirmation for auto-hide. Add false-flagging penalties.

### P3-12: Directory Scraping Protection
Enforce max page size. Rate limit directory searches. Limit geo precision for unauthenticated users.

### P3-13: Add Security-Focused E2E Tests
Write tests for: IDOR, rate limit enforcement, consent enforcement on all endpoints, scope restrictions, SSRF prevention, user enumeration, negative balances, cascade delete completeness, trust score immutability, wallet operation atomicity.

---

## Effort Estimation

| Priority | Items | Estimated Effort |
|----------|-------|-----------------|
| P0 | 6 items | 2-3 days |
| P1 | 11 items | 6-8 days |
| P2 | 11 items | 5-7 days |
| P3 | 13 items | 3-5 days |
| **Total** | **41 items** | **16-23 days** |

---

## Attack Vectors Mitigated Per Priority

| After P0 | Blocked Attacks |
|----------|----------------|
| XSS → account takeover via localStorage keys | Blocked |
| Token theft via URL logs/referrers | Blocked |
| Malicious federation peer injection | Blocked |
| Double-spending / morsel minting | Blocked |
| Trust score manipulation (direct writes + self-gaming) | Blocked |
| Admin password exposure | Blocked |

| After P0+P1 | Additionally Blocked |
|-------------|---------------------|
| Cross-user data access (IDOR) | Blocked |
| Anonymous auth bypass | Blocked |
| Revoked token re-use after restart | Blocked |
| Internal network scanning (SSRF) | Blocked |
| Extension wallet/trust abuse | Blocked |
| Operator economic manipulation | Blocked |
| Unsigned federation transactions | Blocked |
| Incomplete data deletion | Blocked |
| Path traversal file read | Blocked |

| After P0+P1+P2 | Additionally Blocked |
|----------------|---------------------|
| Brute force attacks | Blocked |
| Consent gaps on non-memory endpoints | Blocked |
| Uncontrolled MSM installation | Blocked |
| GDPR non-compliance | Blocked |
| Storage exhaustion DoS | Blocked |
| Weak password exploitation | Blocked |
| TOTP attacks | Blocked |
