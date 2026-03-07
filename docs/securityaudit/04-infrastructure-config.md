# 04 — Infrastructure & Configuration

## 4.1 Content Security Policy — unsafe-inline

**Severity: MEDIUM**
**Files:** `src/server.ts:128-144`

CSP allows `'unsafe-inline'` for both scripts and styles:

```
script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com
style-src 'self' 'unsafe-inline'
```

This defeats CSP's primary XSS protection. If any template injection vulnerability exists, attackers can execute arbitrary JavaScript.

**External CDN dependency:** `https://cdnjs.cloudflare.com` is allowed for the cookie consent library. A CDN compromise would enable script injection.

**Recommendation:**
- Migrate inline scripts to external files
- Use nonce-based CSP (`'nonce-{random}'`) instead of `'unsafe-inline'`
- Self-host the cookie consent library

---

## 4.2 Missing HSTS Header

**Severity: MEDIUM**
**Files:** `src/server.ts:128-144`

No `Strict-Transport-Security` header is set. For HTTPS deployments, this means:
- Browsers don't enforce HTTPS on subsequent visits
- SSL stripping attacks are possible
- No preload list inclusion

**Present headers (good):**
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`

**Missing headers:**
- `Strict-Transport-Security` (HSTS)
- `Permissions-Policy` (restrict browser features)

**Recommendation:** Add `Strict-Transport-Security: max-age=31536000; includeSubDomains` for production deployments.

---

## 4.3 CORS — Wildcard Origin (By Design)

**Severity: MEDIUM (accepted risk)**
**Files:** `src/server.ts:196-205`

```typescript
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
```

This is intentional for a federated protocol — external nodes must query this node. The risk is acceptable because:
- JWT is in `Authorization` header (not cookies)
- No `Access-Control-Allow-Credentials: true` (credentialed requests fail)
- API is JSON-based, not form-based

**Note:** `ws:` (insecure WebSocket) is allowed in `connect-src`. Only `wss:` should be used in production.

---

## 4.4 No Trust Proxy Configuration

**Severity: MEDIUM**
**Files:** `src/server.ts`

No `app.set('trust proxy', ...)` call found. If deployed behind a reverse proxy (nginx, CloudFlare, AWS ALB):
- `req.ip` returns the proxy IP, not the client IP
- Rate limiting by IP becomes per-proxy, not per-client
- All users behind the same proxy share one rate limit bucket

**Recommendation:** Add `app.set('trust proxy', 'loopback')` or detect from `AIMEAT_BASE_URL`.

---

## 4.5 Rate Limiting Implementation

**Severity: LOW (well-implemented)**
**Files:** `src/middleware/rate-limit.ts`

Rate limiting is well-designed:

| Feature | Implementation |
|---------|---------------|
| Key strategy | GAII if authenticated, IP if not |
| Role multipliers | Operator: 10x, Owner: 2x, Agent: 1x, Anonymous: 0.5x |
| Bucket cleanup | Every 60 seconds |
| Response headers | `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` |
| 429 response | Includes `Retry-After` header |

**Default limits:**

| Scope | Limit (req/s) |
|-------|---------------|
| Global | 300 |
| Auth | 20 |
| Work | 60 |
| Memory | 120 |
| Boards | 60 |

**Gap:** Many critical endpoints lack dedicated rate limits (see section 02-api-routes, #2.12).

---

## 4.6 JSON Payload Limit

**Severity: LOW**
**Files:** `src/server.ts:104`

```typescript
app.use(express.json({ limit: '15mb' }));
```

15 MB is generous but reasonable for file uploads. No per-endpoint customization.

**YAML limit:** 1 MB for CSM/service manifests — appropriate.

---

## 4.7 Compression-Based Timing Attacks

**Severity: LOW**
**Files:** `src/server.ts:101`

```typescript
app.use(compression());
```

Compression is enabled for all responses. Theoretically vulnerable to BREACH/CRIME attacks if:
- Sensitive data is in the response body
- Attacker can control part of the response
- HTTPS is used

For an API server, this is generally acceptable since responses don't mix user-controlled data with secrets.

---

## 4.8 Idempotency Cache — DoS via Memory Exhaustion

**Severity: MEDIUM**
**Files:** `src/middleware/idempotency.ts:16-54`

The idempotency cache is an unbounded in-memory `Map`:
- No maximum cache size limit
- No validation of `Idempotency-Key` format or length
- 24-hour TTL with 5-minute cleanup interval

**Attack:** Client sends unique `Idempotency-Key` headers on every request, growing the cache unboundedly until OOM.

**Recommendation:**
- Add maximum cache size (e.g., 10,000 entries)
- Validate key format (UUID or similar)
- Implement LRU eviction

---

## 4.9 Insecure Configuration Defaults

**Files:** `src/config.ts`

| Setting | Default | Risk |
|---------|---------|------|
| `storage` | `'memory'` | Data lost on restart |
| `devMode` | `false` | Secure default |
| `anonymousMode` | `false` | Secure default |
| `adminPassword` | `null` (generated) | Secure default |
| `jwtTtl` | `3600` (1 hour) | Reasonable |
| `totpSecretEncryptionKey` | `null` | TOTP secrets in plaintext if not set |
| `maxAgentScopes` | `['*']` | All scopes granted by default |
| `extendedFeaturesEnabled` | `true` | Risky if defaults are wrong for use case |
| `autoHideThreshold` | `5` | Low — 5 coordinated accounts can suppress content |

**Environment validator gaps:**
- No warning for `AIMEAT_STORAGE=memory` in production
- No warning for `AIMEAT_DEV_MODE=true` in production
- No warning for missing `AIMEAT_TOTP_ENCRYPTION_KEY` when TOTP is enabled
- No minimum for `AIMEAT_AUTO_HIDE_THRESHOLD`

---

## 4.10 Logging Concerns

**Files:** `src/utils/logger.ts`, `src/server.ts:599-621`

**Good practices:**
- Winston with AsyncLocalStorage for request context
- Request IDs and GAIIs in every log entry
- Stack traces logged but not returned to clients

**Concerns:**
- Stack traces leak internal file paths and function names in logs
- User-controlled error messages not sanitized for log injection
- No log rotation configured (disk exhaustion risk)
- No sensitive field masking (tokens, keys could appear in debug logs)

**Recommendation:** Implement log rotation, sanitize user input in error messages, mask sensitive fields.

---

## 4.11 Error Handling — Non-500 Errors Leak Details

**Severity: MEDIUM**
**Files:** `src/server.ts:599-621`

500+ errors return generic "An unexpected error occurred" (good). But non-500 errors return `err.message` directly to the client, which can reveal internal structure:

```typescript
message: status >= 500 ? 'An unexpected error occurred' : err.message
```

**Examples of leaked messages:**
- `"CONSENT_REQUIRED"` — reveals what security check failed
- `"Owner not found: alice"` — confirms/denies account existence
- Workspace access middleware returns detailed error descriptions

**Recommendation:** Use error codes (already present) for client-side handling. Make all messages generic.

---

## 4.12 Node Key Storage

**Severity: MEDIUM**
**Files:** `src/server.ts:947, 1091`

Node keys stored at `~/.aimeat/node-key.json` with file mode `0o600` (owner-only). The private key is **not encrypted at rest**.

**Recommendation:** Consider passphrase-encrypted key storage. Document the importance of filesystem permissions.

---

## 4.13 Cookie Consent Injection Risk

**Severity: LOW**
**Files:** `src/middleware/cookie-consent.ts:77-121`

Cookie consent middleware injects `<link>` and `<script>` tags into HTML responses. The `cookieConsentPolicyUrl` config value is included without URL validation.

**Risk:** If a malicious URL (e.g., `javascript:alert(1)`) is configured, it could execute in the browser.

**Recommendation:** Validate that `cookieConsentPolicyUrl` is a valid HTTPS URL.

---

## 4.14 Request ID Accepts Arbitrary Input

**Severity: LOW**
**Files:** `src/middleware/request-id.ts:23-34`

The server accepts incoming `X-Request-Id` headers without format validation. A client can send arbitrary request IDs.

**Impact:** Minimal — request IDs are used for logging only, not authentication.

**Recommendation:** Validate format or always generate server-side IDs.
