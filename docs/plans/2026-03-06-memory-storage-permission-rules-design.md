# Memory & Storage Permission Rules — Research & Implementation Plan

**Date:** 2026-03-06  
**Status:** Research  
**Category:** Access Control / Permissions  
**Priority:** High — currently no way to restrict access to specific addresses, domains, GHII users, or agents at the data level  

---

## 1. Problem Statement

AIMEAT's Memory and Storage systems currently use a **three-level visibility model** (`private`, `owner`, `public`) combined with a **consent system** for cross-agent access. While scopes (`memory:read`, `memory:write`, etc.) exist on JWT tokens, there is no mechanism to define **fine-grained permission rules** that restrict which entities can access specific memory keys or storage files based on:

- **Specific GAII** (agent identity)
- **GHII user** (human identity, e.g. `alice@node-1`)
- **Domain** (e.g. `*.example.com` — all agents on a particular node domain)
- **IP address / network range** (e.g. `192.168.1.0/24`)
- **Organism membership** (e.g. all members of `organism.hobby-club`)

### What Already Works

| Mechanism | Restricts By | Granularity | Status |
|-----------|-------------|-------------|--------|
| **Visibility** (`private`/`owner`/`public`) | Identity relationship | Coarse (3 levels) | ✅ Implemented |
| **JWT Scopes** (`memory:read`, `memory:write`, etc.) | API operation type | Per-endpoint | ✅ Implemented |
| **Consent records** | Recipient GAII, data pattern glob, purpose | Per-key-pattern + per-recipient | ✅ Implemented |
| **Access codes** (micro-memory) | Shared secret | Per-set | ✅ Implemented |
| **Organism workspace** (`organism.*` key prefix) | Membership check | Per-organism namespace | ✅ Implemented |
| **CORS per-entity** | Browser origin | Per-GHII/agent/memory-key | 📋 Planned (separate plan) |

### What's Missing

A **declarative permission rule system** where an owner/agent can define access lists like:

```
Memory key "health.*":
  - Allow agents: ["doctor#clinic@health-node"]
  - Allow GHII users: ["alice@node-1", "bob@node-2"]
  - Allow domains: ["*.health-network.fi"]
  - Deny: everything else
```

---

## 2. Current State — Detailed Analysis

### 2.1 Visibility Model (Layer 1 — Coarse Access)

**Location:** `MemoryRecord.visibility` and `StorageFileRecord.visibility` in `src/storage/interface.ts`

| Visibility | Who Can Read | Who Can Write | Federation Zone |
|-----------|-------------|---------------|-----------------|
| `private` | Owner agent only | Owner agent only | `private` (home node) |
| `owner` | All agents of same owner | Owner agent only | `dmz` (internal) |
| `public` | Any agent on network | Owner agent only | `federation` (replicated) |

**Limitation:** No middle ground — you can't share with "specific agents" without using the consent system.

### 2.2 Consent System (Layer 2 — Pattern-Based Grants)

**Location:** `src/routes/consent.ts`, `src/services/consent.ts`, `ConsentRecord` in `src/storage/interface.ts`

```typescript
interface ConsentRecord {
  id: string;
  ownerGaii: string;           // Who grants consent
  dataPattern: string;         // Glob: "profile.*.interests", "health.*"
  recipient: string;           // "*" | specific GAII | "organism.{id}"
  purpose: string;             // Free-form: "discovery", "treatment"
  scope: 'private' | 'dmz' | 'federation';
  expires: string | null;
  status: 'active' | 'revoked' | 'expired';
  grantedAt: string;
  revokedAt: string | null;
  metadata?: Record<string, unknown>;
}
```

**Consent checking logic** (`checkConsentForRead()`):
1. `public` visibility → ALLOW (no consent needed)
2. Same agent (`ownerGaii === accessorGaii`) → ALLOW
3. Same owner (different agent) with `owner` visibility → ALLOW
4. Otherwise → search for matching consent record where:
   - `dataPattern` glob matches the memory key
   - `recipient` is `"*"`, or matches accessor GAII, or matches `"organism.{id}"`
   - `status === 'active'` and not expired

