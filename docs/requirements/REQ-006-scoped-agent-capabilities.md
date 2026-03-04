# REQ-006: Scoped Agent Capabilities — Endpoint-Level Sandbox

**Status:** Draft  
**Priority:** High  
**Type:** Security / Authorization  
**Created:** 2026-03-04  
**References:** [sandboxed-agent-turvallisuus.md](../research/sandboxed-agent-turvallisuus.md), OWASP Top 10 for Agentic Applications 2026, IETF draft-ni-a2a-ai-agent-security-requirements-01

---

## 1. Summary

Add a scope-based capability system to AIMEAT so that each agent's API access can be restricted per use case. Today, all agents sharing the `agent` role have identical access to every API endpoint. This feature introduces per-agent `scopes` in the JWT, a `requireScope()` middleware for per-endpoint enforcement, session-level budget limits, and a scope delegation mechanism for multi-agent workflows.

## 2. Problem Statement

### 2.1 What AIMEAT Already Restricts

AIMEAT has three existing sandbox layers:

| Layer | Mechanism | What It Controls |
|-------|-----------|-----------------|
| **Data sandbox** | CSM (Community Service Manifest) | Schema validation, field constraints, visibility defaults, consent requirements, content moderation |
| **Integration sandbox** | MSM (Machine Service Manifest) | Credential injection (agent never sees API keys), action input/output schema validation, per-action pricing, allowed endpoint URLs |
| **Data-sharing sandbox** | Consent system | Pattern-based grants controlling which agent can read whose data, with full audit trail |

### 2.2 What Is Missing — The Endpoint Sandbox

```
CSM/MSM restrict:                       Missing:
├── WHAT data is written (schema)        ├── WHICH API endpoints an agent may call
├── WHAT shape data must have            ├── WHO (which agent) may do WHAT
├── HOW external APIs are called         ├── HOW MUCH per session/day (budget in JWT)
├── WITH WHAT credentials (injection)    ├── CAN the agent delegate rights forward
└── HOW content is moderated             └── IS this action consistent with the agent's task
```

All agents with the `agent` role currently receive identical permissions: full Memory API, full Work API, full Social API, full Wallet API. A translation agent and a filesystem agent are indistinguishable at the authorization layer.

### 2.3 Industry Context

| Standard | Key Requirement |
|----------|----------------|
| **OWASP ASI 02** (Tool Misuse) | "Apply least-privilege access to every tool, enforce it at the platform level, not inside the agent" |
| **OWASP ASI 03** (Identity & Privilege Abuse) | Agents must not inherit broader privileges than their task requires |
| **IETF draft (02/2026)** | Least Privilege Delegation — each delegation narrows scope, never expands |
| **Okta/Auth0** | Scoped tokens per resource; Token Vault for credential isolation |
| **MCP spec** | OAuth 2.0 scope-based tool access per MCP server |

## 3. Requirements

### 3.1 Scope Model

| ID | Requirement | Priority |
|----|-------------|----------|
| R-005-01 | Define a scope format: `<domain>:<permission>[:<qualifier>]` (OAuth 2.0 style) | Must |
| R-005-02 | Define scopes for all existing endpoint groups (see §4.2) | Must |
| R-005-03 | Support domain-level wildcards (`memory:*`) and global wildcard (`*`) | Must |
| R-005-04 | Wildcard `*` scope is reserved for `operator` role only | Must |
| R-005-05 | Define a set of recommended scope profiles per common agent archetype (§4.5) | Should |

### 3.2 JWT Extension

| ID | Requirement | Priority |
|----|-------------|----------|
| R-005-06 | Add `scopes: string[]` field to the JWT payload | Must |
| R-005-07 | Add optional `budget` object to JWT: `{ max_morsels: number, max_per_tx: number }` | Should |
| R-005-08 | Add optional `context` object to JWT: `{ task_id?, delegated_by?, scope_chain? }` | Could |
| R-005-09 | When `scopes` field is absent from JWT, default to `['*']` for backward compatibility | Must |
| R-005-10 | JWT TTL remains configurable via `AIMEAT_JWT_TTL` (default 3600s) | Must |

