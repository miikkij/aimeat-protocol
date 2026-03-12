# 03 — Security Analysis

## 1. Authentication

### 1.1 JWT / EdDSA Implementation

**Rating: Excellent**

| Aspect | Implementation | Status |
|--------|---------------|--------|
| Algorithm | EdDSA (Ed25519) via `@noble/ed25519` 3.0 + `jose` 6.1 | Secure |
| Token payload | `sub`, `owner`, `node`, `roles`, `scopes`, `iat`, `exp`, `jti` | Complete |
| Algorithm enforcement | `algorithms: ['EdDSA']` on verification | Secure |
| Token revocation | L1 in-memory cache (60s TTL) + L2 storage backend | Implemented |
| Session tracking | `jti` field with server-side session state | Implemented |
| Token delivery | `Authorization: Bearer` header only — not via URL params | Secure |
| TTL | Configurable `jwtTtlSeconds` (default: 3600s) | Configurable |
| Inactivity timeout | 5-minute session inactivity check | Implemented |

**Minor concerns:**
- Default scope fallback is permissive (`scopes ?? ['*']`) for backward compatibility with old JWTs
- No automatic key rotation mechanism — requires service restart if private key is compromised
- Session tracking (`jti`) not enforced in all auth flows (device auth, OAuth, recovery)

### 1.2 Key Management

**Rating: Strong**

- Node keys stored in `~/.aimeat/node-key.json` (outside source code)
- Optional **AES-256-GCM encryption** when `AIMEAT_KEY_PASSPHRASE` is set
- PBKDF2 key derivation with **100,000 iterations**
- 32-byte salt, 96-bit IV for GCM
- File permissions: `mode: 0o600` (owner read-write only)

### 1.3 TOTP 2FA

- Optional TOTP for owner accounts
- TOTP secrets encrypted before storage using `AIMEAT_TOTP_ENCRYPTION_KEY`
- QR code generation for authenticator apps
- Configurable window and backup codes

## 2. Authorization

### 2.1 Role-Based Access Control

**Rating: Excellent**

| Role | Level | Capabilities |
|------|-------|-------------|
| operator | Highest | Full admin, bypass scope checks |
| owner | Mid | Manage own agents, data, consent |
| agent | Low | Read/write within granted scopes |
| anonymous | Lowest | Limited to `anonymous.*` namespace |

Role hierarchy: `operator > owner > agent > anonymous`

### 2.2 Scope-Based Access Control

Three-level scope matching:
- **Exact:** `memory:read`
- **Domain wildcard:** `memory:*`
- **Global wildcard:** `*`

Operators bypass scope checks entirely.

### 2.3 Anonymous Mode

- Global flag configurable via `AIMEAT_ANONYMOUS`
- All unauthenticated requests get `shared#anonymous@node` identity
- Anonymous agents restricted to `anonymous.*` memory namespace
- Enforced at write time in memory routes

## 3. Input Validation

### 3.1 Request Body Validation

**Rating: Good**

| Mechanism | Coverage |
|-----------|----------|
| Zod schemas | All POST/PUT endpoints |
| GAII regex | Agent/owner name validation |
| URL length limits | 8KB max in config |
| File size limits | Per-file and total quota |
| Anonymous namespace | `anonymous.*` prefix enforced |
| Schema locking | CSM-defined key patterns |

### 3.2 Express 5 Parameter Safety

All route handlers properly cast `req.params`:
```typescript
const key = req.params.key as string;  // ✅ Applied consistently
```

No raw `req.params` access without casting found.

## 4. Injection Prevention

### 4.1 SQL Injection — No Risk

**Rating: Excellent**

All SQLite queries use parameterized statements:
```typescript
db.prepare('SELECT * FROM memory WHERE ownerGaii = ? AND key = ?').get(ownerGaii, key);
```

Dynamic SQL construction uses safe parameter binding:
```typescript
sql += ' AND key LIKE ?';
params.push(opts.prefix + '%');
```

No raw string concatenation in SQL found across 5,500+ LOC of SQLite implementation.

### 4.2 NoSQL Injection — No Risk

MongoDB queries use native driver query objects, not string templates.

### 4.3 Command Injection — No Risk

No `exec()`, `spawn()`, or `eval()` with user input found. Extensions run in V8 isolate sandboxes.

## 5. XSS Prevention

### 5.1 Content Security Policy

**Rating: Good (with caveats)**

