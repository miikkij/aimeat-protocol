# AIMEAT DMZ Architecture Specification

**Version:** 1.0
**Phase:** 0.6
**Status:** Normative

---

## 1. Overview

AIMEAT implements a three-zone data model inspired by network security DMZ architecture. Data flows outward through consent-controlled boundaries, while the outside world never reaches directly into private space.

```
+--------------------+     +--------------------+     +--------------------+
|                    |     |                    |     |                    |
|   PRIVATE ZONE     |     |   DMZ (Owner)      |     |   FEDERATION       |
|                    |     |                    |     |                    |
|   visibility:      | --> |   visibility:      | --> |   visibility:      |
|     'private'      |     |     'owner'        |     |     'public'       |
|                    |     |                    |     |                    |
|   Agent-only data  |     |   Owner-scoped     |     |   Globally         |
|   No external      |     |   sharing across   |     |   discoverable     |
|   access           |     |   same-owner       |     |   Cross-node       |
|                    |     |   agents           |     |   accessible       |
+--------------------+     +--------------------+     +--------------------+
         |                          |                          |
         |   Consent grants control boundary crossing          |
         +------- ConsentRecord (scope: dmz | federation) -----+
```

The three zones map directly to the `MemoryRecord.visibility` field:

| Zone | `visibility` value | Access scope |
|------|-------------------|--------------|
| Private | `'private'` | Only the owning agent (or via explicit consent) |
| DMZ (Owner) | `'owner'` | All agents belonging to the same owner |
| Federation (Public) | `'public'` | Any authenticated agent on any node |

Data transitions between zones require either a visibility change by the data owner or an explicit consent grant.

---

## 2. Zone Definitions

### 2.1 Private Zone

The Private zone is the innermost boundary. Memory records with `visibility: 'private'` are accessible only to the agent GAII that created them.

**Access rules (from `checkConsentForRead` in `src/services/consent.ts`):**
- The owning agent (`ownerGaii === accessorGaii`) always has access.
- All other access requires an explicit `ConsentRecord` matching the accessor, the memory key pattern, and with `status: 'active'`.
- If no matching consent exists, the access check returns `{ allowed: false, reason: 'no_matching_consent' }`.

**MemoryRecord fields governing private data:**
```typescript
interface MemoryRecord {
  key: string;
  ownerGaii: string;         // the agent GAII that owns this memory
  value: unknown;
  visibility: 'private';     // private zone marker
  tags: string[];
  ttlHours: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}
```

### 2.2 Owner Zone (DMZ)

The Owner zone is the controlled sharing layer between an owner's own agents. Memory records with `visibility: 'owner'` are accessible to any agent whose GAII resolves to the same owner identity.

**Access rules:**
- Owner identity is extracted from the GAII structure. For GAIIs containing `#`, the owner part is extracted as the segment between `#` and `@`. For plain GAIIs, the owner part is the segment before `@`.
- If both the data owner and the accessor share the same owner identity, access is granted with `reason: 'same_owner'`.
- This zone enables multi-agent cooperation within a single owner's infrastructure without requiring explicit consent grants for each agent pair.

**Example:** Agent `helper#alice@node1` can read `owner`-visibility memories of `researcher#alice@node1` because both resolve to owner `alice`.

### 2.3 Public Zone

The Public zone makes data globally accessible to any authenticated agent on the local node.

**Access rules:**
- If `visibility === 'public'`, the consent check immediately returns `{ allowed: true, reason: 'public_data' }`.
- No consent record is needed.
- Public data is discoverable via `GET /v1/memory` and `POST /v1/memory/search` by any authenticated caller.

### 2.4 Federation Zone

The Federation zone extends Public data across node boundaries. Federation-scoped data is shared with peer nodes via the federation sync protocol.

**Key mechanisms:**
- `CsmRecord.federate` (`boolean`) controls whether a Community Service Manifest and its associated data are automatically distributed to federation peers.
- `ConsentRecord.scope` includes `'federation'` as a valid value, indicating the consent grant applies to cross-node access.
- Federated actions are tagged with `federated:{nodeId}` in the `ActionRecord.tags` array to track their origin.
- The federation sync endpoint (`POST /v1/federation/sync`) upserts remote actions with a composite ID (`{source_node}:{action.id}`) to prevent duplication.

---

## 3. Consent-Controlled Boundary Crossing

### 3.1 Grant Flow

A consent grant is created via `POST /v1/consent` and stored as a `ConsentRecord`:

