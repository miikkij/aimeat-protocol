# Identity model: GHII, GAII and GEAI

> The identity table is in `CLAUDE.md`. The rules for code (ask the caller object, `resolveIdentity()`,
> visitors from another node, key files) are in `.claude/rules/security.md`, which Claude Code loads when
> a file under `aimeat/src/` is read. This doc holds the worked patterns and the morsel-pacing detail.

## The principal types

| Identity | Format | Example | What it is |
|----------|--------|---------|------------|
| **GHII** | `owner@node-id` | `alice@aimeat-fi-001-genesis` | Human user. Owns everything. Has morsel balance, profile, trust score. |
| **GAII** | `agent#owner@node-id` | `claude#alice@aimeat-fi-001-genesis` | AI agent. Scoped permissions and its own trust score. Its morsel balance is always 0: pacing belongs to the owner. |
| **GEAI** | `eco:app#owner@node-id` | `eco:example#alice@aimeat-fi-001-genesis` | Ecosystem app. Scoped permissions and a data-area allowlist. The owner holds the balance. |

There is also a bare **Owner** name (`alice`) which is the account layer. It appears in `req.auth!.sub` for owner JWTs. `req.auth!.owner` carries it on every principal that acts for this person: the owner, an agent, an app grant and an ecosystem app alike, so comparing it answers "same person", never "which principal" ([invariant 11](security-development-dna.md#11-the-owner-name-is-not-a-principal)). A visitor from another node is the exception: its `sub` and `owner` are both its home GHII (`alice@home-node`), never a bare name.

## Authentication paths

| Path | JWT `sub` | JWT `roles` | Scopes |
|------|-----------|-------------|--------|
| **GHII login** (password/TOTP) | `alice` (bare owner name) | `['owner']` or `['owner','operator']` | Bypassed (owners can do anything) |
| **Agent device auth** (RFC 8628) | `claude#alice@node-id` (full GAII) | `['agent']` | Enforced per agent's scope list |
| **Federated login** (a visitor signed in on its home node) | `alice@home-node` (its home GHII) | `['federated']` | Enforced: the scopes this node grants the peer |

## A visitor from another node

A session signed in on another node is a VISITOR here. It holds the role `federated` and no other,
and it is named by its home GHII (`alice@home-node`) in `sub`, `owner` and `resolveIdentity()`.
`verifyJWT()` reads every federated token that way, including one minted before 2026-09-24, when the
mint still said `roles: ['owner']` and the bare local part. That old shape is why a visitor called
`alice` passed as the LOCAL `alice` on any door that asked the role or looked her up by name.

- **Ask `isForeignPrincipal(auth)`** (`src/utils/gaii.ts`) whenever a door needs to know. It is the
  one question; do not test `auth.federated` inline.
- **Shorten an identity with `localAccountName()`**, never with `x.split('@')[0]`. It gives the bare
  account name of an identity on THIS node and returns another node's identity whole, because
  shortened it names the local account that shares its local part. `isSameOwner()` compares the
  node as well as the name for the same reason.
- A visitor reaches a door on the scopes it holds (`requireScope` gives it no owner bypass), under
  its own home identity. It is never the local account holder: `requireRole('owner')`,
  `isOwnerPrincipal()` and `requireLocalSession()` refuse it.

## Identity resolution: the caller object and `resolveIdentity()`

**MANDATORY:** Every route that stores or retrieves data by identity asks the caller object, never raw `req.auth!.sub`. `callerOf(req, config.nodeId, storage)` (`src/middleware/caller.ts`) builds one `CallerContext` (`src/services/caller-context.ts`) per request and returns the same object on every later call for that request. An MCP tool group gets the same object from the session's `caller()`; code that holds only an auth object calls `callerFromAuth(auth, nodeId, storage)`.

```typescript
import { callerOf } from '../middleware/caller.js';

// In a route handler, behind requireAuth() (callerOf throws on a request with no real auth):
const caller = callerOf(req, config.nodeId, storage);
const gaii = caller.principal;            // GHII for owners, GAII for agents, GEAI for ecosystem apps
if (!caller.has('memory:write')) { ... }  // the answer requireScope gives for that word
```

The object carries `principal` (the `resolveIdentity()` result), `owner` and `ownerGhii` (the account the caller acts in), `kind` (`anonymous`, `visitor`, `ecosystem`, `app`, `agent` or `owner`), `inPerson` (the account holder in person), `visitor`, `roles`, `scopes`, `has(word)`, `operator(word?)`, and the `auth` and `principalView` shapes services take. A caller built by hand, a literal role or an inline role or wildcard test is counted per file by `pnpm check:single-entry`, and the count only goes down.

`caller.principal` is `resolveIdentity(req.auth!, config.nodeId)` from `src/utils/gaii.ts`:

- Owner session (`roles: ['owner']`, no `'agent'`) → converts bare username to GHII: `alice` → `alice@node-id`
- Agent session (`roles: ['agent']`) → returns `req.auth!.sub` as-is (already full GAII)
- Ecosystem session returns its GEAI. A visitor from another node resolves to its home-node
  GHII, even when a local account has the same name (see "A visitor from another node").
- Hosted apps use `resolveIdentity()` for their permitted owner data and
  `callerPrincipal()` for app attribution. The scoped app grant still controls access.

Use `requireOwnerPrincipal()` for owner-account operations. A shared `owner` claim
does not itself authorize an agent or app to manage that account.

**Why this matters:** Owner JWT `sub` is a bare username (`alice`), not a valid storage identity. Without `caller.principal` (or `resolveIdentity()`), data gets stored under `alice` instead of `alice@node-id`, making it invisible to list/search/update operations.

## Owner sessions: aggregation pattern

Owner list operations include the owner's GHII data and the owned agents' data
where that route permits aggregation. Use the route's existing shared aggregation
helper and pagination. Do not copy a full-memory loop into a new list route.

Keep federated owners, scoped agents and hosted-app grants distinct. A visitor is
named by its home GHII (`alice@their-node`); cutting that name at the '@' gives the
local namesake `alice` and exposes her data. `resolveIdentity()` preserves the
home-node identity, and `localAccountName()` / `localAccountOf()` in `utils/gaii.ts`
are the only cuts of an identity to an account name (`pnpm check:identity-shortening`).

For single-key operations, resolve the identity and apply the operation's ownership,
scope and access checks. Identity resolution alone does not authorize a read or write.

## Morsel pacing: single balance (GHII)

**A morsel is a pacer, not a currency and not a credit.** It exists so that nobody can push arbitrary
volume into the store through agents: what lands should be refined and useful rather than dumped. A
large balance is therefore a signal that this person has contributed something worth having, and a
balance accrues on its own, including while the owner is idle. Using morsels is not compulsory.

Money is a separate matter with its own rails (Stripe for cards, x402 for agent payments, ACP and UCP
for agentic commerce). Morsels sit beside those rails and buy nothing. Do not describe them as
billing, credits, quota or an economy, and do not compare them to a vendor's credit model: those pace
by charging you, this paces by usefulness.

All morsels belong to the owner (GHII), not individual agents, because the pace belongs to the human
in whose name an agent acts.

- **Balance location:** `GHIIRecord.morselBalance`, the only balance in the system
- **Agent balance field:** `AgentRecord.morselBalance` exists in schema for backward compat but is always 0. Never write to it.
- **Balance operations:** `storage.debitBalance(gaii, amount)` internally resolves any GAII/GHII/bare-name → owner → GHII record. Routes don't need dual-path logic.
- **`storage.creditBalance()`**, **`creditBalanceCapped()`**: same internal resolution.
- **Transactions:** Keyed to GHII identity (`owner@nodeId`)
- **Wallet API:** Returns single GHII balance, no aggregation needed
- **Per-agent spending limits:** `AgentRecord.dailySpendLimit` is used by schedule constraints when configured. It is not a universal limit on every debit path.
- **Welcome bonus:** Granted to the GHII when the account is created, never when an agent is created. The new GHII record starts with `config.welcomeBonus` as its balance, and `creditWelcomeBonus()` in `src/services/owner-provisioning.ts` records the bonus transaction for `provisionOwner()` (OAuth, invitation, SCIM), `POST /v1/ghii` (`src/routes/ghii/register-login.ts`) and `POST /v1/ghii/register-web` (`src/routes/ghii/web-verify.ts`). `POST /v1/owners` (`src/routes/owners.ts`) still writes the same balance and transaction inline.

## Ownership checks

When comparing stored `ownerGaii` against the current user:

```typescript
// CORRECT: compare against the resolved identity
if (record.ownerGaii !== callerOf(req, config.nodeId, storage).principal) { ... }

// WRONG: a bare username does not match a stored GHII/GAII
if (record.ownerGaii !== req.auth!.sub) { ... }
```

**Agents are never created implicitly.** Registration/login creates only the owner + GHII profile. Agents connect later through device auth, where the owner explicitly approves each agent and selects its scopes.

## Key files

| File | Purpose |
|------|---------|
| `src/middleware/caller.ts` | `callerOf()`: the request's caller, built once |
| `src/services/caller-context.ts` | `CallerContext`, `callerFromAuth()`, `agentSessionCaller()` |
| `src/utils/gaii.ts` | `resolveIdentity()`, `isForeignPrincipal()`, `localAccountName()`, `localAccountOf()`, GAII parsing/validation |
| `src/routes/ghii/register-login.ts` | Human registration and sign-in (`POST /v1/ghii`, `POST /v1/ghii/login`: password, TOTP, federated); mounted by `src/routes/ghii.ts` |
| `src/routes/agents/device-auth.ts` | Agent device auth (RFC 8628): `POST /v1/agents/device-authorize`, `POST /v1/agents/device-token` |
| `src/auth/middleware.ts` | Role hierarchy, scope enforcement |
| `src/auth/account-security.ts` | `requireOwnerPrincipal()` |
| `src/routes/libs.ts` | Browser helper libraries for apps, the auth client among them |
