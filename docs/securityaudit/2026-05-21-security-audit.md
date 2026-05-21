# AIMEAT Security Audit -- 2026-05-21

**Scope:** Full codebase audit covering authentication, authorization, input validation, dependencies, storage, GDPR, extensions, federation, and infrastructure.

**Audited areas:** Auth middleware, JWT implementation, all route files, storage layer, extension sandbox, CORS, rate limiting, cryptography, dependencies, GDPR compliance, federation, wallet economy, board features, error handling, logging, HTTP headers, file uploads.

---

## Table of Contents

1. [All Findings by Severity](#1-all-findings-by-severity)
2. [Positive Findings (Strong Areas)](#2-positive-findings)
3. [User Decisions](#3-user-decisions)
4. [Fix Plans](#4-fix-plans)

---

## 1. All Findings by Severity

### CRITICAL

| ID | Finding | File(s) | Status |
|----|---------|---------|--------|
| C1 | Extension `ctx.fetch()` has no SSRF protection | `src/services/extension-runtime.ts:297`, `src/routes/extensions.ts:916,1138` | **Fix approved** |
| C2 | GDPR cascade delete missing 15+ data categories | `src/routes/owners.ts:619-663` | **Fix approved** |

### HIGH

| ID | Finding | File(s) | Status |
|----|---------|---------|--------|
| H1 | Admin password logged in plaintext on every startup | `src/index.ts:409-411` | **Fix approved** |
| H2 | CORS defaults to wildcard `*` with credentials | `src/config.ts:643`, `src/middleware/cors.ts:39-43` | **Accepted risk (by design)** |
| H3 | No password brute-force protection (non-TOTP accounts) | `src/routes/ghii.ts:225,366-370` | **Fix approved** |
| H4 | Extension script content exposed without auth via `?full=true` | `src/routes/extensions.ts:251-283` | **Fix approved** |
| H5 | Extension email capability sends to arbitrary addresses | `src/routes/extensions.ts:1020-1023,1245-1248` | **Fix approved (tiered auth model)** |
| H6 | Token refresh preserves roles without revalidation from storage | `src/routes/auth.ts:356-382` | **Fix approved** |

### MEDIUM

| ID | Finding | File(s) | Status |
|----|---------|---------|--------|
| M1 | Registration endpoint lacks per-route rate limiting | `src/routes/ghii.ts:50` | **Fix approved** |
| M2 | Admin setup auth endpoint lacks tight rate limiting | `src/routes/admin.ts:102` | **Fix approved** |
| M3 | Admin password comparison not timing-safe | `src/routes/admin.ts:87,104,130` | **Fix approved** |
| M4 | Admin setup accepts 4-character passwords | `src/routes/admin.ts:173` | **Fix approved** |
| M5 | TOTP secrets stored unencrypted by default | `src/config.ts:489` | **Fix approved** |
| M6 | Dev mode silently wipes accounts, no production guard | `src/routes/ghii.ts:112-126` | **Fix approved** |
| M7 | Extension memory limits use `Math.max()` (extensions can exceed admin caps) | `src/routes/extensions.ts:1028-1032,1253-1257` | **Fix approved** |
| M8 | Extension can drain caller's entire morsel balance in one call | `src/routes/extensions.ts:961-972` | **Fix approved** |
| M9 | Consent expiry job is a no-op (empty function) | `src/services/consent.ts:144-158` | **Fix approved** |
| M10 | No `process.on('unhandledRejection')` handler | `src/index.ts` (absent) | **Fix approved** |
| M11 | scrypt uses default (low) N=16384 parameters | `src/services/password.ts:12` | **Fix approved** |
| M12 | Node key stored unencrypted; `0o600` not enforced on Windows | `src/auth/node-keys.ts:105-107` | **Fix approved** |
| M13 | Many POST routes lack Zod schema validation (~66 routes) | Various | **Fix approved (incremental)** |
| M14 | CSP removed entirely for generator/foundry test pages | `src/routes/generator.ts:669`, `src/routes/foundry.ts:619` | **Fix approved** |
| M15 | No cascade delete transaction/rollback in GDPR delete | `src/routes/owners.ts:619-663` | **Fix approved (part of C2)** |

### LOW

| ID | Finding | File(s) | Status |
|----|---------|---------|--------|
| L1 | `safeAddColumn` uses string interpolation (not exploitable, all hardcoded) | `src/storage/providers/sqlite/schema.ts:1176` | **Track** |
| L2 | Content-Disposition header interpolation (validated at write time) | `src/routes/apps.ts:220`, `src/routes/packages.ts:567` | **Fix approved** |
| L3 | Agent JWT TTL defaults to 90 days | `src/config.ts:429` | **Track (document trade-off)** |
| L4 | SSE broadcasts all change events to all authenticated users | `src/routes/sse.ts:71-73` | **Fix approved** |
| L5 | Interests stored under fabricated agent GAII during web registration | `src/routes/ghii.ts:625-636` | **Fix approved** |
| L6 | Extension notifications use `req.auth!.sub` instead of `resolveIdentity()` | `src/routes/extensions.ts:1013,1017,1238,1242` | **Fix approved** |
| L7 | WebSocket accepts JWT via query parameter (unavoidable for WS) | `src/index.ts:489-491` | **Track (document trade-off)** |
| L8 | Global JSON body limit is 15MB | `src/server.ts:58` | **Fix approved** |
| L9 | TOTP backup codes only 4 bytes entropy (8 hex chars) | `src/services/totp.ts:53` | **Fix approved** |
| L10 | Transaction IDs use `Math.random()` instead of `crypto.randomUUID()` | `src/routes/owners.ts:81`, `src/routes/extensions.ts:965` | **Fix approved** |
| L11 | Upload token used-set is in-memory only (multi-process gap) | `src/services/upload-token.ts:25` | **Track (document trade-off)** |
| L12 | Rate limiter falls back to shared `'unknown'` key when no IP | `src/middleware/rate-limit.ts:29` | **Fix approved** |

### ADDITIONAL (found during SSRF/federation investigation)

| ID | Finding | File(s) | Severity | Status |
|----|---------|---------|----------|--------|
| A1 | Admin federation join lacks SSRF validation | `src/routes/admin-monitoring.ts:66` | MEDIUM | **Fix approved** |
| A2 | Capability webhook SSRF validation incomplete (no DNS resolution) | `src/services/capability-invoke.ts:74-88` | MEDIUM | **Fix approved** |
| A3 | Federation auth refresh is unauthenticated and unused | `src/routes/federation-auth.ts:148-206` | HIGH | **Fix approved (delete or secure)** |
| A4 | Federation attestation scopes are hardcoded, no node-level auth policy | `src/routes/federation-auth.ts:122`, `src/routes/ghii.ts:310` | MEDIUM | **Fix approved (Plan 36)** |
| A5 | Security headers only set when public directory exists | `src/server-bootstrap/static-files.ts:29` | LOW | **Fix approved** |
| A6 | Upload endpoint leaks internal error messages | `src/routes/upload.ts:98` | LOW | **Fix approved** |
| A7 | No cascade delete verification or rollback | `src/routes/owners.ts:619-663` | MEDIUM | **Fix approved (part of C2)** |
| A8 | Relaxed CSP on app catalog and inline apps (`unsafe-inline`) | `src/server-bootstrap/static-files.ts:110-120` | MEDIUM | **Accepted risk (user apps need CDN)** |
| A9 | Subscription callback URLs not re-validated over time | `src/routes/boards.ts` | LOW | **Track** |
| A10 | Extension `getPublic()` fallback searches all owner's agents | `src/routes/extensions.ts:901-913` | LOW | **Track** |
| A11 | Apps federation peer fetch lacks SSRF validation | `src/routes/apps.ts:73` | LOW | **Fix approved** |

---

## 2. Positive Findings

These areas are well-implemented and need no changes:

1. **Ed25519 JWT with algorithm pinning** (`algorithms: ['EdDSA']`) -- prevents alg confusion attacks
2. **Full token revocation system** with storage-backed persistence, L1 cache, and periodic cleanup
3. **scrypt password hashing with timing-safe comparison** for user passwords
4. **TOTP 2FA** with replay protection, lockout after failures, encrypted backup codes
5. **CSP nonce injection** on all main HTML pages
6. **SSRF validation** on webhooks, federation, boards, work, catalogue sync (13 files)
7. **No SQL injection** -- all SQLite queries use parameterized statements
8. **No NoSQL injection** -- Prisma ORM prevents it
9. **No command injection** -- no `child_process.exec()` with user input anywhere
10. **No prototype pollution** -- validated inputs, no raw `__proto__` merge patterns
11. **Proper error handling** -- stack traces logged server-side, generic messages to clients
12. **Sensitive field masking** in logger (token, password, private_key, secret, etc.)
13. **IDOR protection** -- consistent ownership checks across routes
14. **Federated session restrictions** -- capped 1-hour TTL, no operator access
15. **Upload token system** -- single-use, size-enforced, EdDSA signed, empty body check
16. **SSRF protection utility** -- `validateOutboundUrl()` with DNS resolution anti-rebinding

---

## 3. User Decisions

### Accepted Risks (no fix needed)

**H2 -- CORS wildcard default:** Intentional by design. Documented in RFC Section 35, previous security audit (`docs/securityaudit/04-infrastructure-config.md` Section 4.3), CORS per-entity plan, implementation prompt, and multiple architecture docs. The system is an open protocol for AI agents. JWT Bearer auth (not cookies) eliminates CSRF. Operators can tighten via the 4-level hierarchy (node -> GHII -> agent -> memory key) when needed.

**A8 -- Relaxed CSP on app catalog/inline apps:** Required for user-generated HTML apps that load CDN resources. `frame-ancestors 'self'` mitigates clickjacking. Accepted trade-off for app platform functionality.

### Tracked (no fix, document trade-off)

- **L3** -- 90-day agent JWT TTL: Session revocation system mitigates. Document the trade-off.
- **L7** -- WebSocket JWT in query parameter: Browsers cannot set Authorization headers for WS upgrades. SSE ticket pattern exists as reference for future improvement.
- **L11** -- Upload token in-memory only: Single-use + 60-min TTL limits exposure. Document multi-process gap.
- **A9** -- Subscription callback URL re-validation: Low practical risk, can add TTL later.
- **A10** -- Extension `getPublic()` agent fallback: Low risk, performance concern only at scale.
- **L1** -- safeAddColumn string interpolation: Not exploitable (all arguments hardcoded).

---

## 3b. A3 Deep Dive -- Federation Auth Refresh

**Upgraded from MEDIUM/Track to HIGH/Fix** after investigation revealed:

### The Problem

`POST /v1/federation/auth/refresh` (lines 148-206 of `federation-auth.ts`) is designed to let a remote node obtain a fresh signed attestation without re-asking for the user's password. However:

1. **No authentication whatsoever** -- no JWT, no node-to-node Ed25519 signature, no peer verification. Compare with `federation-sync.ts` which verifies peer signatures on every request.
2. **No password required** -- unlike `/verify` which checks the password, `/refresh` only checks that the GHII exists and an active auth consent is present.
3. **`requesting_node` is not verified** -- any string can be passed. It is not checked against the known peers map. An attacker who knows a valid GHII (public information in a federated network) and guesses or discovers a consented node name can obtain a signed attestation.
4. **The signed attestation is powerful** -- the remote node uses it to issue a federated JWT with `memory:read`, `memory:write`, `work:request`, `catalogue:read` scopes, valid for 1 hour.

### Who Uses It?

**Nobody in production.** Investigation found:
- No server-side code calls this endpoint (not in `ghii.ts`, not in any federation service)
- The client-side library (`libs.ts` line 447) explicitly **refuses** to refresh federated sessions: `if (session.federated) { throw new Error('Federated session expired. Please log in again.') }`
- Only the test suite (`test/federation-mesh.ts`) exercises it (4 test cases)

### Attack Scenario

An attacker who knows:
- A valid GHII (`alice@aimeat-fi-001-genesis`) -- discoverable via public catalogue
- A node name that the user has consented to (`node:partner-node`) -- could be guessed or discovered

...can call `POST /v1/federation/auth/refresh` and receive a signed attestation that lets them impersonate the user on the requesting node for 1 hour, repeatable indefinitely.

### Recommendation

**Delete the endpoint.** It has no consumers, the client-side library explicitly rejects federated refresh, and it provides an unauthenticated path to obtain signed attestations. If federated session refresh is needed in the future, it should use node-to-node Ed25519 signatures (like `federation-sync.ts`) and verify the requesting node against the peers map.

---

## 3c. Regression Risk Analysis

Before implementing fixes, these risks must be mitigated to avoid introducing new problems:

### CRITICAL RISK: M11 (scrypt parameter change)

The current hash format is `salt_hex:key_hex` -- it does **NOT** store the N/r/p cost parameters. If we change scrypt params from `N=16384` to `N=32768`, **every existing password hash becomes unverifiable**. The `verifyPassword()` function will derive a different key.

**Mitigation:** Add a version prefix to the hash format. New hashes: `v2:salt:key`. Old hashes (no prefix): verify with old params, then re-hash with new params on successful login. This is a gradual migration.

### HIGH RISK: L8 (body size 15MB to 5MB)

Inline app publish sends base64-encoded HTML in JSON body. A 5MB app becomes ~6.7MB after base64 encoding. Reducing the global limit to 5MB would **break inline app publishing** for apps larger than ~3.75MB.

**Mitigation:** Keep 15MB global default OR add per-route `express.json({ limit: '15mb' })` overrides on app publish, extension install, and cortex install routes. The presigned upload flow (which bypasses body parsing) is unaffected.

### MODERATE RISK: H3 (login rate limit)

`e2e-auth-lib.ts` makes exactly 10 login calls from one IP. A rate limit of 10/min would be borderline. Playwright tests add ~3-4 more calls.

**Mitigation:** Use 15/min instead of 10/min for the per-route limit. This still provides meaningful brute-force protection while allowing test suites to pass.

### MODERATE RISK: M14 (CSP on generator/foundry)

Test pages at `generator.ts:669` and `foundry.ts:619` intentionally call `res.removeHeader('Content-Security-Policy')` because AI-generated test code uses `eval()`. Git history shows CSP nonce issues have been a recurring bug source (commits `a2a6558`, `40dabeb`, `8eef121`).

**Mitigation:** Do NOT re-add CSP to test-page routes. Only add a relaxed CSP to the non-test pages served by these routers (live preview, etc.), if any exist without eval() needs.

### SAFE: H4 (extension auth for ?full=true)

MCP tools call `storage.getExtension()` directly, never the HTTP endpoint. No frontend code uses `?full=true`. Adding auth to `?full=true` has zero regression risk.

### SAFE: C2 (GDPR cascade additions)

No E2E tests rely on data persisting after owner deletion. Tests use cascade delete as cleanup at the end of runs. Adding more delete calls is safe.

### Additional findings from cascade investigation

The SQLite `deleteOwner()` already handles most data categories at the storage level. The gap is mainly in the route-level cascade at `owners.ts`, which misses:
- `capabilities` (has `ownerGhii` column)
- `scheduled_jobs` (has `ownerGhii` column)
- `device_auth` (has `ownerName` column)
- `sessions` (active JWT sessions survive owner deletion)
- `apps` (has `ownerGaii` and `ownerName` columns)

---

## 4. Fix Plans

### Plan 1: C1 -- Extension SSRF Protection

**What:** Extension `ctx.fetch()` calls Node.js `fetch()` with no URL validation. On multi-tenant nodes, any owner's extension can reach internal services (cloud metadata at 169.254.169.254, localhost, private IPs).

**Where:** The actual fetch path is in the QuickJS sandbox host function. The route-level `ctx.fetch` in `extensions.ts` is dead code (the runtime ignores it) but should be fixed for consistency.

**Changes:**

1. **`src/services/extension-runtime.ts` line ~297** -- Add `validateOutboundUrl(url)` before the `fetch()` call:
   ```typescript
   import { validateOutboundUrl } from '../utils/url-validator.js';
   
   // Inside __fetch host function:
   await validateOutboundUrl(url);  // Blocks private/reserved IPs, does DNS resolution
   const resp = await fetch(url, { ... });
   ```

2. **`src/routes/extensions.ts` lines ~916 and ~1138** -- Add the same validation to the dead-code `ctx.fetch` for consistency (or remove these since the runtime ignores them).

**Risk:** Extensions that legitimately need to call localhost in dev mode will be blocked. `validateOutboundUrl()` already has a dev-mode bypass for loopback, so this should be fine.

---

### Plan 2: C2 -- GDPR Cascade Delete Completion

**What:** `DELETE /v1/owners/:name` only deletes agents, their memories, actions, transactions, and the owner record. The GDPR export handler at lines 195-617 correctly enumerates 15+ additional data categories that are NOT deleted.

**Where:** `src/routes/owners.ts` lines 619-663.

**Changes:** Mirror the export logic. After existing agent cleanup, add deletion calls for each missing category:

```
1.  deleteGHII(ghii)                           -- password hash, TOTP, email
2.  For each board: delete posts by author      -- need deletePostsByAuthor() or iterate
3.  deleteConsents by grantor (ownerGhii)       -- consent records
4.  Delete consent audit entries by gaii
5.  Delete flags filed by gaii
6.  Delete storage files by owner
7.  Delete board subscriptions by agent
8.  Delete/return escrow holds
9.  Delete marketplace listings by owner
10. Delete purchases (as buyer and seller)
11. Delete matches involving owner
12. Delete organism memberships
13. Delete chat instances
14. Delete personal node record
15. Delete push subscriptions
16. Delete notification preferences
17. Delete extension instances owned by user
18. Delete knowledge contributions
```

**Storage interface additions needed:** Bulk-delete methods like `deletePostsByAuthor(gaii)`, `deleteConsentsByGrantor(gaii)`, `deleteStorageFilesByOwner(gaii)`, `deleteFlagsByActor(gaii)` to avoid O(n) iteration.

**Transaction wrapping:** SQLite: wrap in `db.transaction()`. MongoDB: use Prisma `$transaction()`. Log each step's success/failure. Return a deletion report to the caller.

**Risk:** Large operation that touches many storage methods. Must be tested thoroughly against both backends.

---

### Plan 3: H1 -- Stop Logging Admin Password

**What:** Admin password appears in plain text in logs on every startup.

**Where:** `src/index.ts` lines 409-411.

**Changes:**
```typescript
// BEFORE:
logger.info(`   Admin Setup: ${config.baseUrl}/v1/admin/setup?pw=${config.adminPassword}`);
if (!process.env.AIMEAT_ADMIN_PASSWORD) {
  logger.info(`   Admin Secret: ${config.adminPassword}`);
}

// AFTER:
logger.info(`   Admin Setup: ${config.baseUrl}/v1/admin/setup`);
if (!process.env.AIMEAT_ADMIN_PASSWORD) {
  // Write to stderr once, not to logger (avoids log aggregation systems)
  process.stderr.write(`   Admin Secret: ${config.adminPassword}\n`);
}
```

**Risk:** None. Operators using log aggregation will stop seeing the password. The URL hint still shows the path. Auto-generated password still shows on stderr for interactive first-run.

---

### Plan 4: H3 -- Login Brute-Force Protection

**What:** `POST /v1/ghii/login` has no per-route rate limit and no per-account lockout for password-only accounts. TOTP has lockout, passwords do not.

**Where:** `src/routes/ghii.ts` around line 225.

**Changes:**

1. **Per-route rate limit** on `POST /v1/ghii/login`:
   ```typescript
   router.post('/v1/ghii/login', rateLimit({ max: 15, windowMs: 60_000 }), async (req, res) => { ... });
   ```
   Note: 15/min (not 10/min) to avoid breaking E2E tests which make ~13 login calls per run.

2. **Per-account progressive lockout** (mirrors TOTP lockout pattern):
   - Add `passwordFailedAttempts` and `passwordLockedUntil` fields to `GHIIRecord`
   - On failed password: increment `passwordFailedAttempts`. After 5 failures, set `passwordLockedUntil = now + 15 minutes`.
   - On successful login: reset both fields to 0/null.
   - Check lockout before password comparison.
   - Storage sync: add fields to both SQLite and MongoDB backends.

**Risk:** Legitimate users who forget passwords will be locked out for 15 minutes. This is standard behavior. Magic link login (if email is verified) bypasses password lockout.

---

### Plan 5: H4 -- Gate Extension Script Content Behind Auth

**What:** `GET /v1/extensions/:name?full=true` returns JavaScript source code to anyone. No frontend code or cortex/extension chain uses this.

**Where:** `src/routes/extensions.ts` lines 251-283.

**Changes:** Keep the endpoint publicly accessible for metadata (needed for extension discovery), but gate `?full=true` behind auth:

```typescript
router.get('/v1/extensions/:name', optionalAuth(), async (req, res) => {
  // ... existing code to load extension ...
  
  const wantFull = req.query.full === 'true';
  
  if (wantFull) {
    // Script content requires authentication + owner/operator role
    if (!req.auth || (!req.auth.roles.includes('owner') && !req.auth.roles.includes('operator'))) {
      return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Script content requires authentication'));
    }
  }
  
  // Strip scriptContent when not authorized for full view (existing behavior for ?full absent)
  const actions = ext.actions.map(a => {
    const { scriptContent, ...meta } = a;
    return wantFull ? a : meta;
  });
  // ...
});
```

**Risk:** None. No anonymous caller needs script content. Cortex calls extensions through `POST /v1/ext/` which reads scripts server-side from storage.

---

### Plan 6: H5 -- Extension Email Authorization System

**What:** `ctx.email(to, subject, body)` sends to any address with no checks. Extensions can be full applications, so completely blocking email is wrong. Instead, implement a tiered authorization model.

**Where:** `src/routes/extensions.ts` lines 1020-1023 and 1245-1248, `src/services/scheduler.ts` lines 433-438.

**Changes:** Three-tier model:

- **Tier 0 (self-only, default):** Extension can only email the calling user's own verified `notificationEmail`. Requires `verificationLevel >= 1`. This is the default for all extensions.

- **Tier 1 (consented recipients):** Allow emailing any user who has granted an active consent with `purpose: 'extension_email'` and `recipient` matching the extension name or caller GAII. Uses existing consent system (`matchesRecipient()`).

- **Tier 2 (operator-granted unrestricted):** Operator can grant an extension-level permission flag (`emailPolicy: 'unrestricted'`) stored on `ExtensionRecord.config`. Only operator can set this.

**Implementation in the email lambda:**
```typescript
email: async (to: string, subject: string, body: string) => {
  if (!emailService?.enabled) return false;
  
  const callerGhii = `${req.auth!.owner}@${config.nodeId}`;
  const ghiiRecord = await storage.getGHII(callerGhii);
  
  // Tier 2: operator-granted unrestricted
  if (ext.config?.emailPolicy === 'unrestricted') {
    return emailService.sendNotification(to, subject, body);
  }
  
  // Tier 0: self-only (caller's own verified email)
  if (ghiiRecord?.notificationEmail === to && ghiiRecord.emailVerifiedAt) {
    return emailService.sendNotification(to, subject, body);
  }
  
  // Tier 1: check consent
  const consents = await storage.listConsents(callerGhii, { status: 'active' });
  const hasEmailConsent = consents.some(c => 
    c.purpose === 'extension_email' && c.dataPattern === `ext:${ext.name}`
  );
  if (hasEmailConsent) {
    return emailService.sendNotification(to, subject, body);
  }
  
  logger.warn(`[ext:${ext.name}] Email blocked: ${callerGhii} has no authorization to email this recipient`);
  return false;
},
```

**Config addition:** `extensionEmailPolicy` on `ExtensionRecord.config` (operator-settable).

**Risk:** Extensions that currently send email to arbitrary addresses will stop working unless the operator grants tier 2. This is the intended behavioral change.

---

### Plan 7: H6 -- Token Refresh Role Revalidation

**What:** `POST /v1/auth/refresh` copies roles from the old JWT without checking storage. Revoked permissions persist through refresh chains.

**Where:** `src/routes/auth.ts` lines 356-382.

**Changes:**
```typescript
// Inside refresh handler, after verifying the old token:
const ownerRecord = await storage.getOwner(req.auth!.owner);
if (!ownerRecord) {
  return res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Owner not found'));
}

let freshRoles: string[];
if (req.auth!.roles.includes('agent')) {
  // Agent session: re-read agent's scopes from storage
  const agent = await storage.getAgent(req.auth!.sub);
  if (!agent || agent.status !== 'active') {
    return res.status(401).json(error(config.nodeId, 'UNAUTHORIZED', 'Agent no longer active'));
  }
  freshRoles = ['agent'];
  // Use agent.scopes for the new token's scope claim
} else {
  // Owner session: re-read owner's roles
  freshRoles = ownerRecord.roles ?? ['owner'];
}

// Use freshRoles instead of req.auth!.roles when minting the new JWT
```

**Risk:** If an operator demotes themselves and then refreshes, the new token will reflect the demotion. This is correct behavior.

---

### Plan 8: M3 -- Timing-Safe Admin Password Comparison

**What:** Admin password compared with JavaScript `!==`, susceptible to timing attacks.

**Where:** `src/routes/admin.ts` lines 87, 104, 130.

**Changes:**
```typescript
import { timingSafeEqual } from 'node:crypto';

function verifyAdminPassword(input: string, expected: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Replace all three locations:
// BEFORE: if (!config.adminPassword || pw !== config.adminPassword)
// AFTER:  if (!config.adminPassword || !verifyAdminPassword(pw, config.adminPassword))
```

**Risk:** None. Pure security improvement.

---

### Plan 9: M4 -- Enforce Strong Admin Passwords

**What:** Admin setup registration accepts 4-character passwords while regular registration requires 8+ with complexity.

**Where:** `src/routes/admin.ts` line 173.

**Changes:** Replace the `password.length >= 4` check with the existing `validatePasswordStrength()` from `ghii.ts`:

```typescript
import { validatePasswordStrength } from './ghii.js';  // or extract to shared utility

// Replace: if (password.length < 4)
// With: 
const pwError = validatePasswordStrength(password);
if (pwError) {
  return res.status(400).json(error(config.nodeId, 'WEAK_PASSWORD', pwError));
}
```

If `validatePasswordStrength` is not already exported, extract it to a shared utility (e.g., `src/utils/password-validation.ts`).

**Risk:** Existing admin accounts with weak passwords are unaffected (already hashed). Only new registrations through setup wizard are gated.

---

### Plan 10: M1 -- Registration Rate Limiting

**What:** `POST /v1/ghii` (and `/v1/ghii/register-web`) have no per-route rate limit. Mass account creation possible.

**Where:** `src/routes/ghii.ts` line 50.

**Changes:**
```typescript
const registrationLimit = rateLimit({ max: 3, windowMs: 60_000 });
router.post('/v1/ghii', registrationLimit, async (req, res) => { ... });
router.post('/v1/ghii/register-web', registrationLimit, async (req, res) => { ... });
```

**Risk:** Legitimate batch testing in dev mode would hit the limit. The limit is IP-based, so different IPs can still register. Dev mode could use a higher limit.

---

### Plan 11: M2 -- Admin Setup Auth Rate Limiting

**What:** Admin setup auth endpoints share the global rate limit (too high for password auth).

**Where:** `src/routes/admin.ts` line 102.

**Changes:**
```typescript
const adminAuthLimit = rateLimit({ max: 5, windowMs: 60_000 });
router.post('/v1/admin/setup/auth', adminAuthLimit, async (req, res) => { ... });
router.post('/v1/admin/setup/register', adminAuthLimit, async (req, res) => { ... });
router.post('/v1/admin/setup/token', adminAuthLimit, async (req, res) => { ... });
```

**Risk:** None. Operator hitting 5 login attempts per minute is already suspicious.

---

### Plan 12: M5 -- TOTP Encryption Warning

**What:** TOTP secrets stored unencrypted when `AIMEAT_TOTP_ENCRYPTION_KEY` is not set.

**Where:** `src/config.ts` line 489, `src/index.ts` (startup).

**Changes:** Add a startup warning (not a hard block, to avoid breaking existing setups):

```typescript
// In index.ts startup, after config is loaded:
if (config.totpEnabled && !config.totpSecretEncryptionKey) {
  logger.warn('SECURITY: TOTP is enabled but AIMEAT_TOTP_ENCRYPTION_KEY is not set.');
  logger.warn('TOTP secrets are stored in plaintext. Set the key to encrypt them.');
}
```

Also add to the init wizard a prompt for TOTP encryption key when TOTP is enabled.

**Risk:** None. Warning only, no behavioral change.

---

### Plan 13: M6 -- Dev Mode Production Guard

**What:** Dev mode silently wipes and re-creates accounts on duplicate registration. No guard against accidental production use.

**Where:** `src/routes/ghii.ts` lines 112-126, `src/index.ts` (startup).

**Changes:** Add startup warning when dev mode is on and indicators suggest production:

```typescript
// In index.ts startup:
if (config.devMode) {
  const isProd = config.db !== 'memory' || 
    (config.baseUrl && !config.baseUrl.includes('localhost') && !config.baseUrl.includes('127.0.0.1'));
  if (isProd) {
    logger.warn('WARNING: Dev mode is ON with non-local configuration.');
    logger.warn('Dev mode allows account wipe on duplicate registration. Disable for production.');
  }
}
```

**Risk:** None. Warning only.

---

### Plan 14: M7 -- Extension Memory Limit Cap

**What:** `Math.max(ext.limits.memoryMb, config.extensionMaxMemoryMb)` lets extensions exceed admin caps.

**Where:** `src/routes/extensions.ts` lines 1028-1032 and 1253-1257.

**Changes:** Use `Math.min()` for the cap, `Math.max()` for the floor:

```typescript
// Cap at system maximum, floor at extension's declared minimum
const memoryMb = Math.min(
  Math.max(ext.limits?.memoryMb ?? config.extensionMaxMemoryMb, 16),  // floor: 16MB
  config.extensionMaxMemoryMb  // cap: system max
);
```

Apply same pattern to `timeoutMs` and `maxApiCalls`.

**Risk:** Extensions that relied on exceeding the system cap will now be constrained. This is correct behavior.

---

### Plan 15: M8 -- Extension Wallet Spending Cap

**What:** Extension `wallet.consume()` can drain the entire balance in one call.

**Where:** `src/routes/extensions.ts` lines 961-972.

**Changes:** Add a per-call cap configurable by the node operator:

```typescript
// In config.ts:
extensionMaxDebitPerCall: parseInt(process.env.AIMEAT_EXT_MAX_DEBIT ?? '100', 10),

// In the wallet.consume lambda:
wallet: {
  consume: async (amount: number, reason: string) => {
    if (amount > config.extensionMaxDebitPerCall) {
      logger.warn(`[ext:${ext.name}] Debit blocked: ${amount} exceeds max ${config.extensionMaxDebitPerCall}`);
      throw new Error(`DEBIT_LIMIT: max ${config.extensionMaxDebitPerCall} morsels per call`);
    }
    // ... existing debit logic
  }
}
```

**Risk:** Extensions that legitimately need large debits will need the operator to raise the cap. Config-driven, so operators can adjust.

---

### Plan 16: M9 -- Implement Consent Expiry Sweep

**What:** `expireConsents()` is an empty function. Expired consents remain "active" in the database.

**Where:** `src/services/consent.ts` lines 144-158.

**Changes:**
```typescript
export async function expireConsents(storage: Storage): Promise<number> {
  const now = new Date().toISOString();
  const activeConsents = await storage.listAllConsents({ status: 'active' });
  let expiredCount = 0;
  
  for (const consent of activeConsents) {
    if (consent.expires && consent.expires < now) {
      await storage.updateConsent(consent.id, { status: 'expired' });
      expiredCount++;
    }
  }
  
  return expiredCount;
}
```

Ideally add a `storage.expireConsentsBefore(date)` bulk method to do this in a single query.

**Risk:** None. Consents that should have expired will now expire proactively.

---

### Plan 17: M10 -- Add Unhandled Rejection Handler

**What:** No global handler for unhandled promise rejections. Background services can crash the process.

**Where:** `src/index.ts`.

**Changes:**
```typescript
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', { 
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined
  });
});
```

**Risk:** None. Prevents silent crashes.

---

### Plan 18: M11 -- Strengthen scrypt Parameters (REQUIRES MIGRATION STRATEGY)

**What:** Default scrypt N=16384 is below 2025 OWASP recommendation.

**Where:** `src/services/password.ts` line 12.

**CRITICAL REGRESSION RISK:** The current hash format is `salt_hex:key_hex` with NO stored cost parameters. Changing N/r/p would break ALL existing password verification. This needs a versioned migration approach.

**Changes (versioned migration):**

1. Add version prefix to new hashes: `v2:salt_hex:key_hex`
2. `hashPassword()` always produces `v2:` hashes with new params
3. `verifyPassword()` detects format:
   - `v2:salt:key` -- verify with new params (N=32768)
   - `salt:key` (no prefix) -- verify with old params (N=16384, Node.js defaults)
4. On successful login with old-format hash, re-hash with new params and update storage (transparent upgrade)

```typescript
const SCRYPT_V2 = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16);
    scrypt(password, salt, 64, SCRYPT_V2, (err, key) => {
      if (err) return reject(err);
      resolve(`v2:${salt.toString('hex')}:${key.toString('hex')}`);
    });
  });
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const isV2 = hash.startsWith('v2:');
    const parts = isV2 ? hash.slice(3).split(':') : hash.split(':');
    const salt = Buffer.from(parts[0], 'hex');
    const storedKey = Buffer.from(parts[1], 'hex');
    const opts = isV2 ? SCRYPT_V2 : {};  // empty = Node.js defaults (N=16384)
    
    scrypt(password, salt, 64, opts, (err, key) => {
      if (err) return reject(err);
      resolve(timingSafeEqual(key, storedKey));
    });
  });
}

// Caller (login handler) adds transparent upgrade:
// if (valid && !hash.startsWith('v2:')) {
//   const newHash = await hashPassword(password);
//   await storage.updateGHIIPasswordHash(ghii, newHash);
// }
```

**Risk:** Minimal with versioned approach. Old hashes work forever. New hashes use stronger params. Transparent upgrade on next login.

---

### Plan 19: M12 -- Node Key Encryption Warning

**What:** On Windows, `0o600` file permissions are not enforced. Node key is plaintext.

**Where:** `src/auth/node-keys.ts` lines 105-107.

**Changes:** Add platform-aware warning at startup:

```typescript
if (process.platform === 'win32' && !config.keyPassphrase) {
  logger.warn('SECURITY: Node key is stored unencrypted and Windows does not enforce Unix file permissions.');
  logger.warn('Set AIMEAT_KEY_PASSPHRASE to encrypt the node key at rest.');
}
```

**Risk:** None. Warning only.

---

### Plan 20: M13 -- Incremental Zod Schema Validation

**What:** ~66 POST/PUT routes lack Zod schema validation, relying on ad-hoc checks.

**Approach:** This is incremental work, not a single fix. Priority order:

1. **Public-facing endpoints without auth:** `POST /v1/ghii` (registration), `POST /v1/ghii/login`, `POST /v1/ghii/register-web`
2. **Federation endpoints:** All `POST /v1/federation/*` routes
3. **Consent routes:** `POST /v1/consent`
4. **Flag routes:** `POST /v1/flags`
5. **Extension install:** `POST /v1/extensions`
6. **Remaining routes** by usage frequency

Each schema should enforce: field types, string length limits, array size limits (max 100 items unless justified), and reject unknown fields.

**Risk:** Overly strict schemas could reject previously-accepted inputs. Test each schema against existing E2E tests.

---

### Plan 21: M14 -- Use Relaxed CSP Instead of No CSP (CAREFUL -- NONCE HISTORY)

**What:** Generator/foundry test pages remove CSP entirely to allow `eval()`.

**Where:** `src/routes/generator.ts:669`, `src/routes/foundry.ts:619`.

**REGRESSION RISK:** CSP nonces have been a recurring source of bugs (commits `a2a6558`, `40dabeb`, `8eef121`). The current code already injects nonce attributes into script tags in these pages -- they are harmlessly present because CSP is removed. Changing CSP here requires careful testing.

**Changes:** Replace `removeHeader` with a relaxed CSP that allows eval but still provides other protections:
```typescript
// BEFORE:
res.removeHeader('Content-Security-Policy');

// AFTER:
res.setHeader('Content-Security-Policy', 
  "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'self'"
);
```

**Risk:** AI-generated test code that loads external CDN scripts would be blocked by `script-src 'self'`. If test pages need external resources, add `https:` to `script-src`. These are operator-only endpoints. Must test with actual generator output.

---

### Plan 22: A1 -- Admin Federation Join SSRF Check

**Where:** `src/routes/admin-monitoring.ts` line 66.

**Changes:** Add `await validateOutboundUrl(genesis_url)` before fetching `${genesis_url}/.well-known/aimeat`.

---

### Plan 23: A2 -- Capability Webhook SSRF Fix

**Where:** `src/services/capability-invoke.ts` lines 74-88.

**Changes:** Replace the manual hostname blocklist with `await validateOutboundUrl(capability.webhookUrl)` which includes DNS resolution.

---

### Plan 24: A11 -- Apps Federation Peer Fetch SSRF Check

**Where:** `src/routes/apps.ts` line 73.

**Changes:** Add `await validateOutboundUrl(peer.url)` as defense-in-depth before fetching from peer.

---

### Plan 25: L2 -- Content-Disposition Defense-in-Depth

**Where:** `src/routes/apps.ts:220`, `src/routes/packages.ts:567`.

**Changes:** Add `filename.replace(/["\\]/g, '_')` before header interpolation.

---

### Plan 26: L4 -- SSE Event Filtering by Identity

**Where:** `src/routes/sse.ts` lines 71-73.

**Changes:** Filter events based on the ticket's `sub` identity. Only forward events relevant to the connected user's owned data (their GHII + their agents).

---

### Plan 27: L5 -- Store Interests Under Owner GHII

**Where:** `src/routes/ghii.ts` lines 625-636.

**Changes:** Replace `app#${username}@${config.nodeId}` with `${username}@${config.nodeId}` (the owner's GHII).

---

### Plan 28: L6 -- Use resolveIdentity() for Extension Notifications

**Where:** `src/routes/extensions.ts` lines 1013, 1017, 1238, 1242.

**Changes:** Replace `req.auth!.sub` with `resolveIdentity(req.auth!, config.nodeId)`.

---

### Plan 29: L8 -- Reduce Default JSON Body Limit (WITH PER-ROUTE OVERRIDES)

**Where:** `src/server.ts` line 58.

**REGRESSION RISK:** Inline app publish sends base64-encoded HTML in JSON body. A 5MB app becomes ~6.7MB after base64. Reducing to 5MB would break inline publishing for apps >3.75MB.

**Changes:** Reduce global default but add per-route overrides for routes that need larger payloads:

```typescript
// Global default (covers most API routes)
app.use(express.json({ limit: '5mb' }));

// Per-route overrides for routes that legitimately need larger bodies:
// - App publish (inline mode): base64-encoded apps up to appMaxSizeMb
// - Extension install (inline mode): manifest + scripts
// - Cortex install (inline mode): manifest + libs
// These routes also have their own size validation (config.appMaxSizeMb, extensionMaxCodeSizeKb)
router.post('/v1/apps', express.json({ limit: '15mb' }), ...);
router.post('/v1/extensions', express.json({ limit: '15mb' }), ...);
router.post('/v1/cortex', express.json({ limit: '15mb' }), ...);
```

Note: Presigned upload routes (`PUT /v1/upload/:token`) bypass JSON body parsing entirely and are unaffected.

---

### Plan 30: L9 -- Increase TOTP Backup Code Entropy

**Where:** `src/services/totp.ts` line 53.

**Changes:** `randomBytes(4)` -> `randomBytes(6)` (48 bits, 12 hex chars instead of 8).

**Risk:** Existing backup codes are already hashed in storage. New codes will be longer. Users must regenerate to get stronger codes.

---

### Plan 31: L10 -- Use crypto.randomUUID() for Transaction IDs

**Where:** `src/routes/owners.ts:81`, `src/routes/extensions.ts:965`.

**Changes:** Replace `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` with `tx-${randomUUID()}`.

---

### Plan 32: L12 -- Fix Rate Limiter Unknown Key Fallback

**Where:** `src/middleware/rate-limit.ts` line 29.

**Changes:**
```typescript
// BEFORE:
const key = req.auth?.sub ?? req.ip ?? 'unknown';

// AFTER:
const key = req.auth?.sub ?? req.ip ?? req.socket.remoteAddress ?? 'unknown';
```

Add a log warning when falling back to `'unknown'` to alert operators.

---

### Plan 33: A5 -- Security Headers Outside Public Directory Check

**Where:** `src/server-bootstrap/static-files.ts` line 29.

**Changes:** Move the security header middleware (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, HSTS) outside the `if (publicDir)` block so it applies to all responses.

---

### Plan 34: A6 -- Generic Error Message for Upload Failures

**Where:** `src/routes/upload.ts` line 98.

**Changes:**
```typescript
// BEFORE:
res.status(500).json({ success: false, error: 'PROCESSING_FAILED', message: (err as Error).message });

// AFTER:
logger.error('Upload processing failed', { error: (err as Error).message, stack: (err as Error).stack });
res.status(500).json({ success: false, error: 'PROCESSING_FAILED', message: 'Upload processing failed' });
```

### Plan 35: A3 -- Delete or Secure Federation Auth Refresh

**What:** `POST /v1/federation/auth/refresh` has no authentication, is not used by any production code, and allows anyone who knows a GHII + consented node name to obtain signed attestations.

**Where:** `src/routes/federation-auth.ts` lines 148-206.

**Recommended approach: Delete the endpoint.**

Reasons:
- No production consumer exists (client library explicitly refuses federated refresh)
- No server-side code calls it
- The endpoint provides an unauthenticated path to signed attestations
- Federated sessions already expire and force re-login (correct behavior)
- If federation refresh is needed in the future, it should be designed with node-to-node Ed25519 authentication (like `federation-sync.ts`)

**Changes:**
1. Delete lines 148-206 from `federation-auth.ts`
2. Remove the 4 test cases in `test/federation-mesh.ts` that exercise the endpoint
3. Document in the federation spec that federated sessions are non-refreshable by design

**Alternative (if keeping):** Add node-to-node authentication:
- Require the requesting node to sign the request body with its Ed25519 private key
- Verify the signature against the peers map
- Reject requests from unknown or inactive peers
- Add a `lastPasswordChangeAt` check to invalidate refreshes after password changes

**Risk:** None if deleting (no consumers). If securing instead, test against `federation-mesh.ts`.

---

### Plan 36: A4 -- Federation Auth Scope Configuration (Full Design)

**What:** Federation auth scopes are hardcoded in both the home node attestation and the receiving node login. The receiving node blindly trusts whatever scopes the home node sends. There is no node-level policy for which peers' users are allowed to log in or what they can do. The attestation signature is generated but never verified.

**This plan covers 4 parts:** receiving node policy, home node simplification, admin dashboard UI, and attestation signature verification.

#### Part 1: Receiving Node Policy (config + per-peer settings)

**Config additions** (`src/config.ts`):
```typescript
// New fields in AimeatConfig:
federationAuthPolicy: 'disabled' | 'all_peers' | 'specific_peers';  // default: 'disabled'
federationDefaultScopes: string[];  // default: ['memory:read', 'catalogue:read']
```

**Env vars:**
```
AIMEAT_FEDERATION_AUTH_POLICY=disabled          # disabled | all_peers | specific_peers
AIMEAT_FEDERATION_DEFAULT_SCOPES=memory:read,catalogue:read
```

Register both in `src/services/config-schema.ts` as mutable (runtime-changeable via admin config API).

**Per-peer storage additions** -- add to `PeerInfo` and `FederationPeerRecord`:
```typescript
allowFederatedAuth: boolean;      // default: false
federationAuthScopes: string[];   // default: [] (empty = use node default)
```

**SQLite migration** (`src/storage/providers/sqlite/schema.ts`):
```sql
ALTER TABLE federation_peers ADD COLUMN allowFederatedAuth INTEGER NOT NULL DEFAULT 0;
ALTER TABLE federation_peers ADD COLUMN federationAuthScopes TEXT NOT NULL DEFAULT '';
```
(`federationAuthScopes` stored as comma-separated string, parsed on read)

**MongoDB/Prisma migration:** Add `allowFederatedAuth: Boolean @default(false)` and `federationAuthScopes: String[]` to the Prisma schema.

**Logic change in `src/routes/ghii.ts`** (federated login flow, ~lines 258-312):

```typescript
// After finding the home peer:

// 1. Check node-level federation auth policy
if (config.federationAuthPolicy === 'disabled') {
  return res.status(403).json(error(config.nodeId, 'FEDERATION_AUTH_DISABLED',
    'This node does not accept federated logins'));
}

if (config.federationAuthPolicy === 'specific_peers' && !homePeer.allowFederatedAuth) {
  return res.status(403).json(error(config.nodeId, 'FEDERATION_AUTH_NOT_ALLOWED',
    'Federated login from this node is not permitted'));
}

// 2. ... existing verify call to home node ...

// 3. Determine scopes from RECEIVING node policy (not home node attestation)
const fedScopes = (homePeer.federationAuthScopes?.length > 0)
  ? homePeer.federationAuthScopes
  : config.federationDefaultScopes;

// 4. Issue local JWT with receiving-node-determined scopes
```

**Update `PUT /v1/federation/peers/:nodeId`** in `federation-peer.ts` to accept and persist `allowFederatedAuth` and `federationAuthScopes`.

#### Part 2: Home Node Simplification

**Change in `src/routes/federation-auth.ts`** `/verify` endpoint (line 122):

```typescript
// BEFORE:
scopes: ['memory:read', 'memory:write', 'work:request', 'catalogue:read'],

// AFTER: attestation focuses on identity, not authorization
// Keep the field for backward compat but mark it informational
scopes: [],  // Receiving node determines scopes per its own policy
```

The attestation now says: "This user authenticated successfully. Here is their identity." The receiving node decides what they can do.

#### Part 3: Admin Dashboard UI

**File:** `public/views/admin/federation-tab.js`

**Per-peer settings** (add alongside existing shareCatalogue/replicateMemory/allowRouting checkboxes):

1. **`allowFederatedAuth` checkbox:** "Allow federated login" -- visible only when `federationAuthPolicy` is `specific_peers`
2. **`federationAuthScopes` multi-select/checkboxes:** "Granted scopes" -- shown when `allowFederatedAuth` is checked
   - Available scopes: `memory:read`, `memory:write`, `catalogue:read`, `social:read`, `social:write`, `work:request`, `boards:read`, `boards:write`
   - Empty = use node defaults

**Global federation auth section** (new section in the tab, between stats and peers table):

```
Federation Auth Policy
---------------------
[dropdown: Disabled / All peers / Specific peers]

Default Scopes for Federated Users:
[x] memory:read    [ ] memory:write
[x] catalogue:read [ ] social:read
[ ] social:write   [ ] work:request
[ ] boards:read    [ ] boards:write
```

Save via existing admin config API (`PUT /v1/admin/config`).

**i18n keys** (add to both `locales/en.json` and `locales/fi.json`):
```json
"admin.federation.authPolicy": "Federation Auth Policy",
"admin.federation.authPolicy.disabled": "Disabled",
"admin.federation.authPolicy.allPeers": "All peers",
"admin.federation.authPolicy.specificPeers": "Specific peers (per-peer)",
"admin.federation.defaultScopes": "Default scopes for federated users",
"admin.federation.allowAuth": "Allow federated login",
"admin.federation.authScopes": "Granted scopes",
"admin.federation.authDisabledNote": "Federated authentication is disabled. Enable it to allow users from other nodes to log in here."
```

#### Part 4: Attestation Signature Verification

**File:** `src/routes/ghii.ts` (federated login flow, after receiving attestation)

Currently the code receives the attestation and trusts it. The home node signs it with Ed25519, but nobody verifies.

```typescript
// After receiving attestation from home node:
import { verify } from '../auth/keypair.js';

// The peer's public key is already in the peers map
if (homePeer.publicKey) {
  const attestationJson = JSON.stringify({
    // Reconstruct the signed payload (everything except the signature field)
    verified: attestation.verified,
    ghii: attestation.ghii,
    display_name: attestation.display_name,
    home_node: attestation.home_node,
    home_url: attestation.home_url,
    owner: attestation.owner,
    scopes: attestation.scopes,
    requesting_node: attestation.requesting_node,
    issued_at: attestation.issued_at,
    expires_at: attestation.expires_at,
  });
  
  const sigValid = await verify(homePeer.publicKey, attestationJson, attestation.signature);
  if (!sigValid) {
    logger.warn(`Federation attestation signature verification failed for ${ghii} from ${homePeer.nodeId}`);
    return res.status(401).json(error(config.nodeId, 'INVALID_ATTESTATION', 'Attestation signature invalid'));
  }
}
```

This prevents MITM attacks and ensures the attestation genuinely came from the claimed home node.

#### Files Changed Summary

| File | Changes |
|------|---------|
| `src/config.ts` | Add `federationAuthPolicy`, `federationDefaultScopes` |
| `src/services/config-schema.ts` | Register new mutable config fields |
| `src/routes/ghii.ts` | Policy check + receiving-node scope determination + signature verification |
| `src/routes/federation-auth.ts` | Remove hardcoded scopes from attestation (Part 2) |
| `src/routes/federation-peer.ts` | Accept `allowFederatedAuth` + `federationAuthScopes` in peer update |
| `src/services/federation.ts` | Add new fields to `PeerInfo` interface |
| `src/storage/interface.ts` | Add new fields to `FederationPeerRecord` |
| `src/storage/providers/sqlite/schema.ts` | Schema migration for new columns |
| `src/storage/providers/sqlite/repos/federation-peers.ts` | Read/write new fields |
| `src/storage/providers/mongodb/...` | Prisma schema + read/write new fields |
| `public/views/admin/federation-tab.js` | UI for auth policy + per-peer auth settings |
| `public/js/services/admin.js` | API calls for new settings |
| `public/css/views/admin.css` | Styling for new section |
| `locales/en.json` + `locales/fi.json` | i18n keys |
| `.env.example` | Document new env vars |
| `openapi.yaml` | Document new config fields and peer update fields |
| `test/federation-mesh.ts` | Update tests for new policy behavior |

**Risk:** Existing federation setups where users rely on federated login will break because the default is `disabled`. This is intentional -- operators must explicitly opt in. Migration path: operators enable `all_peers` or `specific_peers` and configure scopes.

---

## Implementation Priority

| Phase | Plans | Effort | Description |
|-------|-------|--------|-------------|
| **Phase 1** | 1, 3, 8, 9, 22, 23, 24, 35 | Small | One-line and small fixes (SSRF, logging, timing-safe, passwords, SSRF checks, delete unused endpoint) |
| **Phase 2** | 4, 5, 7, 10, 11, 14, 17, 21 | Small-Medium | Rate limiting, auth gating, limit caps, rejection handler |
| **Phase 3** | 6, 15, 16, 18 | Medium | Email auth system, wallet cap, consent expiry, scrypt upgrade (with migration) |
| **Phase 4** | 2, 26 | Large | GDPR cascade delete (needs bulk storage methods), SSE filtering |
| **Phase 5** | 36 | Medium-Large | Federation auth scope configuration (config, storage, backend, admin UI, i18n, tests) |
| **Phase 6** | 12, 13, 19, 20 | Medium | Warnings, incremental Zod schemas, node key warning |
| **Phase 7** | 25, 27, 28, 29, 30, 31, 32, 33, 34 | Small | Low-severity fixes, defense-in-depth |

### Regression test plan

After each phase, run full verification:
```bash
pnpm typecheck          # TypeScript compilation
pnpm lint               # ESLint
pnpm test:e2e:mongodb   # API E2E tests (MongoDB)
pnpm test:e2e:sqlite    # API E2E tests (SQLite)
```

**Phase-specific testing:**
- Phase 1 (SSRF): Verify extensions can still fetch external URLs in dev mode
- Phase 2 (rate limits): Verify E2E test login calls stay under 15/min limit
- Phase 3 (scrypt): Verify existing users can still log in after migration code is deployed
- Phase 4 (GDPR): Verify cascade delete completes without errors on both backends
- Phase 5 (federation auth): Full federation-mesh.ts test suite + manual admin UI testing with Playwright
- Phase 7 (body limit): Verify inline app publish still works for reasonably-sized apps