```typescript
interface ConsentRecord {
  id: string;                 // UUID
  ownerGaii: string;          // Data owner (consent grantor)
  dataPattern: string;        // Glob pattern: "profile.*.interests", "iot.*"
  recipient: string;          // "*" (anyone) | specific GAII | "organism.{id}"
  purpose: string;            // Free-form: "discovery", "marketplace", "research"
  scope: 'private' | 'dmz' | 'federation';  // DMZ zone the consent applies to
  expires: string | null;     // ISO 8601 timestamp or null (indefinite)
  status: 'active' | 'revoked' | 'expired';
  grantedAt: string;          // ISO timestamp
  revokedAt: string | null;   // ISO timestamp or null
  metadata?: Record<string, unknown>;  // Free-form metadata
}
```

**Required fields for creation:** `data_pattern`, `recipient`, `purpose`. The `scope` defaults to `'federation'` if omitted. The `status` is always set to `'active'` on creation.

**Quota:** Maximum 100 consent records per owner.

**Data pattern matching** uses dot-separated glob syntax (implemented in `consentMatchPattern`):
- `*` matches a single segment (any characters except `.`)
- `**` matches any number of segments (including zero)
- Literal segments match exactly

Examples:
| Pattern | Matches | Does not match |
|---------|---------|---------------|
| `profile.*` | `profile.name`, `profile.bio` | `profile.settings.theme` |
| `iot.**` | `iot.temp`, `iot.sensor.humidity` | `profile.iot` |
| `settings.theme` | `settings.theme` | `settings.theme.dark` |

**Recipient matching:**
- `"*"` matches any accessor GAII.
- A specific GAII string matches only that exact accessor.
- `"organism.{id}"` targets a specific organism group.

### 3.2 Access Check Flow

The access check is performed by `checkConsentForRead()` in `src/services/consent.ts`. The function evaluates access in a strict priority order:

```
1. Is visibility 'public'?          --> ALLOW (reason: public_data)
2. Is accessor the data owner?      --> ALLOW (reason: owner_access)
3. Is visibility 'owner'?           --> Check same-owner identity
   3a. Same owner part in GAII?     --> ALLOW (reason: same_owner)
4. Find matching active consents    --> storage.findMatchingConsents()
   4a. Match found?                 --> ALLOW (reason: consent_granted, consentId)
   4b. No match?                    --> DENY  (reason: no_matching_consent)
```

The `findMatchingConsents()` method (in `src/storage/memory.ts`) performs the following checks on each `ConsentRecord`:
1. `consent.ownerGaii === ownerGaii` -- consent must belong to the data owner
2. `consent.status === 'active'` -- only active consents are valid
3. Expiration check: if `consent.expires` is set and has passed, the consent is auto-expired (status set to `'expired'`) and skipped
4. Recipient match: `consent.recipient === '*'` or `consent.recipient === accessorGaii`
5. Pattern match: `consentMatchPattern(consent.dataPattern, memoryKey)` must return true

### 3.3 Audit Trail

Every data access attempt (whether allowed or denied) is recorded as a `ConsentAuditEntry`:

```typescript
interface ConsentAuditEntry {
  id: string;                 // UUID
  consentId: string;          // References ConsentRecord.id (or 'none' if no consent)
  ownerGaii: string;          // Whose data was accessed
  accessorGaii: string;       // Who accessed the data
  memoryKey: string;          // Which memory key was accessed
  action: 'read' | 'list' | 'search';  // What type of access was attempted
  timestamp: string;          // ISO timestamp
  allowed: boolean;           // Whether the access was permitted
}
```

**Audit recording** is performed by `auditDataAccess()` in `src/services/consent.ts`. It writes an entry regardless of the access outcome.

**Audit querying** is available via `GET /v1/consent/audit` with the following filters:
- `days` (integer, default 30): How far back to look
- `accessor_gaii` (string): Filter by who accessed the data
- `consent_id` (string): Filter by a specific consent grant

**Consent expiry** is managed by a background job (`startConsentExpiryJob`) that runs every 10 minutes. Additionally, `findMatchingConsents` performs inline expiration -- any consent past its `expires` timestamp is immediately marked `'expired'` during the matching scan.

---

## 4. CSM Visibility Integration

Community Service Manifests (CSMs) define the consent requirements for structured data services. Each CSM includes a `consent_requirements` block that specifies the default visibility zone for data managed by that service.

**CsmDefinition.consentRequirements** (parsed from YAML by `src/services/csm-parser.ts`):

```typescript
consentRequirements: {
  visibilityDefault: 'private' | 'federation' | 'public';
  requiresConsent: boolean;
  consentPurpose: string;
  dataRetention: string;  // e.g. "until_revoked"
}
```

| Field | Description | Default |
|-------|-------------|---------|
| `visibility_default` | The default visibility zone for data entries created under this CSM | `'federation'` |
| `requires_consent` | Whether accessing data requires an explicit consent grant | `true` |
| `consent_purpose` | The stated purpose for consent grants (shown to users) | `''` |
| `data_retention` | How long data is retained | `'until_revoked'` |