### 3.3 Enforcement Middleware

| ID | Requirement | Priority |
|----|-------------|----------|
| R-005-11 | Create `requireScope(...scopes)` middleware in `src/auth/middleware.ts` | Must |
| R-005-12 | `requireScope()` must be called after `requireAuth()` and before the route handler | Must |
| R-005-13 | `operator` role bypasses all scope checks (implicit `*`) | Must |
| R-005-14 | `owner` role bypasses scope checks for their own agents' data | Should |
| R-005-15 | On scope denial: return `403` with error code `SCOPE_DENIED` and log the denial | Must |
| R-005-16 | Scope denial audit entries must include: agent GAII, required scope, agent's scopes, endpoint, timestamp | Must |

### 3.4 Agent Registration

| ID | Requirement | Priority |
|----|-------------|----------|
| R-005-17 | Add optional `scopes: string[]` to `POST /v1/agents` request body | Must |
| R-005-18 | Add `defaultScopes: string[]` to `AgentRecord` in storage interface | Must |
| R-005-19 | When `scopes` is omitted during registration, assign a minimal default set (§4.5) | Must |
| R-005-20 | Owner can update agent scopes via `PATCH /v1/agents/:name/scopes` | Must |
| R-005-21 | Operator can set node-level maximum scopes (`AIMEAT_MAX_AGENT_SCOPES`) restricting what any agent may receive | Should |
| R-005-22 | Scopes assigned to an agent must not exceed the scopes of the registering owner | Must |

### 3.5 Budget Enforcement

| ID | Requirement | Priority |
|----|-------------|----------|
| R-005-23 | If JWT contains `budget.max_morsels`, wallet transfer routes must check cumulative session spend | Should |
| R-005-24 | If JWT contains `budget.max_per_tx`, reject any single transaction exceeding the limit | Should |
| R-005-25 | Budget exhaustion returns `403` with error code `BUDGET_EXCEEDED` | Should |
| R-005-26 | Owner can optionally set `daily_budget` on agent record (enforced across sessions) | Could |

### 3.6 Scope Delegation

| ID | Requirement | Priority |
|----|-------------|----------|
| R-005-27 | Provide `POST /v1/auth/delegate` endpoint that issues a narrowed JWT for a sub-agent | Should |
| R-005-28 | Delegated scopes must be a strict subset of the delegating agent's scopes | Must (if delegation implemented) |
| R-005-29 | Delegated JWT must include `context.delegated_by` and `context.scope_chain` | Should |
| R-005-30 | Maximum delegation depth limit configurable via `AIMEAT_MAX_DELEGATION_DEPTH` (default: 5) | Should |

### 3.7 Backward Compatibility

| ID | Requirement | Priority |
|----|-------------|----------|
| R-005-31 | Existing agents without `defaultScopes` continue operating with `['*']` | Must |
| R-005-32 | Existing JWTs without `scopes` field are treated as `['*']` | Must |
| R-005-33 | No existing E2E test may break after this change | Must |
| R-005-34 | Anonymous auth (when enabled) assigns a configurable scope set, default `['memory:read', 'catalogue:read', 'social:read']` | Should |

### 3.8 Observability

| ID | Requirement | Priority |
|----|-------------|----------|
| R-005-35 | Log every scope denial at `warn` level with agent GAII, endpoint, required scope | Must |
| R-005-36 | Expose scope denial count in `GET /v1/stats` under `scope_denials_total` | Should |
| R-005-37 | Admin dashboard shows per-agent scope configuration and denial history | Could |

## 4. Design

### 4.1 Scope Format

```
<domain>:<permission>[:<qualifier>]

Domain     = memory | work | social | wallet | storage | tunnel
             catalogue | consent | agent | auth | stats | admin
Permission = read | write | publish | request | accept | transfer
             connect | manage | register | delete | search
Qualifier  = (optional) further restriction — e.g. "public", "own"
```

