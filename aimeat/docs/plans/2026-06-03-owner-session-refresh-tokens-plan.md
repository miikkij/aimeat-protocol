# Owner Session Refresh Tokens — Design & Implementation Plan

- **Date:** 2026-06-03
- **Status:** Approved design, not yet implemented
- **Author:** session investigation (follow-up to login-refresh fixes #1 + #2)
- **Goal:** Give every owner (human) login its own per-device, server-side, rotating refresh token so session continuity is fully decoupled from the single owner keypair. This **abolishes cross-device key rotation**: logging in on one device can never invalidate another device's ability to refresh.

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| Refresh-token client storage | **httpOnly + Secure + SameSite=Strict cookie**, scoped to `/v1/auth`. Access token kept in memory only (no JWT in `localStorage`). |
| Theft protection | **Rotation + reuse-detection** — one-time-use rotation; replay of a consumed token (outside grace) revokes the whole device session. |
| Lifetime | **Sliding 30-day idle** (bumped each rotation) with a **hard 90-day absolute cap**. |
| Scope | **Owner (human) sessions only.** Agent device-auth keeps its per-agent keypair refresh. |
| Owner keypair | Keep issuing/storing it (federation/future signing); it simply leaves the login/refresh path. `request_owner_key` becomes vestigial → key never rotates again. |

## Background

After fixes #1 (refresh on tab focus/visibility) and #2 (`/v1/ghii/login` only mints a new owner keypair when the device is keyless), the only remaining logout cause is structural: the server stores **one** owner public key, so a genuinely new-device login rotates it and breaks other devices' signature-based refresh. Refresh tokens remove the dependency on that key entirely.

## Reuse existing machinery (do not reinvent)

The codebase already runs an OAuth2 refresh-token flow for MCP clients — copy its proven primitives:

- **Opaque + hashed tokens:** `randomBytes(32).toString('hex')`, stored as `hashToken()` (SHA-256). See [mcp/index.ts](../../src/mcp/index.ts) `/v1/mcp/token` (`grant_type=refresh_token`, lines ~672–805) and `OAuthRefreshTokenRecord` in [interface.ts](../../src/storage/interface.ts).
- **Session records & revocation already exist:** `SessionRecord { sessionId, gaii, owner, issuedAt, expiresAt, revoked }` with `createSession / listActiveSessions / revokeSession / revokeAllSessions / isSessionRevoked` ([session.repository.ts](../../src/storage/repositories/session.repository.ts)), enforced in middleware via JWT `jti`, and surfaced at `GET/DELETE /v1/auth/sessions` ([routes/auth.ts](../../src/routes/auth.ts)).

**Design = bind a rotating refresh token to each Session.** One session row = one device = one refresh-token family. The existing session-list/revoke endpoints instantly become a real "your devices — log out any one" panel.

## Token model

| | Access token | Refresh token |
|---|---|---|
| Form | EdDSA JWT via `issueJWT`, `jti = sessionId` | opaque `randomBytes(32).hex` |
| TTL | short — **15 min** (`AIMEAT_ACCESS_TTL`, default 900) | sliding 30d idle / 90d absolute |
| Client storage | in memory only | httpOnly cookie `aimeat_rt` (Path=/v1/auth) |
| Server storage | none (stateless JWT) | SHA-256 hash in the session row |
| Renewal | present refresh token | rotates on every use |

> Note: today's `jwtTtlSeconds` (DB override `auth.jwt_ttl_seconds`, ~3600) becomes the **access-token** TTL. We can drop it to 15 min because silent refresh is now reliable. Keep it configurable.

## Data model — extend `SessionRecord`

Add to `SessionRecord` (and all backends — see storage-sync checklist):

```
refreshTokenHash:   string   // current valid token (SHA-256)
prevTokenHash:      string?  // previous token, valid until prevValidUntil (concurrency grace)
prevValidUntil:     string?  // ISO; ~60s after last rotation
lastUsedAt:         string   // ISO
idleExpiresAt:      string   // ISO; bumped to now+30d on each rotation
absoluteExpiresAt:  string   // ISO; set at login to now+90d, NEVER extended
deviceLabel:        string?  // derived from UA for the session-list UI
userAgent:          string?  // raw UA at login (soft signal)
```

New repository methods (interface + SQLite + Mongo + Prisma):
`createOwnerSession(...)`, `getSessionByRefreshHash(hash)`, `rotateSessionRefresh(sessionId, {newHash, prevHash, prevValidUntil, idleExpiresAt, lastUsedAt})`, plus a periodic `pruneExpiredSessions()` (wire into the existing scheduler).

## Endpoints

### `POST /v1/ghii/login` (and register) — augmented
On success additionally:
1. `createOwnerSession` with a fresh `sessionId`, `refreshTokenHash = hashToken(rt)`, `idleExpiresAt = now+30d`, `absoluteExpiresAt = now+90d`, UA/label.
2. Issue access JWT with `jti = sessionId`, 15-min TTL.
3. `Set-Cookie: aimeat_rt=<rt>; HttpOnly; Secure; SameSite=Strict; Path=/v1/auth; Max-Age=<90d>`.
4. Response body: `{ token: <access>, expires_in: 900, session_id }`. **No `owner_private_key`** in the normal path (kept only for the explicit `request_owner_key` legacy case).

### `POST /v1/auth/refresh` — new opaque-token mode (no Bearer required)
- Read `aimeat_rt` from the cookie (manual parse of `req.headers.cookie` — no new dependency). Require a custom header `X-AIMEAT-Refresh: 1` as a CSRF guard (browsers can't set custom headers cross-site without a CORS preflight).
- `getSessionByRefreshHash(hashToken(rt))`:
  - **No match, but the hash equals a recently-consumed `prevTokenHash` past `prevValidUntil`, or matches nothing while a session for this jti exists** → treat as **reuse** → `revokeSession(family)` → `401 SESSION_REVOKED`.
  - **Match on `refreshTokenHash`, or on `prevTokenHash` while `now < prevValidUntil`** → valid.
- Validate `!revoked`, `now < idleExpiresAt`, `now < absoluteExpiresAt`.
- Re-read roles from storage (prevents stale privilege; mirrors current `/v1/auth/refresh`).
- **Rotate:** `prevTokenHash = old`, `prevValidUntil = now+60s`, `refreshTokenHash = hashToken(newRt)`, `idleExpiresAt = min(now+30d, absoluteExpiresAt)`, `lastUsedAt = now`.
- Issue new access JWT (`jti = sessionId`), set a new `aimeat_rt` cookie, return `{ token, expires_in }`.
- Keep the existing `requireAuth`-based refresh as a **deprecated fallback** during rollout.

### `POST /v1/auth/revoke` / logout / `DELETE /v1/auth/sessions/:id` / `…/sessions`
Already exist — additionally clear `refreshTokenHash`/`prevTokenHash` and emit `Set-Cookie: aimeat_rt=; Max-Age=0; Path=/v1/auth`.

## Cookie specifics
- Flags: `HttpOnly; SameSite=Strict; Path=/v1/auth`. `Secure` set when `req.secure` **or** host is `localhost` (Chrome/Firefox accept Secure cookies on `http://localhost`); a small helper computes this so dev over plain http still works.
- Apps/iframes are cross-origin and use Bearer — they never receive or need this cookie, so the same-origin scope is exactly right.
- CSRF: `SameSite=Strict` + same-origin-only endpoint + required `X-AIMEAT-Refresh` header. No token table needed.

## Client changes
- **`session.refresh()` ([libs.ts](../../src/routes/libs.ts)):** replace key-signing with `fetch('/v1/auth/refresh', { method:'POST', credentials:'include', headers:{'X-AIMEAT-Refresh':'1'} })`; store the returned access token in memory; cookie handled by the browser. Federated sessions can now refresh too.
- **Boot flow:** keep non-secret metadata (`owner, ghii, roles, displayName`) in `localStorage` for instant render, but **not** the JWT. On load, `auth.login()` → `POST /v1/auth/refresh` (cookie) → access token in memory → proceed; if it 401s, show login.
- **Single-flight:** one shared in-flight refresh promise (extend the existing `focusRefreshInFlight` / `api.js` retry logic) so concurrent calls don't each rotate. The **#1 focus/visibility handler stays unchanged** and now drives this path.
- **`api.js`:** on 401, call the single-flight refresh once and retry (already structured this way).

## Concurrency safety
Two layers prevent false-positive theft revocations:
1. **Client single-flight** — N parallel requests share one refresh.
2. **Server grace window** — `prevTokenHash` stays valid ~60 s after rotation, absorbing in-flight requests that carried the pre-rotation cookie. Reuse-detection only fires for tokens consumed *before* the grace window.

## Migration / backward compat
- Roll out additively: new login path issues refresh cookies; old key-signing `/v1/auth/token` + `requireAuth` `/v1/auth/refresh` remain temporarily.
- Existing logged-in users (JWT in `localStorage`, key in IndexedDB) keep working until their current access token expires; their next boot has no cookie → one clean re-login, after which they're on the new system.
- After a deprecation window, remove the key-signing owner-refresh path and stop returning `owner_private_key` entirely.

## Out of scope / follow-ups
- **Federated refresh across nodes** (home node issues/validates the cookie via the relay) — additive; today federated sessions can't refresh at all, so no regression.
- **Cross-tab access-token sync** via `BroadcastChannel` — optional optimization.
- **Agent sessions** — unchanged (per-agent keypair already avoids the cross-device problem).

## Cross-cutting work (project rules)
- **Storage-sync:** `SessionRecord` fields + new methods across interface, SQLite (`schema.ts` + `index.ts`), Mongo (`index.ts`), Prisma migration. (`docs/coding-guidelines/storage-sync.md`)
- **OpenAPI:** document the new `/v1/auth/refresh` cookie contract, `Set-Cookie` on login/logout, and `expires_in`. Run `pnpm generate:types`.
- **i18n:** any new session-panel strings to `en.json` + `fi.json`.
- **Config:** add `AIMEAT_ACCESS_TTL` (default 900), `AIMEAT_REFRESH_IDLE_DAYS` (30), `AIMEAT_REFRESH_ABSOLUTE_DAYS` (90); wire into init-wizard + `.env.example` + env-config/validator.
- **E2E (new suite `e2e-session-refresh`):** happy-path rotation; reuse-detection → family revoke; grace-window concurrency (two near-simultaneous refreshes both succeed); idle + absolute expiry; logout clears cookie; cross-device independence (login on B does NOT break A).
- **No new dependency:** parse the single `aimeat_rt` cookie manually (Rule 5).

## Suggested implementation phases
1. **Storage:** extend `SessionRecord` + methods across all backends + Prisma migration + prune job.
2. **Server endpoints:** augment login, rewrite `/v1/auth/refresh` (cookie + rotation + reuse-detection), update logout/revoke; cookie helper.
3. **Client:** memory access token + cookie refresh in `libs.ts`/`api.js`; boot flow; single-flight.
4. **Config + OpenAPI + i18n.**
5. **E2E suite + browser verification (Playwright MCP).**
6. **Deprecate/remove** key-signing owner refresh after a rollout window.