**What consent already supports:**
- ✅ Grant access to a **specific GAII** (e.g. `doctor#clinic@health-node`)
- ✅ Grant access to **all agents** (wildcard `*`)
- ✅ Grant access to **organism members** (e.g. `organism.hobby-club`)
- ✅ **Glob patterns** for data keys (e.g. `health.*`, `profile.*.interests`)
- ✅ **Expiration** and **revocation**
- ✅ **Audit trail** (every access creates an audit entry)

**What consent does NOT support:**
- ❌ Grant to a **GHII user** (all agents under `alice@node-1`)
- ❌ Grant to a **domain** (all agents on `*.health-network.fi`)
- ❌ Grant to an **IP address/range**
- ❌ **Deny rules** (consent only grants — no explicit deny)
- ❌ **Rule priority/ordering** (first match wins, etc.)
- ❌ Listing all effective permissions for a given key (no "permission summary" view)

### 2.3 JWT Scope System (Layer 3 — Operation Restriction)

**Location:** `src/auth/middleware.ts` — `requireScope()`

Scopes restrict **what operations** an agent can perform, not **what data** it can access:

```
memory:read    — Can call GET /v1/memory endpoints
memory:write   — Can call POST/PUT /v1/memory endpoints
memory:delete  — Can call DELETE /v1/memory endpoints
storage:read   — Can download files
storage:write  — Can upload files
```

Scopes are set at agent registration and embedded in JWTs. They're orthogonal to the permission rules being discussed here.

### 2.4 Micro-Memory Access Codes (Layer 4 — Shared Secret)

**Location:** `src/routes/micro-memory.ts`, `MicroMemoryRecord` in `src/storage/interface.ts`

Micro-memory has 5 visibility levels including `shared_read` and `shared_write` gated by `accessCode`:

| Visibility | No Code | With Code |
|-----------|---------|-----------|
| `private` | ❌ | ❌ |
| `public_read` | ✅ Read | ✅ Read |
| `shared_read` | ❌ | ✅ Read (if code matches) |
| `shared_write` | ❌ | ✅ Read+Write (if code matches) |
| `public_write` | ✅ Read+Write | ✅ Read+Write |

**Limitation:** Access codes are **shared secrets** — anyone who knows the code gets access. No audit of who used which code.

### 2.5 Storage Files

**Location:** `src/routes/storage-files.ts`, `StorageFileRecord` in `src/storage/interface.ts`

```typescript
interface StorageFileRecord {
  key: string;
  ownerGaii: string;
  visibility: 'private' | 'owner' | 'public';
  mimeType: string;
  size: number;
  data: Buffer;
  accessCode?: string;          // Present in type but NOT used for access gating
  createdAt: string;
}
```

Storage files currently have **no consent integration** — only visibility is enforced:
- Private/owner files: only accessible via authenticated agent download (`GET /v1/storage/{key}`)
- Public files: accessible without auth via `GET /v1/pub/{gaii}/{key}`

---

## 3. Gap Analysis — What Needs to Be Built

### 3.1 Recipient Type Expansion (Consent Layer)

The consent system's `recipient` field currently supports 3 patterns. This needs to expand:

| Recipient Pattern | Current | Needed | Example |
|-------------------|---------|--------|---------|
| `*` (wildcard) | ✅ Yes | — | Any agent |
| Specific GAII | ✅ Yes | — | `doctor#clinic@health-node` |
| Organism member | ✅ Yes | — | `organism.hobby-club` |
| GHII user (all agents) | ❌ No | ✅ | `ghii:alice@node-1` → all agents of user alice |
| Node domain | ❌ No | ✅ | `domain:*.health-network.fi` → all agents on matching nodes |
| IP address | ❌ No | ⚠️ Optional | `ip:192.168.1.0/24` |