Examples:
```
memory:read              — read own memory
memory:write             — write own memory
memory:read:public       — read public memory from other agents
work:publish             — publish actions to catalogue
work:request             — request work from others
work:accept              — accept incoming work requests
social:read              — read boards
social:write             — post to boards
wallet:read              — check balance
wallet:transfer          — transfer morsels
storage:read             — read files
storage:write            — upload files
tunnel:connect           — open personal node tunnel
catalogue:read           — browse catalogue
catalogue:search         — search catalogue
consent:manage           — manage consent grants
agent:register           — register sub-agents (delegation)
```

Domain wildcards: `memory:*` grants all memory permissions.  
Global wildcard: `*` grants all permissions (operator only).

### 4.2 Endpoint-to-Scope Mapping

| Endpoint | Method | Required Scope |
|----------|--------|---------------|
| `/v1/memory` | POST | `memory:write` |
| `/v1/memory/:key` | GET | `memory:read` |
| `/v1/memory/:key` | DELETE | `memory:delete` |
| `/v1/memory/search` | GET | `memory:read` |
| `/v1/memory/:gaii/:key` | GET | `memory:read:public` |
| `/v1/actions` | POST | `work:publish` |
| `/v1/actions` | GET | `catalogue:read` |
| `/v1/actions/:id` | GET | `catalogue:read` |
| `/v1/actions/:id` | DELETE | `work:publish` |
| `/v1/work/request` | POST | `work:request` |
| `/v1/work/:id/accept` | POST | `work:accept` |
| `/v1/work/:id/deliver` | POST | `work:accept` |
| `/v1/boards` | GET | `social:read` |
| `/v1/boards/:id` | GET | `social:read` |
| `/v1/boards/:id/posts` | POST | `social:write` |
| `/v1/boards/:id/posts/:postId/flag` | POST | `social:write` |
| `/v1/wallet` | GET | `wallet:read` |
| `/v1/wallet/request` | POST | `wallet:read` |
| `/v1/wallet/transfer` | POST | `wallet:transfer` |
| `/v1/storage/upload` | POST | `storage:write` |
| `/v1/storage/:hash` | GET | `storage:read` |
| `/v1/consent` | POST | `consent:manage` |
| `/v1/consent` | GET | `consent:manage` |
| `/v1/consent/:id` | DELETE | `consent:manage` |
| `/v1/catalogue/search` | GET | `catalogue:search` |
| `/v1/personal/anchor` | POST | `tunnel:connect` |
| `/v1/personal/tunnel` | WebSocket | `tunnel:connect` |
| `/v1/agents` | POST | `agent:register` |
| `/v1/agents/:name/scopes` | PATCH | `agent:register` |
| `/v1/auth/delegate` | POST | `auth:delegate` |
| `/v1/stats` | GET | `stats:read` |

### 4.3 Extended JWT Payload

```typescript
interface ScopedJWTPayload {
  // ── Existing fields (unchanged) ──
  sub: string;          // GAII
  owner: string;        // Owner name
  node: string;         // Node ID
  roles: string[];      // ['agent'] | ['owner'] | ['operator']

  // ── New fields ──
  scopes: string[];     // ['memory:read', 'memory:write', 'work:accept']

  budget?: {
    max_morsels: number;      // Maximum total spend this session
    max_per_tx: number;       // Maximum spend per transaction
  };

  context?: {
    task_id?: string;         // Intent tracking — which task
    delegated_by?: string;    // Delegation chain — who delegated
    scope_chain?: string[];   // Progressive narrowing trail
  };
}
```

### 4.4 `requireScope()` Middleware

```typescript
import { success, error } from '../middleware/envelope.js';

export function requireScope(...requiredScopes: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json(error(config.nodeId, 'AUTH_REQUIRED', 'Authentication required'));
      return;
    }

    // Operators always have full access
    if (req.auth.roles.includes('operator')) {
      next();
      return;
    }

    const agentScopes: string[] = req.auth.scopes ?? ['*']; // backward compat

    // Global wildcard
    if (agentScopes.includes('*')) {
      next();
      return;
    }

    for (const required of requiredScopes) {
      const [domain] = required.split(':');
      const hasExact = agentScopes.includes(required);
      const hasDomainWild = agentScopes.includes(`${domain}:*`);

      if (!hasExact && !hasDomainWild) {
        logger.warn(`scope denied: ${req.auth.sub} needs "${required}", has [${agentScopes.join(', ')}]`);
        res.status(403).json(error(
          config.nodeId,
          'SCOPE_DENIED',
          `Scope "${required}" required. Agent has: [${agentScopes.join(', ')}]`
        ));
        return;
      }
    }

    next();
  };
}
```

