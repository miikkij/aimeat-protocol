# 05 — Cryptography & Client-Side Security

## Cryptographic Implementation Assessment

### Ed25519 — SECURE

**Files:** `src/auth/keypair.ts:1-42`

- Uses `@noble/ed25519 3.0` — a well-audited, pure JavaScript implementation
- Proper `sha512Sync` initialization via `crypto.createHash('sha512')`
- `ed.utils.randomSecretKey()` for cryptographically secure key generation
- `verify()` function has exception handling, returns `false` on error (no information leakage)
- No timing attack vectors identified

### JWT Signing — SECURE

**Files:** `src/auth/jwt.ts:1-109`

- Algorithm hardcoded to `'EdDSA'` — prevents algorithm confusion attacks
- Verification explicitly specifies `algorithms: ['EdDSA']` — prevents algorithm substitution
- Keys imported via `crypto.subtle.importKey()` with proper Ed25519 algorithm specification
- Proper claims: `sub`, `owner`, `node`, `roles`, `scopes`, `iat`, `exp`

### Password Hashing — SECURE

**Files:** `src/services/password.ts:1-30`

- Algorithm: `scrypt` (memory-hard, GPU-resistant)
- Salt: 16 random bytes per password
- Key length: 64 bytes
- Comparison: `timingSafeEqual()` — prevents timing attacks
- No critical vulnerabilities found

---

## 5.1 Private Keys Stored in localStorage

**Severity: CRITICAL**
**Files:** `src/routes/libs.ts:392-396`

The client-side auth library stores **private keys** in `localStorage`:

```typescript
save('session', {
  owner: ownerName, gaii: agentGaii, ghii,
  jwt: session.jwt,
  privateKey: agentPrivateKey,  // CRITICAL
  publicKey: agentData.data.public_key,
});
save('owner_key', serverPrivateKey);  // CRITICAL
```

**Why this is dangerous:**
- Any XSS vulnerability = full private key extraction
- Malicious browser extensions can read `localStorage`
- Browser developer tools expose all values
- `localStorage` persists after tab close — keys remain on disk
- No encryption of stored values

**Impact:** Complete account takeover. Private key = ability to sign any operation as the user.

**Recommendation:**
- Migrate from plaintext `localStorage` strings to Web Crypto API `CryptoKey` objects in `IndexedDB`
- Generate keys via `crypto.subtle.generateKey('Ed25519', false, ['sign'])` — `extractable: false` prevents JS from reading raw key bytes
- Store the `CryptoKey` in `IndexedDB` (structured-cloneable) — persists across page reloads, no re-authentication needed
- Sign via `crypto.subtle.sign('Ed25519', key, data)` — browser handles crypto internally
- Even with XSS, attacker cannot export the key — can only use it during the active session

---

## 5.2 XSS Protection in Client HTML

**Severity: LOW (well-protected)**
**Files:** `src/routes/libs.ts:556`, `public/spa.html`

The client-side code uses proper escaping:

```typescript
function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
```

This `textContent → innerHTML` pattern is **correct** and prevents XSS. All user-input rendering uses `escHtml()`.

The SPA (`public/spa.html`) uses Preact virtual DOM, which is safe by design (auto-escapes).

**One concern:** Login modal is built with string concatenation + `innerHTML`, but `escHtml()` is consistently applied.

---

## 5.3 CSRF Protection Assessment

**Severity: MEDIUM**

The API uses JWT Bearer tokens in `Authorization` headers, not cookies. This inherently prevents classic CSRF attacks since:
- Cross-origin requests cannot include custom headers without CORS preflight
- JavaScript from other origins cannot set `Authorization` header

**Gap:** Form-based endpoints (if any exist) that accept `Content-Type: application/x-www-form-urlencoded` could be CSRF-vulnerable since forms can be auto-submitted cross-origin.

**Recommendation:** Verify that all state-changing endpoints require `Content-Type: application/json` or `Authorization` header.

---

## 5.4 Content Security Policy for User-Uploaded Apps

**Severity: MEDIUM**
**Files:** `src/routes/apps.ts`

User-uploaded HTML apps are served with a restrictive CSP:

```
default-src 'none';
script-src 'unsafe-inline' data: blob:;
style-src 'unsafe-inline';
img-src data: blob:;
font-src data:;
frame-ancestors 'self'
```

**Analysis:**
- `'unsafe-inline'` for scripts is necessary for user-generated HTML apps
- `frame-ancestors 'self'` prevents framing by external sites
- `connect-src` is not listed (blocks all network requests from apps)
- No external resource loading allowed

This is a reasonable balance for user-uploaded content.

---

## 5.5 Clickjacking Protection

**Severity: LOW (protected)**
**Files:** `src/server.ts:141`

```
X-Frame-Options: DENY
```

Prevents the portal from being embedded in iframes. Combined with `frame-ancestors 'self'` in CSP for apps.

---

## 5.6 Password Handling in Client-Server Flow

**Severity: MEDIUM**
**Files:** `src/routes/libs.ts:437-462`

During `loginWithPassword()`:
1. Password sent to `/v1/ghii/login` endpoint
2. Server responds with a new `private_key`
3. Client stores key in localStorage immediately

**Risks:**
- If HTTPS is not enforced, MITM can intercept the private key
- No certificate pinning
- Password sent in plaintext in request body (standard, but requires HTTPS)

**Recommendation:** Enforce HTTPS. Consider client-side key derivation (OPAQUE protocol) to avoid sending passwords over the network.

---

## 5.7 TOTP Implementation Security

**Files:** `src/services/totp.ts`

| Aspect | Status | Detail |
|--------|--------|--------|
| Secret generation | SECURE | 20 bytes (160 bits) — industry standard |
| Secret storage | CONDITIONAL | AES-256-GCM if encryption key configured; plaintext otherwise |
| Backup codes | WEAK | 8 hex chars (32-bit entropy) — should be 12+ |
| Backup code comparison | VULNERABLE | `indexOf()` not timing-safe |
| Window size | CONFIGURABLE | Needs validation that `totpWindow <= 1` |
| Rate limiting | MISSING | No per-user rate limit on TOTP attempts |

---

## 5.8 Key Storage on Server

**Files:** `src/server.ts:947-960`

Node keys are stored at `~/.aimeat/node-key.json`:
- File permissions: `0o600` (owner read/write only) — good
- Keys are **not encrypted at rest** — acceptable for server-side but noted
- Path uses `HOME` or `USERPROFILE` environment variables with `.` fallback

**Recommendation:** Consider passphrase-encrypted key storage for production deployments. Document the importance of filesystem permissions and avoid storing keys in shared/mounted volumes.
