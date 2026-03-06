# CORS Per-Entity Configuration — Research & Implementation Plan

**Date:** 2026-03-06  
**Status:** Research  
**Category:** Security / Access Control  
**Priority:** High — memory areas are currently open from all origins

---

## 1. Problem Statement

AIMEAT currently uses a **global open CORS policy** (`Access-Control-Allow-Origin: *`) applied to every endpoint. This means any web origin can make requests to:

- **GHII endpoints** — identity queries, profile reads
- **Agent endpoints** — agent communication, action execution
- **Memory endpoints** — read/write memory entries (the most sensitive area)

While authentication (JWT / Ed25519 signatures) and scopes (`memory:read`, `memory:write`, etc.) provide access control at the identity level, there is **no origin-level restriction**. A malicious website could attempt cross-origin requests against an authenticated session, and the browser would allow them because the server sends `Access-Control-Allow-Origin: *`.

### What's Needed

Three levels of CORS configuration:

| Level | Description | Example |
|-------|-------------|---------|
| **GHII level** | A human identity (GHII) can specify which origins are allowed to make queries on their behalf | Alice configures that only `https://my-app.example.com` and `https://portal.aimeat.fi` can access her data |
| **Agent level** | An agent can restrict which origins can communicate with it | Bot `helper#alice@node` only accepts requests from `https://alice-dashboard.com` |
| **Memory level** | Memory areas can have origin restrictions, so that even public visibility memory isn't readable from arbitrary web origins | Memory key `profile.health.*` only accessible from `https://health-app.example.com` |

---

## 2. Current State Analysis

### 2.1 Global CORS — Fully Open

**File:** `src/server.ts` (lines 180–187)

```typescript
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
  if (_req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});
```

This is a simple middleware that applies `*` to all responses. No conditional logic, no origin checking.

### 2.2 GHII Record — No Origin Fields

**File:** `src/storage/interface.ts` — `GHIIRecord`

The GHII record contains identity fields (username, displayName, bio, TOTP, email verification, trust score) but **no `allowedOrigins` field**. Registration routes (`src/routes/ghii.ts`) do not accept or store origin configuration.

### 2.3 Agent Record — No Origin Fields

**File:** `src/storage/interface.ts` — `AgentRecord`

Agent records contain name, owner, capabilities, publicKey, trustScore, defaultScopes, but **no `allowedOrigins` field**. Agent registration (`src/routes/agents.ts`) does not handle origin configuration.

### 2.4 Memory Record — No Origin Fields

**File:** `src/storage/interface.ts` — `MemoryRecord`

Memory records have `visibility` (private/owner/public) and `tags`, but **no origin restriction**. The visibility model controls who can read based on identity, not where the request originates from.

### 2.5 Existing Access Control Stack

| Layer | Status | Controls |
|-------|--------|----------|
| **CORS** | ✅ Exists (global `*`) | Browser-enforced origin check — currently allows everything |
| **JWT Auth** | ✅ Solid | Identity verification via Ed25519 JWTs |
| **Scope enforcement** | ✅ Solid | `requireScope('memory:read')` etc. |
| **Visibility** | ✅ Solid | private/owner/public per memory key |
| **Consent** | ✅ Solid | Explicit grants for cross-agent reads |
| **Workspace access** | ✅ Solid | Organism namespace isolation |
| **Rate limiting** | ✅ Solid | Per-GAII/IP bucketing with role multipliers |
| **Origin allowlist** | ❌ Missing | No per-entity origin restrictions |

### 2.6 Config — No CORS Settings

**File:** `src/config.ts` — `AimeatConfig`

There is `siteLbOriginUrl` but that controls portal site sync, not CORS. No global CORS allowlist configuration exists in `.env` or config.

### 2.7 OpenAPI Spec — No CORS Schema

**File:** `openapi.yaml`

No CORS configuration schemas, parameters, or endpoint definitions.

---

## 3. Proposed Design

### 3.1 Configuration Hierarchy