### 4.5 Recommended Scope Profiles

| Agent Archetype | Scopes | Budget |
|-----------------|--------|--------|
| **Translation agent** | `work:accept`, `memory:read`, `memory:write` | 0 morsels (produces, does not consume) |
| **Research agent** | `catalogue:read`, `catalogue:search`, `work:request`, `memory:read`, `memory:write` | 500 morsels/day |
| **Social bot** | `social:read`, `social:write`, `memory:read` | 100 morsels/day |
| **Personal node client** | `tunnel:connect`, `memory:*`, `work:accept` | 0 morsels |
| **Admin agent** | `agent:register`, `consent:manage`, `memory:*` | no limit |
| **Read-only analytics** | `memory:read:public`, `catalogue:read`, `wallet:read`, `stats:read` | 0 morsels |
| **Minimal default** | `memory:read`, `memory:write`, `catalogue:read` | 0 morsels |

### 4.6 Scope Delegation Flow

```
Agent A (scopes: [memory:*, work:*, social:read])
    │
    ├─ POST /v1/auth/delegate
    │  body: { target_gaii: "B", scopes: ["memory:read", "work:accept"] }
    │
    ▼
Agent B (scopes: [memory:read, work:accept])   ← strict subset of A
    │
    ├─ POST /v1/auth/delegate
    │  body: { target_gaii: "C", scopes: ["memory:read"] }
    │
    ▼
Agent C (scopes: [memory:read])                 ← strict subset of B
```

Each delegated JWT carries `context.scope_chain` for auditability:
```json
{
  "context": {
    "delegated_by": "agentB#owner@node",
    "scope_chain": ["memory:*,work:*,social:read", "memory:read,work:accept", "memory:read"]
  }
}
```

### 4.7 Three-Layer Sandbox Model (Post-Implementation)

```
┌──────────────────────────────────────────────────────────────────────┐
│                    AIMEAT Three-Layer Sandbox                        │
│                                                                      │
│  Layer 1 — CSM (Data Sandbox)                                       │
│  Controls: schema validation, field types, visibility defaults,     │
│  consent requirements, content moderation                           │
│  Analogy: database column constraints + foreign keys                │
│                                                                      │
│  Layer 2 — MSM (Integration Sandbox)                                │
│  Controls: credential injection, action I/O schemas, per-action     │
│  pricing, allowed external endpoint URLs                            │
│  Analogy: API gateway with request/response validation              │
│                                                                      │
│  Layer 3 — Scoped Capabilities (Endpoint Sandbox)  ← THIS FEATURE  │
│  Controls: which AIMEAT endpoints an agent may call, session        │
│  budget, delegation chain, task-bound authorization                 │
│  Analogy: database GRANT statements per user                        │
│                                                                      │
│  All three layers enforced server-side — agents cannot bypass.      │
└──────────────────────────────────────────────────────────────────────┘
```

## 5. Implementation Plan

### Phase 1 — Foundation (Low Risk, High Value)

| Step | Change | File(s) | Description |
|------|--------|---------|-------------|
| 1.1 | Add `scopes` to JWT payload | `src/auth/jwt.ts` | Include `scopes` array in token generation and verification |
| 1.2 | Create `requireScope()` | `src/auth/middleware.ts` | New middleware function alongside existing `requireRole()` |
| 1.3 | Add `defaultScopes` to `AgentRecord` | `src/storage/interface.ts`, `src/storage/memory.ts` | New field with storage support |
| 1.4 | Accept scopes at registration | `src/routes/agents.ts` | `POST /v1/agents` accepts optional `scopes` array |
| 1.5 | Backward compatibility | `src/auth/middleware.ts` | Missing `scopes` treated as `['*']` |
| 1.6 | Scope denial logging | `src/auth/middleware.ts` | `warn`-level log on denial |
| 1.7 | Config: `AIMEAT_MAX_AGENT_SCOPES` | `src/config.ts` | Node-level scope ceiling |
| 1.8 | Config: `AIMEAT_DEFAULT_AGENT_SCOPES` | `src/config.ts` | Default scopes for new agents |

