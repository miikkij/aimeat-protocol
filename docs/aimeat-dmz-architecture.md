# AIMEAT DMZ Architecture Specification

**Version:** 1.0
**Phase:** 0.6
**Status:** Describes node 3.26 (checked against the code on 2026-10-11). Its normative content moved to AIMEAT Core 2026-11, normative since node 4.0.0. Where this page and the code disagree, the code wins.

---

## 1. Overview

AIMEAT uses a three-zone data model inspired by the network security DMZ. Data flows outward through consent-controlled boundaries, and the outside world never reaches directly into private space.

```
+--------------------+     +--------------------+     +--------------------+
|                    |     |                    |     |                    |
|   PRIVATE ZONE     |     |   DMZ              |     |   FEDERATION       |
|                    |     |                    |     |                    |
|   visibility:      | --> |   visibility:      | --> |   visibility:      |
|     'private'      |     |     'owner'        |     |     'public'       |
|                    |     |     'group'        |     |                    |
|                    |     |     'workspace'    |     |                    |
|                    |     |     'members'      |     |                    |
|                    |     |                    |     |                    |
|   The writer only, |     |   Shared on this   |     |   Readable by      |
|   or by consent    |     |   node, never      |     |   anyone, can      |
|                    |     |   federated        |     |   cross nodes      |
+--------------------+     +--------------------+     +--------------------+
         |                          |                          |
         |   Consent grants control boundary crossing          |
         +---- ConsentRecord (scope: private | dmz | federation | auth) ----+
```

`MemoryRecord.visibility` has six values (`src/storage/types/commerce.ts`). `visibilityToZone()` in `src/routes/memory/shared.ts` maps each one to a zone:

| `visibility` value | Zone | Who can read it |
|-------------------|------|-----------------|
| `'private'` | Private | The writing principal, the owner of that principal, or a holder of a matching consent |
| `'owner'` | DMZ | Every principal of the same owner on this node |
| `'group'` | DMZ | The owner and the members of the sharing group named in `groupId`, with read permission |
| `'workspace'` | DMZ | Members of the organism workspaces named in `workspaceRef` |
| `'members'` | DMZ | Any signed-in user of this node (not the shared anonymous identity) |
| `'public'` | Federation | Anyone, including a caller with no token (`GET /v1/memory/{gaii}/{key}`) |

The order of reach, from low to high, is `private < owner < group < workspace < members < public`. Data moves between zones when the data owner changes the visibility or grants consent.

---

## 2. Zone Definitions

### 2.1 Private Zone

Memory records with `visibility: 'private'` are readable by the principal that wrote them. Every other reader needs an active `ConsentRecord` that matches the reader, the memory key pattern and the data owner. Without one, `checkConsentForRead()` in `src/services/consent.ts` returns `{ allowed: false, reason: 'no_matching_consent' }`.

The owner of a principal also reads what that principal holds: a person reads what their own agents and apps stored (`authorizeRead`, ruled 2026-09-08). This does not work the other way round. An agent that reads its owner's private data goes through the ordinary visibility and consent checks.

**MemoryRecord fields governing private data** (shortened; the full type is in `src/storage/types/commerce.ts`):
```typescript
interface MemoryRecord {
  key: string;
  ownerGaii: string;         // the principal that owns this memory
  value: unknown;
  visibility: 'private' | 'owner' | 'group' | 'workspace' | 'members' | 'public';
  groupId?: string;          // for 'group'
  workspaceRef?: string;     // for 'workspace': space-separated "<organismId>/<workspaceId>" bindings
  tags: string[];
  ttlHours: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}
```

### 2.2 DMZ

The DMZ is the node-local sharing layer. Records in it are shared on this node and are never replicated to federation peers.

- **`owner`**: `checkConsentForRead()` compares the account names of the data owner and the reader (`localAccountName()`). The same account name on this node gives `reason: 'same_owner'`. A principal of another node that shares the owner's name is a different person and does not match.
- **`group`**: the group owner and the owner's agents get `reason: 'group_owner'`. A member listed in the sharing group with read permission gets `reason: 'group_member'`.
- **`workspace`**: the read is checked by `canReadWorkspace()` against the workspaces in `workspaceRef`.
- **`members`**: any signed-in user of this node.

**Example:** Agent `helper#alice@node1` can read `owner`-visibility memories of `researcher#alice@node1` because both belong to the account `alice` on `node1`.

### 2.3 Public Zone

