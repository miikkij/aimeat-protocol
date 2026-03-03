# AIMEAT DMZ Architecture

*Version 1.0 -- Phase 0.6*

---

## 1. Introduction

In network security, a demilitarized zone (DMZ) is a controlled perimeter between a trusted internal network and the untrusted outside world. Selected services are deliberately exposed; everything else stays behind the firewall. The owner decides what crosses the boundary.

AIMEAT applies this model to personal data and AI knowledge. Every AIMEAT node maintains three concentric zones that govern where data lives, who can access it, and what consent is required for it to move between zones.

```
+--------------------+      +--------------------+      +--------------------+
|                    |      |                    |      |                    |
|   PRIVATE ZONE     |      |       DMZ          |      |    FEDERATION      |
|                    |      |                    |      |                    |
|   Local machine    |----->|   Shared memory    |<---->|   Other nodes      |
|   Private memory   |      |   Consent-gated    |      |   External agents  |
|   Local AI agents  |      |   Actions / Queue  |      |   Marketplace      |
|                    |      |   Morsel economy   |      |   Services         |
|                    |      |                    |      |                    |
|   FULL TRUST       |      |   CONSENT-VERIFIED |      |  PROTOCOL-VERIFIED |
|                    |      |                    |      |                    |
+--------------------+      +--------------------+      +--------------------+
```

The outer zone never reaches directly into the inner zone. Requests arrive at the DMZ, are queued, and the user or their agents decide whether to respond. This is enforced by architecture, not by policy.

## 2. Three Zones

### 2.1 Private Zone

The Private Zone is the user's local environment: their machine, their local AI, and their private memory entries. Data in this zone never leaves the node. No consent mechanism is needed because data does not cross any boundary.

- **Trust level:** Full -- the user is the sole authority.
- **Memory visibility:** `private`
- **Access:** Only the owning agent (authenticated via JWT) can read or write.
- **Network exposure:** None. Private data is invisible to federation peers.

### 2.2 DMZ (Controlled Sharing Layer)

The DMZ is the boundary layer where the user deliberately exposes selected data to other parties. Memory entries with `owner` visibility live here. The Consent Layer (Phase 0.3) governs what crosses from the Private Zone into the DMZ and who may read it.

- **Trust level:** Consent-verified -- access requires a valid ConsentRecord.
- **Memory visibility:** `owner`
- **Access:** The owning agent plus any agent with a matching consent grant.
- **Network exposure:** Visible within the node's consent boundary.

### 2.3 Federation

The Federation is the open protocol layer: other AIMEAT nodes, external agents, the marketplace, and public services. Memory entries with `public` visibility are accessible here. Protocol-level authentication (JWT with Ed25519 signatures) and encryption protect data in transit.

- **Trust level:** Protocol-verified -- identity and signatures are validated.
- **Memory visibility:** `public`
- **Access:** Any authenticated or unauthenticated party (Tier 0 public reads are allowed).
- **Network exposure:** Full -- data is discoverable by federated peers.

## 3. Visibility-to-Zone Mapping

| Memory `visibility` | Zone       | Consent required?                          |
| -------------------- | ---------- | ------------------------------------------ |
| `private`            | Private    | No -- data never leaves the node           |
| `owner`              | DMZ        | Yes -- ConsentRecord governs access        |
| `public`             | Federation | No -- visible to all, including Tier 0     |

The API exposes this mapping as a `zone` field in all memory read and list responses, derived from the `visibility` value.

## 4. Data Flow

Data flows outward through consent and protocol boundaries. Inbound flow to the Private Zone is never permitted.

```
  Private Zone           DMZ                  Federation
  +-----------+    +-----------+    +-----------+
  |           | => |           | => |           |
  | private   |    | owner     |    | public    |
  | memory    |    | memory    |    | memory    |
  |           |    |           |    |           |
  +-----------+    +-----------+    +-----------+
        |                |                |
        |   Consent      |   Protocol     |
        |   Layer        |   Encryption   |
        |   (user        |   + JWT Auth   |
        |    decides)    |   (Ed25519)    |
        |                |                |
```

**Outbound (Private -> DMZ):** The user grants consent. A ConsentRecord is created specifying the data pattern, the grantee, the purpose, and an optional expiry. Only matching data becomes accessible in the DMZ.

**Outbound (DMZ -> Federation):** Data with `public` visibility is served over the AIMEAT protocol with authentication and encryption. Federated peers discover it through directory listings and peering.

**Inbound (Federation -> Private):** Not allowed. External requests arrive at the DMZ boundary (e.g., action requests enter the work queue). The user's agents decide whether to process them and whether to store any result privately. The outside world cannot read or write private memory directly.

## 5. Consent Integration

The Consent Layer (Phase 0.3) is the gatekeeper for the DMZ. ConsentRecord fields map to zone boundaries as follows:

| ConsentRecord field | Zone relevance                                      |
| ------------------- | --------------------------------------------------- |
| `scope: "dmz"`      | Data visible only within the node's DMZ             |
| `scope: "federation"` | Data visible across federated nodes               |
| `grantee`           | The agent (GAII) permitted to access DMZ data       |
| `dataPattern`       | Which memory keys the consent covers                |
| `purpose`           | Stated reason -- logged for audit                   |
| `expiresAt`         | Automatic revocation timestamp                      |

Consent is revocable at any time. When a ConsentRecord is revoked or expires, the corresponding data returns to the Private Zone from the DMZ perspective -- it becomes inaccessible to the grantee immediately.

## 6. Security Model

Each zone boundary enforces a different trust level:

### 6.1 Private Zone Boundary

- **Authentication:** Agent JWT required for all reads and writes.
- **Authorization:** Only the owning agent (matching GAII in JWT `sub`) can access.
- **Encryption:** Data at rest on the user's machine (outside AIMEAT scope).

### 6.2 DMZ Boundary (Private <-> DMZ)

- **Consent required:** A valid, non-expired ConsentRecord must exist.
- **Audit trail:** All consent grants, revocations, and data accesses are logged.
- **Revocability:** The user can revoke consent at any time, immediately cutting access.
- **Identity required:** Both grantor and grantee must have verified identities (GAII/GHII).

### 6.3 Federation Boundary (DMZ <-> Federation)

- **Protocol authentication:** JWT tokens signed with Ed25519 (via EdDSA).
- **Encryption in transit:** TLS for all federation traffic.
- **Node identity:** Peered nodes verify each other's identity before exchanging data.
- **Rate limiting:** Federation endpoints are rate-limited to prevent abuse.

### 6.4 Core Security Principles

1. **Outside -> Inside = NEVER** -- the federation cannot reach private data directly.
2. **Consent is always revocable** -- no permanent grants.
3. **Audit trail** -- all data access events are recorded.
4. **Identity required** -- data access always requires a verified identity.
5. **Encryption in transit** -- all cross-node traffic is encrypted.

## 7. API Representation

Memory API responses include a `zone` field that indicates which zone the entry belongs to, derived from its `visibility`:

```json
{
  "key": "user.preferences",
  "value": { "theme": "dark" },
  "visibility": "owner",
  "zone": "dmz",
  "tags": ["settings"],
  "version": 3,
  "created_at": "2026-01-15T10:00:00Z",
  "updated_at": "2026-03-01T14:30:00Z"
}
```

The `zone` field is read-only and computed from `visibility`. It is present in all memory read (GET), list, and update (PUT) responses.

---

*AIMEAT -- AI Memory Exchange and Action Transfer*

*Overscale Solutions Oy, 2026*
