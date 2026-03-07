# 01 — Authentication & Authorization

## 1.1 JWT Token Extraction via Query Parameters

**Severity: CRITICAL**
**Files:** `src/auth/middleware.ts:188-199`

JWT tokens can be passed via `?token=` or `?_token=` URL query parameters as a fallback to the `Authorization: Bearer` header.

**Why this is dangerous:**
- Tokens appear in **server access logs** with full URLs
- Tokens persist in **browser history**
- Tokens leak via **HTTP Referer headers** to external sites
- Tokens are visible to **intermediary proxies**
- Tokens can be **cached by CDNs** if caching is misconfigured

**Evidence:**
```typescript
// src/auth/middleware.ts line 194
const queryToken = req.query.token ?? req.query._token;
if (typeof queryToken === 'string') {
  return queryToken;
}
```

**Recommendation:** Remove query parameter token extraction entirely. Use only the `Authorization: Bearer` header. For OTK (one-time keys) in micro-memory, the query approach is acceptable since OTKs are single-use and short-lived, but should be isolated from JWT extraction.

---

## 1.2 Anonymous Mode Bypasses requireAuth()

**Severity: CRITICAL**
**Files:** `src/auth/middleware.ts:56-65`, `src/auth/middleware.ts:74-80`

When anonymous mode is enabled, `optionalAuth()` middleware injects anonymous credentials into `req.auth` for any unauthenticated request. Since `requireAuth()` checks `if (req.auth)` first before validating tokens, anonymous credentials satisfy the authentication check.

**Attack chain:**
1. Node has `AIMEAT_ANONYMOUS=true` (enabled for development/public use)
2. Unauthenticated request arrives
3. `optionalAuth()` injects `{ sub: 'shared#anonymous@node', roles: ['agent'], scopes: ['memory:read', 'catalogue:read', 'social:read'] }`
4. `requireAuth()` sees `req.auth` is set and passes through
5. Protected endpoint is accessible without real authentication

**Affected scopes:** `memory:read`, `catalogue:read`, `social:read`

**Recommendation:** `requireAuth()` should check for a `req.auth.anonymous` flag and reject if the endpoint requires real authentication. Anonymous credentials should only satisfy specific anonymous-allowed endpoints.

---

## 1.3 Token Revocation Lost on Server Restart

**Severity: CRITICAL**
**Files:** `src/auth/jwt.ts:85-108`

Token revocation is implemented as an in-memory `Map`. When the server restarts (crash, deployment, scaling):
- All revoked tokens become valid again
- Tokens that were revoked via logout are now active
- No way to detect this state loss

**Attack scenario:**
1. User logs out — token added to revocation map
2. Server restarts for any reason
3. Revocation map is empty
4. Old token is valid until its natural expiration (default: 1 hour)

**Recommendation:** Persist revoked tokens to the storage layer (SQLite/MongoDB). Add a cleanup job that removes entries older than the JWT TTL.

---

## 1.4 Admin Password in HTML Response and Query Parameters

**Severity: CRITICAL**
**Files:** `src/routes/admin.ts:31-42`

The admin setup page embeds the admin password directly in the HTML response:
```typescript
res.type('text/html').send(
  ADMIN_SETUP_HTML.replace(/\{\{PW\}\}/g, config.adminPassword!)
);
```

The admin password is also accepted via `?pw=` query parameter (line 31).

**Exposure vectors:**
- Page source visible in browser
- HTML cached by browser
- Password in URL logged in access logs, browser history, proxy logs

**Recommendation:**
- Never embed passwords in HTML responses
- Accept admin password only via `X-Admin-Password` header or POST body
- Use a session-based setup wizard instead of per-request password

---

## 1.5 First Owner Automatically Becomes Operator

**Severity: HIGH**
**Files:** `src/routes/owners.ts:40-47`, `src/routes/setup.ts:141`

The first registered owner automatically receives the `operator` role. Multiple code paths grant this:

1. **Owner registration** (`/v1/owners`): If no "real" (non-anonymous) owners exist, the new owner gets `['owner', 'operator']`
2. **Setup wizard** (`/v1/setup/init`): Always grants `['owner', 'operator']` regardless of owner count
3. **Admin setup** (`/v1/admin/setup/register`): Also grants `['owner', 'operator']`