If `visibility === 'public'`, the consent check returns `{ allowed: true, reason: 'public_data' }` at once, and no consent record is needed. A public entry is readable without a token at `GET /v1/memory/{gaii}/{key}`. When data classification is on, a classification that keeps a record inside its organism still refuses a non-member (`403 CLASSIFIED`).

### 2.4 Federation Zone

The federation zone extends public data across node boundaries. Data is shared with peer nodes through the federation sync protocol.

**Key mechanisms:**
- `CsmRecord.federate` (`boolean`) marks a Community Service Manifest whose actions are sent to federation peers (section 5.2).
- `ConsentRecord.scope` includes `'federation'`, for a consent grant that applies to cross-node access.
- A federated action is tagged `federated:{nodeId}` in `ActionRecord.tags`, to record where it came from.
- The catalogue sync endpoint `POST /v1/federation/catalogue-sync` upserts remote actions with a composite ID (`{source_node}:{action.id}`) so that they are not duplicated.

---

## 3. Consent-Controlled Boundary Crossing

### 3.1 Grant Flow

A consent grant is created with `POST /v1/consent` and stored as a `ConsentRecord` (`src/storage/types/auth.ts`):

```typescript
interface ConsentRecord {
  id: string;                 // UUID
  ownerGaii: string;          // Data owner (consent grantor)
  dataPattern: string;        // Glob pattern: "profile.*.interests", "iot.*"
  recipient: string;          // see "Recipient matching" below
  purpose: string;            // Free-form: "discovery", "marketplace", "research"
  scope: 'private' | 'dmz' | 'federation' | 'auth';
  expires: string | null;     // ISO 8601 timestamp or null (indefinite)
  status: 'active' | 'revoked' | 'expired';
  grantedAt: string;          // ISO timestamp
  revokedAt: string | null;   // ISO timestamp or null
  metadata?: Record<string, unknown>;  // Free-form metadata
}
```

**Required fields for creation:** `data_pattern`, `recipient`, `purpose` (`ConsentCreateSchema` in `src/models/schemas.ts`). The `scope` defaults to `'federation'` if omitted. The `status` is always `'active'` on creation.

**Quota:** at most 100 consent records per owner.

**Data pattern matching** uses glob syntax (`consentMatchPattern()` in `src/storage/pattern-utils.ts`). Both `.` and `/` separate segments:
- `*` matches one segment (any characters except `.` and `/`)
- `**` matches any number of segments (including zero)
- Literal segments match exactly

Examples:
| Pattern | Matches | Does not match |
|---------|---------|---------------|
| `profile.*` | `profile.name`, `profile.bio` | `profile.settings.theme` |
| `iot.**` | `iot.temp`, `iot.sensor.humidity` | `profile.iot` |
| `settings.theme` | `settings.theme` | `settings.theme.dark` |

**Recipient matching** (`matchesRecipient()` in `src/storage/consent-recipient.ts`):
- `"*"` matches any reader.
- An exact GAII matches only that reader.
- `"ghii:username@node"` matches every agent of that person on that node.
- `"domain:<glob>"` matches every reader whose home node ID matches the glob.
- `"node:<node-id>"` matches every reader on that node.
- `"organism.{id}"` matches an active member of that organism. This needs a membership lookup, so `checkConsentForRead()` handles it after the other patterns (`reason: 'organism_member_consent'`).

### 3.2 Access Check Flow

`checkConsentForRead()` in `src/services/consent.ts` evaluates access in this order:

```
1. Is visibility 'public'?               --> ALLOW (reason: public_data)
2. Is the reader the data owner?         --> ALLOW (reason: owner_access)
3. Is visibility 'owner'?                --> Same account name on this node?
   3a. Yes                               --> ALLOW (reason: same_owner)
4. Is visibility 'group'?                --> Decided here, consent is not read
   4a. Group owner or the owner's agent  --> ALLOW (reason: group_owner)
   4b. Member with read permission       --> ALLOW (reason: group_member)
   4c. Otherwise                         --> DENY  (missing_group_id | group_not_found |
                                                    not_group_member | no_read_permission)
5. Find matching active consents         --> storage.findMatchingConsents()
   5a. Match found                       --> ALLOW (reason: consent_granted, consentId)
6. Active organism.{id} grants           --> Is the reader an active member of that organism?
   6a. Yes                               --> ALLOW (reason: organism_member_consent, consentId)
7. Otherwise                             --> DENY  (reason: no_matching_consent)
```