### 3.2 Permission Rule Listing Endpoint

Currently there is no way to view all effective permissions for a memory key or see what rules apply. Need:

- `GET /v1/permissions/memory/:key` — List all rules affecting a specific key
- `GET /v1/permissions/summary` — Overview of all permission rules for the authenticated agent's data
- `GET /v1/permissions/check` — Check whether a specific accessor would be allowed to read a specific key

### 3.3 Storage Consent Integration

Storage files currently bypass the consent system entirely. Need:

- Consent checking on storage file downloads (same as memory consent)
- Public read route (`GET /v1/pub/{gaii}/{key}`) should check consent for non-public files

### 3.4 Deny Rules (Optional)

Current consent system is **allow-only**. For true permission control, deny rules may be needed:

```
Allow organism.health-providers to read health.*
  EXCEPT deny agent bad-bot#spammer@evil-node
```

---

## 4. Proposed Design

### 4.1 Extend Consent Recipient Format

The `recipient` field in `ConsentRecord` gains new prefix-based patterns:

```typescript
type RecipientPattern =
  | '*'                          // Wildcard — any accessor
  | string                       // Specific GAII (e.g. "agent#owner@node")
  | `organism.${string}`         // Organism members (existing)
  | `ghii:${string}`             // GHII user — all agents under this user
  | `domain:${string}`           // Node domain glob (e.g. "domain:*.health.fi")
  | `node:${string}`;            // Specific node ID (e.g. "node:aimeat-finland-001")
```

**Examples:**
```json
{ "recipient": "ghii:alice@aimeat-finland-001", "data_pattern": "health.*" }
{ "recipient": "domain:*.health-network.fi",    "data_pattern": "records.*" }
{ "recipient": "node:aimeat-clinic-001",        "data_pattern": "appointments.*" }
```

### 4.2 Updated Consent Matching Logic

**Current** `checkConsentForRead()` matching:
```typescript
// Match if consent.recipient === '*' OR consent.recipient === accessorGaii
// OR consent.recipient starts with 'organism.' and accessor is member
```

**Extended** matching:
```typescript
function matchesRecipient(
  consent: ConsentRecord,
  accessorGaii: string,
  accessorOwner: string,
  accessorNode: string,
  storage: Storage
): boolean {
  const r = consent.recipient;

  // Wildcard
  if (r === '*') return true;

  // Exact GAII match
  if (r === accessorGaii) return true;

  // Organism membership
  if (r.startsWith('organism.')) {
    const orgId = r.slice('organism.'.length);
    return storage.isOrganismMember(accessorGaii, orgId);
  }

  // GHII user — all agents under this human identity
  if (r.startsWith('ghii:')) {
    const ghii = r.slice('ghii:'.length);           // e.g. "alice@node-1"
    const [username, node] = ghii.split('@');
    return accessorOwner === username && accessorNode === node;
  }

  // Domain glob — match accessor's home node domain
  if (r.startsWith('domain:')) {
    const pattern = r.slice('domain:'.length);       // e.g. "*.health-network.fi"
    return globMatch(pattern, accessorNode);
  }

  // Specific node
  if (r.startsWith('node:')) {
    const nodeId = r.slice('node:'.length);
    return accessorNode === nodeId;
  }

  return false;
}
```

### 4.3 Permission Rules Listing API

New endpoints for visibility into effective permissions:

#### List rules affecting a memory key
```
GET /v1/permissions/memory/:key
Authorization: Bearer <agent-jwt>

Response:
{
  "aimeat": "aimeat-local-001-dev",
  "ok": true,
  "data": {
    "key": "health.records",
    "visibility": "private",
    "effective_rules": [
      {
        "source": "consent",
        "consent_id": "c-123",
        "recipient": "ghii:doctor@clinic-node",
        "data_pattern": "health.*",
        "purpose": "treatment",
        "scope": "dmz",
        "expires": "2026-12-31T23:59:59Z",
        "status": "active"
      },
      {
        "source": "consent",
        "consent_id": "c-456",
        "recipient": "organism.clinic-staff",
        "data_pattern": "health.records",
        "purpose": "administration",
        "scope": "private",
        "expires": null,
        "status": "active"
      }
    ],
    "cors": {
      "allowed_origins": ["https://health-app.example.com"],
      "inherited_from": "agent"
    }
  }
}
```