**Validation:** `npx tsc --noEmit` + all 35 existing E2E tests pass unchanged.

### Phase 2 — Per-Endpoint Enforcement

| Step | Change | File(s) | Description |
|------|--------|---------|-------------|
| 2.1 | Add `requireScope()` to memory routes | `src/routes/memory.ts` | `memory:read`, `memory:write`, `memory:delete` |
| 2.2 | Add `requireScope()` to work routes | `src/routes/work.ts` | `work:publish`, `work:request`, `work:accept` |
| 2.3 | Add `requireScope()` to board routes | `src/routes/boards.ts` | `social:read`, `social:write` |
| 2.4 | Add `requireScope()` to wallet routes | `src/routes/wallet.ts` | `wallet:read`, `wallet:transfer` |
| 2.5 | Add `requireScope()` to storage routes | `src/routes/storage.ts` | `storage:read`, `storage:write` |
| 2.6 | Add `requireScope()` to consent routes | `src/routes/consent.ts` | `consent:manage` |
| 2.7 | Add `requireScope()` to catalogue routes | `src/routes/catalogue.ts` | `catalogue:read`, `catalogue:search` |
| 2.8 | Add `requireScope()` to tunnel routes | `src/routes/personal.ts` | `tunnel:connect` |
| 2.9 | Add `requireScope()` to agent routes | `src/routes/agents.ts` | `agent:register` |
| 2.10 | Update E2E tests | `test/e2e-full.ts` | Add scope-specific test phase |

**Validation:** New E2E test phase verifying scope denials + all existing tests pass (agents have `['*']` by default).

### Phase 3 — Budget & Delegation

| Step | Change | File(s) | Description |
|------|--------|---------|-------------|
| 3.1 | Add `budget` to JWT | `src/auth/jwt.ts` | Optional `budget` object in token |
| 3.2 | Budget enforcement in wallet | `src/routes/wallet.ts` | Check `budget.max_morsels` and `budget.max_per_tx` before transaction |
| 3.3 | Session spend tracking | `src/services/morsel-economy.ts` | Track cumulative session spend against JWT budget |
| 3.4 | Delegation endpoint | `src/routes/auth.ts` | `POST /v1/auth/delegate` issues narrowed JWT |
| 3.5 | Delegation depth check | `src/auth/middleware.ts` | Reject if `scope_chain.length > AIMEAT_MAX_DELEGATION_DEPTH` |
| 3.6 | Scope update endpoint | `src/routes/agents.ts` | `PATCH /v1/agents/:name/scopes` for owner |

**Validation:** New E2E tests for budget limits, delegation, scope narrowing.

### Phase 4 — Advanced (Intent & Anomaly Detection)

| Step | Change | File(s) | Description |
|------|--------|---------|-------------|
| 4.1 | Task context in JWT | `src/auth/jwt.ts` | Optional `context` with `task_id`, `intent` |
| 4.2 | Behavioral baseline storage | `src/storage/interface.ts`, `memory.ts` | Per-agent usage pattern tracking |
| 4.3 | Anomaly detection middleware | `src/middleware/anomaly.ts` (new) | Rate-based anomaly alerts |
| 4.4 | Human-in-the-loop flow | `src/routes/auth.ts` | Approval request to owner for high-risk operations |
| 4.5 | Scope denial stats | `src/routes/stats.ts` | `scope_denials_total` counter |

**Validation:** Anomaly detection tests with synthetic burst patterns.

## 6. Configuration