`findMatchingConsents()` is a storage method, implemented in both providers (`src/storage/providers/sqlite/methods/consent.ts` and `src/storage/providers/postgres-kysely/methods/consent.ts`). For each consent of the data owner it checks:
1. `consent.status === 'active'`. Only active consents count.
2. Expiry: if `consent.expires` has passed, the consent is marked `'expired'` and skipped.
3. Recipient: `matchesRecipient()`, as listed above.
4. Pattern: `consentMatchPattern(consent.dataPattern, memoryKey)` must return true.

### 3.3 Audit Trail

`auditDataAccess()` in `src/services/consent.ts` records a `ConsentAuditEntry` for an access that was **denied**, and for every consent **grant** and **revoke**. An allowed read is not recorded. Entries go to an in-memory buffer that is written to storage in batches (`consent-audit-buffer.ts`).

```typescript
interface ConsentAuditEntry {
  id: string;                 // UUID
  consentId: string;          // References ConsentRecord.id
  ownerGaii: string;          // Whose data was accessed
  accessorGaii: string;       // Who accessed the data
  memoryKey: string;          // The key read, or the consent dataPattern for grant/revoke
  action: 'read' | 'list' | 'search' | 'grant' | 'revoke';
  timestamp: string;          // ISO timestamp
  allowed: boolean;           // Always true for grant/revoke
}
```

**Audit querying** is available with `GET /v1/consent/audit` and these filters:
- `days` (integer, default 30): how far back to look
- `accessor_gaii` (string): filter by who accessed the data
- `consent_id` (string): filter by one consent grant

**Consent expiry:** the core scheduler job `consent-expiry` runs every 10 minutes and calls `expireConsents()`. `findMatchingConsents()` also expires a consent inline when it finds one past its `expires` timestamp.

---

## 4. CSM Visibility Integration

Community Service Manifests (CSMs) define the consent requirements for structured data services. Each CSM has a `consent_requirements` block that sets the default visibility for data managed by that service.

**CsmDefinition.consentRequirements** (parsed from YAML by `parseCsm()` in `src/services/csm-parser.ts`):

```typescript
consentRequirements: {
  visibilityDefault: 'private' | 'dmz' | 'local' | 'federation' | 'public';
  requiresConsent: boolean;
  consentPurpose: string;
  dataRetention: string;  // e.g. "until_revoked"
}
```

| Field | Description | Default |
|-------|-------------|---------|
| `visibility_default` | The default visibility for data entries created under this CSM | `'federation'` |
| `requires_consent` | Whether reading data requires an explicit consent grant | `true` |
| `consent_purpose` | The stated purpose for consent grants (shown to users) | `''` |
| `data_retention` | How long data is kept | `'until_revoked'` |

**Validation:** `validateCsm()` requires `visibility_default` to be one of `'private'`, `'dmz'`, `'local'`, `'federation'` or `'public'`. Any other value is a validation error.

Note: the CSM `visibility_default` is a policy for the service template, and its values are not the same set as `MemoryRecord.visibility`. `visibility_default: 'federation'` means that data created under this service should be readable across federated nodes by default.

---

## 5. Federation Boundary

### 5.1 Consent Scopes

A `ConsentRecord` with `scope: 'federation'` authorizes cross-node data access. When `scope` is omitted in `POST /v1/consent`, it defaults to `'federation'`.

The four consent scopes:

| `ConsentRecord.scope` | Zone | Meaning |
|----------------------|------|---------|
| `'private'` | Private | Consent to read private data on this node only |
| `'dmz'` | DMZ | Consent to read node-local shared data |
| `'federation'` | Federation | Consent that applies across node boundaries |
| `'auth'` | Federation | Lets another node sign this person in with their password here. The recipient is `node:<requesting-node-id>`, `*` or `domain:*` (`src/routes/federation-auth.ts`). |

### 5.2 CsmRecord.federate

The `CsmRecord` interface (`src/storage/types/apps.ts`) has an optional `federate` field:

```typescript
interface CsmRecord {
  name: string;
  definition: Record<string, unknown>;
  jsonSchemaKey: string;
  serviceType: string;
  registeredBy: string;
  registeredAt: string;
  updatedAt: string;
  semantic?: SemanticAnnotation;
  federate?: boolean;  // Phase 3.4: send this CSM's actions to federation peers
}
```