```
Node-level default (config)
  └── GHII-level allowedOrigins
        └── Agent-level allowedOrigins
              └── Memory-level allowedOrigins (per key pattern)
```

**Resolution order** (most specific wins):
1. If **anonymous mode** is enabled (`AIMEAT_ANONYMOUS=true`) and the request is using the anonymous identity → always `['*']` (skip all CORS checks)
2. If a **memory key** has `allowedOrigins` set → use those
3. Else if the **agent** being accessed has `allowedOrigins` → use those
4. Else if the **GHII** (owner) has `allowedOrigins` → use those
5. Else use the **node-level default** from config

**Anonymous mode bypass rationale:** Anonymous mode (`AIMEAT_ANONYMOUS=true`) is a specific deployment configuration — not just "any unauthenticated request." When enabled, the `optionalAuth()` middleware automatically injects a shared identity (`shared#anonymous@{nodeId}`) for requests that carry no JWT. All anonymous requests share one memory space, one identity, and have limited scopes (`memory:read`, `catalogue:read`, `social:read`). This mode exists for:
- Local development and quick prototyping
- Team knowledge sharing on isolated/private networks
- Demos without registration setup
- Scenarios where getting shared memory, action transfers, and catalogue queries working is more important than origin restrictions

Since all anonymous users already share the same identity and memory space (no isolation), CORS restrictions would add friction without security benefit. The feature's purpose is to remove barriers — adding origin checks would contradict that.

> **⚠ Anonymous Mode Gaps Discovered During This Research**
>
> The following issues were identified and **fixed** as part of this research:
>
> 1. **Anonymous JWT path works for writes** — `optionalAuth()` injects only `['memory:read', 'catalogue:read', 'social:read']` (no `memory:write`). However, agents CAN write by first calling `POST /v1/auth/anonymous` to get a JWT with wildcard scopes. This is the intended design — the system prompt has been updated to tell agents about this auth step. No need to add `memory:write` to `optionalAuth()`.
>
> 2. **Anonymous key namespace enforcement added** — Previously, anonymous agents could write to any key (e.g. `profile.name`, `config.settings`), potentially colliding with authenticated users' data. **Fix applied:** The memory route now rejects writes from the anonymous identity unless the key starts with `anonymous.` (e.g. `anonymous.agents.presence.claude`, `anonymous.context.latest`, `anonymous.handoff.pending`). The system prompt and key naming conventions have been updated to reflect this.
>
> 3. **GHII consent for non-anonymous agent operation** — For authenticated (non-anonymous) access, an agent must be registered under a user's GHII with explicit consent. Random agents cannot assign themselves to arbitrary users. The system prompt now explains this upgrade path clearly.
>
> 4. **Micro-memory is fully open in anonymous mode** — `/v1/mm` requires zero auth in anonymous mode. This is correct by design (GET-only platforms need it) and is now documented in the system prompt.

**Coexistence:** Anonymous mode runs **alongside** the normal authenticated system on the same server, not instead of it. Both are active simultaneously. Authenticated users (with JWTs) get their own isolated memory, full scope access, and per-entity CORS rules as described in this document. Anonymous users get the shared `anonymous` identity with limited scopes and no CORS restrictions. The two systems are isolated from each other — anonymous users cannot see authenticated users' private memory, and authenticated users' CORS settings have no effect on anonymous requests. This means enabling CORS restrictions for authenticated entities does not break anonymous access, and vice versa.

**When anonymous mode is OFF:** Requests without a valid JWT are rejected by `requireAuth()` before CORS even matters. The CORS hierarchy only applies to properly authenticated requests.

### 3.2 Data Model Changes

#### 3.2.1 Node-Level Config

```typescript
// src/config.ts — AimeatConfig
corsAllowedOrigins: string[];  // Default: ['*'] (open), e.g. ['https://portal.aimeat.fi']
corsEnabled: boolean;          // Master toggle, default: true
```