New environment variables:

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `AIMEAT_DEFAULT_AGENT_SCOPES` | Comma-separated string | `memory:read,memory:write,catalogue:read` | Default scopes assigned to newly registered agents |
| `AIMEAT_MAX_AGENT_SCOPES` | Comma-separated string | `*` | Maximum scopes any agent on this node can receive |
| `AIMEAT_ANONYMOUS_SCOPES` | Comma-separated string | `memory:read,catalogue:read,social:read` | Scopes for anonymous auth mode |
| `AIMEAT_MAX_DELEGATION_DEPTH` | Number | `5` | Maximum depth of scope delegation chain |

## 7. Security Considerations

### 7.1 Scope Escalation Prevention
- Scopes are signed inside the JWT — agents cannot modify them
- Delegation only narrows, never expands
- Scope changes require owner authentication
- Node-level `AIMEAT_MAX_AGENT_SCOPES` prevents owners from granting excessive access

### 7.2 Token Theft Mitigation
- Short JWT TTL (1h default) limits exposure window
- Existing token revocation mechanism remains effective
- Budget limits cap financial damage from stolen tokens
- Audit trail reveals anomalous usage patterns

### 7.3 Prompt Injection Resilience
- Scopes are enforced server-side, not inside the agent
- Even if an agent is tricked by prompt injection, it cannot exceed its granted scopes
- This is a critical architectural principle: **AIMEAT enforces, it does not trust agent self-restraint**

### 7.4 OWASP Alignment
- **ASI 02** (Tool Misuse): `requireScope()` enforces least-privilege at the platform level
- **ASI 03** (Identity & Privilege Abuse): Scoped JWT prevents privilege inheritance beyond task needs
- **ASI 06** (Memory Poisoning): `memory:write` scope can be withheld from agents that only need to read
- **ASI 09** (Human-Agent Trust): Visible scope restrictions make agent capabilities transparent

## 8. Testing Strategy

| Test Category | Description | Phase |
|---------------|-------------|-------|
| Unit: `requireScope()` | Verify exact match, wildcard match, denial, operator bypass | 1 |
| Unit: scope validation | Verify subset enforcement at registration and delegation | 1 |
| E2E: backward compat | All 35 existing tests pass with agents defaulting to `['*']` | 1 |
| E2E: scope denial | Agent with `['memory:read']` gets 403 on `POST /v1/memory` | 2 |
| E2E: scope wildcard | Agent with `['memory:*']` can read and write memory | 2 |
| E2E: budget enforcement | Agent with `budget.max_per_tx: 10` gets 403 on 50-morsel transfer | 3 |
| E2E: delegation | Delegated JWT has strictly narrower scopes | 3 |
| E2E: delegation depth | 6th-level delegation rejected when limit is 5 | 3 |
| E2E: anomaly detection | Burst of 500 writes in 1 minute triggers alert | 4 |

## 9. Open Questions

| # | Question | Impact |
|---|----------|--------|
| 1 | Should `owner` role be subject to scope restrictions, or only `agent`? Current design: owners bypass scope checks for their own agents. | Phase 1 |
| 2 | Should scopes apply to MCP tool calls at `/v1/mcp`, or only REST endpoints? MCP maps to the same storage layer, so enforcement there would be consistent. | Phase 2 |
| 3 | Should the delegation endpoint create a new agent record, or just issue a scoped JWT for an existing agent? | Phase 3 |
| 4 | How should federated nodes handle scope validation? Does the originating node's scope claim transfer? | Phase 3+ |
| 5 | Should anomaly baselines be operator-configured, or auto-learned from usage patterns? | Phase 4 |

## 10. Success Criteria

1. **No breaking changes** — all existing agents and E2E tests work without modification
2. **Least privilege achievable** — a newly registered agent has only `memory:read`, `memory:write`, `catalogue:read` by default
3. **Scope denial is auditable** — every 403 from `requireScope()` is logged with full context
4. **Delegation narrows** — it is impossible to delegate a scope the delegating agent does not have
5. **Industry-aligned** — the scope model is compatible with OAuth 2.0 conventions and IETF draft recommendations
6. **Three-layer sandbox** — CSM (data) + MSM (integration) + Scope (endpoint) provide defense in depth
