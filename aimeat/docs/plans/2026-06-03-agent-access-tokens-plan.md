# Agent Access Tokens (Personal Access Tokens for app testing) — Design Plan

- **Date:** 2026-06-03
- **Status:** Approved design, not yet implemented
- **Goal:** Let an owner create, in `profile > access-tab`, a revocable **access token** bound to a **scoped test identity**. An AI agent uses the token to authenticate and act — primarily to **drive/verify a webapp it built** (load it as a logged-in user, click through flows, confirm it works) — without ever holding the owner's master credentials.

## Use case

An agent builds a webapp via the generator/foundry pipeline. To verify its work it must use the app the way a logged-in user would. Today there is no owner-issued credential for that — only agent device-auth (RFC 8628, interactive) and OAuth (MCP clients). This adds a **proactively user-created, scoped, revocable token**.

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| Sharing | **One shared token, reusable by many agents** — give the same token to all 27 agents / your automation; no per-agent tokens. (Trade-off: all agents appear as one identity in logs; revoking cuts off all of them.) |
| Permissions | **One flat picker, no separate "level" tiers.** Reuse the **same scope checklist agents use** (no duplicate token-scope set), plus two extra grantable options in the same form: **Full (owner)** — act as the owner, see/do everything (the "see apps as owner" case) — and **Operator (admin)** — shown only if the creating owner is themselves an operator. The granted identity is derived from the selection: only scopes → scoped GAII; Full → owner GHII; Operator → owner + operator. Granular scopes are the safe default; Full/Operator are explicit, clearly-warned choices (a master key). *(Backend nuance: owner/operator are roles that bypass scope checks; in the UI they're just additional checkboxes alongside the scopes.)* |
| Credential form | **Opaque Bearer token** — shown once at creation; usable as `Authorization: Bearer` and/or exchanged for a browser session. |
| Lifetime | Expiry **optional** (none = eternal until revoked); **revocable anytime**; **list of active tokens** shown in access-tab. |

## Reuse existing machinery (don't reinvent)

- **Agent identity + scopes:** `AgentRecord` + `defaultScopes` + `requireScope()` middleware + `resolveIdentity()` already enforce per-GAII scoped access. A token maps to a scoped GAII; the existing middleware enforces it.
- **Opaque hashed tokens:** copy the OAuth refresh-token pattern — `randomBytes(32).hex`, stored as `hashToken()` (SHA-256), never stored raw. See [mcp/index.ts](../../src/mcp/index.ts) + `OAuthRefreshTokenRecord`.
- **Session/cookie infra (just built):** the token→browser-session exchange reuses the owner-session helpers (`establishOwnerSession`) generalized to a GAII, so the webapp's `AIMEAT.auth` sees a logged-in session. See [owner-session.ts](../../src/services/owner-session.ts) + plan 2026-06-03-owner-session-refresh-tokens.

## Identity model

The token's granted permissions (one flat selection at creation) determine the identity + roles its session carries. One token = one identity, shared by every agent that uses the token.

| Selection | Identity | Roles / access |
|-----------|----------|----------------|
| **Only agent scopes** | a dedicated GAII (`apptester-<slug>#<owner>@<node>`, a lightweight `AgentRecord` tagged `app-tester`) | `roles:['agent']` + exactly the selected scopes; data sandbox by default (own namespace). Optionally `read-owner-data` → also reads the owner's data. |
| **Full (owner)** checked | the **owner GHII** (`<owner>@<node>`) | acts as the owner — sees/does everything the owner can (all published apps, all data). The "see apps as owner" case. |
| **Operator (admin)** checked | the **owner GHII** | owner **+ operator** — full node administration (e.g. a fully-automated agent-run node). |

- **The token never exceeds its selected level**, and it can't grant more than the owner themselves has. `owner`/`operator` levels are a deliberate, clearly-warned choice — that token is effectively a master credential and must be guarded like a password.
- Identity resolution / scope enforcement / single-balance routing all reuse existing machinery (`resolveIdentity`, `requireScope`, `debitBalance`).
- **`read-owner-data`** only applies to the *picked-scopes* level: a scoped GAII normally sees only its own (empty) namespace; this toggle lets it read the owner's real data without becoming the owner. At owner/operator level it's moot — the token already is the owner.

## Token model

| | Access token (exchange output) | Personal access token (PAT) |
|---|---|---|
| Form | EdDSA JWT for the test GAII, scoped | opaque `randomBytes(32).hex` |
| TTL | short (access TTL) | optional expiry (none = eternal until revoked) |
| Stored | client only | server stores **hash** only |
| Shown | per request | **once** at creation |

## Data model — new `PatRecord` (all backends — storage-sync)

```
PatRecord {
  id            // public id for list/revoke
  tokenHash     // SHA-256 of the raw token (lookup key)
  label         // user-facing name ("App tester for hobbies.html")
  owner         // owning GHII owner name
  scopes        // string[] — selected agent scopes (enforced when not grantOwner)
  grantOwner    // boolean — "Full": act as the owner GHII
  grantOperator // boolean — add operator role; only settable by an operator owner
  readOwnerData // boolean — agent-scope tokens only: read the owner's data instead of a sandbox
  gaii          // dedicated test GAII used when not grantOwner; ignored for owner/operator
  createdAt
  expiresAt     // ISO | null (null = no expiry)
  lastUsedAt    // ISO | null
  revoked       // boolean
}
```
Repo methods: `createPat`, `getPatByHash`, `listPats(owner)`, `revokePat(id, owner)`, `touchPat(id)`. New table `personal_access_tokens` in SQLite (+ migration) and Mongo/Prisma, indexed on `tokenHash` and `owner`.

## Endpoints

**Management (owner auth):**
- `POST /v1/access/tokens` — create: `{ label, scopes, expires_in? }` → creates the test GAII + PAT, returns the **raw token once** + a ready-made agent prompt.
- `GET /v1/access/tokens` — list active PATs (label, gaii, scopes, created/lastUsed/expires) — never the raw token.
- `DELETE /v1/access/tokens/:id` — revoke (marks revoked; revokes any live browser session for that GAII).

**Use (the PAT is the auth — no owner login):**
- **Primary — the token IS a Bearer credential.** The auth middleware (`requireAuth` / `optionalAuth`) recognises `Authorization: Bearer aimeat_pat_...` directly: hash lookup → validate (not revoked/expired) → derive identity (operator/owner → owner GHII; else scoped agent + scopes, roles re-read from the owner's CURRENT roles). Every authenticated endpoint then works transparently — **no app/client changes, no exchange step, no `loginWithToken`**. Revocation/expiry take effect immediately (checked per request).
- `POST /v1/auth/token/exchange` — optional: swap the token for a short stateless JWT (`{ access_token, expires_in }`) when you'd rather avoid the per-request lookup. Same grant logic.

## Browser-testing flow (the point of the feature)

1. Owner creates a token in access-tab (scope, optional expiry) → copies it once.
2. Owner hands the token to the agent (e.g. pastes the generated prompt).
3. The agent sets `Authorization: Bearer <token>` on its requests. For webapp testing it sets the token as an **extra HTTP header in its browser automation** (so every request the page makes carries it); the server authenticates each request transparently, as if the user were already logged in. **No `loginWithToken`, no app-space code.**
4. The agent clicks through, reads/writes via the app, confirms behavior — or uses the token as `Authorization: Bearer` for direct API checks.
5. **Browser "logged in" UI:** when an owner/operator token reaches the server on a browser request, the server sets the httpOnly `aimeat_rt` cookie to the token (once). The auth lib's boot (`auth.login()`) restores a session from that cookie alone (no localStorage), so the webapp shows as genuinely logged in — and the refresh endpoint validates the PAT cookie every refresh, so revoking the token takes effect immediately. *(Scoped tokens authenticate via the header only; no browser cookie.)*

## Security

- 256-bit opaque token, SHA-256-hashed at rest, shown once.
- **The token never exceeds its chosen level**, and never more than the owner themselves holds. `owner`/`operator` levels are explicit, prominently-warned choices (a master key); picked-scopes is the safer default the UI nudges toward.
- Optional absolute expiry; **revoke anytime** → the next request carrying the token is rejected (recognition re-checks revoked/expired every request).
- Audit: `lastUsedAt` (touched per use); rate-limit the exchange endpoint.
- A **shared** token means agents are indistinguishable in audit and revoking it cuts off all of them at once — fine for testing; use separate tokens when you need per-agent audit/revocation.
- Picked-scopes tokens are sandboxed (own namespace) unless `read-owner-data` is enabled.

## UI — access-tab section

- New section "🔑 Agent access tokens" with `access-`-prefixed classes, following the existing card/section patterns in [access-tab.js](../../public/views/profile/access-tab.js).
- **Create:** label; the **agent scope checklist** (reused verbatim from agent approval) + a `read-owner-data` toggle; plus two extra checkboxes in the same form — **Full (owner)** and **Operator (admin)** (the latter shown only to operator owners). Both render a clear "master key" warning and, when checked, grey out the granular scopes (irrelevant at owner level). Expiry select (none / 24h / 7d / 30d / custom).
- **On create:** show the raw token once (blurred + copy, "shown only once" warning) **plus a ready-made copy-paste prompt** for the agent (on-brand with AIMEAT's prompt-driven workflow) explaining exactly how to use it to test the app.
- **List:** label, scopes badges, created / last-used / expires, **Revoke** button. Live-update listener (Rule: profile tabs listen for `aimeat-live-update`).

## Cross-cutting (project rules)

- **Storage-sync:** `PatRecord` + methods across interface, SQLite (schema + migration + index), Mongo/Prisma.
- **OpenAPI:** document the new `/v1/access/tokens*` and `/v1/auth/token/exchange` routes; `pnpm generate:types`.
- **i18n:** all new strings to `en.json` + `fi.json` (`profile.access.pat*` keys).
- **E2E (`e2e-access-tokens`):** create → token works within scopes / 403 outside scopes; full owner bypasses scopes; operator gating; direct PAT-as-Bearer recognised by the middleware; exchange; expiry rejected; revoke → immediately rejected; list never leaks the raw token.
- **Frontend verify (Rule 1b):** drive the browser — create a token, set it as a Bearer header in the automation, confirm the webapp behaves as logged in, revoke and confirm it stops working.

## Phases

1. **Storage:** `PatRecord` + methods across all backends. ✓ (done)
2. **Server:** management CRUD + exchange endpoint; scope ceiling + operator gating. ✓ (done)
3. **Auth middleware:** recognise the PAT as a Bearer credential directly (header-based, no app/client changes — replaces the rejected `loginWithToken` idea). ✓ (done)
4. **UI:** access-tab section + create-once token + generated agent prompt (telling the agent to set the Bearer header).
5. **OpenAPI + i18n + browser verification.**

## Resolved / remaining

- **Sharing:** one shared token, reusable by all agents. ✓
- **Levels:** picked-scopes → full owner → operator, selectable per token. ✓
- **`read-owner-data`:** a per-token toggle on the picked-scopes level. ✓
- **Picker:** one flat form — reuse the agent scope checklist + `read-owner-data` + Full (owner) + Operator (admin) checkboxes. No separate "agent-level" tier, no duplicate scope set. ✓
- **Remaining:** none blocking — ready to implement when you are.