**Race condition:** In a deployment scenario, the first POST to `/v1/owners` wins. An attacker who discovers a freshly deployed node can register first and become operator.

**Recommendation:**
- Only grant operator via the setup wizard (which has IP restrictions)
- Lock the `/v1/owners` endpoint until setup is complete
- Require explicit operator promotion via admin action

---

## 1.6 Operators Bypass All Scope Checks

**Severity: HIGH**
**Files:** `src/auth/middleware.ts:159-161`

```typescript
if (req.auth.roles.includes('operator')) {
  next(); // Operators bypass ALL scope checks
  return;
}
```

Operators have unrestricted access to every endpoint regardless of declared scopes. There is no way to create a restricted operator or audit which scopes an operator actually uses.

**Recommendation:** Implement an operator audit log. Consider adding optional scope restrictions for operator accounts.

---

## 1.7 OTK (One-Time Key) Security Issues

**Severity: HIGH**
**Files:** `src/routes/auth.ts:366-441`

Multiple issues with OTK handling:

| Issue | Detail |
|-------|--------|
| **Plaintext storage** | OTKs stored without encryption in database |
| **Grace period** | After first use, OTK remains valid for 60 seconds (configurable) |
| **Initial OTK lifetime** | Set to 365 days; timer starts on first use, not creation |
| **Session tracking** | Only in-memory; lost on restart |

**Attack:** An initial OTK embedded in an AI prompt can be used days later. If intercepted, the 60-second grace period allows replay.

**Recommendation:**
- Encrypt OTKs at rest
- Reduce initial OTK lifetime or implement absolute expiration
- Persist session state to storage layer

---

## 1.8 Password Requirements Too Weak

**Severity: MEDIUM**
**Files:** `src/routes/ghii.ts:51-52`

GHII registration requires only 4-character minimum password length. The admin password validator in `env-validator.ts` checks for 8+ characters and a weak-password list, but GHII user passwords have no such protection.

**Recommendation:** Enforce minimum 8-character passwords with complexity requirements for all user accounts.

---

## 1.9 Private Key Returned in Registration Response

**Severity: HIGH**
**Files:** `src/routes/owners.ts:67-69`, `src/routes/ghii.ts:127`

Both owner and GHII registration endpoints return the private key in the JSON response body. This key:
- Gets logged if request/response logging is enabled
- Can be cached by HTTP proxies
- Persists in server response history

**Recommendation:** Generate keys client-side and only submit public keys to the server. Or provide a one-time secure download mechanism.

---

## 1.10 TOTP Backup Codes Vulnerable to Timing Attack

**Severity: MEDIUM**
**Files:** `src/services/totp.ts:100-107`

Backup code validation uses `indexOf()` for comparison, which is not constant-time:
```typescript
const index = hashedCodes.indexOf(hashedInput);
```

The `password.ts` module correctly uses `timingSafeEqual()`, but TOTP backup codes do not.

**Additional concern:** Backup codes are only 8 hex characters (32-bit entropy), weaker than industry standard (typically 10+ characters).

**Recommendation:**
- Use `timingSafeEqual()` for backup code comparison
- Increase backup code length to 12+ characters
- Add rate limiting on TOTP verification attempts

---

## 1.11 TOTP Encryption Key Optional

**Severity: MEDIUM**
**Files:** `src/config.ts:306`

The TOTP secret encryption key (`totpSecretEncryptionKey`) defaults to `null`. When null, TOTP secrets are stored in plaintext in the database. The environment validator does not warn about this.

**Recommendation:** Make TOTP encryption key mandatory when TOTP is enabled. Add a warning in the environment validator.

---

## 1.12 No Server-Side JWT Session Tracking

**Severity: MEDIUM**
**Files:** `src/routes/auth.ts`

JWT tokens have no server-side session tracking. Cannot:
- Revoke all sessions for a user at once
- Detect concurrent sessions
- Enforce session inactivity timeouts (only OTK sessions have this)

JWTs are valid until natural expiration (default 1 hour) regardless of activity.

**Recommendation:** Implement server-side session tracking with the ability to invalidate all sessions for a user.