#### Permission summary for the authenticated agent's data
```
GET /v1/permissions/summary
Authorization: Bearer <agent-jwt>

Response:
{
  "aimeat": "aimeat-local-001-dev",
  "ok": true,
  "data": {
    "total_memory_keys": 42,
    "total_storage_files": 7,
    "active_consents": 5,
    "rules_by_recipient_type": {
      "wildcard": 1,
      "gaii": 2,
      "ghii": 1,
      "organism": 1,
      "domain": 0,
      "node": 0
    },
    "keys_with_custom_rules": ["health.*", "profile.interests", "work.portfolio"]
  }
}
```

#### Check specific access
```
GET /v1/permissions/check?key=health.records&accessor=doctor%23clinic@health-node
Authorization: Bearer <agent-jwt>

Response:
{
  "aimeat": "aimeat-local-001-dev",
  "ok": true,
  "data": {
    "allowed": true,
    "reason": "consent_match",
    "consent_id": "c-123",
    "matched_pattern": "health.*",
    "matched_recipient": "ghii:doctor@clinic-node"
  }
}
```

### 4.4 Storage Consent Integration

Add consent checking to storage file access:

```typescript
// In storage-files.ts — GET /v1/pub/:gaii/:key
// Currently only allows visibility='public'
// Add: if not public, check consent (same as memory public read)

router.get('/v1/pub/:gaii/:key', async (req, res) => {
  const file = await storage.getFile(gaii, key);
  if (!file) return res.status(404)...;

  if (file.visibility === 'public') {
    // Always allow — existing behavior
    return sendFile(res, file);
  }

  // Non-public file — check consent
  if (!config.consentEnabled) {
    return res.status(404)...;
  }

  const accessorGaii = req.auth?.sub;
  if (!accessorGaii) {
    return res.status(404)...;
  }

  const result = await checkConsentForRead(storage, gaii, key, accessorGaii, file.visibility);
  if (result.allowed) {
    await auditDataAccess(storage, result.consentId, gaii, accessorGaii, key, 'read');
    return sendFile(res, file);
  }

  return res.status(404)...;
});
```

### 4.5 Access Code as Bootstrap Mechanism

The existing `access_code` mechanism in micro-memory can serve as a **bootstrap** for permission sharing:

1. Owner creates a shared memory set with `access_code`
2. Recipient proves knowledge of the code
3. This could auto-create a consent record for the recipient's GAII

This bridges the gap between "I shared a code with someone" and "they now have a tracked, auditable consent grant."

---

## 5. Implementation Effort Estimate

### Phase A — Consent Recipient Expansion (Medium effort)

| Task | Files | Complexity |
|------|-------|------------|
| Add `ghii:` recipient matching to `checkConsentForRead()` | `src/services/consent.ts` | Low |
| Add `domain:` recipient matching with glob | `src/services/consent.ts` | Low |
| Add `node:` recipient matching | `src/services/consent.ts` | Low |
| Validate new patterns on `POST /v1/consent` | `src/routes/consent.ts` | Low |
| Update OpenAPI spec with new recipient patterns | `openapi.yaml` | Low |
| E2E tests for new recipient types | `test/e2e-full.ts` | Medium |
| **Subtotal** | **3 files** | **~1–2 days** |

### Phase B — Permission Listing API (Medium effort)

