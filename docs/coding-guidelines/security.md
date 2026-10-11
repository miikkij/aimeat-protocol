# Security Practices

## Overview

This page is the lookup reference: library names, function signatures, environment variables and their defaults, and the headers the node sends. The rules come from [security-development-dna.md](security-development-dna.md): the trust model, the invariants every change must keep, the security posture and the per-change checklist. Read that file before you change a route, auth, storage, federation, an extension or an AI path.

Every value on this page was read from the code. If the code and this page disagree, the code is right and this page needs a fix. Paths are relative to `aimeat/`.

---

## Authentication & Authorization

### Ed25519 Key Pairs

- Library: `@noble/ed25519` 3.x, async API only. `src/auth/keypair.ts` uses `getPublicKeyAsync` and `signAsync`, so no synchronous SHA-512 setup is needed.
- Functions in `src/auth/keypair.ts`:

  ```typescript
  import { generateKeyPair, sign, verify } from '../auth/keypair.js';

  const { publicKey, privateKey } = await generateKeyPair();   // base64 strings
  const signature = await sign(privateKey, message);           // base64
  const ok = await verify(publicKey, message, signature);      // false on any error, never throws
  ```

- **Owner keys are generated on the server.** `POST /v1/owners` (`src/routes/owners.ts`) and `POST /v1/ghii` (`src/routes/ghii/register-login.ts`) call `generateKeyPair()`, store the public key on the owner record and return the private key once in the response. The node keeps no copy of the private key. `POST /v1/owners/:name/recover` (operator only) issues a new pair.
- **Owner-key sign-in is deprecated.** `POST /v1/auth/token` with an owner name and a signature made with that key still signs the owner in (`src/routes/auth.ts`). RFC v4.0 deprecates it. `AIMEAT_OWNER_KEY_LOGIN` (`ownerKeyLogin` in `src/config-security.ts`) defaults to `true`; `false` turns it off, and the route then answers `410 OWNER_KEY_LOGIN_OFF` and points to `POST /v1/ghii/login`. Removal is planned for 4.0.0. An account with two-step sign-in armed is refused on this route even when it is on. New code signs owners in with a password session, never with the account key.
- The node's own key pair signs JWTs and federation messages. `AIMEAT_KEY_PASSPHRASE` encrypts the node key on disk.

### JWT Tokens

- Library: `jose`, algorithm `EdDSA`, signed with the node's Ed25519 key.
- Functions in `src/auth/jwt.ts`:

  ```typescript
  import { issueJWT, verifyJWT, revokeToken, isRevoked } from '../auth/jwt.js';

  const token = await issueJWT({ sub, owner, node, roles, scopes }, config.jwtTtlSeconds, sessionId);
  const verified = await verifyJWT(token);          // VerifiedToken | null
  await revokeToken(token, expiresAtEpochSeconds);
  ```