```bash
# .env
AIMEAT_CORS_ALLOWED_ORIGINS=*                    # Default: allow all
# AIMEAT_CORS_ALLOWED_ORIGINS=https://portal.aimeat.fi,https://app.example.com
```

#### 3.2.2 GHIIRecord Extension

```typescript
// src/storage/interface.ts — GHIIRecord
allowedOrigins?: string[];  // e.g. ['https://my-app.com', 'https://portal.aimeat.fi']
                            // undefined = inherit from node-level
                            // ['*'] = explicitly allow all
                            // [] = deny all browser-based access (API-only)
```

#### 3.2.3 AgentRecord Extension

```typescript
// src/storage/interface.ts — AgentRecord
allowedOrigins?: string[];  // Same semantics as GHII-level
                            // undefined = inherit from owner GHII
```

#### 3.2.4 MemoryRecord Extension

```typescript
// src/storage/interface.ts — MemoryRecord
allowedOrigins?: string[];  // Per-key origin restriction
                            // undefined = inherit from agent-level
```

### 3.3 Origin Header — How It Works

The browser **always** sends an `Origin` header on cross-origin requests:

```
Origin: https://my-app.example.com
```

This is automatic, unforgeable by JavaScript, and available as `req.headers.origin` on the server. The CORS middleware uses this to decide whether to allow the request. The origin includes protocol + domain + port (e.g. `https://my-app.com:3000`). This is also what appears in the CORS debug log viewer — the full origin URL of the caller.

Note: Non-browser clients (agents, curl, servers) typically don't send `Origin` at all, which is why the middleware treats missing `Origin` as "allow" — it's not a browser.

### 3.4 New CORS Middleware

Replace the current global `*` middleware with an origin-resolution middleware:

```typescript
// src/middleware/cors.ts
export function corsMiddleware(config: AimeatConfig, storage: Storage): RequestHandler {
  return async (req, res, next) => {
    const origin = req.headers.origin;

    // No Origin header = same-origin or non-browser client → allow
    if (!origin) {
      next();
      return;
    }

    // Anonymous mode: when AIMEAT_ANONYMOUS=true and no JWT is present,
    // optionalAuth() injects the shared anonymous identity (shared#anonymous@nodeId).
    // All anonymous users share one identity and memory space — CORS adds no value.
    // Skip origin checks entirely to keep the zero-friction promise of anonymous mode.
    if (config.anonymousMode && !req.headers.authorization) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      next();
      return;
    }

    // Authenticated request → resolve the most specific allowedOrigins
    const allowed = await resolveAllowedOrigins(req, config, storage);

    if (allowed.includes('*') || allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    } else {
      // Origin not allowed — omit CORS headers (browser will block)
      // Log to debug session if one is active for this GHII
      if (req.method === 'OPTIONS') {
        res.status(403).end();
        return;
      }
      // For non-preflight, continue but without CORS headers
      // Browser will reject the response
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}

async function resolveAllowedOrigins(
  req: Request,
  config: AimeatConfig,
  storage: Storage,
): Promise<string[]> {
  // 1. Try memory-level (if this is a memory endpoint with a key)
  // 2. Try agent-level (if authenticated as agent)
  // 3. Try GHII-level (if authenticated as owner)
  // 4. Fall back to node-level config
  return config.corsAllowedOrigins;
}
```

### 3.5 Management API Endpoints

#### Set GHII Allowed Origins
```
PUT /v1/ghii/:username/cors
Authorization: Bearer <owner-jwt>
{
  "allowed_origins": ["https://my-app.com", "https://portal.aimeat.fi"]
}
```

#### Set Agent Allowed Origins
```
PUT /v1/agents/:gaii/cors
Authorization: Bearer <owner-jwt>
{
  "allowed_origins": ["https://dashboard.example.com"]
}
```

#### Set Memory Key Allowed Origins
```
PUT /v1/memory/:key/cors
Authorization: Bearer <agent-jwt with memory:write>
{
  "allowed_origins": ["https://health-app.example.com"]
}
```