| Task | Files | Complexity |
|------|-------|------------|
| Create `src/routes/permissions.ts` with 3 endpoints | New file | Medium |
| `GET /v1/permissions/memory/:key` — gather consent + CORS rules | New file | Medium |
| `GET /v1/permissions/summary` — aggregate stats | New file | Low |
| `GET /v1/permissions/check` — simulate access check | New file | Medium |
| Register router in `src/server.ts` | `src/server.ts` | Low |
| Add `permissions:read` scope | `src/config.ts` | Low |
| Update OpenAPI spec | `openapi.yaml` | Medium |
| E2E tests | `test/e2e-full.ts` | Medium |
| **Subtotal** | **4–5 files** | **~2–3 days** |

### Phase C — Storage Consent Integration (Low-Medium effort)

| Task | Files | Complexity |
|------|-------|------------|
| Add consent check to `GET /v1/pub/:gaii/:key` | `src/routes/storage-files.ts` | Medium |
| Add consent check to authenticated storage download | `src/routes/storage-files.ts` | Medium |
| Add `StorageFileRecord` to consent audit entries | `src/services/consent.ts` | Low |
| E2E tests for storage + consent | `test/e2e-full.ts` | Medium |
| **Subtotal** | **2–3 files** | **~1–2 days** |

### Phase D — IP-Based Restrictions (Optional, Higher effort)

| Task | Files | Complexity |
|------|-------|------------|
| Add `ip:` recipient pattern with CIDR matching | `src/services/consent.ts` | Medium |
| IP extraction from request (handle proxies, X-Forwarded-For) | `src/middleware/` | Medium |
| Security considerations (IP spoofing, proxy trust) | Documentation | Medium |
| **Subtotal** | **2–3 files** | **~1–2 days** |

### Total Estimated Effort

| Phase | Effort | Priority |
|-------|--------|----------|
| **A: Consent recipient expansion** | ~1–2 days | High (core feature) |
| **B: Permission listing API** | ~2–3 days | High (management UX) |
| **C: Storage consent integration** | ~1–2 days | Medium |
| **D: IP-based restrictions** | ~1–2 days | Low (optional) |
| **Total** | **~5–9 days** | — |

---

## 6. Relationship to Other Plans

| Related Plan | Relationship |
|-------------|-------------|
| **CORS Per-Entity Configuration** (`2026-03-06-cors-per-entity-configuration.md`) | Complementary — CORS controls browser origins, permission rules control data access at the API level. Both can share `allowedOrigins` on records. |
| **Scoped Agent Capabilities** (`2026-03-05-scoped-agent-capabilities-design.md`) | Orthogonal — scopes control what API operations are available, permission rules control what data is accessible. Both are needed. |
| **Phase 0.3 Consent Layer** (`phase-0.3-consent-layer.md`) | Extension — this plan extends the existing consent system with new recipient types and a management API. |
| **Phase 0.6 DMZ Architecture** (`phase-0.6-dmz-architecture.md`) | Aligned — DMZ zones map to visibility levels. Permission rules add finer control within each zone. |
| **Phase 3.4 Advanced Federation** (`phase-3.4-advanced-federation.md`) | Prereq — federated data sharing needs domain-based and node-based permission rules. |

---

## 7. Administration & Management

### 7.1 How Permissions Are Managed

Permission rules are managed entirely through the **consent API** (extended with new recipient types):

```bash
# Grant access to a specific GHII user (all their agents)
POST /v1/consent
{
  "data_pattern": "health.*",
  "recipient": "ghii:alice@aimeat-finland-001",
  "purpose": "personal health tracking",
  "scope": "dmz",
  "expires": "2027-01-01T00:00:00Z"
}

# Grant access to all agents on a specific domain
POST /v1/consent
{
  "data_pattern": "public-records.*",
  "recipient": "domain:*.government.fi",
  "purpose": "government data exchange",
  "scope": "federation"
}

# Grant access to a specific node
POST /v1/consent
{
  "data_pattern": "work.*",
  "recipient": "node:aimeat-employer-001",
  "purpose": "employment records access"
}

# Revoke access
DELETE /v1/consent/{consent_id}
```

### 7.2 Portal UI Integration

The profile page's **Data Wallet** tab should display:

