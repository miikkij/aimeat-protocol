# Identity Model — GHII vs GAII (full reference)

> Quick reference (identity table, `resolveIdentity()` rule, key files) lives in `CLAUDE.md`.
> This doc holds the worked patterns and the morsel-pacing detail.

## The two identities

| Identity | Format | Example | What it is |
|----------|--------|---------|------------|
| **GHII** | `owner@node-id` | `alice@aimeat-fi-001-genesis` | Human user. Owns everything. Has morsel balance, profile, trust score. |
| **GAII** | `agent#owner@node-id` | `claude#alice@aimeat-fi-001-genesis` | AI agent. Scoped permissions and its own trust score. Its morsel balance is always 0: pacing belongs to the owner. |

There is also a bare **Owner** name (`alice`) which is the account layer. It appears in `req.auth!.sub` for owner JWTs and `req.auth!.owner` for both.

## Authentication paths

| Path | JWT `sub` | JWT `roles` | Scopes |
|------|-----------|-------------|--------|
| **GHII login** (password/TOTP) | `alice` (bare owner name) | `['owner']` or `['owner','operator']` | Bypassed — owners can do anything |
| **Agent device auth** (RFC 8628) | `claude#alice@node-id` (full GAII) | `['agent']` | Enforced per agent's scope list |

## Identity resolution — `resolveIdentity()`

**MANDATORY:** Every route that stores or retrieves data by identity MUST use `resolveIdentity()` from `src/utils/gaii.ts`, not raw `req.auth!.sub`.

```typescript
import { resolveIdentity } from '../utils/gaii.js';

// Inside router function:
const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

// In route handler:
const gaii = resolve(req);  // Returns GHII for owners, GAII for agents
```

- Owner session (`roles: ['owner']`, no `'agent'`) → converts bare username to GHII: `alice` → `alice@node-id`
- Agent session (`roles: ['agent']`) → returns `req.auth!.sub` as-is (already full GAII)

**Why this matters:** Owner JWT `sub` is a bare username (`alice`), not a valid storage identity. Without `resolveIdentity()`, data gets stored under `alice` instead of `alice@node-id`, making it invisible to list/search/update operations.

## Owner sessions — aggregation pattern

For **list** endpoints where the owner should see all their data (GHII + all agents):

```typescript
const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
if (isOwnerSession) {
  const ownerGhii = `${req.auth!.owner}@${config.nodeId}`;
  const agents = await storage.getAgentsByOwner(req.auth!.owner);
  // ALWAYS include GHII's own data first
  results.push(...await storage.listMemory(ownerGhii));
  for (const agent of agents) {
    results.push(...await storage.listMemory(agent.gaii));
  }
}
```

For **single-key** operations (GET/PUT/DELETE by key), `resolveIdentity()` handles it — the owner's data is stored under GHII.

## Morsel pacing — single balance (GHII)

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

- **Balance location:** `GHIIRecord.morselBalance` — the only balance in the system
- **Agent balance field:** `AgentRecord.morselBalance` exists in schema for backward compat but is always 0. Never write to it.
- **Balance operations:** `storage.debitBalance(gaii, amount)` internally resolves any GAII/GHII/bare-name → owner → GHII record. Routes don't need dual-path logic.
- **`storage.creditBalance()`**, **`creditBalanceCapped()`**, **`transferBalance()`** — same internal resolution.
- **Transactions:** Keyed to GHII identity (`owner@nodeId`)
- **Wallet API:** Returns single GHII balance, no aggregation needed
- **Per-agent spending limits:** Optional `AgentRecord.dailySpendLimit` (not yet enforced, field ready)
- **Welcome bonus:** Granted to GHII during owner registration (`ghii.ts`), NOT during agent creation

## Ownership checks

When comparing stored `ownerGaii` against the current user:

```typescript
// CORRECT — compare against resolved identity
if (record.ownerGaii !== resolve(req)) { ... }

// WRONG — bare username won't match stored GHII/GAII
if (record.ownerGaii !== req.auth!.sub) { ... }
```

**Agents are never created implicitly.** Registration/login creates only the owner + GHII profile. Agents connect later through device auth, where the owner explicitly approves each agent and selects its scopes.

## Key files

| File | Purpose |
|------|---------|
| `src/utils/gaii.ts` | `resolveIdentity()`, GAII parsing/validation |
| `src/routes/ghii.ts` | Human auth (password/TOTP login) |
| `src/routes/agents.ts` | Agent device auth (RFC 8628) |
| `src/auth/middleware.ts` | Role hierarchy, scope enforcement |
| `src/routes/libs.ts` | Browser auth library |