#### Get CORS Configuration
```
GET /v1/ghii/:username/cors      → { allowed_origins: [...] }
GET /v1/agents/:gaii/cors        → { allowed_origins: [...], inherited_from: "ghii" }
GET /v1/memory/:key/cors         → { allowed_origins: [...], inherited_from: "agent" }
```

### 3.6 Init Wizard Integration

Add CORS configuration to `aimeat init`:

```
? Allowed CORS origins (comma-separated, * for all):
  > *
```

Appears in the **custom** use case and advanced settings.

---

## 4. Work Estimation

### 4.1 What Already Exists (Reusable)

| Component | Status | Reuse |
|-----------|--------|-------|
| CORS middleware placement in server.ts | ✅ | Replace existing global middleware |
| Auth middleware chain (`requireAuth`, `requireRole`, `requireScope`) | ✅ | CORS middleware runs before these |
| Storage interface pattern | ✅ | Follow existing pattern for new fields |
| Memory in-memory storage | ✅ | Add fields to existing maps |
| Config loading from .env | ✅ | Add new env vars |
| Init wizard prompts | ✅ | Add new prompt |
| Rate limiting per-origin pattern | ✅ | Similar key-resolution approach |
| Workspace access middleware | ✅ | Pattern for async origin resolution |

### 4.2 New Work Required

| Task | Files Affected | Estimated Effort |
|------|---------------|-----------------|
| **1. Config: add `corsAllowedOrigins`** | `config.ts`, `.env.example` | Small |
| **2. Storage: add `allowedOrigins` to records** | `interface.ts`, `memory.ts` | Small |
| **3. New CORS middleware** | `src/middleware/cors.ts` (new) | Medium |
| **4. Replace global CORS in server.ts** | `server.ts` | Small |
| **5. CORS management API routes** | `src/routes/cors.ts` (new) or additions to ghii.ts, agents.ts, memory.ts | Medium |
| **6. Origin resolution logic** | Inside cors middleware | Medium — hierarchy lookup |
| **7. Agent registration: accept allowedOrigins** | `agents.ts`, `schemas.ts` | Small |
| **8. GHII registration: accept allowedOrigins** | `ghii.ts` | Small |
| **9. Memory write: accept allowedOrigins** | `memory.ts`, `schemas.ts` | Small |
| **10. Init wizard: CORS prompt** | `init-wizard.ts`, `locales/en.json`, `locales/fi.json` | Small |
| **11. OpenAPI spec update** | `openapi.yaml` | Medium |
| **12. E2E tests** | `test/e2e-full.ts` | Medium |
| **13. Documentation** | `docs/` | Small |

### 4.3 Complexity Assessment

**Total new/modified files:** ~12–15  
**New code:** ~300–500 lines (middleware + routes + storage + tests)  
**Risk level:** Medium — CORS changes affect all endpoints; must be backwards-compatible

---

## 5. Implementation Phases

### Phase 1: Node-Level CORS (Foundation)

- Add `AIMEAT_CORS_ALLOWED_ORIGINS` to config
- Create `src/middleware/cors.ts` with node-level origin checking
- Replace global `*` middleware in `server.ts`
- Update init wizard, `.env.example`
- **Backwards-compatible:** Default `['*']` preserves current behavior

### Phase 2: GHII-Level CORS

- Add `allowedOrigins` to `GHIIRecord`
- Add `PUT/GET /v1/ghii/:username/cors` routes
- Extend CORS middleware to check GHII-level origins when authenticated
- Update GHII registration to optionally accept `allowedOrigins`

### Phase 3: Agent-Level CORS

- Add `allowedOrigins` to `AgentRecord`
- Add `PUT/GET /v1/agents/:gaii/cors` routes
- Extend CORS middleware hierarchy: agent → GHII → node
- Update agent registration to optionally accept `allowedOrigins`

### Phase 4: Memory-Level CORS

- Add `allowedOrigins` to `MemoryRecord`
- Add `PUT/GET /v1/memory/:key/cors` routes
- Full hierarchy resolution: memory → agent → GHII → node
- Update memory write to optionally accept `allowedOrigins`