**Validation:** The `validateCsm()` function enforces that `visibility_default` must be one of `'private'`, `'federation'`, or `'public'`. Invalid values produce a validation error.

Note: The CSM `visibility_default` uses `'federation'` where the `MemoryRecord.visibility` uses `'public'`. The CSM visibility is a policy directive for the service template, while `MemoryRecord.visibility` is the per-record access control value. When a CSM sets `visibility_default: 'federation'`, it indicates data created under this service should be accessible across federated nodes by default.

---

## 5. Federation Boundary

### 5.1 Federation-Scoped Consents

A `ConsentRecord` with `scope: 'federation'` explicitly authorizes cross-node data access. When the default `scope` is omitted during consent creation (`POST /v1/consent`), it defaults to `'federation'`, reflecting the protocol's design that consent grants are typically for cross-boundary sharing.

The three consent scopes align with the zone model:

| `ConsentRecord.scope` | Zone | Meaning |
|----------------------|------|---------|
| `'private'` | Private | Consent for accessing private data on the local node only |
| `'dmz'` | Owner | Consent for accessing owner-scoped data within the owner's agent pool |
| `'federation'` | Federation | Consent applies across node boundaries in the federation |

### 5.2 CsmRecord.federate

The `CsmRecord` interface includes an optional `federate` field:

```typescript
interface CsmRecord {
  name: string;
  definition: Record<string, unknown>;
  jsonSchemaKey: string;
  serviceType: string;
  registeredBy: string;
  registeredAt: string;
  updatedAt: string;
  federate?: boolean;  // Phase 3.4 -- auto-distribute to federation peers
}
```

When `federate` is `true`, the CSM and its associated action catalogue entries are automatically distributed to federation peers during sync operations. The genesis peering service (`src/services/genesis-peering.ts`) marks synchronized resources with `federated: true`.

### 5.3 Federation Sync Protocol

The federation sync endpoint (`POST /v1/federation/sync`) handles inbound catalogue data from peer nodes:
- Each action from a remote node receives a composite ID: `{source_node}:{action.id}`
- Actions are tagged with `federated:{nodeId}` for provenance tracking
- Existing federated actions are updated (upserted); new ones are created
- When a peer is removed, its federated actions are re-tagged from `federated:{nodeId}` to `expiring:{nodeId}` for graceful cleanup

---

## 6. Implementation Reference

### Source Files

| File | Purpose |
|------|---------|
| `src/services/consent.ts` | Core consent logic: `checkConsentForRead()`, `auditDataAccess()`, `expireConsents()`, `startConsentExpiryJob()` |
| `src/routes/consent.ts` | REST API: `POST/GET/DELETE /v1/consent`, `GET /v1/consent/audit`, `GET /v1/consent/:id` |
| `src/storage/interface.ts` | Type definitions: `ConsentRecord` (lines 289-301), `ConsentAuditEntry` (lines 303-312), `MemoryRecord` (lines 31-41), `CsmRecord` (lines 314-323) |
| `src/storage/memory.ts` | In-memory implementation: `findMatchingConsents()`, `consentMatchPattern()` |
| `src/services/csm-parser.ts` | CSM YAML parser: `CsmDefinition` interface including `consentRequirements`, `parseCsm()`, `validateCsm()` |
| `src/routes/federation.ts` | Federation sync endpoint: composite ID generation, federated action tagging |
| `src/services/genesis-peering.ts` | Cross-federation peering with `federated: true` marking |

### Key Functions

| Function | Location | Description |
|----------|----------|-------------|
| `checkConsentForRead()` | `src/services/consent.ts` | Evaluates whether an accessor has permission to read a memory key based on visibility and consent grants |
| `auditDataAccess()` | `src/services/consent.ts` | Records an audit entry for any data access attempt |
| `findMatchingConsents()` | `src/storage/memory.ts` | Scans active consents for a matching owner, recipient, and data pattern; auto-expires stale consents |
| `consentMatchPattern()` | `src/storage/memory.ts` | Glob-style pattern matcher for consent `dataPattern` against memory keys |
| `startConsentExpiryJob()` | `src/services/consent.ts` | Background job (10-minute interval) for batch consent expiration |
| `parseCsm()` | `src/services/csm-parser.ts` | Parses YAML CSM definitions including consent_requirements |
| `validateCsm()` | `src/services/csm-parser.ts` | Validates CSM structure including visibility_default enum check |

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/consent` | Create a new consent grant |
| `GET` | `/v1/consent` | List own consent records (filterable by `status`, `recipient`) |
| `GET` | `/v1/consent/:id` | Get a single consent record |
| `DELETE` | `/v1/consent/:id` | Revoke a consent (soft-delete: sets `status: 'revoked'`) |
| `GET` | `/v1/consent/audit` | Query the consent audit log (filterable by `days`, `accessor_gaii`, `consent_id`) |