1. **Active permissions** — list of all consent records with recipient, data pattern, purpose, expiry
2. **Quick grant** — form to create new consent with the new recipient types (GHII, domain, node)
3. **Audit log** — who accessed what, when, under which consent
4. **Permission checker** — "Can agent X access key Y?" simulation

### 7.3 Operator Dashboard Integration

The admin dashboard should show:

1. **Node-wide permission stats** — total consents, active vs revoked, by type
2. **Flagged access patterns** — unusual access (many reads from unknown domains, etc.)
3. **Top recipients** — which entities have the most consents granted to them

### 7.4 CLI Management (`aimeat` CLI)

Future `aimeat` CLI commands for permission management:

```bash
# List all permissions for a user
aimeat permissions list --owner alice

# Check access
aimeat permissions check --key health.records --accessor doctor#clinic@health-node

# Grant consent from CLI (operator only)
aimeat permissions grant --owner alice --pattern "health.*" --recipient "ghii:doctor@clinic" --purpose "treatment"
```

---

## 8. Security Considerations

### 8.1 Domain Spoofing

`domain:` recipient patterns match on the **node ID** from the accessor's JWT `node` field. This is signed by the issuing node's Ed25519 key:
- Attacker cannot forge node identity in a JWT (signature verification fails)
- Federated node identity is verified during peering handshake
- Domain patterns should be as specific as possible (avoid overly broad patterns like `domain:*`)

### 8.2 GHII Pattern Safety

`ghii:` patterns match on `owner` + `node` from the JWT. Since JWTs are signed:
- Cannot impersonate another user's agents
- Username uniqueness is enforced per node
- Cross-node GHII matching requires the accessor's JWT to contain the correct home node

### 8.3 IP-Based Restrictions (Phase D)

If implemented, IP-based rules carry risks:
- **Proxy trust:** Must configure trusted proxy chain (`X-Forwarded-For`)
- **NAT:** Multiple users behind one IP could all gain/lose access
- **Dynamic IPs:** Residential IPs change frequently
- **Recommendation:** IP restrictions are best used as an additional layer (defense-in-depth), not as sole access control

### 8.4 Deny Rules Complexity

Adding deny rules increases complexity significantly:
- Need priority ordering (deny > allow? or configurable?)
- Need clear conflict resolution semantics
- **Recommendation:** Defer deny rules. Current allow-only model combined with restrictive defaults (`private` visibility) provides sufficient control.

---

## 9. Summary & Recommendation

### What's Already Done (Reusable)

1. **Consent system** — fully functional with glob patterns, recipient matching, audit trail, expiry, revocation. This is the foundation for permission rules.
2. **Scope system** — JWT scopes control API-level access. Already integrated across all routes.
3. **Visibility model** — 3-tier access control for both memory and storage.
4. **Micro-memory access codes** — shared-secret model for lightweight access sharing.

### What Needs to Be Built

1. **Extend consent recipient matching** (Phase A) — add `ghii:`, `domain:`, `node:` patterns. Lowest effort, highest value. Builds directly on existing consent infrastructure.
2. **Permission listing API** (Phase B) — 3 new endpoints for visibility into effective permissions. Essential for management UX.
3. **Storage consent integration** (Phase C) — extend consent checking to storage file downloads.
4. **IP restrictions** (Phase D) — optional, adds defense-in-depth.

### Recommended Approach

Start with **Phase A** (consent recipient expansion) — it requires the least new code because the consent infrastructure already exists. The `checkConsentForRead()` function in `src/services/consent.ts` is the single point where matching logic needs to be extended. All existing consent features (audit, expiry, revocation, glob patterns) automatically apply to the new recipient types.

Then proceed to **Phase B** (permission listing) for management visibility, and **Phase C** (storage consent) to close the gap between memory and storage access models.

The `access_code` mechanism already provides a quick-start path for sharing — users can share a code, and the system can optionally convert that into a tracked consent record for auditability.