### Phase 5: E2E Tests & OpenAPI

- Write E2E tests covering all 4 levels
- Update `openapi.yaml` with new schemas and endpoints
- Documentation updates

---

## 6. Administration & Management

### 6.1 Who Can Set CORS?

| Level | Who Can Configure | Auth Required |
|-------|-------------------|---------------|
| **Node** | Operator (via .env or init wizard) | Server access |
| **GHII** | The GHII owner | Owner JWT |
| **Agent** | The agent's owner | Owner JWT |
| **Memory** | The agent that owns the key | Agent JWT with `memory:write` |

### 6.2 Admin Dashboard Integration

The operator admin dashboard (`src/routes/admin-dashboard.ts`) should display:

- Node-level CORS configuration
- Per-GHII CORS overrides (list view)
- Per-agent CORS overrides (list view)
- Memory keys with custom CORS (searchable)

### 6.3 Audit Trail

CORS denials should be logged to the existing audit system:

```typescript
interface CorsAuditEntry {
  timestamp: string;
  origin: string;           // The rejected origin
  endpoint: string;         // Requested path
  entityType: 'node' | 'ghii' | 'agent' | 'memory';
  entityId: string;         // GHII username, agent GAII, or memory key
  allowedOrigins: string[]; // What was configured
  action: 'denied';
}
```

This integrates with the existing consent audit pattern (`ConsentAuditEntry`).

### 6.4 Live CORS Debugging & Self-Service Origin Approval

A key usability feature: let users diagnose and fix CORS issues themselves from their profile page.

#### 6.4.1 Browser-Side Behavior (Already Built-In)

Browsers **always** log CORS denials to the developer console automatically. No client-side code needed. However, an AIMEAT client SDK could provide friendlier error messages:

```typescript
// In aimeat-client-sdk (future)
try {
  await fetch(`${nodeUrl}/v1/memory/profile.name`);
} catch (e) {
  if (e instanceof TypeError && e.message.includes('fetch')) {
    console.warn(
      `[AIMEAT] CORS blocked. Your origin "${location.origin}" is not in the allowlist.\n` +
      `Configure it at: ${nodeUrl}/v1/profile → CORS Settings tab`
    );
  }
}
```

#### 6.4.2 Live CORS Log Viewer (Profile Page Feature)

**Flow:**

1. User opens their GHII profile page → "CORS Settings" tab
2. Clicks **"Enable CORS debug logging"** — activates a time-limited log session (e.g. 5 minutes)
3. User switches to their app and triggers API calls that get denied
4. Returns to profile page — sees a live log of denied requests:

```
┌─────────────────────────────────────────────────────────────────┐
│ CORS Debug Log (active — 3:42 remaining)                       │
├───────────┬──────────────────────────┬─────────────────────────┤
│ Time      │ Origin                   │ Endpoint                │
├───────────┼──────────────────────────┼─────────────────────────┤
│ 14:32:01  │ https://my-app.com       │ GET /v1/memory/profile  │
│ 14:32:01  │ https://my-app.com       │ OPTIONS /v1/memory      │
│ 14:31:55  │ https://my-app.com       │ GET /v1/catalogue       │
└───────────┴──────────────────────────┴─────────────────────────┘
│ Your current IP: 85.123.45.67                                  │
│ Verify: https://whatismyipaddress.com ↗                        │
│                                                                │
│ [+ Add "https://my-app.com" to my allowed origins]  ← button  │
└────────────────────────────────────────────────────────────────┘
```

5. User verifies their IP matches via external link (security confirmation)
6. Clicks the **"Add to allowed origins"** button → origin is added to their GHII `allowedOrigins`
7. Retests the app — works immediately

#### 6.4.3 Backend Implementation