When `federate` is `true`:
- the catalogue sync (`syncCatalogueToPeer()` in `src/services/catalogue-sync.ts`) sends the CSM's actions to each peer that shares its catalogue, signed with the node's Ed25519 key;
- the CSM is listed in `GET /v1/federation/cross-catalogue` with `federated: true` (`src/routes/federation-genesis.ts`).

### 5.3 Federation Sync Protocol

`POST /v1/federation/catalogue-sync` (`src/routes/federation-sync/catalogue-trust.ts`) receives catalogue data from a peer node:
- The peer must be active and share its catalogue, and the payload signature must verify against the peer's public key.
- Each action from a remote node gets a composite ID: `{source_node}:{action.id}`.
- Actions are tagged `federated:{nodeId}` to record where they came from.
- An existing federated action is updated; a new one is created.
- When a peer is removed, its federated actions are re-tagged from `federated:{nodeId}` to `expiring:{nodeId}` for cleanup (`src/services/federation-peer-remove.ts`).

---

## 6. Implementation Reference

### Source Files

| File | Purpose |
|------|---------|
| `src/services/consent.ts` | Consent logic: `checkConsentForRead()`, `auditDataAccess()`, `expireConsents()` |
| `src/routes/consent.ts` | REST API: `POST/GET /v1/consent`, `GET/DELETE /v1/consent/:id`, `GET /v1/consent/audit`, `GET /v1/data-wallet` |
| `src/routes/memory/shared.ts` | `visibilityToZone()`: memory visibility to zone |
| `src/storage/types/commerce.ts` | Type definition: `MemoryRecord` |
| `src/storage/types/auth.ts` | Type definitions: `ConsentRecord`, `ConsentAuditEntry` |
| `src/storage/types/apps.ts` | Type definition: `CsmRecord` |
| `src/storage/providers/sqlite/methods/consent.ts`, `src/storage/providers/postgres-kysely/methods/consent.ts` | `findMatchingConsents()` in each storage provider |
| `src/storage/pattern-utils.ts` | `consentMatchPattern()` |
| `src/storage/consent-recipient.ts` | `matchesRecipient()` |
| `src/services/csm-parser.ts` | CSM YAML parser: `CsmDefinition` with `consentRequirements`, `parseCsm()`, `validateCsm()` |
| `src/routes/federation-sync/catalogue-trust.ts` | `POST /v1/federation/catalogue-sync`: composite ID, `federated:` tag |
| `src/services/catalogue-sync.ts` | Outbound catalogue sync of federated CSMs' actions |
| `src/services/federation-peer-remove.ts` | Re-tags a removed peer's actions `expiring:{nodeId}` |

### Key Functions

| Function | Location | Description |
|----------|----------|-------------|
| `checkConsentForRead()` | `src/services/consent.ts` | Decides whether a reader may read a memory key, from visibility, group membership and consent grants |
| `auditDataAccess()` | `src/services/consent.ts` | Records an audit entry for a denied access or a consent grant or revoke |
| `expireConsents()` | `src/services/consent.ts` | Marks consents past their `expires` time as expired; run by the core job `consent-expiry` every 10 minutes |
| `findMatchingConsents()` | storage providers (see above) | Scans the owner's active consents for a matching recipient and data pattern; expires stale consents inline |
| `consentMatchPattern()` | `src/storage/pattern-utils.ts` | Glob matcher for a consent `dataPattern` against a memory key |
| `matchesRecipient()` | `src/storage/consent-recipient.ts` | Matches a consent `recipient` against a reader |
| `parseCsm()` | `src/services/csm-parser.ts` | Parses YAML CSM definitions, including `consent_requirements` |
| `validateCsm()` | `src/services/csm-parser.ts` | Validates CSM structure, including the `visibility_default` value |

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/consent` | Create a consent grant |
| `GET` | `/v1/consent` | List own consent records |
| `GET` | `/v1/consent/:id` | Get one consent record |
| `DELETE` | `/v1/consent/:id` | Revoke a consent (sets `status: 'revoked'`) |
| `GET` | `/v1/consent/audit` | Query the consent audit log (filterable by `days`, `accessor_gaii`, `consent_id`) |
| `GET` | `/v1/data-wallet` | An overview of the caller's consents and recent audit entries |
| `GET` | `/v1/memory/{gaii}/{key}` | Read a public memory entry without a token |
| `POST` | `/v1/federation/catalogue-sync` | Receive a peer's catalogue |
| `GET` | `/v1/federation/cross-catalogue` | Local federated CSMs, federated actions and genesis entries |