- Claims: `sub` (bare owner name for an owner, the GAII for an agent, the GEAI for an ecosystem app), `owner`, `node`, `roles`, `scopes`, `iat`, `iat_ms`, `exp`, and `jti` when a session id is passed. Optional claims (`mcp_client`, `federated`, `homeNode`, `homeUrl`, `eco_app`, `app_grant`, `app`, `via`, `auth_time`) are written only when set. The full list is the `JWTPayload` interface.
- A missing `scopes` claim is written and read as `[]`, so an agent token that names no scopes can do nothing.
- `issueJWT` throws `AccountDisabledError` (403 `ACCOUNT_DISABLED`) for a deactivated local owner.
- `verifyJWT` reads every federated token as a visitor: role `federated` only, with its home GHII as `sub` and `owner`. See [identity-model.md](identity-model.md#a-visitor-from-another-node).
- Lifetime: `AIMEAT_JWT_TTL`, in seconds, default `3600`.
- Revocation is stored per node and keyed by a hash of the token's signed header and claims (`tokenIdOf`), so every spelling of a revoked token is refused.

### TOTP 2FA

Library: `otpauth`. Settings in `src/config-types-account-security.ts`:

| Env var | Default |
|---|---|
| `AIMEAT_TOTP_ENABLED` | `true` |
| `AIMEAT_TOTP_ISSUER` | `AIMEAT` |
| `AIMEAT_TOTP_PERIOD` | `30` (seconds) |
| `AIMEAT_TOTP_WINDOW` | `1` |
| `AIMEAT_TOTP_BACKUP_CODE_COUNT` | `10` |
| `AIMEAT_TOTP_MAX_FAILED` | `5` |
| `AIMEAT_TOTP_LOCKOUT_SECONDS` | `300` |

TOTP secrets are encrypted with the key described under [Encryption at rest](#encryption-at-rest).

### Role-Based Access

Who the caller is comes from one object: `callerOf(req, config.nodeId, storage)` in `src/middleware/caller.ts`, which returns a `CallerContext` (`src/services/caller-context.ts`). The rule is in `.claude/rules/security.md` and [identity-model.md](identity-model.md).

Route guards, in `src/auth/middleware.ts` unless noted:

```typescript
requireAuth()                          // a real session; the injected anonymous identity does not pass
optionalAuth()                         // runs globally; may inject the anonymous identity (invariant 6)
requireRole('owner')                   // role present on the token
requireScope('memory:write')           // agents and apps need the word; the owner in person passes
requireAnyScope('a:read', 'b:read')
requireRoleOrScope('agent', 'x:write')
requireLocalSession()                  // refuses a visitor from another node
requireOperator(storage)               // from src/auth/operator-gate.ts
requireOwnerPrincipal()                // src/auth/account-security.ts: the human in person, no agent, app or ecosystem token
```

The first real owner on a node gets the `operator` role (`POST /v1/owners` in `src/routes/owners.ts`, and `provisionOwner` in `src/services/owner-provisioning.ts`).

---

## Input Validation

### Request Validation

- Request bodies: Zod, through `validateBody(schema, config.nodeId)` from `src/models/schemas.ts`. JSON Schema contracts use AJV (`src/services/schema-validator.ts`).
- Express 5 types `req.params` values as `string | string[]`: cast with `as string` (`.claude/rules/backend.md`).
- Check query parameters with explicit type checks.
- Reject unexpected fields. Do not ignore extra input without a reason.

### SSRF Protection

All outbound HTTP to a URL that is not a compile-time constant goes through `safeFetch` (invariant 3). Reference values, from `src/utils/url-validator.ts`:

- Only `http:` and `https:` are allowed.
- Blocked always: `localhost` names other than the loopback case below, private and reserved addresses (RFC 1918, link-local including cloud metadata at `169.254.169.254`, CGNAT), checked on the literal host and on every DNS record it resolves to.
- Loopback (`localhost`, `::1`, `127.x`) is allowed only when `AIMEAT_ALLOW_PRIVATE_EGRESS=true`. `AIMEAT_DEV_MODE=true` is a back-compat alias.
- `safeFetch` follows redirects by hand and validates every hop. On a redirect to another origin it drops credential headers.

The egress default comes from the security posture (`src/config.ts`):

| Env var | Default |
|---|---|
| `AIMEAT_SECURITY_PROFILE` | `local` when the host of `AIMEAT_BASE_URL` is private or `AIMEAT_NODE_TYPE=personal`; `public` otherwise |
| `AIMEAT_ALLOW_PRIVATE_EGRESS` | `true` on a `local` profile, `false` on `public` |
| `AIMEAT_AI_PROVIDER_ALLOWLIST` | empty (any host) on both profiles |

An explicit value always wins over the profile. What each knob is for, and what a public node should set: [security-development-dna.md §3](security-development-dna.md#3-security-posture-one-codebase-localhost-flexible--public-strict). The full config list: [b-config.md](../b-config.md).

### Path Traversal

- Never build a file path from user input without validation.
- The storage layer uses validated keys, not raw user paths.
- The node answers 403 to any request path with a dotfile segment (`.env`, `.git/config`) before the static handlers run (`src/server-bootstrap/static-files.ts`).

### SQL Injection

- SQLite: `better-sqlite3` prepared statements.
- PostgreSQL: Kysely, which parameterizes all values.
- Never interpolate user input into a query string.

---

## HTTP Security Headers

Set in `src/server-bootstrap/static-files.ts` on every response, API and static:

| Header | Value |
|--------|-------|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains`, only when `AIMEAT_BASE_URL` starts with `https://` |

### CSP Policy

The node's own pages get this policy, with a new nonce per request (`res.locals.cspNonce`):

```
default-src 'self'
script-src 'self' 'nonce-<per request>' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net
style-src 'self' 'unsafe-inline'
connect-src 'self' wss: ws:
img-src 'self' data: blob:
font-src 'self'
frame-src 'self' blob: data: <the app host family, when the app origin is on>
object-src 'none'
base-uri 'self'
```

Exceptions, each set in its own handler:

- `/app-catalog.html` has a wider policy, because it hosts user apps that load CDN resources.
- `/app-silent.html` drops `X-Frame-Options` and sets `frame-ancestors` to the app, portfolio and company host families, so an app origin can frame it for sign-in.
- Published apps get their own CSP from the routes under `src/routes/apps/`.

**Pitfall:** a script from a new CDN origin on the node's own pages is blocked until that origin is in `script-src`. Fonts are self-hosted under `/lib/fonts`, so the policy allows no font CDN.

---

## XSS Prevention

### Backend

- API responses are JSON.
- No HTML rendering in route handlers: `.claude/rules/backend.md`.

### Frontend

Preact + HTM escapes text and attribute values. Interpolate user data directly:

```javascript
html`<span title=${user.name}>${user.bio}</span>`   // escaped by Preact
```

Do not wrap such a value in `escHtml()`: Preact escapes it again, and `<=` shows as `&lt;=`. The same goes for `t()` translations.

Helpers in `public/js/utils.js`, for the cases Preact does not cover:

| Helper | Use |
|---|---|
| `escHtml(s)` | A string that becomes markup outside HTM, for example through `innerHTML` |
| `escAttr(s)` | A value placed inside an attribute in such a string |
| `sanitizeHtml(html)` | Rich text passed to `dangerouslySetInnerHTML`. Keeps `b i em strong code a br p ul ol li blockquote` and their text; removes every attribute except `href` on `a`, which must start with `http://`, `https://` or `/`; adds `rel="noopener noreferrer"` and `target="_blank"` to links |

---

## Rate Limiting

### Configuration

Middleware: `rateLimit()` in `src/middleware/rate-limit.ts`. The window is one second unless noted. The bucket key is the caller's `sub` when the request is authenticated, otherwise the client IP (IPv6 grouped by /64). Defaults from `src/config.ts`:

| Env var | Default (requests per window) |
|---|---|
| `AIMEAT_RL_GLOBAL` | `300` |
| `AIMEAT_RL_AUTH` | `20` |
| `AIMEAT_RL_WORK` | `60` |
| `AIMEAT_RL_MEMORY` | `120` |
| `AIMEAT_RL_BOARDS` | `60` |
| `AIMEAT_RL_OWNERS`, `_GHII`, `_FLAGS`, `_APPEALS`, `_ADMIN_SETUP`, `_FEDERATION`, `_CATALOGUE`, `_AUTH_CHALLENGE` | the value of `AIMEAT_RL_GLOBAL` |
| `AIMEAT_RL_REGISTRATION_INVITES` | `5` per hour |
| `AIMEAT_RL_OPENROUTER` | `30` per minute |

Sign-in attempts and password lockout have their own settings (`AIMEAT_LOGIN_RATE_LIMIT_MAX`, `AIMEAT_PASSWORD_LOCKOUT_ATTEMPTS`): see [b-config.md](../b-config.md).

### Role Multipliers

The limit is multiplied by the caller's role. The values are fixed in `src/config.ts` (`roleMultipliers`) and have no env var:

```
operator: 10
owner: 2
any other authenticated caller: 1
no auth: 0.5
```

---

## Encryption at rest

`src/services/encryption.ts`, AES-256-GCM:

- `encrypt(plaintext, key)` / `decrypt(data, key)`.
- `encryptBound(plaintext, key, context)` / `decryptBound(data, key, context)` bind the ciphertext to a context string (AES-GCM additional data), so the value opens only where that context is named.
- `getEncryptionKey(config)` reads `AIMEAT_ENCRYPTION_KEY`, then falls back to `AIMEAT_TOTP_ENCRYPTION_KEY`. The key is 64 hex characters (32 bytes); any other length gives `null`.

The rules for secrets (never returned, never logged, destination allowlisted) are invariant 7.

---

## Data Protection & GDPR

### Cascade Delete

`DELETE /v1/owners/:name` (`src/routes/owners.ts`) deletes the account and everything it owns. The account holder in person may call it (`requireAuth`, `requireLocalSession`, `requireOwnerPrincipal`), and so may an operator, whose action is written to the operator trail.

### Consent Layer

`authorizeRead()` in `src/services/access-guard.ts` makes the read decision for memory and files: visibility, consent grants and group rules, plus one audit entry per read. The owner can read what their own agents and apps stored; an agent reading its owner's private data goes through the same consent check as anyone else (`.claude/rules/security.md`).

### Data Export

`GET /v1/owners/:name/export` (`src/routes/owners/export.ts`), for the account holder in person.

---

## Extension Security

Extensions run in a QuickJS sandbox compiled to WASM (`quickjs-emscripten`, `src/services/extension-runtime.ts`). The script has no file system and no Node.js APIs. Limits, from `src/config.ts`:

| Setting | Env var | Default |
|---------|---------|---------|
| Extensions on | `AIMEAT_EXTENSIONS_ENABLED` | `true` |
| Memory per action | `AIMEAT_EXT_MAX_MEMORY_MB` | `64` MB (a manifest may ask for less, not below 16) |
| CPU timeout per action | `AIMEAT_EXT_TIMEOUT_MS` | `5000` ms (a manifest may ask for less, not below 1000) |
| API calls per invocation | `AIMEAT_EXT_MAX_API_CALLS` | `500` |
| Script size | `AIMEAT_EXT_MAX_CODE_SIZE_KB` | `256` KB |
| Morsel debit per call | `AIMEAT_EXT_MAX_DEBIT` | `100` |
| Installed on the node | `AIMEAT_EXT_MAX_INSTALLED` | `20` |
| Installed per owner | `AIMEAT_MAX_EXTENSIONS_PER_OWNER` | `10` |
| Who may install | `AIMEAT_EXT_INSTALL_ROLE` | `owner` (`operator` is the stricter choice) |

Network access goes through `ctx.fetch` only (`src/services/extension-ctx.ts`). It refuses unless the manifest declares the `network` capability, reaches only the hosts the manifest lists when it lists any, and sends every request through `safeFetch`, so the SSRF rules above apply.

---

## Security Testing

`test/e2e-security.ts` holds the cross-cutting refusals: auth, injection, path traversal and rate limits. Run it alone on both backends, after `pnpm test:env:init` has written the `.env.test.*` files:

```bash
cd aimeat
pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-security
pnpm exec node --env-file=.env.test.postgres-kysely --import tsx test/run-e2e-ci.ts --test=e2e-security
```

A new security behaviour gets its test in this suite or in the suite of the feature it guards, with a cross-owner and a cross-scope "→403" case (invariant 9). `pnpm gate` on the finished work is the final check.

---

## Checklist for Security-Sensitive Changes

Use the per-change checklist in [security-development-dna.md §4](security-development-dna.md#4-per-change-security-checklist-paste-into-the-pr). Two items it does not name:

- [ ] A new resource origin for the node's own pages is in the CSP.
- [ ] User data in the frontend goes through Preact, `escHtml()`/`escAttr()` or `sanitizeHtml()` as the table above says.