```
Content-Security-Policy:
  default-src 'self'
  script-src 'self' 'nonce-${nonce}' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net
  style-src 'self' 'unsafe-inline'
  connect-src 'self' wss: ws:
  img-src 'self' data: blob:
  font-src 'self'
  frame-src 'self' blob: data:
  object-src 'none'
  base-uri 'self'
```

Per-request nonce generation: `crypto.randomUUID().replace(/-/g, '')`

| CSP Directive | Status | Notes |
|---------------|--------|-------|
| `script-src` with nonce | Secure | Per-request nonce |
| `object-src 'none'` | Secure | Blocks plugins |
| `base-uri 'self'` | Secure | Prevents base injection |
| `style-src 'unsafe-inline'` | **Weak** | Should use nonce |
| CDN origins in script-src | **Risk** | CDN compromise = all nodes compromised |
| `frame-src blob: data:` | **Caution** | Verify no user-controlled iframe creation |

### 5.2 Server-Side Output

- Backend is protocol-only (no SSR) — all responses are JSON
- Admin dashboard exception: uses static templates with nonce injection
- HTML files served via `express.static()` — no user data interpolation

### 5.3 Client-Side Output

- `escHtml()` function applied to all user data rendering
- `dangerouslySetInnerHTML` used in 3 locations — all verified safe:
  - `shared.js:112` — DataTable with caller-responsibility sanitization (documented)
  - `portal-dev.js` — uses `sanitizeHtml()` wrapper
  - `agents-tab.js:395` — hardcoded developer constant (not user input)
- HTM tagged templates auto-escape by default

## 6. CSRF Protection

### 6.1 Current State

**Rating: Adequate (JWT-based mitigation)**

- No explicit CSRF tokens
- API endpoints require `Authorization: Bearer` header (cannot be forged by CSRF)
- Admin session cookie: `SameSite=Strict; HttpOnly; Path=/v1/admin`

### 6.2 Risk Assessment

| Scenario | Risk | Mitigation |
|----------|------|-----------|
| JSON API endpoints | Low | Require Bearer token in header |
| Admin panel forms | Low-Medium | SameSite=Strict cookie |
| Cookie-authenticated endpoints | Medium | SameSite=Strict only |

**Recommendation:** Consider adding CSRF token if admin panel POST forms are introduced.

## 7. Rate Limiting

### 7.1 Implementation

**Rating: Strong (single-node)**

| Feature | Status |
|---------|--------|
| Token bucket per identity/IP | Implemented |
| Per-tier configuration | 9+ tiers (auth, work, memory, boards, etc.) |
| Role multipliers | operator (10x), owner (2x), agent (1x), anonymous (0.5x) |
| Response headers | X-RateLimit-Limit, Remaining, Reset, Retry-After |
| Cleanup interval | Every 60 seconds |

### 7.2 Limitations

- **In-memory only** — buckets reset on server restart
- **Per-process** — multi-instance deployments bypass limits
- **No distributed backend** — Consul/Redis integration needed for fleet-wide enforcement

### 7.3 Configuration

```typescript
rateLimits: {
  global:  { windowMs: 1_000, max: 300 },   // 300/sec
  auth:    { windowMs: 1_000, max: 20 },     // 20/sec
  work:    { windowMs: 1_000, max: 60 },     // 60/sec
  memory:  { windowMs: 1_000, max: 120 },    // 120/sec
  boards:  { windowMs: 1_000, max: 60 },     // 60/sec
}
```

## 8. CORS

### 8.1 Multi-Tier Resolution

**Rating: Good**

1. Memory-level `allowedOrigins` (Phase 4)
2. Agent-level origins (Phase 3)
3. Owner/GHII-level origins (Phase 2)
4. Node-level default (Phase 1)

Default: `*` (all origins allowed). Configurable via `AIMEAT_CORS_ALLOWED_ORIGINS`.

### 8.2 Headers

- `Access-Control-Allow-Credentials: true` when origin matches
- `Vary: Origin` for caching
- Anonymous mode: allows all origins

## 9. Security Headers

### 9.1 Implemented

| Header | Value | Purpose |
|--------|-------|---------|
| `Content-Security-Policy` | Per-request nonce | XSS prevention |
| `X-Content-Type-Options` | `nosniff` | MIME-sniffing prevention |
| `X-Frame-Options` | `SAMEORIGIN` | Clickjacking protection |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Referrer leak prevention |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | HTTPS enforcement |