```
POST /v1/ghii/:username/cors/debug
Authorization: Bearer <owner-jwt>
{ "duration_minutes": 5 }
→ { "session_id": "abc123", "expires_at": "2026-03-06T14:37:00Z" }

GET /v1/ghii/:username/cors/debug/:session_id
Authorization: Bearer <owner-jwt>
→ { "entries": [...], "your_ip": "85.123.45.67", "remaining_seconds": 222 }

POST /v1/ghii/:username/cors/approve
Authorization: Bearer <owner-jwt>
{ "origin": "https://my-app.com" }
→ { "allowed_origins": ["https://my-app.com", ...] }
```

**Key design decisions:**
- Debug sessions are short-lived (max 10 minutes) to avoid storing unbounded logs
- The server records the requester's IP (`req.ip`) on each CORS denial during an active debug session
- Only the GHII owner can view their own debug logs and approve origins
- IP display + external verification link is a UX trust signal, not a security gate (CORS is origin-based, not IP-based — but showing IP helps users confirm "yes, this is me testing")
- The "approve" action is just a shortcut for `PUT /v1/ghii/:username/cors` — same auth, same storage

#### 6.4.4 Work Estimate for Debug Feature

| Task | Effort |
|------|--------|
| Debug session storage (in-memory with TTL) | Small |
| CORS middleware: log denials when debug session active | Small |
| 3 new API endpoints (start, view, approve) | Medium |
| Profile page UI (CORS tab with live log) | Medium |
| IP display + external verification links | Small |
| **Total** | ~150 lines backend + UI updates |

### 6.6 Wildcard & Pattern Support

Consider supporting glob patterns in `allowedOrigins`:

- `https://*.example.com` — any subdomain of example.com
- `https://app-*.aimeat.fi` — pattern matching

**Recommendation:** Start with exact matching only (Phase 1–4), add glob support as a follow-up if needed.

### 6.7 Migration Path

Existing deployments have no CORS configuration → default must be `['*']` (fully open) to avoid breaking changes. Operators can then tighten CORS incrementally:

1. Set node-level to specific origins
2. GHIIs configure their own restrictions
3. Agents inherit or override
4. Memory keys get fine-grained control

---

## 7. Security Considerations

### 7.1 CORS Is Not Access Control

CORS is a **browser-side mechanism**. Non-browser clients (curl, other servers, AI agents) bypass CORS entirely. CORS must be considered an **additional layer**, not a replacement for JWT auth + scopes + consent.

### 7.2 Credentials Mode

When moving from `Access-Control-Allow-Origin: *` to specific origins, note that `*` is **incompatible** with `Access-Control-Allow-Credentials: true`. The per-entity CORS system should set the actual origin in the response (not `*`) and set `credentials: true` when the origin is allowed.

### 7.3 Caching & Performance

Origin resolution requires storage lookups (GHII record, agent record, memory record). To avoid latency:

- Cache resolved origins in LRU cache (TTL: 60s)
- Preflight responses should include `Access-Control-Max-Age: 3600`
- Node-level config check is synchronous (no storage lookup)

### 7.4 Federation Impact

When federated nodes replicate memory, the `allowedOrigins` field should be included in the replication payload so that origin restrictions are preserved across nodes.

---

## 8. Summary

| Aspect | Current State | Target State |
|--------|--------------|--------------|
| **Global CORS** | `*` (open to all) | Configurable via `AIMEAT_CORS_ALLOWED_ORIGINS` |
| **GHII CORS** | Not implemented | `allowedOrigins` on GHIIRecord + management API |
| **Agent CORS** | Not implemented | `allowedOrigins` on AgentRecord + management API |
| **Memory CORS** | Not implemented | `allowedOrigins` on MemoryRecord + management API |
| **Hierarchy** | None | Memory → Agent → GHII → Node (most specific wins) |
| **Backwards compat** | N/A | Default `['*']` preserves current behavior |
| **Admin visibility** | None | Dashboard + audit logging |

**Bottom line:** The foundation (auth, scopes, storage patterns, middleware chain) is solid. The CORS feature is purely additive — new fields, new middleware, new routes — with no destructive changes to existing functionality.