### 9.2 Missing

| Header | Purpose | Priority |
|--------|---------|----------|
| `Permissions-Policy` | Feature restriction (camera, mic, etc.) | Low |
| `Cross-Origin-Opener-Policy` | Cross-origin isolation | Low |

## 10. Secrets Management

### 10.1 Practices

**Rating: Excellent**

| Secret | Storage | Encryption |
|--------|---------|-----------|
| Node private key | `~/.aimeat/node-key.json` | Optional AES-256-GCM |
| SMTP password | `AIMEAT_SMTP_PASS` env var | N/A |
| TOTP secrets | Database | AES encryption |
| Admin password | `AIMEAT_ADMIN_PASSWORD` env var | Auto-generated if unset |
| VAPID keys | Env vars | N/A |
| Consul token | `AIMEAT_CONSUL_TOKEN` env var | N/A |

- All secrets via environment variables — none hardcoded
- `.env.example` contains only placeholders, no real values
- Private keys not committed to version control

## 11. GDPR Compliance

### 11.1 Features

**Rating: Implemented**

| Requirement | Implementation | Status |
|-------------|---------------|--------|
| Data export | `/v1/personal/export` — JSON format | Implemented |
| Data deletion | Cascade delete via storage layer | Implemented |
| Consent management | Grants, revocation, scope control, quotas | Implemented |
| Audit trail | `ConsentAuditEntry` with retention (365 days default) | Implemented |
| Right to be forgotten | Owner cascade delete removes all associated data | Implemented |
| Cookie consent | Cookie consent banner middleware | Implemented |

### 11.2 Cascade Delete Coverage

Owner deletion removes:
- All agents and agent data
- Memory records
- Storage files
- Wallet transactions
- Work requests/results
- Board subscriptions
- Personal nodes
- Consent records (after audit retention)

## 12. Dependency Security

### 12.1 Key Dependencies

| Package | Version | Security Notes |
|---------|---------|---------------|
| `express` | 5.2.1 | Latest stable |
| `@noble/ed25519` | 3.0.0 | Audited cryptography |
| `jose` | 6.1.3 | JWT handling, maintained |
| `better-sqlite3` | 12.6.2 | Native module, active |
| `isolated-vm` | 6.0.2 | V8 sandbox for extensions |
| `zod` | 4.3.6 | Schema validation |
| `ws` | 8.19.0 | WebSocket, active |

**Recommendation:** Run `pnpm audit` regularly and integrate into CI/CD.

## 13. Extension Sandboxing

- Extensions run in `isolated-vm` V8 isolates
- Configurable memory limits, timeout, max API calls
- No filesystem or network access from sandbox
- Code size limits enforced

## 14. Error Information Leakage

**Rating: Secure**

- 500 errors: logged server-side with stack trace, client gets generic message
- 4xx errors: specific error code + safe message, no internal details
- No database schema or query details exposed

## 15. Vulnerability Summary

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| Authentication | 0 | 0 | 0 | 2 |
| Authorization | 0 | 0 | 0 | 0 |
| Injection (SQL/NoSQL/Cmd) | 0 | 0 | 0 | 0 |
| XSS | 0 | 0 | 2 | 1 |
| CSRF | 0 | 0 | 1 | 0 |
| Rate Limiting | 0 | 1 | 0 | 0 |
| Configuration | 0 | 0 | 1 | 1 |
| Error Handling | 0 | 0 | 1 | 0 |
| **Total** | **0** | **1** | **5** | **4** |

### High

1. **Distributed rate limiting missing** — multi-node deployments can be overwhelmed by distributing requests across instances

### Medium

1. **CSP `style-src 'unsafe-inline'`** — should use nonce-based style allowlisting
2. **CDN origins in CSP** — consider Subresource Integrity (SRI) or self-hosting
3. **CSRF for admin forms** — SameSite=Strict mitigates but explicit tokens are safer
4. **Silent federation sync errors** — failed syncs not logged, peers may desync
5. **Config enum validation** — `AIMEAT_MSM_INSTALL_ROLE` cast without runtime check

### Low

1. **Default scope fallback `['*']`** — backward compat for old JWTs
2. **No key rotation mechanism** — requires restart
3. **Permissions-Policy header missing** — nice-to-have
4. **DataTable `_html` caller-responsibility** — fragile but documented pattern
